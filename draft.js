// Mode DRAFT : une run par jour. Le joueur construit un deck de 15 cartes —
// trois lots de trois cartes liées, puis six cartes à l'unité — puis enchaîne
// des duels contre des adversaires qui ont drafté avec les mêmes règles.
//
// Partage des rôles avec le client — et il est inhabituel :
//
//   - L'OFFRE se calcule côté client (`client/src/logic/Draft.ts`) : elle
//     repose sur la couverture des recettes d'invocation, c'est-à-dire sur
//     `InvocationManager`, qui n'existe pas côté Node. Le serveur ne fait que
//     poser la GRAINE, que le client ne choisit donc pas.
//   - Tout le reste est ICI : le verrou quotidien, les choix retenus, les
//     relances dépensées, les victoires et défaites, la vie bonus et les
//     gemmes. Un rechargement, un autre appareil : la run se reprend.
//
// ⚠️ Limite assumée : le serveur vérifie qu'un choix est fait de cartes du
// catalogue, pas encore prises, du bon tier (choix d'une carte) ou formant un
// lot lié (étape de lot) — il ne peut pas vérifier qu'il figurait dans l'offre. Comme le résultat d'un duel (Arcade, solo), c'est une
// confiance bornée : une run par jour, 60 gemmes au plus.
//
// Deux règles de l'économie, comme partout :
//   1. LE CLIENT NOMME, LE SERVEUR CHIFFRE. Le client envoie une carte, un
//      résultat sur un index de duel, « je rachète une vie » — jamais un
//      montant. Barème et prix vivent ici.
//   2. GARDES DANS LA TRANSACTION. Chaque action lit et réécrit la run dans
//      une seule `db.transaction` (better-sqlite3 est synchrone) ; l'index de
//      duel attendu rejette un rapport rejoué, donc deux taps ne paient qu'une
//      fois.
//
// ⚠️ JUMEAU : `DRAFT_STEPS`, `DRAFT_REROLLS`, `RUN_WINS`, `RUN_LOSSES`,
// `EXTRA_LIVES` et `isLinkedBundle` existent aussi dans `client/src/logic/Draft.ts` (frontière
// CJS / ESM-TS). `client/src/test/draft-server.test.ts` les fait répondre la
// même chose.
const path = require('path');
const { db, stmt } = require('./db');
const { jsonCache } = require('./json-cache');
const progression = require('./progression');
const tiers = require('./tiers');
const { dayKey, nextRotationAt, seededRandom } = require('./shop');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const CARDS_FILE = path.join(DATA_DIR, 'cards.json');

// --- Barème ---

/** Les étapes : trois LOTS de trois cartes liées (sans tier), puis six cartes
 *  à l'unité au tier imposé. 15 cartes. */
const DRAFT_STEPS = Object.freeze([
  { cards: 3 }, { cards: 3 }, { cards: 3 },
  { cards: 1, tier: 1 }, { cards: 1, tier: 1 }, { cards: 1, tier: 2 },
  { cards: 1, tier: 3 }, { cards: 1, tier: 4 }, { cards: 1, tier: 5 },
].map(s => Object.freeze(s)));
const DRAFT_SIZE = DRAFT_STEPS.reduce((n, s) => n + s.cards, 0);
const DRAFT_REROLLS = 2;
const RUN_WINS = 5;
/** La run s'arrête à la 2ᵉ défaite… */
const RUN_LOSSES = 2;
/** …sauf vie rachetée : une seule par run. */
const EXTRA_LIVES = 1;
const EXTRA_LIFE_PRICE_GEMS = 20;
/** Gemmes versées à chaque victoire, dans l'ordre : 60 pour une run parfaite.
 *  Progressif, pour que la vie rachetée ait un sens en fin de run. */
const WIN_GEMS = Object.freeze([6, 9, 12, 15, 18]);

const RESULTS = Object.freeze(['win', 'loss']);

const cardsById = jsonCache(CARDS_FILE, list => new Map((list || []).filter(c => c && c.id).map(c => [c.id, c])));

/** L'étape en cours, déduite du nombre de cartes prises. */
function currentStep(picksCount) {
  let taken = 0;
  for (const step of DRAFT_STEPS) {
    if (picksCount === taken) return step;
    taken += step.cards;
  }
  return null;
}

