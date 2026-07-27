// Missions quotidiennes : tirage, suivi de progression, barème et jauge
// hebdomadaire. db.js ne porte que l'accès SQL ; les RÈGLES sont ici — même
// découpage que progression.js, dont ce module est le client pour créditer les
// gains (grant).
//
//   - 3 missions délivrées par jour, reset à 5 h (heure du serveur)
//   - accumulation jusqu'à 9 missions actives (3 jours d'absence pardonnés)
//   - 1 reroll gratuit par jour, puis 100 golds
//   - chaque mission terminée = 1 point sur une jauge hebdomadaire de 15,
//     avec un palier tous les 5 points
//
// Le système ne lit JAMAIS l'état du jeu : il consomme un flux d'événements
// nommés (brief §4.3). C'est ce qui permet au moteur de rester gelé — un
// nouveau type de mission ne demande qu'une entrée de catalogue, pas une
// modification de la logique de combat.
const path = require('path');
const fs = require('fs');
const { db, stmt } = require('./db');
const progression = require('./progression');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const MISSIONS_FILE = path.join(DATA_DIR, 'missions.json');
const CARDS_FILE = path.join(DATA_DIR, 'cards.json');

// Ancre du calendrier, dans le fuseau du SERVEUR (pas celui du joueur : une
// session HTTP ne transporte pas de fuseau fiable, et un reset négociable côté
// client serait un exploit — il suffirait de mentir sur son fuseau pour tirer
// un cycle de plus). Déployer avec TZ=Europe/Paris pour coller au public visé.
const RESET_HOUR = 5;

// Les missions tombent par CYCLES de 8 h, ancrés sur RESET_HOUR : 5 h, 13 h,
// 21 h. Trois rendez-vous par jour plutôt qu'un seul — un joueur qui passe le
// soir ne se heurte plus à une réserve vidée le matin.
const CYCLE_HOURS = 8;
const CYCLES_PER_DAY = 24 / CYCLE_HOURS;   // 3

const CYCLE_COUNT = 3;        // missions délivrées par cycle (une par slot)
const MAX_ACTIVE = 9;         // plafond d'accumulation (= 3 cycles, soit 24 h)
const SLOTS = [1, 2, 3];      // facile / moyen / engagé — un de chaque par cycle
const REROLL_COST = 100;      // golds, après le reroll gratuit du jour

// Barème par difficulté de slot (brief §5.1). Source unique : une mission ne
// porte pas ses propres montants, sinon le barème dérive au fil du catalogue.
const SLOT_REWARDS = Object.freeze({
  1: { xp: 60, gold: 50 },
  2: { xp: 100, gold: 100 },
  3: { xp: 150, gold: 175 },
});

// Jauge hebdomadaire : 1 point par mission terminée, un palier tous les 10.
// Le plafond à 30 (et non 63 = 3 cycles × 3 missions × 7 jours) n'exige ni
// d'être là aux trois cycles, ni tous les jours.
const WEEKLY_MAX = 30;
const WEEKLY_MILESTONES = Object.freeze([
  { points: 10, rewards: { gold: 150, gems: 10, xp: 50 } },
  { points: 20, rewards: { gold: 250, gems: 25, xp: 100 } },
  { points: 30, rewards: { gold: 500, gems: 50, xp: 200 } },
]);

// Garde-fous d'entrée : une requête d'événements est plafonnée en taille.
const MAX_EVENTS_PER_BATCH = 400;
// Anti-concede (brief §3.3) : une partie n'est comptabilisée qu'à partir du
// lancement du 2ᵉ combat, et une partie sans aucune invocation (AFK) ne
// rapporte rien. Dérivé du contenu du lot, jamais d'un drapeau du client.
const MIN_COMBATS_COUNTABLE = 2;
// Événements acceptés hors partie (écrans méta).
const META_EVENTS = Object.freeze(['deck_saved']);

// --- Catalogue (cache mémoire invalidé au mtime, comme progression.allCardIds) ---

let _catalog = { mtime: -1, list: [] };

function catalog() {
  try {
    const mtime = fs.statSync(MISSIONS_FILE).mtimeMs;
    if (mtime !== _catalog.mtime) {
      const raw = JSON.parse(fs.readFileSync(MISSIONS_FILE, 'utf8'));
      _catalog = { mtime, list: (Array.isArray(raw) ? raw : []).filter(m => m && m.id && m.objective) };
    }
  } catch {
    // missions.json absent/illisible : on garde le dernier catalogue connu.
  }
  return _catalog.list;
}

function missionDef(id) {
  return catalog().find(m => m.id === id) || null;
}

