/* eslint-disable @typescript-eslint/no-explicit-any */
/// <reference types="node" />
// Les types Node sont référencés ICI et pas dans `types` du tsconfig : le client
// est du code navigateur, seuls ces tests (qui chargent un module serveur) en ont
// besoin.
//
// Golden tests du système de CADEAUX (gifts.js, côté SERVEUR), et de la part de
// shop.js dont il dépend (`deliverBooster` / `settleCollection`).
//
// Même harnais que shop.test.ts / cosmetics.test.ts : le module est chargé via
// createRequire avec un DATA_DIR temporaire, il ouvre sa propre base SQLite et
// ne touche jamais data/soulforge.db. Le fichier écrit son PROPRE `gifts.json`
// et son propre `sets.json` — c'est le catalogue qui est l'objet du test
// (précédents : arcade.test.ts pour les decks publics, packs.test.ts pour les
// packs).
//
// Ce qui est verrouillé ici :
//   - le QUOTIDIEN tourne sur le calendrier de la boutique, au barème exact, et
//     ne se récupère qu'UNE fois par rotation ;
//   - la garde anti-double-récupération est DANS LE SQL, pas en JS ;
//   - un cadeau ne s'adresse qu'aux comptes ANTÉRIEURS, et un cadeau hors
//     d'atteinte est indiscernable d'un cadeau inexistant ;
//   - un lot SANS EFFET ne fait jamais échouer la récupération, mais le compte
//     rendu dit la vérité ligne par ligne ;
//   - un booster OFFERT est un booster acheté moins la caisse : zéro doublon,
//     épingle libérée, prime de complétion versée, et AUCUN débit.
import { describe, it, expect, beforeAll } from 'vitest';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import crypto from 'node:crypto';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

let gifts: any;
let shop: any;
let cosmetics: any;
let progression: any;
let stmt: any;
let CARDS: any[];
let TMP: string;
let ILLUS: string;

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

const putArt = (id: string) => fs.writeFileSync(path.join(ILLUS, `${id}.png`), PNG);

// Les caches de gifts.js / sets.js / variants.js s'invalident au mtime, et deux
// écritures consécutives tombent facilement dans la MÊME milliseconde : le mtime
// est forcé à une valeur strictement croissante, sinon un test lirait le
// catalogue du précédent. Même précaution que packs.test.ts.
let writes = 0;
function writeJson(name: string, value: unknown) {
  const file = path.join(TMP, name);
  fs.writeFileSync(file, JSON.stringify(value, null, '\t'), 'utf8');
  const stamp = new Date(Date.now() + ++writes * 60_000);
  fs.utimesSync(file, stamp, stamp);
}

const writeGifts = (list: any[]) => writeJson('gifts.json', list);

// ⚠️ L'ordre des dates n'est pas décoratif : un cadeau ne s'adresse qu'aux
// comptes créés AVANT lui. Les comptes du fichier datent donc d'un mois, et les
// cadeaux de maintenant — l'inverse les rendrait tous inéligibles, et le fichier
// entier passerait à côté de son sujet en échouant partout de la même façon.
const ACCOUNT_AGE_MS = 30 * 86_400_000;

/** Un cadeau valide, daté de maintenant : à portée de tous les comptes du fichier. */
function gift(id: string, contents: any[], extra: any = {}) {
  return { id, name: `Cadeau ${id}`, description: '', created_at: Date.now(), contents, ...extra };
}

let _tagSeq = 0;

/** Compte neuf, doté comme à l'inscription. `createdAt` sert aux tests d'ancienneté. */
function newUser(gold = 0, gems = 0, createdAt = Date.now() - ACCOUNT_AGE_MS) {
  const id = crypto.randomUUID();
  stmt.insertUser.run({
    id, email: `${id}@test.local`, username: 'T', username_lc: 't',
    tag: String(++_tagSeq).padStart(4, '0'), password_hash: 'x', avatar: null, created_at: createdAt,
  });
  progression.initUser(id);
  if (gold || gems) progression.grant(id, { gold, gems });
  return () => stmt.userById.get(id);
}

const owned = (user: any) => new Set<string>(progression.unlockedCardIds(user));

