/* eslint-disable @typescript-eslint/no-explicit-any */
// « Tout annuler » — le bouton de la barre de préparation remet board, main et
// cimetière du joueur à l'OUVERTURE du tour (GameSession.undoPreparation).
//
// Ce que ces tests éprouvent, et qui ne se voit nulle part à l'écran quand ça
// casse : l'annulation doit être exacte au bit près. Une unité restaurée garde
// ses PV entamés, son bonus de Shopping, sa vétérance et son `uid` — sans quoi
// annuler coûterait au joueur ce qu'il a acquis les tours d'avant, et la scène
// 3D (indexée par uid) re-spawnerait tout.
import { describe, it, expect } from 'vitest';
import { GameSession } from '../logic/GameSession.js';
import type { GameSessionDeps } from '../logic/GameSession.js';
import { Unit } from '../logic/Unit.js';
import { makeCard } from './helpers.js';

// Session minimale : deck ennemi vide (l'IA ne place rien), pas de terrain.
// `cardsByTier` porte le pool de pioche ; on le laisse vide par défaut pour que
// `startPreparation` ne remplisse pas la main au hasard — chaque test pose sa
// propre main, la pioche n'est pas le sujet ici.
function makeSession(cards: any[] = [], pool: any[] = []): GameSession {
  const byId = new Map(cards.map(c => [c.id, c]));
  const deps: GameSessionDeps = {
    cardsByTier: { 1: pool },
    enemyDeck: {},
    attributeList: [],
    cardDb: { getCard: (id: string) => (byId.get(id) as any) ?? null },
    getRandomBoard: () => null,
    getAllMagies: () => [],
  };
  return new GameSession(deps);
}

function place(session: GameSession, card: any, pos: { col: number; row: number }): any {
  const u = new (Unit as any)(card, 'player');
  session.board.placeUnit(u, pos);
  return u;
}

const at = (session: GameSession, col: number, row: number) => session.board.getUnit({ col, row });

describe('Tout annuler — disponibilité', () => {
  it('rien à annuler au sortir de startPreparation', () => {
    const plain = makeCard({ id: 'PLAIN' });
    const session = makeSession([plain], [plain]);
    session.startPreparation();
    expect(session.canUndoPreparation()).toBe(false);
    expect(session.undoPreparation()).toBe(false);
  });

  it('une invocation puis un déplacement rendent l\'annulation disponible, elle se retire ensuite', () => {
    const plain = makeCard({ id: 'PLAIN' });
    const session = makeSession([plain]);
    session.hand = [{ ...plain } as any];
    session.startPreparation();

    session.place(session.hand[0], { col: 0, row: 0 }, [], 0);
    expect(session.canUndoPreparation()).toBe(true);
    expect(session.undoPreparation()).toBe(true);
    expect(session.canUndoPreparation()).toBe(false);

    const u = place(session, plain, { col: 1, row: 1 });
    // Le déplacement n'est pas comptabilisé par la main : c'est bien le board
    // qui est comparé.
    session.startPreparation();
    expect(session.canUndoPreparation()).toBe(false);
    session.reposition(u, { col: 3, row: 2 });
    expect(session.canUndoPreparation()).toBe(true);
  });

  it('le lancement du combat invalide le snapshot', () => {
    const plain = makeCard({ id: 'PLAIN' });
    const session = makeSession([plain]);
    session.hand = [{ ...plain } as any];
    session.startPreparation();
    session.place(session.hand[0], { col: 0, row: 0 }, [], 0);

    session.startCombat();
    expect(session.canUndoPreparation()).toBe(false);
    expect(session.undoPreparation()).toBe(false);
  });

  it('prepId change à chaque ouverture de tour', () => {
    const session = makeSession();
    const first = session.prepId;
    session.startPreparation();
    expect(session.prepId).toBe(first + 1);
    session.startPreparation();
    expect(session.prepId).toBe(first + 2);
  });
});

describe('Tout annuler — invocation normale', () => {
  it('la carte revient à son index, et c\'est le MÊME objet', () => {
    const a = makeCard({ id: 'A' });
    const b = makeCard({ id: 'B' });
    const session = makeSession([a, b]);
    // Deux exemplaires du même card_id sont des instances distinctes (Draw.ts) :
    // c'est l'identité par référence qui fait foi, pas l'égalité structurelle.
    session.hand = [{ ...a }, { ...b }, { ...a }] as any;
    session.startPreparation();
    const before = [...session.hand];

    session.place(session.hand[1], { col: 2, row: 0 }, [], 1);
    expect(session.hand).toHaveLength(2);
    expect(at(session, 2, 0)).not.toBeNull();

    expect(session.undoPreparation()).toBe(true);
    expect(session.hand).toHaveLength(3);
    session.hand.forEach((c, i) => expect(c).toBe(before[i]));
    expect(at(session, 2, 0)).toBeNull();
  });

  it('une carte remisée par une magie de main retrouve sa remise', () => {
    const sac = makeCard({ id: 'SAC', summon_type: 'sacrifice', cost: { sacrifice: 2 } });
    const session = makeSession([sac]);
    session.hand = [{ ...sac } as any];
    session.gameState.player_hand_modifiers.push({ type: 'reduce_sacrifice_cost', value: 2 } as any);
    session.startPreparation();

    const remised = session.hand[0];
    expect((remised as any).cost.sacrifice).toBe(0);
    expect((remised as any)._original_sacrifice).toBe(2);

    // Coût tombé à 0 → l'invocation ne consomme aucun matériau.
    session.place(remised, { col: 0, row: 0 }, [], 0);
    expect(session.undoPreparation()).toBe(true);
    expect(session.hand[0]).toBe(remised);
    expect((session.hand[0] as any).cost.sacrifice).toBe(0);
  });
});

