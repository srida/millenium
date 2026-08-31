// Runs du Labo IA — OUTIL DE DIAGNOSTIC.
//
// Ce que `pvplog.js` est aux duels en ligne, celui-ci l'est aux décisions de
// l'IA : il stocke ce qu'un run a observé et le ressert à `/admin`. Comme lui,
// c'est un module FEUILLE — il ne require que `./db`, et personne ne le require
// en retour hors de son routeur et de la purge d'`app.js`. Il se retire d'un
// bloc.
//
// Deux écarts avec `pvplog.js`, tous deux dans le sens de la simplicité :
//
//   • ⚠️ Le dépôt est ADMIN, pas joueur. Un log PvP est écrit par un joueur
//     ordinaire, d'où les contrôles d'appartenance au match et de rôle de
//     `pvplog.record` — sans eux, le fichier qu'on lit pour arbitrer une
//     divergence serait ce qu'un tricheur y aurait écrit. Ici l'écriture passe
//     par le même `requireSiteAdmin` que la lecture : il n'y a ni match à
//     vérifier, ni rôle à usurper, ni quota à régler.
//
//   • ⚠️ Aucun `diff`. Un log PvP confronte DEUX vues du même combat ; un run
//     de labo n'en a qu'une. Ce qui remplace le verdict, c'est le compte de
//     refus par motif, calculé À L'INSERTION et rangé en colonnes : la liste
//     n'a ainsi jamais à désérialiser un payload.
const crypto = require('node:crypto');
const { stmt } = require('./db');

// Les runs sont faits à la main, rares et petits (quelques Ko) — bien plus
// durables que les logs de combat, d'où une rétention quatre fois plus longue.
const KEEP_DAYS = 30;

// Le corps d'une requête `/api` est plafonné à 1 Mo hors routes d'upload. On
// refuse bien avant, et on le DIT : un run amputé en silence ne vaut rien.
const MAX_PAYLOAD_BYTES = 512_000;

const ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Forme minimale attendue d'un run — refusée plutôt que stockée à moitié. */
function validate(body) {
  if (!body || typeof body !== 'object') return 'corps manquant';
  if (!Array.isArray(body.rounds) || body.rounds.length === 0) return 'aucun round';
  for (const r of body.rounds) {
    if (!r || typeof r !== 'object') return 'round invalide';
    if (!Number.isInteger(r.round)) return 'round invalide';
    if (!Array.isArray(r.events)) return 'événements manquants';
  }
  return null;
}

/**
 * Compte ce que la liste affiche. Fait ICI, une fois, et jamais à la lecture :
 * c'est tout l'intérêt des colonnes dénormalisées.
 */
function summarise(rounds) {
  let placed = 0;
  let refused = 0;
  const byReason = {};
  for (const r of rounds) {
    for (const e of r.events) {
      if (!e || e.kind !== 'attempt') continue;
      if (e.outcome === 'placed') { placed++; continue; }
      refused++;
      const reason = e.reason || 'inconnu';
      byReason[reason] = (byReason[reason] ?? 0) + 1;
    }
  }
  return { placed, refused, byReason };
}

/**
 * Enregistre un run. L'id est SERVEUR (`crypto.randomUUID`) : il compose
 * ensuite un nom de fichier, et un id fourni par l'appelant serait à valider
 * plutôt qu'à produire.
 * @returns {{ ok: true, id: string } | { ok: false, error: string }}
 */
function record(body) {
  const invalid = validate(body);
  if (invalid) return { ok: false, error: invalid };

  const payload = JSON.stringify(body);
  if (Buffer.byteLength(payload, 'utf8') > MAX_PAYLOAD_BYTES) {
    return { ok: false, error: 'run trop volumineux' };
  }

  const { placed, refused, byReason } = summarise(body.rounds);
  const id = crypto.randomUUID();
  stmt.insertAiRun.run({
    id,
    created_at: Date.now(),
    label: String(body.label ?? '').slice(0, 200),
    deck_id: String(body.deck_id ?? '').slice(0, 120),
    rounds: body.rounds.length,
    placed,
    refused,
    payload: JSON.stringify({ ...body, refusals_by_reason: byReason }),
  });
  return { ok: true, id };
}

function parseRow(row) {
  let payload = null;
  try { payload = JSON.parse(row.payload); } catch { /* ligne illisible */ }
  return {
    id: row.id,
    created_at: row.created_at,
    label: row.label,
    deck_id: row.deck_id,
    rounds: row.rounds,
    placed: row.placed,
    refused: row.refused,
    payload,
  };
}

/** Le run complet. `null` s'il n'existe pas. */
function get(id) {
  const row = stmt.aiRunById.get(id);
  return row ? parseRow(row) : null;
}

/** La liste — ne lit AUCUN payload, tout est déjà en colonnes. */
function list({ limit = 25, offset = 0 } = {}) {
  const lim = Math.min(100, Math.max(1, Number(limit) || 25));
  const off = Math.max(0, Number(offset) || 0);
  return {
    runs: stmt.aiRunList.all(lim, off),
    total: stmt.aiRunCount.get().n,
    limit: lim,
    offset: off,
  };
}

function remove(id) {
  return stmt.deleteAiRun.run(id).changes;
}

/** Purge par ancienneté — appelée par le `runMaintenance` existant d'app.js. */
function purge(now = Date.now()) {
  return stmt.deleteOldAiRuns.run(now - KEEP_DAYS * 86400_000).changes;
}

module.exports = { record, get, list, remove, purge, KEEP_DAYS, MAX_PAYLOAD_BYTES, ID_RE };