let _cards = { mtime: -1, byId: new Map() };

function cardsById() {
  try {
    const mtime = fs.statSync(CARDS_FILE).mtimeMs;
    if (mtime !== _cards.mtime) {
      const raw = JSON.parse(fs.readFileSync(CARDS_FILE, 'utf8'));
      _cards = { mtime, byId: new Map((Array.isArray(raw) ? raw : []).map(c => [c.id, c])) };
    }
  } catch { /* dernier cache connu */ }
  return _cards.byId;
}

// --- Calendrier ---

const pad = n => String(n).padStart(2, '0');
const stamp = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** Jour de mission d'un instant : la journée court de 5 h à 5 h. */
function dayKey(ts = Date.now()) {
  return stamp(new Date(ts - RESET_HOUR * 3600_000));
}

/** Cycle de 8 h : `2026-07-27#1` — le jour de mission, puis le rang du créneau. */
function cycleKey(ts = Date.now()) {
  const d = new Date(ts - RESET_HOUR * 3600_000);
  return `${stamp(d)}#${Math.floor(d.getHours() / CYCLE_HOURS)}`;
}

/**
 * Rang absolu d'un cycle, pour pouvoir en soustraire deux. Une clé sans `#`
 * (état écrit avant le passage aux cycles) est lue comme le premier créneau de
 * sa journée — le joueur reçoit alors les cycles écoulés depuis, ce qui est le
 * comportement voulu.
 */
function cycleNumber(key) {
  if (!key) return null;
  const [day, slot = '0'] = String(key).split('#');
  const t = Date.parse(`${day}T00:00:00Z`);
  if (Number.isNaN(t)) return null;
  return Math.round(t / 86_400_000) * CYCLES_PER_DAY + Number(slot || 0);
}

/** Nombre de cycles entre deux clés (b − a), 0 si l'une est absente. */
function cyclesBetween(a, b) {
  const na = cycleNumber(a);
  const nb = cycleNumber(b);
  if (na == null || nb == null) return 0;
  return Math.max(0, nb - na);
}

/** Semaine de mission : date du lundi de la semaine (jour décalé de 5 h). */
function weekKey(ts = Date.now()) {
  const d = new Date(ts - RESET_HOUR * 3600_000);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); // 0 = lundi
  return stamp(d);
}

/** Fin du cycle courant (timestamp) — compte à rebours affiché par le client. */
function nextResetAt(ts = Date.now()) {
  // Raisonner sur la date DÉCALÉE (où la journée commence à 0 h) évite d'avoir
  // à traiter à part le créneau qui enjambe minuit ; on remet le décalage à la
  // fin. `new Date(…, 24, …)` déborde proprement sur le lendemain.
  const d = new Date(ts - RESET_HOUR * 3600_000);
  const slot = Math.floor(d.getHours() / CYCLE_HOURS);
  const end = new Date(d.getFullYear(), d.getMonth(), d.getDate(), (slot + 1) * CYCLE_HOURS, 0, 0, 0);
  return end.getTime() + RESET_HOUR * 3600_000;
}

// --- État du joueur ---

function readState(userId) {
  const row = stmt.missionStateByUser.get(userId);
  return {
    user_id: userId,
    last_issued_day: row?.last_issued_day ?? null,
    week_key: row?.week_key ?? null,
    weekly_points: row?.weekly_points ?? 0,
    weekly_claimed: parseClaimed(row?.weekly_claimed),
    reroll_free_day: row?.reroll_free_day ?? null,
  };
}

function parseClaimed(raw) {
  try {
    const v = JSON.parse(raw ?? '[]');
    return Array.isArray(v) ? v.map(Number).filter(Number.isFinite) : [];
  } catch { return []; }
}

function writeState(state) {
  stmt.upsertMissionState.run({
    user_id: state.user_id,
    last_issued_day: state.last_issued_day,
    week_key: state.week_key,
    weekly_points: state.weekly_points,
    weekly_claimed: JSON.stringify(state.weekly_claimed),
    reroll_free_day: state.reroll_free_day,
  });
}

// --- Éligibilité d'une mission ---

/**
 * Une mission dont le joueur ne possède pas de quoi l'accomplir n'est jamais
 * tirée (brief §4.2 : « non négociable, première cause d'abandon des systèmes
 * de missions »). Le filtre porte sur la collection réelle du joueur.
 */
function meetsRequirements(ownedIds, def) {
  const req = def.requirements;
  if (!req) return true;
  const m = req.owns_cards_matching;
  if (!m) return true;
  const cards = cardsById();
  let n = 0;
  for (const id of ownedIds) {
    const c = cards.get(id);
    if (!c) continue;
    if (m.summon_type && c.summon_type !== m.summon_type) continue;
    if (m.tier_min != null && !(Number(c.tier) >= m.tier_min)) continue;
    if (++n >= (m.count ?? 1)) return true;
  }
  return false;
}

