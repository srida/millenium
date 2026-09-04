/* eslint-disable @typescript-eslint/no-explicit-any */
// Le RÉSUMÉ DE PIOCHE rendu par `GameSession.startPreparation()` — ce que la
// popup de pioche annonce au joueur à l'ouverture de chaque tour.
//
// Deux familles d'invariants, et elles ne protègent pas de la même chose :
//   1. le résumé ne peut pas CONTREDIRE la main (`drawnCount` est mesuré) ni le
//      crédit (`sum(sources) === extraDraws`) ;
//   2. le résumé ne CONSOMME rien — ni hasard, ni état. La popup révèle, elle
//      ne pioche pas : le tirage a déjà eu lieu quand le résumé est rendu.
//
// ⚠️ Chaque cas est ÉPROUVÉ DANS LES DEUX SENS : la mutation qui doit le faire
// tomber est nommée dans son commentaire. Un test qui passerait aussi sur la
// régression ne vaut rien, et c'est invérifiable après coup.
import { describe, it, expect } from 'vitest';
import { GameSession } from '../logic/GameSession.js';
import type { GameSessionDeps } from '../logic/GameSession.js';
import { applyEffect as applyMagieEffect } from '../logic/MagieEffect.js';
import { applyBoardEffects } from '../logic/BoardEffect.js';
import { AttributeManager } from '../logic/AttributeManager.js';
import { Unit } from '../logic/Unit.js';
import { makeRandom, hashSeed } from '../logic/Random.js';
import { makeCard } from './helpers.js';
import { drawBonusRows, drawnLabel, guaranteedDrawLabel } from '../data/DrawInfo.js';

const HAND_SIZE = 5;

function makeSession(opts: { cards?: any[]; rand?: () => number; attributes?: any[] } = {}) {
  const cards = opts.cards ?? [
    makeCard({ id: 'T1', tier: 1, summon_conditions: [] }),
    makeCard({ id: 'T2', tier: 2, summon_conditions: [] }),
    makeCard({ id: 'T3', tier: 3, summon_conditions: [] })
  ];
  const byId = new Map(cards.map(c => [c.id, c]));
  const byTier: Record<number, any[]> = {};
  for (const c of cards) (byTier[c.tier ?? 1] ??= []).push(c);
  const deps: GameSessionDeps = {
    cardsByTier: byTier,
    enemyDeck: {},
    attributeList: opts.attributes ?? [],
    cardDb: { getCard: (id: string) => (byId.get(id) as any) ?? null },
    getAllBoards: () => [],
    getAllMagies: () => [],
    rand: opts.rand
  };
  return new GameSession(deps);
}

describe('DrawSummary — ce que le tour a donné', () => {
  it('annonce le tour, ses tiers et la pioche de base', () => {
    const s = makeSession();
    const draw = s.startPreparation();
    expect(draw.round).toBe(1);
    expect(draw.tiers).toEqual([1]);           // T1 seul au round 1
    expect(draw.baseCount).toBe(HAND_SIZE);
    expect(draw.extraDraws).toBe(0);
    expect(draw.guaranteed).toEqual([]);
    expect(draw.sources).toEqual([]);
  });

  // Rouge si `drawnCount` est recalculé (`baseCount + extraDraws`) au lieu
  // d'être mesuré : un pool VIDE ne rend rien, et la soustraction annoncerait
  // cinq cartes sur une main restée à zéro.
  it('drawnCount est MESURÉ : un pool vide donne 0, pas 5', () => {
    const s = makeSession({ cards: [] });
    const draw = s.startPreparation();
    expect(draw.baseCount).toBe(HAND_SIZE);
    expect(draw.drawnCount).toBe(0);
    expect(s.hand.length).toBe(0);
  });

  it('drawnCount vaut exactement ce qui est entré en main', () => {
    const s = makeSession();
    const draw = s.startPreparation();
    expect(draw.drawnCount).toBe(HAND_SIZE);
    expect(draw.handSizeAfter).toBe(s.hand.length);
  });

  // La main s'ACCUMULE entre les tours : `drawnCount` doit parler du tour, pas
  // de la main. Rouge si le résumé rendait `hand.length`.
  it('sur un tour suivant, drawnCount ne compte QUE la pioche du tour', () => {
    const s = makeSession();
    s.startPreparation();                       // 5 cartes
    const draw = s.startNextRound()!;           // 5 de plus
    expect(draw.drawnCount).toBe(HAND_SIZE);
    expect(draw.handSizeAfter).toBe(2 * HAND_SIZE);
    expect(draw.round).toBe(2);
    expect(draw.tiers).toEqual([1, 2]);
  });

  it('la partie finie ne rend aucun résumé : il n\'y a rien à annoncer', () => {
    const s = makeSession();
    s.startPreparation();
    s.gameState.player_hp = 0;                  // fin de partie au prochain tour
    expect(s.startNextRound()).toBeNull();
  });
});