/** Rejoue une rotation : le quotidien redevient disponible sans truquer l'heure. */
function rotate(userId: string) {
  stmt.claimDailyGift.run({ user_id: userId, day: '1970-01-01', now: 0 });
}

/** Cartes hors dotation de départ — le pool sûr pour composer packs et lots. */
let POOL: any[];

beforeAll(() => {
  TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'millenium-gifts-'));
  ILLUS = fs.mkdtempSync(path.join(os.tmpdir(), 'millenium-gifts-illus-'));
  for (const f of ['cards.json', 'missions.json', 'boards.json', 'magies.json']) {
    fs.copyFileSync(path.join(ROOT, 'data', f), path.join(TMP, f));
  }
  process.env.DATA_DIR = TMP;
  process.env.ILLUS_DIR = ILLUS;

  CARDS = JSON.parse(fs.readFileSync(path.join(TMP, 'cards.json'), 'utf8'));
  // Un catalogue entièrement illustré est l'état nominal : sans art, le pool
  // vendable serait vide et les tests de booster ne prouveraient plus rien.
  for (const c of CARDS) putArt(c.id);

  POOL = CARDS.filter(c => !String(c.id).startsWith('CORE_'));

  // Catalogues écrits AVANT le premier require : les modules les lisent au
  // premier appel, mais autant qu'ils ne voient jamais d'état intermédiaire.
  writeJson('sets.json', []);
  writeJson('variants.json', []);
  writeGifts([]);

  ({ stmt } = require(path.join(ROOT, 'db.js')));
  progression = require(path.join(ROOT, 'progression.js'));
  shop = require(path.join(ROOT, 'shop.js'));
  cosmetics = require(path.join(ROOT, 'cosmetics.js'));
  gifts = require(path.join(ROOT, 'gifts.js'));
});

describe('calendrier', () => {
  it('le quotidien tourne sur la rotation de la boutique, pas la sienne', () => {
    // Un seul rendez-vous quotidien à retenir : missions, boutique, cosmétiques,
    // arcade et cadeaux tombent tous à 5 h. Ce n'est pas une copie du calcul,
    // c'est la même fonction.
    const user = newUser();
    const snap = gifts.getSnapshot(user());
    expect(snap.day).toBe(shop.dayKey());
    expect(snap.next_rotation_at).toBe(shop.nextRotationAt());
  });
});

describe('cadeau quotidien', () => {
  it('verse exactement 200 golds et 5 gemmes', () => {
    const user = newUser();
    expect(gifts.DAILY_REWARD).toEqual({ gold: 200, gems: 5 });

    const before = progression.getProgression(user());
    const res = gifts.claimDaily(user());
    expect(res.ok).toBe(true);
    expect(res.granted).toEqual({ gold: 200, gems: 5 });

    const after = progression.getProgression(user());
    expect(after.gold - before.gold).toBe(200);
    expect(after.gems - before.gems).toBe(5);
  });

  it('une seconde récupération le même jour est refusée ET ne crédite rien', () => {
    const user = newUser();
    gifts.claimDaily(user());
    const before = progression.getProgression(user());

    const res = gifts.claimDaily(user());
    expect(res.ok).toBe(false);

    // Le vrai test est là : « refusé » ne suffit pas, il faut que rien n'ait
    // bougé. Un refus qui crédite quand même serait indétectable côté client.
    const after = progression.getProgression(user());
    expect(after.gold).toBe(before.gold);
    expect(after.gems).toBe(before.gems);
  });

  it('la garde est dans le SQL, pas dans une relecture JS', () => {
    // On pose la ligne du jour à la main, sans passer par gifts.js : la
    // récupération doit échouer quand même. C'est ce qui garantit que deux taps
    // concurrents ne créditent qu'une fois.
    const user = newUser();
    stmt.claimDailyGift.run({ user_id: user().id, day: shop.dayKey(), now: Date.now() });

    const before = progression.getProgression(user());
    expect(gifts.claimDaily(user()).ok).toBe(false);
    expect(progression.getProgression(user()).gold).toBe(before.gold);
  });

  it('redevient disponible après la rotation', () => {
    const user = newUser();
    expect(gifts.claimDaily(user()).ok).toBe(true);
    expect(gifts.getSnapshot(user()).daily.claimed).toBe(true);

    rotate(user().id);
    expect(gifts.getSnapshot(user()).daily.claimed).toBe(false);
    expect(gifts.claimDaily(user()).ok).toBe(true);
  });

  it('l\'instantané annonce le barème sans que le client ait à le connaître', () => {
    const user = newUser();
    expect(gifts.getSnapshot(user()).daily.reward).toEqual({ gold: 200, gems: 5 });
  });
});

