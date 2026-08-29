// Log de combat PvP par tick — OUTIL DE DIAGNOSTIC TEMPORAIRE.
//
// Pourquoi il existe : un duel en ligne est simulé EN PARALLÈLE par les deux
// clients, et le combat ne consomme aucun hasard (`CombatManager` ne reçoit ni
// `rand` ni graine). Les deux simulations sont donc censées être identiques au
// tick près. Quand elles ne le sont pas, rien dans le jeu ne permet de le
// constater : le seul signal existant est le `result_mismatch` de
// `ws/MatchRelay.handleReportResult`, qui arrive à la toute fin et ne dit que
// « les deux joueurs ne sont pas d'accord sur le vainqueur ».
//
// Ce module recolle les deux vues d'un même combat et NOMME la première
// différence — le tick, la nature, et le champ fautif.
//
// ⚠️ Règle de dépendances : c'est une FEUILLE. Il ne requiert que `db`, et
// personne ne le requiert en retour hors de `routes/online.js`,
// `routes/admin-pvplog.js` et la purge d'`app.js`. Même statut que `decks.js` :
// un outil qu'on doit pouvoir retirer d'un bloc.
//
// ⚠️ Le module ne normalise RIEN : les payloads arrivent déjà dans le repère du
// rôle A (cf. `client/src/game/CombatRecorder.ts`). C'est délibéré — la
// normalisation a besoin de savoir de quel côté on regarde, et ce côté n'est
// connu avec certitude que du client qui capture. Le serveur compare, il
// n'interprète pas.
const { stmt } = require('./db');

/** Rétention : ces lignes pèsent des centaines de Ko et ne servent qu'au debug. */
const KEEP_DAYS = 7;

/** Un match n'a que deux rôles, et le log de l'un ne vaut que face à l'autre. */
const ROLES = ['A', 'B'];

// ── Écriture ────────────────────────────────────────────────────────────────

/**
 * Dépose la vue d'un joueur sur un combat.
 *
 * ⚠️ L'appartenance au match est vérifiée ICI et pas seulement à la route :
 * c'est une écriture ouverte aux joueurs (montée avant le write-guard global
 * d'`app.js`). Sans ce contrôle, n'importe quel compte connecté déposerait des
 * lignes sous n'importe quel `match_id` — et le fichier qu'on lira ensuite pour
 * arbitrer une divergence serait exactement ce qu'un tricheur aurait écrit.
 *
 * Le `role` annoncé doit correspondre à la PLACE RÉELLE du joueur : le laisser
 * au client permettrait d'écraser la vue de son adversaire (la clé primaire est
 * `(match_id, round, role)`).
 *
 * @returns {{ ok: true, stored: boolean } | { ok: false, error: string }}
 *          `stored: false` = une ligne existait déjà (renvoi, premier gagne).
 */
function record(user, { matchId, round, role, payload, truncated } = {}) {
  if (typeof matchId !== 'string' || !matchId) return { ok: false, error: 'match_id manquant' };
  if (!Number.isInteger(round) || round < 1) return { ok: false, error: 'round invalide' };
  if (!ROLES.includes(role)) return { ok: false, error: 'role invalide' };
  if (!payload || typeof payload !== 'object') return { ok: false, error: 'payload manquant' };

  const match = stmt.matchById.get(matchId);
  if (!match) return { ok: false, error: 'match inconnu' };

  const actualRole = match.player_a_id === user.id ? 'A'
    : match.player_b_id === user.id ? 'B'
      : null;
  if (!actualRole) return { ok: false, error: 'match étranger' };
  if (actualRole !== role) return { ok: false, error: 'role usurpé' };

  const info = stmt.insertPvpLog.run({
    match_id: matchId,
    round,
    role,
    user_id: user.id,
    created_at: Date.now(),
    truncated: truncated ? 1 : 0,
    payload: JSON.stringify(payload),
  });
  return { ok: true, stored: info.changes > 0 };
}

// ── Comparaison ─────────────────────────────────────────────────────────────

const sameCells = (a, b) => {
  const key = (c) => `${c.col},${c.row}`;
  const norm = (l) => (Array.isArray(l) ? l.map(key).sort() : []);
  const [x, y] = [norm(a), norm(b)];
  return x.length === y.length && x.every((v, i) => v === y[i]);
};

/**
 * Réhydrate une ligne d'unité (tableau positionnel) en objet nommé, selon la
 * légende `columns` que le client a écrite une fois en tête du payload.
 *
 * Le stockage est compact parce qu'il y a jusqu'à 333 ticks × 12 unités par
 * combat ; la LECTURE, elle, doit être lisible — c'est le seul morceau du
 * fichier qu'un humain ouvre vraiment.
 */
