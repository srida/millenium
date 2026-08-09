/* eslint-disable @typescript-eslint/no-explicit-any */
// arcadeStore — mode Arcade : instantané servi par le serveur + actions.
//
// Particularité par rapport à `tournamentStore` : le contrat entre l'écran
// Arcade et l'écran de jeu EST cet instantané, pas un objet posé en mémoire
// avant de naviguer. La run vit côté serveur ; un rechargement de page en plein
// parcours retombe donc sur ses pieds, là où un bracket de tournoi est perdu.
//
// Comme pour la boutique, le client ne tire aucun adversaire et ne calcule
// aucun gain : il rapporte un résultat sur un index de duel et affiche ce que
// le serveur répond.
import { create } from 'zustand';
import * as AuthClient from '../data/AuthClient.js';
import { useAuthStore } from './authStore.js';

/** Handicap plat donné à chaque unité de l'IA sur cet échelon. */
export interface ArcadeBonus {
  hp: number;
  atk: number;
}

export interface ArcadeDuel {
  index: number;
  deck_id: string;
  deck_name: string;
  difficulty: number;
  bonus: ArcadeBonus;
  /** Composition du deck adverse, transportée en clair : elle ne vit pas dans
   *  DeckRepository et l'écran de jeu ne pourrait pas la recharger. */
  deck: Record<string, string[]>;
  result: 'win' | 'loss' | null;
}

export interface ArcadeRun {
  day: string;
  generated_at: number;
  deck_name: string | null;
  /** Index du duel à jouer. */
  current: number;
  status: 'in_progress' | 'won' | 'lost';
  rewarded: boolean;
  duels: ArcadeDuel[];
}

export interface ArcadeSnapshot {
  day: string;
  next_rotation_at: number;
  /** Les échelons et leur handicap, indépendamment de toute run : c'est ce qui
   *  permet d'annoncer le parcours avant d'engager la journée. */
  plan: { index: number; difficulty: number; bonus: ArcadeBonus }[];
  reward: { xp: number; gold: number };
  duel_count: number;
  run: ArcadeRun | null;
}

interface ArcadeStoreState {
  snapshot: ArcadeSnapshot | null;
  loading: boolean;
  busy: boolean;
  error: string | null;
  /** Gain de fin de run tout juste versé, affiché une fois par l'écran. */
  granted: { xp: number; gold: number } | null;

  load: (force?: boolean) => Promise<void>;
  start: (deckName: string | null) => Promise<string | null>;
  reportDuel: (result: 'win' | 'loss') => Promise<string | null>;
  dismissGranted: () => void;
  reset: () => void;
}

const isGuest = () => !useAuthStore.getState().user;

function pickSnapshot(data: any): ArcadeSnapshot {
  return {
    day: data.day,
    next_rotation_at: data.next_rotation_at,
    plan: data.plan ?? [],
    reward: data.reward ?? { xp: 0, gold: 0 },
    duel_count: data.duel_count ?? 0,
    run: data.run ?? null,
  };
}

export const useArcadeStore = create<ArcadeStoreState>((set, get) => ({
  snapshot: null,
  loading: false,
  busy: false,
  error: null,
  granted: null,

  load: async (force = false) => {
    if (isGuest()) { set({ snapshot: null, error: null }); return; }
    if (get().loading || (get().snapshot && !force)) return;
    set({ loading: true, error: null });
    try {
      const data = await (AuthClient as any).getArcade();
      set({ snapshot: pickSnapshot(data) });
      useAuthStore.getState().applyProgression(data.progression);
    } catch (e: any) {
      set({ error: e?.message ?? 'Arcade indisponible.' });
    } finally {
      set({ loading: false });
    }
  },

  start: async (deckName) => {
    if (get().busy) return null;
    set({ busy: true });
    try {
      const data = await (AuthClient as any).startArcade(deckName);
      set({ snapshot: pickSnapshot(data) });
      useAuthStore.getState().applyProgression(data.progression);
      return null;
    } catch (e: any) {
      // 409 = la run du jour existe déjà (autre onglet, autre appareil) : on la
      // recharge pour que le joueur voie où il en est plutôt qu'une erreur.
      if (e?.status === 409) void get().load(true);
      return e?.message ?? 'Impossible de lancer la run.';
    } finally {
      set({ busy: false });
    }
  },

  /**
   * Solde le duel courant. L'index est lu dans l'instantané, jamais choisi par
   * l'appelant : le serveur refuse de toute façon un rapport hors séquence.
   */
  reportDuel: async (result) => {
    const run = get().snapshot?.run;
    if (!run || run.status !== 'in_progress') return null;
    if (get().busy) return null;
    set({ busy: true });
    try {
      const data = await (AuthClient as any).reportArcadeDuel({ index: run.current, result });
      set({ snapshot: pickSnapshot(data), granted: data.granted ?? null });
      useAuthStore.getState().applyProgression(data.progression);
      return null;
    } catch (e: any) {
      if (e?.status === 409) void get().load(true);
      return e?.message ?? 'Résultat non enregistré.';
    } finally {
      set({ busy: false });
    }
  },

  dismissGranted: () => set({ granted: null }),
  reset: () => set({ snapshot: null, granted: null, error: null }),
}));

/** Duel à jouer, ou `null` s'il n'y a pas de run en cours. */
export function currentDuel(snapshot: ArcadeSnapshot | null): ArcadeDuel | null {
  const run = snapshot?.run;
  if (!run || run.status !== 'in_progress') return null;
  return run.duels[run.current] ?? null;
}

/** Duels remportés — le score affiché en fin de parcours. */
export function wonCount(run: ArcadeRun | null): number {
  return (run?.duels ?? []).filter(d => d.result === 'win').length;
}
