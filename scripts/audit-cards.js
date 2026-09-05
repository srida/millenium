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
// Le contrat vit dans `card-contract.js` et nulle part ailleurs : le serveur le
// refuse en 400 avec la MÊME fonction.
const { REQUIRED_CATEGORIES, missingCategories } = require('../card-contract');

const PROJECT = path.join(__dirname, '..');
const DATA = fs.existsSync(path.join(PROJECT, 'data', 'cards.json'))
  ? path.join(PROJECT, 'data')
  : path.join(PROJECT, 'initial-data');

const load = f => JSON.parse(fs.readFileSync(path.join(DATA, f), 'utf8'));
const asArray = x => (Array.isArray(x) ? x : Object.values(x));

const CARDS = asArray(load('cards.json'));
const ATTRS = asArray(load('attributes.json'));
const byId = Object.fromEntries(ATTRS.map(a => [a.id, a]));

const INDEX = tierIndex(ATTRS);
const tiersOf = card => resolveTiers(card, INDEX);

function audit() {
  const missing = Object.fromEntries(REQUIRED_CATEGORIES.map(c => [c, []]));
  const unknownAttr = [];
  const legacyField = [];
  const multiTier = [];

  for (const c of CARDS) {
    const attrs = c.attributes ?? [];
    for (const cat of missingCategories(c, ATTRS)) missing[cat].push(c.id);

    const unknown = attrs.filter(id => !byId[id]);
    if (unknown.length) unknownAttr.push(`${c.id} → ${unknown.join(', ')}`);

    const ts = tiersOf(c);
    if (ts.length > 1) multiTier.push(`${c.id} → T${ts.join('·T')}`);
    // ⚠️ Le champ `tier` est désormais une FAUTE et non un reliquat toléré :
    // plus personne ne le lit, donc il ne peut que raconter autre chose que la
    // carte. `scripts/migrate-tiers.js --write` le retire.
    if (c.tier !== undefined) {
      legacyField.push(`${c.id} → champ tier ${c.tier}, attributs ${ts.length ? `T${ts.join('·T')}` : '—'}`);
    }
  }

  const attrsWithoutTier = ATTRS
    .filter(a => a.categorie === TIER_CATEGORY && !(Number(a.tier) > 0))
    .map(a => a.id);

  return { missing, unknownAttr, legacyField, multiTier, attrsWithoutTier };
}

const r = audit();
const errors = REQUIRED_CATEGORIES.reduce((n, c) => n + r.missing[c].length, 0)
  + r.unknownAttr.length + r.legacyField.length + r.attrsWithoutTier.length;

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
for (const cat of REQUIRED_CATEGORIES) show(`✗ Sans attribut de catégorie « ${cat} »`, r.missing[cat]);
show('✗ Attributs inconnus du catalogue', r.unknownAttr);
show('✗ Champ `tier` résiduel (le retirer : scripts/migrate-tiers.js --write)', r.legacyField);
show('✗ Attribut de tier sans champ `tier`', r.attrsWithoutTier);
show('· Cartes multi-tiers', r.multiTier);
console.log(errors ? `\n${errors} carte(s) hors contrat.` : '\n✓ Contrat respecté.');

process.exit(process.argv.includes('--check') && errors ? 1 : 0);
