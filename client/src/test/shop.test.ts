/* eslint-disable @typescript-eslint/no-explicit-any */
/// <reference types="node" />
// Les types Node sont référencés ICI et pas dans `types` du tsconfig : le client
// est du code navigateur, seul ce test (qui charge un module serveur) en a besoin.
//
// Golden tests de la boutique de cartes (shop.js, côté SERVEUR).
//
// Même harnais que missions.test.ts : le module est chargé via createRequire
// avec un DATA_DIR temporaire, il ouvre sa propre base SQLite et ne touche
// jamais data/soulforge.db.
//
// Ce qui est verrouillé ici, ce sont les invariants économiques qui ne doivent
// jamais dériver :
//   - ZÉRO DOUBLON : aucun tirage, nulle part, ne produit une carte possédée ;
//   - le SERVEUR chiffre : le client ne transmet jamais ni prix ni montant ;
//   - l'offre est FIGÉE pour la journée : aucune action client ne la re-tire ;
//   - l'épingle traverse la rotation À L'IDENTIQUE (carte, prix, badge), et une
//     seule à la fois ;
//   - une carte SANS ILLUSTRATION ne se vend nulle part (ni emplacement, ni
//     booster) et ne se compte nulle part.
import { describe, it, expect, beforeAll } from 'vitest';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import crypto from 'node:crypto';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

let shop: any;
let progression: any;
let stmt: any;
let CARDS: any[];
let ILLUS: string;

// L'art conditionne la vente : la boutique ne propose que des cartes qui ont
// leur illustration. Le dépôt n'en versionne aucune (`resources/` est
// gitignoré), les tests posent donc de vrais PNG — sans quoi le pool serait
// vide et le fichier ne prouverait plus rien. Même harnais que cosmetics.test.ts.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

const artPath = (id: string) => path.join(ILLUS, `${id}.png`);
const putArt = (id: string) => fs.writeFileSync(artPath(id), PNG);
const dropArt = (id: string) => fs.rmSync(artPath(id), { force: true });

beforeAll(() => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'millenium-shop-'));
  ILLUS = fs.mkdtempSync(path.join(os.tmpdir(), 'millenium-shop-illus-'));
  for (const f of ['cards.json', 'missions.json', 'sets.json']) {
    fs.copyFileSync(path.join(ROOT, 'data', f), path.join(tmp, f));
  }
  process.env.DATA_DIR = tmp;
  process.env.ILLUS_DIR = ILLUS;
  ({ stmt } = require(path.join(ROOT, 'db.js')));
  progression = require(path.join(ROOT, 'progression.js'));
  shop = require(path.join(ROOT, 'shop.js'));
  CARDS = JSON.parse(fs.readFileSync(path.join(tmp, 'cards.json'), 'utf8'));

  // Catalogue entièrement illustré : c'est l'état nominal. Les tests qui
  // portent sur l'absence d'art retirent le fichier d'une carte choisie, puis
  // le remettent — le reste du fichier ne doit pas s'en apercevoir.
  for (const c of CARDS) putArt(c.id);
});

// Tous les comptes de test partagent `username_lc = 't'` : la contrainte
// d'unicité porte donc sur (username_lc, tag). Un tag tiré des 4 premiers
// caractères d'un UUID n'offre que 65 536 valeurs — sur quelques dizaines de
// comptes, la collision d'anniversaire finit par tomber et le fichier échoue
// au hasard. Un compteur la supprime par construction.
let _tagSeq = 0;

/** Compte neuf, doté comme à l'inscription (cartes CORE_*). */
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

/** Deck actif côté serveur (lu par la pondération d'affinité). */
function setActiveDeck(userId: string, cardIds: string[]) {
  stmt.upsertDeckBook.run({
    user_id: userId,
    data: JSON.stringify({ decks: { Test: { 1: cardIds } }, meta: {}, active: 'Test' }),
    updated_at: Date.now(),
  });
}

const owned = (user: any) => new Set<string>(progression.unlockedCardIds(user));
const cardOf = (id: string) => CARDS.find(c => c.id === id);

describe('calendrier', () => {
  it('la rotation suit le reset des missions (5 h → 5 h)', () => {
    // Un seul rendez-vous quotidien : la boutique et les missions tournent
    // ensemble, sinon le joueur en rate systématiquement une des deux.
    const missions = require(path.join(ROOT, 'missions.js'));
    expect(shop.dayKey).toBe(missions.dayKey);
    const now = Date.now();
    expect(shop.nextRotationAt(now)).toBeGreaterThan(now);
    expect(shop.nextRotationAt(now) - now).toBeLessThanOrEqual(24 * 3600_000);
  });
});

