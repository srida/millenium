// Boutique COSMÉTIQUE : avatars et variantes d'illustration.
// db.js ne porte que l'accès SQL ; les RÈGLES sont ici — même découpage que
// shop.js (dont ce module reprend le calendrier, littéralement : les deux
// tournent au même reset de 5 h) et progression.js (dont il est le client pour
// débiter les gemmes).
//
// Deux familles, qui n'ont ni le même pool ni le même prix :
//
//   - AVATAR (10 gemmes) — n'importe quelle illustration existante du jeu :
//     carte, terrain ou magie. Le pool est automatique, sans curation : tout
//     ce qui a une image est un visage possible.
//   - VARIANTE (100 gemmes) — illustration alternative d'une carte, écrite en
//     admin. Le joueur ne peut acheter que les variantes des cartes QU'IL
//     POSSÈDE : une variante d'une carte qu'on n'a pas ne s'affiche nulle part.
//
// Les invariants sont ceux de la boutique de cartes, pour les mêmes raisons :
//   1. ZÉRO DOUBLON — un cosmétique possédé ne ressort jamais du tirage.
//   2. L'OFFRE EST SERVEUR. Générée, horodatée et persistée ici ; aucune action
//      client ne la régénère, sinon elle se re-tirerait jusqu'à satisfaction.
//
// Rien à rerouler, rien à épingler : les prix sont bas et un cosmétique manqué
// revient (contrairement à une carte, il ne sort pas du pool à l'achat).
const path = require('path');
const fs = require('fs');
const { db, stmt } = require('./db');
const progression = require('./progression');
const variants = require('./variants');
// Même rotation que la boutique de cartes — pas une copie, la même fonction.
const { dayKey, nextRotationAt, seededRandom } = require('./shop');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');

// --- Barème ---

const DAILY = Object.freeze({ avatars: 3, variants: 3 });

// Prix fixes, en gemmes uniquement. Un avatar coûte le dixième d'une variante :
// l'un se change comme on change d'humeur, l'autre est un investissement sur
// une carte qu'on joue.
const PRICE = Object.freeze({
  avatar: Object.freeze({ gems: 10 }),
  variant: Object.freeze({ gems: 100 }),
});

const KINDS = Object.freeze(['avatar', 'variant']);

// Avatars offerts à tout le monde, jamais vendus et jamais tirés. C'est la
// liste que ProfileScreen codait en dur avant l'existence de cette boutique :
// elle vit ici désormais, pour que l'affichage et la validation d'appartenance
// ne puissent pas diverger.
const DEFAULT_AVATARS = Object.freeze([
  'CORE_001', 'CORE_002', 'CORE_003', 'CORE_004', 'CORE_005', 'CORE_006', 'CORE_007',
]);

// --- Catalogues ---
// Les avatars puisent dans TROIS fichiers (cartes, terrains, magies) dont les
// illustrations partagent un espace de noms plat. Cache au mtime, même patron
// que sets.js / variants.js : l'admin écrit à chaud.

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

const SOURCES = [
  { key: 'card',  file: 'cards.json' },
  { key: 'board', file: 'boards.json' },
  { key: 'magie', file: 'magies.json' },
];

const sourceCaches = SOURCES.map(({ key, file }) => ({
  key,
  read: jsonCache(path.join(DATA_DIR, file), list => list.filter(e => e && e.id)),
}));

/**
 * Pool d'avatars : toute entité ayant une illustration, moins les avatars
 * offerts d'office (les vendre reviendrait à vendre ce qu'on donne). Trié par
 * id — le tirage doit être reproductible d'un appel à l'autre.
 */
function avatarPool() {
  const defaults = new Set(DEFAULT_AVATARS);
  const out = [];
  for (const { key, read } of sourceCaches) {
    for (const entity of read()) {
      if (defaults.has(entity.id)) continue;
      if (!variants.illustrationExists(entity.id)) continue;
      out.push({ id: entity.id, name: entity.name ?? entity.id, source: key });
    }
  }
  return out.sort((a, b) => a.id.localeCompare(b.id));
}

/** Index des cartes, pour nommer une variante par la carte qu'elle habille. */
const cards = jsonCache(path.join(DATA_DIR, 'cards.json'), list =>
  new Map(list.filter(c => c && c.id).map(c => [c.id, c])));

/**
 * Pool de variantes : celles dont la carte est POSSÉDÉE et dont l'art existe.
 * Une variante sans illustration n'est pas vendable — l'admin le signale, mais
 * ne l'empêche pas d'exister.
 */
