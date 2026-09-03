/* eslint-disable @typescript-eslint/no-explicit-any */
// Golden tests de `logic/BoardEffect` — les deux choses qu'un terrain sait
// faire de neuf : viser une VOIE D'INVOCATION, et CUMULER plusieurs effets.
//
// ⚠️ Chaque cas est ÉPROUVÉ DANS LES DEUX SENS : vert sur la règle actuelle,
// ROUGE quand on réintroduit exprès le comportement d'avant. La mutation qui
// doit faire tomber chaque test est nommée dans son commentaire — un test qui
// passerait aussi sur la régression ne vaut rien, et c'est invérifiable après
// coup.
import { describe, it, expect } from 'vitest';
import { boardEffects, effectTargets, applyEffect, applyBoardEffects } from '../logic/BoardEffect.js';
import { GameState } from '../logic/GameState.js';
import { Unit, summonKey } from '../logic/Unit.js';
import { makeCard } from './helpers.js';
import type { BoardDef } from '../logic/types.js';

function unit(over: { id?: string; attributes?: string[]; summon_type?: string; multi?: boolean; hp?: number } = {}): Unit {
  const card = makeCard({
    id: over.id, attributes: over.attributes ?? [], summon_type: over.summon_type ?? 'normal',
    stats: { hp: over.hp ?? 30 } as any,
    ...(over.multi ? { summon_options: [{ summon_type: 'heritage' }, { summon_type: 'fusion' }] } : {}),
  });
  return new (Unit as any)(card, 'player');
}

const STAT = (over: any = {}) => ({ type: 'stat_bonus', stat: 'atk', value: 10, ...over });

describe('boardEffects — le seul lecteur de la donnée', () => {
  it('rend la liste `effects` quand elle porte quelque chose', () => {
    const board = { id: 'B', name: 'B', effects: [STAT(), { type: 'shield', value: 20 }] } as any as BoardDef;
    expect(boardEffects(board).map(e => e.type)).toEqual(['stat_bonus', 'shield']);
  });

  // ⚠️ La règle qui dispense de toute migration : les 14 terrains livrés — et
  // `data/boards.json` sur le volume, que `bootstrap()` ne recopie jamais —
  // sont encore en `effect`.
  // Mutation : repli sur `effect` retiré → ROUGE.
  it('retombe sur l\'effet unique historique `effect`', () => {
    expect(boardEffects({ id: 'B', name: 'B', effect: STAT() } as any).map(e => e.type)).toEqual(['stat_bonus']);
  });

  // Mutation : `effect` lu en PLUS de `effects` (concaténation) → ROUGE.
  it('la liste l\'emporte sur l\'effet historique, elle ne s\'y ajoute pas', () => {
    const board = { id: 'B', name: 'B', effect: { type: 'draw_bonus', value: 1 }, effects: [STAT()] } as any;
    expect(boardEffects(board).map(e => e.type)).toEqual(['stat_bonus']);
  });

  // Mutation : filtre `e?.type` retiré → ROUGE (un effet vide atteint le combat).
  it('un effet sans type est écarté, ici et une fois pour toutes', () => {
    expect(boardEffects({ id: 'B', name: 'B', effects: [null, {}, STAT()] } as any)).toHaveLength(1);
    expect(boardEffects({ id: 'B', name: 'B', effects: [] } as any)).toEqual([]);
    expect(boardEffects({ id: 'B', name: 'B', effect: null } as any)).toEqual([]);
    expect(boardEffects(null)).toEqual([]);
  });

  // Une liste vide n'est pas une liste : sinon un terrain migré puis vidé de
  // ses effets en admin ferait ressortir son `effect` d'avant.
  it('une liste vide retombe sur `effect` — et un `effect` absent ne donne rien', () => {
    expect(boardEffects({ id: 'B', name: 'B', effects: [], effect: STAT() } as any)).toHaveLength(1);
    expect(boardEffects({ id: 'B', name: 'B', effects: [] } as any)).toEqual([]);
  });
});