describe('offre quotidienne', () => {
  it('six emplacements, jamais une carte déjà possédée', () => {
    const user = newUser();
    const snap = shop.refresh(user());
    expect(shop.DAILY_SLOTS).toBe(6);
    expect(snap.slots).toHaveLength(6);
    expect(snap.slots.map((s: any) => s.slot)).toEqual([1, 2, 3, 4, 5, 6]);

    const mine = owned(user());
    for (const slot of snap.slots) {
      expect(mine.has(slot.card_id)).toBe(false);
      expect(slot.price_golds).toBe(shop.SLOT_PRICE.golds);
      expect(slot.price_gems).toBe(shop.SLOT_PRICE.gems);
      expect(slot.purchased).toBe(false);
      expect(slot.pinned).toBe(false);
    }
    // Six cartes distinctes : un emplacement ne double jamais un autre.
    expect(new Set(snap.slots.map((s: any) => s.card_id)).size).toBe(6);
  });

  it('l\'offre est figée pour la journée — la relire ne la re-tire pas', () => {
    // C'est LE garde-fou anti-exploit : si un rechargement pouvait régénérer
    // l'offre, le joueur la re-tirerait jusqu'à satisfaction.
    const user = newUser();
    const first = shop.refresh(user()).slots.map((s: any) => s.card_id);
    for (let i = 0; i < 5; i++) {
      expect(shop.refresh(user()).slots.map((s: any) => s.card_id)).toEqual(first);
    }
  });

  it('changer de deck actif n\'influence pas l\'offre du jour', () => {
    // Sinon : exploit par changement de deck en boucle jusqu'à obtenir le
    // slot d'affinité voulu (brief §7).
    const user = newUser();
    const before = shop.refresh(user()).slots.map((s: any) => s.card_id);
    setActiveDeck(user().id, CARDS.filter(c => c.attributes?.includes('ARCH_036')).slice(0, 8).map(c => c.id));
    expect(shop.refresh(user()).slots.map((s: any) => s.card_id)).toEqual(before);
  });

  it('le tirage est déterministe à (joueur, jour, slot)', () => {
    // Reproductibilité : un tirage douteux se rejoue au lieu de se raconter.
    const user = newUser();
    const ctx = shop.context(user());
    const a = shop.buildOffer(user(), ctx, { day: '2026-07-27' });
    const b = shop.buildOffer(user(), ctx, { day: '2026-07-27' });
    expect(b.slots.map((s: any) => s.card_id)).toEqual(a.slots.map((s: any) => s.card_id));
    const c = shop.buildOffer(user(), ctx, { day: '2026-07-28' });
    expect(c.slots.map((s: any) => s.card_id)).not.toEqual(a.slots.map((s: any) => s.card_id));
  });
});

describe('emplacements sans catégorie', () => {
  // Les trois règles historiques (Maillon / Affinité / Inconnu) sont
  // supprimées : tous les emplacements sont tirés dans le MÊME pool. Ce qui se
  // vérifie ici, c'est l'absence de règle — donc l'absence de tout champ qui la
  // décrirait, et l'indifférence du tirage au deck actif.
  it('aucun emplacement ne porte de catégorie', () => {
    const user = newUser();
    for (const slot of shop.refresh(user()).slots) {
      expect(slot.reason).toBeUndefined();
      expect(slot.reason_ref).toBeUndefined();
      expect(Object.keys(slot).sort()).toEqual(
        ['card_id', 'pinned', 'price_gems', 'price_golds', 'purchased', 'slot', 'tier'],
      );
    }
  });

  it('les emplacements sont tirés dans TOUT le catalogue non possédé', () => {
    // Aucun slot n'est réservé à une famille de cartes : le pool d'un
    // emplacement est le catalogue entier moins la collection du joueur.
    const user = newUser();
    const ctx = shop.context(user());
    const pool = shop.drawablePool(ctx, [], new Set());
    expect(pool.length).toBe(CARDS.length - ctx.owned.size);

    const mine = owned(user());
    for (const slot of shop.refresh(user()).slots) {
      expect(cardOf(slot.card_id)).toBeTruthy();
      expect(mine.has(slot.card_id)).toBe(false);
    }
  });

  it('le deck actif n\'entre plus du tout dans le contexte de tirage', () => {
    // L'affinité au deck ne survit NULLE PART, boosters compris. Ce qui se
    // vérifie ici est plus fort que « le deck ne change pas l'offre » : le
    // contexte ne porte même plus de quoi la calculer, donc aucun tirage à
    // venir ne pourra la consulter par accident.
    const user = newUser();
    const harpies = CARDS.filter(c => c.attributes?.includes('ARCH_036')).slice(0, 6).map(c => c.id);
    setActiveDeck(user().id, harpies);

    expect(Object.keys(shop.context(user()))).toEqual(['owned']);

    const before = shop.buildOffer(user(), shop.context(user()), { day: '2026-09-01' });
    setActiveDeck(user().id, CARDS.slice(0, 6).map(c => c.id));
    const after = shop.buildOffer(user(), shop.context(user()), { day: '2026-09-01' });
    expect(after.slots.map((s: any) => s.card_id)).toEqual(before.slots.map((s: any) => s.card_id));
  });

  it('le tirage est UNIFORME : aucun tier n\'est favorisé ni bridé', () => {
    // La table de poids par tier (30/28/22/14/6) est supprimée. Sur un pool
    // d'un Tier 1 et d'un Tier 5, l'ancien barème donnait 83 % / 17 % ; le
    // tirage uniforme doit rendre les deux cartes interchangeables.
    const pool = [
      { id: 'LOW', tier: 1, attributes: [] },
      { id: 'HIGH', tier: 5, attributes: [] },
    ];
    let high = 0;
    const runs = 200;
    for (let seed = 0; seed < runs; seed++) {
      if (shop.drawSlot(1, pool, shop.seededRandom('uniform', seed)).card_id === 'HIGH') high++;
    }
    expect(high / runs).toBeGreaterThan(0.35);
    expect(high / runs).toBeLessThan(0.65);
  });
});