function variantPool(user) {
  const owned = new Set(progression.unlockedCardIds(user));
  return variants.all()
    .filter(v => owned.has(v.card_id) && variants.illustrationExists(v.id))
    .map(v => {
      const card = cards().get(v.card_id);
      return {
        id: v.id,
        card_id: v.card_id,
        name: v.name ?? v.id,
        card_name: card?.name ?? v.card_id,
        tier: card?.tier ?? null,
      };
    })
    .sort((a, b) => a.id.localeCompare(b.id));
}

// --- Possession ---

function ownedOf(userId) {
  const rows = stmt.cosmeticsByUser.all(userId);
  return {
    avatars: rows.filter(r => r.kind === 'avatar').map(r => r.cosmetic_id),
    variants: rows.filter(r => r.kind === 'variant').map(r => r.cosmetic_id),
  };
}

function owns(userId, kind, id) {
  return !!stmt.hasCosmetic.get(userId, kind, id);
}

/**
 * Cet avatar est-il portable ? Les avatars par défaut le sont toujours ; les
 * autres doivent avoir été achetés. C'est la seule barrière entre `PUT
 * /profile/me` et une chaîne arbitraire injectée dans un `<img src>`.
 */
function canUseAvatar(user, avatarId) {
  if (!avatarId) return false;
  if (DEFAULT_AVATARS.includes(avatarId)) return true;
  return owns(user.id, 'avatar', avatarId);
}

// --- Tirage ---

/** Tire `count` éléments distincts du pool. Moins si le pool est plus court. */
function pick(pool, count, rand) {
  const remaining = [...pool];
  const out = [];
  while (out.length < count && remaining.length) {
    out.push(...remaining.splice(Math.floor(rand() * remaining.length), 1));
  }
  return out;
}

/**
 * Offre du jour. Déterministe à (user, jour, famille) : un tirage douteux se
 * rejoue au lieu de se raconter.
 *
 * Dégénérescence assumée : moins de trois candidats éligibles donnent moins de
 * trois emplacements — voire zéro (joueur ne possédant aucune carte à
 * variante). Le client affiche alors un message, pas des cases vides.
 */
function buildOffer(user, { day }) {
  const ownedIds = ownedOf(user.id);
  const ownedAvatars = new Set(ownedIds.avatars);
  const ownedVariants = new Set(ownedIds.variants);

  const avatars = pick(
    avatarPool().filter(a => !ownedAvatars.has(a.id)),
    DAILY.avatars,
    seededRandom(user.id, day, 'avatar'),
  );
  const variantList = pick(
    variantPool(user).filter(v => !ownedVariants.has(v.id)),
    DAILY.variants,
    seededRandom(user.id, day, 'variant'),
  );

  return {
    day,
    generated_at: Date.now(),
    avatars: avatars.map(a => ({ ...a, price_gems: PRICE.avatar.gems })),
    variants: variantList.map(v => ({ ...v, price_gems: PRICE.variant.gems })),
  };
}

// --- Persistance ---

function readState(userId) {
  const row = stmt.cosmeticStateByUser.get(userId);
  let offer = null;
  try { offer = row?.offer ? JSON.parse(row.offer) : null; } catch { offer = null; }
  return { user_id: userId, offer_day: row?.offer_day ?? null, offer };
}

function writeState(state) {
  stmt.upsertCosmeticState.run({
    user_id: state.user_id,
    offer_day: state.offer_day,
    offer: JSON.stringify(state.offer ?? null),
  });
}

/**
 * Aligne l'offre du joueur sur le jour courant. Idempotent — appelé à chaque
 * lecture, comme `shop.sync`. Pas de rattrapage : une offre manquée est
 * manquée.
 */
const sync = db.transaction((user) => {
  const state = readState(user.id);
  const day = dayKey();
  if (state.offer_day === day && state.offer) return state;

  state.offer = buildOffer(user, { day });
  state.offer_day = day;
  writeState(state);
  return state;
});

// --- Achat ---

/**
 * Achète un cosmétique de l'offre du jour. Comme pour les cartes, le client
 * nomme (`kind` + `id`) et le serveur chiffre : aucun montant ne transite dans
 * le sens client → serveur.
 *
 * L'achat porte sur l'offre HORODATÉE : un tap au moment exact de la rotation
 * échoue proprement (stale → 409) au lieu d'acheter ce qui vient de prendre la
 * place.
 */
