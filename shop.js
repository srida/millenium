// Boutique de cartes : emplacements quotidiens (épinglables), boosters.
// db.js ne porte que l'accès SQL ; les RÈGLES sont ici — même découpage que
// progression.js (dont ce module est le client pour débiter et débloquer) et
// missions.js (dont il reprend le calendrier : la boutique tourne au même
// reset de 5 h, brief §3.1).
//
// Deux systèmes, deux fonctions qui ne se recouvrent pas :
//
//   - Emplacements quotidiens — CHOIX À L'UNITÉ. 6 par jour, tirés dans TOUT le
//     pool non possédé, sans catégorie ni règle par emplacement : c'est une
//     vitrine, le joueur y prend ce qu'il veut. C'est le plafond qui structure
//     toute l'économie. Un seul peut être ÉPINGLÉ : il survit à la rotation
//     du lendemain au lieu d'être re-tiré.
//   - Booster — COLLECTION. Volume brut sur un set choisi, sans plafond.
//
// Deux invariants tiennent tout le reste :
//   1. ZÉRO DOUBLON — aucun tirage ne peut produire une carte déjà possédée.
//      C'est ce qui dispense le jeu de poussière, de fragments, de conversion.
//      C'est aussi, désormais, la SEULE contrainte qui pèse sur un tirage :
//      emplacements comme boosters tirent UNIFORMÉMENT dans leur pool non
//      possédé, sans poids de tier, sans affinité, sans garantie de composition.
//   2. L'OFFRE EST SERVEUR. Elle est générée, horodatée et persistée ici ;
//      aucune action client (changement de deck, rechargement, fuseau annoncé)
//      ne peut la régénérer — sinon l'offre se re-tire jusqu'à satisfaction.
//   3. UNE CARTE SANS ILLUSTRATION NE SE VEND PAS. Ce qu'on met en vitrine,
//      c'est une image : un emplacement à 500 golds sur un cadre vide ne
//      donne rien à vouloir, et un booster qui la révèle gâche son seul moment.
const crypto = require('crypto');
const { db, stmt } = require('./db');
const progression = require('./progression');
const missions = require('./missions');
const packs = require('./sets');
const variants = require('./variants');

// --- Barème (brief §3.3, §3.4, §3.5) ---

// 6 emplacements. Le nombre est la seule chose qui reste du plafond : plus de
// catégories (Maillon / Affinité / Inconnu), donc plus de raison d'en afficher
// trois. Une vitrine de trois cartes tirées au hasard frustre — sur six, il y a
// presque toujours quelque chose à vouloir, et l'arbitrage porte enfin sur
// « laquelle » plutôt que sur « est-ce que ça vaut le coup ».
const DAILY_SLOTS = 6;
// Prix unique, quel que soit le tier de la carte : le joueur choisit sa
// monnaie à l'achat (golds ou gemmes), comme pour un booster.
const SLOT_PRICE = Object.freeze({ golds: 500, gems: 20 });

// ⚠️ Il n'y a AUCUNE pondération de tirage. Ni par tier, ni par affinité au
// deck actif : toutes les cartes du pool ont exactement la même chance de
// sortir, en vitrine comme au booster. La distribution des tirages est donc
// celle du pool lui-même — les Tier 1, majoritaires au catalogue (≈38 %),
// sortent d'autant plus souvent, et les Tier 5 restent rares parce qu'ils sont
// rares. C'est assumé : le prix étant unique quel que soit le tier, un poids
// par tier ne servait plus d'arbitrage budgétaire, il ne faisait que déguiser
// le hasard en règle.

// Épingle : UN seul emplacement conservé d'une rotation à l'autre, gratuitement
// et sans limite de durée. C'est ce qui permet d'économiser pour une carte chère
// sans la voir disparaître au reset du lendemain.
//
// Le plafond de 1 n'est pas une avarice : épingler tous les emplacements
// figerait la boutique et supprimerait la rotation. Épingler, c'est renoncer à
// une proposition neuve — c'est l'arbitrage qui donne son poids au geste.
const PINNED_SLOTS_MAX = 1;

