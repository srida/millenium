/* eslint-disable @typescript-eslint/no-explicit-any */
// challengeStore — défis entre amis (lancer un duel en ligne contre une cible
// précise, cf. challenges.js côté serveur). Un seul point de poll, partagé par
// `ChallengeBanner` (bannière globale, accepter/refuser) et `ProfileScreen`
// (bouton « Défier », état par ami) — deux composants qui n'ont pas à ouvrir
// chacun leur propre intervalle.
//
// ⚠️ Accepter un défi ne crée PAS le match : ça bascule seulement son statut
// côté serveur. Les DEUX joueurs doivent ensuite ouvrir leur WebSocket PvP et
// envoyer `challenge:join` (cf. ws/ChallengeQueue.js) — l'accepteur tout de
// suite après son propre appel `accept()`, le défieur dès qu'il OBSERVE dans
// son propre poll que son défi sortant est passé à `accepted`. C'est ce
// module qui porte les deux déclenchements, pour qu'ils ne divergent pas.
import { create } from 'zustand';
import * as AuthClient from '../data/AuthClient.js';
import * as PvpConnection from '../net/PvpConnection.js';
import * as DeckRepository from '../data/DeckRepository.js';

export interface ChallengeUserRef { id: string; username?: string; tag?: number; avatar?: string | null }
export interface IncomingChallenge { id: string; from: ChallengeUserRef; created_at: number; expires_at: number }
export type OutgoingStatus = 'pending' | 'accepted' | 'declined' | 'cancelled' | 'expired';
export interface OutgoingChallenge { id: string; to: ChallengeUserRef; status: OutgoingStatus; created_at: number; expires_at: number }

const POLL_MS = 4000;

/**
 * Ouvre la socket PvP (si besoin) et envoie `challenge:join` — le même geste
 * pour les deux joueurs, à deux moments différents (cf. en-tête du fichier).
 * Best-effort, comme `OnlineLobby.search()` : une erreur ici n'a pas d'autre
 * recours qu'un nouveau défi.
 */
async function joinChallenge(challengeId: string) {
  const deckName = ((DeckRepository as any).getActiveDeck?.() as string | null) ?? null;
  await (PvpConnection as any).connect();
  // Le serveur lit SA copie du deck (variantes, attributs dominants) — une
  // synchro debouncée à 500 ms pourrait ne pas l'avoir reçue à temps, même
  // raison que `OnlineLobby.search()`.
  await (DeckRepository as any).flushSync?.();
  (PvpConnection as any).send('challenge:join', { challengeId, deckName });
}

interface ChallengeStoreState {
  incoming: IncomingChallenge[];
  outgoing: OutgoingChallenge[];
  /** Dernier événement terminal (refusé/annulé/expiré) observé côté défieur —
   *  un aller simple : l'affichage l'efface avec `dismissOutcome`. */
  lastOutcome: { status: OutgoingStatus; to: ChallengeUserRef } | null;
  error: string | null;
  start: () => void;
  stop: () => void;
  send: (friendId: string) => Promise<{ ok: boolean; reason?: string }>;
  accept: (id: string) => Promise<{ ok: boolean; reason?: string }>;
  decline: (id: string) => Promise<void>;
  cancel: (id: string) => Promise<void>;
  dismissOutcome: () => void;
}

let timer: ReturnType<typeof setInterval> | null = null;
// Défis sortants pour lesquels `challenge:join` est déjà parti — sans ce
// registre, chaque tick de poll qui revoit encore le statut `accepted`
// (jusqu'à ce que le match soit trouvé ou que la ligne expire) renverrait le
// message, ce qui ne casse rien côté serveur (idempotent) mais spamme la
// socket pour rien.
const joinedOutgoing = new Set<string>();

/**
 * Un seul poll, appelable directement (après une mutation, pour un
 * rafraîchissement immédiat) OU depuis l'intervalle — sans que l'un déclenche
 * l'autre. Prend `set`/`get` du store en paramètre plutôt que de fermer
 * dessus : évite de recréer la fonction (et donc de perdre la référence dont
 * `start()` a besoin pour armer `setInterval`) à chaque appel.
 */