const buy = db.transaction((user, kind, id) => {
  if (!KINDS.includes(kind)) return { ok: false, reason: 'Type de cosmétique inconnu.' };

  const state = readState(user.id);
  const day = dayKey();
  if (state.offer_day !== day || !state.offer) {
    return { ok: false, reason: 'L\'offre a changé, recharge la boutique.', stale: true };
  }

  const pool = kind === 'avatar' ? state.offer.avatars : state.offer.variants;
  const item = (pool ?? []).find(e => e.id === id);
  if (!item) return { ok: false, reason: 'L\'offre a changé, recharge la boutique.', stale: true };
  if (owns(user.id, kind, id)) return { ok: false, reason: 'Cosmétique déjà possédé.' };

  const price = item.price_gems ?? PRICE[kind].gems;
  const fresh = stmt.userById.get(user.id);
  if ((fresh?.gems ?? 0) < price) return { ok: false, reason: 'Pas assez de gemmes.' };

  // Une variante dont la carte a été perdue entre-temps ne peut pas exister
  // (une collection ne se dépossède pas), mais la carte peut avoir disparu du
  // catalogue depuis le tirage — mieux vaut refuser que vendre du vide.
  if (kind === 'variant' && !variants.byId(id)) {
    return { ok: false, reason: 'Variante introuvable.', stale: true };
  }

  progression.grant(user.id, { gems: -price });
  stmt.unlockCosmetic.run(user.id, kind, id, Date.now());

  return { ok: true, kind, id, price, currency: 'gems' };
});

// --- Variantes d'un deck (PvP) ---

/**
 * Map `card_id → variant_id` du deck d'un joueur, dérivée de la copie SERVEUR
 * du deck book. Le client ne transmet JAMAIS cette map — même principe que
 * `shop.activeDeckAttributes` : sinon elle serait pilotable depuis la requête,
 * et n'importe qui afficherait à son adversaire une variante non achetée.
 *
 * `deckName` vient bien du client, mais ne sert qu'à choisir une clé du propre
 * livre de ce joueur : il ne peut rien injecter.
 */
function deckVariantMap(userId, deckName) {
  const row = stmt.deckBookByUser.get(userId);
  if (!row) return {};
  let book;
  try { book = JSON.parse(row.data); } catch { return {}; }

  const name = deckName && book?.decks?.[deckName] ? deckName : book?.active;
  const deck = book?.decks?.[name];
  if (!deck) return {};

  const inDeck = new Set();
  for (const ids of Object.values(deck)) {
    for (const id of Array.isArray(ids) ? ids : []) inDeck.add(id);
  }

  const owned = new Set(ownedOf(userId).variants);
  const out = {};
  for (const [cardId, variantId] of Object.entries(book?.meta?.[name]?.variants ?? {})) {
    if (!inDeck.has(cardId) || !owned.has(variantId)) continue;
    const def = variants.byId(variantId);
    if (!def || def.card_id !== cardId) continue;
    out[cardId] = variantId;
  }
  return out;
}

// --- Lecture ---

/**
 * Instantané servi au client. Un seul endpoint alimente les trois écrans qui
 * en ont besoin : la boutique (l'offre), le profil (les avatars portables) et
 * le DeckBuilder (les variantes possédées, avec leur carte).
 */
function getSnapshot(user) {
  const state = readState(user.id);
  const day = dayKey();
  const offer = state.offer_day === day ? state.offer : null;
  const ownedIds = ownedOf(user.id);
  const ownedAvatars = new Set(ownedIds.avatars);
  const ownedVariants = new Set(ownedIds.variants);

  // Les variantes possédées voyagent en OBJETS, pas en ids : le DeckBuilder a
  // besoin du card_id et du nom pour bâtir son sélecteur, et cette forme lui
  // évite un second appel au catalogue.
  const ownedVariantDefs = ownedIds.variants.map(id => {
    const def = variants.byId(id);
    return {
      id,
      card_id: def?.card_id ?? null,
      name: def?.name ?? id,
      card_name: cards().get(def?.card_id)?.name ?? null,
    };
  }).filter(v => v.card_id);

  return {
    day,
    next_rotation_at: nextRotationAt(),
    prices: PRICE,
    avatars: (offer?.avatars ?? []).map(a => ({ ...a, purchased: ownedAvatars.has(a.id) })),
    variants: (offer?.variants ?? []).map(v => ({ ...v, purchased: ownedVariants.has(v.id) })),
    owned: { avatars: ownedIds.avatars, variants: ownedVariantDefs },
    default_avatars: [...DEFAULT_AVATARS],
  };
}

/** Sync + snapshot — le point d'entrée normal des routes. */
function refresh(user) {
  sync(user);
  return getSnapshot(user);
}

module.exports = {
  DAILY, PRICE, KINDS, DEFAULT_AVATARS,
  avatarPool, variantPool, ownedOf, owns, canUseAvatar,
  buildOffer, sync, buy, deckVariantMap,
  getSnapshot, refresh,
};
