// Messages rapides du Duel en ligne (cf. client/src/game/emotes.ts).
//
// Seul l'ID transite sur le réseau : le texte se résout côté client. Le serveur
// ne relaie donc qu'un id connu, à cadence bornée, dans un message qu'il
// RECONSTRUIT — jamais le payload brut du client.
//
// ⚠️ `EMOTE_IDS` est le JUMEAU de `EMOTES` (client/src/game/emotes.ts) : la
// frontière CJS / ESM-TS interdit un module partagé. `emotes.test.ts` les fait
// répondre la même chose, c'est le seul filet contre leur dérive.
const EMOTE_IDS = new Set(['bonjour', 'chance', 'gg', 'duel', 'aie', 'hmm', 'oups']);

/** Un peu sous les 3 s du client, pour absorber la latence. */
const EMOTE_MIN_GAP_MS = 2500;

const lastEmoteAt = new Map(); // userId -> horodatage du dernier message accepté

/**
 * → `true` si ce message doit être relayé. Un message refusé n'avance pas
 * l'horloge : le flot d'un client en boucle ne repousse pas indéfiniment son
 * propre prochain message valide.
 */
function accept(userId, emoteId, now = Date.now()) {
  if (typeof emoteId !== 'string' || !EMOTE_IDS.has(emoteId)) return false;
  if (now - (lastEmoteAt.get(userId) ?? -Infinity) < EMOTE_MIN_GAP_MS) return false;
  lastEmoteAt.set(userId, now);
  return true;
}

function forget(userId) {
  lastEmoteAt.delete(userId);
}

module.exports = { EMOTE_IDS, EMOTE_MIN_GAP_MS, accept, forget };
