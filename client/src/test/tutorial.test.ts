/// <reference types="node" />
// Golden tests du mode tutoriel.
//
// La suite tourne en node pur, sans jsdom : aucun composant n'est donc
// testable. C'est exactement pourquoi toute la DÉCISION du tutoriel (quelle
// bulle, quand avancer, quelles cartes montrer, quel deck jouer) vit dans des
// fonctions pures — les composants ne font que les rendre.
//
// Le catalogue est lu depuis `initial-data/cards.json`, versionné et toujours
// présent (`data/` n'est créé qu'au démarrage du serveur). Un sélecteur du
// codex qui ne rendrait plus rien casse ici, plutôt qu'à l'écran d'un joueur.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CHAPTERS } from '../data/tutorialContent.js';
import {
  GAME_STEPS, advanceGameSteps, gameCoachStep, gameTutorialComplete,
  deckCoachStep, type GameCoachState, type DeckCoachState,
} from '../data/tutorialScript.js';
import { buildTutorialDecks } from '../game/tutorialDeck.js';
import type { Card } from '../logic/types.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const CARDS = JSON.parse(fs.readFileSync(path.join(ROOT, 'initial-data', 'cards.json'), 'utf8')) as Card[];

// ── Le codex ────────────────────────────────────────────────────────────────

describe('codex du tutoriel', () => {
  it('couvre les onze notions annoncées, sans doublon d\'identifiant', () => {
    expect(CHAPTERS).toHaveLength(11);
    expect(new Set(CHAPTERS.map(c => c.id)).size).toBe(11);
  });

  it('donne à chaque chapitre un titre, une accroche et du contenu', () => {
    for (const c of CHAPTERS) {
      expect(c.title.trim().length, c.id).toBeGreaterThan(0);
      expect(c.blurb.trim().length, c.id).toBeGreaterThan(0);
      expect(c.icon.trim().length, c.id).toBeGreaterThan(0);
      expect(c.blocks.length, c.id).toBeGreaterThan(0);
    }
  });

  // Le vrai garde-fou : les exemples sont des sélecteurs évalués sur le
  // catalogue réel. Une carte retirée depuis l'admin ne doit pas laisser un
  // chapitre avec une rangée de vignettes vide.
  it('résout chaque exemple de carte sur le catalogue réel', () => {
    let checked = 0;
    for (const chapter of CHAPTERS) {
      for (const block of chapter.blocks) {
        if (block.kind !== 'cards') continue;
        checked++;
        const picked = block.pick(CARDS);
        expect(picked.length, `${chapter.id} · ${block.caption ?? ''}`).toBeGreaterThan(0);
        for (const card of picked) expect(card.id).toBeTruthy();
      }
    }
    expect(checked).toBeGreaterThan(0);
  });

  it('rend des exemples stables d\'un appel à l\'autre', () => {
    for (const chapter of CHAPTERS) {
      for (const block of chapter.blocks) {
        if (block.kind !== 'cards') continue;
        expect(block.pick(CARDS).map(c => c.id)).toEqual(block.pick(CARDS).map(c => c.id));
      }
    }
  });

  it('illustre les cinq types d\'invocation dans le chapitre qui les enseigne', () => {
    const chapter = CHAPTERS.find(c => c.id === 'summoning')!;
    const types = chapter.blocks
      .filter(b => b.kind === 'cards')
      .flatMap(b => (b as { pick: (c: Card[]) => Card[] }).pick(CARDS))
      .map(c => c.summon_type ?? 'normal');
    for (const t of ['normal', 'sacrifice', 'fusion', 'heritage', 'transformation']) {
      expect(types, t).toContain(t);
    }
  });
});

// ── Le deck d'entraînement ──────────────────────────────────────────────────

