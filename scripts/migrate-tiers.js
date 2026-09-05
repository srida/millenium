#!/usr/bin/env node
// Reprise de données : le champ `tier` d'une carte devient un ATTRIBUT.
//
//   node scripts/migrate-tiers.js            # rapport, n'écrit rien
//   node scripts/migrate-tiers.js --write    # applique
//
// IDEMPOTENT : une carte déjà migrée n'est pas touchée. Relancer le script deux
// fois ne change rien la seconde fois.
//
// Trois réparations, dans cet ordre :
//   1. `attributes.json` — un attribut de catégorie `Tiers` sans champ `tier`
//      le reçoit, déduit du chiffre de son `name` ou de son `icon`. C'est le
//      seul endroit du projet où ce chiffre se devine : le résolveur
//      (`tiers.js`) refuse de le faire, un renommage en admin le casserait.
//   2. `cards.json` — la carte reçoit l'attribut correspondant à son champ.
//   3. le champ `tier` est RETIRÉ — plus personne ne le lit, et le laisser
//      rouvrirait une seconde source de vérité, muette et désaccordable.
//
// ⚠️ Le retrait ne vaut que pour une carte qui porte bien un attribut de tier :
// sur une orpheline, le champ est la seule information restante et le supprimer
// effacerait ce que le rapport existe pour signaler.
//
// Cible : `data/` s'il existe (le volume, donc la prod), sinon `initial-data/`.
// En prod : `npm run sync:pull` → ce script → `npm run sync:push`.
const fs = require('fs');
const path = require('path');

const PROJECT = path.join(__dirname, '..');
const DATA = fs.existsSync(path.join(PROJECT, 'data', 'cards.json'))
  ? path.join(PROJECT, 'data')
  : path.join(PROJECT, 'initial-data');

const WRITE = process.argv.includes('--write');
const file = f => path.join(DATA, f);
const load = f => JSON.parse(fs.readFileSync(file(f), 'utf8'));

/** Écriture ATOMIQUE, comme `writeJson` côté serveur : l'hébergeur envoie un
 *  SIGTERM à chaque déploiement, et ce script peut tourner sur le volume. */
function save(f, value) {
  const tmp = `${file(f)}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, '\t')}\n`);
  fs.renameSync(tmp, file(f));
}

const attributes = load('attributes.json');
const cards = load('cards.json');
if (!Array.isArray(attributes) || !Array.isArray(cards)) {
  console.error('Catalogues attendus sous forme de tableaux.');
  process.exit(1);
}

// --- 1. Les attributs de tier portent-ils leur numéro ? ---
const fixedAttrs = [];
for (const a of attributes) {
  if (a?.categorie !== 'Tiers' || Number(a.tier) > 0) continue;
  const guess = Number(String(a.name ?? '').match(/\d+/)?.[0] ?? String(a.icon ?? '').match(/\d+/)?.[0]);
  if (!Number.isFinite(guess) || guess <= 0) {
    console.error(`✗ ${a.id} (« ${a.name} ») : impossible d'en déduire un numéro de tier — à saisir à la main.`);
    process.exit(1);
  }
  a.tier = guess;
  fixedAttrs.push(`${a.id} → tier ${guess}`);
}

const tierAttrOf = {};
for (const a of attributes) {
  if (a?.categorie === 'Tiers' && Number(a.tier) > 0) tierAttrOf[Number(a.tier)] = a.id;
}
if (Object.keys(tierAttrOf).length === 0) {
  console.error("Aucun attribut de catégorie « Tiers » dans le catalogue — rien à quoi rattacher les cartes.");
  process.exit(1);
}

// --- 2. Les cartes portent-elles l'attribut de leur tier ? ---
const known = new Set(Object.values(tierAttrOf));
const fixedCards = [];
const droppedField = [];
const orphans = [];
for (const c of cards) {
  const attrs = c.attributes ?? (c.attributes = []);
  if (!attrs.some(id => known.has(id))) {
    const t = Number(c.tier);
    const attr = tierAttrOf[t];
    if (!attr) { orphans.push(`${c.id} (tier ${c.tier ?? '—'})`); continue; }
    attrs.push(attr);
    fixedCards.push(`${c.id} → ${attr} (T${t})`);
  }
  // 3. Le champ n'a plus de lecteur : il part. On n'arrive ici qu'avec un
  //    attribut de tier posé — une orpheline a fait `continue` au-dessus.
  if (c.tier !== undefined) {
    droppedField.push(`${c.id} (champ tier ${c.tier})`);
    delete c.tier;
  }
}

const show = (label, list, cap = 10) => {
  if (!list.length) return;
  console.log(`\n${label} — ${list.length}`);
  list.slice(0, cap).forEach(x => console.log(`   ${x}`));
  if (list.length > cap) console.log(`   … et ${list.length - cap} de plus`);
};

console.log(`Catalogue : ${DATA}  (${cards.length} cartes)`);
show('Attributs de tier complétés', fixedAttrs);
show('Cartes à rattacher', fixedCards);
show('Champ `tier` à retirer', droppedField);
show("✗ Cartes sans tier exploitable (aucun attribut de tier ne correspond)", orphans);

if (!fixedAttrs.length && !fixedCards.length && !droppedField.length) {
  console.log('\n✓ Rien à faire — catalogue déjà migré.');
  process.exit(orphans.length ? 1 : 0);
}

if (!WRITE) {
  console.log('\nRelancer avec --write pour appliquer.');
  process.exit(0);
}

if (fixedAttrs.length) save('attributes.json', attributes);
if (fixedCards.length || droppedField.length) save('cards.json', cards);
console.log(`\n✓ Écrit dans ${DATA}.`);
process.exit(orphans.length ? 1 : 0);
