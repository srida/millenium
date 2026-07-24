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
    let user: AuthUser | null = null;
    try {
      user = await Promise.race([
        (AuthClient as any).me() as Promise<AuthUser | null>,
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 4000)),
      ]);
    } catch { user = null; }
    set({ user: user ?? null, ready: true });
    if (user) { try { await (DeckRepository as any).pull(); } catch { /* hors-ligne */ } }
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
