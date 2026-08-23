// Mode ARCADE : une run solo par jour, 4 duels enchaînés contre des decks
// publics tirés par difficulté croissante, l'IA recevant à chaque échelon un
// handicap d'ATK/PV de plus en plus lourd.
//
// db.js ne porte que l'accès SQL ; les RÈGLES sont ici — même découpage que
// shop.js et cosmetics.js, dont ce module reprend le calendrier (littéralement :
// la même fonction, pas une copie) et dont il est le voisin logique :
// progression.js pour créditer le gain de fin de run.
//
// Trois invariants portent tout le reste :
//
//   1. UNE RUN PAR JOUR. Le verrou n'est pas un compteur mais l'existence même
//      de la ligne du jour : `start` refuse dès qu'une run porte la date
//      courante, quel que soit son état (en cours, gagnée, perdue).
//   2. LA RUN EST SERVEUR, donc REPRENABLE. Adversaires, échelon courant et
//      résultats sont persistés ici ; s'arrêter entre deux duels (fermer
//      l'onglet, changer d'appareil) ne coûte rien — le client ne fait que
//      redemander « où j'en suis aujourd'hui ? ».
//   3. LE CLIENT NOMME, LE SERVEUR CHIFFRE. Le client rapporte `win`/`loss` sur
//      un index de duel : ni bonus, ni deck adverse, ni montant ne remontent.
//      Le tirage des adversaires et le crédit final sont faits ici.
//
// ⚠️ Limite assumée, la même que pour le solo et le tournoi : le duel se joue
// entièrement côté client, le serveur ne peut que croire le rapport. Elle est
// ici plus SERRÉE qu'ailleurs — la run est unique par jour et bornée à quatre
// rapports, l'abus plafonne donc à un gain quotidien au lieu d'être illimité.
const path = require('path');
const { db, stmt } = require('./db');
// Cache mémoire au mtime, partagé par tous les catalogues (cf. json-cache.js).
const { jsonCache } = require('./json-cache');
const progression = require('./progression');
// Même rotation que les boutiques et les missions — pas une copie, la même
// fonction. Un seul rendez-vous quotidien (5 h, fuseau du SERVEUR) à retenir.
const { dayKey, nextRotationAt, seededRandom } = require('./shop');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const PUBLIC_DECKS_FILE = path.join(DATA_DIR, 'public_decks.json');

// --- Barème ---

// Les quatre échelons d'une run : la difficulté du deck adverse VISÉE, et le
// handicap plat donné à chaque unité de l'IA. Le premier duel est à mains nues
// (c'est l'étalon : le joueur voit d'abord un adversaire non trafiqué), les
// suivants montent jusqu'à un vrai mur.
const DUELS = Object.freeze([
  Object.freeze({ difficulty: 1, bonus: Object.freeze({ hp: 0, atk: 0 }) }),
  Object.freeze({ difficulty: 2, bonus: Object.freeze({ hp: 10, atk: 2 }) }),
  Object.freeze({ difficulty: 3, bonus: Object.freeze({ hp: 30, atk: 3 }) }),
  Object.freeze({ difficulty: 4, bonus: Object.freeze({ hp: 50, atk: 5 }) }),
]);

const DUEL_COUNT = DUELS.length;
const MAX_DIFFICULTY = DUELS.length;

// Gain de fin de run, versé une seule fois, au 4ᵉ duel gagné. Il n'entre PAS
// dans `progression.REWARDS` : cette table ne porte que de l'XP réclamée par le
// client, alors qu'ici le serveur décerne lui-même (il suit la run) et paie
// aussi en golds — même situation que les paliers de missions.
const RUN_REWARD = Object.freeze({ xp: 50, gold: 200 });

// Même plancher que le DeckSelector côté client : un deck plus court ne fait pas
// un adversaire, il fait un tour de chauffe.
const MIN_DECK_CARDS = 20;

const RESULTS = Object.freeze(['win', 'loss']);

// --- Catalogue des decks publics ---
// Lecture directe du fichier, cache invalidé au mtime — même patron que
// sets.js / variants.js / cosmetics.js : un deck retouché depuis l'admin change
// de difficulté sans redémarrage.

const publicDecks = jsonCache(PUBLIC_DECKS_FILE, list => list);

