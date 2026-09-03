/* eslint-disable @typescript-eslint/no-explicit-any */
/// <reference types="node" />
// Les types Node sont référencés ICI et pas dans `types` du tsconfig : le client
// est du code navigateur, seul ce test (qui charge un module serveur) en a besoin.
//
// Golden tests de la boutique COSMÉTIQUE (cosmetics.js, côté SERVEUR).
//
// Même harnais que shop.test.ts / missions.test.ts : le module est chargé via
// createRequire avec un DATA_DIR temporaire, il ouvre sa propre base SQLite et
// ne touche jamais data/soulforge.db.
//
// Ce qui est verrouillé ici :
//   - ZÉRO DOUBLON : un cosmétique possédé ne ressort jamais du tirage ;
//   - une variante n'est proposée que si le joueur POSSÈDE la carte ;
//   - une variante SANS ILLUSTRATION n'est jamais vendue ;
//   - l'offre est FIGÉE pour la journée et re-tirée à la rotation ;
//   - le SERVEUR chiffre : le client ne transmet ni prix ni montant ;
//   - un avatar non débloqué n'est pas portable ;
//   - la map de variantes du PvP est DÉRIVÉE du deck book serveur, filtrée par
//     possession — le client ne peut pas y injecter une variante non achetée.
import { describe, it, expect, beforeAll } from 'vitest';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import crypto from 'node:crypto';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

let cosmetics: any;
let progression: any;
let stmt: any;
let TMP: string;
let ILLUS: string;
let CARDS: any[];

// L'art conditionne la vente : le pool d'avatars comme celui des variantes
// n'accepte que ce qui a un fichier. Les tests déposent donc de vrais PNG.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

function putArt(id: string) {
  fs.writeFileSync(path.join(ILLUS, `${id}.png`), PNG);
}

/** Réécrit le catalogue de variantes (mtime → cache invalidé). */
function writeVariants(list: any[]) {
  fs.writeFileSync(path.join(TMP, 'variants.json'), JSON.stringify(list, null, '\t'));
}

/** Idem pour les dos de cartes — l'admin écrit à chaud, le cache suit le mtime. */
function writeCardBacks(list: any[]) {
  fs.writeFileSync(path.join(TMP, 'card_backs.json'), JSON.stringify(list, null, '\t'));
}

beforeAll(() => {
  TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'millenium-cosmetics-'));
  ILLUS = fs.mkdtempSync(path.join(os.tmpdir(), 'millenium-illus-'));
  for (const f of ['cards.json', 'missions.json', 'sets.json', 'boards.json', 'magies.json']) {
    fs.copyFileSync(path.join(ROOT, 'data', f), path.join(TMP, f));
  }
  writeVariants([]);
  writeCardBacks([]);
  process.env.DATA_DIR = TMP;
  process.env.ILLUS_DIR = ILLUS;
  ({ stmt } = require(path.join(ROOT, 'db.js')));
  progression = require(path.join(ROOT, 'progression.js'));
  cosmetics = require(path.join(ROOT, 'cosmetics.js'));
  CARDS = JSON.parse(fs.readFileSync(path.join(TMP, 'cards.json'), 'utf8'));

  // Le pool d'avatars n'est fait que de ce qui a une illustration, et le dépôt
  // n'en versionne aucune : sans art déposé ici, le pool tiendrait en trois
  // entrées et « tirer 3 parmi le pool » n'aurait plus rien à prouver.
  for (const c of CARDS.slice(0, 60)) putArt(c.id);
});

// Tous les comptes de test partagent `username_lc = 't'` : la contrainte
// d'unicité porte donc sur (username_lc, tag). Un tag tiré des 4 premiers
// caractères d'un UUID n'offre que 65 536 valeurs — sur quelques dizaines de
// comptes, la collision d'anniversaire finit par tomber et le fichier échoue
// au hasard. Un compteur la supprime par construction.
let _tagSeq = 0;

