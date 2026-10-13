// Ordres de ciblage du Duel en ligne (cf. client/src/game/orderLockstep.ts).
//
// Le serveur ne simule rien : il relaie la frontière et les ordres d'un joueur
// à son adversaire. Mais il ne relaie JAMAIS le payload brut — il le valide, en
// borne la cadence et le RECONSTRUIT, comme `emote:send`.
//
// ⚠️ Un message refusé désynchronise son émetteur (il a déjà appliqué ses ordres
// chez lui) : le duel finit en `result_mismatch`, sans gain. Seul un client
// modifié peut s'en voir refuser un — le client légitime borne lui-même sa
// cadence à la moitié de ce qui est toléré ici.

/** Ordres par seconde et par joueur (le client s'en tient à 4). */
const MAX_ORDERS_PER_SECOND = 8;
/** Messages par seconde et par joueur : une frontière tous les deux ticks
 *  (≈ 5,5/s à la cadence ×2), plus les ordres. */
const MAX_MESSAGES_PER_SECOND = 30;
/** Un client légitime n'en envoie qu'un par message. */
const MAX_ORDERS_PER_MESSAGE = 8;
/** Bornes larges : un rang de case (< 55) ou un token (≥ 1000). */
const MAX_REF = 100_000;
const MAX_TICK = 100_000;

const history = new Map(); // userId -> { messages: number[], orders: number[] }

const isInt = (v, min, max) => Number.isInteger(v) && v >= min && v <= max;

/** Le message reconstruit à relayer, ou `null` s'il est refusé. */
function accept(userId, msg, now = Date.now()) {
  if (!msg || !isInt(msg.round, 1, 1000) || !isInt(msg.upTo, -1, MAX_TICK)) return null;
  const raw = Array.isArray(msg.orders) ? msg.orders : [];
  if (raw.length > MAX_ORDERS_PER_MESSAGE) return null;
  const orders = [];
  for (const o of raw) {
    if (!o || !isInt(o.tick, 1, MAX_TICK) || !isInt(o.unitRef, 0, MAX_REF)
      || !isInt(o.targetRef, 0, MAX_REF) || !isInt(o.seq, 0, MAX_TICK)) return null;
    orders.push({ tick: o.tick, unitRef: o.unitRef, targetRef: o.targetRef, seq: o.seq });
  }

  const h = history.get(userId) ?? { messages: [], orders: [] };
  h.messages = h.messages.filter(t => now - t < 1000);
  h.orders = h.orders.filter(t => now - t < 1000);
  if (h.messages.length >= MAX_MESSAGES_PER_SECOND) return null;
  if (h.orders.length + orders.length > MAX_ORDERS_PER_SECOND) return null;
  h.messages.push(now);
  for (let i = 0; i < orders.length; i++) h.orders.push(now);
  history.set(userId, h);

  return { type: 'combat:orders', matchId: msg.matchId, round: msg.round, upTo: msg.upTo, orders };
}

function forget(userId) {
  history.delete(userId);
}

module.exports = { accept, forget, MAX_ORDERS_PER_SECOND, MAX_ORDERS_PER_MESSAGE };
