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
  DRAFT_STEPS, DRAFT_SIZE, DRAFT_REROLLS, OFFER_SIZE, RUN_WINS, RUN_LOSSES,
  newDraft, offerFor, pickCards, reroll, canReroll, recordResult, deckOf,
  autoDraft, currentOpponent, currentStep, isLinkedBundle, laneTier, type DraftState,
  pendingBonus, stepOf, BONUS_STEP,
} from '../logic/Draft.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const read = (f: string) => JSON.parse(fs.readFileSync(path.join(ROOT, 'initial-data', f), 'utf8'));
const TIERS = tierIndex(read('attributes.json'));
const POOL = (read('cards.json') as Card[]).map(c => ({ ...c, _tiers: resolveTiers(c, TIERS) }));
const BY_ID = new Map(POOL.map(c => [c.id, c]));

const ids = (slot: { cards: Card[] }) => slot.cards.map(c => c.id);
const take = (s: DraftState, i: number) => pickCards(s, ids(offerFor(s, POOL)[i]), POOL)!;

/** Un duel soldé, puis la carte de plus s'il en est une due (premier choix). */
function duel(s: DraftState, result: 'win' | 'loss'): DraftState {
  const next = recordResult(s, result)!;
  return pendingBonus(next) ? take(next, 0) : next;
}

/** Draft complet où le joueur prend toujours le premier emplacement. */
function draftFirst(seed: number): DraftState {
  let s = newDraft(seed);
  while (s.status === 'drafting') s = take(s, 0);
  return s;
}

describe('étapes', () => {
  it('trois lots de trois, puis six cartes : 15 en tout', () => {
    expect(DRAFT_STEPS.slice(0, 3).every(st => st.cards === 3 && st.tier == null)).toBe(true);
    expect(DRAFT_STEPS.slice(3).every(st => st.cards === 1 && st.tier != null)).toBe(true);
    expect(DRAFT_STEPS.slice(3)).toHaveLength(6);
    expect(DRAFT_SIZE).toBe(15);
  });
});

describe('offre', () => {
  it('propose trois lots liés et disjoints, puis trois cartes distinctes du tier de l\'étape', () => {
    for (let seed = 1; seed <= 40; seed++) {
      let s = newDraft(seed);
      while (s.status === 'drafting') {
        const step = currentStep(s)!.step;
        const offer = offerFor(s, POOL);
        expect(offer).toHaveLength(OFFER_SIZE);
        const all = offer.flatMap(ids);
        expect(new Set(all).size).toBe(all.length);
        for (const o of offer) {
          expect(o.cards).toHaveLength(step.cards);
          for (const c of o.cards) expect(s.picks).not.toContain(c.id);
          if (step.tier == null) {
            expect(o.kind).toBe('bundle');
            // Le verdict que le serveur rejoue.
            expect(isLinkedBundle(o.cards)).toBe(true);
            expect(new Set(o.cards.map(laneTier)).size).toBeGreaterThan(1);
          } else {
            expect(hasTier(o.cards[0], step.tier)).toBe(true);
          }
        }
        s = take(s, seed % OFFER_SIZE);
      }
      expect(s.picks).toHaveLength(DRAFT_SIZE);
    }
  });

  it('un lot dit honnêtement ce qui reste à compléter', () => {
    let s = newDraft(8);
    for (const o of offerFor(s, POOL)) {
      const cov = coverageOf(o.cards);
      expect(o.missing).toBe(o.cards.filter(c => !isSummonable(c, cov.ids, cov.attrs)).length);
    }
    s = take(s, 0);
    expect(s.picks).toHaveLength(3);
  });

  it('un lot non lié, ou de tiers tous égaux, n\'en est pas un', () => {
    const t1 = POOL.filter(c => laneTier(c) === 1 && !(c.summon_conditions ?? []).length).slice(0, 3);
    expect(isLinkedBundle(t1)).toBe(false);
    const linked = offerFor(newDraft(2), POOL)[0].cards;
    expect(isLinkedBundle(linked)).toBe(true);
    expect(isLinkedBundle([linked[0], linked[1], t1[0]])).toBe(t1[0] && isLinkedBundle([linked[0], t1[0]]));
  });

  it('est une fonction de l\'état : même graine, même offre ; une relance la change', () => {
    let s = newDraft(7);
    const flat = (st: DraftState, pool = POOL) => offerFor(st, pool).flatMap(ids);
    // Sur une étape de lot puis sur une étape d'une carte.
    for (let step = 0; step < 2; step++) {
      expect(flat(s)).toEqual(flat(s));
      // L'ordre du catalogue ne compte pas.
      expect(flat(s, [...POOL].reverse())).toEqual(flat(s));
      expect(flat(reroll(s)!)).not.toEqual(flat(s));
      while (currentStep(s)!.step.tier == null) s = take(s, 0);
    }
  });

  it('annonce honnêtement chaque rôle', () => {
    for (let seed = 1; seed <= 20; seed++) {
      let s = newDraft(seed);
      while (s.status === 'drafting') {
        const cov = coverageOf(s.picks.map(id => BY_ID.get(id)!));
        for (const o of offerFor(s, POOL)) {
          if (o.kind === 'bundle') continue;
          const ok = isSummonable(o.cards[0], cov.ids, cov.attrs);
          expect(ok).toBe(o.kind !== 'bet');
        }
        s = take(s, 2);
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
        s = pickCards(s, ids(pick), POOL)!;
      }
      if (complements > 0) resolved++;
    }
    expect(resolved).toBeGreaterThan(0);
  });
});