/** Compte neuf, doté comme à l'inscription (cartes CORE_*). */
function newUser(gems = 10_000) {
  const id = crypto.randomUUID();
  stmt.insertUser.run({
    id, email: `${id}@test.local`, username: 'T', username_lc: 't',
    tag: String(++_tagSeq).padStart(4, '0'), password_hash: 'x', avatar: null, created_at: Date.now(),
  });
  progression.initUser(id);
  progression.grant(id, { gems });
  return () => stmt.userById.get(id);
}

/** Simule le passage de la rotation, comme le fait shop.test.ts. */
function rotate(userId: string) {
  // La ligne peut ne pas exister encore (joueur qui n'a jamais ouvert la
  // boutique) : `user_id` doit survivre au spread.
  const state = stmt.cosmeticStateByUser.get(userId) ?? {};
  stmt.upsertCosmeticState.run({ ...state, user_id: userId, offer_day: null, offer: null });
}

function setDeckBook(userId: string, book: any) {
  stmt.upsertDeckBook.run({ user_id: userId, data: JSON.stringify(book), updated_at: Date.now() });
}

/** Une carte possédée par tout compte neuf (dotation de départ). */
function ownedCardId(user: any): string {
  return progression.unlockedCardIds(user)[0];
}

describe('barème', () => {
  it('les prix sont fixes et en gemmes uniquement', () => {
    expect(cosmetics.PRICE.avatar).toEqual({ gems: 5 });
    expect(cosmetics.PRICE.variant).toEqual({ gems: 50 });
  });

  it('3 avatars, 3 variantes et 2 dos de cartes par jour', () => {
    expect(cosmetics.DAILY).toEqual({ avatars: 3, variants: 3, card_backs: 2 });
  });

  // ⚠️ Le prix d'un dos est ÉDITORIAL : `PRICE.card_back` n'est qu'un repli pour
  // une entrée de catalogue sans prix. Le figer comme les deux autres familles
  // laisserait croire que tous les dos coûtent la même chose.
  it('un dos de carte porte SON prix, le barème n\'est qu\'un repli', () => {
    expect(cosmetics.PRICE.card_back).toEqual({ gems: 100 });
  });

  it('la rotation est celle de la boutique de cartes, pas une copie', () => {
    const shop = require(path.join(ROOT, 'shop.js'));
    const snap = cosmetics.refresh(newUser()());
    expect(snap.next_rotation_at).toBe(shop.nextRotationAt());
    expect(snap.day).toBe(shop.dayKey());
  });
});

describe('pool d\'avatars', () => {
  it('ne retient que les entités AYANT une illustration', () => {
    const before = cosmetics.avatarPool().map((a: any) => a.id);
    const target = CARDS.find(c => !before.includes(c.id) && !cosmetics.DEFAULT_AVATARS.includes(c.id))!;
    putArt(target.id);
    expect(cosmetics.avatarPool().map((a: any) => a.id)).toContain(target.id);
  });

  it('exclut les avatars offerts d\'office — on ne vend pas ce qu\'on donne', () => {
    for (const id of cosmetics.DEFAULT_AVATARS) putArt(id);
    const pool = cosmetics.avatarPool().map((a: any) => a.id);
    for (const id of cosmetics.DEFAULT_AVATARS) expect(pool).not.toContain(id);
  });

  it('puise dans les cartes, les terrains ET les magies', () => {
    const boards = JSON.parse(fs.readFileSync(path.join(TMP, 'boards.json'), 'utf8'));
    const magies = JSON.parse(fs.readFileSync(path.join(TMP, 'magies.json'), 'utf8'));
    putArt(boards[0].id);
    putArt(magies[0].id);
    const pool = cosmetics.avatarPool();
    expect(pool.find((a: any) => a.id === boards[0].id)?.source).toBe('board');
    expect(pool.find((a: any) => a.id === magies[0].id)?.source).toBe('magie');
  });
});

