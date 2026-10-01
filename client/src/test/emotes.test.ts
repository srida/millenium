/* eslint-disable @typescript-eslint/no-explicit-any */
/// <reference types="node" />
// Messages rapides du Duel en ligne : catalogue, réponse du bot et store.
// (Le routage SERVEUR — liste blanche, cadence, message reconstruit — est
// verrouillé dans pvp-relay.test.ts.)
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const sent: any[] = [];
const handlers = new Map<string, Set<(m: any) => void>>();
vi.mock('../net/PvpConnection.js', () => ({
  send: (type: string, payload: any) => { sent.push({ type, ...payload }); return true; },
  on: (type: string, h: any) => { if (!handlers.has(type)) handlers.set(type, new Set()); handlers.get(type)!.add(h); },
  off: (type: string, h: any) => { handlers.get(type)?.delete(h); },
}));

import {
  EMOTES, EMOTE_IDS, EMOTE_COOLDOWN_MS, EMOTE_DISPLAY_MS, emoteById, botReplyTo,
  BOT_REPLY_CHANCE, BOT_REPLY_MIN_MS, BOT_REPLY_MAX_MS,
} from '../game/emotes.js';
import { useEmoteStore } from '../stores/emoteStore.js';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const store = () => useEmoteStore.getState();
const deliver = (m: any) => handlers.get('emote:send')?.forEach(h => h(m));

describe('catalogue', () => {
  it('les ids serveur et client sont les mêmes (jumeaux)', () => {
    const server = require(path.join(ROOT, 'ws', 'emotes.js'));
    expect([...server.EMOTE_IDS].sort()).toEqual([...EMOTE_IDS].sort());
  });

  it('le serveur borne un peu SOUS le délai client (latence absorbée)', () => {
    const server = require(path.join(ROOT, 'ws', 'emotes.js'));
    expect(server.EMOTE_MIN_GAP_MS).toBeLessThan(EMOTE_COOLDOWN_MS);
  });

  it('chaque message a une case connue ; l\'onomatopée n\'est portée que par gg et aie', () => {
    for (const e of EMOTES) expect(['3a', '3b', '3d', '3e']).toContain(e.panel);
    expect(EMOTES.filter(e => e.sfx).map(e => e.id).sort()).toEqual(['aie', 'gg']);
    expect(emoteById('duel')!.sfx).toBeUndefined();     // partage la case 3b de gg
  });

  it('seul « duel » a un retour à la ligne, et le « ! » ne se détache jamais', () => {
    for (const e of EMOTES) {
      expect(e.text.includes('\n')).toBe(e.id === 'duel');
      if (e.text.endsWith('!')) expect(e.text.at(-2)).toBe(' ');
    }
  });
});

describe('réponse du bot', () => {
  it('suit la table, avec un délai de 1,5 à 3 s', () => {
    const pairs: [string, string][] = [
      ['bonjour', 'bonjour'], ['chance', 'chance'], ['gg', 'gg'], ['aie', 'oups'],
      ['oups', 'hmm'], ['hmm', 'duel'], ['duel', 'chance'],
    ];
    for (const [got, reply] of pairs) {
      const r = botReplyTo(got, () => 0)!;
      expect(r.emoteId).toBe(reply);
      expect(r.delayMs).toBe(BOT_REPLY_MIN_MS);
    }
    expect(botReplyTo('gg', () => 0.5)!.delayMs).toBe(Math.round((BOT_REPLY_MIN_MS + BOT_REPLY_MAX_MS) / 2));
  });

  it('se tait parfois (pas mécanique) et ignore un id inconnu', () => {
    expect(botReplyTo('gg', () => BOT_REPLY_CHANCE)).toBeNull();
    expect(botReplyTo('inconnu', () => 0)).toBeNull();
  });
});

describe('emoteStore', () => {
  beforeEach(() => { vi.useFakeTimers(); sent.length = 0; handlers.clear(); store().attach(); });
  afterEach(() => { store().detach(); vi.useRealTimers(); });

  it('envoyer : part sur le réseau, affiche ma case, ferme le panneau, arme le délai', () => {
    store().toggleOpen();
    expect(store().send('gg')).toBe(true);
    expect(sent).toEqual([{ type: 'emote:send', emoteId: 'gg' }]);
    expect(store().me?.emoteId).toBe('gg');
    expect(store().open).toBe(false);
    expect(store().coolingDown).toBe(true);
  });

  it('pendant le délai, un second envoi est refusé et ne part pas ; il repasse après 3 s', () => {
    store().send('gg');
    expect(store().send('bonjour')).toBe(false);
    expect(sent).toHaveLength(1);
    vi.advanceTimersByTime(EMOTE_COOLDOWN_MS);
    expect(store().coolingDown).toBe(false);
    expect(store().send('bonjour')).toBe(true);
    expect(sent).toHaveLength(2);
  });

  it('refuse un id inconnu', () => {
    expect(store().send('insulte')).toBe(false);
    expect(sent).toHaveLength(0);
  });

  it('la case disparaît à 2,4 s', () => {
    store().send('gg');
    vi.advanceTimersByTime(EMOTE_DISPLAY_MS - 1);
    expect(store().me).not.toBeNull();
    vi.advanceTimersByTime(1);
    expect(store().me).toBeNull();
  });

  it('une case plus récente remplace l\'ancienne ; la disparition de l\'ancienne ne l\'emporte pas', () => {
    deliver({ emoteId: 'gg' });
    const first = store().opponent!;
    vi.advanceTimersByTime(2000);
    deliver({ emoteId: 'gg' });                       // le MÊME message
    const second = store().opponent!;
    expect(second.key).not.toBe(first.key);           // relance l'animation
    vi.advanceTimersByTime(EMOTE_DISPLAY_MS - 2000 + 100);   // l'échéance de la première est passée
    expect(store().opponent?.key).toBe(second.key);
    vi.advanceTimersByTime(EMOTE_DISPLAY_MS);
    expect(store().opponent).toBeNull();
  });

  it('reçoit ce que le réseau livre', () => {
    deliver({ type: 'emote:send', emoteId: 'aie' });
    expect(store().opponent?.emoteId).toBe('aie');
  });

  it('ignore un id inconnu venu du réseau', () => {
    deliver({ emoteId: 'insulte' });
    deliver({ emoteId: 42 });
    expect(store().opponent).toBeNull();
  });

  it('masqué : rien ne s\'affiche, pour tout le match', () => {
    store().toggleMute();
    deliver({ emoteId: 'gg' });
    expect(store().opponent).toBeNull();
    store().receive('gg');                            // la réponse du bot passe par là aussi
    expect(store().opponent).toBeNull();
    store().toggleMute();
    deliver({ emoteId: 'gg' });
    expect(store().opponent).not.toBeNull();
  });

  it('detach : désabonne, annule les minuteurs, remet à zéro', () => {
    store().toggleMute();
    store().send('gg');
    store().detach();
    expect(handlers.get('emote:send')?.size ?? 0).toBe(0);
    expect(store().opponentMuted).toBe(false);        // l'option ne survit pas au match
    expect(store().me).toBeNull();
    expect(store().coolingDown).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('attach deux fois ne double pas l\'abonnement', () => {
    store().attach();
    expect(handlers.get('emote:send')?.size).toBe(1);
  });
});