describe('DrawSummary — les bonus, et leur provenance', () => {
  // L'INVARIANT central : le registre et le compteur décrivent le même octroi.
  // Rouge dès qu'un émetteur crédite `player_extra_draws` sans s'inscrire — le
  // cas exact où la popup annoncerait un « +2 » venu de nulle part.
  it('la somme du registre vaut TOUJOURS extraDraws', () => {
    const s = makeSession();
    applyMagieEffect({ id: 'MAGIC_A', name: 'A', effect: { type: 'draw_bonus', value: 2 } } as any, { gameState: s.gameState });
    applyBoardEffects({ id: 'BOARD_1', name: 'B', effects: [{ type: 'draw_bonus', value: 1 }] } as any, { gameState: s.gameState });

    const draw = s.startPreparation();
    expect(draw.extraDraws).toBe(3);
    expect(draw.sources.reduce((n, x) => n + x.value, 0)).toBe(draw.extraDraws);
    expect(draw.drawnCount).toBe(HAND_SIZE + 3);
  });

  it('chaque source est NOMMÉE par son id', () => {
    const s = makeSession();
    applyMagieEffect({ id: 'MAGIC_A', name: 'A', effect: { type: 'draw_bonus', value: 2 } } as any, { gameState: s.gameState });
    applyBoardEffects({ id: 'BOARD_1', name: 'B', effects: [{ type: 'draw_bonus', value: 1 }] } as any, { gameState: s.gameState });

    const draw = s.startPreparation();
    expect(draw.sources).toEqual([
      { kind: 'magie', ref: 'MAGIC_A', value: 2 },
      { kind: 'terrain', ref: 'BOARD_1', value: 1 }
    ]);
  });

  // L'attribut inscrit ce qu'il a RÉELLEMENT crédité, plafond `max` déjà
  // appliqué. Rouge si l'inscription lit `effect.value` : le registre
  // annoncerait +3 pour un crédit de 1.
  it('un attribut plafonné inscrit le crédit RÉEL, pas ce qu\'il demandait', () => {
    const attr = {
      id: 'ARCH_D', name: 'Pioche', timing: 'end_of_combat',
      thresholds: [{ count: 1, effects: [{ type: 'draw_bonus', value: 3, max: 1 }] }] };
    const u = new (Unit as any)(makeCard({ id: 'T1', tier: 1, attributes: ['ARCH_D'] }), 'player');
    const mgr = new (AttributeManager as any)([attr], [u], []);
    const result = mgr.applyEndOfCombat([], []);

    expect(result.draw_bonus).toBe(1);
    expect(result.draw_sources).toEqual([{ kind: 'attribut', ref: 'ARCH_D', value: 1 }]);
  });

  // Une pioche GARANTIE occupe un slot de la main normale, elle n'en ajoute
  // pas : elle s'inscrit à `value: 0`. Rouge si elle comptait pour 1 — la somme
  // du registre dépasserait alors `extraDraws`.
  it('une pioche garantie s\'inscrit à 0 et ne gonfle pas la main', () => {
    const s = makeSession();
    applyMagieEffect({ id: 'MAGIC_G', name: 'G', effect: { type: 'guaranteed_draw', tier: 2 } } as any, { gameState: s.gameState });

    const draw = s.startPreparation();
    expect(draw.guaranteed).toEqual([{ tier: 2, category: undefined }]);
    expect(draw.extraDraws).toBe(0);
    expect(draw.sources.reduce((n, x) => n + x.value, 0)).toBe(0);
    expect(draw.drawnCount).toBe(HAND_SIZE);
  });

  // Rouge si le registre n'est pas vidé en même temps que le compteur : le tour
  // suivant réafficherait le bonus du tour précédent, sans carte en face.
  it('le registre se VIDE avec le compteur, pas un tour plus tard', () => {
    const s = makeSession();
    applyMagieEffect({ id: 'MAGIC_A', name: 'A', effect: { type: 'draw_bonus', value: 2 } } as any, { gameState: s.gameState });

    expect(s.startPreparation().sources).toHaveLength(1);
    const next = s.startNextRound()!;
    expect(next.sources).toEqual([]);
    expect(next.extraDraws).toBe(0);
    expect(next.drawnCount).toBe(HAND_SIZE);
  });
});

