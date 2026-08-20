#!/usr/bin/env node
// Génère les decks des bots du Duel en ligne — dérivés du catalogue, jamais
// écrits à la main.
//
// Même raisonnement que `game/tutorialDeck.ts` : un deck qui nomme ses cartes
// se casse à la première retouche de `cards.json` depuis l'admin, et personne
// ne s'en aperçoit avant qu'un bot ouvre une main injouable. On sélectionne par
// RÈGLE, et `--check` rejoue la validation.
//
//   node scripts/build-bot-decks.js            # affiche le rapport
//   node scripts/build-bot-decks.js --write     # écrit initial-data/bot_decks.json
//   node scripts/build-bot-decks.js --check     # valide le fichier existant (exit 1 si KO)
//
// La contrainte qui commande tout : le catalogue n'a presque aucune carte
// d'invocation NORMALE au-delà du tier 2. Les hauts tiers se construisent donc
// UNIQUEMENT à partir de ce que le deck couvre déjà (ids et attributs), sans
// quoi la main des derniers tours se remplit de cartes définitivement
// injouables — et un bot qui ne pose rien est pire qu'un bot absent.
const fs = require('fs');
const path = require('path');

const PROJECT = path.join(__dirname, '..');
const DATA = fs.existsSync(path.join(PROJECT, 'data', 'cards.json'))
  ? path.join(PROJECT, 'data')
  : path.join(PROJECT, 'initial-data');
const OUT = path.join(PROJECT, 'initial-data', 'bot_decks.json');

const load = f => JSON.parse(fs.readFileSync(path.join(DATA, f), 'utf8'));
const asArray = x => (Array.isArray(x) ? x : Object.values(x));

const ALL = asArray(load('cards.json'));
const ATTRS = asArray(load('attributes.json'));
const attrName = Object.fromEntries(ATTRS.map(a => [a.id, a.name]));

// ---------------------------------------------------------------- règles

/** Dieu Égyptien : hors thème partout, et il tomberait dans la moitié des decks
 *  (une option « sacrifice 3 » suffit à le rendre invocable). Réservé aux
 *  thèmes qui le demandent explicitement. */
const GOD = 'ARCH_031';

/** Le socle : 7 cartes posables sans matériau par tier bas, puis ce que la
 *  couverture permet. 24 cartes minimum (la règle du DeckBuilder en exige 20). */
const PER_TIER = { 1: 7, 2: 7, 3: 6, 4: 4, 5: 2 };
const MIN_TOTAL = 24;

/** Plancher de puissance par tier (p25 du catalogue) : mieux vaut un tier plus
 *  court qu'une carte de haut tier plus faible que le socle qu'elle remplace. */
const FLOOR = { 3: 600, 4: 800, 5: 1100 };

const isNormal = c => (c.summon_type ?? 'normal') === 'normal';
const hasAttr = (c, a) => (c.attributes || []).includes(a);
const rawPower = c => (c.stats?.atk ?? 0) * 20 + (c.stats?.hp ?? 0);
const costsOf = c => (c.summon_options?.length ? c.summon_options.map(o => o.cost) : [c.cost]);

/** Une recette suffit. Un matériau `ARCH_*` désigne n'importe quel porteur. */
function summonable(card, ids, attrs) {
  return costsOf(card).some(cost =>
    ((cost && cost.materials) || []).every(m => (m.startsWith('ARCH_') ? attrs.has(m) : ids.has(m))));
}

function themeScore(c, theme) {
  let s = 0;
  theme.core.forEach((a, i) => { if (hasAttr(c, a)) s += i === 0 ? 120 : 80; });
  (theme.support || []).forEach(a => { if (hasAttr(c, a)) s += 25; });
  return s;
}

/** Ce qui distingue deux bots au-delà de leur archétype : comment ils jouent. */
function profileScore(c, profile) {
  const st = c.stats || {};
  switch (profile) {
    case 'aggro':    return st.atk * 30 - (st.attack_speed || 10) * 8 + (st.hp || 0) * 0.4;
    case 'tank':     return (st.hp || 0) * 1.6 + st.atk * 8;
    case 'distance': return ((st.range || 1) >= 2 ? 400 : 0) + st.atk * 18 + (st.hp || 0) * 0.5;
    case 'pouvoirs': return (c.power?.id ? 350 - (c.power.power_speed || 60) * 2 : 0) + st.atk * 14 + (st.hp || 0) * 0.6;
    case 'essaim':   return st.atk * 16 + (st.hp || 0) * 0.7;
    default:         return rawPower(c);
  }
}

