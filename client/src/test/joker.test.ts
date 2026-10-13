/* eslint-disable @typescript-eslint/no-explicit-any */
// Joker double tranchant — l'IA, le geste du joueur et le passage en PvP.
// La règle de dégâts elle-même est verrouillée par gamestate.test.ts.
import { describe, it, expect, vi } from 'vitest';
import { GameState } from '../logic/GameState.js';
import { EnemyAI } from '../logic/EnemyAI.js';

const sent: any[] = [];
vi.mock('../net/PvpConnection.js', () => ({
  send: (type: string, payload: any) => { sent.push({ type, ...payload }); },
  on: () => {},
  off: () => {},
}));
const { sendOwnBoard, applyOpponentJoker } = await import('../net/PvpOpponentProvider.js');

describe('EnemyAI.chooseJoker', () => {
  const ai = new (EnemyAI as any)({}, { getCard: () => null }, 'enemy', () => { throw new Error('rand consommé'); });

  it('ne joue rien avant le tour 4', () => {
    for (const r of [1, 2, 3]) expect(ai.chooseJoker(r, 100, 400)).toBeNull();
  });

  it('en retard → ×2, en avance → ×0,5, sans consommer de hasard', () => {
    expect(ai.chooseJoker(4, 200, 300)).toBe('x2');
    expect(ai.chooseJoker(4, 300, 200)).toBe('half');
  });

  it('à égalité : attend au tour 4, parie au tour 5', () => {
    expect(ai.chooseJoker(4, 250, 250)).toBeNull();
    expect(ai.chooseJoker(5, 250, 250)).toBe('x2');
  });
});

describe('GameState — disponibilité du joker', () => {
  it('se pose en préparation, une seule fois par partie', () => {
    const gs = new (GameState as any)();
    expect(gs.canPlayJoker()).toBe(true);
    gs.player_joker = 'x2';
    gs.startCombat();
    expect(gs.player_joker_used).toBe(true);
    expect(gs.canPlayJoker()).toBe(false); // phase COMBAT
    gs.applyEndOfCombat('draw', 0, 0, {});
    gs.nextRound();
    expect(gs.player_joker).toBeNull();
    expect(gs.canPlayJoker()).toBe(false); // déjà joué
  });

  it('un joker retiré avant le combat n\'est pas consommé', () => {
    const gs = new (GameState as any)();
    gs.player_joker = 'half';
    gs.player_joker = null;
    gs.startCombat();
    expect(gs.player_joker_used).toBe(false);
    expect(gs.round_joker_factor).toBe(1);
  });
});

describe('PvP — le joker voyage dans round:board_ready', () => {
  it('sendOwnBoard l\'annonce, null par défaut', () => {
    sent.length = 0;
    sendOwnBoard(3, [], 400, null, 'x2');
    sendOwnBoard(4, [], 400);
    expect(sent[0].joker).toBe('x2');
    expect(sent[1].joker).toBeNull();
  });

  it('applyOpponentJoker l\'affecte à enemy_joker et ignore une valeur inconnue', () => {
    const gs = new (GameState as any)();
    applyOpponentJoker(gs, { joker: 'half' });
    expect(gs.enemy_joker).toBe('half');
    applyOpponentJoker(gs, { joker: 'x10' });
    expect(gs.enemy_joker).toBeNull();
    applyOpponentJoker(gs, {});
    expect(gs.enemy_joker).toBeNull();
  });

  it('les deux clients calculent le même facteur', () => {
    // Joueur A pose ×2, B pose ×0,5 : chacun voit le joker de l'autre en face.
    const a = new (GameState as any)(); a.player_joker = 'x2';
    const b = new (GameState as any)(); b.player_joker = 'half';
    applyOpponentJoker(a, { joker: 'half' });
    applyOpponentJoker(b, { joker: 'x2' });
    a.startCombat(); b.startCombat();
    expect(a.round_joker_factor).toBe(1);
    expect(b.round_joker_factor).toBe(1);
  });
});