describe('Tout annuler — invocations composites', () => {
  it('une fusion rend ses matériaux, board et cimetière, intacts', () => {
    const m1 = makeCard({ id: 'M1' });
    const m2 = makeCard({ id: 'M2' });
    const m3 = makeCard({ id: 'M3' });
    const fus = makeCard({ id: 'FUS', tier: 2, summon_type: 'fusion', cost: { materials: ['M1', 'M2', 'M3'] } });
    const session = makeSession([m1, m2, m3, fus]);

    const u1 = place(session, m1, { col: 0, row: 0 });
    const u2 = place(session, m2, { col: 1, row: 0 });
    const u3 = new (Unit as any)(m3, 'player');       // au cimetière
    u3.is_neutralized = true;
    session.graveyard = [u3];
    session.hand = [{ ...fus } as any];

    // État acquis les tours d'avant : c'est lui qui ne doit pas se perdre.
    u1.veterancy_points = 3;
    u1.current_hp = 12;
    u1.shield = 7;
    u1._shopping_bonus = { atk: 10 };
    u1._base.atk += 10;
    u1._recomputeStats();
    const u1Before = {
      uid: u1.uid, atk: u1.atk, base: { ...u1._base }, bonus: { ...u1._shopping_bonus },
      hp: u1.current_hp, shield: u1.shield, vet: u1.veterancy_points,
    };

    session.startPreparation();
    session.place(session.hand[0], { col: 2, row: 1 }, [u1, u2, u3], 0);
    expect(session.graveyard).toHaveLength(0);
    expect(session.getPlayerUnits()).toHaveLength(1);

    expect(session.undoPreparation()).toBe(true);
    expect(at(session, 0, 0)).toBe(u1);
    expect(at(session, 1, 0)).toBe(u2);
    expect(at(session, 2, 1)).toBeNull();
    expect(session.graveyard).toEqual([u3]);
    expect(session.hand).toHaveLength(1);

    expect(u1.uid).toBe(u1Before.uid);
    expect(u1.atk).toBe(u1Before.atk);
    expect(u1._base).toEqual(u1Before.base);
    expect(u1._shopping_bonus).toEqual(u1Before.bonus);
    expect(u1.current_hp).toBe(u1Before.hp);
    expect(u1.shield).toBe(u1Before.shield);
    expect(u1.veterancy_points).toBe(u1Before.vet);
  });

  it('une transformation rend sa cible à SA case (l\'invocation avait pris la sienne)', () => {
    const target = makeCard({ id: 'TGT' });
    const evo = makeCard({ id: 'EVO', tier: 2, summon_type: 'transformation', cost: { materials: ['TGT'] } });
    const session = makeSession([target, evo]);
    const u = place(session, target, { col: 4, row: 3 });
    session.hand = [{ ...evo } as any];
    session.startPreparation();

    session.place(session.hand[0], { col: 4, row: 3 }, [u], 0);
    expect(at(session, 4, 3)!.card_id).toBe('EVO');

    expect(session.undoPreparation()).toBe(true);
    expect(at(session, 4, 3)).toBe(u);
    expect(session.getPlayerUnits()).toHaveLength(1);
  });

  it('trois invocations chaînées se défont d\'un seul geste', () => {
    const a = makeCard({ id: 'CA' });
    const b = makeCard({ id: 'CB' });
    const fus = makeCard({ id: 'CF', tier: 2, summon_type: 'fusion', cost: { materials: ['CA', 'CB'] } });
    const session = makeSession([a, b, fus]);
    session.hand = [{ ...a }, { ...b }, { ...fus }] as any;
    session.startPreparation();
    const before = [...session.hand];

    session.place(session.hand[0], { col: 0, row: 0 }, [], 0);
    session.place(session.hand[0], { col: 1, row: 0 }, [], 0);
    const mats = session.getPlayerUnits();
    session.place(session.hand[0], { col: 2, row: 0 }, mats, 0);
    expect(session.hand).toHaveLength(0);
    expect(session.getPlayerUnits()).toHaveLength(1);

    expect(session.undoPreparation()).toBe(true);
    expect(session.hand).toEqual(before);
    expect(session.getPlayerUnits()).toHaveLength(0);
  });
});