function expand(columns, row) {
  if (!Array.isArray(row)) return row;
  const out = {};
  columns.forEach((name, i) => { out[name] = row[i]; });
  return out;
}

function indexUnits(columns, units) {
  const map = new Map();
  for (const row of units || []) {
    const u = expand(columns, row);
    map.set(u.key, u);
  }
  return map;
}

/**
 * Première différence entre les deux vues d'un même combat, ou `null`.
 *
 * L'ordre des contrôles va du plus structurant au plus fin, et on s'ARRÊTE à la
 * première trouvaille : au-delà, tout diverge par ricochet et le reste du
 * rapport ne dirait plus rien de la cause.
 *
 *   header → l'entrée en combat n'était déjà pas la même (terrain, cases
 *            bloquées, unités de départ) ;
 *   order  → même état, mais les unités n'agissent pas dans le même ordre ;
 *   state  → une unité diverge sur un champ, qui est nommé ;
 *   events → même état et même ordre, mais un acte diffère ;
 *   length → un côté s'arrête avant l'autre, ou ne désigne pas le même vainqueur.
 *
 * @returns {null | { kind, tick, detail }}
 */
function diff(a, b) {
  if (!a || !b) return null;

  // ── En-tête ───────────────────────────────────────────────────────────────
  if (a.board_id !== b.board_id) {
    return { kind: 'header', tick: 0, detail: { field: 'board_id', A: a.board_id, B: b.board_id } };
  }
  // ⚠️ Le contrôle qui compte : les cases bloquées sont appliquées VERBATIM des
  // deux côtés alors que le monde du client B est le reflet de celui de A. Un
  // terrain dont les cases ne sont pas invariantes par `row → 10-row` fait
  // simuler deux plateaux différents, et ligne de vue comme contournement BFS
  // divergent dès le premier tick.
  if (!sameCells(a.blocked_cells, b.blocked_cells)) {
    return {
      kind: 'header',
      tick: 0,
      detail: {
        field: 'blocked_cells',
        hint: 'terrain non symétrique par le miroir row → 10-row',
        A: a.blocked_cells, B: b.blocked_cells,
      },
    };
  }

  const columns = a.columns || [];
  const startA = indexUnits(columns, a.start_units);
  const startB = indexUnits(b.columns || columns, b.start_units);
  const startDiff = diffUnitMaps(startA, startB);
  if (startDiff) return { kind: 'header', tick: 0, detail: { field: 'start_units', ...startDiff } };

  // ── Tick par tick ─────────────────────────────────────────────────────────
  const ticksA = a.ticks || [];
  const ticksB = b.ticks || [];
  const common = Math.min(ticksA.length, ticksB.length);

  for (let i = 0; i < common; i++) {
    const ta = ticksA[i];
    const tb = ticksB[i];
    const tick = ta.t;

    if (ta.t !== tb.t) {
      return { kind: 'length', tick, detail: { field: 't', A: ta.t, B: tb.t } };
    }

    // L'ordre d'initiative en premier : c'est lui qui décide de tout le reste du
    // tick, et il est le symptôme le plus lisible d'une divergence de tri ou
    // d'ordre de tableau.
    if (!sameList(ta.order, tb.order)) {
      return { kind: 'order', tick, detail: { A: ta.order, B: tb.order } };
    }

    const unitDiff = diffUnitMaps(
      indexUnits(columns, ta.units),
      indexUnits(b.columns || columns, tb.units),
    );
    if (unitDiff) return { kind: 'state', tick, detail: unitDiff };

    if (!sameList(ta.events, tb.events, JSON.stringify)) {
      return { kind: 'events', tick, detail: { A: ta.events, B: tb.events } };
    }
  }

  if (ticksA.length !== ticksB.length) {
    return {
      kind: 'length',
      tick: common,
      detail: { field: 'tick_count', A: ticksA.length, B: ticksB.length },
    };
  }
  if (a.winner !== b.winner) {
    return { kind: 'length', tick: common, detail: { field: 'winner', A: a.winner, B: b.winner } };
  }
  return null;
}

function sameList(a, b, key = String) {
  const [x, y] = [a || [], b || []];
  return x.length === y.length && x.every((v, i) => key(v) === key(y[i]));
}

/** Première unité qui diffère, avec le NOM du champ fautif. */
function diffUnitMaps(mapA, mapB) {
  const keys = [...new Set([...mapA.keys(), ...mapB.keys()])].sort();
  for (const key of keys) {
    const ua = mapA.get(key);
    const ub = mapB.get(key);
    if (!ua || !ub) {
      return { unit: key, field: 'presence', A: ua ? 'présente' : 'absente', B: ub ? 'présente' : 'absente' };
    }
    for (const field of Object.keys(ua)) {
      if (JSON.stringify(ua[field]) !== JSON.stringify(ub[field])) {
        return { unit: key, field, A: ua[field], B: ub[field], full: { A: ua, B: ub } };
      }
    }
  }
  return null;
}