// ---------------------------------------------------------------- thèmes
// L'ordre compte : les decks se construisent à la suite et chacun évite ce que
// les précédents ont déjà pris (cf. `globalUse`), pour que dix bots ne
// finissent pas par aligner les mêmes staples.
const THEMES = [
  { id: 'BOT_DECK_001', name: 'Nid du Dragon',       pseudo: 'Drakenor',   core: ['ARCH_003'],             support: ['ARCH_048', 'ARCH_045'], profile: 'aggro',    difficulty: 4 },
  { id: 'BOT_DECK_002', name: 'Rouages Anciens',     pseudo: 'Engrenator', core: ['ARCH_059', 'ARCH_025'], support: ['ARCH_056'],             profile: 'tank',     difficulty: 4 },
  { id: 'BOT_DECK_003', name: 'Cercle des Mages',    pseudo: 'Arcanys',    core: ['ARCH_002'],             support: ['ARCH_007'],             profile: 'distance', difficulty: 1 },
  { id: 'BOT_DECK_004', name: 'Marée Abyssale',      pseudo: 'Nérée',      core: ['ARCH_035'],             support: ['ARCH_049', 'ARCH_047'], profile: 'essaim',   difficulty: 3 },
  { id: 'BOT_DECK_005', name: 'Essaim Rampant',      pseudo: 'Chrysalis',  core: ['ARCH_033'],             support: ['ARCH_058'],             profile: 'essaim',   difficulty: 2 },
  { id: 'BOT_DECK_006', name: 'Charnier Sans Fin',   pseudo: 'Ossuaire',   core: ['ARCH_029', 'ARCH_030'], support: ['ARCH_019'],             profile: 'pouvoirs', difficulty: 2 },
  { id: 'BOT_DECK_007', name: 'Serment du Guerrier', pseudo: 'Gearheart',  core: ['ARCH_001'],             support: ['ARCH_018', 'ARCH_017'], profile: 'aggro',    difficulty: 3 },
  { id: 'BOT_DECK_008', name: 'Pacte Démoniaque',    pseudo: 'Malphas',    core: ['ARCH_019', 'ARCH_020'], support: ['ARCH_048'],             profile: 'pouvoirs', difficulty: 3 },
  { id: 'BOT_DECK_009', name: 'Meute Sauvage',       pseudo: 'Fauvex',     core: ['ARCH_021'],             support: ['ARCH_045', 'ARCH_050'], profile: 'aggro',    difficulty: 2 },
  { id: 'BOT_DECK_010', name: 'Ère des Dinosaures',  pseudo: 'Sauroka',    core: ['ARCH_034'],             support: ['ARCH_050'],             profile: 'tank',     difficulty: 1 },
];

// ---------------------------------------------------------------- build

const globalUse = {}; // id -> nb de decks l'ayant déjà pris

function buildDeck(theme) {
  const deck = {};
  const ids = new Set();
  const attrs = new Set();
  const used = new Set();
  const take = c => { ids.add(c.id); (c.attributes || []).forEach(a => attrs.add(a)); };
  const allowGod = [...theme.core, ...(theme.support || [])].includes(GOD);
  const eligible = c => allowGod || !hasAttr(c, GOD);
  const rank = c => themeScore(c, theme) * 10 + profileScore(c, theme.profile) * 0.3
                    - (globalUse[c.id] || 0) * 900;
  const sort = (x, y) => rank(y) - rank(x) || x.id.localeCompare(y.id);

  // 1. Le socle : tiers 1-2, ce qui se pose sans matériau (le sacrifice au
  //    tier 2 se paie avec le tier 1 déjà en jeu).
  for (const t of [1, 2]) {
    const base = ALL.filter(c => c.tier === t && !used.has(c.id) && eligible(c)
      && (isNormal(c) || (c.summon_type === 'sacrifice' && t === 2)));
    const onTheme = base.filter(c => themeScore(c, theme) > 0).sort(sort);
    const rest = base.filter(c => themeScore(c, theme) === 0).sort(sort);
    const picked = [];
    for (const c of [...onTheme, ...rest]) {
      if (picked.length >= PER_TIER[t]) break;
      picked.push(c); used.add(c.id); take(c);
    }
    deck[t] = picked;
  }

  // 2. Les hauts tiers : uniquement ce que le deck permet déjà d'invoquer. Une
  //    fusion de tier 3 retenue alimente à son tour la couverture du tier 4.
  const spare = {};
  for (const t of [3, 4, 5]) {
    const ok = ALL.filter(c => c.tier === t && !used.has(c.id) && eligible(c)
      && rawPower(c) >= FLOOR[t] && summonable(c, ids, attrs));
    const strict = ok.filter(c => theme.core.some(a => hasAttr(c, a)));
    const soft = ok.filter(c => !strict.includes(c) && themeScore(c, theme) > 0);
    spare[t] = ok.filter(c => !strict.includes(c) && !soft.includes(c)).sort(sort);
    const picked = [];
    for (const c of [...strict.sort(sort), ...soft.sort(sort)]) {
      if (picked.length >= PER_TIER[t]) break;
      picked.push(c); used.add(c.id); take(c);
    }
    deck[t] = picked;
  }

  // 3. Complément hors thème, en DERNIER recours seulement : un tier plus court
  //    vaut mieux qu'une carte que rien dans le deck ne fait résonner.
  const size = () => [1, 2, 3, 4, 5].reduce((a, t) => a + deck[t].length, 0);
  for (const t of [3, 4, 5]) {
    while (size() < MIN_TOTAL && deck[t].length < PER_TIER[t] && spare[t].length) {
      const c = spare[t].shift();
      deck[t].push(c); used.add(c.id); take(c);
    }
  }

  [1, 2, 3, 4, 5].forEach(t => deck[t].forEach(c => { globalUse[c.id] = (globalUse[c.id] || 0) + 1; }));
  return deck;
}

