// Boutique de cartes : emplacements quotidiens (épinglables), boosters.
// db.js ne porte que l'accès SQL ; les RÈGLES sont ici — même découpage que
// progression.js (dont ce module est le client pour débiter et débloquer) et
// missions.js (dont il reprend le calendrier : la boutique tourne au même
// reset de 5 h, brief §3.1).
//
// Deux systèmes, deux fonctions qui ne se recouvrent pas :
//
//   - Emplacements quotidiens — CONSTRUCTION DE DECK. 3 par jour, conscients du
//     graphe d'invocation et du deck actif. C'est le plafond qui structure
//     toute l'économie. Un seul peut être ÉPINGLÉ : il survit à la rotation
//     du lendemain au lieu d'être re-tiré.
//   - Booster — COLLECTION. Volume brut sur un set choisi, sans plafond.
//
// Deux invariants tiennent tout le reste :
//   1. ZÉRO DOUBLON — aucun tirage ne peut produire une carte déjà possédée.
//      C'est ce qui dispense le jeu de poussière, de fragments, de conversion.
//   2. L'OFFRE EST SERVEUR. Elle est générée, horodatée et persistée ici ;
//      aucune action client (changement de deck, rechargement, fuseau annoncé)
//      ne peut la régénérer — sinon l'offre se re-tire jusqu'à satisfaction.
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { db, stmt } = require('./db');
const progression = require('./progression');
const missions = require('./missions');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const CARDS_FILE = path.join(DATA_DIR, 'cards.json');
const SETS_FILE = path.join(DATA_DIR, 'sets.json');

// --- Barème (brief §3.3, §3.4, §3.5) ---

const DAILY_SLOTS = 3;
// Prix unique, quel que soit le tier de la carte : le joueur choisit sa
// monnaie à l'achat (golds ou gemmes), comme pour un booster.
const SLOT_PRICE = Object.freeze({ golds: 1000, gems: 100 });

// Pondération de tirage par tier, volontairement plus PLATE que la
// distribution naturelle du pool (T1 38 % / T5 5 %) : les tiers élevés coûtent
// plus cher, ils doivent sortir assez souvent pour que l'arbitrage budgétaire
// existe. Sans ça le joueur n'a jamais à choisir, il achète tout.
const TIER_WEIGHTS = Object.freeze({ 1: 30, 2: 28, 3: 22, 4: 14, 5: 6 });

// Épingle : UN seul emplacement conservé d'une rotation à l'autre, gratuitement
// et sans limite de durée. C'est ce qui permet d'économiser pour une carte chère
// sans la voir disparaître au reset du lendemain.
//
// Le plafond de 1 n'est pas une avarice : épingler les trois emplacements
// figerait la boutique et supprimerait la rotation. Épingler, c'est renoncer à
// une proposition neuve — c'est l'arbitrage qui donne son poids au geste.
const PINNED_SLOTS_MAX = 1;

// Un reroll gratuit par jour, pas de reroll payant : un reroll achetable
// transformerait la boutique en machine à sous et casserait le plafond de
// 3 cartes/jour (brief §3.6).
const FREE_REROLLS_PER_DAY = 1;

const BOOSTER = Object.freeze({
  card_count: 3,
  price_golds: 2000,
  price_gems: 150,
  // 2 cartes Tier 1-2 + 1 carte Tier 3+.
  tier_guarantee: { low: 2, high: 1, high_threshold: 3 },
  // Poids ×2 pour les cartes portant un attribut du deck actif. Non exclusif :
  // la découverte reste possible.
  affinity_weight: 2,
});

// Attribut présent au moins deux fois dans le deck actif = signal d'intention.
// Une seule occurrence peut être un accident de deckbuilding.
const AFFINITY_MIN_OCCURRENCES = 2;

// --- Catalogues (cache mémoire invalidé au mtime, comme progression.allCardIds) ---

