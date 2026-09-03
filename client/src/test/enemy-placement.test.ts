/* eslint-disable @typescript-eslint/no-explicit-any */
// L'IA joue en DERNIER : en solo, son placement n'a plus lieu à l'ouverture de
// la préparation mais au lancement du combat (bouton PRÊT / chrono à 0), pour
// que le joueur pose d'abord et voie ensuite arriver l'adversaire.
import { describe, it, expect } from 'vitest';
import { GameSession } from '../logic/GameSession.js';
import type { GameSessionDeps } from '../logic/GameSession.js';
import { EnemyAI } from '../logic/EnemyAI.js';
import { makeBoard, makeCard, spawn } from './helpers.js';

function makeSession(mode?: 'ai' | 'pvp', enemyBonus?: { atk: number; hp: number } | null) {
  const playerCard = makeCard({ id: 'P1', summon_type: 'normal' });
  // 5 cartes ennemies distinctes : l'IA ne pose pas deux fois la même carte.
  const enemyCards = ['E1', 'E2', 'E3', 'E4', 'E5'].map(id => makeCard({ id, summon_type: 'normal' }));
  const byId = new Map([playerCard, ...enemyCards].map(c => [c.id, c]));
  const deps: GameSessionDeps = {
    cardsByTier: { 1: [playerCard as any] },
    enemyDeck: { 1: enemyCards.map(c => c.id) },
    attributeList: [],
    cardDb: { getCard: (id: string) => (byId.get(id) as any) ?? null },
    getAllBoards: () => [],
    getAllMagies: () => [],
    ...(mode ? { mode } : {}),
    ...(enemyBonus !== undefined ? { enemyBonus } : {}),
  };
  return new GameSession(deps);
}

describe('Placement de l\'IA (solo)', () => {
  it('la préparation ne place aucune unité ennemie', () => {
    const session = makeSession();
    session.startPreparation();
    expect(session.getEnemyUnits()).toHaveLength(0);
    expect(session.enemyUnits).toHaveLength(0);
  });

  it('startCombat place l\'IA avant de figer le multiplicateur', () => {
    const session = makeSession();
    session.startPreparation();
    const { enemyUnits } = session.startCombat();
    expect(enemyUnits.length).toBeGreaterThan(0);
    expect(session.getEnemyUnits()).toHaveLength(enemyUnits.length);
    // Le multiplicateur ennemi tient compte des unités fraîchement posées :
    // preuve que le placement précède bien gameState.startCombat (un board vide
    // donnerait ×3.0).
    const expected: Record<number, number> = { 1: 3.0, 2: 2.0, 3: 1.5, 4: 1.2, 5: 1.0 };
    expect(session.gameState.enemy_unit_multiplier).toBe(expected[Math.min(5, enemyUnits.length)]);
  });

  it('en PvP, startCombat ne place rien (adversaire humain distant)', () => {
    const session = makeSession('pvp');
    session.startPreparation();
    const { enemyUnits } = session.startCombat(null);
    expect(enemyUnits).toHaveLength(0);
  });

  // Le tour de l'IA n'est pas qu'un AJOUT d'unités : il peut aussi en RETIRER du
  // board — un survivant du round précédent consommé comme matériau ou remplacé
  // par une transformation. C'est la raison d'être de la purge de
  // Scene3D.revealEnemyUnits : ce survivant a déjà une carte à l'écran (héritée
  // du round précédent) et refresh() ne passe plus une fois en mode combat, donc
  // sans purge sa carte resterait affichée tout le combat alors qu'il n'est plus
  // dans board.grid.
  it('une transformation de l\'IA retire du board le survivant qu\'elle remplace', () => {
    const base = makeCard({ id: 'E_BASE', summon_type: 'normal' });
    const evolved = makeCard({
      id: 'E_EVO', summon_type: 'transformation', cost: { materials: ['E_BASE'] },
    });
    const byId = new Map([base, evolved].map(c => [c.id, c]));

    const board = makeBoard();
    // Survivant du round précédent : déjà sur le board, donc déjà à l'écran.
    const survivor = spawn(board, base, 'enemy', { col: 2, row: 7 });

    // Deck ne contenant QUE la transformation : la main tirée est déterministe.
    const ai = new (EnemyAI as any)({ 1: ['E_EVO'] }, { getCard: (id: string) => byId.get(id) ?? null }, 'enemy');
    ai.drawHand(1);
    ai.placeFromHand(board, 5, []);

    const onBoard = board.getLivingUnitsOnSide('enemy');
    expect(onBoard.map((u: any) => u.card_id)).toEqual(['E_EVO']);
    // Le survivant a quitté board.grid — c'est ce que revealEnemyUnits doit voir.
    expect(onBoard).not.toContain(survivor);
    expect(board.getUnit({ col: 2, row: 7 })).not.toBe(survivor);
  });

  // Même règle que le joueur (`InvocationManager._canSummonForType`, cas
  // `sacrifice` à `needed === 0`) : un sacrifice sans coût est une invocation
  // normale déguisée, et doit donc refuser un second exemplaire vivant.
  it('un sacrifice à coût nul ne pose jamais un second exemplaire de la même carte', () => {
    const card = makeCard({ id: 'E_FREE', summon_type: 'sacrifice', cost: { sacrifice: 0 } });
    const byId = new Map([card].map(c => [c.id, c]));
    const board = makeBoard();

    const ai = new (EnemyAI as any)({ 1: ['E_FREE'] }, { getCard: (id: string) => byId.get(id) ?? null }, 'enemy');
    // Deux exemplaires de la même carte en main (tirage avec remise) : une
    // main de joueur ne le permettrait jamais, la main de l'IA si.
    ai.setHand([card, card]);
    ai.placeFromHand(board, 5, []);

    const onBoard = board.getLivingUnitsOnSide('enemy');
    expect(onBoard).toHaveLength(1);
    expect(ai.getHand().map((c: any) => c.id)).toEqual(['E_FREE']);
  });
});

