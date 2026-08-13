// CADEAUX — ce que le jeu DONNE, par opposition à ce qu'il vend (shop.js,
// cosmetics.js) et à ce qu'il fait gagner (missions.js, arcade.js,
// progression.js). db.js ne porte que l'accès SQL ; les RÈGLES sont ici.
//
// Deux familles, qui n'ont ni la même origine ni la même durée de vie :
//
//   - QUOTIDIEN (200 golds + 5 gemmes) — un barème, pas un tirage, remis à
//     disposition à chaque rotation. Il tourne sur le calendrier de la
//     boutique, littéralement : `shop.dayKey` et `shop.nextRotationAt` sont
//     importés, pas recopiés. Le joueur n'a qu'un rendez-vous quotidien à
//     retenir — missions, boutique, cosmétiques, arcade et cadeaux tombent
//     tous à 5 h.
//   - PONCTUELS — un catalogue écrit en admin (`data/gifts.json`). Un cadeau
//     porte plusieurs LOTS (cartes, packs, avatars, variantes, golds, gemmes)
//     récupérés d'un seul geste, s'adresse à tout le monde, et ne se récupère
//     qu'une fois par compte.
//
// Quatre règles portent le reste :
//
//   1. UN CADEAU SE RÉCUPÈRE, IL NE TOMBE PAS. Même raison qu'une mission
//      terminée : un crédit automatique fait disparaître le gain sous les yeux
//      du joueur. Le tap est le moment où le cadeau existe.
//   2. LE CADEAU EST CONSOMMÉ PAR LE GESTE, PAS PAR SON RENDEMENT. Une ligne
//      dont le joueur ne peut pas profiter (carte déjà possédée, cosmétique
//      déjà acquis, pack complet) ne fait PAS échouer la récupération : le
//      cadeau est soldé et le compte rendu dit la vérité, ligne par ligne.
//      L'inverse ferait de la générosité de l'admin un piège — « reviens quand
//      tu posséderas moins » — et laisserait à l'écran un cadeau que rien ne
//      peut plus effacer.
//   3. CE MODULE NE CONNAÎT AUCUN MONTANT QUI NE SOIT PAS LE SIEN. Un lot
//      `pack` n'ouvre pas un pack : il livre UN booster, par
//      `shop.deliverBooster`. Le tirage, le zéro-doublon, le filtre sur l'art,
//      l'épingle et les primes de complétion sont ceux de la boutique — pas
//      une seconde implémentation qui divergerait de la première.
//   4. ANCIENNETÉ DU COMPTE. Un cadeau porte sa date de création et ne
//      s'adresse qu'aux comptes créés AVANT lui. Sans quoi un inscrit du jour
//      hériterait de toute l'histoire des cadeaux du jeu — dédommagements
//      d'incidents qu'il n'a pas vécus compris — et ouvrirait le jeu sur une
//      pile faisant double emploi avec le pack de départ.
//
// ⚠️ IL N'Y A PAS DE `sync` ICI, et ce n'est pas un oubli. shop.js, cosmetics.js
// et arcade.js en exposent un parce qu'ils TIRENT une offre qu'il faut aligner
// sur le jour et persister. Les cadeaux ne tirent rien : la disponibilité du
// quotidien se lit dans une colonne, les ponctuels se dérivent du catalogue et
// du registre. Tout se déduit à la lecture, il n'y a aucun état à aligner.
//
// ⚠️ RÈGLE DE DÉPENDANCES : ce module est un PUITS. Il requiert shop.js,
// cosmetics.js, progression.js et sets.js ; aucun d'eux ne doit jamais le
// requérir en retour — le cycle serait immédiat, cosmetics.js requérant déjà
// shop.js, qui requiert déjà progression.js.
const path = require('path');
const fs = require('fs');
const { db, stmt } = require('./db');
const progression = require('./progression');
const cosmetics = require('./cosmetics');
const packs = require('./sets');
const variants = require('./variants');
// Même rotation que la boutique — pas une copie, les mêmes fonctions.
const shop = require('./shop');
const { dayKey, nextRotationAt } = shop;

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const GIFTS_FILE = path.join(DATA_DIR, 'gifts.json');

// --- Barème ---

