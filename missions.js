// Missions quotidiennes : tirage, suivi de progression, barème et jauge
// hebdomadaire. db.js ne porte que l'accès SQL ; les RÈGLES sont ici — même
// découpage que progression.js, dont ce module est le client pour créditer les
// gains (grant).
//
//   - 2 missions délivrées par cycle de 8 h, ancré sur 5 h (heure du serveur)
//   - accumulation jusqu'à 6 missions actives (24 h d'absence pardonnées)
//   - 1 reroll gratuit par jour, puis 100 golds
//   - le gain d'une mission se RÉCUPÈRE d'un tap (`claim`)
//   - chaque mission RÉCUPÉRÉE = 1 point sur une jauge hebdomadaire de 25,
//     avec un palier tous les 5 points, qui se récupère lui aussi d'un tap
//     (`claimMilestone`) — et qui est soldé d'office au changement de semaine
//     s'il a été atteint sans être réclamé
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

const CYCLE_COUNT = 2;        // missions délivrées par cycle
const MAX_ACTIVE = 6;         // plafond d'accumulation (= 3 cycles, soit 24 h)
const SLOTS = [1, 2, 3];      // difficultés du catalogue : facile / moyen / engagé
const REROLL_COST = 100;      // golds, après le reroll gratuit du jour

// Deux missions par cycle mais trois difficultés : la paire TOURNE avec le
// créneau, elle n'est pas tirée au hasard (« éviter le hasard caché »). Sur
// trois cycles consécutifs — soit exactement une journée, et exactement le
// plafond d'accumulation — chaque difficulté sort deux fois : le joueur qui
// rattrape 24 h d'absence reçoit la même chose que celui qui est passé aux
// trois rendez-vous.
const SLOT_ROTATION = Object.freeze([[1, 2], [2, 3], [3, 1]]);

/** Paire de difficultés d'un cycle, désignée par son rang absolu (cycleNumber). */
function slotsForCycle(rank) {
  const n = SLOT_ROTATION.length;
  return SLOT_ROTATION[(((rank | 0) % n) + n) % n];
}

// Barème par difficulté de slot (brief §5.1). Source unique : une mission ne
// porte pas ses propres montants, sinon le barème dérive au fil du catalogue.
const SLOT_REWARDS = Object.freeze({
  1: { xp: 6, gold: 50 },
  2: { xp: 10, gold: 100 },
  3: { xp: 15, gold: 175 },
});

