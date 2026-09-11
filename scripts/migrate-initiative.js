#!/usr/bin/env node
// Reprise de données : la stat d'INITIATIVE disparaît du catalogue.
//
//   node scripts/migrate-initiative.js                    # rapport, n'écrit rien
//   node scripts/migrate-initiative.js --write            # applique
//   node scripts/migrate-initiative.js --initial-data     # vise la SEMENCE du dépôt
//
// IDEMPOTENT : une carte déjà reprise n'est pas touchée. Relancer le script
// deux fois ne change rien la seconde fois.
//
// L'initiative ne se lisait NULLE PART ailleurs que dans le tri d'ordre
// d'action de `CombatManager` : aucun écran ne la montrait, aucune magie
// livrée ne la visait, aucun terrain non plus. Elle ne s'expliquait donc par
// rien de ce que le joueur voit sur la carte. L'ordre d'action se dérive
// désormais de quatre valeurs qu'il lit déjà — tier, ATQ, vitesse de
// déplacement, `card_id` —, et le champ n'a plus de lecteur.
//
// ⚠️ Un champ sans lecteur est une FAUTE et non un reliquat toléré, même quand
// il est inerte : c'est la règle qui vaut déjà pour le champ `tier` et pour les
// champs en ticks. Le laisser vivre, c'est laisser l'admin le rééditer et
// croire qu'il règle quelque chose. `npm run audit:cards` le signale.
//
// Deux catalogues, parce qu'un effet peut viser une stat :
//   1. `cards.json`      — `stats.initiative` est RETIRÉ.
//   2. les trois porteurs d'effets (`magies.json`, `attributes.json`,
//      `boards.json`) — un effet dont la stat est `initiative` est SIGNALÉ,
//      jamais supprimé.
//
// ⚠️ Le second n'écrit rien, à dessein. Retirer une stat d'une carte ne lui
// enlève rien de lisible ; retirer un effet d'une magie la vide de son sens,
// et ce n'est pas à un script de décider par quoi la remplacer. Le rapport le
// nomme, l'admin tranche. Aucune des données livrées n'est dans ce cas.
//
// Cible : `data/` s'il existe (le volume, donc la prod), sinon `initial-data/`.
// En prod : `npm run sync:pull` → ce script → `npm run sync:push`.
//
// ⚠️ `--initial-data` force la SEMENCE du dépôt, même quand `data/` existe. Les
// DEUX dossiers sont à reprendre, et ce ne sont pas les mêmes données :
// `bootstrap()` ne recopie JAMAIS `initial-data/` sur un `data/` déjà peuplé,
// donc migrer l'un ne migre pas l'autre — et une installation neuve naîtrait au
// vieux format. Même drapeau, même raison, que `scripts/migrate-speeds.js`.
const fs = require('fs');
const path = require('path');

const PROJECT = path.join(__dirname, '..');
const DATA = (!process.argv.includes('--initial-data')
  && fs.existsSync(path.join(PROJECT, 'data', 'cards.json')))
  ? path.join(PROJECT, 'data')
  : path.join(PROJECT, 'initial-data');

const WRITE = process.argv.includes('--write');
const file = f => path.join(DATA, f);
const load = f => JSON.parse(fs.readFileSync(file(f), 'utf8'));
const exists = f => fs.existsSync(file(f));

/** Écriture ATOMIQUE, comme `writeJson` côté serveur : l'hébergeur envoie un
 *  SIGTERM à chaque déploiement, et ce script peut tourner sur le volume. */
function save(f, value) {
  const tmp = `${file(f)}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, '\t')}\n`);
  fs.renameSync(tmp, file(f));
}

// --- 1. Les cartes ---
const cards = load('cards.json');
if (!Array.isArray(cards)) {
  console.error('`cards.json` attendu sous forme de tableau.');
  process.exit(1);
}

const dropped = [];
for (const c of cards) {
  if (c?.stats && 'initiative' in c.stats) {
    dropped.push(`${c.id} (initiative ${c.stats.initiative})`);
    delete c.stats.initiative;
  }
}

// --- 2. Les effets qui viseraient la stat, dans les trois porteurs ---
//
// Chacun a sa forme, et `boards.json` en a DEUX : `effects` (la liste) et
// `effect` (l'effet unique historique). On ratisse donc large plutôt que de
// décrire chaque schéma — c'est un rapport, il n'écrit rien.
function statEffects(value, trail = []) {
  if (Array.isArray(value)) return value.flatMap((v, i) => statEffects(v, [...trail, i]));
  if (value === null || typeof value !== 'object') return [];
  const here = value.stat === 'initiative' ? [trail] : [];
  return here.concat(Object.entries(value).flatMap(([k, v]) => statEffects(v, [...trail, k])));
}

const orphanEffects = [];
for (const f of ['magies.json', 'attributes.json', 'boards.json']) {
  if (!exists(f)) continue;
  const list = load(f);
  for (const entry of Array.isArray(list) ? list : Object.values(list)) {
    for (const trail of statEffects(entry)) {
      orphanEffects.push(`${f} → ${entry?.id ?? '?'} (${trail.join('.') || 'effect'})`);
    }
  }
}

const show = (label, list, cap = 10) => {
  if (!list.length) return;
  console.log(`\n${label} — ${list.length}`);
  list.slice(0, cap).forEach(x => console.log(`   ${x}`));
  if (list.length > cap) console.log(`   … et ${list.length - cap} de plus`);
};

console.log(`Catalogue : ${DATA}  (${cards.length} cartes)`);
show('Champ `stats.initiative` à retirer', dropped);
show("✗ Effets visant la stat `initiative` — SANS LECTEUR, à reprendre à la main en admin", orphanEffects);

if (!dropped.length) {
  console.log('\n✓ Rien à faire — catalogue déjà repris.');
  process.exit(orphanEffects.length ? 1 : 0);
}

if (!WRITE) {
  console.log('\nRelancer avec --write pour appliquer.');
  process.exit(0);
}

save('cards.json', cards);
console.log(`\n✓ Écrit dans ${DATA}.`);
process.exit(orphanEffects.length ? 1 : 0);