describe('choix et relances', () => {
  it('refuse un choix absent de l\'offre, ou un lot incomplet', () => {
    const s = newDraft(3);
    const offer = offerFor(s, POOL);
    expect(pickCards(s, ids(offer[0]).slice(0, 2), POOL)).toBeNull();
    expect(pickCards(s, [ids(offer[0])[0], ids(offer[1])[1], ids(offer[2])[2]], POOL)).toBeNull();
    // L'ordre des cartes d'un lot ne compte pas.
    expect(pickCards(s, [...ids(offer[1])].reverse(), POOL)!.picks).toHaveLength(3);
    let single = s;
    while (currentStep(single)!.step.tier == null) single = take(single, 0);
    const outside = POOL.find(c => hasTier(c, 1) && !single.picks.includes(c.id)
      && !offerFor(single, POOL).some(o => o.cards[0].id === c.id))!;
    expect(pickCards(single, [outside.id], POOL)).toBeNull();
  });

  it('borne les relances et passe en duels au dernier choix', () => {
    let s = newDraft(5);
    for (let i = 0; i < DRAFT_REROLLS; i++) s = reroll(s)!;
    expect(canReroll(s)).toBe(false);
    expect(reroll(s)).toBeNull();
    const done = draftFirst(5);
    expect(done.status).toBe('playing');
    const deck = deckOf(done, POOL);
    expect(Object.values(deck).flat()).toHaveLength(DRAFT_SIZE);
    // Chaque carte est rangée à son plus bas tier.
    for (const [t, list] of Object.entries(deck)) for (const id of list) expect(laneTier(BY_ID.get(id)!)).toBe(Number(t));
  });
});

describe('run', () => {
  it('s\'arrête à la 5ᵉ victoire ou à la 2ᵉ défaite', () => {
    let s = draftFirst(9);
    for (let i = 0; i < RUN_WINS - 1; i++) s = duel(s, 'win');
    expect(s.status).toBe('playing');
    expect(recordResult(s, 'win')!.status).toBe('won');
    let l = draftFirst(9);
    for (let i = 0; i < RUN_LOSSES; i++) l = duel(l, 'loss');
    expect(l.status).toBe('lost');
    expect(recordResult(l, 'win')).toBeNull();
  });

  it('pas de rapport pendant le draft', () => {
    expect(recordResult(newDraft(1), 'win')).toBeNull();
  });
});

