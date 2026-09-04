#!/usr/bin/env node
// Audit du CONTRAT D'ATTRIBUTS d'une carte.
//
// Depuis que le tier est un attribut, une carte doit porter au moins un
// attribut de chacune de ces catégories :
//
//   Tiers       — à quel(s) round(s) elle se pioche  (plusieurs autorisés)
//   Invocation  — comment elle se pose               (plusieurs autorisés)
//   Element     — sa signature élémentaire            (plusieurs autorisés)
//
// ⚠️ `Type` n'est PAS du contrat : 12 cartes livrées n'en portent aucun, et
// aucune règle du moteur ne le lit. L'y ajouter reviendrait à faire échouer
// l'audit sur une donnée que personne ne consomme.
//
//   node scripts/audit-cards.js            # rapport
//   node scripts/audit-cards.js --check    # exit 1 si une carte viole le contrat
//   node scripts/audit-cards.js --json     # rapport machine
//
// Lit `data/` s'il existe (le catalogue RÉELLEMENT servi), sinon
// `initial-data/` — mêmes chemins que `build-bot-decks.js` et `sim/catalog.ts`.
const fs = require('fs');
const path = require('path');
// La règle « quel attribut est quel tier » vit dans `tiers.js` et nulle part
// ailleurs : on lui passe l'index construit sur le dossier qu'on audite, qui
// n'est pas forcément celui du serveur.
const { tierIndex, resolveTiers, TIER_CATEGORY } = require('../tiers');

const PROJECT = path.join(__dirname, '..');
const DATA = fs.existsSync(path.join(PROJECT, 'data', 'cards.json'))
  ? path.join(PROJECT, 'data')
  : path.join(PROJECT, 'initial-data');

const load = f => JSON.parse(fs.readFileSync(path.join(DATA, f), 'utf8'));
const asArray = x => (Array.isArray(x) ? x : Object.values(x));

/** Les catégories exigées. L'ordre est celui du rapport. */
const REQUIRED = ['Tiers', 'Invocation', 'Element'];

const CARDS = asArray(load('cards.json'));
const ATTRS = asArray(load('attributes.json'));
const byId = Object.fromEntries(ATTRS.map(a => [a.id, a]));

const INDEX = tierIndex(ATTRS);
const tiersOf = card => resolveTiers(card, INDEX);

function audit() {
  const missing = Object.fromEntries(REQUIRED.map(c => [c, []]));
  const unknownAttr = [];
  const tierMismatch = [];
  const multiTier = [];
  const noTierField = [];

  for (const c of CARDS) {
    const attrs = c.attributes ?? [];
    const cats = new Set(attrs.map(id => byId[id]?.categorie).filter(Boolean));
    for (const cat of REQUIRED) if (!cats.has(cat)) missing[cat].push(c.id);

    const unknown = attrs.filter(id => !byId[id]);
    if (unknown.length) unknownAttr.push(`${c.id} → ${unknown.join(', ')}`);

    const ts = tiersOf(c);
    if (ts.length > 1) multiTier.push(`${c.id} → T${ts.join('·T')}`);
    // Le champ historique doit rester d'accord avec les attributs tant qu'il
    // existe : c'est la garantie que le Lot 1 est un refactor et non une
    // nouvelle règle. Une carte sans champ `tier` est déjà migrée, pas fautive.
    if (c.tier == null) noTierField.push(c.id);
    else if (!ts.includes(Number(c.tier))) {
      tierMismatch.push(`${c.id} → champ tier ${c.tier}, attributs ${ts.length ? `T${ts.join('·T')}` : '—'}`);
    }
  }

  const attrsWithoutTier = ATTRS
    .filter(a => a.categorie === TIER_CATEGORY && !(Number(a.tier) > 0))
    .map(a => a.id);

  return { missing, unknownAttr, tierMismatch, multiTier, noTierField, attrsWithoutTier };
}

const r = audit();
const errors = REQUIRED.reduce((n, c) => n + r.missing[c].length, 0)
  + r.unknownAttr.length + r.tierMismatch.length + r.attrsWithoutTier.length;

if (process.argv.includes('--json')) {
  console.log(JSON.stringify({ source: DATA, cards: CARDS.length, errors, ...r }, null, 2));
  process.exit(process.argv.includes('--check') && errors ? 1 : 0);
}

const show = (label, list, cap = 12) => {
  if (!list.length) return;
  console.log(`\n${label} — ${list.length}`);
  list.slice(0, cap).forEach(x => console.log(`   ${x}`));
  if (list.length > cap) console.log(`   … et ${list.length - cap} de plus`);
};

console.log(`Catalogue : ${DATA}  (${CARDS.length} cartes, ${ATTRS.length} attributs)`);
for (const cat of REQUIRED) show(`✗ Sans attribut de catégorie « ${cat} »`, r.missing[cat]);
show('✗ Attributs inconnus du catalogue', r.unknownAttr);
show('✗ Champ `tier` en désaccord avec les attributs', r.tierMismatch);
show('✗ Attribut de tier sans champ `tier`', r.attrsWithoutTier);
show('· Cartes multi-tiers', r.multiTier);
show('· Cartes sans champ `tier` (déjà migrées)', r.noTierField, 4);
console.log(errors ? `\n${errors} carte(s) hors contrat.` : '\n✓ Contrat respecté.');

process.exit(process.argv.includes('--check') && errors ? 1 : 0);
