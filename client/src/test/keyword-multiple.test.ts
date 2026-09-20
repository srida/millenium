/* eslint-disable @typescript-eslint/no-explicit-any */
// MULTIPLE — le mot-clé qui lève la règle du doublon.
//
// ⚠️ Ce n'est PAS un effet : le moteur n'a aucune tâche pour « ignorer une
// garde d'invocation », exactement le statut de `cimetiere_permanent`. La
// règle vit dans `InvocationManager._canSummonWith` (règle 2), sa réciproque
// UI dans `InvocationRules`, et son pendant IA dans `EnemyAI`. Ce fichier
// éprouve les trois, plus la sortie sèche du catalogue livré.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { canSummon, summon } from '../logic/InvocationManager.js';
import { isPlayable, materialsComplete, validCells } from '../logic/InvocationRules.js';
import { EnemyAI } from '../logic/EnemyAI.js';
import { GameSession } from '../logic/GameSession.js';
import type { GameSessionDeps } from '../logic/GameSession.js';
import { MOT_CLE_CATEGORY } from '../logic/Keywords.js';
import { makeCard, spawn, makeBoard } from './helpers.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const attributs: any[] = JSON.parse(readFileSync(path.join(ROOT, 'initial-data/attributes.json'), 'utf8'));
const cartes: any[] = JSON.parse(readFileSync(path.join(ROOT, 'initial-data/cards.json'), 'utf8'));

/** L'attribut Multiple, tel qu'il est LIVRÉ — jamais une copie écrite ici. */
const MULTIPLE = attributs.find(a => a.mot_cle === 'multiple');

const NORMAL = makeCard({ id: 'NORMAL' });
const MULTI = makeCard({ id: 'MULTI', attributes: [MULTIPLE?.id ?? 'ARCH_100'] });

describe('Multiple — la donnée livrée', () => {
  it('existe, en catégorie MotCle, porte le mot-clé et aucun seuil', () => {
    expect(MULTIPLE, 'attribut « Multiple » absent du catalogue').toBeTruthy();
    expect(MULTIPLE.categorie).toBe(MOT_CLE_CATEGORY);
    expect(MULTIPLE.mot_cle).toBe('multiple');
    expect(MULTIPLE.thresholds).toEqual([]);
  });

  it('au moins une carte livrée le porte', () => {
    const porteurs = cartes.filter(c => (c.attributes ?? []).includes(MULTIPLE.id));
    expect(porteurs.length).toBeGreaterThan(0);
  });
});

// canSummon() rend `{ ok, reason }` ou `{ options }` (cartes à conditions
// multiples) ; ces tests n'utilisent que la première forme, comme
// `invocation.test.ts`.
function can(...args: unknown[]): { ok: boolean; reason: string } {
  return (canSummon as any)(...args);
}

describe('InvocationManager — la règle du doublon, levée pour Multiple', () => {
  it('une carte normale est refusée si un exemplaire vit déjà sur le terrain', () => {
    const board = makeBoard();
    spawn(board, NORMAL as any, 'player', { col: 0, row: 0 });
    const res = can(NORMAL, { col: 1, row: 0 }, board, [], [], [], null, false);
    expect(res.ok).toBe(false);
  });

  it('une carte Multiple se pose malgré un exemplaire déjà vivant', () => {
    const board = makeBoard();
    const existing = spawn(board, MULTI as any, 'player', { col: 0, row: 0 });
    const res = can(MULTI, { col: 1, row: 0 }, board, [], [], [], null, true);
    expect(res.ok).toBe(true);

    // ⚠️ Mutation : `hasMultiple` ignoré → ROUGE ici, la même carte refusée.
    expect(can(MULTI, { col: 1, row: 0 }, board, [], [], [], null, false).ok).toBe(false);

    const unit = (summon as any)(MULTI, { col: 1, row: 0 }, board, [], null, null, null, true);
    expect(board.getLivingUnitsOnSide('player')).toHaveLength(2);
    expect(board.getUnit({ col: 0, row: 0 })).toBe(existing);
    expect(unit.card_id).toBe(existing.card_id);
  });

  it("l'exemplaire existant n'est ni consommé ni affecté", () => {
    const board = makeBoard();
    const existing = spawn(board, MULTI as any, 'player', { col: 0, row: 0 });
    existing.current_hp = 7;
    (summon as any)(MULTI, { col: 1, row: 0 }, board, [], null, null, null, true);
    expect(existing.is_neutralized).toBe(false);
    expect(existing.current_hp).toBe(7);
    expect(board.getUnit({ col: 0, row: 0 })).toBe(existing);
  });
});