describe('pool de variantes', () => {
  it('ne propose que les variantes des cartes POSSÉDÉES', () => {
    const user = newUser();
    const mine = ownedCardId(user());
    const foreign = CARDS.find(c => !progression.ownsCard(user(), c.id))!;
    writeVariants([
      { id: 'VAR_MINE', card_id: mine },
      { id: 'VAR_FOREIGN', card_id: foreign.id },
    ]);
    putArt('VAR_MINE');
    putArt('VAR_FOREIGN');

    const ids = cosmetics.variantPool(user()).map((v: any) => v.id);
    expect(ids).toContain('VAR_MINE');
    expect(ids).not.toContain('VAR_FOREIGN');
  });

  it('écarte une variante sans illustration — elle n\'est pas vendable', () => {
    const user = newUser();
    const mine = ownedCardId(user());
    writeVariants([
      { id: 'VAR_ART', card_id: mine },
      { id: 'VAR_NOART', card_id: mine },
    ]);
    putArt('VAR_ART');

    const ids = cosmetics.variantPool(user()).map((v: any) => v.id);
    expect(ids).toContain('VAR_ART');
    expect(ids).not.toContain('VAR_NOART');
  });
});

describe('offre du jour', () => {
  it('est figée dans la journée — la relire ne la re-tire pas', () => {
    const user = newUser();
    const first = cosmetics.refresh(user());
    for (let i = 0; i < 5; i++) cosmetics.refresh(user());
    const again = cosmetics.getSnapshot(user());
    expect(again.avatars.map((a: any) => a.id)).toEqual(first.avatars.map((a: any) => a.id));
  });

  it('est déterministe à (joueur, jour) — un tirage douteux se rejoue', () => {
    const user = newUser();
    const day = cosmetics.refresh(user()).day;
    const a = cosmetics.buildOffer(user(), { day });
    const b = cosmetics.buildOffer(user(), { day });
    expect(a.avatars.map((x: any) => x.id)).toEqual(b.avatars.map((x: any) => x.id));
    // Corollaire : re-générer l'offre du MÊME jour la rend à l'identique. Vider
    // la ligne d'état n'est donc pas un moyen de se re-tirer une offre.
    rotate(user().id);
    expect(cosmetics.refresh(user()).avatars.map((x: any) => x.id))
      .toEqual(a.avatars.map((x: any) => x.id));
  });

  it('change de tirage d\'un jour à l\'autre', () => {
    const user = newUser();
    const today = cosmetics.refresh(user()).day;
    const tomorrow = `${today}#next`;
    const a = cosmetics.buildOffer(user(), { day: today }).avatars.map((x: any) => x.id);
    const b = cosmetics.buildOffer(user(), { day: tomorrow }).avatars.map((x: any) => x.id);
    expect(b).not.toEqual(a);
  });

  it('deux joueurs n\'ont pas la même offre le même jour', () => {
    const a = newUser();
    const b = newUser();
    expect(cosmetics.refresh(b()).avatars.map((x: any) => x.id))
      .not.toEqual(cosmetics.refresh(a()).avatars.map((x: any) => x.id));
  });

  it('ne propose jamais un cosmétique déjà possédé', () => {
    const user = newUser();
    const snap = cosmetics.refresh(user());
    const bought = snap.avatars[0].id;
    expect(cosmetics.buy(user(), 'avatar', bought).ok).toBe(true);

    // Sur toute une série de rotations, l'acheté ne doit jamais reparaître.
    for (let i = 0; i < 12; i++) {
      rotate(user().id);
      const ids = cosmetics.refresh(user()).avatars.map((a: any) => a.id);
      expect(ids).not.toContain(bought);
    }
  });

  it('dégénère proprement : moins de candidats → moins d\'emplacements', () => {
    const user = newUser();
    // Aucune variante au catalogue : la section est vide, pas remplie de trous.
    writeVariants([]);
    rotate(user().id);
    expect(cosmetics.refresh(user()).variants).toEqual([]);
  });
});