describe('cartes sans illustration', () => {
  // La boutique vend une IMAGE : un emplacement à 500 golds sur un cadre vide
  // ne donne rien à vouloir, et un booster qui révèle une carte sans art gâche
  // son seul moment. Une carte sans illustration est donc invisible partout —
  // vitrine, booster, décomptes — jusqu'à ce que l'admin lui en donne une.

  /** Retire l'art d'une carte le temps d'un test, puis le remet. */
  function withoutArt<T>(cardId: string, run: () => T): T {
    dropArt(cardId);
    try { return run(); } finally { putArt(cardId); }
  }

  /** Une carte d'un pack commercial qu'un compte neuf ne possède pas. */
  function sellableCardOf(set: any, user: any): string {
    const mine = owned(user);
    const id = shop.setCardIds(set).find((c: string) => !mine.has(c));
    expect(id).toBeTruthy();
    return id;
  }

  it('elle quitte le pool des emplacements', () => {
    const user = newUser();
    const ctx = shop.context(user());
    const victim = sellableCardOf(shop.sets()[2], user());

    withoutArt(victim, () => {
      const pool = shop.drawablePool(ctx, [], new Set());
      expect(pool.map((c: any) => c.id)).not.toContain(victim);
      expect(pool.length).toBe(CARDS.length - ctx.owned.size - 1);
    });
    // L'art revenu, la carte est de nouveau tirable : la règle porte sur le
    // fichier, pas sur un drapeau persisté.
    expect(shop.drawablePool(ctx, [], new Set()).map((c: any) => c.id)).toContain(victim);
  });

  it('aucune offre quotidienne ne la propose', () => {
    const user = newUser();
    const victim = sellableCardOf(shop.sets()[2], user());
    withoutArt(victim, () => {
      const ctx = shop.context(user());
      for (let d = 1; d <= 40; d++) {
        const offer = shop.buildOffer(user(), ctx, { day: `2027-03-${String(d).padStart(2, '0')}` });
        expect(offer.slots.map((s: any) => s.card_id)).not.toContain(victim);
      }
    });
  });

  it('un booster ne la tire pas, et le pack se complète sans elle', () => {
    // C'est le corollaire indispensable : si le pack la comptait toujours
    // comme manquante, il ne serait jamais complet — donc jamais primé — alors
    // qu'aucun tirage ne peut plus la rendre.
    const user = newUser();
    const set = shop.sets()[2];
    const victim = sellableCardOf(set, user());

    withoutArt(victim, () => {
      const sellable = shop.setCardIds(set).filter((id: string) => id !== victim);
      progression.unlockCards(user().id, sellable);
      const gems = user().gems;

      const res = shop.buyBooster(user(), set.id, 'golds');
      expect(res.ok).toBe(false);
      expect(res.reason).toMatch(/complète/);
      expect(progression.ownsCard(user(), victim)).toBe(false);

      const view = shop.getSnapshot(user()).sets.find((s: any) => s.id === set.id);
      expect(view.card_count).toBe(sellable.length);
      expect(view.complete).toBe(true);

      // La prime tombe bien, sur le pack amputé de sa carte sans art.
      const other = shop.buyBooster(user(), shop.sets()[1].id, 'golds');
      expect(other.sets_completed.map((s: any) => s.set_id)).toContain(set.id);
      expect(user().gems).toBe(gems + (set.completion_reward?.gems ?? 0));
    });
  });

  it('le compteur de collection l\'ignore des deux côtés de la fraction', () => {
    const user = newUser();
    const victim = sellableCardOf(shop.sets()[2], user());
    withoutArt(victim, () => {
      const snap = shop.refresh(user());
      expect(snap.collection.total).toBe(CARDS.length - 1);
      expect(snap.collection.owned).toBe(owned(user()).size);
    });
  });

  it('une carte de la DOTATION sans art reste possédée, elle n\'est simplement pas comptée', () => {
    // La dotation d'un compte neuf est offerte, pas vendue : l'art n'y
    // conditionne rien. Sans l'exclure aussi du numérateur, un compte neuf
    // afficherait plus de cartes possédées que le total vendable.
    const user = newUser();
    const mine = progression.unlockedCardIds(user());
    withoutArt(mine[0], () => {
      expect(progression.ownsCard(user(), mine[0])).toBe(true);
      const snap = shop.refresh(user());
      expect(snap.collection.total).toBe(CARDS.length - 1);
      expect(snap.collection.owned).toBe(mine.length - 1);
      expect(snap.collection.owned).toBeLessThanOrEqual(snap.collection.total);
    });
  });

  it('une épingle dont l\'art disparaît ne traverse pas la rotation', () => {
    const user = newUser();
    const before = shop.refresh(user()).slots.find((s: any) => s.slot === 2);
    expect(shop.setPin(user(), 2).ok).toBe(true);

    withoutArt(before.card_id, () => {
      const next = shop.buildOffer(user(), shop.context(user()), {
        day: '2027-05-01', pinned: { ...before, since_day: '2027-04-30' },
      });
      expect(next.slots.map((s: any) => s.card_id)).not.toContain(before.card_id);
      expect(next.slots).toHaveLength(shop.DAILY_SLOTS);
    });
  });
});

