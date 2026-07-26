/* eslint-disable @typescript-eslint/no-explicit-any */
// authStore — état de session (compte online). L'auth est OPTIONNELLE (D2) : le
// jeu se joue en invité (decks en localStorage) ; se connecter active la
// synchronisation serveur des decks (DeckRepository.pull/flushSync).
import { create } from 'zustand';
import * as AuthClient from '../data/AuthClient.js';
import * as DeckRepository from '../data/DeckRepository.js';

export interface AuthUser { id: string; username: string; email?: string; avatar?: string | null }

interface AuthStoreState {
  user: AuthUser | null;
  ready: boolean;                       // me() a répondu (ou timeout) au moins une fois
  setUser: (u: AuthUser | null) => void;
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
  },

  logout: async () => {
    try { await (DeckRepository as any).flushSync(); } catch { /* best-effort */ }
    try { await (AuthClient as any).logout(); } catch { /* best-effort */ }
    (DeckRepository as any).handleLogout();
    set({ user: null });
    void get();
  },
}));
