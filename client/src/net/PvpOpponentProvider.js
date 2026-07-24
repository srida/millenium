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

export function sendOwnBoard(round, units) {
  const payload = {
    round,
    units: units.map(u => ({ uid: u.uid, card_id: u.card_id, position: { ...u.position } })),
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
    const pos = { col: entry.position.col, row: mirrorRow(entry.position.row) };
    board.placeUnit(unit, pos);
    units.push(unit);
  }
  return units;
}

export function reset() {
  pendingBoards.clear();
  if (handler) { PvpConnection.off('round:opponent_board', handler); handler = null; }
}
