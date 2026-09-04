// Fabrique les cinq routes CRUD d'un catalogue JSON de DATA_DIR.
//
// Le même quintuplet — GET / POST / import / PUT / DELETE — était recopié pour
// dix entités, soit près de 700 lignes d'app.js. C'est cette répétition qui a
// produit la traversée de répertoire (le garde-fou `safeAssetId` avait été
// ajouté aux copies récentes et pas aux anciennes, et rien ne pouvait le
// signaler) puis la corruption de `boards.json` (une seule des dix routes
// d'import n'avait pas son `Array.isArray`).
//
// ⚠️ EXTRACTION MÉCANIQUE. Chaque réponse — code de statut, forme du corps,
// libellé d'erreur, en français comme en anglais (`'id required'`,
// `'Not found'`) — est celle d'app.js avant extraction, à la virgule près.
// Une amélioration glissée ici n'en serait pas une : `admin.html` (282 Ko
// écrits à la main) lit ces corps sans regarder les statuts, et
// `scripts/sync-data.js` fait l'inverse. Le critère de recette est le diff VIDE
// de `client/src/test/crud-characterization.test.ts`, qui a justement été
// enregistré pour ça.
const express = require('express');

const noop = () => {};

/** Validation par défaut du POST : l'id est requis, et unique. */
function requireUniqueId(item, list) {
  if (!item || !item.id) return { status: 400, body: { error: 'id required' } };
  if (list.find(x => x.id === item.id)) {
    return { status: 400, body: { error: `ID ${item.id} already exists` } };
  }
  return null;
}

/**
 * @param {object}    o
 * @param {string}    o.file        chemin absolu du JSON (DATA_DIR)
 * @param {Function}  o.readJson    injectés : app.js les possède, et son
 * @param {Function}  o.writeJson   `readJson` a un contrat précis (cf. son en-tête)
 * @param {Function} [o.guard]      middleware posé sur les ÉCRITURES seulement.
 *                                  ⚠️ JAMAIS sur le GET : les lectures sous
 *                                  /api sont publiques, c'est le jeu qui les
 *                                  consomme sans compte.
 * @param {Function} [o.render]     (liste) => corps du GET. Reçoit la LISTE
 *                                  entière et non chaque élément : les
 *                                  drapeaux calculés ont parfois un préambule
 *                                  par requête (le `Set` de la dotation pour
 *                                  les cartes), qu'on ne veut pas refaire 653×.
 * @param {Function} [o.strip]      (item) => void, avant toute écriture —
 *                                  retire les drapeaux calculés du corps reçu.
 * @param {Function} [o.validateCreate] (item, liste) => null | {status, body}
 * @param {Function} [o.validate]   (item) => null | {status, body}, sur POST et
 *                                  PUT — la règle qui vaut pour toute écriture
 *                                  d'un élément, là où `validateCreate` ne
 *                                  répond qu'à « cet id est-il libre ? ».
 *                                  ⚠️ PAS sur `/import` : c'est le chemin des
 *                                  machines (`sync-data.js` pousse un catalogue
 *                                  entier), et une entrée non conforme y ferait
 *                                  échouer la synchro plutôt que de se signaler.
 *                                  L'audit (`npm run audit:cards`) couvre ce
 *                                  chemin-là.
 */
function crudRouter(o) {
  const {
    file, readJson, writeJson,
    guard,
    render = (list) => list,
    strip = noop,
    validateCreate = requireUniqueId,
    validate = () => null,
  } = o;

  const router = express.Router();
  const w = guard ? [guard] : [];
  const fail = (res, e) => res.status(500).json({ error: e.message });

  router.get('/', (req, res) => {
    try { res.json(render(readJson(file))); } catch (e) { fail(res, e); }
  });

  router.post('/', ...w, (req, res) => {
    try {
      const list = readJson(file);
      const item = req.body;
      const bad = validateCreate(item, list) || validate(item);
      if (bad) return res.status(bad.status).json(bad.body);
      strip(item);
      list.push(item);
      writeJson(file, list);
      res.json({ ok: true });
    } catch (e) { fail(res, e); }
  });

  router.post('/import', ...w, (req, res) => {
    try {
      const { items, mode = 'skip' } = req.body;
      if (!Array.isArray(items)) return res.status(400).json({ error: 'items doit être un tableau' });
      const list = readJson(file);
      let added = 0, replaced = 0, skipped = 0;
      const errors = [];
      for (const item of items) {
        if (!item || !item.id) { errors.push('Élément sans ID ignoré'); continue; }
        strip(item);
        const idx = list.findIndex(x => x.id === item.id);
        if (idx !== -1) {
          if (mode === 'replace') { list[idx] = item; replaced++; }
          else skipped++;
        } else {
          list.push(item);
          added++;
        }
      }
      writeJson(file, list);
      res.json({ ok: true, added, replaced, skipped, errors });
    } catch (e) { fail(res, e); }
  });

  router.put('/:id', ...w, (req, res) => {
    try {
      const list = readJson(file);
      const idx = list.findIndex(x => x.id === req.params.id);
      if (idx === -1) return res.status(404).json({ error: 'Not found' });
      const updated = req.body;
      const bad = validate(updated);
      if (bad) return res.status(bad.status).json(bad.body);
      strip(updated);
      list[idx] = updated;
      writeJson(file, list);
      res.json({ ok: true });
    } catch (e) { fail(res, e); }
  });

  router.delete('/:id', ...w, (req, res) => {
    try {
      const list = readJson(file);
      const idx = list.findIndex(x => x.id === req.params.id);
      if (idx === -1) return res.status(404).json({ error: 'Not found' });
      list.splice(idx, 1);
      writeJson(file, list);
      res.json({ ok: true });
    } catch (e) { fail(res, e); }
  });

  return router;
}

module.exports = { crudRouter, requireUniqueId };