// Le cadeau quotidien est un barème, pas un tirage : le montant vit ici et
// nulle part ailleurs. Le client tape, le serveur chiffre — règle générale du
// projet, déjà posée pour `progression.reward` et les missions.
const DAILY_REWARD = Object.freeze({ gold: 200, gems: 5 });

const LOT_TYPES = Object.freeze(['gold', 'gems', 'card', 'pack', 'avatar', 'variant']);
const CURRENCY_LOTS = Object.freeze(['gold', 'gems']);

// Plafond d'un lot de monnaie. Ce n'est pas une défiance envers l'admin, c'est
// le zéro en trop — qui ne se rattrape pas une fois les gemmes distribuées.
// Refusé à l'ÉCRITURE du catalogue (400) autant qu'ignoré à la lecture, jamais
// rogné en silence à la livraison.
const MAX_LOT_AMOUNT = 100_000;
const MAX_LOTS_PER_GIFT = 12;

// --- Catalogue ---
// Cache au mtime, même patron que sets.js / variants.js / cosmetics.js :
// l'admin écrit à chaud, sans redémarrage serveur.

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

/**
 * Normalise un LOT. Rend `null` pour tout ce qui n'est pas livrable — l'admin
 * écrit du JSON libre, et une ligne douteuse ne doit pas faire tomber la
 * récupération de tout le monde.
 *
 * ⚠️ L'EXISTENCE n'est délibérément pas vérifiée ici : un lot nommant une carte
 * qui n'existe pas ENCORE est légitime, le catalogue étant un fichier vivant
 * que l'admin complète après coup (même raisonnement que « le catalogue fait
 * foi, pas la base » pour la dotation). Elle est résolue à la livraison, et
 * rapportée.
 */
function normalizeLot(raw) {
  if (!raw || !LOT_TYPES.includes(raw.type)) return null;

  if (CURRENCY_LOTS.includes(raw.type)) {
    const amount = Number(raw.amount);
    if (!Number.isInteger(amount) || amount <= 0 || amount > MAX_LOT_AMOUNT) return null;
    return Object.freeze({ type: raw.type, amount });
  }

  const id = String(raw.id ?? '').slice(0, 64);
  if (!id) return null;
  return Object.freeze({ type: raw.type, id });
}

/**
 * Normalise un CADEAU. Rend `null` quand il n'y a rien à en tirer.
 *
 * ⚠️ Un `created_at` absent ou illisible fait TOMBER le cadeau, bruyamment.
 * C'est le seul champ qui n'a pas de lecture de repli sûre : le compter comme 0
 * le rend invisible à tout le monde pour toujours, le compter comme « maintenant »
 * l'ouvre aux comptes créés depuis — c'est-à-dire exactement ce que la règle
 * d'ancienneté interdit. On le nomme au chargement plutôt que de le deviner.
 * La route d'écriture l'estampille elle-même : le cas ne peut venir que d'un
 * fichier édité à la main ou d'un import.
 */
function normalizeGift(raw) {
  if (!raw) return null;
  const id = String(raw.id ?? '').slice(0, 64);
  if (!id) return null;

  const createdAt = Number(raw.created_at);
  if (!Number.isFinite(createdAt) || createdAt <= 0) {
    console.warn(`[gifts] ${id} : created_at manquant ou invalide, cadeau ignoré`);
    return null;
  }

  const contents = (Array.isArray(raw.contents) ? raw.contents : [])
    .slice(0, MAX_LOTS_PER_GIFT)
    .map(normalizeLot)
    .filter(Boolean);
  // Un cadeau qui ne donne rien est pire qu'un cadeau absent : il occupe
  // l'écran, se récupère, et ne produit rien.
  if (!contents.length) return null;

  return Object.freeze({
    id,
    name: String(raw.name ?? id).slice(0, 120),
    description: String(raw.description ?? '').slice(0, 500),
    created_at: createdAt,
    contents: Object.freeze(contents),
  });
}

const catalog = jsonCache(GIFTS_FILE, list => list.map(normalizeGift).filter(Boolean));

function giftDef(id) {
  return catalog().find(g => g.id === id) ?? null;
}

