#!/usr/bin/env node
// Découpage des cartes en SETS (brief_boutique §2) — prérequis des boosters.
//
//   node scripts/build-sets.js [--write]
//
// Sans --write : rapport seul. Avec : écrit `sets.json` et ajoute le champ
// `set` à chaque carte, dans data/ ET initial-data/.
//
// ⚠️ Ce découpage est PROVISOIRE. Le brief le dit lui-même (§9.1) : le
// découpage effectif est un chantier de design, pas un calcul. Ce script
// produit un découpage *jouable* qui respecte les contraintes vérifiables
// mécaniquement, pour que la boutique fonctionne dès maintenant :
//
//   ✔ aucune carte orpheline — une fusion/héritage/transformation est
//     TOUJOURS dans le même set que ses matériaux (fermeture par union-find
//     sur le graphe de matériaux, c'est la contrainte dure)
//   ✔ 55 à 65 cartes par set (cible), sets triés par archétype dominant
//   ~ distribution de tiers : rapportée, pas garantie (le pool ne s'y prête
//     pas partout — le tirage de booster se rabat silencieusement, cf. §7)
//   ✘ « un archétype n'est jamais découpé entre deux sets » : IMPOSSIBLE sur
//     le pool actuel. Unir les cartes par archétype produit une composante
//     unique de 223 cartes (les archétypes se chevauchent : une carte porte
//     jusqu'à 4 attributs d'archétype). C'est exactement la raison pour
//     laquelle le brief classe le découpage en décision ouverte : il demande
//     un travail éditorial sur les attributs, pas un algorithme.
//
// Quand le découpage à la main sera fait, il suffit de remplacer sets.json et
// les champs `set` : shop.js ne lit rien d'autre.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DIRS = ['data', 'initial-data'].map(d => path.join(ROOT, d));
const WRITE = process.argv.includes('--write');

const TARGET = 60;   // cible de cartes par set
const MAX = 70;      // au-delà, on ouvre un nouveau set

const read = f => JSON.parse(fs.readFileSync(f, 'utf8').replace(/,\s*([\]}])/g, '$1'));

const cards = read(path.join(DIRS[0], 'cards.json'));
const attributes = read(path.join(DIRS[0], 'attributes.json'));

const ARCHETYPES = new Map(
  attributes.filter(a => a.categorie === 'Archetype').map(a => [a.id, a.name]));
const byId = new Map(cards.map(c => [c.id, c]));

/** Matériaux d'une carte, toutes options d'invocation confondues. */
function materials(card) {
  const out = [...(card.cost?.materials ?? [])];
  for (const opt of card.summon_options ?? []) out.push(...(opt.cost?.materials ?? []));
  return out;
}

// --- 1. Fermeture par matériaux : une carte et ses matériaux sont indivisibles ---
const parent = new Map();
const find = x => {
  if (!parent.has(x)) parent.set(x, x);
  return parent.get(x) === x ? x : (parent.set(x, find(parent.get(x))), parent.get(x));
};
const union = (a, b) => { const ra = find(a), rb = find(b); if (ra !== rb) parent.set(ra, rb); };

for (const card of cards) {
  find(card.id);
  // Un matériau désigné par ATTRIBUT (ARCH_*) n'est pas une carte : il ne crée
  // pas d'arête. Le booster le résout au tirage en cherchant un porteur.
  for (const m of materials(card)) if (byId.has(m)) union(card.id, m);
}

const components = new Map();
for (const card of cards) {
  const root = find(card.id);
  if (!components.has(root)) components.set(root, []);
  components.get(root).push(card);
}

// --- 2. Archétype dominant d'une composante ---
const globalCount = new Map();
for (const card of cards) {
  for (const a of card.attributes ?? []) {
    if (ARCHETYPES.has(a)) globalCount.set(a, (globalCount.get(a) ?? 0) + 1);
  }
}

function dominantArchetype(group) {
  const count = new Map();
  for (const card of group) {
    for (const a of card.attributes ?? []) {
      if (ARCHETYPES.has(a)) count.set(a, (count.get(a) ?? 0) + 1);
    }
  }
  if (!count.size) return null;
  // Le plus représenté ; à égalité, le plus RARE globalement — sinon les
  // archétypes fourre-tout (« Âme des cartes », 60 cartes) aspirent tout et
  // les petits archétypes n'ont jamais de set à eux.
  return [...count.entries()].sort((a, b) =>
    b[1] - a[1] || globalCount.get(a[0]) - globalCount.get(b[0]) || a[0].localeCompare(b[0]))[0][0];
}

const blocks = [...components.values()].map(group => ({
  cards: group,
  archetype: dominantArchetype(group),
  size: group.length,
}));

// --- 3. Empaquetage : les blocs d'un même archétype restent ensemble ---
const byArchetype = new Map();
for (const b of blocks) {
  const key = b.archetype ?? '~divers';
  if (!byArchetype.has(key)) byArchetype.set(key, []);
  byArchetype.get(key).push(b);
}

