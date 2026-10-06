/* eslint-disable @typescript-eslint/no-explicit-any */
/// <reference types="node" />
// Le Draft quotidien côté SERVEUR (draft.js). Même harnais que arcade.test.ts :
// module chargé par createRequire, DATA_DIR temporaire peuplé depuis
// `initial-data/`.
//
// Ce qui est verrouillé : une run par jour, des choix validés (tier, doublon),
// des relances bornées, 60 gemmes au plus et jamais deux fois, une seule vie
// rachetée et payée — et les constantes jumelles du client.
import { describe, it, expect, beforeAll } from 'vitest';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import crypto from 'node:crypto';
import * as ClientDraft from '../logic/Draft.js';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

let draft: any;
let progression: any;
let stmt: any;
let tiers: any;
let cards: any[];

beforeAll(() => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'millenium-draft-'));
  for (const f of ['cards.json', 'attributes.json', 'missions.json', 'sets.json', 'decks.json']) {
    fs.copyFileSync(path.join(ROOT, 'initial-data', f), path.join(tmp, f));
  }
  process.env.DATA_DIR = tmp;
  ({ stmt } = require(path.join(ROOT, 'db.js')));
  progression = require(path.join(ROOT, 'progression.js'));
  tiers = require(path.join(ROOT, 'tiers.js'));
  draft = require(path.join(ROOT, 'draft.js'));
  cards = JSON.parse(fs.readFileSync(path.join(tmp, 'cards.json'), 'utf8'));
});

let _tagSeq = 0;
function newUser() {
  const id = crypto.randomUUID();
  stmt.insertUser.run({
    id, email: `${id}@test.local`, username: 'T', username_lc: 't',
    tag: String(++_tagSeq).padStart(4, '0'), password_hash: 'x', avatar: null, created_at: Date.now(),
  });
  progression.initUser(id);
  return () => stmt.userById.get(id);
}

const run = (user: () => any) => draft.getSnapshot(user()).run;

/** L'étape en cours d'une run (même déduction que le serveur). */
function stepOf(r: any): any {
  let taken = 0;
  for (const st of draft.DRAFT_STEPS) { if (r.picks.length === taken) return st; taken += st.cards; }
  return null;
}

/** Un choix valide pour l'étape : un lot lié tiré de l'offre du CLIENT, ou une
 *  carte du tier demandé que la run n'a pas encore prise. */
function cardForStep(r: any): string[] {
  const st = stepOf(r);
  if (st.tier == null) return ClientDraft.offerFor(r, decorated())[0].cards.map(c => c.id);
  return [cards.find(c => tiers.tiersOf(c).includes(st.tier) && !r.picks.includes(c.id)).id];
}

let _decorated: any[] | null = null;
function decorated(): any[] {
  return (_decorated ??= cards.map(c => ({ ...c, _tiers: tiers.tiersOf(c) })));
}

/** Lance la run du jour et la mène jusqu'aux duels. */
function drafted(user: () => any) {
  draft.refresh(user());
  expect(draft.start(user()).ok).toBe(true);
  while (run(user).status === 'drafting') expect(draft.pick(user(), cardForStep(run(user))).ok).toBe(true);
}

/** Une carte de n'importe quel tier, pas encore prise. */
const anyFreeCard = (r: any) => cards.find(c => tiers.tiersOf(c).length && !r.picks.includes(c.id)).id;

/** Solde un duel comme le relais PvP, puis prend la carte de plus si elle est due. */
const report = (user: () => any, result: 'win' | 'loss') => {
  const out = draft.recordDuel(user().id, result);
  if (draft.pendingBonus(run(user))) expect(draft.pick(user(), [anyFreeCard(run(user))]).ok).toBe(true);
  return out;
};