const laneTier = card => tiers.tiersOf(card)[0] ?? 1;

/** Ids de carte nommés par les recettes d'une carte (jamais un `ARCH_*`). */
function namedIds(card) {
  const out = new Set();
  for (const cd of card.summon_conditions || []) {
    for (const m of cd.requires || []) if (!String(m).startsWith('ARCH_')) out.add(m);
  }
  return out;
}

/** Lot lié : chaque carte reliée aux autres par une recette qui nomme l'une
 *  d'elles, et au moins deux « plus bas tiers » distincts.
 *  ⚠️ JUMEAU de `isLinkedBundle` (`client/src/logic/Draft.ts`). */
function isLinkedBundle(cards) {
  if (cards.length < 2) return false;
  if (new Set(cards.map(laneTier)).size < 2) return false;
  const named = cards.map(namedIds);
  const linked = (i, j) => named[i].has(cards[j].id) || named[j].has(cards[i].id);
  const seen = new Set([0]);
  const queue = [0];
  while (queue.length) {
    const i = queue.shift();
    for (let j = 0; j < cards.length; j++) {
      if (!seen.has(j) && linked(i, j)) { seen.add(j); queue.push(j); }
    }
  }
  return seen.size === cards.length;
}

function maxLosses(run) {
  return RUN_LOSSES + (run.extra_life ? EXTRA_LIVES : 0);
}

function newRun(userId, day) {
  const rand = seededRandom(userId, day, 'draft');
  return {
    day,
    seed: Math.floor(rand() * 0x100000000) >>> 0,
    picks: [],
    rerolls: 0,
    wins: 0,
    losses: 0,
    extra_life: false,
    status: 'drafting',
    gems_earned: 0,
  };
}

// --- Persistance (même forme que l'Arcade : le jour en colonne, la run en blob) ---

function readState(userId) {
  const row = stmt.draftStateByUser.get(userId);
  let run = null;
  try { run = row?.run ? JSON.parse(row.run) : null; } catch { run = null; }
  return { user_id: userId, run_day: row?.run_day ?? null, run };
}

function writeState(state) {
  stmt.upsertDraftState.run({
    user_id: state.user_id,
    run_day: state.run_day,
    run: state.run ? JSON.stringify(state.run) : null,
  });
}

/** Aligne la ligne sur le jour courant. Ne démarre rien : lire ne consomme pas
 *  la journée. */
const sync = db.transaction((user) => {
  const state = readState(user.id);
  const day = dayKey();
  if (state.run_day === day) return state;
  state.run_day = day;
  state.run = null;
  writeState(state);
  return state;
});

/** La run du jour, ou une raison de refus (409 côté route). */
function todayRun(state) {
  if (state.run_day !== dayKey() || !state.run) return { error: 'Aucune run en cours.' };
  return { run: state.run };
}

// --- Actions ---

const start = db.transaction((user) => {
  const state = readState(user.id);
  const day = dayKey();
  if (state.run_day === day && state.run) {
    return { ok: false, reason: 'Ton draft du jour est déjà lancé.', stale: true };
  }
  state.run_day = day;
  state.run = newRun(user.id, day);
  writeState(state);
  return { ok: true };
});

/** Retient le choix de l'étape en cours : une carte, ou les trois d'un lot. */
const pick = db.transaction((user, cardIds) => {
  const state = readState(user.id);
  const { run, error } = todayRun(state);
  if (error) return { ok: false, reason: error, stale: true };
  if (run.status !== 'drafting') return { ok: false, reason: 'Le draft est terminé.', stale: true };
  const step = currentStep(run.picks.length);
  if (!step) return { ok: false, reason: 'Le draft est terminé.', stale: true };
  const ids = Array.isArray(cardIds) ? cardIds : [];
  if (ids.length !== step.cards || new Set(ids).size !== ids.length) {
    return { ok: false, reason: `Cette étape prend ${step.cards} carte${step.cards > 1 ? 's' : ''}.`, stale: true };
  }
  const cards = ids.map(id => cardsById().get(id));
  if (cards.some(c => !c)) return { ok: false, reason: 'Carte inconnue.' };
  if (ids.some(id => run.picks.includes(id))) return { ok: false, reason: 'Carte déjà prise.' };
  if (step.tier != null && !tiers.tiersOf(cards[0]).includes(step.tier)) {
    return { ok: false, reason: 'Cette carte n\'est pas du tier de l\'étape.', stale: true };
  }
  if (step.tier == null && !isLinkedBundle(cards)) return { ok: false, reason: 'Ces cartes ne forment pas un lot lié.' };

  run.picks.push(...ids);
  if (run.picks.length >= DRAFT_SIZE) run.status = 'playing';
  writeState(state);
  return { ok: true };
});