describe('deck de la partie d\'entraînement', () => {
  it('est déterministe', () => {
    expect(buildTutorialDecks(CARDS)).toEqual(buildTutorialDecks(CARDS));
  });

  // Sans carte normale de tier 1, l'étape « place ta première unité » est un
  // cul-de-sac : rien dans la main n'est posable au tour 1.
  it('donne au joueur des cartes de tier 1 invocables normalement', () => {
    const { player } = buildTutorialDecks(CARDS);
    const byId = new Map(CARDS.map(c => [c.id, c]));
    const tier1 = player['1'].map(id => byId.get(id)!);
    expect(tier1.length).toBeGreaterThan(0);
    expect(tier1.every(c => (c.summon_type ?? 'normal') === 'normal')).toBe(true);
  });

  it('remplit les cinq tiers des deux côtés, sans doublon', () => {
    const { player, enemy } = buildTutorialDecks(CARDS);
    for (const [side, deck] of [['joueur', player], ['ia', enemy]] as const) {
      for (let t = 1; t <= 5; t++) {
        const ids = deck[String(t)];
        expect(ids.length, `${side} tier ${t}`).toBeGreaterThan(0);
        expect(new Set(ids).size, `${side} tier ${t}`).toBe(ids.length);
      }
    }
  });

  // Le catalogue n'a presque aucune carte NORMALE au-delà du tier 2 : les hauts
  // tiers se paient en matériaux. Un deck qui embarquerait une fusion sans ses
  // matériaux remplirait la main des derniers tours de cartes mortes.
  it('n\'emporte en haut de courbe que des cartes réellement invocables', () => {
    const byId = new Map(CARDS.map(c => [c.id, c]));
    for (const deck of Object.values(buildTutorialDecks(CARDS))) {
      const ids = new Set<string>();
      const attrs = new Set<string>();
      for (let t = 1; t <= 5; t++) {
        for (const id of deck[String(t)]) {
          const card = byId.get(id)!;
          const costs = card.summon_options?.length ? card.summon_options.map(o => o.cost) : [card.cost];
          const ok = costs.some(cost => (cost?.materials ?? []).every(m => ids.has(m) || attrs.has(m)));
          expect(ok, `${card.name} (${id}) exige des matériaux absents du deck`).toBe(true);
        }
        // La couverture ne s'ouvre qu'après le tier : une carte ne peut pas être
        // son propre matériau.
        for (const id of deck[String(t)]) {
          const card = byId.get(id)!;
          ids.add(card.id);
          for (const a of card.attributes ?? []) attrs.add(a);
        }
      }
    }
  });

  it('laisse à l\'IA un deck plus maigre que celui du joueur', () => {
    const { player, enemy } = buildTutorialDecks(CARDS);
    const count = (d: Record<string, string[]>) => Object.values(d).reduce((n, ids) => n + ids.length, 0);
    expect(count(enemy)).toBeLessThan(count(player));
  });

  it('ne rend pas de deck cassé sur un catalogue vide', () => {
    const { player, enemy } = buildTutorialDecks([]);
    for (let t = 1; t <= 5; t++) {
      expect(player[String(t)]).toEqual([]);
      expect(enemy[String(t)]).toEqual([]);
    }
  });
});

// ── Le script de la partie guidée ───────────────────────────────────────────

const FRESH: GameCoachState = {
  round: 1, placedCount: 0, handSelected: false, synergyCount: 0,
  combatActive: false, hasEndRound: false, shopping: false, gameOver: false,
  roundOpening: false,
};

/** Rejoue une transition d'état comme le fait le coach : avancer, puis lire. */
function step(state: GameCoachState, seen: ReadonlySet<string>) {
  const next = advanceGameSteps(state, seen);
  return { seen: next, current: gameCoachStep(state, next)?.id ?? null };
}