describe('jumeaux client / serveur', () => {
  it('« une carte de plus est due » se dérive pareil des deux côtés', () => {
    const base = { day: 'x', seed: 1, rerolls: 0, extra_life: false, gems_earned: 0 };
    const ids = (n: number) => Array.from({ length: n }, (_, i) => `C${i}`);
    for (const status of ['drafting', 'playing', 'won', 'lost'] as const) {
      for (const n of [14, 15, 16, 17]) {
        for (const [wins, losses] of [[0, 0], [1, 0], [1, 1], [2, 0]]) {
          const r = { ...base, status, picks: ids(n), wins, losses };
          expect(draft.pendingBonus(r)).toBe(ClientDraft.pendingBonus(r as any));
        }
      }
    }
  });

  it('le serveur compte avec les mêmes règles que le client', () => {
    expect(draft.DRAFT_STEPS).toEqual(ClientDraft.DRAFT_STEPS);
    expect(draft.DRAFT_SIZE).toBe(ClientDraft.DRAFT_SIZE);
    expect(draft.BONUS_STEP).toEqual(ClientDraft.BONUS_STEP);
    expect(draft.DRAFT_REROLLS).toBe(ClientDraft.DRAFT_REROLLS);
    expect(draft.RUN_WINS).toBe(ClientDraft.RUN_WINS);
    expect(draft.RUN_LOSSES).toBe(ClientDraft.RUN_LOSSES);
    expect(draft.EXTRA_LIVES).toBe(ClientDraft.EXTRA_LIVES);
    expect(draft.DRAFT_SIZE).toBe(15);
  });

  it('le serveur juge un lot comme le client', () => {
    for (let seed = 1; seed <= 15; seed++) {
      let s = ClientDraft.newDraft(seed);
      for (let step = 0; step < 3; step++) {
        const offer = ClientDraft.offerFor(s, decorated());
        for (const o of offer) {
          expect(draft.isLinkedBundle(o.cards)).toBe(true);
          expect(ClientDraft.isLinkedBundle(o.cards)).toBe(true);
        }
        // Trois cartes sans lien : refusées des deux côtés.
        const loose = [offer[0].cards[0], offer[1].cards[0], offer[2].cards[0]];
        expect(draft.isLinkedBundle(loose)).toBe(ClientDraft.isLinkedBundle(loose));
        s = ClientDraft.pickCards(s, offer[0].cards.map(c => c.id), decorated())!;
      }
    }
  });

  it('60 gemmes au total, une par victoire', () => {
    expect(draft.WIN_GEMS).toHaveLength(draft.RUN_WINS);
    expect(draft.WIN_GEMS.reduce((a: number, b: number) => a + b, 0)).toBe(60);
  });
});

describe('une run par jour', () => {
  it('lire ne lance rien ; lancer deux fois est refusé ; la rotation rouvre', () => {
    const user = newUser();
    expect(draft.refresh(user()).run).toBeNull();
    expect(draft.start(user()).ok).toBe(true);
    const seed = run(user).seed;
    expect(draft.start(user())).toMatchObject({ ok: false, stale: true });
    // La graine est celle du jour : relire ne la change pas.
    expect(draft.refresh(user()).run.seed).toBe(seed);
    stmt.upsertDraftState.run({ user_id: user().id, run_day: '1999-01-01', run: null });
    draft.sync(user());
    expect(draft.start(user()).ok).toBe(true);
  });
});