async function poll(set: (partial: Partial<ChallengeStoreState>) => void, get: () => ChallengeStoreState) {
  // Un onglet en arrière-plan n'a rien à guetter tout de suite — même esprit
  // que `app/pwaUpdate.ts`, qui ne réinterroge pas non plus une page cachée.
  if (typeof document !== 'undefined' && document.hidden) return;
  try {
    const { incoming, outgoing } = await (AuthClient as any).getChallenges();

    // Le défi sortant qui vient de passer à `accepted` : c'est le signal que
    // le DÉFIEUR guette pour rejoindre à son tour.
    for (const row of outgoing as OutgoingChallenge[]) {
      if (row.status === 'accepted' && !joinedOutgoing.has(row.id)) {
        joinedOutgoing.add(row.id);
        void joinChallenge(row.id);
      }
    }

    // Un défi sortant qui a DISPARU depuis le tour précédent sans être passé
    // par `accepted`+jointure n'a rien à raconter côté défieur : soit un match
    // a été trouvé (`markMatched` a supprimé la ligne, `match:found` s'en
    // charge), soit `ChallengeQueue` l'a purgée après un `join_timeout` (le
    // défieur l'apprend directement par le message WS `challenge:join_failed`).
    // Les statuts TERMINAUX (refusé/annulé/expiré), eux, sont rendus UNE fois
    // par le serveur (lecture-qui-efface, cf. `challenges.listOutgoing`) : ils
    // sont donc forcément dans CE tour-ci, jamais dans un précédent.
    const outcome = (outgoing as OutgoingChallenge[]).find(
      r => r.status === 'declined' || r.status === 'cancelled' || r.status === 'expired',
    );

    set({
      incoming, outgoing,
      lastOutcome: outcome ? { status: outcome.status, to: outcome.to } : get().lastOutcome,
      error: null,
    });
    // Un défi qui a quitté la liste sortante n'a plus besoin de son entrée de
    // déduplication.
    const stillOutgoing = new Set((outgoing as OutgoingChallenge[]).map(r => r.id));
    for (const id of joinedOutgoing) if (!stillOutgoing.has(id)) joinedOutgoing.delete(id);
  } catch (e: any) {
    // Best-effort : une panne réseau ponctuelle ne doit pas casser l'affichage
    // courant, seulement être visible si elle persiste.
    set({ error: e?.message ?? 'Erreur réseau.' });
  }
}

export const useChallengeStore = create<ChallengeStoreState>((set, get) => ({
  incoming: [],
  outgoing: [],
  lastOutcome: null,
  error: null,

  start: () => {
    if (timer) return;
    void poll(set, get);
    timer = setInterval(() => void poll(set, get), POLL_MS);
  },

  stop: () => {
    if (timer) { clearInterval(timer); timer = null; }
    joinedOutgoing.clear();
    set({ incoming: [], outgoing: [], lastOutcome: null, error: null });
  },

  send: async (friendId) => {
    try {
      await (AuthClient as any).challengeFriend(friendId);
      return { ok: true };
    } catch (e: any) {
      return { ok: false, reason: e?.reason ?? e?.message };
    } finally {
      // Fait apparaître l'entrée sortante tout de suite, sans attendre le
      // prochain tick de l'intervalle — le bouton « Défier » doit se
      // désactiver aussitôt. Un appel direct à `poll`, PAS à `start()` : le
      // timer tourne déjà (démarré par `ChallengeBanner` à la connexion), et
      // `start()` n'aurait rien fait de plus qu'un no-op.
      void poll(set, get);
    }
  },

  accept: async (id) => {
    try {
      await (AuthClient as any).acceptChallenge(id);
      await joinChallenge(id);
      return { ok: true };
    } catch (e: any) {
      return { ok: false, reason: e?.reason ?? e?.message };
    }
  },

  decline: async (id) => {
    try { await (AuthClient as any).declineChallenge(id); } catch { /* best-effort */ }
    set({ incoming: get().incoming.filter(c => c.id !== id) });
  },

  cancel: async (id) => {
    try { await (AuthClient as any).cancelChallenge(id); } catch { /* best-effort */ }
    set({ outgoing: get().outgoing.filter(c => c.id !== id) });
  },

  dismissOutcome: () => set({ lastOutcome: null }),
}));
