/* eslint-disable @typescript-eslint/no-explicit-any */
// L'IA joue en DERNIER : en solo, son placement n'a plus lieu à l'ouverture de
// la préparation mais au lancement du combat (bouton PRÊT / chrono à 0), pour
// que le joueur pose d'abord et voie ensuite arriver l'adversaire.
import { describe, it, expect } from 'vitest';
import { GameSession } from '../logic/GameSession.js';
import type { GameSessionDeps } from '../logic/GameSession.js';
import { EnemyAI } from '../logic/EnemyAI.js';
import { makeBoard, makeCard, spawn } from './helpers.js';

function makeSession(mode?: 'ai' | 'pvp') {
  const playerCard = makeCard({ id: 'P1', summon_type: 'normal' });
  // 5 cartes ennemies distinctes : l'IA ne pose pas deux fois la même carte.
  const enemyCards = ['E1', 'E2', 'E3', 'E4', 'E5'].map(id => makeCard({ id, summon_type: 'normal' }));
  const byId = new Map([playerCard, ...enemyCards].map(c => [c.id, c]));
  const deps: GameSessionDeps = {
    cardsByTier: { 1: [playerCard as any] },
    enemyDeck: { 1: enemyCards.map(c => c.id) },
    attributeList: [],
    cardDb: { getCard: (id: string) => (byId.get(id) as any) ?? null },
    getRandomBoard: () => null,
    getRandomMagies: () => [],
    ...(mode ? { mode } : {}),
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
});