describe('Ciblage par voie d\'invocation', () => {
  const fusion = () => unit({ id: 'F', summon_type: 'fusion' });
  const normale = () => unit({ id: 'N', summon_type: 'normal' });

  // Mutation : `target_summon_types` ignoré par `effectTargets` → ROUGE.
  it('ne touche que les unités invoquées par la voie visée', () => {
    const units = [fusion(), normale()];
    expect(effectTargets(STAT({ target_summon_types: ['fusion'] }), units).map(u => u.card_id)).toEqual(['F']);
  });

  it('plusieurs voies visées se lisent comme un OU entre elles', () => {
    const units = [fusion(), normale(), unit({ id: 'H', summon_type: 'heritage' })];
    expect(effectTargets(STAT({ target_summon_types: ['fusion', 'heritage'] }), units).map(u => u.card_id))
      .toEqual(['F', 'H']);
  });

  // Mutation : liste vide traitée comme « personne » → ROUGE.
  it('une liste vide ou absente ne restreint rien', () => {
    const units = [fusion(), normale()];
    expect(effectTargets(STAT({ target_summon_types: [] }), units)).toHaveLength(2);
    expect(effectTargets(STAT(), units)).toHaveLength(2);
  });

  // ⚠️ L'invariant du lot : les deux ciblages se CUMULENT (ET).
  // Mutation : OU entre les deux ciblages → ROUGE.
  it('archétype ET voie : une seule des deux conditions ne suffit pas', () => {
    const dragonFusion = unit({ id: 'DF', attributes: ['ARCH_003'], summon_type: 'fusion' });
    const dragonNormal = unit({ id: 'DN', attributes: ['ARCH_003'], summon_type: 'normal' });
    const machineFusion = unit({ id: 'MF', attributes: ['ARCH_021'], summon_type: 'fusion' });
    const effect = STAT({ target_attributes: ['ARCH_003'], target_summon_types: ['fusion'] });

    expect(effectTargets(effect, [dragonFusion, dragonNormal, machineFusion]).map(u => u.card_id))
      .toEqual(['DF']);
  });

  // ⚠️ Une carte à plusieurs recettes relève de `multi`, et de rien d'autre :
  // c'est ce que le joueur lit sur sa vignette, et la recette réellement jouée
  // ne voyage pas dans `round:board_ready`.
  // Mutation : `summon_key` rabattu sur `unit.summon_type` → ROUGE.
  it('une carte à plusieurs recettes relève de « multi », pas de son type miroir', () => {
    const multi = unit({ id: 'M', summon_type: 'fusion', multi: true });
    expect(multi.summon_type).toBe('fusion');   // le champ brut, miroir d'une des recettes
    expect(multi.summon_key).toBe('multi');

    expect(effectTargets(STAT({ target_summon_types: ['fusion'] }), [multi])).toEqual([]);
    expect(effectTargets(STAT({ target_summon_types: ['multi'] }), [multi])).toHaveLength(1);
  });

  it('summonKey se lit sur la DÉFINITION de carte, sans recette jouée', () => {
    expect(summonKey({ summon_type: 'heritage' } as any)).toBe('heritage');
    expect(summonKey({ summon_type: 'fusion', summon_options: [{ summon_type: 'heritage' }] } as any)).toBe('multi');
    expect(summonKey({} as any)).toBe('normal');
  });

  it('l\'effet APPLIQUÉ suit exactement le même filtre', () => {
    const fu = fusion(); const no = normale();
    applyEffect(STAT({ value: 7, target_summon_types: ['fusion'] }), { playerUnits: [fu, no] } as any);
    expect(fu.atk).toBe(12);
    expect(no.atk).toBe(5);
  });
});