/** Nombre de cartes d'un deck public, tous tiers confondus. */
function deckSize(deck) {
  let n = 0;
  for (const tier of ['1', '2', '3', '4', '5']) n += (deck?.[tier] ?? []).length;
  return n;
}

/**
 * Difficulté d'un deck, ramenée dans 1..4. Un deck SANS difficulté est lu
 * comme 1 : le champ est postérieur aux decks livrés, et une base déjà
 * déployée n'est pas rétro-alimentée par `initial-data/`. La run doit tourner
 * quand même — le repli de difficulté ci-dessous s'en charge.
 */
function difficultyOf(deck) {
  const raw = Math.round(Number(deck?.difficulty));
  if (!Number.isFinite(raw)) return 1;
  return Math.min(MAX_DIFFICULTY, Math.max(1, raw));
}

/** Decks jouables comme adversaire : composition présente et assez fournie. */
function playableDecks() {
  return publicDecks().filter(d => d && d.id && deckSize(d.deck) >= MIN_DECK_CARDS);
}

// --- Tirage ---

/**
 * Pool d'un échelon : les decks de la difficulté demandée, à défaut ceux de la
 * difficulté NON VIDE la plus proche (écart croissant, égalité → la plus haute
 * pour ne pas inverser la rampe), à défaut tout le pool jouable.
 *
 * Sans ce repli, une seule difficulté laissée vide en admin — ou une base
 * antérieure au champ, où tout est lu comme 1 — rendrait la run impossible à
 * lancer. Elle dégénère alors en « quatre adversaires au hasard », ce qui reste
 * un mode jouable.
 */
function poolFor(difficulty, decks) {
  const byDiff = new Map();
  for (const d of decks) {
    const k = difficultyOf(d);
    if (!byDiff.has(k)) byDiff.set(k, []);
    byDiff.get(k).push(d);
  }
  if (byDiff.get(difficulty)?.length) return byDiff.get(difficulty);

  const candidates = [...byDiff.keys()]
    .filter(k => byDiff.get(k).length)
    .sort((a, b) => (Math.abs(a - difficulty) - Math.abs(b - difficulty)) || (b - a));
  return candidates.length ? byDiff.get(candidates[0]) : decks;
}

/**
 * Les quatre adversaires de la run, déterministes à (joueur, jour) : un tirage
 * douteux se rejoue au lieu de se raconter.
 *
 * Le blob porte la COMPOSITION du deck adverse et pas seulement son id — même
 * raison que `pendingGame.opponentDeck` côté tournoi : un deck public retouché
 * ou supprimé en admin en cours de run ne doit pas casser la reprise.
 */
function buildRun(userId, deckName, { day = dayKey() } = {}) {
  const decks = playableDecks();
  if (!decks.length) return null;

  const rand = seededRandom(userId, day, 'arcade');
  const used = new Set();
  const duels = DUELS.map((spec, index) => {
    const pool = poolFor(spec.difficulty, decks);
    // On évite de recroiser le même adversaire dans la run — sauf si le pool
    // ne le permet pas, auquel cas mieux vaut un doublon qu'un duel manquant.
    const fresh = pool.filter(d => !used.has(d.id));
    const from = fresh.length ? fresh : pool;
    const picked = from[Math.floor(rand() * from.length)] ?? from[0];
    used.add(picked.id);
    return {
      index,
      deck_id: picked.id,
      deck_name: picked.name ?? picked.id,
      difficulty: difficultyOf(picked),
      bonus: { ...spec.bonus },
      deck: picked.deck,
      result: null,
    };
  });

  return {
    day,
    generated_at: Date.now(),
    deck_name: deckName || null,
    current: 0,
    status: 'in_progress',
    rewarded: false,
    duels,
  };
}

// --- Persistance ---

function readState(userId) {
  const row = stmt.arcadeStateByUser.get(userId);
  let run = null;
  try { run = row?.run ? JSON.parse(row.run) : null; } catch { run = null; }
  return { user_id: userId, run_day: row?.run_day ?? null, run };
}

function writeState(state) {
  stmt.upsertArcadeState.run({
    user_id: state.user_id,
    run_day: state.run_day,
    run: state.run ? JSON.stringify(state.run) : null,
  });
}

/**
 * Aligne la ligne du joueur sur le jour courant. Idempotent — appelé à chaque
 * lecture, comme `shop.sync`.
 *
 * ⚠️ Ne DÉMARRE rien : ouvrir l'écran Arcade ne doit pas consommer la journée.
 * C'est `start` qui engage, et lui seul.
 */
