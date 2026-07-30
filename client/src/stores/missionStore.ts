/* eslint-disable @typescript-eslint/no-explicit-any */
// missionStore — missions quotidiennes : instantané servi par le serveur + file
// d'événements de la partie en cours.
//
// Le client ne calcule AUCUNE récompense et ne connaît pas le catalogue : il
// nomme des événements (`summon_performed`, `combat_ended`…), le serveur les
// confronte à ses missions et applique son barème. Même règle que
// `authStore.claimReward` — un montant envoyé par le client serait auto-attribué.
//
// La file est vidée EN FIN DE PARTIE, pas au fil de l'eau : un lot = une partie.
// C'est ce qui permet au serveur de dériver lui-même l'anti-concede (≥ 2 combats
// lancés dans le lot) et l'anti-AFK (≥ 1 invocation) au lieu de croire un
// drapeau du client. Effet de bord assumé : les missions n'avancent pas pendant
// qu'on joue — l'écran Missions n'est de toute façon pas visible en partie.
import { create } from 'zustand';
import * as AuthClient from '../data/AuthClient.js';
import { useAuthStore } from './authStore.js';

export interface Mission {
  id: string;
  mission_id: string;
  family: string;
  label: string;
  scope: 'cumulative' | 'single_match' | 'single_combat';
  scope_hint: string | null;
  slot_weight: 1 | 2 | 3;
  progress: number;
  target: number;
  status: 'active' | 'completed';
  rewards: { xp: number; gold: number };
}

export interface WeeklyMilestone {
  points: number;
  rewards: { gold?: number; gems?: number; xp?: number };
  claimed: boolean;
}

export interface MissionSnapshot {
  missions: Mission[];
  /** Les missions tombent par cycles de `hours` heures (3 par cycle). */
  cycle: { count: number; hours: number; max_active: number; next_reset_at: number };
  weekly: { points: number; max: number; milestones: WeeklyMilestone[] };
  reroll: { free_available: boolean; cost: number };
}

/** Toast de complétion — affiché par `MissionToasts`, quel que soit l'écran. */
export interface MissionToast {
  key: number;
  kind: 'mission' | 'milestone';
  label: string;
  rewards: { xp?: number; gold?: number; gems?: number };
}

/** Événement de partie. `combat_index` est posé par le store, pas par l'appelant. */
export interface MissionEvent {
  type: string;
  combat_index?: number;
  [key: string]: unknown;
}

interface MissionStoreState {
  snapshot: MissionSnapshot | null;
  loading: boolean;
  error: string | null;
  toasts: MissionToast[];

  load: (force?: boolean) => Promise<void>;
  reroll: (id: string) => Promise<string | null>;
  dismissToast: (key: number) => void;
  reset: () => void;

  // — File d'événements —
  startMatch: () => void;
  /** Incrémente l'index de combat ET émet `combat_started`. */
  emitCombatStarted: (payload: Record<string, unknown>) => void;
  emit: (type: string, payload?: Record<string, unknown>) => void;
  /** Envoie la file au serveur (fin de partie / sortie de l'écran de jeu). */
  flushMatch: () => Promise<void>;
  /** Événement hors partie (deck enregistré…) — envoyé immédiatement. */
  emitMeta: (type: string, payload?: Record<string, unknown>) => Promise<void>;
}

// État de la partie en cours, hors du store React : ce sont des données de
// travail, aucun composant ne les affiche.
let queue: MissionEvent[] = [];
let matchId: string | null = null;
let combatIndex = -1;
let toastKey = 0;

function newMatchId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

const isGuest = () => !useAuthStore.getState().user;

// Pastille "nouveauté" du bouton Missions du menu principal : même mécanique
// que la Boutique (`hasUnseenShop`/`markShopSeen`) — un simple point, pas un
// compteur, effacé dès que l'écran a été *visité* pour le cycle en cours.
// `next_reset_at` sert de clé de rotation : il est stable pendant tout le
// cycle courant (5h/13h/21h) et change au suivant, comme `day` pour la Boutique.
const seenKey = (userId: string) => `millenium_missions_seen_cycle_${userId}`;