/**
 * Valide un cadeau à l'ÉCRITURE, pour que la route d'admin et le chargement ne
 * puissent pas diverger sur ce qu'est un cadeau valide : le même verdict sur la
 * même entrée, refusé en 400 ici plutôt que silencieusement ignoré là.
 * → { ok, errors: [{ field, message }] }
 */
function validateGift(raw) {
  const errors = [];
  const id = String(raw?.id ?? '').trim();
  if (!id) errors.push({ field: 'id', message: 'Un identifiant est requis.' });
  if (id.length > 64) errors.push({ field: 'id', message: 'Identifiant trop long (64 caractères maximum).' });
  if (!String(raw?.name ?? '').trim()) errors.push({ field: 'name', message: 'Un nom est requis.' });

  const contents = Array.isArray(raw?.contents) ? raw.contents : [];
  if (!contents.length) {
    errors.push({ field: 'contents', message: 'Un cadeau doit contenir au moins un lot.' });
  } else if (contents.length > MAX_LOTS_PER_GIFT) {
    errors.push({ field: 'contents', message: `Un cadeau ne peut pas dépasser ${MAX_LOTS_PER_GIFT} lots.` });
  }

  contents.forEach((lot, i) => {
    if (!lot || !LOT_TYPES.includes(lot.type)) {
      errors.push({ field: `contents.${i}.type`, message: `Lot ${i + 1} : type inconnu.` });
      return;
    }
    if (CURRENCY_LOTS.includes(lot.type)) {
      const amount = Number(lot.amount);
      if (!Number.isInteger(amount) || amount <= 0) {
        errors.push({ field: `contents.${i}.amount`, message: `Lot ${i + 1} : montant entier positif requis.` });
      } else if (amount > MAX_LOT_AMOUNT) {
        errors.push({ field: `contents.${i}.amount`, message: `Lot ${i + 1} : ${MAX_LOT_AMOUNT} maximum.` });
      }
    } else if (!String(lot.id ?? '').trim()) {
      errors.push({ field: `contents.${i}.id`, message: `Lot ${i + 1} : un identifiant est requis.` });
    }
  });

  return { ok: !errors.length, errors };
}

// --- Éligibilité ---

/**
 * Un cadeau n'est adressé qu'aux comptes qui EXISTAIENT quand il a été écrit.
 * L'égalité est admise : un compte créé à la milliseconde de la publication
 * était là, le refuser sur une égalité serait arbitraire.
 *
 * Les admins ne sont pas un cas particulier : `applyAdminGrants` leur donne
 * déjà tout, leurs lignes rapporteront simplement « déjà possédé », ce qui est
 * la vérité.
 */
function isEligible(def, user) {
  return Number(def.created_at) >= Number(user?.created_at ?? 0);
}

// --- Registre ---

function claimedMap(userId) {
  return new Map(stmt.giftsByUser.all(userId).map(r => [r.gift_id, r.claimed_at]));
}

function dailyState(userId) {
  const row = stmt.giftStateByUser.get(userId);
  return { day: row?.daily_day ?? null, claimed_at: row?.daily_claimed_at ?? null };
}

// --- Récupération du quotidien ---

/**
 * → { ok: true, kind: 'daily', day, granted } | { ok: false, reason }
 *
 * Aucun cas « stale » (409) n'existe : il n'y a pas d'offre à faire tourner
 * sous les doigts du joueur. Un tap qui enjambe 5 h récupère la journée d'avant
 * ou celle d'après, jamais rien et jamais deux fois.
 *
 * La ligne du registre est posée AVANT le crédit : si la suite jette, la
 * transaction l'emporte avec elle et le cadeau n'est pas consommé pour rien.
 * L'ordre inverse paierait deux fois sur une erreur au milieu.
 */
const claimDaily = db.transaction((user) => {
  const day = dayKey();
  const res = stmt.claimDailyGift.run({ user_id: user.id, day, now: Date.now() });
  if (!res.changes) return { ok: false, reason: 'Cadeau quotidien déjà récupéré.' };

  progression.grant(user.id, DAILY_REWARD);
  return { ok: true, kind: 'daily', day, granted: { ...DAILY_REWARD } };
});

// --- Livraison d'un lot ---

