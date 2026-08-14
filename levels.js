// NIVEAUX — ce que le passage d'un palier DONNE. db.js ne porte que l'accès
// SQL, progression.js la COURBE (100 XP par niveau, absorption du palier) ; le
// barème du palier vit ici, et nulle part ailleurs.
//
// Trois marches, de la plus fréquente à la plus rare — c'est ce rythme qui fait
// qu'un niveau se remarque même quand il ne tombe pas sur un multiple :
//
//   - CHAQUE niveau        → 50 golds
//   - tous les 5 niveaux   → 50 gemmes en plus
//   - tous les 10 niveaux  → un OBJET tiré au sort en plus : carte, avatar ou
//     variante d'illustration
//
// ⚠️ LE GAIN DE NIVEAU SE RÉCUPÈRE, IL NE TOMBE PAS — même règle que les
// missions terminées et les cadeaux, et pour la même raison : un crédit
// automatique fait disparaître le gain sous les yeux du joueur. Un niveau se
// gagne n'importe où (fin de combat, lot de missions, cadeau) ; le tap, lui,
// se fait à un seul endroit, la section Progression du Profil. Le palier y
// attend indéfiniment — rien ne le périme, il n'y a aucune rotation ici.
//
// ⚠️ L'ÉTAT TIENT EN UNE COLONNE, `users.levels_claimed` : les paliers en
// attente sont `levels_claimed + 1 … level`. C'est possible parce qu'un palier
// ne se saute pas — ils se récupèrent dans l'ordre et tous à la fois, le
// joueur n'a rien à arbitrer. Un tap = tous les paliers dus.
//
// ⚠️ L'OBJET DU PALIER DE 10 EST TIRÉ AU MOMENT DU TAP, pas au moment où le
// niveau est gagné. C'est ce qui garantit le zéro doublon : entre le niveau et
// la récupération, le joueur a pu acheter la carte, l'avatar ou la variante que
// le tirage aurait mis de côté. Le tirage reste déterministe à (joueur, niveau)
// — c'est le POOL qui a bougé, pas le hasard.
//
// ⚠️ Les niveaux POSÉS D'AUTORITÉ n'ouvrent aucun palier : `applyAdminGrants`
// écrit `level: 100` et aligne `levels_claimed` dans la foulée, un admin promu
// ne trouve donc pas cent paliers à récupérer. C'est voulu — il a déjà 9999 de
// chaque et tout le catalogue.
//
// ⚠️ RÈGLE DE DÉPENDANCES : ce module est un PUITS, comme gifts.js. Il requiert
// shop.js, cosmetics.js et progression.js ; aucun d'eux ne doit le requérir en
// retour — le cycle serait immédiat, shop.js et cosmetics.js requérant tous
// deux progression.js. C'est aussi pourquoi `progression.grant` ne connaît PAS
// les paliers : il se contente de faire monter `level`, et la dette de paliers
// se déduit à la lecture. Rien à brancher sur les sources d'XP, donc rien à
// oublier de brancher.
const { db, stmt } = require('./db');
const progression = require('./progression');
// Le tirage de palier n'a pas son propre hasard ni son propre pool : ce sont
// ceux de la boutique et des cosmétiques. Recopier « une carte non possédée qui
// a son illustration », ce serait se donner une seconde version de la règle et
// une occasion de la laisser diverger de la première.
const shop = require('./shop');
const cosmetics = require('./cosmetics');

// --- Barème ---

// 50 golds par niveau : de quoi sentir chaque palier sans concurrencer les
// missions, qui restent la source de golds du jeu (650/jour). Un niveau vaut
// donc environ un dixième de journée de missions — un bonus, pas un revenu.
const GOLD_PER_LEVEL = 50;

// Les gemmes, elles, ne se gagnent qu'ici et aux paliers hebdomadaires : c'est
// la seule monnaie que le jeu ne distribue pas à la partie. 50 tous les 5
// niveaux = une variante d'illustration (50 💎) tous les 5 paliers.
const GEMS_EVERY = 5;
const GEMS_AMOUNT = 50;

// Tous les 10 niveaux, un objet. C'est la marche qui donne sa forme à la
// courbe : les niveaux 10, 20, 30… sont des rendez-vous, le reste est une pente.
const DRAW_EVERY = 10;

// Les trois familles sont ÉQUIPROBABLES, et le tirage se fait entre celles qui
// ont encore quelque chose à donner (cf. `drawItem`). Pondérer par valeur
// marchande (une carte à 500 golds contre un avatar à 5 gemmes) reviendrait à
// promettre surtout des avatars : le palier de 10 doit être une surprise, pas
// une aumône statistiquement optimisée.
const DRAW_KINDS = Object.freeze(['card', 'avatar', 'variant']);