// ---------------------------------------------------------------- validate

/** Les mêmes règles que le DeckBuilder et `InvocationManager`, rejouées à froid. */
function validate(entry) {
  const byId = Object.fromEntries(ALL.map(c => [c.id, c]));
  const errs = [];
  const flat = Object.values(entry.deck).flat();

  if (new Set(flat).size !== flat.length) errs.push('carte en double');
  if (flat.length < 20) errs.push(`${flat.length} cartes (minimum 20)`);
  for (const [t, list] of Object.entries(entry.deck)) {
    if (list.length > 8) errs.push(`tier ${t} : ${list.length} cartes (maximum 8)`);
    for (const id of list) {
      if (!byId[id]) errs.push(`id inconnu : ${id}`);
      else if (String(byId[id].tier) !== String(t)) errs.push(`${id} est tier ${byId[id].tier}, rangé en ${t}`);
    }
  }

  // Couverture : un tier ne peut compter que sur les tiers qui le précèdent.
  const ids = new Set();
  const attrs = new Set();
  for (const t of [1, 2, 3, 4, 5]) {
    const cur = (entry.deck[String(t)] || []).map(id => byId[id]).filter(Boolean);
    for (const c of cur) {
      if (!summonable(c, ids, attrs)) errs.push(`INJOUABLE : ${c.id} (${c.name}, ${c.summon_type})`);
    }
    cur.forEach(c => { ids.add(c.id); (c.attributes || []).forEach(a => attrs.add(a)); });
  }

  // Pool de pioche par tour (cf. Draw System) : une main vide est un tour perdu.
  const POOL = { 1: [1], 2: [1, 2], 3: [1, 2, 3], 4: [2, 3, 4], 5: [3, 4, 5] };
  for (const [round, tiers] of Object.entries(POOL)) {
    const n = tiers.reduce((a, t) => a + (entry.deck[String(t)] || []).length, 0);
    if (n < 5) errs.push(`tour ${round} : seulement ${n} cartes piochables`);
  }
  return errs;
}

// ---------------------------------------------------------------- report

function report(entries) {
  const byId = Object.fromEntries(ALL.map(c => [c.id, c]));
  let failed = 0;
  for (const e of entries) {
    const flat = Object.values(e.deck).flat();
    const cards = flat.map(id => byId[id]).filter(Boolean);
    const cnt = {};
    cards.forEach(c => (c.attributes || []).forEach(a => { cnt[a] = (cnt[a] || 0) + 1; }));
    const top = Object.entries(cnt).sort((a, b) => b[1] - a[1]).slice(0, 4)
      .map(([a, n]) => `${attrName[a]}·${n}`).join(' ');
    const errs = validate(e);
    if (errs.length) failed++;
    console.log(
      `${errs.length ? '✗' : '✓'} ${e.id}  ${e.name.padEnd(20)} ${String(flat.length).padStart(2)}c  `
      + `diff ${e.difficulty}  ${e.profile.padEnd(9)} ${top}`,
    );
    errs.forEach(x => console.log(`     ${x}`));
  }
  return failed;
}

// ---------------------------------------------------------------- main

const args = process.argv.slice(2);
if (args.includes('--check')) {
  if (!fs.existsSync(OUT)) { console.error(`${OUT} absent — lancer --write d'abord.`); process.exit(1); }
  const failed = report(JSON.parse(fs.readFileSync(OUT, 'utf8')));
  process.exit(failed ? 1 : 0);
}

const entries = THEMES.map(t => ({
  id: t.id,
  name: t.name,
  pseudo: t.pseudo,
  archetype: [...t.core, ...(t.support || [])].map(a => attrName[a]).filter(Boolean).join(' · '),
  profile: t.profile,
  difficulty: t.difficulty,
  deck: Object.fromEntries(Object.entries(buildDeck(t)).map(([k, v]) => [k, v.map(c => c.id)])),
}));

const failed = report(entries);
if (args.includes('--write')) {
  if (failed) { console.error('\nRien écrit : au moins un deck ne valide pas.'); process.exit(1); }
  fs.writeFileSync(OUT, `${JSON.stringify(entries, null, 2)}\n`);
  console.log(`\n→ ${path.relative(PROJECT, OUT)} (${entries.length} decks)`);
}
process.exit(failed ? 1 : 0);