describe('achat', () => {
  it('débite exactement 5 gemmes pour un avatar', () => {
    const user = newUser(1_000);
    const snap = cosmetics.refresh(user());
    const before = user().gems;
    const res = cosmetics.buy(user(), 'avatar', snap.avatars[0].id);
    expect(res.ok).toBe(true);
    expect(res.price).toBe(5);
    expect(user().gems).toBe(before - 5);
  });

  it('débite exactement 50 gemmes pour une variante', () => {
    const user = newUser(1_000);
    const mine = ownedCardId(user());
    writeVariants([{ id: 'VAR_BUY', card_id: mine }]);
    putArt('VAR_BUY');
    rotate(user().id);

    const snap = cosmetics.refresh(user());
    expect(snap.variants.map((v: any) => v.id)).toContain('VAR_BUY');
    const before = user().gems;
    const res = cosmetics.buy(user(), 'variant', 'VAR_BUY');
    expect(res.ok).toBe(true);
    expect(res.price).toBe(50);
    expect(user().gems).toBe(before - 50);
  });

  it('refuse un solde insuffisant', () => {
    // Une gemme de moins que le prix : le seuil se dérive du barème, sinon un
    // changement de prix transforme ce test en achat réussi sans le dire.
    const short = cosmetics.PRICE.avatar.gems - 1;
    const user = newUser(short);
    const snap = cosmetics.refresh(user());
    const res = cosmetics.buy(user(), 'avatar', snap.avatars[0].id);
    expect(res.ok).toBe(false);
    expect(res.reason).toMatch(/gemmes/i);
    expect(user().gems).toBe(short);
  });

  it('refuse un id ABSENT de l\'offre (verrou d\'offre → 409)', () => {
    const user = newUser();
    cosmetics.refresh(user());
    const offered = new Set(cosmetics.getSnapshot(user()).avatars.map((a: any) => a.id));
    const notOffered = cosmetics.avatarPool().find((a: any) => !offered.has(a.id))!;
    const res = cosmetics.buy(user(), 'avatar', notOffered.id);
    expect(res.ok).toBe(false);
    expect(res.stale).toBe(true);
  });

  it('refuse le second achat du même cosmétique', () => {
    const user = newUser();
    const snap = cosmetics.refresh(user());
    const id = snap.avatars[0].id;
    expect(cosmetics.buy(user(), 'avatar', id).ok).toBe(true);
    const twice = cosmetics.buy(user(), 'avatar', id);
    expect(twice.ok).toBe(false);
    expect(twice.reason).toMatch(/déjà possédé/i);
  });

  it('refuse un type de cosmétique inconnu', () => {
    const user = newUser();
    cosmetics.refresh(user());
    expect(cosmetics.buy(user(), 'frame', 'X').ok).toBe(false);
  });

  it('rend le cosmétique acheté possédé', () => {
    const user = newUser();
    const snap = cosmetics.refresh(user());
    const id = snap.avatars[0].id;
    cosmetics.buy(user(), 'avatar', id);
    expect(cosmetics.ownedOf(user().id).avatars).toContain(id);
  });
});

describe('avatars portables', () => {
  it('les avatars par défaut le sont toujours', () => {
    const user = newUser();
    for (const id of cosmetics.DEFAULT_AVATARS) {
      expect(cosmetics.canUseAvatar(user(), id)).toBe(true);
    }
  });

  it('un avatar non acheté ne l\'est pas', () => {
    const user = newUser();
    const snap = cosmetics.refresh(user());
    expect(cosmetics.canUseAvatar(user(), snap.avatars[0].id)).toBe(false);
  });

  it('il le devient une fois acheté', () => {
    const user = newUser();
    const snap = cosmetics.refresh(user());
    cosmetics.buy(user(), 'avatar', snap.avatars[0].id);
    expect(cosmetics.canUseAvatar(user(), snap.avatars[0].id)).toBe(true);
  });

  it('une chaîne arbitraire ne l\'est jamais', () => {
    const user = newUser();
    expect(cosmetics.canUseAvatar(user(), '../../etc/passwd')).toBe(false);
    expect(cosmetics.canUseAvatar(user(), '')).toBe(false);
  });
});

