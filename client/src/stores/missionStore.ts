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
import { createSnapshotChannel, isGuest } from './snapshotLoader.js';

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
  /** `completed` = terminée, gain EN ATTENTE ; `claimed` = gain récupéré. */
  status: 'active' | 'completed' | 'claimed';
  rewards: { xp: number; gold: number };
}

export interface WeeklyMilestone {
  points: number;
  rewards: { gold?: number; gems?: number; xp?: number };
  claimed: boolean;
}

export interface MissionSnapshot {
  missions: Mission[];
  /** Les missions tombent par cycles de `hours` heures (`count` par cycle). */
  cycle: { count: number; hours: number; max_active: number; next_reset_at: number };
  weekly: { points: number; max: number; milestones: WeeklyMilestone[] };
  reroll: { free_available: boolean; cost: number };
}

/** Toast de complétion — affiché par `RewardToasts`, quel que soit l'écran. */
export interface MissionToast {
  key: number;
  /** Les deux annoncent un gain À RÉCUPÉRER : mission terminée, palier atteint. */
  kind: 'mission' | 'milestone';
  label: string;
  rewards: { xp?: number; gold?: number; gems?: number };
}

/** Missions terminées dont le gain attend un tap — dérivé, jamais transmis. */
export function claimableMissions(snapshot: MissionSnapshot | null): number {
  return snapshot ? snapshot.missions.filter(m => m.status === 'completed').length : 0;
}

/**
 * Paliers ATTEINTS et pas encore récupérés. `reached` se déduit du nombre de
 * points : le serveur n'envoie que `claimed`, le reste se calcule — une valeur
 * dérivée qu'on transporte est une valeur qui peut contredire sa source.
 */
export function claimableMilestones(snapshot: MissionSnapshot | null): number {
  if (!snapshot) return 0;
  return snapshot.weekly.milestones.filter(m => !m.claimed && snapshot.weekly.points >= m.points).length;
}

/** Tous gains confondus — c'est ce que compte la pastille verte du menu. */
export function claimableCount(snapshot: MissionSnapshot | null): number {
  return claimableMissions(snapshot) + claimableMilestones(snapshot);
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
  /** Solde une mission terminée → message d'erreur, ou `null` si le gain est tombé. */
  claim: (id: string) => Promise<string | null>;
  /** Solde un palier hebdomadaire atteint, désigné par son nombre de points. */
  claimMilestone: (points: number) => Promise<string | null>;
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

// ⚠️ `applyProgression: false` — contrairement aux quatre autres domaines, la
// route de LECTURE des missions ne porte pas de bloc `progression` ; l'appeler
// écraserait le solde du joueur avec `undefined`. Les mutations, elles, en
// portent bien un, et `absorb` s'en charge.
const channel = createSnapshotChannel<MissionSnapshot>({
  fetch: () => (AuthClient as any).getMissions(),
  pick: (data: any) => data as MissionSnapshot,
  errorLabel: 'Missions indisponibles.',
  applyProgression: false,
});

export const useMissionStore = create<MissionStoreState>((set, get) => ({
  snapshot: null,
  loading: false,
  error: null,
  toasts: [],

  load: channel.load(set, get),

  claim: async (id) => {
    try {
      // `absorb` fait tout : instantané (donc la jauge hebdo avance à l'écran),
      // solde, et toast des paliers ATTEINTS par ce tap (à récupérer à leur tour).
      absorb(set, await (AuthClient as any).claimMission(id));
      return null;
    } catch (e: any) {
      // L'instantané peut être en retard (mission déjà soldée dans un autre
      // onglet) : on le relit plutôt que de laisser un bouton qui ment.
      void get().load(true);
      if (e?.status === 404) return STALE_SERVER;
      return e?.message ?? 'Récupération impossible.';
    }
  },

  claimMilestone: async (points) => {
    try {
      absorb(set, await (AuthClient as any).claimMissionMilestone(points));
      return null;
    } catch (e: any) {
      void get().load(true);
      if (e?.status === 404) return STALE_SERVER;
      return e?.message ?? 'Récupération impossible.';
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

// Un 404 sur une route de récupération ne veut pas dire « introuvable » (le
// serveur répond 400 dans ce cas) mais « la ROUTE n'existe pas » : client à
// jour devant un serveur qui ne l'est pas.
const STALE_SERVER = 'Serveur pas à jour : la récupération des gains n\'existe pas encore de son côté (redémarre-le).';

function pickSnapshot(data: any): MissionSnapshot {
  return { missions: data.missions, cycle: data.cycle, weekly: data.weekly, reroll: data.reroll };
}

// Réponse d'un envoi d'événements OU d'une récupération : instantané rafraîchi,
// solde crédité, toasts. Les deux réponses partagent la même forme — `completed`
// (missions terminées, gain en attente) et `milestones` (paliers déjà crédités)
// sont simplement absents de l'une ou de l'autre.
function absorb(set: (partial: any) => void, data: any): void {
  if (!data) return;
  channel.bump();
  set((s: MissionStoreState) => ({
    snapshot: data.missions ? pickSnapshot(data) : s.snapshot,
    toasts: [
      ...s.toasts,
      ...(data.completed ?? []).map((c: any) => ({
        key: ++toastKey, kind: 'mission' as const, label: c.label, rewards: c.rewards ?? {},
      })),
      ...(data.unlocked ?? []).map((m: any) => ({
        key: ++toastKey, kind: 'milestone' as const,
        label: `Palier hebdomadaire ${m.points} missions`, rewards: m.rewards ?? {},
      })),
    ].slice(-6),
  }));
  useAuthStore.getState().applyProgression(data.progression);
}