describe('Tout annuler — déplacements', () => {
  it('un échange restaure position ET initial_position des deux unités', () => {
    const c = makeCard({ id: 'MOV' });
    const d = makeCard({ id: 'MOW' });
    const session = makeSession([c, d]);
    const u1 = place(session, c, { col: 0, row: 0 });
    const u2 = place(session, d, { col: 1, row: 2 });
    session.startPreparation();

    expect(session.reposition(u1, { col: 1, row: 2 })).toBe(true);
    expect(u1.position).toEqual({ col: 1, row: 2 });
    expect(u2.position).toEqual({ col: 0, row: 0 });

    expect(session.undoPreparation()).toBe(true);
    expect(u1.position).toEqual({ col: 0, row: 0 });
    expect(u1.initial_position).toEqual({ col: 0, row: 0 });
    expect(u2.position).toEqual({ col: 1, row: 2 });
    expect(u2.initial_position).toEqual({ col: 1, row: 2 });
    expect(at(session, 0, 0)).toBe(u1);
    expect(at(session, 1, 2)).toBe(u2);
  });

  it('un déplacement vers une case libre (board.moveUnit, chemin tap-tap) est annulé lui aussi', () => {
    const c = makeCard({ id: 'TAP' });
    const session = makeSession([c]);
    const u = place(session, c, { col: 2, row: 1 });
    session.startPreparation();

    // Exactement ce que fait GameController._tryMove.
    session.board.moveUnit(u, { col: 4, row: 0 });
    u.initial_position = { col: 4, row: 0 };
    expect(session.canUndoPreparation()).toBe(true);

    expect(session.undoPreparation()).toBe(true);
    expect(at(session, 2, 1)).toBe(u);
    expect(at(session, 4, 0)).toBeNull();
    expect(u.initial_position).toEqual({ col: 2, row: 1 });
  });

  it('annuler deux fois de suite rend le même résultat', () => {
    // Le point de retour n'est pas CONSOMMÉ par l'annulation : il vaut pour tout
    // le tour, autant de fois qu'on tape. (La capture copie par ailleurs les
    // positions : aucun objet `Position` n'est aujourd'hui muté en place — tout
    // écrit un objet neuf — donc c'est une précaution, pas ce que ce test
    // éprouve.)
    const c = makeCard({ id: 'TWICE' });
    const session = makeSession([c]);
    const u = place(session, c, { col: 3, row: 1 });
    session.startPreparation();

    session.reposition(u, { col: 0, row: 3 });
    expect(session.undoPreparation()).toBe(true);
    expect(u.position).toEqual({ col: 3, row: 1 });

    session.reposition(u, { col: 2, row: 2 });
    expect(session.undoPreparation()).toBe(true);
    expect(u.position).toEqual({ col: 3, row: 1 });
    expect(u.initial_position).toEqual({ col: 3, row: 1 });
    expect(at(session, 3, 1)).toBe(u);
  });
});

describe('Tout annuler — ce qu\'il ne touche pas', () => {
  it('ni le camp ennemi, ni gameState', () => {
    const plain = makeCard({ id: 'P' });
    const foe = makeCard({ id: 'E' });
    const session = makeSession([plain, foe]);
    const e = new (Unit as any)(foe, 'enemy');
    session.board.placeUnit(e, { col: 2, row: 8 });
    session.hand = [{ ...plain } as any];
    session.gameState.player_hp = 640;
    session.gameState.enemy_hp = 810;
    session.gameState.player_board_slots = 6;
    session.startPreparation();

    session.place(session.hand[0], { col: 0, row: 0 }, [], 0);
    expect(session.undoPreparation()).toBe(true);

    expect(session.board.getUnit({ col: 2, row: 8 })).toBe(e);
    expect(session.gameState.round).toBe(1);
    expect(session.gameState.player_hp).toBe(640);
    expect(session.gameState.enemy_hp).toBe(810);
    expect(session.gameState.player_board_slots).toBe(6);
  });

  it('le tour suivant a son propre point de retour', () => {
    const plain = makeCard({ id: 'R2' });
    const session = makeSession([plain]);
    const kept = place(session, plain, { col: 0, row: 0 });
    session.hand = [{ ...plain } as any];
    session.startPreparation();
    session.place(session.hand[0], { col: 1, row: 0 }, [], 0);

    // Nouveau tour : les deux unités posées font désormais partie du décor.
    session.startCombat();
    session.startPreparation();
    expect(session.canUndoPreparation()).toBe(false);

    const added = session.getPlayerUnits().find(u => u !== kept)!;
    session.reposition(added, { col: 3, row: 3 });
    expect(session.undoPreparation()).toBe(true);
    expect(session.getPlayerUnits()).toHaveLength(2);
    expect(at(session, 0, 0)).toBe(kept);
    expect(at(session, 1, 0)).toBe(added);
  });
});