describe('instantané', () => {
  it('porte les variantes possédées en OBJETS (le DeckBuilder a besoin du card_id)', () => {
    const user = newUser();
    const mine = ownedCardId(user());
    writeVariants([{ id: 'VAR_SNAP', card_id: mine }]);
    putArt('VAR_SNAP');
    rotate(user().id);
    cosmetics.refresh(user());
    cosmetics.buy(user(), 'variant', 'VAR_SNAP');

    const owned = cosmetics.getSnapshot(user()).owned.variants;
    expect(owned).toContainEqual(expect.objectContaining({ id: 'VAR_SNAP', card_id: mine }));
  });

  it('nomme une variante par SA CARTE, jamais par un nom propre', () => {
    const user = newUser();
    const mine = ownedCardId(user());
    // Un nom résiduel dans la donnée (variante écrite avant que le champ ne
    // disparaisse) ne doit pas ressortir : le catalogue l'ignore.
    writeVariants([{ id: 'VAR_NAMED', card_id: mine, name: 'Nom hérité' }]);
    putArt('VAR_NAMED');
    rotate(user().id);

    const offered = cosmetics.refresh(user()).variants.find((v: any) => v.id === 'VAR_NAMED');
    expect(offered.card_name).toBe(CARDS.find(c => c.id === mine).name);
    expect(offered.name).toBeUndefined();

    cosmetics.buy(user(), 'variant', 'VAR_NAMED');
    const owned = cosmetics.getSnapshot(user()).owned.variants.find((v: any) => v.id === 'VAR_NAMED');
    expect(owned.card_name).toBe(CARDS.find(c => c.id === mine).name);
    expect(owned.name).toBeUndefined();
  });

  it('expose les avatars par défaut pour que le Profil ne les redevine pas', () => {
    const snap = cosmetics.refresh(newUser()());
    expect(snap.default_avatars).toEqual([...cosmetics.DEFAULT_AVATARS]);
  });
});

describe('variantes d\'un deck (transport PvP)', () => {
  it('dérive la map du deck book SERVEUR, filtrée par possession', () => {
    const user = newUser();
    const mine = ownedCardId(user());
    writeVariants([{ id: 'VAR_PVP', card_id: mine }]);
    putArt('VAR_PVP');
    rotate(user().id);
    cosmetics.refresh(user());
    cosmetics.buy(user(), 'variant', 'VAR_PVP');

    setDeckBook(user().id, {
      decks: { Duel: { 1: [mine] } },
      meta: { Duel: { variants: { [mine]: 'VAR_PVP' } } },
      active: 'Duel',
    });
    expect(cosmetics.deckVariantMap(user().id, 'Duel')).toEqual({ [mine]: 'VAR_PVP' });
  });

  it('écarte une variante NON POSSÉDÉE — le méta de deck vient du client', () => {
    const user = newUser();
    const mine = ownedCardId(user());
    writeVariants([{ id: 'VAR_STOLEN', card_id: mine }]);
    putArt('VAR_STOLEN');

    setDeckBook(user().id, {
      decks: { Duel: { 1: [mine] } },
      meta: { Duel: { variants: { [mine]: 'VAR_STOLEN' } } },
      active: 'Duel',
    });
    expect(cosmetics.deckVariantMap(user().id, 'Duel')).toEqual({});
  });

  it('écarte une variante qui ne vise pas la carte annoncée', () => {
    const user = newUser();
    const [a, b] = progression.unlockedCardIds(user());
    writeVariants([{ id: 'VAR_A', card_id: a }]);
    putArt('VAR_A');
    rotate(user().id);
    cosmetics.refresh(user());
    cosmetics.buy(user(), 'variant', 'VAR_A');

    setDeckBook(user().id, {
      decks: { Duel: { 1: [a, b] } },
      // Le client prétend habiller B avec une variante de A.
      meta: { Duel: { variants: { [b]: 'VAR_A' } } },
      active: 'Duel',
    });
    expect(cosmetics.deckVariantMap(user().id, 'Duel')).toEqual({});
  });

  it('écarte une carte absente du deck', () => {
    const user = newUser();
    const [a, b] = progression.unlockedCardIds(user());
    writeVariants([{ id: 'VAR_OUT', card_id: b }]);
    putArt('VAR_OUT');
    rotate(user().id);
    cosmetics.refresh(user());
    cosmetics.buy(user(), 'variant', 'VAR_OUT');

    setDeckBook(user().id, {
      decks: { Duel: { 1: [a] } },
      meta: { Duel: { variants: { [b]: 'VAR_OUT' } } },
      active: 'Duel',
    });
    expect(cosmetics.deckVariantMap(user().id, 'Duel')).toEqual({});
  });

  it('retombe sur le deck actif quand le nom annoncé est inconnu', () => {
    const user = newUser();
    const mine = ownedCardId(user());
    writeVariants([{ id: 'VAR_ACTIVE', card_id: mine }]);
    putArt('VAR_ACTIVE');
    rotate(user().id);
    cosmetics.refresh(user());
    cosmetics.buy(user(), 'variant', 'VAR_ACTIVE');

    setDeckBook(user().id, {
      decks: { Duel: { 1: [mine] } },
      meta: { Duel: { variants: { [mine]: 'VAR_ACTIVE' } } },
      active: 'Duel',
    });
    expect(cosmetics.deckVariantMap(user().id, 'DeckInexistant')).toEqual({ [mine]: 'VAR_ACTIVE' });
  });

  it('rend une map vide quand le joueur n\'a pas de deck book', () => {
    expect(cosmetics.deckVariantMap(newUser()().id, 'X')).toEqual({});
  });
});

