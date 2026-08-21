/* eslint-disable @typescript-eslint/no-explicit-any */
/// <reference types="node" />
// Les types Node sont référencés ICI et pas dans `types` du tsconfig : le client
// est du code navigateur, seuls ces tests (qui chargent un module serveur) en ont
// besoin.
//
// Golden tests des PACKS de boutique (sets.js + les conséquences dans shop.js et
// progression.js), designés depuis le panneau d'administration.
//
// Fichier SÉPARÉ de shop.test.ts, et pas par confort : ces tests réécrivent
// `sets.json` en cours de route (le cache de sets.js s'invalide au mtime), là où
// shop.test.ts indexe les packs par POSITION et asserte la garantie de tiers en
// dur. Vitest isolant les fichiers de test, le catalogue reste vierge des deux
// côtés.
//
// Ce qui est verrouillé ici :
//   - la DOTATION d'un compte neuf suit le pack marqué « départ », et retombe
//     sur le préfixe CORE_* quand il n'y en a aucun ;
//   - un pack de départ ne se vend JAMAIS et ne verse JAMAIS de prime — sinon
//     chaque inscription encaisserait sa prime de complétion, puisque le compte
//     le possède déjà en entier ;
//   - `sets.json` fait foi, le champ `set` d'une carte n'en est que le miroir.
import { describe, it, expect, beforeAll } from 'vitest';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import crypto from 'node:crypto';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

let packs: any;
let shop: any;
let progression: any;
let stmt: any;
let CARDS: any[];
let TMP: string;
let POSTERS: string;
let ILLUS: string;

// La boutique ne vend que des cartes ILLUSTRÉES : sans art déposé ici, tous les
// packs seraient vides et les tests de prime ne prouveraient plus rien. Le dépôt
// ne versionne aucune illustration (`resources/` est gitignoré), d'où les PNG
// posés à la main — même harnais que cosmetics.test.ts.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

/** Cartes de `cards.json` portant le miroir `set: SET_01` (57 sur les données réelles). */
let MIRRORED_SET_01: string[];

const STARTER_CARDS = ['CORE_010', 'CORE_011', 'CORE_012'];

// Le cache de sets.js s'invalide au mtime, et deux écritures consécutives
// tombent facilement dans la MÊME milliseconde : le mtime est donc forcé à une
// valeur strictement croissante, sinon un test lirait le catalogue du précédent.
let setsWrites = 0;

/** Réécrit le catalogue de packs, et garantit que le cache le verra. */
function writeSets(list: any[]) {
  const file = path.join(TMP, 'sets.json');
  fs.writeFileSync(file, JSON.stringify(list, null, '\t'), 'utf8');
  const stamp = new Date(Date.now() + ++setsWrites * 60_000);
  fs.utimesSync(file, stamp, stamp);
}

/**
 * Un pack commercial de composition maîtrisée (2 cartes Tier 1-2 + 2 Tier 3+).
 * `offset` sert à obtenir deux packs DISJOINTS : deux packs aux mêmes cartes se
 * compléteraient l'un l'autre et fausseraient les tests de prime.
 */
// Un pack de test délibérément PLUS GRAND qu'un booster : plusieurs de ces
// tests achètent un booster puis vérifient qu'aucune prime de complétion n'est
// tombée. Un pack qu'une seule ouverture vide complèterait le pack au passage
// et paierait la prime — la taille se dérive donc de `BOOSTER.card_count`,
// sinon l'agrandissement du booster casse ces tests par un effet de bord qui
// n'a rien à voir avec ce qu'ils prouvent.
// Lu à l'APPEL et non au chargement du module : `shop` n'est requis qu'une fois
// l'environnement de test posé (`beforeAll`).
const packSize = () => shop.BOOSTER.card_count + 1;

function commercialPack(id = 'PACK_A', offset = 0) {
  const size = packSize();
  const pool = CARDS.filter(c => !STARTER_CARDS.includes(c.id));
  const low = pool.filter(c => Number(c.tier) <= 2).slice(offset, offset + size).map(c => c.id);
  const high = pool.filter(c => Number(c.tier) >= 3).slice(offset, offset + size).map(c => c.id);
  return { id, name: 'Pack commercial', cards: [...low, ...high], completion_reward: { gems: 300 } };
}

const STARTER_PACK = { id: 'PACK_START', name: 'Fondations', starter: true, cards: STARTER_CARDS };