// Jauge hebdomadaire : 1 point par mission RÉCUPÉRÉE, un palier tous les 5
// (modèle Marvel Snap — un jalon assez proche pour qu'il y ait toujours une
// raison de finir la mission en cours). Le plafond à 25 (et non 42 = 2 missions
// × 3 cycles × 7 jours) n'exige ni d'être là aux trois cycles, ni tous les
// jours : ~3,6 missions par jour suffisent à le remplir.
//
// La dotation TOTALE de la semaine est inchangée (35 XP / 900 golds / 85 gemmes,
// cf. le barème 10/20/30 précédent) — elle est redistribuée sur cinq marches
// croissantes, la dernière portant la prime : c'est elle qui doit tirer la
// semaine, sinon la jauge s'abandonne une fois l'avant-dernier palier passé.
const WEEKLY_MAX = 25;
const WEEKLY_MILESTONES = Object.freeze([
  { points: 5,  rewards: { gold: 100, gems: 5,  xp: 3 } },
  { points: 10, rewards: { gold: 150, gems: 10, xp: 5 } },
  { points: 15, rewards: { gold: 175, gems: 15, xp: 6 } },
  { points: 20, rewards: { gold: 200, gems: 20, xp: 8 } },
  { points: 25, rewards: { gold: 275, gems: 35, xp: 13 } },
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
 * manquants (un lot de CYCLE_COUNT par cycle écoulé, 3 cycles maximum), fait
 * tourner la semaine, purge les missions terminées des journées révolues.
 * Idempotent — appelé à chaque lecture.
 */
const sync = db.transaction((user) => {
  const userId = user.id;
  const state = readState(userId);
  const today = dayKey();
  const cycle = cycleKey();
  const week = weekKey();

  // Nouvelle semaine → la jauge repart de zéro (les paliers aussi).
  //
  // ⚠️ Mais on SOLDE d'abord les paliers atteints et jamais récupérés. Depuis
  // qu'un palier se réclame d'un tap, le reset pourrait confisquer un gain déjà
  // mérité — c'est exactement ce qu'on refuse aux missions terminées (jamais
  // purgées). Une jauge qui repart à zéro ne peut pas, elle, porter ses restes
  // d'une semaine à l'autre : on règle donc l'ardoise à la frontière plutôt que
  // de traîner un état en travers. Le tap reste le geste normal ; ceci n'est
  // que le filet, et il est silencieux (le solde, lui, est juste).
  if (state.week_key !== week) {
    const due = WEEKLY_MILESTONES.filter(ms =>
      state.weekly_points >= ms.points && !state.weekly_claimed.includes(ms.points));
    if (due.length) {
      const total = { xp: 0, gold: 0, gems: 0 };
      for (const ms of due) {
        total.xp += ms.rewards.xp ?? 0;
        total.gold += ms.rewards.gold ?? 0;
        total.gems += ms.rewards.gems ?? 0;
      }
      progression.grant(userId, total);
    }
    state.week_key = week;
    state.weekly_points = 0;
    state.weekly_claimed = [];
  }

  // Purge à la JOURNÉE et non au cycle : une mission bouclée à 12 h 55 ne doit
  // pas disparaître de l'écran à 13 h. Les clés de cycle (`2026-07-27#1`) se
  // comparent bien à une clé de jour — le jour nu trie avant tous ses cycles.
  // Ne sont purgées que les missions RÉCUPÉRÉES : un gain terminé mais non
  // réclamé attend indéfiniment : il a été mérité, le reset ne le confisque pas.
  stmt.deleteStaleClaimedMissions.run(userId, today);

  const missed = state.last_issued_day ? cyclesBetween(state.last_issued_day, cycle) : 1;
  if (missed > 0) {
    const ownedIds = progression.unlockedCardIds(user);
    // Au-delà de 3 cycles (24 h) d'absence, on ne rattrape que 3 lots : c'est le
    // plafond d'accumulation, pas une dette qui s'accumule indéfiniment.
    const batches = Math.min(missed, Math.ceil(MAX_ACTIVE / CYCLE_COUNT));
    const now = Date.now();
    const rank = cycleNumber(cycle) ?? 0;
    for (let b = 0; b < batches; b++) {
      const active = stmt.activeMissionsByUser.all(userId);
      if (active.length >= MAX_ACTIVE) break;
      const exclude = new Set(active.map(r => r.mission_id));
      // Le lot rattrapé garde la paire de SON cycle (du plus ancien au courant),
      // pas celle du cycle d'arrivée : c'est ce qui rend le rattrapage complet.
      for (const weight of slotsForCycle(rank - (batches - 1 - b))) {
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
 * Rien n'est crédité ici : les missions terminées sont ANNONCÉES (`completed`)
 * et attendent leur `claim`, qui porte à la fois le gain et le point de semaine.
 *
 * → { countable, completed: [{ id, mission_id, label, rewards }] }
 */
const applyEvents = db.transaction((user, { matchId = null, events = [] } = {}) => {
  const userId = user.id;
  const list = Array.isArray(events) ? events.slice(0, MAX_EVENTS_PER_BATCH) : [];

  let usable;
  if (matchId) {
    const combats = list.filter(e => e && e.type === 'combat_started').length;
    const summons = list.filter(e => e && e.type === 'summon_performed').length;
    if (combats < MIN_COMBATS_COUNTABLE || summons === 0) {
      return { countable: false, completed: [] };
    }
    usable = list;
  } else {
    usable = list.filter(e => e && META_EVENTS.includes(e.type));
    if (!usable.length) return { countable: true, completed: [] };
  }

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
        id: row.id,
        mission_id: def.id,
        label: renderLabel(def, row.target),
        slot_weight: row.slot_weight,
        // Montant ANNONCÉ, pas crédité : il attend un `claim`.
        rewards: SLOT_REWARDS[row.slot_weight] ?? SLOT_REWARDS[1],
      });
    }
  }

  // RIEN n'est crédité ici, et la jauge hebdomadaire ne bouge pas non plus :
  // terminer une mission ne fait que la rendre récupérable. Tout tombe au
  // `claim` — le gain comme le point de semaine — pour que le joueur voie la
  // barre avancer sous ses yeux au lieu de la découvrir déjà remplie.
  return { countable: true, completed };
});

// --- Récupération d'un gain ---

/**
 * Solde une mission terminée : crédite son barème, avance la jauge de la
 * semaine d'un point et verse les paliers franchis au passage. Le client
 * désigne une LIGNE, jamais un montant — le barème reste au serveur, exactement
 * comme quand le crédit était automatique.
 * → { ok: true, granted, milestones, mission } | { ok: false, reason }
 */
const claim = db.transaction((user, rowId) => {
  const row = stmt.missionRowById.get(rowId);
  if (!row || row.user_id !== user.id) return { ok: false, reason: 'Mission introuvable.' };
  if (row.status === 'claimed') return { ok: false, reason: 'Récompense déjà récupérée.' };
  if (row.status !== 'completed') return { ok: false, reason: 'Mission pas encore terminée.' };

  // La garde `status = 'completed'` est dans le SQL : si l'UPDATE ne touche
  // aucune ligne, quelqu'un est passé avant — on ne crédite pas.
  const res = stmt.claimMission.run({ id: row.id, claimed_at: Date.now() });
  if (!res.changes) return { ok: false, reason: 'Récompense déjà récupérée.' };

  const rewards = SLOT_REWARDS[row.slot_weight] ?? SLOT_REWARDS[1];
  const granted = { xp: rewards.xp ?? 0, gold: rewards.gold ?? 0, gems: rewards.gems ?? 0 };

  // Jauge hebdomadaire : +1 point ICI, à la récupération, et pas à la
  // complétion. C'est ce qui la fait avancer d'un cran sous les yeux du joueur
  // au moment de son tap — une barre déjà remplie avant l'ouverture de l'écran
  // ne raconte aucune progression. Le point n'est jamais perdu pour autant :
  // une mission terminée attend indéfiniment d'être récupérée (elle n'est pas
  // purgée au reset), le crédit est différé, pas confisqué.
  //
  // Le palier franchi au passage n'est pas versé ici : il devient RÉCUPÉRABLE,
  // et attend son propre tap (`claimMilestone`). On le renvoie tout de même
  // pour que le client puisse l'annoncer — « atteint », pas « crédité ».
  const state = readState(user.id);
  const unlocked = [];
  if (state.weekly_points < WEEKLY_MAX) {
    const before = state.weekly_points;
    state.weekly_points += 1;
    for (const ms of WEEKLY_MILESTONES) {
      if (ms.points > before && ms.points <= state.weekly_points) unlocked.push(ms);
    }
    writeState(state);
  }

  progression.grant(user.id, granted);

  const def = missionDef(row.mission_id);
  return {
    ok: true,
    granted,
    unlocked,
    mission: { id: row.id, mission_id: row.mission_id, label: def ? renderLabel(def, row.target) : row.mission_id },
  };
});

/**
 * Récupère un palier hebdomadaire ATTEINT. Même contrat que pour une mission :
 * le client désigne un palier (son nombre de points), le serveur applique son
 * barème. `weekly_claimed` porte exactement le même sens qu'avant — la liste
 * des paliers déjà PAYÉS —, seul le moment du paiement change : au tap et non
 * plus au franchissement. Aucune migration : un palier déjà payé y figure déjà.
 *
 * L'atomicité vient de `db.transaction` (better-sqlite3 est synchrone : deux
 * requêtes concurrentes ne s'entrelacent pas), là où les missions s'appuient
 * sur un `WHERE status = 'completed'` — un tableau JSON ne se garde pas aussi
 * bien en SQL, la transaction fait le même travail.
 * → { ok: true, granted, milestone } | { ok: false, reason }
 */
const claimMilestone = db.transaction((user, points) => {
  const target = Number(points);
  const ms = WEEKLY_MILESTONES.find(m => m.points === target);
  if (!ms) return { ok: false, reason: 'Palier inconnu.' };

  const state = readState(user.id);
  if (state.weekly_points < ms.points) {
    return { ok: false, reason: `Palier pas encore atteint (${state.weekly_points}/${ms.points}).` };
  }
  if (state.weekly_claimed.includes(ms.points)) return { ok: false, reason: 'Palier déjà récupéré.' };

  state.weekly_claimed.push(ms.points);
  writeState(state);

  const granted = { xp: ms.rewards.xp ?? 0, gold: ms.rewards.gold ?? 0, gems: ms.rewards.gems ?? 0 };
  progression.grant(user.id, granted);
  return { ok: true, granted, milestone: { points: ms.points, rewards: ms.rewards } };
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
 *
 * Le nombre de gains en attente ne fait pas partie de la charge : il se dérive
 * des `status` (`completed`). Une valeur dérivée transmise est une valeur qui
 * peut contredire celle dont elle vient.
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
      // 'active' → 'completed' (terminée, gain en attente) → 'claimed' (soldée).
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
  SLOT_ROTATION, slotsForCycle,
  WEEKLY_MAX, WEEKLY_MILESTONES, REROLL_COST,
  MAX_EVENTS_PER_BATCH, MIN_COMBATS_COUNTABLE, META_EVENTS,
  catalog, dayKey, cycleKey, cycleNumber, cyclesBetween, weekKey, nextResetAt,
  meetsRequirements, eventMatches, batchDelta, renderLabel,
  sync, applyEvents, claim, claimMilestone, reroll, getSnapshot, refresh,
};