describe('choix et relances', () => {
  it('lots : refuse une carte seule, un lot non lié, un doublon', () => {
    const user = newUser();
    draft.refresh(user());
    draft.start(user());
    const bundle = cardForStep(run(user));
    expect(draft.pick(user(), [bundle[0]]).ok).toBe(false);
    expect(draft.pick(user(), [bundle[0], bundle[0], bundle[1]]).ok).toBe(false);
    expect(draft.pick(user(), [bundle[0], bundle[1], 'NOPE']).ok).toBe(false);
    const loose = cards.filter(c => !(c.summon_conditions ?? []).length && !bundle.includes(c.id))
      .filter((c, i, l) => l.findIndex(o => tiers.tiersOf(o)[0] === tiers.tiersOf(c)[0]) === i).slice(0, 3).map(c => c.id);
    expect(draft.pick(user(), loose)).toMatchObject({ ok: false, reason: 'Ces cartes ne forment pas un lot lié.' });
    expect(run(user).picks).toHaveLength(0);
    expect(draft.pick(user(), bundle).ok).toBe(true);
    expect(run(user).picks).toEqual(bundle);
    expect(draft.pick(user(), cardForStep(run(user)).map((id, i) => (i === 0 ? bundle[0] : id))).ok).toBe(false);
  });

  it('cartes à l\'unité : refuse le mauvais tier et le doublon, passe en duels à la 15ᵉ carte', () => {
    const user = newUser();
    draft.refresh(user());
    draft.start(user());
    while (stepOf(run(user)).tier == null) expect(draft.pick(user(), cardForStep(run(user))).ok).toBe(true);
    expect(run(user).picks).toHaveLength(9);
    const t5 = cards.find(c => tiers.tiersOf(c).includes(5) && !tiers.tiersOf(c).includes(1)).id;
    expect(draft.pick(user(), [t5]).ok).toBe(false);
    expect(draft.pick(user(), ['NOPE']).ok).toBe(false);
    const first = cardForStep(run(user));
    expect(draft.pick(user(), [...first, run(user).picks[0]]).ok).toBe(false);
    expect(draft.pick(user(), first).ok).toBe(true);
    expect(draft.pick(user(), first).ok).toBe(false);
    while (run(user).status === 'drafting') draft.pick(user(), cardForStep(run(user)));
    expect(run(user).picks).toHaveLength(15);
    expect(run(user).status).toBe('playing');
  });

  it('borne les relances', () => {
    const user = newUser();
    draft.refresh(user());
    draft.start(user());
    for (let i = 0; i < draft.DRAFT_REROLLS; i++) expect(draft.reroll(user()).ok).toBe(true);
    expect(draft.reroll(user()).ok).toBe(false);
    expect(run(user).rerolls).toBe(draft.DRAFT_REROLLS);
  });
});

describe('gemmes', () => {
  it('une run parfaite paie 60 gemmes, et un solde rejoué ne paie pas', () => {
    const user = newUser();
    drafted(user);
    const before = user().gems;
    for (let i = 0; i < draft.RUN_WINS; i++) {
      expect(draft.recordDuel(user().id, 'win').granted).toEqual({ gems: draft.WIN_GEMS[i] });
      // Un second solde avant la carte de plus : refusé, rien de plus.
      expect(draft.recordDuel(user().id, 'win').ok).toBe(false);
      if (draft.pendingBonus(run(user))) draft.pick(user(), [anyFreeCard(run(user))]);
    }
    expect(user().gems - before).toBe(60);
    expect(run(user)).toMatchObject({ status: 'won', gems_earned: 60 });
    expect(report(user, 'win').ok).toBe(false);
  });
});

describe('carte de plus et file d\'attente', () => {
  it('une carte de tout tier est due après chaque duel qui ne clôt pas la run', () => {
    const user = newUser();
    drafted(user);
    expect(draft.duelDeck(user().id)).toMatchObject({ ok: true });
    expect(draft.duelDeck(user().id).card_ids).toHaveLength(15);
    // Pas de carte à prendre avant le premier duel.
    expect(draft.pick(user(), [anyFreeCard(run(user))]).ok).toBe(false);

    draft.recordDuel(user().id, 'loss');
    expect(draft.pendingBonus(run(user))).toBe(true);
    // La file refuse un duel tant que la carte n'est pas prise.
    expect(draft.duelDeck(user().id)).toMatchObject({ ok: false });
    expect(draft.pick(user(), [run(user).picks[0]]).ok).toBe(false);           // déjà prise
    const t5 = cards.find(c => tiers.tiersOf(c).includes(5) && !run(user).picks.includes(c.id)).id;
    expect(draft.pick(user(), [t5, anyFreeCard(run(user))]).ok).toBe(false); // une seule
    expect(draft.pick(user(), [t5]).ok).toBe(true);                          // tout tier
    expect(run(user).picks).toHaveLength(16);
    expect(draft.pick(user(), [anyFreeCard(run(user))]).ok).toBe(false);     // une par duel
    expect(draft.duelDeck(user().id).card_ids).toHaveLength(16);
  });

  it('retient le malus ou le bonus de la carte de plus, et seulement là', () => {
    const user = newUser();
    // Pendant le draft, aucun modificateur n'est reçu.
    draft.start(user());
    expect(draft.pick(user(), cardForStep(run(user)), 'bonus').ok).toBe(false);
    while (run(user).status === 'drafting') expect(draft.pick(user(), cardForStep(run(user))).ok).toBe(true);
    draft.recordDuel(user().id, 'win');
    const id = anyFreeCard(run(user));
    expect(draft.pick(user(), [id], 'triche').ok).toBe(false);               // signe inconnu
    expect(draft.pick(user(), [id], 'bonus').ok).toBe(true);
    expect(run(user).mods).toEqual({ [id]: 'bonus' });
  });

  it('les signes acceptés sont ceux du client', () => {
    expect([...draft.MOD_SIGNS]).toEqual([...ClientDraft.MOD_SIGNS]);
  });

  it('la relance vaut aussi pour la carte de plus', () => {
    const user = newUser();
    drafted(user);
    expect(draft.reroll(user()).ok).toBe(false);                              // rien à choisir
    draft.recordDuel(user().id, 'win');
    expect(draft.reroll(user()).ok).toBe(true);
  });

  it('aucune carte n\'est due quand la défaite clôt la run', () => {
    const user = newUser();
    drafted(user);
    report(user, 'loss');
    draft.recordDuel(user().id, 'loss');
    expect(run(user).status).toBe('lost');
    expect(draft.pendingBonus(run(user))).toBe(false);
    expect(draft.duelDeck(user().id).ok).toBe(false);
  });
});

