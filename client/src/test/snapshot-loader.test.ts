/// <reference types="node" />
// Golden tests du garde anti-course partagé (`stores/snapshotLoader`).
//
// Le bug qu'il ferme est réel et a été payé une fois, sur l'Arcade : le rapport
// d'un duel (POST) et la relecture d'écran (GET) partent d'endroits différents
// et se croisent. Rien n'ordonne les RÉPONSES — un GET parti avant que le POST
// ne soit commis rapporte l'état d'AVANT la mutation, et s'il s'applique en
// dernier il efface ce que le joueur vient de faire.
//
// La parade tenait dans un compteur de mutations, mais elle vivait dans UNE des
// cinq copies du même `load()` : boutique, cosmétiques, cadeaux et missions ne
// l'avaient pas. Ce fichier vérifie qu'elle est désormais structurelle — le
// garde vient avec le chargeur, il n'y a plus rien à ne pas oublier.
//
// ⚠️ Ces tests éprouvent un ORDRE D'ARRIVÉE de réponses HTTP : ça ne se voit pas
// côté serveur, et c'est la seule chose qui les justifie côté client (même
// raison d'être qu'`arcade-store.test.ts`). Ils tournent en node sans DOM comme
// le reste de la suite ; seul `AuthClient` est simulé et l'utilisateur est posé
// à la main — une lecture en invité étant un no-op.
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import * as AuthClient from '../data/AuthClient.js';
import { useShopStore } from '../stores/shopStore.js';
import { useGiftStore } from '../stores/giftStore.js';
import { useAuthStore } from '../stores/authStore.js';

/** Instantané de boutique minimal — seul `day` sert à distinguer les versions. */
const shopSnap = (day: string) => ({
  day, next_rotation_at: 0, slots: [], sets: [], pinned: null,
  reroll: { free_available: true, cost: 100 }, prices: {}, booster: {},
  collection: { owned: 0, total: 10 }, progression: {},
});

const giftSnap = (day: string) => ({
  day, next_rotation_at: 0, gifts: [],
  daily: { available: true, reward: { gold: 200, gems: 5 } }, progression: {},
});

/** Une promesse qu'on relâche à la main, pour ordonner les réponses. */
function deferred<T>() {
  let release!: (v: T) => void;
  const promise = new Promise<T>(r => { release = r; });
  return { promise, release };
}

beforeEach(() => {
  useAuthStore.setState({ user: { id: 1, username: 'joueur' } as never });
  useShopStore.setState({ snapshot: null, loading: false, busy: false, error: null });
  useGiftStore.setState({ snapshot: null, loading: false, busy: false, error: null, reveal: null });
});

afterEach(() => { vi.restoreAllMocks(); });

describe('boutique — le garde protège désormais un domaine qui ne l\'avait pas', () => {
  it('jette une lecture partie AVANT un achat et revenue APRÈS lui', async () => {
    const slow = deferred<void>();
    vi.spyOn(AuthClient as never, 'getShop' as never).mockImplementation(
      (async () => { await slow.promise; return shopSnap('AVANT'); }) as never,
    );
    vi.spyOn(AuthClient as never, 'buyShopCard' as never).mockImplementation(
      (async () => shopSnap('APRÈS')) as never,
    );

    const reading = useShopStore.getState().load(true);   // le GET part…
    await useShopStore.getState().buy({ slot: 0, card_id: 'C' } as never, 'golds');
    expect(useShopStore.getState().snapshot?.day).toBe('APRÈS');

    slow.release();                                        // …et revient en dernier
    await reading;

    // Sans le garde, la lecture périmée écraserait l'achat et le joueur verrait
    // sa carte redevenir achetable.
    expect(useShopStore.getState().snapshot?.day).toBe('APRÈS');
  });

  it('applique bien une lecture qu\'aucune mutation n\'a doublée', async () => {
    vi.spyOn(AuthClient as never, 'getShop' as never).mockImplementation(
      (async () => shopSnap('LU')) as never,
    );
    await useShopStore.getState().load(true);
    expect(useShopStore.getState().snapshot?.day).toBe('LU');
  });
});

describe('cadeaux — même garantie, sans une ligne de plus', () => {
  it('jette une lecture doublée par une récupération', async () => {
    const slow = deferred<void>();
    vi.spyOn(AuthClient as never, 'getGifts' as never).mockImplementation(
      (async () => { await slow.promise; return giftSnap('AVANT'); }) as never,
    );
    vi.spyOn(AuthClient as never, 'claimDailyGift' as never).mockImplementation(
      (async () => ({ ...giftSnap('APRÈS'), granted: { gold: 200, gems: 5 } })) as never,
    );

    const reading = useGiftStore.getState().load(true);
    await useGiftStore.getState().claimDaily();
    expect(useGiftStore.getState().snapshot?.day).toBe('APRÈS');

    slow.release();
    await reading;
    expect(useGiftStore.getState().snapshot?.day).toBe('APRÈS');
  });
});

describe('invité', () => {
  it('ne lit rien et n\'appelle pas la route', async () => {
    useAuthStore.setState({ user: null });
    const getShop = vi.spyOn(AuthClient as never, 'getShop' as never);
    await useShopStore.getState().load(true);
    expect(getShop).not.toHaveBeenCalled();
    expect(useShopStore.getState().snapshot).toBeNull();
  });
});

describe('canaux indépendants', () => {
  it('une mutation de boutique ne fait pas jeter une lecture de cadeaux', async () => {
    // Chaque domaine a son propre compteur : un canal partagé ferait s'annuler
    // des requêtes qui n'ont rien à voir entre elles.
    const slow = deferred<void>();
    vi.spyOn(AuthClient as never, 'getGifts' as never).mockImplementation(
      (async () => { await slow.promise; return giftSnap('CADEAUX'); }) as never,
    );
    vi.spyOn(AuthClient as never, 'buyShopCard' as never).mockImplementation(
      (async () => shopSnap('BOUTIQUE')) as never,
    );

    const reading = useGiftStore.getState().load(true);
    await useShopStore.getState().buy({ slot: 0, card_id: 'C' } as never, 'golds');
    slow.release();
    await reading;

    expect(useGiftStore.getState().snapshot?.day).toBe('CADEAUX');
  });
});