const DIVERS = '~divers';
const groups = [...byArchetype.entries()]
  .map(([key, list]) => ({
    key,
    blocks: list.sort((a, b) => b.size - a.size || a.cards[0].id.localeCompare(b.cards[0].id)),
    size: list.reduce((n, b) => n + b.size, 0),
  }))
  // Les gros archétypes d'abord : ils structurent les sets. Les cartes sans
  // archétype (~97, aucun attribut d'archétype) ne structurent rien : elles
  // passent en DERNIER, comme mortier entre les blocs — placées en premier,
  // elles monopolisaient un set entier sans identité.
  .sort((a, b) => (a.key === DIVERS) - (b.key === DIVERS) || b.size - a.size || a.key.localeCompare(b.key));

const binCount = Math.max(1, Math.round(cards.length / TARGET));
const sets = Array.from({ length: binCount }, () => ({ cards: [], archetypes: new Map() }));

function place(bin, block) {
  bin.cards.push(...block.cards);
  if (block.archetype) {
    bin.archetypes.set(block.archetype, (bin.archetypes.get(block.archetype) ?? 0) + block.size);
  }
}

for (const g of groups) {
  for (const b of g.blocks) {
    // Le bloc rejoint le set qui porte DÉJÀ le plus de son archétype (on ne
    // découpe un archétype que si son set d'accueil déborde), sinon le set le
    // plus vide. Le mortier, lui, va toujours au plus vide.
    const affine = b.archetype && g.key !== DIVERS
      ? sets.filter(s => (s.archetypes.get(b.archetype) ?? 0) > 0 && s.cards.length + b.size <= MAX)
      : [];
    const host = affine.length
      ? affine.sort((x, y) => (y.archetypes.get(b.archetype) ?? 0) - (x.archetypes.get(b.archetype) ?? 0))[0]
      : sets.reduce((a, s) => (s.cards.length < a.cards.length ? s : a));
    place(host, b);
  }
}

sets.sort((a, b) => b.cards.length - a.cards.length);

// --- 4. Métadonnées ---
const roman = n => ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII'][n] ?? String(n + 1);

const output = sets.map((s, i) => {
  const id = `SET_${String(i + 1).padStart(2, '0')}`;
  const tiers = {};
  for (const c of s.cards) tiers[c.tier] = (tiers[c.tier] ?? 0) + 1;
  const top = [...s.archetypes.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
  // Un archétype « porteur » doit pouvoir soutenir seul un deck de 20 cartes
  // (brief §2.3) — sur le pool actuel c'est le seuil qu'on peut vérifier.
  const archetypes = [...s.archetypes.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([attribute, card_count]) => ({
      attribute, name: ARCHETYPES.get(attribute), card_count, carries_deck: card_count >= 20,
    }));
  const signature = [...s.cards].sort((a, b) => b.tier - a.tier || a.id.localeCompare(b.id))[0];

  return {
    id,
    name: top.length ? top.map(([a]) => ARCHETYPES.get(a)).join(' & ') : `Reliques ${roman(i)}`,
    card_count: s.cards.length,
    booster_enabled: true,
    archetypes: archetypes.slice(0, 6),
    signature_card: signature?.id ?? null,
    completion_reward: { gems: 300 },
    cards: s.cards.map(c => c.id).sort(),
    _tiers: tiers,
  };
});

// --- Rapport ---
console.log(`${cards.length} cartes → ${output.length} sets\n`);
for (const s of output) {
  const high = (s._tiers[3] ?? 0) + (s._tiers[4] ?? 0) + (s._tiers[5] ?? 0);
  const veryHigh = (s._tiers[4] ?? 0) + (s._tiers[5] ?? 0);
  const flags = [
    s.card_count >= 55 && s.card_count <= 65 ? '' : `taille ${s.card_count}`,
    high >= 8 ? '' : `T3+ ${high}`,
    veryHigh >= 3 ? '' : `T4+ ${veryHigh}`,
    s.archetypes.some(a => a.carries_deck) ? '' : 'aucun archétype porteur',
  ].filter(Boolean);
  console.log(
    `${s.id}  ${String(s.card_count).padStart(3)} cartes  T1-5 ${[1, 2, 3, 4, 5].map(t => s._tiers[t] ?? 0).join('/')}` +
    `  ${s.name}${flags.length ? `   ⚠ ${flags.join(', ')}` : ''}`);
}

if (!WRITE) {
  console.log('\n(rapport seul — relancer avec --write pour écrire sets.json et le champ `set`)');
  process.exit(0);
}

const setOf = new Map();
for (const s of output) for (const id of s.cards) setOf.set(id, s.id);

for (const dir of DIRS) {
  const cardsFile = path.join(dir, 'cards.json');
  const list = read(cardsFile);
  for (const c of list) {
    if (setOf.has(c.id)) c.set = setOf.get(c.id);
  }
  fs.writeFileSync(cardsFile, JSON.stringify(list, null, '\t'), 'utf8');

  // `cards` reste dans sets.json : c'est lui qui fait foi pour le pool d'un
  // booster, le champ `set` de la carte n'en est que le miroir (et permet à
  // l'admin de déplacer une carte sans toucher au set).
  const meta = output.map(({ _tiers, ...rest }) => rest);
  fs.writeFileSync(path.join(dir, 'sets.json'), JSON.stringify(meta, null, '\t'), 'utf8');
  console.log(`écrit : ${path.relative(ROOT, cardsFile)}, ${path.relative(ROOT, path.join(dir, 'sets.json'))}`);
}