beforeAll(() => {
  TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'millenium-packs-'));
  POSTERS = fs.mkdtempSync(path.join(os.tmpdir(), 'millenium-posters-'));
  ILLUS = fs.mkdtempSync(path.join(os.tmpdir(), 'millenium-packs-illus-'));
  for (const f of ['cards.json', 'missions.json']) {
    fs.copyFileSync(path.join(ROOT, 'data', f), path.join(TMP, f));
  }
  process.env.DATA_DIR = TMP;
  process.env.POSTERS_DIR = POSTERS;
  process.env.ILLUS_DIR = ILLUS;

  CARDS = JSON.parse(fs.readFileSync(path.join(TMP, 'cards.json'), 'utf8'));
  for (const c of CARDS) fs.writeFileSync(path.join(ILLUS, `${c.id}.png`), PNG);
  MIRRORED_SET_01 = CARDS.filter(c => c.set === 'SET_01').map(c => c.id);

  // Catalogue de départ : aucun pack. C'est l'état « repli » que le premier test
  // vérifie, et il doit exister AVANT le chargement des modules.
  writeSets([]);

  ({ stmt } = require(path.join(ROOT, 'db.js')));
  packs = require(path.join(ROOT, 'sets.js'));
  progression = require(path.join(ROOT, 'progression.js'));
  shop = require(path.join(ROOT, 'shop.js'));
});

// Tous les comptes de test partagent `username_lc = 't'` : la contrainte
// d'unicité porte donc sur (username_lc, tag). Un tag tiré des 4 premiers
// caractères d'un UUID n'offre que 65 536 valeurs — sur quelques dizaines de
// comptes, la collision d'anniversaire finit par tomber et le fichier échoue
// au hasard. Un compteur la supprime par construction.
let _tagSeq = 0;

/** Compte neuf, doté comme à l'inscription. */
function newUser(gold = 100_000, gems = 10_000) {
  const id = crypto.randomUUID();
  stmt.insertUser.run({
    id, email: `${id}@test.local`, username: 'T', username_lc: 't',
    tag: String(++_tagSeq).padStart(4, '0'), password_hash: 'x', avatar: null, created_at: Date.now(),
  });
  progression.initUser(id);
  progression.grant(id, { gold, gems });
  return () => stmt.userById.get(id);
}

const ownedIds = (user: any) => progression.unlockedCardIds(user).sort();

describe('dotation d\'un compte neuf', () => {
  it('sans pack de départ : repli sur le préfixe CORE_*', () => {
    writeSets([commercialPack()]);
    const expected = CARDS.map(c => c.id).filter(id => id.startsWith('CORE'));

    expect(packs.starterPacks()).toHaveLength(0);
    expect(progression.starterCardIds().sort()).toEqual(expected.sort());
    expect(ownedIds(newUser()())).toEqual(expected.sort());
  });

  it('avec un pack de départ : exactement ses cartes', () => {
    writeSets([STARTER_PACK, commercialPack()]);

    expect(progression.starterCardIds().sort()).toEqual([...STARTER_CARDS].sort());
    const user = newUser();
    expect(ownedIds(user())).toEqual([...STARTER_CARDS].sort());
    expect(progression.getProgression(user()).unlocked_count).toBe(STARTER_CARDS.length);
  });

  it('la dotation suit l\'édition du pack, sans redémarrage', () => {
    writeSets([{ ...STARTER_PACK, cards: ['CORE_020'] }]);
    expect(progression.starterCardIds()).toEqual(['CORE_020']);
    expect(ownedIds(newUser()())).toEqual(['CORE_020']);
  });

  it('plusieurs packs de départ s\'additionnent, sans doublon', () => {
    writeSets([
      { id: 'PACK_S1', name: 'A', starter: true, cards: ['CORE_001', 'CORE_002'] },
      { id: 'PACK_S2', name: 'B', starter: true, cards: ['CORE_002', 'CORE_003'] },
    ]);
    expect(progression.starterCardIds().sort()).toEqual(['CORE_001', 'CORE_002', 'CORE_003']);
  });

  it('un pack de départ ne listant que des ids inconnus retombe sur le repli', () => {
    // Sinon un id mal saisi en admin produirait des comptes sans aucune carte,
    // incapables de construire un deck.
    writeSets([{ id: 'PACK_S', name: 'Coquille', starter: true, cards: ['NOPE_001'] }]);
    expect(packs.starterCardIds()).toEqual([]);
    expect(progression.starterCardIds().length).toBeGreaterThan(0);
  });
});