/** Tirage d'une mission de poids donné, en évitant les `exclude` (ids catalogue). */
function pickMission(weight, exclude, ownedIds) {
  const pool = catalog().filter(m =>
    m.slot_weight === weight && !exclude.has(m.id) && meetsRequirements(ownedIds, m));
  // Repli : si tout le pool du poids est déjà servi, on autorise le doublon
  // plutôt que de rendre un slot vide — un slot manquant coûte un point hebdo.
  const source = pool.length ? pool : catalog().filter(m =>
    m.slot_weight === weight && meetsRequirements(ownedIds, m));
  if (!source.length) return null;
  return source[Math.floor(Math.random() * source.length)];
}

// --- Délivrance par cycle ---

/**
 * Aligne les missions du joueur sur le cycle courant : délivre les lots
 * manquants (un par cycle écoulé, 3 cycles maximum), fait tourner la semaine,
 * purge les missions terminées des journées révolues. Idempotent — appelé à
 * chaque lecture.
 */
const sync = db.transaction((user) => {
  const userId = user.id;
  const state = readState(userId);
  const today = dayKey();
  const cycle = cycleKey();
  const week = weekKey();

  // Nouvelle semaine → la jauge repart de zéro (les paliers aussi).
  if (state.week_key !== week) {
    state.week_key = week;
    state.weekly_points = 0;
    state.weekly_claimed = [];
  }

  // Purge à la JOURNÉE et non au cycle : une mission bouclée à 12 h 55 ne doit
  // pas disparaître de l'écran à 13 h. Les clés de cycle (`2026-07-27#1`) se
  // comparent bien à une clé de jour — le jour nu trie avant tous ses cycles.
  stmt.deleteStaleCompletedMissions.run(userId, today);

  const missed = state.last_issued_day ? cyclesBetween(state.last_issued_day, cycle) : 1;
  if (missed > 0) {
    const ownedIds = progression.unlockedCardIds(user);
    // Au-delà de 3 cycles (24 h) d'absence, on ne rattrape que 3 lots : c'est le
    // plafond d'accumulation, pas une dette qui s'accumule indéfiniment.
    const batches = Math.min(missed, Math.ceil(MAX_ACTIVE / CYCLE_COUNT));
    const now = Date.now();
    for (let b = 0; b < batches; b++) {
      const active = stmt.activeMissionsByUser.all(userId);
      if (active.length >= MAX_ACTIVE) break;
      const exclude = new Set(active.map(r => r.mission_id));
      for (const weight of SLOTS) {
        if (stmt.countActiveMissions.get(userId).c >= MAX_ACTIVE) break;
        const def = pickMission(weight, exclude, ownedIds);
        if (!def) continue;
        exclude.add(def.id);
        stmt.insertMission.run({
          id: `${userId}:${def.id}:${now}:${Math.random().toString(36).slice(2, 8)}`,
          user_id: userId,
          mission_id: def.id,
          slot_weight: def.slot_weight,
          target: Math.max(1, def.objective.target ?? 1),
          issued_day: cycle,
          issued_at: now,
        });
      }
    }
    state.last_issued_day = cycle;
  }

  writeState(state);
  return state;
});

// --- Application des événements ---

/** Un événement satisfait-il l'objectif ? Tout filtre absent de l'événement échoue. */
function eventMatches(ev, obj) {
  if (!ev || ev.type !== obj.event) return false;
  const f = obj.filters || {};
  const num = v => Number(v);
  if (f.summon_type && ev.summon_type !== f.summon_type) return false;
  if (f.tier_min != null && !(num(ev.tier) >= f.tier_min)) return false;
  if (f.result && ev.result !== f.result) return false;
  if (f.rounds_min != null && !(num(ev.rounds_played) >= f.rounds_min)) return false;
  if (f.unit_count_min != null && !(num(ev.unit_count) >= f.unit_count_min)) return false;
  if (f.unit_count_max != null && !(num(ev.unit_count) <= f.unit_count_max)) return false;
  if (f.units_lost_max != null && !(num(ev.units_lost) <= f.units_lost_max)) return false;
  if (f.attribute_count_min != null && !(num(ev.attribute_count) >= f.attribute_count_min)) return false;
  if (f.max_attribute_units_min != null && !(num(ev.max_attribute_units) >= f.max_attribute_units_min)) return false;
  if (f.effect_type && ev.effect_type !== f.effect_type) return false;
  if (f.effect_type_in && !f.effect_type_in.includes(ev.effect_type)) return false;
  if (f.card_count_min != null && !(num(ev.card_count) >= f.card_count_min)) return false;
  return true;
}