describe('éligibilité — un cadeau ne s\'adresse qu\'aux comptes antérieurs', () => {
  it('un compte créé APRÈS le cadeau ne le voit pas et ne peut pas le prendre', () => {
    const now = Date.now();
    writeGifts([{ ...gift('G_OLD', [{ type: 'gold', amount: 500 }]), created_at: now - 10_000 }]);

    const newcomer = newUser(0, 0, now);
    expect(gifts.getSnapshot(newcomer()).gifts).toHaveLength(0);

    const res = gifts.claimGift(newcomer(), 'G_OLD');
    expect(res.ok).toBe(false);
    // ⚠️ Le MÊME motif qu'un id inconnu : un message distinct n'apprendrait au
    // joueur que l'existence de ce qu'il ne peut pas prendre.
    expect(res.reason).toBe(gifts.claimGift(newcomer(), 'JAMAIS_VU').reason);
  });

  it('un compte créé AVANT le voit et peut le prendre', () => {
    const now = Date.now();
    writeGifts([{ ...gift('G_ELIG', [{ type: 'gold', amount: 500 }]), created_at: now }]);

    const veteran = newUser(0, 0, now - 60_000);
    expect(gifts.getSnapshot(veteran()).gifts.map((g: any) => g.id)).toContain('G_ELIG');
    expect(gifts.claimGift(veteran(), 'G_ELIG').ok).toBe(true);
  });
});

describe('récupération d\'un cadeau ponctuel', () => {
  it('livre tous ses lots d\'un seul geste', () => {
    const card = POOL[0].id;
    const avatarId = POOL[1].id;
    writeGifts([gift('G_MULTI', [
      { type: 'gold', amount: 500 },
      { type: 'gems', amount: 20 },
      { type: 'card', id: card },
      { type: 'avatar', id: avatarId },
    ])]);

    const user = newUser();
    const before = progression.getProgression(user());
    const res = gifts.claimGift(user(), 'G_MULTI');

    expect(res.ok).toBe(true);
    expect(res.lines.every((l: any) => l.granted)).toBe(true);
    expect(progression.getProgression(user()).gold - before.gold).toBe(500);
    expect(progression.getProgression(user()).gems - before.gems).toBe(20);
    expect(owned(user()).has(card)).toBe(true);
    expect(cosmetics.owns(user().id, 'avatar', avatarId)).toBe(true);
  });

  it('une seconde récupération est refusée et ne re-livre RIEN', () => {
    writeGifts([gift('G_ONCE', [{ type: 'gold', amount: 700 }])]);
    const user = newUser();
    expect(gifts.claimGift(user(), 'G_ONCE').ok).toBe(true);

    const before = progression.getProgression(user());
    expect(gifts.claimGift(user(), 'G_ONCE').ok).toBe(false);
    expect(progression.getProgression(user()).gold).toBe(before.gold);
  });

  it('la garde est dans le SQL : une ligne posée à la main suffit à fermer le cadeau', () => {
    writeGifts([gift('G_SQL', [{ type: 'gold', amount: 700 }])]);
    const user = newUser();
    stmt.claimGift.run(user().id, 'G_SQL', Date.now());

    const before = progression.getProgression(user());
    expect(gifts.claimGift(user(), 'G_SQL').ok).toBe(false);
    expect(progression.getProgression(user()).gold).toBe(before.gold);
  });

  it('l\'instantané marque le cadeau soldé et le range après les autres', () => {
    writeGifts([
      gift('G_A', [{ type: 'gold', amount: 100 }]),
      gift('G_B', [{ type: 'gold', amount: 100 }]),
    ]);
    const user = newUser();
    gifts.claimGift(user(), 'G_A');

    const list = gifts.getSnapshot(user()).gifts;
    // Ce sur quoi le joueur peut agir vient d'abord.
    expect(list[0].id).toBe('G_B');
    expect(list[0].claimed).toBe(false);
    expect(list[1].id).toBe('G_A');
    expect(list[1].claimed).toBe(true);
    expect(list[1].claimed_at).toBeGreaterThan(0);
  });
});

