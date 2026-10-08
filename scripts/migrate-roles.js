#!/usr/bin/env node
// Reprise de données : chaque carte reçoit UN RÔLE (catégorie d'attribut `Role`).
//
// Les six rôles remplacent les mots-clés de ciblage et de déplacement :
//   ARCH_107 Tireur d'élite → 🏹 Archer     (même effet `tireur_elite`)
//   ARCH_108 Chasseur       → 🗡️ Assassin   (même effet `chasseur`)
//   ARCH_109 Briseur        → 🔱 Lancier    (même effet `briseur`)
//   ARCH_110 Embusqué       → 🛡️ Tank       (effet `tank` : la ligne du Tank)
//   ARCH_111 Garde du corps → ✚ Soutien    (même effet `garde_du_corps`)
//   ARCH_112 Flanc          → supprimé, ses porteurs deviennent Assassins
//   ARCH_113 (nouveau)      → 🪖 Fantassin  (aucun effet : le comportement par défaut)
//
// Deux mots-clés deviennent aussi des rôles, à leur effet près (rien ne change
// en combat) : 🗼 Tour (`immobile`) et 🐇 Insaisissable (`insaisissable`). Ils
// passent en catégorie `Role` et REMPLACENT le rôle que leurs porteurs avaient.
//
// Une carte qui ne portait aucun de ces mots-clés est CLASSÉE d'après son
// pouvoir, sa portée et son gabarit (PV et DPS rapportés à la médiane de son
// tier) — cf. `rolePour`. C'est un classement DE DÉPART, à corriger en admin.
//
//   node scripts/migrate-roles.js                    # rapport, n'écrit rien
//   node scripts/migrate-roles.js --write            # applique
//   node scripts/migrate-roles.js --initial-data     # vise la SEMENCE du dépôt
//
// IDEMPOTENT : une carte qui porte déjà exactement un rôle n'est pas touchée,
// et les attributs déjà convertis ne sont pas réécrits.
//
// ⚠️ Comme les autres reprises, les DEUX dossiers sont à reprendre :
// `bootstrap()` ne recopie jamais `initial-data/` sur un `data/` déjà peuplé.
const fs = require('fs');
const path = require('path');
const { tierIndex, resolveTiers } = require('../tiers');

const PROJECT = path.join(__dirname, '..');
const DATA = (!process.argv.includes('--initial-data')
  && fs.existsSync(path.join(PROJECT, 'data', 'cards.json')))
  ? path.join(PROJECT, 'data')
  : path.join(PROJECT, 'initial-data');

const WRITE = process.argv.includes('--write');
const file = f => path.join(DATA, f);
const load = f => JSON.parse(fs.readFileSync(file(f), 'utf8'));

/** Écriture ATOMIQUE, comme `writeJson` côté serveur. */
function save(f, value) {
  const tmp = `${file(f)}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, '\t')}\n`);
  fs.renameSync(tmp, file(f));
}

const ROLE_CATEGORY = 'Role';
const FLANC = 'ARCH_112';

/** Les six rôles de base : l'id d'attribut, son nom, son icône, l'effet de son palier à 1. */
const ROLES = {
  fantassin: { id: 'ARCH_113', name: 'Fantassin', icon: '🪖', effet: null },
  tank:      { id: 'ARCH_110', name: 'Tank',      icon: '🛡️', effet: 'tank' },
  lancier:   { id: 'ARCH_109', name: 'Lancier',   icon: '🔱', effet: 'briseur' },
  assassin:  { id: 'ARCH_108', name: 'Assassin',  icon: '🗡️', effet: 'chasseur' },
  archer:    { id: 'ARCH_107', name: 'Archer',    icon: '🏹', effet: 'tireur_elite' },
  soutien:   { id: 'ARCH_111', name: 'Soutien',   icon: '✚',  effet: 'garde_du_corps' },
};
const ROLE_IDS = new Set(Object.values(ROLES).map(r => r.id));
/** Les rôles venus des mots-clés, reconnus à leur EFFET (les ids ne sont que des numéros). */
const ROLE_EFFECTS = { immobile: 'tour', insaisissable: 'insaisissable' };

function roleAttribute(r) {
  return {
    id: r.id, name: r.name, icon: r.icon, timing: 'start_of_combat', categorie: ROLE_CATEGORY,
    thresholds: r.effet ? [{ count: 1, medal: 'platinum', effects: [{ type: r.effet }] }] : [],
  };
}

