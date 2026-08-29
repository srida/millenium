// Consultation des logs de combat PvP — OUTIL DE DIAGNOSTIC TEMPORAIRE.
//
// Monté dans app.js avec un `requireSiteAdmin` EXPLICITE, même raison qu'ici
// pour `admin-db.js` et `admin-sim.js` : les GET sous `/api` sont publics par
// défaut, et un log nomme les joueurs d'un duel.
//
// Les règles (recollage des deux vues, diff) vivent dans `pvplog.js` — ce
// fichier ne fait que les servir.
const express = require('express');
const pvplog = require('../pvplog');

const router = express.Router();

// ⚠️ Le `matchId` compose un NOM DE FICHIER (`Content-Disposition`), et c'est
// exactement la situation de `safeAssetId` et du `DATE_RE` d'`admin-sim.js` :
// on borne à la forme réellement produite (`crypto.randomUUID` de
// `ws/MatchRelay.createMatch`) plutôt que d'échapper après coup.
const MATCH_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function matchIdOr400(req, res) {
  const id = req.params.matchId;
  if (!MATCH_ID_RE.test(id)) {
    res.status(400).json({ error: 'match_id invalide' });
    return null;
  }
  return id;
}

// Liste — un match par ligne, avec son verdict.
router.get('/', (req, res) => {
  try {
    res.json(pvplog.list({ limit: req.query.limit, offset: req.query.offset }));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ⚠️ `/latest` n'existe pas ici, mais l'ordre reste celui d'`admin-sim.js` :
// toute route à segment fixe se déclare AVANT `/:matchId`, qui la capturerait.

// Le bundle complet (les deux vues + les divergences) — affichage en ligne.
router.get('/:matchId', (req, res) => {
  const id = matchIdOr400(req, res);
  if (!id) return;
  try {
    const bundle = pvplog.bundle(id);
    if (!bundle) return res.status(404).json({ error: 'aucun log pour ce match' });
    res.json(bundle);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Le même, en pièce jointe — c'est le fichier qu'on s'échange pour diagnostiquer.
router.get('/:matchId/download', (req, res) => {
  const id = matchIdOr400(req, res);
  if (!id) return;
  try {
    const bundle = pvplog.bundle(id);
    if (!bundle) return res.status(404).json({ error: 'aucun log pour ce match' });
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="pvp-${id}.json"`);
    // Indenté : ce fichier est fait pour être LU et diffé à la main, pas parsé
    // par un programme. Le poids reste très en deçà de ce que la route encaisse.
    res.send(JSON.stringify(bundle, null, 2));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.delete('/:matchId', (req, res) => {
  const id = matchIdOr400(req, res);
  if (!id) return;
  try {
    res.json({ ok: true, deleted: pvplog.remove(id) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