// Un reroll gratuit par jour, pas de reroll payant : un reroll achetable
// transformerait la boutique en machine à sous et casserait le plafond de
// 3 cartes/jour (brief §3.6).
const FREE_REROLLS_PER_DAY = 1;

// Un booster n'est plus qu'un VOLUME : 3 cartes, un prix, un pack. Il n'a plus
// ni ancre Tier 3+, ni garantie de composition, ni cohérence de lignée ou
// d'attribut — cf. `drawBooster`.
const BOOSTER = Object.freeze({
  card_count: 3,
  price_golds: 1000,
  price_gems: 40,
});

// --- Catalogues ---
// Cartes et packs sont lus par `sets.js` (cache mémoire invalidé au mtime) : ce
// catalogue est partagé avec progression.js, qui en a besoin pour la dotation.

const cards = packs.cards;

/**
 * Packs VENDUS EN BOUTIQUE. Le pack de départ en est exclu à la source, une
 * fois pour toutes : il est déjà entièrement possédé par chaque compte neuf, il
 * n'aurait jamais rien à vendre — et sa prime de complétion tomberait à
 * l'inscription. `setDef` continue de le trouver, pour pouvoir refuser un achat
 * avec un motif clair.
 */
const sets = packs.boosterPacks;
const setCardIds = packs.cardIdsOf;

function card(id) { return cards().get(id) ?? null; }
function setDef(id) { return packs.byId(id); }

/**
 * La carte a-t-elle son illustration ? `variants.illustrationExists` est le test
 * générique « cet id a-t-il son PNG ? » — cartes, terrains, magies et variantes
 * partagent l'espace de noms plat du dossier d'illustrations, et cosmetics.js
 * s'en sert déjà pour composer son pool d'avatars à partir des trois premiers.
 */
const hasArt = id => variants.illustrationExists(id);

/**
 * Catalogue VENDABLE : les cartes qui ont leur art. C'est le seul pool que
 * connaisse la boutique — emplacements, boosters, décomptes de pack et
 * compteur de collection lisent tous celui-ci, sans quoi une carte sans image
 * serait à la fois impossible à obtenir et comptée comme manquante (un pack
 * jamais complétable, donc une prime jamais versée).
 *
 * ⚠️ La DOTATION d'un compte neuf n'est pas concernée (`progression.starterCardIds`) :
 * elle est offerte, pas vendue — l'art n'y conditionne rien.
 */
function sellableCards() {
  return [...cards().values()].filter(c => hasArt(c.id));
}