/**
 * Livre UN lot et rend compte fidèlement de ce qui s'est passé.
 *
 * `reason` est un CODE (`already_owned` | `unknown` | `empty_pool`) et non une
 * phrase : c'est le client qui l'habille. Le serveur n'écrit pas d'interface.
 *
 * → { type, id?, amount?, granted: bool, reason?, cards?, sets_completed? }
 */
function deliverLot(user, lot) {
  switch (lot.type) {
    case 'gold':
    case 'gems':
      // Les monnaies ne sont pas créditées ici : `claimGift` les cumule et ne
      // passe qu'UNE fois par `progression.grant`, pour ne pas hacher un cadeau
      // à plusieurs lots en une rafale d'écritures.
      return { type: lot.type, amount: lot.amount, granted: true };

    case 'card': {
      // `unlockCard` rend déjà `false` sur un id inconnu COMME sur une carte
      // possédée — deux situations que le joueur ne lit pas de la même façon,
      // d'où la distinction ici.
      if (progression.unlockCard(user.id, lot.id)) {
        // Une carte offerte qui termine un pack doit payer sa prime : c'est une
        // conséquence de la possession, pas de l'achat.
        const settled = shop.settleCollection(user.id, [lot.id]);
        return { type: 'card', id: lot.id, granted: true, ...settled };
      }
      const known = progression.allCardIds().includes(lot.id);
      return { type: 'card', id: lot.id, granted: false, reason: known ? 'already_owned' : 'unknown' };
    }

    case 'pack': {
      const def = packs.byId(lot.id);
      if (!def) return { type: 'pack', id: lot.id, granted: false, reason: 'unknown' };

      // ⚠️ Les refus COMMERCIAUX de `buyBooster` (pack de départ,
      // `booster_enabled: false`) ne sont pas rejoués : un cadeau n'est pas une
      // vente, et les rejouer rendrait muette une entrée pourtant écrite exprès
      // par l'admin. Le pack de départ se refuse tout seul, sans cas
      // particulier — son pool non possédé est vide par construction, tout
      // compte le recevant entier à l'inscription.
      const delivered = shop.deliverBooster(user, def);
      if (!delivered.ok) return { type: 'pack', id: lot.id, granted: false, reason: 'empty_pool' };

      return {
        type: 'pack',
        id: lot.id,
        granted: true,
        cards: delivered.cards,
        pin_cleared: delivered.pin_cleared,
        sets_completed: delivered.sets_completed,
      };
    }

    case 'avatar':
    case 'variant': {
      const res = cosmetics.unlock(user.id, lot.type, lot.id);
      if (!res.ok) return { type: lot.type, id: lot.id, granted: false, reason: 'unknown' };
      if (res.already) return { type: lot.type, id: lot.id, granted: false, reason: 'already_owned' };
      return { type: lot.type, id: lot.id, granted: true };
    }

    default:
      return { type: lot.type, granted: false, reason: 'unknown' };
  }
}

/** Replie les lignes en un récapitulatif — ce que le client anime. */
function totalsOf(lines) {
  const granted = { gold: 0, gems: 0, cards: [], cosmetics: [] };
  const setsCompleted = [];

  for (const line of lines) {
    if (!line.granted) continue;
    if (line.type === 'gold' || line.type === 'gems') granted[line.type] += line.amount;
    else if (line.type === 'card') granted.cards.push(line.id);
    else if (line.type === 'pack') granted.cards.push(...line.cards.map(c => c.card_id));
    else granted.cosmetics.push({ kind: line.type, id: line.id });
    for (const s of line.sets_completed ?? []) setsCompleted.push(s);
  }

  return { granted, sets_completed: setsCompleted };
}

// --- Récupération d'un cadeau ponctuel ---

/**
 * → { ok: true, gift, lines, granted, sets_completed } | { ok: false, reason }
 *
 * ⚠️ Un cadeau qui n'existe pas et un cadeau auquel ce compte n'a pas droit
 * rendent le MÊME motif : du point de vue du joueur, il n'y a rien là. Un
 * message distinct ne lui apprendrait que l'existence de ce qu'il ne peut pas
 * prendre — même règle que `missions.claim` sur la ligne d'un autre joueur.
 */