describe('achat d\'un emplacement', () => {
  it('débite le prix en golds et débloque la carte', () => {
    const user = newUser(1000);
    const slot = shop.refresh(user()).slots[0];
    const before = user().gold;

    const res = shop.buySlot(user(), slot.slot, slot.card_id);
    expect(res.ok).toBe(true);
    expect(res.currency).toBe('golds');
    expect(user().gold).toBe(before - shop.SLOT_PRICE.golds);
    expect(progression.ownsCard(user(), slot.card_id)).toBe(true);
  });

  it('peut être payé en gemmes à la place', () => {
    const user = newUser(0, 1000);
    const slot = shop.refresh(user()).slots[0];
    const before = user().gems;

    const res = shop.buySlot(user(), slot.slot, slot.card_id, 'gems');
    expect(res.ok).toBe(true);
    expect(res.currency).toBe('gems');
    expect(user().gems).toBe(before - shop.SLOT_PRICE.gems);
    expect(user().gold).toBe(0);
    expect(progression.ownsCard(user(), slot.card_id)).toBe(true);
  });

  it('refuse le second achat du même emplacement', () => {
    const user = newUser(1000);
    const slot = shop.refresh(user()).slots[0];
    shop.buySlot(user(), slot.slot, slot.card_id);
    const again = shop.buySlot(user(), slot.slot, slot.card_id);
    expect(again.ok).toBe(false);
    expect(again.reason).toMatch(/déjà acheté/);
  });

  it('les six emplacements sont achetables le même jour', () => {
    const user = newUser(10_000);
    const snap = shop.refresh(user());
    for (const slot of snap.slots) {
      expect(shop.buySlot(user(), slot.slot, slot.card_id).ok).toBe(true);
    }
    // Acheter un emplacement ne rafraîchit pas les autres.
    expect(shop.getSnapshot(user()).slots.every((s: any) => s.purchased)).toBe(true);
  });

  it('refuse un achat dont la carte attendue ne correspond plus', () => {
    // Verrou transactionnel : l'achat valide l'offre horodatée, pas la courante.
    const user = newUser(5000);
    const slot = shop.refresh(user()).slots[0];
    const res = shop.buySlot(user(), slot.slot, 'CORE_999');
    expect(res.ok).toBe(false);
    expect(res.stale).toBe(true);
  });

  it('refuse l\'achat sans les golds', () => {
    const user = newUser(0);
    const slot = shop.refresh(user()).slots[0];
    const res = shop.buySlot(user(), slot.slot, slot.card_id);
    expect(res.ok).toBe(false);
    expect(user().gold).toBe(0);
    expect(progression.ownsCard(user(), slot.card_id)).toBe(false);
  });
});