const reroll = db.transaction((user) => {
  const state = readState(user.id);
  const { run, error } = todayRun(state);
  if (error) return { ok: false, reason: error, stale: true };
  if (run.status !== 'drafting') return { ok: false, reason: 'Le draft est terminé.', stale: true };
  if (run.rerolls >= DRAFT_REROLLS) return { ok: false, reason: 'Plus de relance.', stale: true };
  run.rerolls += 1;
  writeState(state);
  return { ok: true };
});

/**
 * Solde un duel. `index` (victoires + défaites déjà comptées) doit désigner le
 * duel en cours : un rapport rejoué arrive sur un index périmé et est refusé,
 * c'est ce qui empêche une victoire de payer deux fois.
 */
const reportDuel = db.transaction((user, { index, result } = {}) => {
  const state = readState(user.id);
  const { run, error } = todayRun(state);
  if (error) return { ok: false, reason: error, stale: true };
  if (run.status !== 'playing') return { ok: false, reason: 'Aucun duel en cours.', stale: true };
  if (!RESULTS.includes(result)) return { ok: false, reason: 'Résultat inconnu.' };
  if (Number(index) !== run.wins + run.losses) {
    return { ok: false, reason: 'Ce duel n\'est plus celui en cours.', stale: true };
  }

  let granted = null;
  if (result === 'win') {
    const gems = WIN_GEMS[run.wins] ?? 0;
    run.wins += 1;
    if (gems > 0) {
      run.gems_earned += gems;
      progression.grant(user.id, { gems });
      granted = { gems };
    }
    if (run.wins >= RUN_WINS) run.status = 'won';
  } else {
    run.losses += 1;
    if (run.losses >= maxLosses(run)) run.status = 'lost';
  }
  writeState(state);
  return { ok: true, result, status: run.status, granted };
});

/**
 * Rachète une vie : une run perdue à sa 2ᵉ défaite repart pour un duel de
 * plus. Une fois par run, et seulement à ce moment-là — acheter d'avance
 * ferait payer une assurance dont on n'aura peut-être pas besoin.
 */
const buyLife = db.transaction((user) => {
  const state = readState(user.id);
  const { run, error } = todayRun(state);
  if (error) return { ok: false, reason: error, stale: true };
  if (run.status !== 'lost' || run.extra_life) {
    return { ok: false, reason: 'Aucune vie à racheter.', stale: true };
  }
  const fresh = stmt.userById.get(user.id);
  if ((fresh?.gems ?? 0) < EXTRA_LIFE_PRICE_GEMS) return { ok: false, reason: 'Pas assez de gemmes.' };
  progression.grant(user.id, { gems: -EXTRA_LIFE_PRICE_GEMS });
  run.extra_life = true;
  run.status = 'playing';
  writeState(state);
  return { ok: true };
});

// --- Instantané ---

function getSnapshot(user) {
  const state = readState(user.id);
  const day = dayKey();
  const run = state.run_day === day ? state.run : null;
  return {
    day,
    next_rotation_at: nextRotationAt(),
    rules: {
      steps: DRAFT_STEPS.map(s => ({ ...s })),
      rerolls: DRAFT_REROLLS,
      wins: RUN_WINS,
      losses: RUN_LOSSES,
      extra_lives: EXTRA_LIVES,
      extra_life_price_gems: EXTRA_LIFE_PRICE_GEMS,
      win_gems: [...WIN_GEMS],
    },
    run,
  };
}

function refresh(user) {
  sync(user);
  return getSnapshot(user);
}

module.exports = {
  DRAFT_STEPS, DRAFT_SIZE, DRAFT_REROLLS, isLinkedBundle, RUN_WINS, RUN_LOSSES, EXTRA_LIVES,
  EXTRA_LIFE_PRICE_GEMS, WIN_GEMS,
  sync, start, pick, reroll, reportDuel, buyLife, getSnapshot, refresh,
};