export function hasUnseenMissions(userId: string, nextResetAt: number): boolean {
  try {
    return localStorage.getItem(seenKey(userId)) !== String(nextResetAt);
  } catch {
    return false;
  }
}

export function markMissionsSeen(userId: string, nextResetAt: number): void {
  try {
    localStorage.setItem(seenKey(userId), String(nextResetAt));
  } catch {
    // localStorage indisponible : la pastille resterait affichée en permanence.
  }
}

export const useMissionStore = create<MissionStoreState>((set, get) => ({
  snapshot: null,
  loading: false,
  error: null,
  toasts: [],

  load: async (force = false) => {
    if (isGuest()) { set({ snapshot: null, error: null }); return; }
    if (get().loading || (get().snapshot && !force)) return;
    set({ loading: true, error: null });
    try {
      set({ snapshot: await (AuthClient as any).getMissions() });
    } catch (e: any) {
      set({ error: e?.message ?? 'Missions indisponibles.' });
    } finally {
      set({ loading: false });
    }
  },

  reroll: async (id) => {
    try {
      const data = await (AuthClient as any).rerollMission(id);
      set({ snapshot: pickSnapshot(data) });
      useAuthStore.getState().applyProgression(data.progression);
      return null;
    } catch (e: any) {
      return e?.message ?? 'Reroll impossible.';
    }
  },

  dismissToast: (key) => set(s => ({ toasts: s.toasts.filter(t => t.key !== key) })),

  reset: () => { queue = []; matchId = null; combatIndex = -1; set({ snapshot: null, toasts: [], error: null }); },

  // — File d'événements —

  startMatch: () => {
    queue = [];
    combatIndex = -1;
    matchId = isGuest() ? null : newMatchId();
  },

  emitCombatStarted: (payload) => {
    combatIndex += 1;
    get().emit('combat_started', payload);
  },

  emit: (type, payload = {}) => {
    if (!matchId) return;                       // invité, ou hors partie
    if (queue.length >= MAX_QUEUE) return;      // garde-fou : le serveur plafonne aussi
    queue.push({ ...payload, type, combat_index: Math.max(0, combatIndex) });
  },

  flushMatch: async () => {
    if (!matchId || !queue.length) { queue = []; return; }
    const events = queue;
    const id = matchId;
    queue = [];
    matchId = null;                             // pas de double envoi (fin de partie + démontage)
    try {
      const data = await (AuthClient as any).sendMissionEvents({ matchId: id, events });
      absorb(set, data);
    } catch { /* lot perdu : une partie ne doit jamais échouer sur les missions */ }
  },

  emitMeta: async (type, payload = {}) => {
    if (isGuest()) return;
    try {
      const data = await (AuthClient as any).sendMissionEvents({ matchId: null, events: [{ ...payload, type }] });
      absorb(set, data);
    } catch { /* best-effort */ }
  },
}));

const MAX_QUEUE = 400; // aligné sur MAX_EVENTS_PER_BATCH (missions.js)

function pickSnapshot(data: any): MissionSnapshot {
  return { missions: data.missions, cycle: data.cycle, weekly: data.weekly, reroll: data.reroll };
}

// Réponse d'un envoi d'événements : instantané rafraîchi, solde crédité, toasts.
function absorb(set: (partial: any) => void, data: any): void {
  if (!data) return;
  set((s: MissionStoreState) => ({
    snapshot: data.missions ? pickSnapshot(data) : s.snapshot,
    toasts: [
      ...s.toasts,
      ...(data.completed ?? []).map((c: any) => ({
        key: ++toastKey, kind: 'mission' as const, label: c.label, rewards: c.rewards ?? {},
      })),
      ...(data.milestones ?? []).map((m: any) => ({
        key: ++toastKey, kind: 'milestone' as const,
        label: `Palier hebdomadaire ${m.points} missions`, rewards: m.rewards ?? {},
      })),
    ].slice(-6),
  }));
  useAuthStore.getState().applyProgression(data.progression);
}