// ── Dos de cartes ───────────────────────────────────────────────────────────
// Troisième famille, et la seule dont le PRIX est éditorial. Les deux invariants
// de la boutique s'y appliquent tels quels (zéro doublon, offre serveur), plus
// deux règles qui lui appartiennent : un dos OFFERT ne se vend jamais, et un dos
// SANS ART n'est ni vendu ni portable.
describe('dos de cartes', () => {
  it('le pool écarte les OFFERTS, les gratuits et ceux SANS ART', () => {
    putArt('CB_PAID');
    putArt('CB_FREE');
    putArt('CB_ZERO');
    // CB_NOART est au catalogue, avec un prix — mais son PNG n'existe pas.
    writeCardBacks([
      { id: 'CB_FREE', name: 'Offert', default: true, price_gems: 0 },
      { id: 'CB_PAID', name: 'Payant', price_gems: 120 },
      { id: 'CB_ZERO', name: 'Gratuit', price_gems: 0 },
      { id: 'CB_NOART', name: 'Sans art', price_gems: 80 },
    ]);
    expect(cosmetics.cardBackPool().map((b: any) => b.id)).toEqual(['CB_PAID']);
    expect(cosmetics.defaultCardBackIds()).toEqual(['CB_FREE']);
  });

  // ⚠️ Rouge si le prix venait du barème : `PRICE.card_back` vaut 100, le
  // catalogue dit 120. Le barème n'est qu'un repli.
  it('le prix vient du CATALOGUE, le barème n\'est qu\'un repli', () => {
    writeCardBacks([
      { id: 'CB_PAID', name: 'Payant', price_gems: 120 },
      { id: 'CB_NOPRICE', name: 'Sans prix', price_gems: 55 },
    ]);
    putArt('CB_NOPRICE');
    const pool = cosmetics.cardBackPool();
    expect(pool.find((b: any) => b.id === 'CB_PAID').price_gems).toBe(120);
    expect(pool.find((b: any) => b.id === 'CB_NOPRICE').price_gems).toBe(55);
  });

  it('un dos OFFERT est portable sans rien acheter, un dos payant non', () => {
    writeCardBacks([
      { id: 'CB_FREE', name: 'Offert', default: true },
      { id: 'CB_PAID', name: 'Payant', price_gems: 120 },
    ]);
    const user = newUser();
    expect(cosmetics.canUseCardBack(user(), 'CB_FREE')).toBe(true);
    expect(cosmetics.canUseCardBack(user(), 'CB_PAID')).toBe(false);
  });

  // ⚠️ Un id absent du catalogue n'est JAMAIS portable, même si la ligne de
  // possession existe encore : c'est la seule barrière entre `PUT /profile/me`
  // et une chaîne arbitraire dans un `<img src>`. Rouge si `canUseCardBack` se
  // contentait de la possession, comme `canUseAvatar` le fait pour les offerts.
  it('un dos RETIRÉ du catalogue cesse d\'être portable, même possédé', () => {
    writeCardBacks([{ id: 'CB_GONE', name: 'Éphémère', price_gems: 10 }]);
    putArt('CB_GONE');
    const user = newUser();
    expect(cosmetics.unlock(user().id, 'card_back', 'CB_GONE').ok).toBe(true);
    expect(cosmetics.canUseCardBack(user(), 'CB_GONE')).toBe(true);

    writeCardBacks([{ id: 'CB_OTHER', name: 'Autre', price_gems: 10 }]);
    expect(cosmetics.canUseCardBack(user(), 'CB_GONE')).toBe(false);
  });

  it('unlock refuse un dos hors catalogue et un dos sans art', () => {
    writeCardBacks([{ id: 'CB_NOART', name: 'Sans art', price_gems: 80 }]);
    const user = newUser();
    expect(cosmetics.unlock(user().id, 'card_back', 'CB_NOART').ok).toBe(false);
    expect(cosmetics.unlock(user().id, 'card_back', 'CB_INCONNU').ok).toBe(false);
  });

  it('l\'achat débite les gemmes du PRIX DU CATALOGUE, une seule fois', () => {
    writeCardBacks([{ id: 'CB_BUY', name: 'Acheté', price_gems: 120 }]);
    putArt('CB_BUY');
    const user = newUser(1000);
    rotate(user().id);
    const snap = cosmetics.refresh(user());
    expect(snap.card_backs.map((b: any) => b.id)).toContain('CB_BUY');

    expect(cosmetics.buy(user(), 'card_back', 'CB_BUY').ok).toBe(true);
    expect(user().gems).toBe(880);
    // Zéro doublon : le second achat est refusé, et rien n'est débité.
    expect(cosmetics.buy(user(), 'card_back', 'CB_BUY').ok).toBe(false);
    expect(user().gems).toBe(880);
  });

  it('un dos possédé ne ressort jamais de l\'offre', () => {
    writeCardBacks([{ id: 'CB_ONLY', name: 'Unique', price_gems: 10 }]);
    putArt('CB_ONLY');
    const user = newUser();
    rotate(user().id);
    cosmetics.refresh(user());
    cosmetics.buy(user(), 'card_back', 'CB_ONLY');
    rotate(user().id);
    expect(cosmetics.refresh(user()).card_backs).toEqual([]);
  });

  // Le Profil dresse sa grille avec `owned.card_backs` seul : les offerts y sont
  // joints, sinon un joueur qui n'a rien acheté verrait une grille vide alors
  // qu'il porte bien un dos.
  it('l\'instantané joint les OFFERTS aux achetés, sans doublon', () => {
    writeCardBacks([
      { id: 'CB_FREE', name: 'Offert', default: true },
      { id: 'CB_PAID', name: 'Payant', price_gems: 10 },
    ]);
    putArt('CB_PAID');
    const user = newUser();
    rotate(user().id);
    cosmetics.refresh(user());
    cosmetics.buy(user(), 'card_back', 'CB_PAID');
    const owned = cosmetics.getSnapshot(user()).owned.card_backs;
    expect(owned.map((b: any) => b.id).sort()).toEqual(['CB_FREE', 'CB_PAID']);
    expect(owned.find((b: any) => b.id === 'CB_FREE').name).toBe('Offert');
  });

  // ⚠️ `OFFER_KEY` est une TABLE et non un ternaire : avec deux familles,
  // « tout ce qui n'est pas un avatar » allait chercher dans les variantes. Un
  // `kind` inconnu doit être refusé, pas servi par le mauvais pool.
  it('un kind inconnu est refusé, jamais servi par un autre pool', () => {
    const user = newUser();
    expect(cosmetics.buy(user(), 'chapeau', 'X').ok).toBe(false);
    expect(cosmetics.KINDS).toEqual(['avatar', 'variant', 'card_back']);
  });
});
