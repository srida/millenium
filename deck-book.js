'use strict';
// Fusion de deux « deck books » (le bloc que DeckRepository synchronise).
//
// Forme : { decks, meta, active, stamps, deleted, active_ts }
//   decks / meta  : par nom de deck
//   stamps[nom]   : horodatage de la dernière modification du deck (et de son méta)
//   deleted[nom]  : horodatage de la suppression (pierre tombale)
//   active_ts     : horodatage du dernier changement de deck actif
//
// Pur, sans require : feuille du graphe (cf. règle anti-cycle du CLAUDE.md).

const TOMBSTONE_TTL_MS = 90 * 24 * 3600 * 1000;
// Une horloge d'appareil en avance ne doit pas pouvoir geler un deck : un
// horodatage futur est ramené à « maintenant + marge ».
const FUTURE_SLACK_MS = 5 * 60 * 1000;

const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);

function clampTs(v, now) {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.min(n, now + FUTURE_SLACK_MS);
}

function normalize(book, now) {
  const b = isObj(book) ? book : {};
  const stamps = {};
  const deleted = {};
  for (const [k, v] of Object.entries(isObj(b.stamps) ? b.stamps : {})) stamps[k] = clampTs(v, now);
  for (const [k, v] of Object.entries(isObj(b.deleted) ? b.deleted : {})) deleted[k] = clampTs(v, now);
  return {
    decks: isObj(b.decks) ? b.decks : {},
    meta: isObj(b.meta) ? b.meta : {},
    active: typeof b.active === 'string' ? b.active : null,
    stamps,
    deleted,
    active_ts: clampTs(b.active_ts, now),
  };
}

/**
 * Fusion par deck, dernier horodatage gagnant.
 * Égalité : présent contre présent → le serveur ; présent contre supprimé → le deck
 * (perdre un deck est pire que le ressusciter). Un livre sans horodatage (ancien
 * client) pèse 0 : il ne peut ni écraser ni supprimer, seulement ajouter.
 */
function mergeBooks(serverBook, clientBook, now = Date.now()) {
  const s = normalize(serverBook, now);
  const c = normalize(clientBook, now);
  const out = { decks: {}, meta: {}, active: null, stamps: {}, deleted: {}, active_ts: 0 };

  const names = new Set([
    ...Object.keys(s.decks), ...Object.keys(c.decks),
    ...Object.keys(s.deleted), ...Object.keys(c.deleted),
  ]);

  const side = (b, name) => {
    if (name in b.decks) return { present: true, ts: b.stamps[name] ?? 0, b };
    if (name in b.deleted) return { present: false, ts: b.deleted[name], b };
    return null;
  };

  for (const name of names) {
    const a = side(s, name);
    const z = side(c, name);
    let win;
    if (!a) win = z;
    else if (!z) win = a;
    else if (a.ts !== z.ts) win = a.ts > z.ts ? a : z;
    else if (a.present === z.present) win = a;          // égalité : le serveur
    else win = a.present ? a : z;                        // égalité : le deck survit

    if (win.present) {
      out.decks[name] = win.b.decks[name];
      if (name in win.b.meta) out.meta[name] = win.b.meta[name];
      out.stamps[name] = win.ts;
    } else if (now - win.ts < TOMBSTONE_TTL_MS) {
      out.deleted[name] = win.ts;
    }
  }

  const activeWin = c.active_ts > s.active_ts ? c : s;
  out.active_ts = activeWin.active_ts;
  out.active = activeWin.active && activeWin.active in out.decks ? activeWin.active : null;
  // Le gagnant pointe sur un deck supprimé : on retombe sur l'autre camp, puis sur rien.
  if (!out.active) {
    const other = activeWin === c ? s : c;
    if (other.active && other.active in out.decks) out.active = other.active;
  }
  return out;
}

module.exports = { mergeBooks, TOMBSTONE_TTL_MS, FUTURE_SLACK_MS };
