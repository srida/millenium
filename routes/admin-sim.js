// Rapports de la simulation d'équilibrage — dépôt, historique et lecture.
//
// Monté sous /api/admin/sim AVEC requireSiteAdmin dans app.js — indispensable,
// car les GET sous /api sont publics par défaut (même raison qu'admin-db.js).
// Un rapport d'équilibrage nomme les cartes trop fortes du jeu : ce n'est pas
// une donnée à laisser lire par n'importe qui.
//
// Les rapports vivent sur le VOLUME (`DATA_DIR`), à côté des catalogues : ils
// doivent survivre au déploiement, sans quoi l'historique — donc le diff avec
// hier, qui est tout l'intérêt de la routine — repartirait de zéro à chaque
// mise en ligne.
const express = require('express');
const fs = require('fs');
const path = require('path');
const { DATA_DIR } = require('../asset-dirs');

const router = express.Router();

const SIM_DIR = path.join(DATA_DIR, 'sim-reports');

/** ⚠️ La date compose un NOM DE FICHIER : même garde que `safeAssetId`, et
 *  pour la même raison — sans elle, `../../etc/passwd` remonterait
 *  l'arborescence. La forme est stricte, pas « nettoyée ». */
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Un mois d'historique : assez pour lire une tendance, assez peu pour que le
 *  volume ne se remplisse pas d'un rapport de 200 Ko par jour à perpétuité.
 *  La purge se fait à L'ÉCRITURE et non dans l'entretien périodique : c'est le
 *  seul moment où le dossier change, et un serveur qui ne reçoit aucun rapport
 *  n'a rien à purger. */
const KEEP_DAYS = 30;

function reportFiles() {
  try {
    return fs.readdirSync(SIM_DIR)
      .filter(f => f.endsWith('.json') && DATE_RE.test(f.slice(0, -5)))
      .sort()
      .reverse(); // le plus récent d'abord
  } catch { return []; }
}

function readReport(date) {
  try { return JSON.parse(fs.readFileSync(path.join(SIM_DIR, `${date}.json`), 'utf-8')); }
  catch { return null; }
}

/** Ce qu'on met dans la liste : l'en-tête, jamais les 653 lignes de cartes. */
function summarize(report) {
  return {
    date: report.date,
    generated_at: report.generated_at,
    seed: report.seed,
    catalog: report.catalog,
    protocol: report.protocol,
    health: report.health,
  };
}

/**
 * Dépôt d'un run. Le corps est le rapport complet produit par
 * `client/src/sim/run.ts`.
 *
 * ⚠️ Écriture ATOMIQUE (fichier temporaire puis `rename`), comme `writeJson`
 * d'app.js : l'hébergeur envoie un SIGTERM à chaque déploiement, et un rapport
 * tronqué casserait la page qui le lit sans qu'on sache pourquoi.
 */
router.post('/', (req, res) => {
  const report = req.body;
  if (!report || typeof report !== 'object') return res.status(400).json({ error: 'Corps vide' });
  if (!DATE_RE.test(report.date || '')) return res.status(400).json({ error: 'Champ `date` absent ou mal formé (AAAA-MM-JJ)' });
  if (!Array.isArray(report.cards)) return res.status(400).json({ error: 'Champ `cards` absent' });

  try {
    fs.mkdirSync(SIM_DIR, { recursive: true });
    const dest = path.join(SIM_DIR, `${report.date}.json`);
    const tmp = `${dest}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(report), 'utf-8');
    fs.renameSync(tmp, dest);

    let pruned = 0;
    for (const stale of reportFiles().slice(KEEP_DAYS)) {
      try { fs.unlinkSync(path.join(SIM_DIR, stale)); pruned++; } catch { /* déjà parti */ }
    }
    res.json({ ok: true, date: report.date, cards: report.cards.length, pruned });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/** L'index : un en-tête par run, du plus récent au plus ancien. */
router.get('/', (req, res) => {
  const runs = reportFiles()
    .map(f => readReport(f.slice(0, -5)))
    .filter(Boolean)
    .map(summarize);
  res.json({ runs });
});

// ⚠️ AVANT `/:date` : `latest` serait sinon capturé comme une date, et refusé
// par DATE_RE.
router.get('/latest', (req, res) => {
  const [newest] = reportFiles();
  if (!newest) return res.status(404).json({ error: 'Aucun rapport' });
  res.json(readReport(newest.slice(0, -5)));
});

router.get('/:date', (req, res) => {
  const { date } = req.params;
  if (!DATE_RE.test(date)) return res.status(400).json({ error: 'Date mal formée' });
  const report = readReport(date);
  if (!report) return res.status(404).json({ error: 'Rapport introuvable' });
  res.json(report);
});

module.exports = router;
module.exports.SIM_DIR = SIM_DIR;