describe('lots sans effet — le cadeau est consommé par le geste, pas par son rendement', () => {
  it('une carte déjà possédée ne fait pas échouer la récupération', () => {
    const card = POOL[2].id;
    writeGifts([gift('G_DUP', [{ type: 'card', id: card }, { type: 'gold', amount: 300 }])]);

    const user = newUser();
    progression.unlockCard(user().id, card);
    const before = progression.getProgression(user());

    const res = gifts.claimGift(user(), 'G_DUP');
    expect(res.ok).toBe(true);
    const line = res.lines.find((l: any) => l.type === 'card');
    expect(line.granted).toBe(false);
    expect(line.reason).toBe('already_owned');
    // Le reste du cadeau passe quand même.
    expect(progression.getProgression(user()).gold - before.gold).toBe(300);
    // Et le cadeau est bien soldé : il ne revient pas à l'écran.
    expect(gifts.claimGift(user(), 'G_DUP').ok).toBe(false);
  });

  it('une carte inconnue du catalogue est distinguée d\'une carte déjà possédée', () => {
    writeGifts([gift('G_UNKNOWN', [{ type: 'card', id: 'CARTE_QUI_N_EXISTE_PAS' }])]);
    const user = newUser();
    const res = gifts.claimGift(user(), 'G_UNKNOWN');
    expect(res.ok).toBe(true);
    expect(res.lines[0].reason).toBe('unknown');
  });

  it('un cosmétique déjà possédé est rapporté sans faire échouer le cadeau', () => {
    const avatarId = POOL[3].id;
    writeGifts([gift('G_COSM', [{ type: 'avatar', id: avatarId }])]);
    const user = newUser();
    cosmetics.unlock(user().id, 'avatar', avatarId);

    const res = gifts.claimGift(user(), 'G_COSM');
    expect(res.ok).toBe(true);
    expect(res.lines[0].reason).toBe('already_owned');
  });

  it('un avatar SANS illustration n\'est jamais offert — il serait portable et cassé', () => {
    // `canUseAvatar` ne teste que la possession : un avatar offert sans PNG
    // passerait la validation du profil et laisserait un <img> vide.
    writeGifts([gift('G_NOART', [{ type: 'avatar', id: 'PAS_DE_PNG_ICI' }])]);
    const user = newUser();
    const res = gifts.claimGift(user(), 'G_NOART');
    expect(res.ok).toBe(true);
    expect(res.lines[0].granted).toBe(false);
    expect(cosmetics.owns(user().id, 'avatar', 'PAS_DE_PNG_ICI')).toBe(false);
  });
});