describe('DrawSummary — le résumé ne consomme rien', () => {
  // ⚠️ Le filet le plus important du lot. Un résumé qui tirerait quoi que ce
  // soit (ne serait-ce qu'un `rand()` pour une prévisualisation) décalerait
  // TOUTES les pioches et tous les choix d'IA qui suivent — donc le flux semé
  // de `sim/` et le déterminisme PvP. Rouge au premier appel de trop.
  it('la pioche d\'un tour consomme exactement HAND_SIZE appels à rand', () => {
    let calls = 0;
    const seeded = makeRandom(hashSeed('draw-summary'));
    const counting = () => { calls += 1; return seeded(); };
    const s = makeSession({ rand: counting });

    s.startPreparation();
    expect(calls).toBe(HAND_SIZE);
  });

  it('deux sessions de même graine piochent la même main', () => {
    const a = makeSession({ rand: makeRandom(hashSeed('même-graine')) });
    const b = makeSession({ rand: makeRandom(hashSeed('même-graine')) });
    a.startPreparation();
    b.startPreparation();
    expect(a.hand.map((c: any) => c.id)).toEqual(b.hand.map((c: any) => c.id));
  });
});

describe('DrawInfo — la pioche mise en mots', () => {
  it('fond les entrées de même source, jamais un bonus avec une garantie', () => {
    const rows = drawBonusRows({
      sources: [
        { kind: 'attribut', ref: 'ARCH_D', value: 1 },
        { kind: 'attribut', ref: 'ARCH_D', value: 1 },
        { kind: 'attribut', ref: 'ARCH_D', value: 0, guaranteed: true },
        { kind: 'magie', ref: 'MAGIC_A', value: 2 }
      ] } as any);
    expect(rows.map(r => [r.kind, r.ref, r.amount, r.guaranteed])).toEqual([
      ['attribut', 'ARCH_D', 2, false],
      ['attribut', 'ARCH_D', 0, true],
      ['magie', 'MAGIC_A', 2, false]
    ]);
  });

  it('accorde le chiffre annoncé, et n\'annonce que ce qui est entré en main', () => {
    expect(drawnLabel({ drawnCount: 1 } as any)).toBe('1 carte');
    expect(drawnLabel({ drawnCount: 6 } as any)).toBe('6 cartes');
    // ⚠️ `drawnCount`, jamais `baseCount + extraDraws` : ici la main n'a rien reçu.
    expect(drawnLabel({ drawnCount: 0, baseCount: 5, extraDraws: 2 } as any)).toBe('0 cartes');
  });

  // ⚠️ Le filtre `category` (la voie d'invocation) a disparu : les voies sont
  // devenues des attributs, et `attribute` les nomme déjà. Un second filtre
  // aurait voulu dire deux façons d'exprimer la même exigence.
  it('dit le filtre d\'une pioche garantie, les deux champs se cumulant', () => {
    expect(guaranteedDrawLabel({ tier: 3 })).toBe('Tier 3');
    expect(guaranteedDrawLabel({ attribute: 'ARCH_D' }, () => 'Dragons')).toBe('Dragons');
    expect(guaranteedDrawLabel({ tier: 5, attribute: 'ARCH_086' }, () => 'Fusion'))
      .toBe('Tier 5 · Fusion');
    expect(guaranteedDrawLabel({})).toBe('Au choix');
  });
});