describe('InvocationRules — la main et les cases valides suivent la même règle', () => {
  it('isPlayable : refusé sur un doublon normal, jouable pour Multiple', () => {
    const board = makeBoard();
    spawn(board, NORMAL as any, 'player', { col: 0, row: 0 });
    expect(isPlayable(NORMAL as any, board, [], Infinity, false)).toBe(false);

    const board2 = makeBoard();
    spawn(board2, MULTI as any, 'player', { col: 0, row: 0 });
    expect(isPlayable(MULTI as any, board2, [], Infinity, false)).toBe(false);
    expect(isPlayable(MULTI as any, board2, [], Infinity, true)).toBe(true);
  });

  it('materialsComplete et validCells ignorent le doublon quand hasMultiple est vrai', () => {
    const board = makeBoard();
    spawn(board, MULTI as any, 'player', { col: 0, row: 0 });

    // Aucune condition (invocation normale) : rien à sélectionner, toujours vrai.
    expect(materialsComplete(MULTI as any, [], null, board, true)).toBe(true);

    const cells = validCells(MULTI as any, {
      board, graveyard: [], selectedMaterials: [], playerBoardSlots: 5,
      conditionIndex: null, hasMultiple: true,
    });
    expect(cells.length).toBeGreaterThan(0);

    const cellsSansMultiple = validCells(MULTI as any, {
      board, graveyard: [], selectedMaterials: [], playerBoardSlots: 5,
      conditionIndex: null, hasMultiple: false,
    });
    expect(cellsSansMultiple).toEqual([]);
  });
});

describe('EnemyAI — même exemption côté adversaire', () => {
  const cardDb = { getCard: (id: string) => (id === 'MULTI' ? MULTI : null) };

  it("place un second exemplaire quand hasMultiple répond vrai pour la carte", () => {
    const board = makeBoard();
    spawn(board, MULTI as any, 'enemy', { col: 0, row: 7 });

    const ai = new (EnemyAI as any)({ 1: ['MULTI'] }, cardDb, 'enemy');
    (ai as any).setHand([MULTI]);
    const placed = ai.placeFromHand(board, 5, [], null, () => true);

    expect(placed).toHaveLength(1);
    expect(board.getLivingUnitsOnSide('enemy')).toHaveLength(2);
  });

  it('sans le prédicat (comportement par défaut), le doublon reste refusé', () => {
    const board = makeBoard();
    spawn(board, MULTI as any, 'enemy', { col: 0, row: 7 });

    const ai = new (EnemyAI as any)({ 1: ['MULTI'] }, cardDb, 'enemy');
    (ai as any).setHand([MULTI]);
    const placed = ai.placeFromHand(board, 5, []);

    expect(placed).toHaveLength(0);
    expect(board.getLivingUnitsOnSide('enemy')).toHaveLength(1);
  });
});

describe('GameSession — le mot-clé se lit sur les attributs de la CARTE', () => {
  const CATALOGUE = [MULTIPLE];

  function makeSession(attributeList: any[] = CATALOGUE): GameSession {
    const deps: GameSessionDeps = {
      cardsByTier: { 1: [NORMAL as any, MULTI as any] },
      enemyDeck: { 1: [] },
      attributeList: attributeList as any,
      cardDb: { getCard: () => null } as any,
      getAllBoards: () => [],
      getAllMagies: () => [],
    };
    return new GameSession(deps);
  }

  it('une carte Multiple se pose par-dessus son propre exemplaire vivant', () => {
    const session = makeSession();
    spawn(session.board, MULTI as any, 'player', { col: 0, row: 0 });

    expect(session.canSummon(MULTI as any, { col: 1, row: 0 }, []).ok).toBe(true);
    const unit = session.place(MULTI as any, { col: 1, row: 0 }, [], null);
    expect(unit).toBeTruthy();
    expect(session.board.getLivingUnitsOnSide('player')).toHaveLength(2);
  });

  // ⚠️ La sortie sèche : un catalogue qui ne déclare pas le mot-clé rend la
  // carte muette, exactement comme une carte normale — mutation : oublier
  // `_hasMultiple(card)` sur un des appels → ROUGE, la carte serait toujours
  // jouable même hors catalogue.
  it("un catalogue qui ne déclare pas le mot-clé refuse le doublon, comme n'importe quelle carte", () => {
    const session = makeSession([]);
    spawn(session.board, MULTI as any, 'player', { col: 0, row: 0 });

    expect(session.canSummon(MULTI as any, { col: 1, row: 0 }, []).ok).toBe(false);
  });

  it('une carte NORMALE ne profite jamais de l\'exemption', () => {
    const session = makeSession();
    spawn(session.board, NORMAL as any, 'player', { col: 0, row: 0 });

    expect(session.canSummon(NORMAL as any, { col: 1, row: 0 }, []).ok).toBe(false);
  });
});