describe('reroll', () => {
  it('un seul gratuit par jour, la carte quitte le pool du jour', () => {
    const user = newUser();
    const before = shop.refresh(user()).slots.find((s: any) => s.slot === 3);

    const res = shop.reroll(user(), 3);
    expect(res.ok).toBe(true);
    expect(res.slot.card_id).not.toBe(before.card_id);

    const snap = shop.getSnapshot(user());
    expect(snap.reroll.free_available).toBe(false);
    // Elle ne peut pas revenir dans l'offre du jour.
    expect(snap.slots.map((s: any) => s.card_id)).not.toContain(before.card_id);

    const second = shop.reroll(user(), 2);
    expect(second.ok).toBe(false);
    expect(second.reason).toMatch(/déjà utilisé/);
  });

  it('le reroll rend une autre carte du pool, sans doubler un autre emplacement', () => {
    const user = newUser();
    const snap = shop.refresh(user());
    const before = snap.slots.find((s: any) => s.slot === 1);
    const others = snap.slots.filter((s: any) => s.slot !== 1).map((s: any) => s.card_id);

    const res = shop.reroll(user(), 1);
    expect(res.ok).toBe(true);
    expect(res.slot.card_id).not.toBe(before.card_id);
    expect(others).not.toContain(res.slot.card_id);
    expect(owned(user()).has(res.slot.card_id)).toBe(false);
  });

  it('un emplacement acheté ne se reroule pas', () => {
    const user = newUser(5000);
    const slot = shop.refresh(user()).slots[0];
    shop.buySlot(user(), slot.slot, slot.card_id);
    expect(shop.reroll(user(), slot.slot).ok).toBe(false);
  });
});

describe('épingle', () => {
  /** Rejoue une rotation : l'offre est effacée, `sync` la reconstruit. */
  function rotate(userId: string) {
    const state = stmt.shopStateByUser.get(userId);
    stmt.upsertShopState.run({ ...state, offer_day: null, offer: null });
  }

  it('l\'emplacement épinglé traverse la rotation à l\'identique', () => {
    // Carte, PRIX et badge : le joueur doit retrouver exactement la proposition
    // qu'il a mise de côté, sinon économiser pour elle n'a pas de sens.
    const user = newUser();
    const before = shop.refresh(user()).slots.find((s: any) => s.slot === 2);
    expect(shop.setPin(user(), 2).ok).toBe(true);

    const pinned = shop.getSnapshot(user()).pinned;
    expect(pinned.slot).toBe(2);
    expect(pinned.card_id).toBe(before.card_id);

    // Un vrai lendemain : autre jour → autres graines pour les slots libres.
    const next = shop.buildOffer(user(), shop.context(user()), { day: '2027-01-01', pinned: { ...before, since_day: '2026-12-31' } });
    const kept = next.slots.find((s: any) => s.slot === 2);
    expect(kept.card_id).toBe(before.card_id);
    expect(kept.price_golds).toBe(before.price_golds);
    expect(kept.price_gems).toBe(before.price_gems);
    expect(kept.purchased).toBe(false);
    // Les autres emplacements, eux, sont bien re-tirés.
    expect(next.slots.filter((s: any) => s.slot !== 2)).toHaveLength(shop.DAILY_SLOTS - 1);
  });

  it('l\'épingle survit à la reconstruction de l\'offre', () => {
    const user = newUser();
    const before = shop.refresh(user()).slots.find((s: any) => s.slot === 3);
    shop.setPin(user(), 3);
    rotate(user().id);

    const slot3 = shop.refresh(user()).slots.find((s: any) => s.slot === 3);
    expect(slot3.card_id).toBe(before.card_id);
    expect(slot3.pinned).toBe(true);
  });

  it('une seule à la fois : épingler ailleurs déplace l\'épingle', () => {
    // Épingler les trois figerait la boutique et supprimerait la rotation.
    const user = newUser();
    shop.refresh(user());
    shop.setPin(user(), 1);
    shop.setPin(user(), 3);

    const snap = shop.getSnapshot(user());
    expect(snap.pinned.slot).toBe(3);
    expect(snap.slots.filter((s: any) => s.pinned)).toHaveLength(1);
    expect(snap.pin_rules.max).toBe(1);
  });

  it('un emplacement épinglé ne se reroule pas, détacher le rend re-tirable', () => {
    const user = newUser();
    shop.refresh(user());
    shop.setPin(user(), 3);

    const refused = shop.reroll(user(), 3);
    expect(refused.ok).toBe(false);
    expect(refused.reason).toMatch(/épinglé/);
    // Le reroll du jour n'a pas été consommé pour rien.
    expect(shop.getSnapshot(user()).reroll.free_available).toBe(true);

    expect(shop.setPin(user(), null).ok).toBe(true);
    expect(shop.getSnapshot(user()).pinned).toBe(null);
    expect(shop.reroll(user(), 3).ok).toBe(true);
  });

  it('acheter la carte épinglée libère l\'épingle', () => {
    const user = newUser(5000);
    const slot = shop.refresh(user()).slots[0];
    shop.setPin(user(), slot.slot);
    expect(shop.buySlot(user(), slot.slot, slot.card_id).ok).toBe(true);
    expect(shop.getSnapshot(user()).pinned).toBe(null);
  });

  it('refuse d\'épingler un emplacement déjà acheté', () => {
    const user = newUser(5000);
    const slot = shop.refresh(user()).slots[0];
    shop.buySlot(user(), slot.slot, slot.card_id);
    expect(shop.setPin(user(), slot.slot).ok).toBe(false);
  });

  it('une carte obtenue autrement libère l\'épingle à la rotation', () => {
    // Sinon l'emplacement resterait gelé sur une carte invendable.
    const user = newUser();
    const slot = shop.refresh(user()).slots[1];
    shop.setPin(user(), slot.slot);

    progression.unlockCard(user().id, slot.card_id);
    rotate(user().id);

    const snap = shop.refresh(user());
    expect(snap.pinned).toBe(null);
    expect(snap.slots.map((s: any) => s.card_id)).not.toContain(slot.card_id);
  });
});