/**
 * Apport d'un lot d'événements à un objectif.
 *   - `add`     : cumul entre parties (scope `cumulative`)
 *   - `atLeast` : plancher atteint dans UNE partie / UN combat — la progression
 *                 ne s'additionne pas d'un lot à l'autre, elle prend le maximum
 *                 (sinon « 6 pouvoirs dans un même combat » se validerait avec
 *                 6 combats à 1 pouvoir).
 * Un lot = une partie (le client vide sa file en fin de partie), d'où la
 * portée `single_match` = le lot entier, sans clé de portée à persister.
 */
function batchDelta(events, obj) {
  const matching = events.filter(e => eventMatches(e, obj));
  if (!matching.length) return { add: 0, atLeast: 0 };
  if (obj.scope === 'single_combat') {
    const byCombat = new Map();
    for (const e of matching) {
      const k = Number.isFinite(Number(e.combat_index)) ? Number(e.combat_index) : 0;
      byCombat.set(k, (byCombat.get(k) || 0) + 1);
    }
    return { add: 0, atLeast: Math.max(...byCombat.values()) };
  }
  if (obj.scope === 'single_match') return { add: 0, atLeast: matching.length };
  return { add: matching.length, atLeast: 0 };
}

/**
 * Consomme un lot d'événements et crédite ce qui doit l'être.
 *
 * `matchId` présent = lot de partie : il n'est retenu que s'il porte au moins
 * deux `combat_started` (anti-concede) et une invocation (anti-AFK). Absent =
 * lot méta (deck enregistré…), limité aux événements hors combat.
 *
 * → { countable, completed: [{ mission_id, label, rewards }], milestones: [...] }
 */
const applyEvents = db.transaction((user, { matchId = null, events = [] } = {}) => {
  const userId = user.id;
  const list = Array.isArray(events) ? events.slice(0, MAX_EVENTS_PER_BATCH) : [];

  let usable;
  if (matchId) {
    const combats = list.filter(e => e && e.type === 'combat_started').length;
    const summons = list.filter(e => e && e.type === 'summon_performed').length;
    if (combats < MIN_COMBATS_COUNTABLE || summons === 0) {
      return { countable: false, completed: [], milestones: [] };
    }
    usable = list;
  } else {
    usable = list.filter(e => e && META_EVENTS.includes(e.type));
    if (!usable.length) return { countable: true, completed: [], milestones: [] };
  }

  const state = readState(userId);
  const completed = [];
  const now = Date.now();

  for (const row of stmt.activeMissionsByUser.all(userId)) {
    const def = missionDef(row.mission_id);
    if (!def) continue;                       // mission retirée du catalogue
    const { add, atLeast } = batchDelta(usable, def.objective);
    if (!add && !atLeast) continue;

    const progress = Math.min(row.target, Math.max(row.progress + add, atLeast));
    if (progress <= row.progress) continue;

    const done = progress >= row.target;
    stmt.updateMissionProgress.run({
      id: row.id, progress, status: done ? 'completed' : 'active',
      completed_at: done ? now : null,
    });
    if (done) {
      completed.push({
        mission_id: def.id,
        label: renderLabel(def, row.target),
        slot_weight: row.slot_weight,
        rewards: SLOT_REWARDS[row.slot_weight] ?? SLOT_REWARDS[1],
      });
    }
  }

  // Jauge hebdomadaire : 1 point par mission terminée, paliers versés au passage.
  const milestones = [];
  if (completed.length) {
    const before = state.weekly_points;
    state.weekly_points = Math.min(WEEKLY_MAX, before + completed.length);
    for (const ms of WEEKLY_MILESTONES) {
      if (state.weekly_points >= ms.points && !state.weekly_claimed.includes(ms.points)) {
        state.weekly_claimed.push(ms.points);
        milestones.push(ms);
      }
    }
    writeState(state);
  }

  // Un seul crédit pour tout le lot : le client n'envoie que des événements,
  // le serveur applique SON barème (même règle que progression.reward).
  const total = { xp: 0, gold: 0, gems: 0 };
  for (const c of completed) { total.xp += c.rewards.xp ?? 0; total.gold += c.rewards.gold ?? 0; }
  for (const m of milestones) {
    total.xp += m.rewards.xp ?? 0; total.gold += m.rewards.gold ?? 0; total.gems += m.rewards.gems ?? 0;
  }
  if (total.xp || total.gold || total.gems) progression.grant(userId, total);

  return { countable: true, completed, milestones, granted: total };
});

