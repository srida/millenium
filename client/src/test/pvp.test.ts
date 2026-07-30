/* eslint-disable @typescript-eslint/no-explicit-any */
// PvP — fidélité de la reconstruction du board adverse.
//
// Le duel en ligne repose entièrement sur le déterminisme : chaque client
// simule le MÊME combat de son côté, l'un des deux boards étant reconstruit
// depuis un payload réseau. Toute donnée persistante d'une unité qui n'est pas
// transmise fait diverger les deux simulations (chaque joueur voyant un
// adversaire différent) — ces tests verrouillent le contenu du payload.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Board } from '../logic/Board.js';
import { Unit } from '../logic/Unit.js';
import { makeCard } from './helpers.js';

const sent: any[] = [];
vi.mock('../net/PvpConnection.js', () => ({
  send: (type: string, payload: any) => { sent.push({ type, ...payload }); },
  on: () => {},
  off: () => {},
}));

const { sendOwnBoard, reconstructOpponentUnits } = await import('../net/PvpOpponentProvider.js');

const CARD = makeCard({ id: 'PVP_A', name: 'Sujet', stats: { atk: 10, hp: 40, movement_speed: 1, attack_speed: 2, initiative: 5, range: 1 } });
const cardDb = { getCard: (id: string) => (id === CARD.id ? (CARD as any) : null) };

// Reproduit une unité telle qu'elle est en fin de préparation d'un round > 1 :
// stats de base durablement modifiées par la Phase Shopping, PV entamés par le
// combat précédent, bouclier de magie, points de vétérance accumulés.
function veteranUnit(board: Board): Unit {
  const u = new (Unit as any)(CARD, 'player') as Unit;
  u._base.atk += 7;          // magie stat_bonus
  u._base.hp += 20;          // magie stat_bonus
  u._recomputeStats();
  u.current_hp = 12;         // survivant amoché
  u.shield = 5;              // magie shield
  u.veterancy_points = 3;
  board.placeUnit(u, { col: 1, row: 2 });
  return u;
}

function roundTrip(source: Unit, playerHp = 1000): { payload: any; rebuilt: Unit } {
  sent.length = 0;
  sendOwnBoard(2, [source], playerHp);
  const payload = sent.find(m => m.type === 'round:board_ready');
  const rebuilt = reconstructOpponentUnits(payload, new Board(), cardDb)[0];
  return { payload, rebuilt };
}

describe('PvP — reconstruction du board adverse', () => {
  beforeEach(() => { sent.length = 0; });

  it('rejoue les stats de base modifiées par la Phase Shopping', () => {
    const source = veteranUnit(new Board());
    const { rebuilt } = roundTrip(source);
    expect(rebuilt.atk).toBe(source.atk);
    expect(rebuilt.max_hp).toBe(source.max_hp);
    expect(rebuilt._base).toEqual(source._base);
  });

  it('rejoue les PV entamés, le bouclier et la vétérance', () => {
    const source = veteranUnit(new Board());
    const { rebuilt } = roundTrip(source);
    expect(rebuilt.current_hp).toBe(source.current_hp);
    expect(rebuilt.shield).toBe(source.shield);
    expect(rebuilt.veterancy_points).toBe(source.veterancy_points);
  });

  it('place l\'unité en miroir côté ennemi (row 10 - row)', () => {
    const source = veteranUnit(new Board());
    const { rebuilt } = roundTrip(source);
    expect(rebuilt.side).toBe('enemy');
    expect(rebuilt.position).toEqual({ col: 1, row: 8 });
    expect(rebuilt.initial_position).toEqual({ col: 1, row: 8 });
  });

  it('transmet les PV du joueur (magies globales invisibles de l\'adversaire)', () => {
    const source = veteranUnit(new Board());
    const { payload } = roundTrip(source, 820);
    expect(payload.player_hp).toBe(820);
  });

  it('borne current_hp par le max reconstruit', () => {
    const board = new Board();
    const source = veteranUnit(board);
    source.current_hp = 9999;
    const { rebuilt } = roundTrip(source);
    expect(rebuilt.current_hp).toBe(rebuilt.max_hp);
  });

  it('reste compatible avec un payload legacy (sans base/current_hp/shield)', () => {
    const legacy = { round: 2, units: [{ uid: 1, card_id: CARD.id, position: { col: 0, row: 0 }, veterancy_points: 0 }] };
    const rebuilt = reconstructOpponentUnits(legacy, new Board(), cardDb)[0];
    expect(rebuilt.current_hp).toBe(rebuilt.max_hp);
    expect(rebuilt.shield).toBe(0);
    expect(rebuilt.position).toEqual({ col: 0, row: 10 });
  });
});
