// Dépôt et consultation des runs du Labo IA — OUTIL DE DIAGNOSTIC.
//
// Monté dans app.js avec un `requireSiteAdmin` EXPLICITE, même raison que
// `admin-db.js`, `admin-sim.js` et `admin-pvplog.js` : les GET sous `/api` sont
// publics par défaut.
//
// ⚠️ Le POST est ici, et pas dans `routes/online.js` comme celui des logs PvP.
// Un log PvP est déposé par un JOUEUR au sortir de son duel ; un run de labo
// est produit par l'écran de dev, que seul un admin ouvre. Le mettre sous la
// même garde que la lecture supprime d'un coup tout ce que `pvplog.record` doit
// vérifier — appartenance, rôle, quota.
//
// Les règles vivent dans `ailog.js` ; ce fichier ne fait que les servir.
const express = require('express');
const ailog = require('../ailog');

const router = express.Router();

// ⚠️ L'`id` compose un NOM DE FICHIER (`Content-Disposition`) — même situation
// que `safeAssetId` et le `DATE_RE` d'`admin-sim.js`. On borne à la forme
// réellement produite par `crypto.randomUUID`, et on rend **400** et non 404 :
// le 400 strict est le canari, un 404 signalerait une normalisation en amont.
function idOr400(req, res) {
  const id = req.params.id;
  if (!ailog.ID_RE.test(id)) {
    res.status(400).json({ error: 'id invalide' });
    return null;
  }
  return id;
}

// Dépôt d'un run.
router.post('/', (req, res) => {
  try {
    const result = ailog.record(req.body);
    if (!result.ok) return res.status(400).json({ error: result.error });
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Liste — un run par ligne, sans jamais toucher aux payloads.
router.get('/', (req, res) => {
  try {
    res.json(ailog.list({ limit: req.query.limit, offset: req.query.offset }));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ⚠️ Toute route à segment fixe se déclare AVANT `/:id`, qui la capturerait.

router.get('/:id', (req, res) => {
  const id = idOr400(req, res);
  if (!id) return;
  try {
    const run = ailog.get(id);
    if (!run) return res.status(404).json({ error: 'run introuvable' });
    res.json(run);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Le même, en pièce jointe — c'est le fichier qu'on s'échange pour diagnostiquer.
router.get('/:id/download', (req, res) => {
  const id = idOr400(req, res);
  if (!id) return;
  try {
    const run = ailog.get(id);
    if (!run) return res.status(404).json({ error: 'run introuvable' });
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="ai-run-${id}.json"`);
    // Indenté : ce fichier est fait pour être LU à la main.
    res.send(JSON.stringify(run, null, 2));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.delete('/:id', (req, res) => {
  const id = idOr400(req, res);
  if (!id) return;
  try {
    res.json({ ok: true, deleted: ailog.remove(id) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
