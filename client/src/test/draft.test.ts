/// <reference types="node" />
// Mode Draft (`logic/Draft.ts`) : l'offre, les choix, la run, les adversaires.
// Rejoué sur le catalogue livré (décoré de ses tiers, comme `GET /api/cards`) :
// c'est sur le vrai catalogue que la couverture des recettes a un sens.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Card } from '../logic/types.js';
import { tierIndex, resolveTiers, hasTier } from '../logic/Tiers.js';
import { isSummonable, coverageOf } from '../logic/DeckCoverage.js';
import {
  DRAFT_SCHEDULE, DRAFT_REROLLS, OFFER_SIZE, RUN_WINS, RUN_LOSSES,
  newDraft, offerFor, pickCard, reroll, canReroll, recordResult, deckOf,
  autoDraft, currentOpponent, parseDraft, currentTier, type DraftState,
} from '../logic/Draft.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const read = (f: string) => JSON.parse(fs.readFileSync(path.join(ROOT, 'initial-data', f), 'utf8'));
const TIERS = tierIndex(read('attributes.json'));
const POOL = (read('cards.json') as Card[]).map(c => ({ ...c, _tiers: resolveTiers(c, TIERS) }));
const BY_ID = new Map(POOL.map(c => [c.id, c]));

/** Draft complet où le joueur prend toujours le premier emplacement. */
function draftFirst(seed: number): DraftState {
  let s = newDraft(seed);
  while (s.status === 'drafting') s = pickCard(s, offerFor(s, POOL)[0].card.id, POOL)!;
  return s;
}

describe('offre', () => {
  it('propose trois cartes distinctes du tier de l\'étape', () => {
    let s = newDraft(42);
    while (s.status === 'drafting') {
      const offer = offerFor(s, POOL);
      expect(offer).toHaveLength(OFFER_SIZE);
      expect(new Set(offer.map(o => o.card.id)).size).toBe(OFFER_SIZE);
      for (const o of offer) {
        expect(hasTier(o.card, currentTier(s)!)).toBe(true);
        expect(s.picks).not.toContain(o.card.id);
      }
      s = pickCard(s, offer[1].card.id, POOL)!;
    }
  });

  it('est une fonction de l\'état : même graine, même offre ; une relance la change', () => {
    const s = newDraft(7);
    expect(offerFor(s, POOL).map(o => o.card.id)).toEqual(offerFor(s, POOL).map(o => o.card.id));
    // L'ordre du catalogue ne compte pas.
    expect(offerFor(s, [...POOL].reverse()).map(o => o.card.id)).toEqual(offerFor(s, POOL).map(o => o.card.id));
    const r = reroll(s)!;
    expect(offerFor(r, POOL).map(o => o.card.id)).not.toEqual(offerFor(s, POOL).map(o => o.card.id));
  });

  it('annonce honnêtement chaque rôle', () => {
    for (let seed = 1; seed <= 20; seed++) {
      let s = newDraft(seed);
      while (s.status === 'drafting') {
        const cov = coverageOf(s.picks.map(id => BY_ID.get(id)!));
        for (const o of offerFor(s, POOL)) {
          const ok = isSummonable(o.card, cov.ids, cov.attrs);
          expect(ok).toBe(o.kind !== 'bet');
        }
        s = pickCard(s, offerFor(s, POOL)[2].card.id, POOL)!;
      }
    }
  });

  it('l\'emplacement complément vient chercher les matériaux d\'un pari', () => {
    // Sur 30 drafts qui prennent systématiquement le pari, au moins un pari
    // finit par devenir jouable grâce à un complément.
    let resolved = 0;
    for (let seed = 1; seed <= 30; seed++) {
      let s = newDraft(seed);
      let complements = 0;
      while (s.status === 'drafting') {
        const offer = offerFor(s, POOL);
        const c = offer.find(o => o.kind === 'complement');
        const pick = c ?? offer.find(o => o.kind === 'bet') ?? offer[0];
        if (c) complements++;
        s = pickCard(s, pick.card.id, POOL)!;
      }
      if (complements > 0) resolved++;
    }
    expect(resolved).toBeGreaterThan(0);
  });
});

describe('choix et relances', () => {
  it('refuse une carte absente de l\'offre', () => {
    const s = newDraft(3);
    const outside = POOL.find(c => hasTier(c, 1) && !offerFor(s, POOL).some(o => o.card.id === c.id))!;
    expect(pickCard(s, outside.id, POOL)).toBeNull();
  });

  it('borne les relances et passe en duels au 20ᵉ choix', () => {
    let s = newDraft(5);
    for (let i = 0; i < DRAFT_REROLLS; i++) s = reroll(s)!;
    expect(canReroll(s)).toBe(false);
    expect(reroll(s)).toBeNull();
    const done = draftFirst(5);
    expect(done.status).toBe('playing');
    expect(Object.values(deckOf(done)).flat()).toHaveLength(DRAFT_SCHEDULE.length);
    expect(deckOf(done)['5']).toHaveLength(2);
  });
});

describe('run', () => {
  it('s\'arrête à la 5ᵉ victoire ou à la 2ᵉ défaite', () => {
    let s = draftFirst(9);
    for (let i = 0; i < RUN_WINS - 1; i++) s = recordResult(s, 'win')!;
    expect(s.status).toBe('playing');
    expect(recordResult(s, 'win')!.status).toBe('won');
    let l = draftFirst(9);
    for (let i = 0; i < RUN_LOSSES; i++) l = recordResult(l, 'loss')!;
    expect(l.status).toBe('lost');
    expect(recordResult(l, 'win')).toBeNull();
  });

  it('pas de rapport pendant le draft', () => {
    expect(recordResult(newDraft(1), 'win')).toBeNull();
  });
});

describe('adversaires', () => {
  it('draftent un deck complet et jouable, déterministe à l\'index', () => {
    const s = draftFirst(11);
    const a = currentOpponent(s, POOL)!;
    expect(currentOpponent(s, POOL)!.deck).toEqual(a.deck);
    const ids = Object.values(a.deck).flat();
    expect(ids).toHaveLength(DRAFT_SCHEDULE.length);
    // L'IA prend une carte jouable dès qu'elle en a une : la très grande
    // majorité de son deck est invocable.
    const cards = ids.map(id => BY_ID.get(id)!);
    const cov = coverageOf(cards);
    const playable = cards.filter(c => isSummonable(c, cov.ids, cov.attrs)).length;
    expect(playable / cards.length).toBeGreaterThan(0.85);
    // L'adversaire suivant n'est pas le même.
    const b = currentOpponent(recordResult(s, 'win')!, POOL)!;
    expect(b.deck).not.toEqual(a.deck);
    expect(b.bonus.atk).toBeGreaterThan(a.bonus.atk);
  });

  it('autoDraft ne dépend que de sa graine', () => {
    expect(autoDraft(123, POOL)).toEqual(autoDraft(123, [...POOL].reverse()));
  });
});

describe('persistance', () => {
  it('relit un état sain et rejette le reste', () => {
    const s = draftFirst(2);
    expect(parseDraft(JSON.parse(JSON.stringify(s)))).toEqual(s);
    expect(parseDraft(null)).toBeNull();
    expect(parseDraft({ version: 2 })).toBeNull();
    expect(parseDraft({ ...s, status: 'bogus' })).toBeNull();
  });
});