describe('retrait d\'une carte', () => {
  it('une carte par étape de carte de plus, révisable, absente du deck engagé', () => {
    const user = newUser();
    drafted(user);
    const [a, b] = run(user).picks;
    expect(draft.remove(user(), a).ok).toBe(false);                          // pas d'étape en cours
    draft.recordDuel(user().id, 'win');
    expect(draft.remove(user(), 'INCONNUE').ok).toBe(false);
    expect(draft.remove(user(), a).ok).toBe(true);
    expect(draft.remove(user(), b).ok).toBe(true);                           // remplace : `a` revient
    expect(Object.values(run(user).removals)).toEqual([b]);
    expect(draft.remove(user(), null).ok).toBe(true);                        // annule
    expect(run(user).removals).toBeUndefined();
    expect(draft.remove(user(), a).ok).toBe(true);
    // La carte de plus reste due : le retrait ne la remplace pas.
    expect(draft.pendingBonus(run(user))).toBe(true);
    expect(draft.pick(user(), [a]).ok).toBe(false);                          // ne revient pas
    expect(draft.pick(user(), [anyFreeCard(run(user))]).ok).toBe(true);
    const deck = draft.duelDeck(user().id).card_ids;
    expect(deck).toHaveLength(15);
    expect(deck).not.toContain(a);
    // L'étape est passée : son retrait est figé, une carte retirée ne se retire pas deux fois.
    expect(draft.remove(user(), b).ok).toBe(false);
    draft.recordDuel(user().id, 'loss');
    expect(draft.remove(user(), a).ok).toBe(false);
    expect(draft.remove(user(), b).ok).toBe(true);
    expect(draft.deckIds(run(user))).toEqual(ClientDraft.deckIds(run(user)));
  });
});

describe('vie rachetée', () => {
  it('se rachète une fois, seulement à la défaite, et se paie', () => {
    const user = newUser();
    drafted(user);
    expect(draft.buyLife(user()).ok).toBe(false);          // run encore en vie
    report(user, 'loss');
    report(user, 'loss');
    expect(run(user).status).toBe('lost');
    expect(run(user).picks).toHaveLength(16);
    expect(draft.buyLife(user())).toMatchObject({ ok: false, reason: 'Pas assez de gemmes.' });
    expect(run(user).status).toBe('lost');

    progression.grant(user().id, { gems: 25 });
    expect(draft.buyLife(user()).ok).toBe(true);
    expect(user().gems).toBe(25 - draft.EXTRA_LIFE_PRICE_GEMS);
    expect(run(user)).toMatchObject({ status: 'playing', extra_life: true });
    // La carte du duel perdu est due avant le dernier duel.
    expect(draft.duelDeck(user().id).ok).toBe(false);
    expect(draft.pick(user(), [anyFreeCard(run(user))]).ok).toBe(true);

    report(user, 'loss');
    expect(run(user).status).toBe('lost');
    progression.grant(user().id, { gems: 100 });
    expect(draft.buyLife(user()).ok).toBe(false);          // une seule par run
  });
});
