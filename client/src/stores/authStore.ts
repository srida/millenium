/* eslint-disable @typescript-eslint/no-explicit-any */
// authStore — état de session (compte online). L'auth est OPTIONNELLE (D2) : le
// jeu se joue en invité (decks en localStorage) ; se connecter active la
// synchronisation serveur des decks (DeckRepository.pull/flushSync).
import { create } from 'zustand';
import * as AuthClient from '../data/AuthClient.js';
import * as DeckRepository from '../data/DeckRepository.js';

export interface AuthUser {
  id: string; username: string; email?: string; avatar?: string | null; is_admin?: boolean;
  /** Progression — servie par publicUser() ; la collection est sur /api/me/progression. */
  level?: number; xp?: number; gold?: number; gems?: number;
}

/** Progression renvoyée par le serveur (barème et courbe de niveau côté serveur). */
export interface Progression { level: number; xp: number; xp_per_level?: number; gold: number; gems: number }

interface AuthStoreState {
  user: AuthUser | null;
  ready: boolean;                       // me() a répondu (ou timeout) au moins une fois
  setUser: (u: AuthUser | null) => void;
  /** Fusionne une progression fraîche dans l'utilisateur courant (no-op en invité). */
  applyProgression: (p: Progression | null | undefined) => void;
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

export const useAuthStore = create<AuthStoreState>((set, get) => ({
  user: null,
  ready: false,
  setUser: (user) => set({ user }),

  applyProgression: (p) => {
    if (!p) return;
    const user = get().user;
    if (!user) return;
    set({ user: { ...user, level: p.level, xp: p.xp, gold: p.gold, gems: p.gems } });
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
    set({ user: null });
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