describe('catalogue malformé — l\'admin écrit du JSON libre', () => {
  it('un lot invalide est écarté, le reste du cadeau est livré', () => {
    writeGifts([gift('G_BAD', [
      { type: 'inconnu', amount: 5 },
      { type: 'gold', amount: 0 },
      { type: 'gold', amount: -50 },
      { type: 'gems', amount: 1e9 },
      { type: 'card' },
      { type: 'gold', amount: 250 },
    ])]);

    const user = newUser();
    const before = progression.getProgression(user());
    const res = gifts.claimGift(user(), 'G_BAD');

    expect(res.ok).toBe(true);
    expect(res.lines).toHaveLength(1);
    expect(progression.getProgression(user()).gold - before.gold).toBe(250);
  });

  it('un cadeau dont TOUS les lots sont invalides n\'existe pas', () => {
    writeGifts([gift('G_EMPTY', [{ type: 'inconnu' }])]);
    expect(gifts.catalog().find((g: any) => g.id === 'G_EMPTY')).toBeUndefined();
  });

  it('un cadeau sans created_at est écarté — la date décide de son adresse', () => {
    // Aucune lecture de repli n'est sûre : 0 le rend invisible pour toujours,
    // « maintenant » l'ouvre à des comptes créés depuis. On le nomme au
    // chargement plutôt que de le deviner.
    writeGifts([{ id: 'G_NODATE', name: 'x', contents: [{ type: 'gold', amount: 100 }] }]);
    expect(gifts.catalog().find((g: any) => g.id === 'G_NODATE')).toBeUndefined();
  });

  it('validateGift refuse à l\'écriture ce que le catalogue écarte à la lecture', () => {
    // Les deux chemins doivent rendre le même verdict sur la même entrée, sinon
    // l'admin enregistre un cadeau que personne ne verra jamais.
    expect(gifts.validateGift({ id: 'X', name: 'x', contents: [] }).ok).toBe(false);
    expect(gifts.validateGift({ id: '', name: 'x', contents: [{ type: 'gold', amount: 1 }] }).ok).toBe(false);
    expect(gifts.validateGift({ id: 'X', name: '', contents: [{ type: 'gold', amount: 1 }] }).ok).toBe(false);
    expect(gifts.validateGift({ id: 'X', name: 'x', contents: [{ type: 'gold', amount: 0 }] }).ok).toBe(false);
    expect(gifts.validateGift({ id: 'X', name: 'x', contents: [{ type: 'nope' }] }).ok).toBe(false);
    expect(gifts.validateGift({ id: 'X', name: 'x', contents: [{ type: 'card', id: '' }] }).ok).toBe(false);
    expect(gifts.validateGift({ id: 'X', name: 'x', contents: [{ type: 'gold', amount: 500 }] }).ok).toBe(true);
  });
});

describe('booster offert — un booster acheté, moins la caisse', () => {
  /** Pack de composition maîtrisée, plus grand qu'un booster. */
  function pack(id: string, size: number, offset = 0) {
    const cards = POOL.slice(offset, offset + size).map(c => c.id);
    return { id, name: `Pack ${id}`, cards, completion_reward: { gems: 300 } };
  }

  it('livre des cartes, n\'en donne jamais une déjà possédée, et ne débite RIEN', () => {
    writeJson('sets.json', [pack('PK_GIFT', shop.BOOSTER.card_count + 3, 10)]);
    writeGifts([gift('G_PACK', [{ type: 'pack', id: 'PK_GIFT' }])]);

    const user = newUser(5_000, 500);
    const before = progression.getProgression(user());
    const had = owned(user());

    const res = gifts.claimGift(user(), 'G_PACK');
    expect(res.ok).toBe(true);
    const line = res.lines[0];
    expect(line.granted).toBe(true);
    expect(line.cards.length).toBeGreaterThan(0);
    expect(line.cards.length).toBeLessThanOrEqual(shop.BOOSTER.card_count);

    // Zéro doublon, l'invariant qui n'a jamais été négociable.
    for (const c of line.cards) expect(had.has(c.card_id)).toBe(false);
    // Cartes distinctes entre elles : un booster ne se répète pas lui-même.
    expect(new Set(line.cards.map((c: any) => c.card_id)).size).toBe(line.cards.length);

    // LE point de l'extraction : un cadeau ne passe pas à la caisse.
    const after = progression.getProgression(user());
    expect(after.gold).toBe(before.gold);
    expect(after.gems).toBe(before.gems);
  });

  it('libère l\'épingle quand la carte mise de côté tombe au booster', () => {
    // L'épingle sert à réserver une carte ; une fois possédée, elle gèlerait
    // l'emplacement sur une carte invendable — quelle que soit sa provenance.
    writeJson('sets.json', [pack('PK_PIN', 2, 30)]);
    const user = newUser(100_000, 10_000);
    shop.sync(user());

    const state = stmt.shopStateByUser.get(user().id);
    const offer = JSON.parse(state.offer);
    const target = POOL[30].id;
    // On force l'épingle sur une carte du pack, puis on offre le booster.
    offer.slots[0].card_id = target;
    stmt.upsertShopState.run({
      ...state, offer: JSON.stringify(offer), pinned: JSON.stringify({ ...offer.slots[0], card_id: target }),
    });

    writeGifts([gift('G_PIN', [{ type: 'pack', id: 'PK_PIN' }])]);
    const res = gifts.claimGift(user(), 'G_PIN');
    expect(res.ok).toBe(true);
    expect(res.lines[0].cards.some((c: any) => c.card_id === target)).toBe(true);
    expect(shop.getSnapshot(user()).pinned).toBeNull();
  });

  it('verse la prime de complétion, une seule fois', () => {
    // Un pack qu'un seul booster suffit à vider.
    writeJson('sets.json', [pack('PK_DONE', 2, 50)]);
    writeGifts([gift('G_DONE', [{ type: 'pack', id: 'PK_DONE' }])]);

    const user = newUser();
    const before = progression.getProgression(user());
    const res = gifts.claimGift(user(), 'G_DONE');

    expect(res.ok).toBe(true);
    expect(res.sets_completed.map((s: any) => s.set_id)).toContain('PK_DONE');
    expect(progression.getProgression(user()).gems - before.gems).toBe(300);

    // Et pas deux fois : l'état mémorise le pack soldé.
    const mid = progression.getProgression(user());
    shop.sync(user());
    expect(progression.getProgression(user()).gems).toBe(mid.gems);
  });

  it('un pack déjà complet est rapporté, sans faire échouer le cadeau', () => {
    writeJson('sets.json', [pack('PK_FULL', 2, 70)]);
    writeGifts([gift('G_FULL', [{ type: 'pack', id: 'PK_FULL' }, { type: 'gold', amount: 400 }])]);

    const user = newUser();
    for (const c of POOL.slice(70, 72)) progression.unlockCard(user().id, c.id);

    const before = progression.getProgression(user());
    const res = gifts.claimGift(user(), 'G_FULL');
    expect(res.ok).toBe(true);
    expect(res.lines[0].granted).toBe(false);
    expect(res.lines[0].reason).toBe('empty_pool');
    // Le reste du cadeau passe.
    expect(progression.getProgression(user()).gold - before.gold).toBe(400);
  });

  it('un pack inconnu est rapporté, sans faire échouer le cadeau', () => {
    writeGifts([gift('G_NOPACK', [{ type: 'pack', id: 'PK_INEXISTANT' }])]);
    const user = newUser();
    const res = gifts.claimGift(user(), 'G_NOPACK');
    expect(res.ok).toBe(true);
    expect(res.lines[0].reason).toBe('unknown');
  });
});