describe('Cumul des effets d\'un terrain', () => {
  // Mutation : `applyBoardEffects` n'appliquant que le premier effet → ROUGE.
  it('tous les effets s\'appliquent, pas seulement le premier', () => {
    const u = unit({ attributes: ['ARCH_003'] });
    const board = {
      id: 'B', name: 'B',
      effects: [STAT({ value: 10 }), { type: 'shield', value: 20 }, { type: 'stat_bonus', stat: 'hp', value: 15 }],
    } as any;

    applyBoardEffects(board, { playerUnits: [u] } as any);

    expect(u.atk).toBe(15);
    expect(u.shield).toBe(20);
    expect(u.max_hp).toBe(45);
  });

  it('chaque effet garde SON ciblage', () => {
    const dragon = unit({ id: 'D', attributes: ['ARCH_003'], summon_type: 'normal' });
    const fusion = unit({ id: 'F', attributes: ['ARCH_021'], summon_type: 'fusion' });
    const board = {
      id: 'B', name: 'B',
      effects: [
        STAT({ value: 10, target_attributes: ['ARCH_003'] }),
        { type: 'shield', value: 20, target_summon_types: ['fusion'] },
      ],
    } as any;

    applyBoardEffects(board, { playerUnits: [dragon, fusion] } as any);

    expect([dragon.atk, dragon.shield]).toEqual([15, 0]);
    expect([fusion.atk, fusion.shield]).toEqual([5, 20]);
  });

  // ⚠️ Le cumul est ADDITIF : deux `×2` donnent `×3`, pas `×4` — chaque
  // modificateur relit le SOCLE (`_base`), que personne n'écrit en combat.
  // Mutation : `stat_modifier` écrivant dans `_base` (donc composition des
  // multiplicateurs, et résultat dépendant de l'ordre) → ROUGE.
  it('deux multiplicateurs s\'ajoutent au lieu de se composer, et l\'ordre n\'y change rien', () => {
    const a = unit({ hp: 100 });
    const b = unit({ hp: 100 });
    const mod = (value: number) => ({ type: 'stat_modifier', stat: 'hp', value });

    applyBoardEffects({ id: 'B', name: 'B', effects: [mod(2), mod(2)] } as any, { playerUnits: [a] } as any);
    applyBoardEffects({ id: 'B', name: 'B', effects: [mod(2), mod(2)] } as any, { playerUnits: [b] } as any);

    expect(a.max_hp).toBe(300);
    expect(b.max_hp).toBe(a.max_hp);
  });

  it('un terrain sans effet n\'applique rien', () => {
    const u = unit();
    applyBoardEffects({ id: 'B', name: 'B' } as any, { playerUnits: [u] } as any);
    applyBoardEffects(null, { playerUnits: [u] } as any);
    expect(u.atk).toBe(5);
  });

  // ⚠️ Un VRAI `GameState`, pas un objet littéral : celui-ci portait le seul
  // champ que l'assertion regardait, si bien qu'il ne pouvait pas constater
  // l'invariant du registre de provenance — écrit dans le même geste que le
  // crédit, il vivait hors de portée du test.
  it('les effets qui créditent le joueur se cumulent aussi', () => {
    const gameState = new GameState();
    applyBoardEffects(
      { id: 'B', name: 'B', effects: [{ type: 'draw_bonus', value: 1 }, { type: 'draw_bonus', value: 2 }] } as any,
      { gameState } as any,
    );
    expect(gameState.player_extra_draws).toBe(3);
  });

  // Rouge si `applyBoardEffects` cesse de nommer le terrain (`sourceId`), ou si
  // le crédit et son inscription se désolidarisent : la popup de pioche
  // annoncerait alors un « +3 » venu de nulle part.
  it('le crédit de pioche NOMME son terrain, et la somme du registre le vaut', () => {
    const gameState = new GameState();
    applyBoardEffects(
      { id: 'BOARD_007', name: 'B', effects: [{ type: 'draw_bonus', value: 1 }, { type: 'draw_bonus', value: 2 }] } as any,
      { gameState } as any,
    );
    expect(gameState.player_draw_sources).toEqual([
      { kind: 'terrain', ref: 'BOARD_007', value: 1 },
      { kind: 'terrain', ref: 'BOARD_007', value: 2 },
    ]);
    const sum = gameState.player_draw_sources.reduce((n, s) => n + s.value, 0);
    expect(sum).toBe(gameState.player_extra_draws);
  });
});