/** Ce que donne le passage AU niveau `level`. Pur — c'est le barème, rien d'autre. */
function rewardsForLevel(level) {
  return {
    level,
    gold: GOLD_PER_LEVEL,
    gems: level % GEMS_EVERY === 0 ? GEMS_AMOUNT : 0,
    draw: level % DRAW_EVERY === 0,
  };
}

// --- Pools du tirage ---

/**
 * Ce qu'il reste à donner au joueur, par famille. Les trois pools sont ceux qui
 * servent déjà ailleurs :
 *
 *   - carte    → `shop.sellableCards` (donc : illustration obligatoire — un
 *     palier qui révèle un cadre vide gâche son seul moment), moins la collection ;
 *   - avatar   → `cosmetics.avatarPool` (déjà privé des avatars offerts d'office) ;
 *   - variante → `cosmetics.variantPool` (donc : carte possédée + art existant).
 *
 * Triés par id : le tirage doit rendre le même résultat d'un appel à l'autre.
 */
function pools(user) {
  const ownedCards = new Set(progression.unlockedCardIds(user));
  const ownedCosmetics = cosmetics.ownedOf(user.id);
  const ownedAvatars = new Set(ownedCosmetics.avatars);
  const ownedVariants = new Set(ownedCosmetics.variants);

  return {
    card: shop.sellableCards()
      .filter(c => !ownedCards.has(c.id))
      .map(c => ({ id: c.id, label: c.name ?? c.id, tier: Number(c.tier) || null }))
      .sort((a, b) => a.id.localeCompare(b.id)),
    avatar: cosmetics.avatarPool()
      .filter(a => !ownedAvatars.has(a.id))
      .map(a => ({ id: a.id, label: a.name ?? a.id })),
    // Une variante n'a pas de nom propre : elle s'annonce par la carte qu'elle
    // habille (règle posée par cosmetics.js).
    variant: cosmetics.variantPool(user)
      .filter(v => !ownedVariants.has(v.id))
      .map(v => ({ id: v.id, label: v.card_name, card_id: v.card_id, tier: v.tier })),
  };
}

/**
 * Tire l'objet du palier et le LIVRE. → `null` quand il n'y a plus rien à
 * donner dans aucune famille (compte qui possède tout, admin compris).
 *
 * Ce cas ne déclenche AUCUNE compensation : inventer un lot de repli ferait
 * apparaître une seconde règle, invisible dans le barème affiché au joueur. Le
 * palier verse alors ses golds (et ses gemmes) et le dit.
 *
 * Le tirage est déterministe à (joueur, niveau) — un tirage douteux se rejoue
 * au lieu de se raconter, comme la boutique. Il reste évidemment fonction de la
 * collection au moment du palier : c'est le pool qui change, pas le hasard.
 */
function drawItem(user, level) {
  const rand = shop.seededRandom(user.id, 'level', level);
  const available = pools(user);

  // La famille est tirée parmi celles qui ont encore un candidat : sans ce
  // filtre, un joueur ayant tout acheté d'une famille perdrait purement et
  // simplement le palier une fois sur trois.
  const kinds = DRAW_KINDS.filter(k => available[k].length);
  const kind = shop.pick(kinds, rand);
  if (!kind) return null;

  const item = shop.pick(available[kind], rand);
  if (!item) return null;

  if (kind === 'card') {
    progression.unlockCard(user.id, item.id);
    // Une carte offerte qui termine un pack doit payer sa prime : c'est une
    // conséquence de la POSSESSION, pas de l'achat (même geste que gifts.js).
    return { type: 'card', ...item, ...shop.settleCollection(user.id, [item.id]) };
  }

  const res = cosmetics.unlock(user.id, kind, item.id);
  if (!res.ok || res.already) return null;
  return { type: kind, ...item };
}

// --- Paliers en attente ---

/**
 * Paliers dus mais pas encore récupérés — `levels_claimed + 1 … level`.
 * Barème seul : l'objet du palier de 10 n'est PAS tiré ici (cf. l'en-tête), il
 * est annoncé comme une surprise et résolu au tap.
 */
function pendingLevels(user) {
  const level = Math.max(1, user?.level ?? 1);
  // Le COMPTE vient de progression.js, qui possède les colonnes : refaire la
  // soustraction ici en donnerait deux versions, et une occasion de diverger.
  const count = progression.pendingLevelCount(user);
  const out = [];
  for (let l = level - count + 1; l <= level; l++) out.push(rewardsForLevel(l));
  return out;
}

