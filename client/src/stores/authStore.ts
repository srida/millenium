/* eslint-disable @typescript-eslint/no-explicit-any */
// authStore — état de session (compte online). L'auth est OPTIONNELLE (D2) : le
// jeu se joue en invité (decks en localStorage) ; se connecter active la
// synchronisation serveur des decks (DeckRepository.pull/flushSync).
import { create } from 'zustand';
import * as AuthClient from '../data/AuthClient.js';
import * as DeckRepository from '../data/DeckRepository.js';

export interface AuthUser {
  id: string; username: string; email?: string; avatar?: string | null; is_admin?: boolean;
  /** Dos de carte porté (id du catalogue `card_backs`). Cosmétique pur : il
   *  n'apparaît que dans la popup de pioche. `null` / absent → le dos par
   *  défaut, qui est aussi le repli de tout id inconnu. */
  card_back?: string | null;
  /** Progression — servie par publicUser() ; la collection est sur /api/me/progression. */
  level?: number; xp?: number; gold?: number; gems?: number;
  /** Paliers de niveau gagnés mais pas encore récupérés (levels.js). */
  pending_levels?: number;
}

/** Objet tiré au sort à un palier de 10 niveaux (levels.js). */
export interface LevelRewardItem { type: 'card' | 'avatar' | 'variant'; id: string; label: string; tier?: number | null }

/** Un palier RÉCUPÉRÉ, tel que le serveur l'a soldé. */
export interface LevelReward { level: number; gold: number; gems: number; item: LevelRewardItem | null }

/** Réponse de `POST /me/levels/claim`. */
export interface LevelClaim {
  lines: LevelReward[];
  granted: { gold: number; gems: number };
  progression: Progression;
  levels: unknown;
}

/** Progression renvoyée par le serveur (barème et courbe de niveau côté serveur). */
export interface Progression {
  level: number; xp: number; xp_per_level?: number; gold: number; gems: number;
  pending_levels?: number;
}

interface AuthStoreState {
  user: AuthUser | null;
  ready: boolean;                       // me() a répondu (ou timeout) au moins une fois
  setUser: (u: AuthUser | null) => void;
  /** Fusionne une progression fraîche dans l'utilisateur courant (no-op en invité). */
  applyProgression: (p: Progression | null | undefined) => void;
  /** Niveaux tout juste franchis, en attente d'ANNONCE (toasts). Le gain, lui,
   *  se récupère au Profil : le toast dit qu'il y a quelque chose à y prendre. */
  levelToasts: { key: number; level: number }[];
  dismissLevelToast: (key: number) => void;
  /**
   * Récupère les paliers dus (`POST /me/levels/claim`). → le compte rendu, ou
   * `null` si rien n'était dû / l'appel a échoué. Les cartes livrées entrent
   * dans la collection au passage, comme après un achat en boutique.
   */
  claimLevels: () => Promise<LevelClaim | null>;
  /**
   * Déclare un gain d'XP au serveur et applique le résultat. Best-effort :
   * une erreur réseau ne doit jamais interrompre une fin de partie, et un
   * invité n'a simplement pas de progression à créditer.
   */
  claimReward: (reason: 'ai_win' | 'tournament_win') => Promise<void>;
  /** Restauration de session au boot (cap 4 s) puis pull des decks si connecté. */
  restore: () => Promise<void>;
  /** Après login/register réussi : mémorise l'utilisateur et pull des decks. */
  onAuthenticated: (u: AuthUser) => Promise<void>;
  logout: () => Promise<void>;
}

// Clé d'affichage des toasts de palier — hors du store, comme `toastKey` de
// missionStore : deux paliers du même gain doivent avoir deux clés React.
let levelToastKey = 0;