const sync = db.transaction((user) => {
  const state = readState(user.id);
  const day = dayKey();
  if (state.run_day === day) return state;

  state.run_day = day;
  state.run = null;
  writeState(state);
  return state;
});

// --- Actions ---

/**
 * Lance la run du jour. Le verrou « une fois par jour » est ici, et il est
 * simple : une run existe déjà pour aujourd'hui → refus, terminée ou non.
 */
const start = db.transaction((user, deckName) => {
  const state = readState(user.id);
  const day = dayKey();
  if (state.run_day === day && state.run) {
    return { ok: false, reason: 'Ta run du jour est déjà lancée.', stale: true };
  }

  const run = buildRun(user.id, deckName ? String(deckName).slice(0, 64) : null, { day });
  if (!run) return { ok: false, reason: 'Aucun deck adverse disponible.' };

  state.run_day = day;
  state.run = run;
  writeState(state);
  return { ok: true, started: true };
});

/**
 * Solde un duel. Le client désigne une LIGNE (`index`) et un résultat, jamais un
 * gain : le barème reste `RUN_REWARD` et c'est le serveur qui crédite.
 *
 * L'index doit être celui du duel courant — un rapport hors séquence est refusé
 * plutôt que réordonné, sinon deux réponses en vol pourraient faire avancer la
 * run de deux crans.
 */
const reportDuel = db.transaction((user, { index, result } = {}) => {
  const state = readState(user.id);
  const day = dayKey();
  if (state.run_day !== day || !state.run) {
    return { ok: false, reason: 'Aucune run en cours.', stale: true };
  }
  const run = state.run;
  if (run.status !== 'in_progress') {
    return { ok: false, reason: 'Ta run du jour est terminée.', stale: true };
  }
  if (!RESULTS.includes(result)) return { ok: false, reason: 'Résultat inconnu.' };
  if (Number(index) !== run.current) {
    return { ok: false, reason: 'Ce duel n\'est plus celui en cours.', stale: true };
  }

  const duel = run.duels[run.current];
  duel.result = result;

  let granted = null;
  if (result === 'loss') {
    // Une défaite clôt la run : la journée est consommée. C'est ce qui donne
    // son poids au handicap croissant — le 4ᵉ duel est un vrai mur.
    run.status = 'lost';
  } else if (run.current + 1 >= DUEL_COUNT) {
    run.status = 'won';
    // Garde anti-double-crédit : `rewarded` est lu ET écrit dans la même
    // transaction que l'avancement, et `status !== 'in_progress'` rejette tout
    // rapport ultérieur — deux taps concurrents ne paient qu'une fois.
    if (!run.rewarded) {
      run.rewarded = true;
      progression.grant(user.id, { xp: RUN_REWARD.xp, gold: RUN_REWARD.gold });
      granted = { ...RUN_REWARD };
    }
  } else {
    run.current += 1;
  }

  state.run = run;
  writeState(state);
  return { ok: true, result, status: run.status, granted };
});

// --- Instantané ---

/**
 * Lecture pure — n'écrit jamais. Re-vérifie le jour même quand `sync` vient de
 * tourner : un instantané ne doit en aucun cas laisser fuiter la run d'hier.
 */
function getSnapshot(user) {
  const state = readState(user.id);
  const day = dayKey();
  const run = state.run_day === day ? state.run : null;

  return {
    day,
    next_rotation_at: nextRotationAt(),
    // Les quatre échelons et leur handicap, indépendamment de toute run : c'est
    // ce qui permet d'annoncer le parcours AVANT d'engager la journée.
    plan: DUELS.map((d, index) => ({ index, difficulty: d.difficulty, bonus: { ...d.bonus } })),
    reward: { ...RUN_REWARD },
    duel_count: DUEL_COUNT,
    run,
  };
}

/** Sync + snapshot — le point d'entrée normal des routes. */
function refresh(user) {
  sync(user);
  return getSnapshot(user);
}

module.exports = {
  DUELS, DUEL_COUNT, RUN_REWARD, MIN_DECK_CARDS, MAX_DIFFICULTY,
  publicDecks, playableDecks, difficultyOf, deckSize, poolFor, buildRun,
  sync, start, reportDuel, getSnapshot, refresh,
};