describe('boosters', () => {
  it('3 cartes non possédées, distinctes, du set choisi', () => {
    const user = newUser();
    const set = shop.sets()[0];
    const before = owned(user());

    const res = shop.buyBooster(user(), set.id, 'golds');
    expect(res.ok).toBe(true);
    expect(res.cards).toHaveLength(3);

    const ids = res.cards.map((c: any) => c.card_id);
    expect(new Set(ids).size).toBe(3);
    for (const id of ids) {
      expect(before.has(id)).toBe(false);              // zéro doublon
      expect(shop.setCardIds(set)).toContain(id);      // bien du set acheté
      expect(progression.ownsCard(user(), id)).toBe(true);
    }
  });

  // Le tirage lui-même se teste sur un pool contrôlé. Ce qui suit vérifie des
  // ABSENCES : le booster n'a plus ni garantie de tier, ni ancre, ni cohérence
  // de lignée ou d'attribut. Chacune de ces règles a existé — un test qui les
  // interdit explicitement empêche de les réintroduire par inadvertance.
  const mkCard = (id: string, tier: number, attributes: string[], materials: string[] = []) =>
    ({ id, tier, attributes, cost: { sacrifice: 0, materials } });

  it('aucune garantie de tier : un booster peut n\'être QUE du bas tier', () => {
    // Ancien barème : l'unique Tier 5 du pool était l'ancre obligatoire, donc
    // présent dans les 3 cartes à tous les coups.
    const pool = [
      mkCard('HIGH', 5, []),
      mkCard('L1', 1, []), mkCard('L2', 1, []), mkCard('L3', 2, []),
      mkCard('L4', 2, []), mkCard('L5', 1, []),
    ];
    const draws = Array.from({ length: 25 }, (_, seed) =>
      shop.drawBooster(pool, shop.seededRandom('tier', seed)).map((c: any) => c.id));
    expect(draws.some(ids => !ids.includes('HIGH'))).toBe(true);
    expect(draws.some(ids => ids.includes('HIGH'))).toBe(true);
  });

  it('aucune cohérence d\'attribut : les 3 cartes n\'ont rien à partager', () => {
    const pool = [
      mkCard('X1', 4, ['ARCH_X']), mkCard('X2', 1, ['ARCH_X']), mkCard('X3', 2, ['ARCH_X']),
      mkCard('Z1', 3, ['ARCH_Z']), mkCard('Z2', 1, ['ARCH_Z']), mkCard('Z3', 2, ['ARCH_Z']),
    ];
    const mixed = Array.from({ length: 25 }, (_, seed) =>
      shop.drawBooster(pool, shop.seededRandom('attr', seed)).map((c: any) => c.attributes[0]))
      .some((attrs: string[]) => new Set(attrs).size > 1);
    expect(mixed).toBe(true);
  });

  it('aucune cohérence de lignée : une fusion tirée n\'entraîne plus ses matériaux', () => {
    const pool = [
      mkCard('FUSION', 4, ['ARCH_X'], ['MAT_A', 'MAT_B']),
      mkCard('MAT_A', 1, ['ARCH_X']), mkCard('MAT_B', 2, ['ARCH_X']),
      mkCard('OTHER_1', 1, ['ARCH_X']), mkCard('OTHER_2', 2, ['ARCH_X']),
    ];
    const orphan = Array.from({ length: 25 }, (_, seed) =>
      shop.drawBooster(pool, shop.seededRandom('lineage', seed)).map((c: any) => c.id))
      .some(ids => ids.includes('FUSION') && (!ids.includes('MAT_A') || !ids.includes('MAT_B')));
    expect(orphan).toBe(true);
  });

  it('un pool réduit à 3 cartes les rend toutes, sans jamais bloquer la vente', () => {
    const pool = [mkCard('A', 4, []), mkCard('B', 1, ['ARCH_1']), mkCard('C', 2, ['ARCH_2'])];
    const drawn = shop.drawBooster(pool, shop.seededRandom('s', 1));
    expect(drawn.map((c: any) => c.id).sort()).toEqual(['A', 'B', 'C']);
  });

  it('jamais deux fois la même carte dans un booster', () => {
    // Le zéro doublon est le SEUL invariant qui reste : il tient au niveau du
    // tirage (une carte tirée quitte le pool) autant que du pool de départ.
    const pool = Array.from({ length: 5 }, (_, i) => mkCard(`C${i}`, 1, []));
    for (let seed = 0; seed < 50; seed++) {
      const ids = shop.drawBooster(pool, shop.seededRandom('dup', seed)).map((c: any) => c.id);
      expect(ids).toHaveLength(3);
      expect(new Set(ids).size).toBe(3);
    }
  });

  it('débite les golds OU les gemmes, jamais les deux', () => {
    const user = newUser(10_000, 1_000);
    const gold = user().gold;
    const gems = user().gems;

    shop.buyBooster(user(), shop.sets()[3].id, 'golds');
    expect(user().gold).toBe(gold - shop.BOOSTER.price_golds);
    expect(user().gems).toBe(gems);

    shop.buyBooster(user(), shop.sets()[3].id, 'gems');
    expect(user().gems).toBe(gems - shop.BOOSTER.price_gems);
    expect(user().gold).toBe(gold - shop.BOOSTER.price_golds);
  });

  it('refuse l\'achat sans le solde', () => {
    const user = newUser(0, 0);
    const res = shop.buyBooster(user(), shop.sets()[0].id, 'golds');
    expect(res.ok).toBe(false);
    expect(res.reason).toMatch(/golds/);
  });

  it('un set complet ne peut plus être acheté, et verse sa prime une seule fois', () => {
    const user = newUser();
    const set = shop.sets()[0];
    // On force la complétion du set : c'est l'état terminal à couvrir.
    progression.unlockCards(user().id, shop.setCardIds(set));
    const gems = user().gems;

    // La prime tombe au premier passage (ici, l'achat d'un autre booster).
    const other = shop.buyBooster(user(), shop.sets()[1].id, 'golds');
    expect(other.sets_completed.map((s: any) => s.set_id)).toContain(set.id);
    expect(user().gems).toBe(gems + (set.completion_reward?.gems ?? 0));

    const again = shop.buyBooster(user(), shop.sets()[1].id, 'golds');
    expect(again.sets_completed.map((s: any) => s.set_id)).not.toContain(set.id);

    const refused = shop.buyBooster(user(), set.id, 'golds');
    expect(refused.ok).toBe(false);
    expect(refused.reason).toMatch(/complète/);
    expect(shop.getSnapshot(user()).sets.find((s: any) => s.id === set.id).complete).toBe(true);
  });

  it('une carte épinglée tombée au booster libère l\'épingle', () => {
    const user = newUser();
    // On épingle un emplacement dont la carte appartient à un set achetable :
    // c'est le seul moyen de la faire tomber par une autre porte.
    const slot = shop.refresh(user()).slots
      .find((s: any) => shop.sets().some((d: any) => shop.setCardIds(d).includes(s.card_id)));
    expect(slot).toBeTruthy();
    const set = shop.sets().find((d: any) => shop.setCardIds(d).includes(slot.card_id));
    shop.setPin(user(), slot.slot);

    // On vide le set jusqu'à tomber sur la carte épinglée.
    for (let i = 0; i < 40; i++) {
      const res = shop.buyBooster(user(), set.id, 'golds');
      if (!res.ok) break;
      if (res.pin_cleared) {
        expect(res.cards.map((c: any) => c.card_id)).toContain(slot.card_id);
        expect(shop.getSnapshot(user()).pinned).toBe(null);
        return;
      }
    }
    // Le set a été vidé sans jamais sortir la carte : impossible (tirage sans
    // remise), donc l'échec est un vrai échec.
    expect(shop.getSnapshot(user()).pinned).toBe(null);
  });

  it('le dernier booster d\'un set rend ce qui reste, sans garantie satisfaite', () => {
    // Repli SILENCIEUX : un pool résiduel de 1 carte ne bloque pas la vente.
    const user = newUser();
    const set = shop.sets()[5];
    const ids = shop.setCardIds(set);
    progression.unlockCards(user().id, ids.slice(0, ids.length - 1));

    const res = shop.buyBooster(user(), set.id, 'golds');
    expect(res.ok).toBe(true);
    expect(res.cards).toHaveLength(1);
    expect(res.cards[0].card_id).toBe(ids[ids.length - 1]);
  });
});