const claimGift = db.transaction((user, giftId) => {
  const id = String(giftId ?? '').slice(0, 64);
  const def = id ? giftDef(id) : null;
  if (!def || !isEligible(def, user)) return { ok: false, reason: 'Cadeau introuvable.' };

  const res = stmt.claimGift.run(user.id, def.id, Date.now());
  if (!res.changes) return { ok: false, reason: 'Cadeau déjà récupéré.' };

  const lines = def.contents.map(lot => deliverLot(user, lot));
  const totals = totalsOf(lines);

  // Un seul crédit pour tout le cadeau, cf. `deliverLot`.
  if (totals.granted.gold || totals.granted.gems) {
    progression.grant(user.id, { gold: totals.granted.gold, gems: totals.granted.gems });
  }

  return { ok: true, gift: { id: def.id, name: def.name }, lines, ...totals };
});

// --- Lecture ---

/**
 * Habille un lot pour l'affichage. Le libellé est résolu ICI pour que l'écran
 * n'ait pas à rappeler trois catalogues — même raison que les variantes
 * possédées de `cosmetics.getSnapshot`, qui voyagent en objets et non en ids.
 */
function lotView(lot) {
  if (CURRENCY_LOTS.includes(lot.type)) return { type: lot.type, amount: lot.amount };

  const base = { type: lot.type, id: lot.id };
  switch (lot.type) {
    case 'card': {
      const card = shop.cards().get(lot.id);
      return { ...base, label: card?.name ?? lot.id, tier: Number(card?.tier) || null };
    }
    case 'pack': {
      const def = packs.byId(lot.id);
      return { ...base, label: def?.name ?? lot.id, card_count: shop.BOOSTER.card_count };
    }
    case 'variant': {
      // Une variante n'a pas de nom propre : elle s'annonce par la carte
      // qu'elle habille (règle posée par cosmetics.js).
      const def = variants.byId(lot.id);
      const card = def ? shop.cards().get(def.card_id) : null;
      return { ...base, label: card?.name ?? def?.card_id ?? lot.id, card_id: def?.card_id ?? null };
    }
    default:
      return { ...base, label: shop.cards().get(lot.id)?.name ?? lot.id };
  }
}

/**
 * Instantané servi au client.
 *
 * ⚠️ Aucun `claimable_count` n'y figure. Le nombre de cadeaux en attente est
 * DÉRIVÉ côté client de `daily.claimed` et des `claimed` de la liste : une
 * valeur dérivée qu'on transporte est une valeur qui peut contredire sa source
 * (même règle que `claimableCount` côté missions).
 */
function getSnapshot(user) {
  const day = dayKey();
  const daily = dailyState(user.id);
  const claimed = claimedMap(user.id);

  const gifts = catalog()
    .filter(def => isEligible(def, user))
    .map(def => ({
      id: def.id,
      name: def.name,
      description: def.description,
      created_at: def.created_at,
      contents: def.contents.map(lotView),
      claimed: claimed.has(def.id),
      claimed_at: claimed.get(def.id) ?? null,
    }))
    // Ce sur quoi le joueur peut agir d'abord, puis du plus récent au plus
    // ancien — même ordre que les missions.
    .sort((a, b) => (a.claimed === b.claimed ? b.created_at - a.created_at : a.claimed ? 1 : -1));

  return {
    day,
    next_rotation_at: nextRotationAt(),
    daily: {
      reward: { ...DAILY_REWARD },
      claimed: daily.day === day,
      claimed_at: daily.day === day ? daily.claimed_at : null,
    },
    gifts,
  };
}

/**
 * Point d'entrée normal des routes. Alias de `getSnapshot` : il n'y a rien à
 * synchroniser (cf. l'en-tête), mais les routes se lisent comme les autres.
 */
function refresh(user) {
  return getSnapshot(user);
}

module.exports = {
  DAILY_REWARD, LOT_TYPES, CURRENCY_LOTS, MAX_LOT_AMOUNT, MAX_LOTS_PER_GIFT, GIFTS_FILE,
  catalog, giftDef, normalizeGift, normalizeLot, validateGift, isEligible,
  claimDaily, claimGift, getSnapshot, refresh,
};