export const useAuthStore = create<AuthStoreState>((set, get) => ({
  user: null,
  ready: false,
  setUser: (user) => set({ user }),

  levelToasts: [],
  dismissLevelToast: (key) => set(s => ({ levelToasts: s.levelToasts.filter(t => t.key !== key) })),

  applyProgression: (p) => {
    if (!p) return;
    const user = get().user;
    if (!user) return;

    const pending = p.pending_levels ?? user.pending_levels;

    // ⚠️ Un instantané IDENTIQUE ne réécrit PAS `user`. Ce n'est pas une
    // économie de rendu : l'identité de `user` est une dépendance d'effet dans
    // tout le client (`[user, load]` sur les quatre boutons du menu). Un objet
    // neuf à chaque réponse relançait la lecture, qui réappliquait la
    // progression, qui rendait un objet neuf — les quatre routes d'instantané
    // (missions, boutique, cadeaux, arcade) bouclaient sans fin sur le menu
    // principal. La règle : une valeur inchangée ne produit pas d'état neuf.
    if (user.level === p.level && user.xp === p.xp && user.gold === p.gold
      && user.gems === p.gems && user.pending_levels === pending) return;

    // Toutes les réponses qui créditent de l'XP passent par ici — partie solo,
    // tournoi, PvP, missions, arcade, cadeaux. C'est donc le seul endroit où
    // brancher l'annonce du niveau, et il n'y en a pas d'autre à tenir à jour.
    //
    // Le niveau franchi se LIT des deux instantanés, il n'est pas transmis :
    // le serveur ne dit que l'état (`level`, `pending_levels`), le « tu viens
    // de monter » est de l'affichage et reste côté client.
    const from = user.level ?? 1;
    const to = p.level ?? from;
    const crossed = [];
    for (let level = from + 1; level <= to; level++) crossed.push({ key: ++levelToastKey, level });

    set({
      user: {
        ...user,
        level: p.level, xp: p.xp, gold: p.gold, gems: p.gems,
        pending_levels: pending,
      },
      ...(crossed.length ? { levelToasts: [...get().levelToasts, ...crossed] } : {}),
    });
  },

  claimLevels: async () => {
    if (!get().user) return null;
    let data: LevelClaim | null = null;
    try {
      data = await (AuthClient as any).claimLevelRewards();
    } catch {
      return null; // 409 « rien à récupérer » compris : l'écran se recharge
    }
    if (!data) return null;

    get().applyProgression(data.progression);
    // Les cartes livrées entrent dans la collection sans recharger les 398 ids
    // — même geste que shopStore/giftStore après un achat ou un cadeau.
    const cards = data.lines.map(l => l.item).filter(i => i && i.type === 'card').map(i => i!.id);
    if (cards.length) {
      (await import('./collectionStore.js')).useCollectionStore.getState().add(cards);
    }
    return data;
  },

  claimReward: async (reason) => {
    if (!get().user) return;
    try {
      get().applyProgression(await (AuthClient as any).claimReward(reason));
    } catch { /* gain perdu, partie inchangée */ }
  },

  restore: async () => {
    // Le boot ne doit pas attendre le réseau : passé 4 s on débloque l'UI
    // (`ready`) — mais on n'ABANDONNE pas la session pour autant. /auth/me peut
    // dépasser le délai au premier chargement (le serveur est occupé à servir
    // /api/cards) : la réponse tardive est appliquée quand elle arrive, sinon
    // une session valide se dégradait en invité et l'écran Amis affichait
    // « Connecte-toi » (idem Profil).
    const pending: Promise<AuthUser | null> = ((AuthClient as any).me() as Promise<AuthUser | null>)
      .catch(() => null);
    const TIMED_OUT = Symbol('timeout');
    const raced = await Promise.race([
      pending,
      new Promise<typeof TIMED_OUT>((resolve) => setTimeout(() => resolve(TIMED_OUT), 4000)),
    ]);

    if (raced !== TIMED_OUT) {
      set({ user: raced ?? null, ready: true });
      if (raced) { try { await (DeckRepository as any).pull(); } catch { /* hors-ligne */ } }
      return;
    }

    set({ ready: true });
    const late = await pending;
    // Ne pas écraser un login/logout survenu entre-temps.
    if (!late || get().user) return;
    set({ user: late });
    try { await (DeckRepository as any).pull(); } catch { /* hors-ligne */ }
  },

  onAuthenticated: async (user) => {
    set({ user });
    try { await (DeckRepository as any).pull(); } catch { /* hors-ligne */ }
    // Missions du compte fraîchement connecté (l'invité n'en a pas). Import
    // paresseux : missionStore lit authStore, un import statique serait circulaire.
    void (await import('./missionStore.js')).useMissionStore.getState().load(true);
  },

  logout: async () => {
    try { await (DeckRepository as any).flushSync(); } catch { /* best-effort */ }
    try { await (AuthClient as any).logout(); } catch { /* best-effort */ }
    (DeckRepository as any).handleLogout();
    set({ user: null, levelToasts: [] });
    // Le deck actif vit dans DeckRepository (localStorage) ; deckStore n'en est
    // qu'un cache réactif — sans refresh, un écran déjà monté garderait l'ancien
    // deck actif à l'écran jusqu'à son prochain montage.
    (await import('./deckStore.js')).useDeckStore.getState().refresh();
    (await import('./missionStore.js')).useMissionStore.getState().reset();
    // L'offre de boutique est attachée au compte : la garder à l'écran après
    // une déconnexion afficherait les cartes d'un autre joueur.
    (await import('./shopStore.js')).useShopStore.getState().reset();
    // Même raison pour les cosmétiques — et les avatars possédés d'un autre
    // compte ne doivent pas rester sélectionnables au Profil.
    (await import('./cosmeticStore.js')).useCosmeticStore.getState().reset();
    // Et pour les cadeaux — le registre des récupérations est propre au compte.
    (await import('./giftStore.js')).useGiftStore.getState().reset();
    void get();
  },
}));