function jsonCache(file, build) {
  let cache = { mtime: -1, value: build([]) };
  return () => {
    try {
      const mtime = fs.statSync(file).mtimeMs;
      if (mtime !== cache.mtime) {
        const raw = JSON.parse(fs.readFileSync(file, 'utf8').replace(/,\s*([\]}])/g, '$1'));
        cache = { mtime, value: build(Array.isArray(raw) ? raw : []) };
      }
    } catch { /* fichier absent/illisible : on garde le dernier cache connu */ }
    return cache.value;
  };
}

const cards = jsonCache(CARDS_FILE, list => new Map(list.filter(c => c && c.id).map(c => [c.id, c])));
const sets = jsonCache(SETS_FILE, list => list.filter(s => s && s.id));

function card(id) { return cards().get(id) ?? null; }
function setDef(id) { return sets().find(s => s.id === id) ?? null; }

/**
 * Cartes d'un set. `sets.json` fait foi ; le champ `set` de la carte n'en est
 * que le miroir — c'est lui qui rattrape une carte créée depuis l'admin après
 * la rédaction du set.
 */
function setCardIds(def) {
  const listed = Array.isArray(def.cards) ? def.cards : [];
  const mirrored = [...cards().values()].filter(c => c.set === def.id).map(c => c.id);
  return [...new Set([...listed, ...mirrored])].filter(id => cards().has(id));
}

/** Matériaux d'une carte, toutes options d'invocation confondues. */
function materialsOf(c) {
  const out = [...(c.cost?.materials ?? [])];
  for (const opt of c.summon_options ?? []) out.push(...(opt.cost?.materials ?? []));
  return out;
}

// Le prix ne dépend plus de la carte — conservé comme fonction pour ne pas
// disperser la constante dans tout le fichier.
function priceOf() {
  return { golds: SLOT_PRICE.golds, gems: SLOT_PRICE.gems };
}

// --- Calendrier ---
// Aligné sur le reset des missions (5 h, fuseau du SERVEUR) : le joueur n'a
// qu'un seul rendez-vous quotidien à retenir. `missions.dayKey` fait foi.

const dayKey = missions.dayKey;

/** Prochaine rotation (timestamp) — le compte à rebours affiché par le client. */
function nextRotationAt(ts = Date.now()) {
  const d = new Date(ts - missions.RESET_HOUR * 3600_000);
  const end = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1, 0, 0, 0, 0);
  return end.getTime() + missions.RESET_HOUR * 3600_000;
}

// --- Tirage déterministe ---
// L'offre est reproductible à partir de (player_id, jour, sel) : un bug de
// tirage se rejoue à l'identique au lieu de se raconter. Le sel isole les
// slots entre eux et fait avancer le tirage à chaque reroll.