/** Cartes d'un pack réellement vendables (mêmes ids que `setCardIds`, moins celles sans art). */
function sellableSetCardIds(def) {
  return setCardIds(def).filter(hasArt);
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

/**
 * Tirage UNIFORME dans `list`. Toute la boutique passe par ici : c'est le seul
 * endroit du module où le hasard entre, et il n'y a rien à y régler. Une liste
 * vide rend `null` — l'appelant décide si c'est un repli ou un refus de vente.
 */
function pick(list, rand) {
  if (!list.length) return null;
  return list[Math.floor(rand() * list.length)] ?? list[list.length - 1];
}

// --- Contexte du joueur ---
//
// ⚠️ Le contexte ne porte plus que la COLLECTION. Le deck actif n'y entre plus
// (`activeDeckAttributes` est supprimé) : plus aucun tirage ne le consulte, ni
// en vitrine ni au booster. C'est autant de surface d'exploit en moins — la
// question « le joueur peut-il piloter son tirage en changeant de deck ? » ne
// se pose plus nulle part, au lieu de dépendre du moment du tirage.

function context(user) {
  return { owned: new Set(progression.unlockedCardIds(user)) };
}

// --- Sélection des emplacements ---
//
// ⚠️ Il n'y a plus de RÈGLE par emplacement. Les trois catégories historiques
// (Le Maillon « invocable immédiatement », L'Affinité « synergie », L'Inconnu
// « découverte ») sont supprimées : les six emplacements sont tirés dans le
// MÊME pool, tout le catalogue non possédé, et sans aucune pondération.
//
// Ce que ça change, et pourquoi c'est assumé : le badge portait la valeur
// perçue d'un emplacement (« la pièce qui manque à ta fusion » ≠ « une carte au
// hasard », au même prix). Mais il ne la portait que quand le graphe
// d'invocation avait quelque chose à dire — sur une collection jeune ou une
// carte sans matériaux, les slots dégénéraient en tirage libre et le joueur
// voyait « 🎲 Découverte » sans comprendre pourquoi ses deux autres
// emplacements avaient l'air d'être des cadeaux. Une vitrine uniforme et plus
// large se lit d'un coup d'œil ; c'est le NOMBRE (6) qui remplace le badge
// comme réponse à la frustration.
//
// L'affinité au deck actif ne survit nulle part, boosters compris : le tirage
// est le même pour tout le monde, du compte neuf au collectionneur.

/** Tire un emplacement : tirage uniforme dans le pool, sans aucun poids. */
function drawSlot(slot, pool, rand) {
  const drawn = pick(pool, rand);
  if (!drawn) return null;
  return {
    slot,
    card_id: drawn.id,
    tier: Number(drawn.tier) || 1,
    price_golds: SLOT_PRICE.golds,
    price_gems: SLOT_PRICE.gems,
    purchased: false,
  };
}

/**
 * Pool tirable : tout le catalogue VENDABLE non possédé, moins les cartes
 * rerollées du jour et celles déjà placées dans l'offre. L'ordre est stable
 * (par id) — c'est lui qui rend le tirage reproductible à graine égale.
 */
function drawablePool(ctx, excluded, taken) {
  return sellableCards()
    .filter(c => !ctx.owned.has(c.id) && !excluded.includes(c.id) && !taken.has(c.id))
    .sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * Complète `slots` jusqu'à `DAILY_SLOTS` — les emplacements déjà présents ne
 * sont JAMAIS re-tirés. Sert à la génération du jour comme au rattrapage d'une
 * offre plus courte que le format courant (cf. `sync`).
 */
function fillSlots(user, ctx, { day, slots, excluded = [] }) {
  const taken = new Set(slots.map(s => s.card_id));
  for (let slot = 1; slot <= DAILY_SLOTS; slot++) {
    if (slots.some(s => s.slot === slot)) continue;
    const drawn = drawSlot(slot, drawablePool(ctx, excluded, taken), seededRandom(user.id, day, slot, excluded.length));
    if (!drawn) continue;
    taken.add(drawn.card_id);
    slots.push(drawn);
  }
  slots.sort((a, b) => a.slot - b.slot);
  return slots;
}

/**
 * Offre du jour. `excluded` porte les cartes retirées du pool par un reroll —
 * une carte rerollée ne peut pas être re-tirée le jour même, sinon le reroll
 * ne serait qu'un bouton « rejouer ».
 *
 * `pinned` est l'emplacement épinglé la veille : il traverse la rotation tel
 * quel — même carte, même prix. Le joueur doit retrouver EXACTEMENT la
 * proposition qu'il a mise de côté.
 */
function buildOffer(user, ctx, { day, excluded = [], pinned = null }) {
  const slots = [];

  // Une épingle dont l'art a été retiré depuis l'admin ne traverse pas la
  // rotation : la boutique ne remet pas en vitrine ce qu'elle ne pourrait plus
  // y tirer.
  if (pinned && cards().has(pinned.card_id) && hasArt(pinned.card_id) && !ctx.owned.has(pinned.card_id)) {
    slots.push({
      slot: pinned.slot,
      card_id: pinned.card_id,
      tier: pinned.tier,
      // Barème COURANT, pas celui figé dans l'épingle : le prix est global et
      // ré-estampillé à la lecture (`withSlotPrices`), une épingle sans date
      // de péremption ne doit pas transporter un barème abandonné.
      price_golds: SLOT_PRICE.golds,
      price_gems: SLOT_PRICE.gems,
      purchased: false,
    });
  }

  fillSlots(user, ctx, { day, slots, excluded });
  return { day, generated_at: Date.now(), slots, excluded };
}

// --- État du joueur ---

// Le prix est GLOBAL (`SLOT_PRICE`), pas une propriété du tirage : il est donc
// ré-estampillé à la lecture, et les champs persistés dans l'offre ne sont
// qu'un miroir. C'est ce qui fait qu'un changement de barème prend effet tout
// de suite au lieu d'attendre la rotation — et surtout qu'un emplacement
// ÉPINGLÉ, qui traverse les rotations indéfiniment, ne garde pas à vie le prix
// du jour où il a été mis de côté. « Même carte, même prix » ne dit rien
// d'autre tant que le prix ne dépend pas de la carte.
//
// Rattrape du même geste les emplacements persistés avant le passage au prix
// unique (`price` → `price_golds`/`price_gems`), qui s'affichaient en NaN.
function withSlotPrices(slot) {
  if (!slot) return slot;
  return { ...slot, price_golds: SLOT_PRICE.golds, price_gems: SLOT_PRICE.gems };
}

function readState(userId) {
  const row = stmt.shopStateByUser.get(userId);
  let offer = null;
  try { offer = row?.offer ? JSON.parse(row.offer) : null; } catch { offer = null; }
  if (offer?.slots) offer.slots = offer.slots.map(withSlotPrices);
  let pinned = null;
  try { pinned = row?.pinned ? JSON.parse(row.pinned) : null; } catch { pinned = null; }
  pinned = withSlotPrices(pinned);
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
  if (state.offer_day === day && state.offer) {
    // Offre plus courte que le format courant : elle a été tirée avant que
    // DAILY_SLOTS n'augmente. On la COMPLÈTE au lieu de la régénérer — les
    // emplacements déjà tirés (achats compris) sont conservés tels quels, donc
    // l'invariant « l'offre ne se re-tire pas » tient toujours. Le nombre de
    // slots ne dépend d'aucune entrée client : ce rattrapage n'est pas
    // déclenchable à volonté.
    const before = state.offer.slots?.length ?? 0;
    if (before < DAILY_SLOTS) {
      state.offer.slots = fillSlots(user, context(user), {
        day, slots: state.offer.slots ?? [], excluded: state.offer.excluded ?? [],
      });
      // Pool épuisé (collection presque complète) : ne pas réécrire à chaque
      // lecture pour un tirage qui ne rendra jamais rien.
      if (state.offer.slots.length !== before) writeState(state);
    }
    return state;
  }

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
 * re-tiré dans le reste du catalogue non possédé. Un seul par jour, jamais
 * payant.
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
  const taken = new Set(state.offer.slots.filter(s => s.slot !== slotIndex).map(s => s.card_id));
  const pool = drawablePool(ctx, excluded, taken);

  const drawn = drawSlot(slotIndex, pool, seededRandom(user.id, day, slotIndex, excluded.length));
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
 * On mémorise l'emplacement ENTIER (carte, prix) et pas seulement son id :
 * c'est ce qui garantit que le joueur retrouve le lendemain exactement la
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
 * Tire les cartes d'un booster dans le pool NON POSSÉDÉ d'un set : `card_count`
 * cartes DISTINCTES, prises uniformément au hasard. Rien d'autre.
 *
 * ⚠️ Tout ce qui structurait le tirage a été retiré, et ce n'est pas un
 * appauvrissement par accident : l'ancre Tier 3+, la garantie « 2 basses +
 * 1 haute », la cohérence de lignée (les matériaux manquants de l'ancre) et la
 * cohérence d'attribut promettaient un booster THÉMATIQUE, mais chacune de ces
 * garanties tombait silencieusement dès que le pool résiduel ne pouvait plus la
 * satisfaire — c'est-à-dire de plus en plus souvent à mesure que le joueur
 * complétait le pack, donc exactement quand il y tenait le plus. Le hasard
 * franc tient au moins sa promesse d'un bout à l'autre de la collection.
 *
 * Reste le seul invariant qui n'a jamais été négociable : ZÉRO DOUBLON. Il est
 * ici porté par le pool (`buyBooster` en retire les cartes possédées) et par le
 * retrait de chaque carte tirée — un booster ne se répète pas lui-même.
 */
function drawBooster(pool, rand) {
  const remaining = [...pool];
  const picked = [];
  while (picked.length < BOOSTER.card_count && remaining.length) {
    const drawn = pick(remaining, rand);
    if (!drawn) break;
    picked.push(drawn);
    remaining.splice(remaining.indexOf(drawn), 1);
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
  // Le pack de départ est absent de l'instantané : un client à jour ne peut pas
  // le proposer. On refuse quand même explicitement — l'id vient du réseau.
  if (packs.isStarter(def)) return { ok: false, reason: 'Ce pack est offert à la création du compte.' };
  if (def.booster_enabled === false) return { ok: false, reason: 'Ce set n\'est pas vendu en booster.' };
  if (currency !== 'golds' && currency !== 'gems') return { ok: false, reason: 'Monnaie inconnue.' };

  const ctx = context(user);
  const pool = sellableSetCardIds(def).filter(id => !ctx.owned.has(id)).map(card).filter(Boolean)
    .sort((a, b) => a.id.localeCompare(b.id));
  if (!pool.length) return { ok: false, reason: 'Collection complète sur ce set.' };

  const price = currency === 'gems' ? BOOSTER.price_gems : BOOSTER.price_golds;
  const fresh = stmt.userById.get(user.id);
  const balance = currency === 'gems' ? (fresh?.gems ?? 0) : (fresh?.gold ?? 0);
  if (balance < price) return { ok: false, reason: currency === 'gems' ? 'Pas assez de gemmes.' : 'Pas assez de golds.' };

  const drawn = drawBooster(pool, seededRandom(user.id, setId, Date.now(), Math.random()));
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
    // Les cartes sans art ne sont pas vendues : les exiger pour la prime la
    // rendrait inatteignable, alors même que l'écran affiche « ✓ complet ».
    const ids = sellableSetCardIds(def);
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
    // Décompte sur les cartes VENDABLES : le joueur ne doit pas voir « 55/57 »
    // sur un pack dont les deux dernières cartes ne peuvent pas sortir.
    const ids = sellableSetCardIds(def);
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
      // Le pack a-t-il SON affiche ? Il n'y a pas d'affiche par défaut à servir
      // (contrairement aux avatars de decks publics) : c'est donc le client qui
      // pose une tuile neutre, plutôt qu'une image cassée.
      has_poster: packs.posterExists(def.id),
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
    // client affiche un message de complétion plutôt que des cases vides.
    // Le décompte porte sur le catalogue VENDABLE, des deux côtés de la
    // fraction : une carte sans art ne se compte ni au numérateur (elle a pu
    // arriver par la dotation) ni au dénominateur, sinon la vitrine se viderait
    // sans que le compteur n'atteigne jamais son total.
    collection: (() => {
      const sellable = sellableCards();
      return { owned: sellable.filter(c => ctx.owned.has(c.id)).length, total: sellable.length };
    })(),
  };
}

/** Sync + snapshot — le point d'entrée normal des routes. */
function refresh(user) {
  sync(user);
  return getSnapshot(user);
}

module.exports = {
  DAILY_SLOTS, SLOT_PRICE, BOOSTER,
  PINNED_SLOTS_MAX, FREE_REROLLS_PER_DAY,
  cards, sets, setCardIds, sellableCards, sellableSetCardIds, hasArt, priceOf,
  dayKey, nextRotationAt, seededRandom, pick,
  context, drawSlot, drawablePool, fillSlots, buildOffer, drawBooster,
  sync, buySlot, reroll, setPin, buyBooster, pinView, getSnapshot, refresh,
};