describe('carte de plus entre deux duels', () => {
  it('est due après un duel qui ne clôt pas la run, victoire ou défaite', () => {
    const s = draftFirst(21);
    expect(pendingBonus(s)).toBe(false);
    for (const result of ['win', 'loss'] as const) {
      const after = recordResult(s, result)!;
      expect(after.status).toBe('playing');
      expect(pendingBonus(after)).toBe(true);
      expect(stepOf(after)?.step).toEqual(BONUS_STEP);
      // Pas de duel tant qu'elle n'est pas prise.
      expect(recordResult(after, 'win')).toBeNull();
      const taken = take(after, 0);
      expect(taken.picks).toHaveLength(DRAFT_SIZE + 1);
      expect(pendingBonus(taken)).toBe(false);
      expect(taken.status).toBe('playing');
    }
  });

  it('n\'est pas due quand le duel clôt la run', () => {
    let won = draftFirst(22);
    for (let i = 0; i < RUN_WINS - 1; i++) won = duel(won, 'win');
    won = recordResult(won, 'win')!;
    expect(won.status).toBe('won');
    expect(pendingBonus(won)).toBe(false);
    let lost = draftFirst(22);
    for (let i = 0; i < RUN_LOSSES; i++) lost = duel(lost, 'loss');
    expect(lost.status).toBe('lost');
    expect(stepOf(lost)).toBeNull();
    // Une vie rachetée remet la run en jeu : la carte du duel perdu est due.
    expect(pendingBonus({ ...lost, status: 'playing' })).toBe(true);
  });

  it('propose trois cartes de TOUS tiers, hors deck, et se relance', () => {
    const seen = new Set<number>();
    for (let seed = 30; seed < 50; seed++) {
      const s = recordResult(draftFirst(seed), 'win')!;
      const offer = offerFor(s, POOL);
      expect(offer).toHaveLength(OFFER_SIZE);
      for (const slot of offer) {
        expect(slot.cards).toHaveLength(1);
        expect(s.picks).not.toContain(slot.cards[0].id);
        for (const t of BY_ID.get(slot.cards[0].id)!._tiers ?? []) seen.add(t);
      }
      expect(canReroll(s)).toBe(true);
      expect(offerFor(reroll(s)!, POOL).flatMap(ids)).not.toEqual(offer.flatMap(ids));
    }
    expect(seen.size).toBeGreaterThan(2);
  });
});

describe('adversaires', () => {
  it('draftent un deck complet et jouable, déterministe à l\'index', () => {
    const s = draftFirst(11);
    const a = currentOpponent(s, POOL)!;
    expect(currentOpponent(s, POOL)!.deck).toEqual(a.deck);
    const deckIds = Object.values(a.deck).flat();
    expect(deckIds).toHaveLength(DRAFT_SIZE);
    // L'IA prend une carte jouable dès qu'elle en a une : la très grande
    // majorité de son deck est invocable.
    const cards = deckIds.map(id => BY_ID.get(id)!);
    const cov = coverageOf(cards);
    const playable = cards.filter(c => isSummonable(c, cov.ids, cov.attrs)).length;
    expect(playable / cards.length).toBeGreaterThan(0.85);
    // L'adversaire suivant n'est pas le même, et il a drafté sa carte de plus
    // comme le joueur : même taille de deck.
    const after = duel(s, 'win');
    const b = currentOpponent(after, POOL)!;
    expect(b.deck).not.toEqual(a.deck);
    expect(Object.values(b.deck).flat()).toHaveLength(after.picks.length);
    expect(new Set(Object.values(b.deck).flat()).size).toBe(after.picks.length);
  });

  it('autoDraft ne dépend que de sa graine', () => {
    expect(autoDraft(123, POOL)).toEqual(autoDraft(123, [...POOL].reverse()));
  });
});

describe('vie rachetée', () => {
  it('tolère une défaite de plus', () => {
    let s = draftFirst(4);
    for (let i = 0; i < RUN_LOSSES - 1; i++) s = duel(s, 'loss');
    const bought = { ...s, extra_life: true };
    expect(recordResult(s, 'loss')!.status).toBe('lost');
    expect(recordResult(bought, 'loss')!.status).toBe('playing');
  });
});