function seededRandom(...parts) {
  const digest = crypto.createHash('sha256').update(parts.join('|')).digest();
  let s = digest.readUInt32LE(0) || 1;
  return () => {
    // xorshift32 — suffisant pour un tirage de boutique, et stable d'une
    // version de Node à l'autre (contrairement à Math.random).
    s ^= s << 13; s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}

/** Tirage pondéré. `weight` retourne un poids > 0 ; les poids nuls sont ignorés. */
function weightedPick(list, weight, rand) {
  let total = 0;
  const weights = list.map(item => {
    const w = Math.max(0, weight(item));
    total += w;
    return w;
  });
  if (total <= 0) return list.length ? list[Math.floor(rand() * list.length)] ?? null : null;
  let roll = rand() * total;
  for (let i = 0; i < list.length; i++) {
    roll -= weights[i];
    if (roll <= 0) return list[i];
  }
  return list[list.length - 1] ?? null;
}

const tierWeight = c => TIER_WEIGHTS[Number(c?.tier)] ?? 1;

// --- Contexte du joueur ---

/**
 * Attributs présents au moins deux fois dans le DECK ACTIF. Le deck vit côté
 * client (localStorage) mais est synchronisé dans `deck_books` : le serveur
 * lit sa propre copie, il ne demande jamais au client de la lui décrire —
 * sinon la pondération d'affinité serait pilotable depuis la requête.
 */
function activeDeckAttributes(userId) {
  const row = stmt.deckBookByUser.get(userId);
  if (!row) return new Map();
  let book;
  try { book = JSON.parse(row.data); } catch { return new Map(); }
  const deck = book?.decks?.[book?.active];
  if (!deck) return new Map();

  const counts = new Map();
  for (const ids of Object.values(deck)) {
    for (const id of Array.isArray(ids) ? ids : []) {
      for (const attr of card(id)?.attributes ?? []) {
        counts.set(attr, (counts.get(attr) ?? 0) + 1);
      }
    }
  }
  return new Map([...counts].filter(([, n]) => n >= AFFINITY_MIN_OCCURRENCES));
}

function context(user) {
  const owned = new Set(progression.unlockedCardIds(user));
  // Attributs possédés : un matériau désigné par ARCH_* est satisfait dès
  // qu'on possède une carte qui le porte (brief §3.2).
  const ownedAttributes = new Set();
  for (const id of owned) {
    for (const attr of card(id)?.attributes ?? []) ownedAttributes.add(attr);
  }
  return { owned, ownedAttributes, affinity: activeDeckAttributes(user.id) };
}

// --- Sélection des emplacements (brief §3.2) ---

/** Le joueur a-t-il de quoi couvrir ce matériau (carte précise ou porteur d'attribut) ? */
function hasMaterial(matId, ctx) {
  return ctx.owned.has(matId) || ctx.ownedAttributes.has(matId);
}

/**
 * Slot 1 — Le Maillon. Une carte non possédée qui, achetée, débloque
 * immédiatement une invocation :
 *   'unlocks'  — c'est une fusion/héritage/transfo dont TOUS les matériaux
 *                sont déjà là : elle est jouable le soir même ;
 *   'material' — c'est le matériau qui manque à une carte déjà possédée.
 *
 * Le second cas porte le badge le plus fort (« ⚡ Débloque : <la carte> »),
 * il gagne quand une carte relève des deux.
 */
function linkCandidates(pool, ctx) {
  const unlockedBy = new Map(); // materialId → carte possédée qu'il débloque
  for (const id of ctx.owned) {
    const owner = card(id);
    if (!owner) continue;
    for (const mat of materialsOf(owner)) {
      if (!ctx.owned.has(mat) && cards().has(mat) && !unlockedBy.has(mat)) unlockedBy.set(mat, owner.id);
    }
  }

  const out = [];
  for (const c of pool) {
    if (unlockedBy.has(c.id)) {
      out.push({ card: c, reason: 'material', reason_ref: unlockedBy.get(c.id) });
      continue;
    }
    const mats = materialsOf(c);
    if (mats.length && mats.every(m => hasMaterial(m, ctx))) {
      out.push({ card: c, reason: 'unlocks', reason_ref: null });
    }
  }
  return out;
}

/** Slot 2 — L'Affinité. Une carte non possédée qui pousse vers un seuil d'attribut. */
function affinityCandidates(pool, ctx) {
  if (!ctx.affinity.size) return [];
  const out = [];
  for (const c of pool) {
    // À attribut multiple, on annonce le plus représenté dans le deck : c'est
    // le seuil dont le joueur est le plus proche.
    let best = null;
    for (const attr of c.attributes ?? []) {
      const n = ctx.affinity.get(attr);
      if (n && (!best || n > best.n)) best = { attr, n };
    }
    if (best) out.push({ card: c, reason: 'affinity', reason_ref: best.attr });
  }
  return out;
}

/**
 * Tire un emplacement. Chaque slot garde SA règle et se replie sur le tirage
 * libre quand son pool est vide (fin de collection : les slots 1 et 2
 * dégénèrent naturellement en slot 3, aucun traitement particulier requis).
 */
function drawSlot(slot, pool, ctx, rand) {
  const candidates = slot === 1 ? linkCandidates(pool, ctx)
    : slot === 2 ? affinityCandidates(pool, ctx)
      : [];
  const source = candidates.length
    ? candidates
    : pool.map(c => ({ card: c, reason: 'random', reason_ref: null }));
  const pick = weightedPick(source, e => tierWeight(e.card), rand);
  if (!pick) return null;
  return {
    slot,
    card_id: pick.card.id,
    tier: Number(pick.card.tier) || 1,
    price_golds: SLOT_PRICE.golds,
    price_gems: SLOT_PRICE.gems,
    reason: pick.reason,
    reason_ref: pick.reason_ref,
    purchased: false,
  };
}

/**
 * Offre du jour. `excluded` porte les cartes retirées du pool par un reroll —
 * une carte rerollée ne peut pas être re-tirée le jour même, sinon le reroll
 * ne serait qu'un bouton « rejouer ».
 *
 * `pinned` est l'emplacement épinglé la veille : il traverse la rotation tel
 * quel — même carte, même prix, même badge. Son badge n'est pas recalculé :
 * « débloque X » reste vrai (une collection ne se dépossède pas) et le joueur
 * doit retrouver EXACTEMENT la proposition qu'il a mise de côté.
 */
function buildOffer(user, ctx, { day, excluded = [], pinned = null }) {
  const pool = [...cards().values()]
    .filter(c => !ctx.owned.has(c.id) && !excluded.includes(c.id))
    .sort((a, b) => a.id.localeCompare(b.id)); // ordre stable = tirage reproductible

  const slots = [];
  const taken = new Set();

  if (pinned && cards().has(pinned.card_id) && !ctx.owned.has(pinned.card_id)) {
    slots.push({
      slot: pinned.slot,
      card_id: pinned.card_id,
      tier: pinned.tier,
      price_golds: pinned.price_golds,
      price_gems: pinned.price_gems,
      reason: pinned.reason,
      reason_ref: pinned.reason_ref,
      purchased: false,
    });
    taken.add(pinned.card_id);
  }

  for (let slot = 1; slot <= DAILY_SLOTS; slot++) {
    if (slots.some(s => s.slot === slot)) continue;
    const drawn = drawSlot(slot, pool.filter(c => !taken.has(c.id)), ctx, seededRandom(user.id, day, slot, excluded.length));
    if (!drawn) continue;
    taken.add(drawn.card_id);
    slots.push(drawn);
  }

  slots.sort((a, b) => a.slot - b.slot);
  return { day, generated_at: Date.now(), slots, excluded };
}

// --- État du joueur ---

function readState(userId) {
  const row = stmt.shopStateByUser.get(userId);
  let offer = null;
  try { offer = row?.offer ? JSON.parse(row.offer) : null; } catch { offer = null; }
  let pinned = null;
  try { pinned = row?.pinned ? JSON.parse(row.pinned) : null; } catch { pinned = null; }
  let claimed = [];
  try { claimed = JSON.parse(row?.sets_claimed ?? '[]'); } catch { claimed = []; }
  return {
    user_id: userId,
    offer_day: row?.offer_day ?? null,
    offer,
    reroll_free_day: row?.reroll_free_day ?? null,
    pinned,
    sets_claimed: Array.isArray(claimed) ? claimed : [],
  };
}

function writeState(state) {
  stmt.upsertShopState.run({
    user_id: state.user_id,
    offer_day: state.offer_day,
    offer: JSON.stringify(state.offer ?? null),
    reroll_free_day: state.reroll_free_day,
    pinned: state.pinned ? JSON.stringify(state.pinned) : null,
    sets_claimed: JSON.stringify(state.sets_claimed ?? []),
  });
}

/**
 * Aligne l'offre du joueur sur le jour courant. Idempotent — appelé à chaque
 * lecture, comme `missions.sync`. Pas de rattrapage : une offre manquée est
 * manquée (brief §7 : la rotation est une opportunité, jamais une punition,
 * donc ni dette ni accumulation) — sauf l'emplacement épinglé, qui est
 * précisément la seule chose que le joueur a demandé à ne pas manquer.
 */
const sync = db.transaction((user) => {
  const state = readState(user.id);
  const day = dayKey();
  if (state.offer_day === day && state.offer) return state;

  const ctx = context(user);
  // Une épingle dont la carte est arrivée autrement (booster) n'a plus d'objet :
  // la garder gèlerait un emplacement sur une carte invendable.
  if (state.pinned && ctx.owned.has(state.pinned.card_id)) state.pinned = null;

  state.offer = buildOffer(user, ctx, { day, pinned: state.pinned });
  state.offer_day = day;
  writeState(state);
  return state;
});

// --- Achat d'un emplacement ---

/**
 * Achète l'emplacement `slot`. Le client envoie AUSSI la carte attendue :
 * l'achat valide l'offre horodatée, pas la courante — un tap au moment exact
 * de la rotation échoue proprement au lieu d'acheter la carte suivante
 * (brief §7, « verrou transactionnel sur l'offre »).
 */
const buySlot = db.transaction((user, slotIndex, expectedCardId, currency = 'golds') => {
  if (currency !== 'golds' && currency !== 'gems') return { ok: false, reason: 'Monnaie inconnue.' };

  const state = readState(user.id);
  const day = dayKey();
  if (state.offer_day !== day || !state.offer) return { ok: false, reason: 'L\'offre a changé, recharge la boutique.', stale: true };

  const slot = state.offer.slots.find(s => s.slot === slotIndex);
  if (!slot) return { ok: false, reason: 'Emplacement introuvable.' };
  if (expectedCardId && slot.card_id !== expectedCardId) {
    return { ok: false, reason: 'L\'offre a changé, recharge la boutique.', stale: true };
  }
  if (slot.purchased) return { ok: false, reason: 'Emplacement déjà acheté.' };

  const price = currency === 'gems' ? slot.price_gems : slot.price_golds;
  const fresh = stmt.userById.get(user.id);
  const balance = currency === 'gems' ? (fresh?.gems ?? 0) : (fresh?.gold ?? 0);
  if (balance < price) return { ok: false, reason: currency === 'gems' ? 'Pas assez de gemmes.' : 'Pas assez de golds.' };
  // Zéro doublon : une carte acquise entre-temps (booster, autre onglet) ne
  // peut plus être vendue.
  if (progression.ownsCard(fresh, slot.card_id)) return { ok: false, reason: 'Carte déjà possédée.' };

  progression.grant(user.id, currency === 'gems' ? { gems: -price } : { gold: -price });
  progression.unlockCard(user.id, slot.card_id);
  slot.purchased = true;

  // L'épingle a rempli son office : elle se libère d'elle-même à l'achat,
  // sinon elle bloquerait l'emplacement sur une carte désormais possédée.
  if (state.pinned?.card_id === slot.card_id) state.pinned = null;
  writeState(state);

  return {
    ok: true, card_id: slot.card_id, price, currency,
    sets_completed: claimSetCompletions(user.id, state),
  };
});

// --- Reroll ---

/**
 * Reroll d'un emplacement : la carte quitte le pool du jour et le slot est
 * re-tiré EN CONSERVANT SA RÈGLE (un reroll du Maillon rend un autre Maillon,
 * pas une carte au hasard). Un seul par jour, jamais payant.
 */
const reroll = db.transaction((user, slotIndex) => {
  const state = readState(user.id);
  const day = dayKey();
  if (state.offer_day !== day || !state.offer) return { ok: false, reason: 'L\'offre a changé, recharge la boutique.', stale: true };
  if (state.reroll_free_day === day) return { ok: false, reason: 'Reroll déjà utilisé aujourd\'hui.' };

  const slot = state.offer.slots.find(s => s.slot === slotIndex);
  if (!slot) return { ok: false, reason: 'Emplacement introuvable.' };
  if (slot.purchased) return { ok: false, reason: 'Emplacement déjà acheté.' };
  // Épingler puis rerouler se contredit : le reroll jetterait ce que l'épingle
  // vient de mettre de côté, et consommerait le reroll du jour pour rien.
  if (state.pinned?.card_id === slot.card_id) {
    return { ok: false, reason: 'Emplacement épinglé — détache-le d\'abord.' };
  }

  const ctx = context(user);
  const excluded = [...new Set([...(state.offer.excluded ?? []), slot.card_id])];
  const taken = state.offer.slots.filter(s => s.slot !== slotIndex).map(s => s.card_id);
  const pool = [...cards().values()]
    .filter(c => !ctx.owned.has(c.id) && !excluded.includes(c.id) && !taken.includes(c.id))
    .sort((a, b) => a.id.localeCompare(b.id));

  const drawn = drawSlot(slotIndex, pool, ctx, seededRandom(user.id, day, slotIndex, excluded.length));
  if (!drawn) return { ok: false, reason: 'Plus aucune carte à proposer.' };

  state.offer.excluded = excluded;
  state.offer.slots = state.offer.slots.map(s => (s.slot === slotIndex ? drawn : s));
  state.reroll_free_day = day;
  writeState(state);

  return { ok: true, slot: drawn };
});

// --- Épingle ---

/**
 * Épingle l'emplacement `slotIndex` (ou détache, avec `slotIndex = null`).
 *
 * L'épingle porte sur une PROPOSITION, pas sur une carte du catalogue : elle ne
 * donne aucune précision nouvelle, elle prolonge seulement ce que la boutique a
 * déjà offert. C'est pour ça qu'elle est gratuite, au prix normal, et sans
 * délai — contrairement à un système de commande, elle ne court-circuite rien.
 *
 * On mémorise l'emplacement ENTIER (carte, prix, badge) et pas seulement son
 * id : c'est ce qui garantit que le joueur retrouve le lendemain exactement la
 * proposition qu'il a mise de côté, prix compris.
 */
const setPin = db.transaction((user, slotIndex) => {
  const state = readState(user.id);

  if (slotIndex === null || slotIndex === undefined) {
    state.pinned = null;
    writeState(state);
    return { ok: true, pinned: null };
  }

  const day = dayKey();
  if (state.offer_day !== day || !state.offer) {
    return { ok: false, reason: 'L\'offre a changé, recharge la boutique.', stale: true };
  }

  const slot = state.offer.slots.find(s => s.slot === slotIndex);
  if (!slot) return { ok: false, reason: 'Emplacement introuvable.' };
  // Une carte achetée n'a plus rien à conserver — et l'épingle serait perdue
  // au premier sync, la carte étant désormais possédée.
  if (slot.purchased) return { ok: false, reason: 'Emplacement déjà acheté.' };

  // Une seule épingle : désigner un autre emplacement DÉPLACE la précédente.
  // Pas d'erreur « épingle déjà utilisée » à lever, le geste est sans ambiguïté.
  state.pinned = {
    slot: slot.slot,
    card_id: slot.card_id,
    tier: slot.tier,
    price_golds: slot.price_golds,
    price_gems: slot.price_gems,
    reason: slot.reason,
    reason_ref: slot.reason_ref,
    since_day: day,
  };
  writeState(state);
  return { ok: true, pinned: pinView(state) };
});

function pinView(state) {
  if (!state.pinned) return null;
  return { slot: state.pinned.slot, card_id: state.pinned.card_id, since_day: state.pinned.since_day };
}

// --- Boosters (brief §3.4) ---

/**
 * Tire les cartes d'un booster dans le pool NON POSSÉDÉ d'un set.
 *
 * Ordre de résolution, qui est aussi l'ordre d'abandon des garanties
 * (`fallback_priority` : cohérence d'attribut d'abord, garantie de tier
 * ensuite, jamais le zéro doublon) :
 *
 *   1. une carte Tier 3+ comme ANCRE — c'est elle qui donne son thème au
 *      booster et le pic d'intérêt du tirage ;
 *   2. les matériaux manquants de l'ancre si elle est composite (cohérence de
 *      lignée : un booster qui donne une fusion donne de quoi la jouer) ;
 *   3. le reste parmi les cartes partageant un attribut avec l'ancre, en
 *      Tier 1-2, pondéré ×2 par l'affinité avec le deck actif.
 *
 * Chaque repli est SILENCIEUX : un pool résiduel qui ne peut pas satisfaire
 * une garantie ne bloque jamais la vente (brief §7).
 */
function drawBooster(pool, ctx, rand) {
  const remaining = [...pool];
  const picked = [];
  const take = (candidates, weight) => {
    if (!candidates.length) return false;
    const pick = weightedPick(candidates, weight, rand);
    if (!pick) return false;
    picked.push(pick);
    remaining.splice(remaining.indexOf(pick), 1);
    return true;
  };

  const affinityWeight = c =>
    ((c.attributes ?? []).some(a => ctx.affinity.has(a)) ? BOOSTER.affinity_weight : 1);
  const { low, high_threshold } = BOOSTER.tier_guarantee;

  // 1. L'ancre.
  const highPool = remaining.filter(c => Number(c.tier) >= high_threshold);
  take(highPool.length ? highPool : remaining, c => tierWeight(c) * affinityWeight(c));
  const anchor = picked[0] ?? null;
  const anchorAttributes = new Set(anchor?.attributes ?? []);
  const coherent = c => (c.attributes ?? []).some(a => anchorAttributes.has(a));
  const wantedMaterials = new Set(anchor ? materialsOf(anchor).filter(m => !ctx.owned.has(m)) : []);

  // 2. Le reste. Chaîne de préférence, du plus fort au plus faible : la
  //    garantie de tier borne le pool, puis les matériaux manquants de
  //    l'ancre (lignée), puis la cohérence d'attribut. Chaque cran tombe
  //    silencieusement quand il ne reste rien pour le satisfaire — dans
  //    l'ordre du brief (§7 : cohérence d'abord, tier ensuite, jamais le
  //    zéro doublon).
  while (picked.length < BOOSTER.card_count && remaining.length) {
    const wantLow = picked.filter(c => Number(c.tier) < high_threshold).length < low;
    const tierOk = remaining.filter(c => (Number(c.tier) < high_threshold) === wantLow);
    const tierPool = tierOk.length ? tierOk : remaining;
    const lineagePool = tierPool.filter(c => wantedMaterials.has(c.id));
    const coherentPool = tierPool.filter(coherent);
    const pool = lineagePool.length ? lineagePool : (coherentPool.length ? coherentPool : tierPool);
    if (!take(pool, affinityWeight)) break;
  }

  return picked;
}

/**
 * Achat + ouverture d'un booster. Le tirage a lieu À L'ACHAT (jamais à
 * l'avance) : c'est ce qui rend sans objet le cas « deck actif modifié entre
 * la génération et l'ouverture ».
 */
const buyBooster = db.transaction((user, setId, currency = 'golds') => {
  const def = setDef(setId);
  if (!def) return { ok: false, reason: 'Set inconnu.' };
  if (def.booster_enabled === false) return { ok: false, reason: 'Ce set n\'est pas vendu en booster.' };
  if (currency !== 'golds' && currency !== 'gems') return { ok: false, reason: 'Monnaie inconnue.' };

  const ctx = context(user);
  const pool = setCardIds(def).filter(id => !ctx.owned.has(id)).map(card).filter(Boolean)
    .sort((a, b) => a.id.localeCompare(b.id));
  if (!pool.length) return { ok: false, reason: 'Collection complète sur ce set.' };

  const price = currency === 'gems' ? BOOSTER.price_gems : BOOSTER.price_golds;
  const fresh = stmt.userById.get(user.id);
  const balance = currency === 'gems' ? (fresh?.gems ?? 0) : (fresh?.gold ?? 0);
  if (balance < price) return { ok: false, reason: currency === 'gems' ? 'Pas assez de gemmes.' : 'Pas assez de golds.' };

  const drawn = drawBooster(pool, ctx, seededRandom(user.id, setId, Date.now(), Math.random()));
  if (!drawn.length) return { ok: false, reason: 'Collection complète sur ce set.' };

  progression.grant(user.id, currency === 'gems' ? { gems: -price } : { gold: -price });
  for (const c of drawn) progression.unlockCard(user.id, c.id);

  // Carte épinglée tombée au booster : l'épingle se libère d'elle-même —
  // laisser une carte possédée épinglée gèlerait l'emplacement.
  const state = readState(user.id);
  const pinHit = state.pinned && drawn.some(c => c.id === state.pinned.card_id);
  if (pinHit) {
    state.pinned = null;
    writeState(state);
  }

  return {
    ok: true,
    set_id: def.id,
    price,
    currency,
    cards: drawn.map(c => ({ card_id: c.id, tier: Number(c.tier) || 1 })),
    pin_cleared: !!pinHit,
    sets_completed: claimSetCompletions(user.id, state),
  };
});

/**
 * Verse les primes de complétion des sets terminés depuis le dernier passage.
 * Versée UNE fois par set (mémorisée dans l'état), et jamais à réclamer :
 * même règle que les paliers de missions — un gain qu'il faut penser à
 * récupérer est un gain qu'on perd.
 */
function claimSetCompletions(userId, state) {
  const user = stmt.userById.get(userId);
  const owned = new Set(progression.unlockedCardIds(user));
  const done = [];

  for (const def of sets()) {
    if (state.sets_claimed.includes(def.id)) continue;
    const ids = setCardIds(def);
    if (!ids.length || !ids.every(id => owned.has(id))) continue;
    state.sets_claimed.push(def.id);
    const rewards = def.completion_reward ?? {};
    const grant = { xp: rewards.xp ?? 0, gold: rewards.gold ?? 0, gems: rewards.gems ?? 0 };
    if (grant.xp || grant.gold || grant.gems) progression.grant(userId, grant);
    done.push({ set_id: def.id, name: def.name, rewards: grant });
  }

  if (done.length) writeState(state);
  return done;
}

// --- Lecture ---

function setsView(ctx) {
  return sets().map(def => {
    const ids = setCardIds(def);
    const owned = ids.filter(id => ctx.owned.has(id)).length;
    return {
      id: def.id,
      name: def.name,
      card_count: ids.length,
      owned_count: owned,
      complete: owned >= ids.length && ids.length > 0,
      booster_enabled: def.booster_enabled !== false,
      archetypes: (def.archetypes ?? []).slice(0, 3).map(a => a.name ?? a.attribute),
      signature_card: def.signature_card ?? null,
      completion_reward: def.completion_reward ?? null,
    };
  });
}

/**
 * Instantané servi au client. Aucun prix, aucun tirage, aucune règle de
 * calendrier ne vit côté client : il affiche ce que le serveur lui dit.
 */
function getSnapshot(user) {
  const state = readState(user.id);
  const ctx = context(user);
  const day = dayKey();
  const offered = state.offer_day === day ? (state.offer?.slots ?? []) : [];
  // L'état d'épingle est dérivé à la lecture plutôt que recopié dans l'offre
  // persistée : une seule source de vérité, donc pas de désaccord possible
  // entre les deux.
  const slots = offered.map(s => ({ ...s, pinned: state.pinned?.card_id === s.card_id }));

  return {
    day,
    next_rotation_at: nextRotationAt(),
    slots,
    reroll: {
      free_available: state.reroll_free_day !== day,
      per_day: FREE_REROLLS_PER_DAY,
    },
    pinned: pinView(state),
    pin_rules: { max: PINNED_SLOTS_MAX },
    booster: { price_golds: BOOSTER.price_golds, price_gems: BOOSTER.price_gems, card_count: BOOSTER.card_count },
    sets: setsView(ctx),
    prices: SLOT_PRICE,
    // Collection saturée : la boutique de cartes n'a plus rien à vendre. Le
    // client affiche un message de complétion plutôt que trois cases vides.
    collection: { owned: ctx.owned.size, total: cards().size },
  };
}

/** Sync + snapshot — le point d'entrée normal des routes. */
function refresh(user) {
  sync(user);
  return getSnapshot(user);
}

module.exports = {
  DAILY_SLOTS, SLOT_PRICE, TIER_WEIGHTS, BOOSTER,
  PINNED_SLOTS_MAX, FREE_REROLLS_PER_DAY, AFFINITY_MIN_OCCURRENCES,
  cards, sets, setCardIds, materialsOf, priceOf,
  dayKey, nextRotationAt, seededRandom, weightedPick,
  context, activeDeckAttributes, linkCandidates, affinityCandidates, buildOffer, drawBooster,
  sync, buySlot, reroll, setPin, buyBooster, pinView, getSnapshot, refresh,
};