const CONTROLE = new Set(['POWER_PARALYSIS', 'POWER_BLOCK', 'POWER_CONFUSION', 'POWER_DEBUFF', 'POWER_WEAKEN', 'POWER_PUSH', 'POWER_FREEZE']);
const ticks = rate => Math.ceil(77 - 0.75 * Number(rate || 0));
const median = xs => { const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

/** Le rôle de départ d'une carte sans mot-clé de déplacement. */
function rolePour(card, tier, med) {
  const p = card.power?.id ?? null;
  const st = card.stats ?? {};
  const range = Number(st.range ?? 1);
  const m = med[tier] ?? med[1];
  const h = Number(st.hp ?? 0) / m.hp;
  const d = (Number(st.atk ?? 0) / ticks(st.attack_rate)) / m.dps;
  const gab = h >= 1.25 && d <= 1 ? 'mur' : d >= 1.25 && h <= 1 ? 'canon' : h < 0.8 && d < 0.8 ? 'faible' : 'autre';
  if (p === 'POWER_HEAL') return 'soutien';
  if (p === 'POWER_TAUNT') return 'tank';
  if (CONTROLE.has(p)) return 'soutien';
  if (p === 'POWER_TELEPORT') return 'assassin';
  if (range <= 1 && ((p === 'POWER_SHIELD' && gab !== 'faible' && gab !== 'canon') || gab === 'mur')) return 'tank';
  if (p === 'POWER_AOE_ATTACK') return 'archer';
  if (p === 'POWER_POISON' || p === 'POWER_BURN') return 'fantassin';
  if (p === 'POWER_SUMMON_TOKEN') return 'soutien';
  if (range >= 3) return 'archer';
  if (range === 2) return 'lancier';
  if (gab === 'canon' || p === 'POWER_SUPER_ATTACK') return 'lancier';
  return 'fantassin';
}

function main() {
  const attributes = load('attributes.json');
  const cards = load('cards.json');
  const report = [];

  // Les mots-clés « Tour » / « Insaisissable » se reconnaissent à leur EFFET,
  // jamais à leur id (les ids ne sont que des numéros).
  const keywordOf = new Map();
  for (const a of attributes) {
    for (const th of a.thresholds ?? []) for (const e of th.effects ?? []) {
      if (ROLE_EFFECTS[e.type]) keywordOf.set(a.id, e.type);
    }
  }
  for (const id of keywordOf.keys()) ROLE_IDS.add(id);

  // 1. Les attributs : convertis en rôles, Flanc retiré, Fantassin ajouté.
  const byId = new Map(attributes.map(a => [a.id, a]));
  let attrsChanged = false;
  const nextAttrs = attributes.filter(a => a.id !== FLANC).map(a => {
    if (keywordOf.has(a.id)) {
      if (a.categorie === ROLE_CATEGORY) return a;
      attrsChanged = true;
      report.push(`attribut ${a.id} ${a.name} → rôle (catégorie ${a.categorie ?? '—'} → ${ROLE_CATEGORY})`);
      return { ...a, categorie: ROLE_CATEGORY };
    }
    const r = Object.values(ROLES).find(x => x.id === a.id);
    if (!r || a.categorie === ROLE_CATEGORY) return a;
    attrsChanged = true;
    report.push(`attribut ${a.id} ${a.name} → rôle ${r.name}`);
    return roleAttribute(r);
  });
  if (nextAttrs.length !== attributes.length) { attrsChanged = true; report.push(`attribut ${FLANC} Flanc supprimé`); }
  if (!byId.has(ROLES.fantassin.id)) {
    attrsChanged = true;
    nextAttrs.push(roleAttribute(ROLES.fantassin));
    report.push(`attribut ${ROLES.fantassin.id} Fantassin créé`);
  }

  // 2. Les médianes par tier (cartes non exclues de l'équilibrage).
  const tiers = tierIndex(attributes);
  const topTier = c => { const ts = resolveTiers(c, tiers); return ts.length ? ts[ts.length - 1] : 1; };
  const med = {};
  for (let t = 1; t <= 5; t++) {
    const ms = cards.filter(c => !c.balance_excluded && topTier(c) === t);
    if (!ms.length) continue;
    med[t] = {
      hp: median(ms.map(c => Number(c.stats?.hp ?? 0))) || 1,
      dps: median(ms.map(c => Number(c.stats?.atk ?? 0) / ticks(c.stats?.attack_rate))) || 1,
    };
  }

  // 3. Les cartes : un rôle et un seul.
  const counts = {};
  let cardsChanged = 0;
  const nextCards = cards.map(card => {
    let ids = [...(card.attributes ?? [])];
    const hadFlanc = ids.includes(FLANC);
    ids = ids.filter(id => id !== FLANC);
    const held = ids.filter(id => ROLE_IDS.has(id));
    const kwRole = held.find(id => keywordOf.has(id));
    let role;
    if (kwRole) {
      // Tour / Insaisissable REMPLACE le rôle que la carte portait.
      role = ROLE_EFFECTS[keywordOf.get(kwRole)];
      ids = ids.filter(id => !ROLE_IDS.has(id) || id === kwRole);
    } else if (held.length >= 1) {
      // Plusieurs rôles : on garde le premier porté (le cas ne se présente pas
      // sur le catalogue livré, la règle existe pour qu'il ne soit pas muet).
      role = Object.keys(ROLES).find(k => ROLES[k].id === held[0]);
      ids = ids.filter(id => !ROLE_IDS.has(id) || id === held[0]);
    } else {
      role = hadFlanc ? 'assassin' : rolePour(card, topTier(card), med);
      ids.push(ROLES[role].id);
    }
    counts[role] = (counts[role] ?? 0) + 1;
    const same = ids.length === (card.attributes ?? []).length && ids.every((id, i) => id === card.attributes[i]);
    if (same) return card;
    cardsChanged++;
    return { ...card, attributes: ids };
  });

  for (const line of report) console.log(line);
  console.log(`Dossier : ${DATA}`);
  console.log(`Cartes modifiées : ${cardsChanged} / ${cards.length}`);
  for (const k of Object.keys(ROLES)) console.log(`  ${ROLES[k].icon} ${ROLES[k].name.padEnd(13)} ${counts[k] ?? 0}`);
  for (const k of Object.values(ROLE_EFFECTS)) console.log(`  ${k.padEnd(16)} ${counts[k] ?? 0}`);
  if (!WRITE) { console.log('(rapport seul — --write pour appliquer)'); return; }
  if (attrsChanged) save('attributes.json', nextAttrs);
  if (cardsChanged) save('cards.json', nextCards);
  console.log('Écrit.');
}

main();
