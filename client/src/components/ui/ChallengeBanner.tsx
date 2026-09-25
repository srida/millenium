/* eslint-disable @typescript-eslint/no-explicit-any */
// ChallengeBanner — notification GLOBALE d'un défi entre amis. Montée au
// niveau de l'App (comme RewardToasts), pas d'un écran : un ami peut défier à
// tout moment, et l'expiration est courte (challenges.CHALLENGE_TTL_MS) — un
// défi qui n'était visible que sur ProfileScreen expirerait le plus souvent
// sans que la cible ne l'ait jamais vu.
//
// ⚠️ Non affichée pendant une partie en cours (`game`/`game_pvp`) : le plateau
// n'a pas à voir surgir une invitation par-dessus lui, même règle que
// `RewardToasts`. Le polling, lui, continue en arrière-plan (challengeStore) —
// seul le rendu s'efface, sinon un défi arrivant en fin de combat expirerait
// avant que le joueur ne revienne au menu.
//
// ⚠️ Recoupement assumé et non traité : si ce composant ET `OnlineLobby` sont
// tous deux à l'écoute de `match:found` (le joueur est sur l'écran Duel en
// ligne ET a un défi en cours de jointure), les deux navigueront — sans
// dommage (idempotent), mais ce n'est pas un cas qui a été spécifiquement
// arbitré.
import { useEffect, useRef, useState } from 'react';
import { useAuthStore } from '../../stores/authStore.js';
import { useUiStore } from '../../stores/uiStore.js';
import { useChallengeStore, type IncomingChallenge } from '../../stores/challengeStore.js';
import * as PvpConnection from '../../net/PvpConnection.js';
import { Avatar, Button } from './primitives.js';

// Le toast d'issue (refusé/annulé/expiré) reste visible le temps de le lire,
// comme les autres notifications transitoires du jeu (RewardToasts : 3 s).
const OUTCOME_MS = 4000;

const OUTCOME_LABEL: Record<string, string> = {
  declined: 'a refusé ton défi.',
  cancelled: 'défi annulé.',
  expired: 'défi expiré, sans réponse.',
};

export default function ChallengeBanner() {
  const user = useAuthStore(s => s.user);
  const screen = useUiStore(s => s.screen);
  const navigate = useUiStore(s => s.navigate);
  const incoming = useChallengeStore(s => s.incoming);
  const lastOutcome = useChallengeStore(s => s.lastOutcome);
  const dismissOutcome = useChallengeStore(s => s.dismissOutcome);
  const accept = useChallengeStore(s => s.accept);
  const decline = useChallengeStore(s => s.decline);
  const start = useChallengeStore(s => s.start);
  const stop = useChallengeStore(s => s.stop);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [joinError, setJoinError] = useState<string | null>(null);

  // Le poll suit la SESSION, pas le montage du composant (monté une fois pour
  // toute la vie de l'app) : `userId`, jamais l'objet `user` — une réponse qui
  // produirait un `user` neuf sans rien changer relancerait la boucle pour
  // rien (même piège que documenté pour les quatre effets d'instantané du menu).
  const userId = user?.id;
  useEffect(() => {
    if (!userId) { stop(); return; }
    start();
  }, [userId, start, stop]);

  // Le match d'un défi accepté arrive comme n'importe quel `match:found` — le
  // trajet exact d'OnlineLobby, en plus léger (pas de présentation de 3 s : ce
  // widget n'est pas un écran plein cadre).
  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;
  useEffect(() => {
    const onFound = () => navigateRef.current('game_pvp', {});
    const onJoinFailed = (msg: any) => {
      setBusyId(null);
      setJoinError(
        msg?.reason === 'opponent_disconnected' ? 'Ton ami s\'est déconnecté.' : 'Le duel n\'a pas pu démarrer.',
      );
    };
    PvpConnection.on('match:found', onFound);
    PvpConnection.on('challenge:join_failed', onJoinFailed);
    return () => {
      PvpConnection.off('match:found', onFound);
      PvpConnection.off('challenge:join_failed', onJoinFailed);
    };
  }, []);

  useEffect(() => {
    if (!lastOutcome) return;
    const t = setTimeout(dismissOutcome, OUTCOME_MS);
    return () => clearTimeout(t);
  }, [lastOutcome, dismissOutcome]);

  useEffect(() => {
    if (!joinError) return;
    const t = setTimeout(() => setJoinError(null), OUTCOME_MS);
    return () => clearTimeout(t);
  }, [joinError]);

  if (!user) return null;
  // Immersif : pas de bannière pendant une partie (cf. en-tête).
  if (screen === 'game' || screen === 'game_pvp') return null;

  async function handleAccept(c: IncomingChallenge) {
    setBusyId(c.id);
    setJoinError(null);
    const res = await accept(c.id);
    if (!res.ok) {
      setBusyId(null);
      setJoinError(
        res.reason === 'busy' ? 'Un des deux joueurs est déjà en duel.'
          : res.reason === 'expired' ? 'Ce défi a expiré.'
          : 'Impossible d\'accepter ce défi.',
      );
    }
    // En cas de succès, `busyId` reste posé jusqu'à `match:found` (navigation)
    // ou `challenge:join_failed` (ci-dessus) : le bouton doit rester figé
    // pendant la jointure, pas se redevenir tapable dans le vide.
  }

  if (!incoming.length && !lastOutcome && !joinError) return null;

  return (
    <div className="pointer-events-none fixed left-1/2 top-[max(4rem,calc(env(safe-area-inset-top)+3.5rem))] z-50 flex w-[min(22rem,calc(100vw-1.5rem))] -translate-x-1/2 flex-col gap-2">
      {incoming.map(c => {
        const name = c.from.username ?? 'Un ami';
        const busy = busyId === c.id;
        return (
          <div
            key={c.id}
            className="pointer-events-auto flex items-center gap-3 rounded-xl border border-gold/50 bg-surface/95 p-3 shadow-lg backdrop-blur"
          >
            <Avatar src={c.from.avatar} fallback={name.slice(0, 2).toUpperCase()} className="h-10 w-10 border-gold/60" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-white">
                {name}{c.from.tag != null && <span className="text-white/40"> #{c.from.tag}</span>} te défie ⚔️
              </p>
              <p className="text-[11px] text-white/50">Duel en ligne</p>
            </div>
            <div className="flex shrink-0 gap-1.5">
              <Button
                variant="primary" className="px-3 py-1.5 text-xs" disabled={busy}
                onPointerDown={() => { void handleAccept(c); }}
              >
                {busy ? '…' : 'Accepter'}
              </Button>
              <Button
                variant="danger" className="px-3 py-1.5 text-xs" disabled={busy}
                onPointerDown={() => { void decline(c.id); }}
              >
                ✕
              </Button>
            </div>
          </div>
        );
      })}

      {lastOutcome && (
        <div className="pointer-events-none flex items-center gap-2 self-center rounded-lg border border-line bg-surface/90 px-3 py-1.5 text-xs text-white/70 shadow backdrop-blur">
          <span>{lastOutcome.to.username ?? 'Ton ami'} {OUTCOME_LABEL[lastOutcome.status] ?? ''}</span>
        </div>
      )}
      {joinError && (
        <div className="pointer-events-none flex items-center gap-2 self-center rounded-lg border border-danger/50 bg-surface/90 px-3 py-1.5 text-xs text-danger shadow backdrop-blur">
          <span>{joinError}</span>
        </div>
      )}
    </div>
  );
}