describe('script de la partie guidée', () => {
  it('ouvre sur la main', () => {
    expect(step(FRESH, new Set()).current).toBe('hand');
  });

  it('déroule la boucle complète dans l\'ordre', () => {
    let seen: ReadonlySet<string> = new Set();
    const seq: (string | null)[] = [];

    const push = (state: GameCoachState) => {
      const r = step(state, seen);
      seen = r.seen;
      seq.push(r.current);
    };

    push(FRESH);                                                          // main
    push({ ...FRESH, handSelected: true });                               // placer
    push({ ...FRESH, placedCount: 1 });                                   // placer une 2e
    push({ ...FRESH, placedCount: 2, synergyCount: 2 });                  // synergies (tap)
    seen = new Set(seen).add('synergies');
    push({ ...FRESH, placedCount: 2, synergyCount: 2 });                  // prêt
    push({ ...FRESH, placedCount: 2, combatActive: true });               // combat
    push({ ...FRESH, hasEndRound: true });                                // dégâts
    push({ ...FRESH, shopping: true });                                   // magie
    push({ ...FRESH, round: 2 });                                         // tour 2 (tap)

    expect(seq).toEqual([
      'hand', 'place', 'place_second', 'synergies',
      'ready', 'combat', 'damage', 'shopping', 'next_round',
    ]);

    // Le tap final solde le script : la partie d'entraînement est faite.
    expect(gameTutorialComplete(seen)).toBe(false);
    seen = new Set(seen).add('next_round');
    expect(gameTutorialComplete(seen)).toBe(true);
  });

  // Le point critique : le script lit un état qui change tout le temps. Une
  // étape franchie ne doit jamais se rejouer parce que sa condition redevient
  // fausse (une carte désélectionnée, un combat terminé…).
  it('ne revient jamais en arrière quand une condition se retourne', () => {
    const placed = { ...FRESH, handSelected: true, placedCount: 2, synergyCount: 2 };
    const seen = advanceGameSteps(placed, new Set());
    expect(gameCoachStep(placed, seen)?.id).toBe('synergies');

    // La main se vide, le board se vide : le coach reste sur l'étape atteinte
    // au lieu de renvoyer le joueur à « choisis une carte ».
    const reverted = { ...FRESH, synergyCount: 2 };
    const after = advanceGameSteps(reverted, seen);
    expect(gameCoachStep(reverted, after)?.id).toBe('synergies');
  });

  it('saute l\'étape des synergies quand le board n\'en produit aucune', () => {
    const seen = advanceGameSteps({ ...FRESH, placedCount: 2, synergyCount: 0 }, new Set());
    expect(gameCoachStep({ ...FRESH, placedCount: 2 }, seen)?.id).toBe('ready');
  });

  it('ne retient pas un joueur qui lance le combat sans lire', () => {
    const seen = advanceGameSteps({ ...FRESH, placedCount: 2, synergyCount: 3, combatActive: true }, new Set());
    expect(seen.has('synergies')).toBe(true);
    expect(seen.has('ready')).toBe(true);
  });

  it('résout l\'étape magie même sans Phase Shopping', () => {
    // Pas de magie tirée : on passe directement au tour 2.
    let seen: ReadonlySet<string> = new Set(['hand', 'place', 'place_second', 'synergies', 'ready', 'combat']);
    seen = advanceGameSteps({ ...FRESH, round: 2 }, seen);
    expect(seen.has('damage')).toBe(true);
    expect(seen.has('shopping')).toBe(true);
    expect(gameCoachStep({ ...FRESH, round: 2 }, seen)?.id).toBe('next_round');
  });

  it('ne montre les étapes conditionnelles qu\'au bon moment', () => {
    const seen = new Set(['hand', 'place', 'place_second', 'synergies', 'ready', 'combat', 'damage']);
    // L'étape magie est courante, mais il n'y a pas de Phase Shopping à l'écran.
    expect(gameCoachStep(FRESH, seen)).toBeNull();
    expect(gameCoachStep({ ...FRESH, shopping: true }, seen)?.id).toBe('shopping');
  });

  it('garde la bulle finale pour la fin de partie', () => {
    const seen = new Set(GAME_STEPS.map(s => s.id).filter(id => id !== 'done'));
    expect(gameCoachStep({ ...FRESH, round: 3 }, seen)).toBeNull();
    expect(gameCoachStep({ ...FRESH, round: 5, gameOver: true }, seen)?.id).toBe('done');
  });

  // C'est ce booléen qui gèle les chronos de préparation, de shopping et de
  // récapitulatif de round : il ne doit être vrai que sur les étapes à tap.
  it('ne bloque les chronos que sur les étapes qui attendent un tap', () => {
    const blocking = GAME_STEPS.filter(s => s.blocking).map(s => s.id);
    expect(blocking).toEqual(['synergies', 'next_round', 'done']);
  });
});

