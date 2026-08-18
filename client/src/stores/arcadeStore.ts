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
//
// ⚠️ DEUX ÉCRITURES CONCURRENTES SUR LE MÊME INSTANTANÉ. Le rapport de duel
// (POST) et la relecture d'écran (GET) partent d'endroits différents et se
// croisent : sortir d'un duel rapporte le résultat PUIS navigue vers l'écran
// Arcade, qui recharge à son tour. Rien ne garantit l'ordre des RÉPONSES — un
// GET parti avant que le POST ne soit commis rapporte la run d'AVANT le duel.
// S'il s'applique en dernier, le joueur voit son duel gagné redevenir « à
// jouer » : il le rejoue, et son second rapport est refusé en 409 (le serveur,
// lui, avait bien avancé) — d'où la victoire « perdue » puis le score de la
// partie PRÉCÉDENTE qui compte. C'est le bug de désynchro, et il se ferme des
// deux côtés :
//
//   1. `revision` — toute réponse de MUTATION incrémente un compteur ; une
//      lecture partie avant est jetée à son retour au lieu d'écraser plus
//      frais qu'elle. Une lecture jetée ne coûte rien : les deux routes
//      renvoient le MÊME instantané complet.
//   2. l'appelant ATTEND le rapport avant de naviguer (`GameScreen`), pour que
//      le GET de l'écran Arcade parte après le commit serveur.
//
// La (2) seule ne suffirait pas — deux onglets, un retour navigateur ou le
// rechargement du menu principal recroisent les requêtes sans passer par là.
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
  /**
   * Dernier rapport de duel qui n'est PAS arrivé au serveur (coupure réseau).
   * Distinct d'`error`, que la relecture de l'écran remet à zéro : un rapport
   * perdu doit rester dit, sinon le joueur retrouve son duel « à jouer » sans
   * savoir pourquoi. L'état affiché reste juste — il vient du serveur — mais
   * il contredit ce que le joueur vient de vivre, et ça se nomme.
   */
  reportError: string | null;

  load: (force?: boolean) => Promise<void>;
  start: (deckName: string | null) => Promise<string | null>;
  reportDuel: (result: 'win' | 'loss') => Promise<string | null>;
  dismissGranted: () => void;
  dismissReportError: () => void;
  reset: () => void;
}

const isGuest = () => !useAuthStore.getState().user;

/**
 * Compteur d'instantanés issus d'une MUTATION (start, rapport de duel). Hors du
 * store à dessein : c'est une horloge interne, pas un état à rendre — même
 * statut que `levelToastKey` dans authStore.
 */
let revision = 0;

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
  reportError: null,

  load: async (force = false) => {
    if (isGuest()) { set({ snapshot: null, error: null }); return; }
    if (get().loading || (get().snapshot && !force)) return;
    // Photographie de l'horloge AVANT la requête : si une mutation aboutit
    // pendant qu'elle est en vol, sa réponse est plus fraîche que la nôtre.
    const seen = revision;
    set({ loading: true, error: null });
    try {
      const data = await (AuthClient as any).getArcade();
      if (revision !== seen) return;   // une mutation est passée devant — on jette
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
      revision++;
      set({ snapshot: pickSnapshot(data), reportError: null });
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
    set({ busy: true, reportError: null });
    try {
      const data = await (AuthClient as any).reportArcadeDuel({ index: run.current, result });
      revision++;
      set({ snapshot: pickSnapshot(data), granted: data.granted ?? null });
      useAuthStore.getState().applyProgression(data.progression);
      return null;
    } catch (e: any) {
      const message = e?.message ?? 'Résultat non enregistré.';
      // 409 = le serveur a déjà soldé ce duel (rapport rejoué, autre onglet) :
      // son état fait foi, on le relit. Ce n'est PAS un rapport perdu.
      if (e?.status === 409) { void get().load(true); return message; }
      // Tout le reste — réseau coupé en premier lieu — laisse le duel encore à
      // jouer côté serveur. On le dit plutôt que de laisser le joueur croire
      // que sa victoire s'est évaporée.
      set({ reportError: message });
      return message;
    } finally {
      set({ busy: false });
    }
  },

  dismissGranted: () => set({ granted: null }),
  dismissReportError: () => set({ reportError: null }),
  reset: () => set({ snapshot: null, granted: null, error: null, reportError: null }),
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