// Handicap plat donné aux unités de l'IA (`deps.enemyBonus`) — c'est le mode
// Arcade qui s'en sert pour durcir ses quatre échelons, mais `logic/` n'en sait
// rien : pour lui, c'est un modificateur de session comme un autre.
describe('Handicap de l\'IA (enemyBonus)', () => {
  const baseAtk = 5, baseHp = 30;   // stats de `makeCard` par défaut

  it('sans handicap, les unités de l\'IA sont intouchées', () => {
    // Le cas de TOUS les modes existants : solo, tournoi, tutoriel, PvP.
    const session = makeSession();
    session.startPreparation();
    const { enemyUnits } = session.startCombat();
    for (const u of enemyUnits) {
      expect(u._base.atk).toBe(baseAtk);
      expect(u._base.hp).toBe(baseHp);
      expect(u._enemy_bonus_applied).toBeUndefined();
    }
  });

  it('le handicap s\'ajoute aux stats de base, PV courants compris', () => {
    const session = makeSession(undefined, { atk: 3, hp: 30 });
    session.startPreparation();
    const { enemyUnits } = session.startCombat();
    expect(enemyUnits.length).toBeGreaterThan(0);
    for (const u of enemyUnits) {
      expect(u._base.atk).toBe(baseAtk + 3);
      expect(u._base.hp).toBe(baseHp + 30);
      expect(u.atk).toBe(baseAtk + 3);
      expect(u.max_hp).toBe(baseHp + 30);
      // Sinon l'unité entrerait en combat déjà blessée de tout son bonus.
      expect(u.current_hp).toBe(baseHp + 30);
    }
  });

  it('le camp du JOUEUR n\'est jamais touché', () => {
    const session = makeSession(undefined, { atk: 3, hp: 30 });
    session.startPreparation();
    const card = session.hand[0] as any;
    session.place(card, { col: 2, row: 0 }, [], 0);
    const { playerUnits } = session.startCombat();
    expect(playerUnits.length).toBeGreaterThan(0);
    for (const u of playerUnits) {
      expect(u._base.atk).toBe(baseAtk);
      expect(u._base.hp).toBe(baseHp);
    }
  });

  it('un survivant ne le reçoit qu\'UNE fois, malgré les rounds suivants', () => {
    // `_placeEnemyUnits` repasse sur les survivants à chaque round ; le bonus
    // vivant dans `_base` (donc permanent), un second versement le doublerait.
    const session = makeSession(undefined, { atk: 3, hp: 30 });
    session.startPreparation();
    const survivor = session.startCombat().enemyUnits[0];
    session.finishCombat();
    session.startNextRound();
    session.startPreparation();
    session.startCombat();

    expect(survivor._base.atk).toBe(baseAtk + 3);
    expect(survivor._base.hp).toBe(baseHp + 30);
  });

  it('le handicap survit à resetCombatStats (contrairement aux bonus de combat)', () => {
    // C'est TOUTE la raison d'écrire dans `_base` : `_stat_bonuses` est balayé
    // à chaque fin de combat, et par POWER_DEBUFF.
    const session = makeSession(undefined, { atk: 3, hp: 30 });
    session.startPreparation();
    const unit = session.startCombat().enemyUnits[0];
    unit.resetCombatStats();
    expect(unit.atk).toBe(baseAtk + 3);
    expect(unit.max_hp).toBe(baseHp + 30);
  });

  it('un handicap nul est un no-op', () => {
    const session = makeSession(undefined, { atk: 0, hp: 0 });
    session.startPreparation();
    for (const u of session.startCombat().enemyUnits) {
      expect(u._base.atk).toBe(baseAtk);
      expect(u._enemy_bonus_applied).toBeUndefined();
    }
  });
});