describe('le pack de départ n\'est pas un produit', () => {
  it('il est absent de l\'instantané de la boutique', () => {
    writeSets([STARTER_PACK, commercialPack()]);
    const snap = shop.refresh(newUser()());
    expect(snap.sets.map((s: any) => s.id)).toEqual(['PACK_A']);
  });

  it('son achat en booster est refusé', () => {
    writeSets([STARTER_PACK, commercialPack()]);
    const res = shop.buyBooster(newUser()(), 'PACK_START', 'golds');
    expect(res.ok).toBe(false);
    expect(res.reason).toMatch(/création du compte/);
  });

  it('il ne verse JAMAIS sa prime de complétion, même possédé en entier', () => {
    // Le piège central : un compte neuf possède tout le pack de départ. Sans
    // exclusion, la prime tomberait à la première action en boutique.
    writeSets([
      { ...STARTER_PACK, completion_reward: { gems: 300 } },
      commercialPack(),
    ]);
    const user = newUser();
    const gems = user().gems;

    const res = shop.buyBooster(user(), 'PACK_A', 'golds');
    expect(res.ok).toBe(true);
    expect(res.sets_completed.map((s: any) => s.set_id)).not.toContain('PACK_START');
    expect(user().gems).toBe(gems);
  });

  it('un pack COMMERCIAL entièrement possédé, lui, verse bien sa prime', () => {
    // Contre-épreuve : l'exclusion ne doit pas être un blanc-seing. Le pack de
    // départ est là pour borner la dotation — sans lui, le repli CORE_* offre
    // 132 cartes et les deux packs seraient possédés d'entrée.
    writeSets([STARTER_PACK, commercialPack('PACK_A'), commercialPack('PACK_B', 10)]);
    const user = newUser();
    progression.unlockCards(user().id, shop.setCardIds(packs.byId('PACK_A')));
    const gems = user().gems;

    const res = shop.buyBooster(user(), 'PACK_B', 'golds');
    expect(res.ok).toBe(true);
    expect(res.sets_completed.map((s: any) => s.set_id)).toContain('PACK_A');
    expect(user().gems).toBe(gems + 300);
  });
});

describe('composition d\'un pack', () => {
  it('sets.json fait foi, le champ `set` de la carte n\'en est que le miroir', () => {
    writeSets([{ id: 'SET_01', name: 'Miroir', cards: ['EXTRA_001'] }]);
    const ids = shop.setCardIds(packs.byId('SET_01'));

    expect(ids).toContain('EXTRA_001');                    // listé
    for (const id of MIRRORED_SET_01) expect(ids).toContain(id);  // miroir
    expect(new Set(ids).size).toBe(ids.length);            // union, pas concaténation
  });

  it('l\'instantané porte la composition, listée ET miroir', () => {
    // La vue « contenu du pack » se sert de `card_ids`. Il doit porter la même
    // union que `setCardIds` — un pack designé en admin après la création d'une
    // carte compte sur le miroir, et une carte listée là mais dont le champ
    // `set` n'a pas été réaligné compte sur la liste.
    writeSets([{ id: 'SET_01', name: 'Miroir', cards: ['EXTRA_001'] }]);
    const view = shop.refresh(newUser()()).sets.find((s: any) => s.id === 'SET_01');

    expect(view.card_ids).toContain('EXTRA_001');
    for (const id of MIRRORED_SET_01) expect(view.card_ids).toContain(id);
    expect(new Set(view.card_ids).size).toBe(view.card_ids.length);
    expect(view.card_ids).toHaveLength(view.card_count);
  });

  it('un id inconnu listé dans un pack est ignoré', () => {
    writeSets([{ id: 'PACK_A', name: 'A', cards: ['CORE_001', 'NOPE_001'] }]);
    expect(shop.setCardIds(packs.byId('PACK_A'))).toEqual(['CORE_001']);
  });

  it('un pack sans `cards` ne fait pas tomber la lecture', () => {
    writeSets([{ id: 'PACK_VIDE', name: 'Vide' }]);
    // Assertion non vacante : `cardIdsOf(undefined)` rend aussi [], un pack
    // introuvable passerait donc le test suivant sans rien prouver.
    expect(packs.byId('PACK_VIDE')).not.toBeNull();
    expect(shop.setCardIds(packs.byId('PACK_VIDE'))).toEqual([]);
    // Un pack vide n'est jamais « complet » : sinon il verserait sa prime à tous.
    const snap = shop.refresh(newUser()());
    expect(snap.sets.find((s: any) => s.id === 'PACK_VIDE').complete).toBe(false);
  });

  it('un pack sans booster reste visible mais éteint', () => {
    writeSets([{ ...commercialPack(), booster_enabled: false }]);
    const snap = shop.refresh(newUser()());
    expect(snap.sets.find((s: any) => s.id === 'PACK_A').booster_enabled).toBe(false);
    expect(shop.buyBooster(newUser()(), 'PACK_A', 'golds').ok).toBe(false);
  });
});

describe('affiche du pack', () => {
  it('l\'instantané dit si le pack a SON affiche', () => {
    writeSets([commercialPack()]);
    expect(shop.refresh(newUser()()).sets[0].has_poster).toBe(false);

    fs.writeFileSync(path.join(POSTERS, 'PACK_A.png'), 'pas-vraiment-un-png');
    expect(shop.refresh(newUser()()).sets[0].has_poster).toBe(true);

    fs.unlinkSync(path.join(POSTERS, 'PACK_A.png'));
    expect(shop.refresh(newUser()()).sets[0].has_poster).toBe(false);
  });
});
