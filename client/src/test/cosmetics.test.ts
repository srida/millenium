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

beforeAll(() => {
  TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'millenium-cosmetics-'));
  ILLUS = fs.mkdtempSync(path.join(os.tmpdir(), 'millenium-illus-'));
  for (const f of ['cards.json', 'missions.json', 'sets.json', 'boards.json', 'magies.json']) {
    fs.copyFileSync(path.join(ROOT, 'data', f), path.join(TMP, f));
  }
  writeVariants([]);
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
    expect(cosmetics.PRICE.avatar).toEqual({ gems: 10 });
    expect(cosmetics.PRICE.variant).toEqual({ gems: 100 });
  });

  it('3 avatars et 3 variantes par jour', () => {
    expect(cosmetics.DAILY).toEqual({ avatars: 3, variants: 3 });
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
  it('débite exactement 10 gemmes pour un avatar', () => {
    const user = newUser(1_000);
    const snap = cosmetics.refresh(user());
    const before = user().gems;
    const res = cosmetics.buy(user(), 'avatar', snap.avatars[0].id);
    expect(res.ok).toBe(true);
    expect(res.price).toBe(10);
    expect(user().gems).toBe(before - 10);
  });

  it('débite exactement 100 gemmes pour une variante', () => {
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
    expect(res.price).toBe(100);
    expect(user().gems).toBe(before - 100);
  });

  it('refuse un solde insuffisant', () => {
    const user = newUser(5);
    const snap = cosmetics.refresh(user());
    const res = cosmetics.buy(user(), 'avatar', snap.avatars[0].id);
    expect(res.ok).toBe(false);
    expect(res.reason).toMatch(/gemmes/i);
    expect(user().gems).toBe(5);
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