// --- Reroll ---

/**
 * Remplace une mission active par une autre du même slot. Premier reroll de la
 * journée gratuit, les suivants à 100 golds — jamais en gemmes : on ne
 * monétise pas la frustration (brief §3.1).
 * → { ok: false, reason } si impossible.
 */
const reroll = db.transaction((user, rowId) => {
  const row = stmt.missionRowById.get(rowId);
  if (!row || row.user_id !== user.id) return { ok: false, reason: 'Mission introuvable.' };
  if (row.status !== 'active') return { ok: false, reason: 'Mission déjà terminée.' };

  const state = readState(user.id);
  const today = dayKey();
  const free = state.reroll_free_day !== today;
  const gold = user.gold ?? 0;
  if (!free && gold < REROLL_COST) {
    return { ok: false, reason: `Reroll gratuit déjà utilisé — ${REROLL_COST} golds requis.` };
  }

  const active = stmt.activeMissionsByUser.all(user.id);
  const exclude = new Set(active.map(r => r.mission_id));
  const def = pickMission(row.slot_weight, exclude, progression.unlockedCardIds(user));
  if (!def) return { ok: false, reason: 'Aucune autre mission disponible pour ce slot.' };

  stmt.deleteMission.run(row.id);
  stmt.insertMission.run({
    id: `${user.id}:${def.id}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`,
    user_id: user.id,
    mission_id: def.id,
    slot_weight: def.slot_weight,
    target: Math.max(1, def.objective.target ?? 1),
    issued_day: row.issued_day,
    issued_at: Date.now(),
  });

  if (free) {
    state.reroll_free_day = today;
    writeState(state);
  } else {
    progression.grant(user.id, { gold: -REROLL_COST });
  }
  return { ok: true, free, cost: free ? 0 : REROLL_COST };
});

// --- Lecture ---

/** Libellé affiché : `{target}` est substitué par la cible réelle de la ligne. */
function renderLabel(def, target) {
  return String(def.label ?? def.id).replace(/\{target\}/g, String(target));
}

const SCOPE_HINTS = Object.freeze({
  single_match: 'dans une même partie',
  single_combat: 'dans un même combat',
});

/**
 * Instantané complet servi au client : missions du jour, jauge hebdomadaire,
 * état du reroll, prochain reset. Les montants viennent du serveur — le client
 * ne calcule aucune récompense.
 */
function getSnapshot(user) {
  const state = readState(user.id);
  const today = dayKey();
  const missions = stmt.missionsByUser.all(user.id).map(row => {
    const def = missionDef(row.mission_id);
    return {
      id: row.id,
      mission_id: row.mission_id,
      family: def?.family ?? 'unknown',
      label: def ? renderLabel(def, row.target) : row.mission_id,
      scope: def?.objective?.scope ?? 'cumulative',
      scope_hint: SCOPE_HINTS[def?.objective?.scope] ?? null,
      slot_weight: row.slot_weight,
      progress: row.progress,
      target: row.target,
      status: row.status,
      rewards: SLOT_REWARDS[row.slot_weight] ?? SLOT_REWARDS[1],
    };
  });

  return {
    missions,
    cycle: {
      count: CYCLE_COUNT, hours: CYCLE_HOURS,
      max_active: MAX_ACTIVE, next_reset_at: nextResetAt(),
    },
    weekly: {
      points: state.weekly_points,
      max: WEEKLY_MAX,
      milestones: WEEKLY_MILESTONES.map(m => ({
        points: m.points,
        rewards: m.rewards,
        claimed: state.weekly_claimed.includes(m.points),
      })),
    },
    reroll: { free_available: state.reroll_free_day !== today, cost: REROLL_COST },
  };
}

/** Sync + snapshot — le point d'entrée normal des routes. */
function refresh(user) {
  sync(user);
  return getSnapshot(user);
}

module.exports = {
  RESET_HOUR, CYCLE_HOURS, CYCLES_PER_DAY, CYCLE_COUNT, MAX_ACTIVE, SLOTS, SLOT_REWARDS,
  WEEKLY_MAX, WEEKLY_MILESTONES, REROLL_COST,
  MAX_EVENTS_PER_BATCH, MIN_COMBATS_COUNTABLE, META_EVENTS,
  catalog, dayKey, cycleKey, cycleNumber, cyclesBetween, weekKey, nextResetAt,
  meetsRequirements, eventMatches, batchDelta, renderLabel,
  sync, applyEvents, reroll, getSnapshot, refresh,
};
