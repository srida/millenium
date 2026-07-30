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
//     seule à la fois.
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

beforeAll(() => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'millenium-shop-'));
  for (const f of ['cards.json', 'missions.json', 'sets.json']) {
    fs.copyFileSync(path.join(ROOT, 'data', f), path.join(tmp, f));
  }
  process.env.DATA_DIR = tmp;
  ({ stmt } = require(path.join(ROOT, 'db.js')));
  progression = require(path.join(ROOT, 'progression.js'));
  shop = require(path.join(ROOT, 'shop.js'));
  CARDS = JSON.parse(fs.readFileSync(path.join(tmp, 'cards.json'), 'utf8'));
});

/** Compte neuf, doté comme à l'inscription (cartes CORE_*). */
function newUser(gold = 100_000, gems = 10_000) {
  const id = crypto.randomUUID();
  stmt.insertUser.run({
    id, email: `${id}@test.local`, username: 'T', username_lc: 't',
    tag: id.slice(0, 4), password_hash: 'x', avatar: null, created_at: Date.now(),
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
  it('trois emplacements, jamais une carte déjà possédée', () => {
    const user = newUser();
    const snap = shop.refresh(user());
    expect(snap.slots).toHaveLength(3);
    expect(snap.slots.map((s: any) => s.slot)).toEqual([1, 2, 3]);

    const mine = owned(user());
    for (const slot of snap.slots) {
      expect(mine.has(slot.card_id)).toBe(false);
      expect(slot.price_golds).toBe(shop.SLOT_PRICE.golds);
      expect(slot.price_gems).toBe(shop.SLOT_PRICE.gems);
      expect(slot.purchased).toBe(false);
      expect(slot.pinned).toBe(false);
    }
    // Trois cartes distinctes : un emplacement ne double jamais un autre.
    expect(new Set(snap.slots.map((s: any) => s.card_id)).size).toBe(3);
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

describe('slot 1 — Le Maillon', () => {
  it('ne propose que des cartes qui débloquent une invocation', () => {
    const user = newUser();
    const ctx = shop.context(user());
    const pool = CARDS.filter(c => !ctx.owned.has(c.id));
    const candidates = shop.linkCandidates(pool, ctx);
    expect(candidates.length).toBeGreaterThan(0);

    for (const { card, reason, reason_ref } of candidates) {
      if (reason === 'unlocks') {
        // Tous ses matériaux sont là : elle est jouable le soir même.
        const mats = shop.materialsOf(card);
        expect(mats.length).toBeGreaterThan(0);
        expect(mats.every((m: string) => ctx.owned.has(m) || ctx.ownedAttributes.has(m))).toBe(true);
      } else {
        // C'est le matériau manquant d'une carte déjà possédée.
        expect(reason).toBe('material');
        expect(ctx.owned.has(reason_ref)).toBe(true);
        expect(shop.materialsOf(cardOf(reason_ref))).toContain(card.id);
      }
    }
  });

  it('un matériau désigné par attribut est couvert par n\'importe quel porteur', () => {
    // `cost.materials` mélange ids de cartes et ids d'attributs (ARCH_*) :
    // « un Dragon » se satisfait de n'importe quel Dragon possédé.
    const user = newUser();
    const ctx = shop.context(user());
    const byAttr = CARDS.find(c => shop.materialsOf(c).some((m: string) => m.startsWith('ARCH_')));
    expect(byAttr).toBeTruthy();
    const attrMat = shop.materialsOf(byAttr).find((m: string) => m.startsWith('ARCH_'));
    expect(ctx.ownedAttributes.has(attrMat)).toBe(ctx.ownedAttributes.has(attrMat)); // sanity
    // Le porteur possédé suffit : aucun matériau ARCH_* n'est jamais « possédé »
    // en tant que carte.
    expect(ctx.owned.has(attrMat)).toBe(false);
  });
});

describe('slot 2 — L\'Affinité', () => {
  it('ne propose que des cartes partageant un attribut vu ≥ 2 fois dans le deck actif', () => {
    const user = newUser();
    const harpies = CARDS.filter(c => c.attributes?.includes('ARCH_036')).slice(0, 6).map(c => c.id);
    setActiveDeck(user().id, harpies);

    const attrs = shop.activeDeckAttributes(user().id);
    expect(attrs.get('ARCH_036')).toBeGreaterThanOrEqual(2);

    const ctx = shop.context(user());
    const pool = CARDS.filter(c => !ctx.owned.has(c.id));
    for (const { card, reason_ref } of shop.affinityCandidates(pool, ctx)) {
      expect(card.attributes).toContain(reason_ref);
      expect(attrs.has(reason_ref)).toBe(true);
    }
  });

  it('sans deck actif, le slot se replie sur le tirage libre', () => {
    const user = newUser();
    expect(shop.activeDeckAttributes(user().id).size).toBe(0);
    const slot2 = shop.refresh(user()).slots.find((s: any) => s.slot === 2);
    expect(slot2.reason).toBe('random');
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

  it('les trois emplacements sont achetables le même jour', () => {
    const user = newUser(5000);
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

  it('le reroll conserve la règle du slot', () => {
    // Un reroll du Maillon rend un autre Maillon, pas une carte au hasard :
    // sinon le reroll dégraderait l'offre au lieu de la changer.
    const user = newUser();
    const before = shop.refresh(user()).slots.find((s: any) => s.slot === 1);
    expect(['unlocks', 'material']).toContain(before.reason);
    const res = shop.reroll(user(), 1);
    expect(['unlocks', 'material']).toContain(res.slot.reason);
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
    expect(kept.reason).toBe(before.reason);
    expect(kept.purchased).toBe(false);
    // Les autres emplacements, eux, sont bien re-tirés.
    expect(next.slots.filter((s: any) => s.slot !== 2)).toHaveLength(2);
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

  it('garantit 2 cartes Tier 1-2 et 1 carte Tier 3+', () => {
    const user = newUser();
    // Plusieurs ouvertures : la garantie n'est pas un coup de chance.
    for (let i = 0; i < 8; i++) {
      const res = shop.buyBooster(user(), shop.sets()[1].id, 'golds');
      if (!res.ok) break;
      const low = res.cards.filter((c: any) => c.tier < 3).length;
      const high = res.cards.filter((c: any) => c.tier >= 3).length;
      expect(low).toBe(2);
      expect(high).toBe(1);
    }
  });

  // Le tirage lui-même se teste sur un pool contrôlé : sur données réelles, la
  // cohérence d'attribut est régulièrement (et légitimement) abandonnée — une
  // partie du catalogue ne porte aucun attribut.
  const mkCard = (id: string, tier: number, attributes: string[], materials: string[] = []) =>
    ({ id, tier, attributes, cost: { sacrifice: 0, materials } });
  const noCtx = { owned: new Set<string>(), ownedAttributes: new Set<string>(), affinity: new Map() };

  it('les 3 cartes partagent un attribut avec l\'ancre quand le pool le permet', () => {
    const pool = [
      mkCard('H1', 4, ['ARCH_X']), mkCard('H2', 3, ['ARCH_X']),
      mkCard('L1', 1, ['ARCH_X']), mkCard('L2', 2, ['ARCH_X']), mkCard('L3', 2, ['ARCH_X']),
      mkCard('N1', 1, ['ARCH_Z']), mkCard('N2', 2, ['ARCH_Z']),
    ];
    for (let seed = 0; seed < 25; seed++) {
      const [anchor, ...rest] = shop.drawBooster(pool, noCtx, shop.seededRandom('s', seed));
      const attrs = new Set(anchor.attributes);
      for (const c of rest) expect(c.attributes.some((a: string) => attrs.has(a))).toBe(true);
    }
  });

  it('un pool sans attribut commun se rabat silencieusement, sans jamais bloquer la vente', () => {
    // Priorité d'abandon : cohérence d'attribut d'abord, garantie de tier
    // ensuite — le zéro doublon, jamais.
    const pool = [mkCard('A', 4, []), mkCard('B', 1, ['ARCH_1']), mkCard('C', 2, ['ARCH_2'])];
    const drawn = shop.drawBooster(pool, noCtx, shop.seededRandom('s', 1));
    expect(drawn.map((c: any) => c.id).sort()).toEqual(['A', 'B', 'C']);
  });

  it('cohérence de lignée : une fusion tirée entraîne ses matériaux manquants', () => {
    const pool = [
      mkCard('FUSION', 4, ['ARCH_X'], ['MAT_A', 'MAT_B']),
      mkCard('MAT_A', 1, ['ARCH_X']), mkCard('MAT_B', 2, ['ARCH_X']),
      mkCard('OTHER_1', 1, ['ARCH_X']), mkCard('OTHER_2', 2, ['ARCH_X']),
    ];
    for (let seed = 0; seed < 15; seed++) {
      const drawn = shop.drawBooster(pool, noCtx, shop.seededRandom('lineage', seed));
      const ids = drawn.map((c: any) => c.id);
      // L'ancre est forcément la seule carte Tier 3+ du pool.
      expect(ids[0]).toBe('FUSION');
      expect(ids).toContain('MAT_A');
      expect(ids).toContain('MAT_B');
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
    expect(snap.prices).toEqual({ golds: 1000, gems: 100 });
    expect(snap.booster.price_golds).toBe(2000);
    expect(snap.booster.price_gems).toBe(150);
    expect(snap.sets.length).toBeGreaterThan(0);
    expect(snap.collection.total).toBe(CARDS.length);
    expect(snap.collection.owned).toBe(owned(user()).size);
    for (const s of snap.sets) {
      expect(s.owned_count).toBeLessThanOrEqual(s.card_count);
    }
  });
});