describe('contrat client ↔ serveur', () => {
  it('l\'instantané ne transporte AUCUN compteur de cadeaux en attente', () => {
    // Une valeur dérivée qu'on transporte est une valeur qui peut contredire sa
    // source : le client la calcule depuis `daily.claimed` et les `claimed`.
    writeGifts([gift('G_COUNT', [{ type: 'gold', amount: 100 }])]);
    const snap = gifts.getSnapshot(newUser()());
    expect(snap).not.toHaveProperty('claimable_count');
    expect(snap).not.toHaveProperty('pending');
  });

  it('aucun montant ne peut remonter du client', () => {
    // Le barème est celui du serveur, quoi qu'on tente de glisser en plus :
    // `claimDaily` ne lit qu'un utilisateur et `claimGift` qu'un id. Les
    // arguments surnuméraires sont ignorés, ils ne peuvent pas gonfler le lot.
    const user = newUser();
    const before = progression.getProgression(user());
    (gifts.claimDaily as any)(user(), { gold: 999_999 }, 999_999);
    const after = progression.getProgression(user());
    expect(after.gold - before.gold).toBe(200);
    expect(after.gems - before.gems).toBe(5);

    writeGifts([gift('G_AMOUNT', [{ type: 'gold', amount: 100 }])]);
    const mid = progression.getProgression(user());
    (gifts.claimGift as any)(user(), 'G_AMOUNT', { gold: 999_999 });
    expect(progression.getProgression(user()).gold - mid.gold).toBe(100);
  });

  it('les lots voyagent DÉCORÉS — l\'écran n\'a pas à rappeler trois catalogues', () => {
    const card = POOL[5];
    writeGifts([gift('G_VIEW', [
      { type: 'card', id: card.id },
      { type: 'gold', amount: 100 },
    ])]);
    const snap = gifts.getSnapshot(newUser()());
    const view = snap.gifts.find((g: any) => g.id === 'G_VIEW');
    expect(view.contents[0]).toMatchObject({ type: 'card', id: card.id, label: card.name });
    expect(view.contents[1]).toEqual({ type: 'gold', amount: 100 });
  });
});