// --- Récupération ---

/**
 * Solde TOUS les paliers dus, d'un seul geste.
 *
 * → `{ ok: true, lines: [{ level, gold, gems, item }], granted: { gold, gems } }`
 *   | `{ ok: false, reason }`
 *
 * La marque est posée AVANT la livraison (même ordre que `gifts.claimGift`) :
 * si la suite jette, la transaction l'emporte et rien n'est consommé pour rien.
 * L'ordre inverse paierait deux fois sur une erreur au milieu.
 */
const claim = db.transaction((user) => {
  // Relu en base : `user` vient de la session, son niveau peut dater d'avant
  // la partie qui vient de se terminer.
  const fresh = stmt.userById.get(user.id);
  if (!fresh) return { ok: false, reason: 'Compte introuvable.' };

  const to = Math.max(1, fresh.level ?? 1);
  const from = to - progression.pendingLevelCount(fresh);
  if (to <= from) return { ok: false, reason: 'Aucun palier à récupérer.' };

  const res = stmt.claimLevels.run({ id: user.id, from, level: to });
  if (!res.changes) return { ok: false, reason: 'Paliers déjà récupérés.' };

  const lines = [];
  let gold = 0;
  let gems = 0;

  for (let level = from + 1; level <= to; level++) {
    const rule = rewardsForLevel(level);
    gold += rule.gold;
    gems += rule.gems;
    // Le tirage lit la collection : il a lieu palier par palier, dans l'ordre,
    // pour qu'un objet tiré au niveau 10 ne puisse pas ressortir au niveau 20
    // de la même récupération.
    const item = rule.draw ? drawItem(stmt.userById.get(user.id), level) : null;
    lines.push({ level: rule.level, gold: rule.gold, gems: rule.gems, item });
  }

  // UN seul crédit pour toute la série (même geste que `gifts.claimGift`) :
  // hacher une récupération de dix paliers en vingt écritures n'apporte rien.
  //
  // ⚠️ Ce `grant` ne rouvre aucun palier : il ne porte pas d'XP, donc ne fait
  // franchir aucun niveau.
  if (gold || gems) progression.grant(user.id, { gold, gems });

  return { ok: true, lines, granted: { gold, gems } };
});

// --- Lecture ---

// Nombre de paliers annoncés au joueur. Quatre : assez pour voir venir la
// prochaine marche à gemmes sans transformer le profil en calendrier.
const PREVIEW_COUNT = 4;

const nextMultiple = (level, step) => (Math.floor(level / step) + 1) * step;

/**
 * Ce que le profil affiche : le barème, les prochains paliers, et les deux
 * rendez-vous qui portent la courbe (prochaines gemmes, prochain objet).
 *
 * Le barème voyage au lieu d'être recopié côté client — c'est la même raison
 * qui fait que le cadeau quotidien annonce son montant dans son instantané.
 * Seul `XP_PER_LEVEL` reste dupliqué (jauge), et il l'était déjà.
 */
function preview(user) {
  const level = Math.max(1, user?.level ?? 1);
  const upcoming = [];
  for (let i = 1; i <= PREVIEW_COUNT; i++) upcoming.push(rewardsForLevel(level + i));

  const pending = pendingLevels(user);

  return {
    rules: {
      gold_per_level: GOLD_PER_LEVEL,
      gems: { every: GEMS_EVERY, amount: GEMS_AMOUNT },
      draw: { every: DRAW_EVERY, kinds: [...DRAW_KINDS] },
    },
    // Ce qui attend le tap, palier par palier. Les montants sont connus
    // d'avance (c'est un barème) ; l'objet du palier de 10 ne l'est pas — il
    // n'est tiré qu'au tap, et s'annonce donc comme une surprise.
    pending,
    // Total à récupérer, replié ici pour que le bouton l'annonce sans que le
    // client ait à sommer un barème qu'il ne connaît pas.
    pending_totals: pending.reduce(
      (acc, p) => ({ gold: acc.gold + p.gold, gems: acc.gems + p.gems, draws: acc.draws + (p.draw ? 1 : 0) }),
      { gold: 0, gems: 0, draws: 0 },
    ),
    upcoming,
    next_gems_level: nextMultiple(level, GEMS_EVERY),
    next_draw_level: nextMultiple(level, DRAW_EVERY),
  };
}

module.exports = {
  GOLD_PER_LEVEL, GEMS_EVERY, GEMS_AMOUNT, DRAW_EVERY, DRAW_KINDS, PREVIEW_COUNT,
  rewardsForLevel, pools, drawItem, pendingLevels, claim, preview,
};