// ── Le script du DeckBuilder ────────────────────────────────────────────────

const DECK_BASE: DeckCoachState = {
  total: 0,
  perTier: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
  tierMax: { 1: 8, 2: 8, 3: 8, 4: 8, 5: 8 },
  name: '',
  tab: 'lib',
  valid: false,
  minDeck: 20,
};

describe('script du DeckBuilder guidé', () => {
  it('oriente vers le tier 1 sur un deck vide', () => {
    expect(deckCoachStep(DECK_BASE)?.id).toBe('start');
  });

  it('réclame d\'abord un socle de tier 1, puis de tier 2', () => {
    const t1 = deckCoachStep({ ...DECK_BASE, total: 2, perTier: { ...DECK_BASE.perTier, 1: 2 } });
    expect(t1?.id).toBe('tier1');
    expect(t1?.title).toContain('2/8');

    const t2 = deckCoachStep({ ...DECK_BASE, total: 6, perTier: { ...DECK_BASE.perTier, 1: 6 } });
    expect(t2?.id).toBe('tier2');
  });

  it('annonce le nombre de cartes restantes', () => {
    const s = deckCoachStep({
      ...DECK_BASE, total: 14,
      perTier: { 1: 8, 2: 6, 3: 0, 4: 0, 5: 0 },
    });
    expect(s?.id).toBe('fill');
    expect(s?.title).toContain('6');
  });

  it('renvoie vers l\'onglet Deck une fois le compte atteint', () => {
    const filled = { ...DECK_BASE, total: 20, perTier: { 1: 8, 2: 6, 3: 6, 4: 0, 5: 0 } };
    expect(deckCoachStep(filled)?.id).toBe('go_deck');
    expect(deckCoachStep({ ...filled, tab: 'deck' })?.id).toBe('name');
  });

  it('conclut sur l\'enregistrement quand le deck est valide', () => {
    const s = deckCoachStep({
      ...DECK_BASE, total: 20, perTier: { 1: 8, 2: 6, 3: 6, 4: 0, 5: 0 },
      name: 'Mon deck', tab: 'deck', valid: true,
    });
    expect(s?.id).toBe('save');
    expect(s?.text).toContain('deck actif');
  });

  // Un pool de tier plus petit que la cible ne doit pas laisser le guide
  // réclamer indéfiniment des cartes qui n'existent pas.
  it('respecte un plafond de tier plus bas que la cible', () => {
    const s = deckCoachStep({
      ...DECK_BASE, total: 3,
      perTier: { ...DECK_BASE.perTier, 1: 3 },
      tierMax: { ...DECK_BASE.tierMax, 1: 3 },
    });
    expect(s?.id).not.toBe('tier1');
  });

  it('revient en arrière si le joueur retire des cartes', () => {
    const full = { ...DECK_BASE, total: 20, perTier: { 1: 8, 2: 6, 3: 6, 4: 0, 5: 0 }, tab: 'deck' as const };
    expect(deckCoachStep(full)?.id).toBe('name');
    expect(deckCoachStep({ ...full, total: 18, perTier: { ...full.perTier, 3: 4 } })?.id).toBe('fill');
  });
});