// ── Lecture ─────────────────────────────────────────────────────────────────

function parseRow(row) {
  let payload = null;
  try { payload = JSON.parse(row.payload); } catch { /* ligne illisible : traitée comme absente */ }
  return { round: row.round, role: row.role, user_id: row.user_id, created_at: row.created_at, truncated: !!row.truncated, payload };
}

/**
 * Les deux vues d'un match, round par round, chacune accompagnée de son verdict.
 * C'est l'objet que l'admin télécharge.
 */
function bundle(matchId) {
  const rows = stmt.pvpLogsByMatch.all(matchId);
  if (rows.length === 0) return null;

  const match = stmt.matchById.get(matchId) || null;
  const byRound = new Map();
  for (const row of rows) {
    const entry = parseRow(row);
    if (!byRound.has(entry.round)) byRound.set(entry.round, { round: entry.round, A: null, B: null });
    byRound.get(entry.round)[entry.role] = entry;
  }

  const rounds = [...byRound.values()].sort((x, y) => x.round - y.round).map((r) => ({
    round: r.round,
    truncated: !!(r.A?.truncated || r.B?.truncated),
    verdict: verdictOf(r),
    // Quels côtés ont déposé. Dérivé, jamais stocké — mais transporté jusqu'à
    // la LISTE : « un seul côté » sans dire lequel n'apprend rien, et c'est
    // précisément ce qu'on regarde quand une vue manque.
    roles: ROLES.filter((role) => !!r[role]),
    divergence: r.A && r.B ? diff(r.A.payload, r.B.payload) : null,
    A: r.A?.payload ?? null,
    B: r.B?.payload ?? null,
  }));

  const diverged = rounds.find((r) => r.verdict === 'diverged') || null;
  return {
    match_id: matchId,
    generated_at: Date.now(),
    match,
    verdict: diverged ? 'diverged' : rounds.some((r) => r.verdict === 'incomplete') ? 'incomplete' : 'ok',
    first_divergence: diverged
      ? { round: diverged.round, ...diverged.divergence }
      : null,
    rounds,
  };
}

function verdictOf(r) {
  if (!r.A || !r.B || !r.A.payload || !r.B.payload) return 'incomplete';
  return diff(r.A.payload, r.B.payload) ? 'diverged' : 'ok';
}

/**
 * La liste de l'écran d'admin : un match par ligne, avec son verdict.
 *
 * ⚠️ Elle DÉSÉRIALISE chaque payload pour rendre son verdict — c'est ce qui
 * coûte le plus cher ici. D'où la pagination serrée (25 par défaut) : à 250 Ko
 * par vue et 5 rounds, une page de 100 lirait 250 Mo de JSON.
 */
function list({ limit = 25, offset = 0 } = {}) {
  const lim = Math.min(Math.max(parseInt(limit, 10) || 25, 1), 100);
  const off = Math.max(parseInt(offset, 10) || 0, 0);
  const rows = stmt.pvpLogMatches.all(lim, off);
  const total = stmt.pvpLogMatchCount.get().n;

  const matches = rows.map((row) => {
    const b = bundle(row.match_id);
    const match = b?.match || null;
    return {
      match_id: row.match_id,
      created_at: row.created_at,
      truncated: !!row.truncated,
      rounds: b ? b.rounds.map((r) => ({ round: r.round, verdict: r.verdict, roles: r.roles })) : [],
      // Les rôles qui ont déposé au moins une vue sur tout le match.
      roles: b ? ROLES.filter((role) => b.rounds.some((r) => r.roles.includes(role))) : [],
      verdict: b ? b.verdict : 'incomplete',
      first_divergence: b?.first_divergence
        ? { round: b.first_divergence.round, tick: b.first_divergence.tick, kind: b.first_divergence.kind }
        : null,
      players: match ? { A: match.player_a_id, B: match.player_b_id } : null,
      ended_reason: match ? match.ended_reason : null,
    };
  });
  return { matches, total, limit: lim, offset: off };
}

function remove(matchId) {
  return stmt.deletePvpLogsByMatch.run(matchId).changes;
}

/** Purge par ancienneté — appelée par le `runMaintenance` d'`app.js`. */
function purge(now = Date.now()) {
  return stmt.deleteOldPvpLogs.run(now - KEEP_DAYS * 24 * 60 * 60 * 1000).changes;
}

module.exports = { record, diff, bundle, list, remove, purge, KEEP_DAYS, ROLES };
