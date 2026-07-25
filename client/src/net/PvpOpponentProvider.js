// Remplace EnemyAI en mode Duel en ligne : au lieu de calculer un placement
// par heuristique, on attend le placement réel envoyé par l'adversaire humain
// via PvpConnection. Le round côté serveur ne relaie que des payloads opaques
// (card_id + position) — la reconstruction des unités est locale.
import { Unit } from '../logic/Unit.js';
import * as PvpConnection from './PvpConnection.js';

// Chaque joueur envoie ses positions dans SON orientation locale (toujours
// rows 0–3, comme Board.isPlayerCell). Le récepteur doit les recevoir en
// miroir sur les rows 7–10 (enemy) : row' = 10 - row. Board.js range player
// 0–3 et enemy 7–10 de façon symétrique autour du centre (rows 4–6 neutres),
// donc cette transformation simple préserve "le plus proche du centre".
function mirrorRow(row) { return 10 - row; }

const pendingBoards = new Map(); // round -> payload (buffer si arrivé avant l'attente)
let handler = null;

function ensureListening() {
  if (handler) return;
  handler = (msg) => { pendingBoards.set(msg.round, msg); };
  PvpConnection.on('round:opponent_board', handler);
}

export function sendOwnBoard(round, units, playerHp) {
  // On transmet TOUT l'état persistant d'une unité entre deux rounds : sans lui,
  // la reconstruction repartirait de zéro et les deux clients simuleraient des
  // matchups différents aux rounds > 1 (chacun voyant son adversaire « frais »).
  //   • `base`      — stats de base, modifiées en permanence par la Phase Shopping
  //                   (stat_bonus / stat_modifier écrivent dans `_base`)
  //   • `current_hp`— les PV ne se régénèrent pas entre les rounds
  //   • `shield`    — un bouclier de magie survit jusqu'au combat suivant
  //   • `veterancy_points` — rejoué par AttributeManager au start_of_combat
  // `player_hp` accompagne le board : les magies globales (player_hp_bonus) ne
  // sont connues que du client qui les a jouées, donc chaque joueur est la
  // source de vérité de ses propres PV.
  const payload = {
    round,
    player_hp: playerHp,
    units: units.map(u => ({
      uid: u.uid,
      card_id: u.card_id,
      position: { ...u.position },
      veterancy_points: u.veterancy_points || 0,
      base: { ...u._base },
      current_hp: u.current_hp,
      shield: u.shield || 0,
    })),
  };
  PvpConnection.send('round:board_ready', payload);
}

export function waitForOpponentBoard(round) {
  ensureListening();
  if (pendingBoards.has(round)) {
    const msg = pendingBoards.get(round);
    pendingBoards.delete(round);
    return Promise.resolve(msg);
  }
  return new Promise((resolve) => {
    const onMsg = (msg) => {
      if (msg.round !== round) return; // pas ce round, laissé dans le buffer par ensureListening
      PvpConnection.off('round:opponent_board', onMsg);
      pendingBoards.delete(round);
      resolve(msg);
    };
    PvpConnection.on('round:opponent_board', onMsg);
  });
}

// Reconstruit les unités adverses à partir du payload reçu, placées en miroir
// sur le board local (side: 'enemy', rows 7–10).
export function reconstructOpponentUnits(payload, board, cardDb) {
  const units = [];
  for (const entry of payload.units) {
    const card = cardDb.getCard(entry.card_id);
    if (!card) continue;
    const unit = new Unit(card, 'enemy');
    // Rejoue l'état persistant pour que l'unité reconstruite soit identique à
    // l'unité réelle de l'adversaire (mêmes stats effectives → même combat).
    unit.veterancy_points = entry.veterancy_points || 0;
    if (entry.base) unit._base = { ...unit._base, ...entry.base };
    unit._recomputeStats?.();
    unit.current_hp = entry.current_hp != null
      ? Math.max(1, Math.min(unit.max_hp, entry.current_hp))
      : unit.max_hp;
    unit.shield = entry.shield || 0;
    const pos = { col: entry.position.col, row: mirrorRow(entry.position.row) };
    board.placeUnit(unit, pos);
    unit.initial_position = { ...pos };
    units.push(unit);
  }
  return units;
}

export function reset() {
  pendingBoards.clear();
  if (handler) { PvpConnection.off('round:opponent_board', handler); handler = null; }
}