describe('instantané', () => {
  it('porte les prix, les sets et l\'avancement de collection', () => {
    const user = newUser();
    const snap = shop.refresh(user());
    expect(snap.prices).toEqual({ golds: 500, gems: 20 });
    expect(snap.booster.price_golds).toBe(1000);
    expect(snap.booster.price_gems).toBe(40);
    expect(snap.sets.length).toBeGreaterThan(0);
    expect(snap.collection.total).toBe(CARDS.length);
    expect(snap.collection.owned).toBe(owned(user()).size);
    for (const s of snap.sets) {
      expect(s.owned_count).toBeLessThanOrEqual(s.card_count);
    }
  });

  it('rattrape une offre persistée avant le prix unique (price → price_golds/price_gems)', () => {
    // Simule une offre écrite par une version antérieure du schéma (avant le
    // passage au prix unique) : plus de champ `price`, un emplacement épinglé
    // dans le même état legacy. Sans rattrapage à la lecture, ces champs
    // manquants s'affichent en NaN côté client.
    const user = newUser();
    const day = shop.dayKey();
    const legacySlot = { slot: 1, card_id: 'CORE_001', tier: 1, price: 75, reason: 'random', reason_ref: null, purchased: false };
    stmt.upsertShopState.run({
      user_id: user().id,
      offer_day: day,
      offer: JSON.stringify({ day, generated_at: Date.now(), slots: [legacySlot], excluded: [] }),
      reroll_free_day: null,
      pinned: JSON.stringify({ slot: 1, card_id: 'CORE_001', tier: 1, price: 75, reason: 'random', reason_ref: null, since_day: day }),
      sets_claimed: JSON.stringify([]),
    });

    const snap = shop.refresh(user());
    expect(snap.slots[0].price_golds).toBe(shop.SLOT_PRICE.golds);
    expect(snap.slots[0].price_gems).toBe(shop.SLOT_PRICE.gems);
  });

  it('complète une offre du jour plus courte que le format courant, sans re-tirer l\'existant', () => {
    // Une offre à 3 emplacements tirée avant le passage à 6 : elle est
    // COMPLÉTÉE, pas régénérée. C'est le seul écart toléré à « l'offre est
    // figée pour la journée » — et il n'est pas déclenchable par le client, le
    // nombre d'emplacements ne venant d'aucune entrée réseau.
    const user = newUser(10_000);
    const full = shop.refresh(user());
    expect(full.slots).toHaveLength(6);

    // On achète le premier, puis on rétrécit l'offre persistée à 3 slots.
    expect(shop.buySlot(user(), 1, full.slots[0].card_id).ok).toBe(true);
    const state = stmt.shopStateByUser.get(user().id);
    const offer = JSON.parse(state.offer);
    const kept = offer.slots.filter((s: any) => s.slot <= 3);
    stmt.upsertShopState.run({ ...state, offer: JSON.stringify({ ...offer, slots: kept }) });

    const snap = shop.refresh(user());
    expect(snap.slots).toHaveLength(6);
    // Les trois d'origine sont intacts — carte ET état d'achat.
    for (const before of kept) {
      const after = snap.slots.find((s: any) => s.slot === before.slot);
      expect(after.card_id).toBe(before.card_id);
      expect(after.purchased).toBe(before.purchased);
    }
    expect(snap.slots.find((s: any) => s.slot === 1).purchased).toBe(true);
    // Les trois nouveaux ne doublent rien et ne sont pas déjà possédés.
    expect(new Set(snap.slots.map((s: any) => s.card_id)).size).toBe(6);
    const mine = owned(user());
    for (const s of snap.slots.filter((x: any) => !x.purchased)) expect(mine.has(s.card_id)).toBe(false);

    // Et une fois complétée, elle est de nouveau figée.
    expect(shop.refresh(user()).slots.map((s: any) => s.card_id))
      .toEqual(snap.slots.map((s: any) => s.card_id));
  });
});
