/* eslint-disable @typescript-eslint/no-explicit-any */
// OnlineLobby — matchmaking du Duel en ligne. Connecte le WebSocket, rejoint la
// file avec le deck actif, et navigue vers l'écran de jeu PvP dès qu'un match
// est trouvé. Le combat lui-même vit dans GameScreenPvp / PvpController.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import * as PvpConnection from '../net/PvpConnection.js';
import * as DeckRepository from '../data/DeckRepository.js';
import { useAuthStore } from '../stores/authStore.js';
import { useUiStore } from '../stores/uiStore.js';
import { Button } from '../components/ui/primitives.js';

type Status = 'idle' | 'connecting' | 'searching' | 'found' | 'error';

export default function OnlineLobby() {
  const navigate = useUiStore(s => s.navigate);
  const user = useAuthStore(s => s.user);
  const [status, setStatus] = useState<Status>('idle');
  const [error, setError] = useState<string | null>(null);
  const [opponent, setOpponent] = useState<string | null>(null);
  const startedRef = useRef(false);

  const deckName = (DeckRepository as any).getActiveDeck?.() as string | null;
  const hasDeck = !!deckName && !!(DeckRepository as any).loadDeck?.(deckName);

  useEffect(() => {
    const onFound = (msg: any) => {
      setOpponent(msg?.opponent?.username ?? 'Adversaire');
      setStatus('found');
      // Petit délai pour afficher « adversaire trouvé » avant de basculer.
      setTimeout(() => navigate('game_pvp', { deckName: deckName ?? undefined }), 700);
    };
    PvpConnection.on('match:found', onFound);
    return () => {
      PvpConnection.off('match:found', onFound);
      // Si on quitte sans match trouvé, on sort de la file et on ferme la socket.
      if (status !== 'found') { try { PvpConnection.send('queue:leave'); } catch { /* noop */ } }
    };
  }, [deckName, navigate, status]);

  async function search() {
    if (startedRef.current) return;
    startedRef.current = true;
    setError(null);
    setStatus('connecting');
    try {
      await (PvpConnection as any).connect();
      setStatus('searching');
      (PvpConnection as any).send('queue:join', { deckName });
    } catch (e: any) {
      setError(e?.message ?? 'Connexion impossible.');
      setStatus('error');
      startedRef.current = false;
    }
  }

  function cancel() {
    try { (PvpConnection as any).send('queue:leave'); } catch { /* noop */ }
    (PvpConnection as any).disconnect();
    navigate('main_menu');
  }

  if (!user) {
    return (
      <Center>
        <p className="text-sm text-white/60">Connecte-toi pour jouer en ligne.</p>
        <Button variant="primary" onPointerDown={() => navigate('auth')}>Se connecter</Button>
        <Button onPointerDown={() => navigate('main_menu')}>◂ Menu</Button>
      </Center>
    );
  }

  if (!hasDeck) {
    return (
      <Center>
        <p className="text-sm text-white/60">Choisis un deck actif avant de chercher un duel.</p>
        <Button variant="primary" onPointerDown={() => navigate('deck_selector')}>Choisir un deck</Button>
        <Button onPointerDown={() => navigate('main_menu')}>◂ Menu</Button>
      </Center>
    );
  }

  return (
    <Center>
      <div className="text-5xl">⚔️</div>
      <h1 className="text-xl font-bold tracking-wide text-gold">Duel en ligne</h1>
      <p className="text-xs text-white/50">Deck : {deckName}</p>

      {status === 'idle' && (
        <Button variant="primary" className="px-8 py-3" onPointerDown={search}>Chercher un adversaire</Button>
      )}
      {(status === 'connecting' || status === 'searching') && (
        <>
          <p className="animate-pulse text-sm text-white/70">
            {status === 'connecting' ? 'Connexion…' : 'Recherche d\'un adversaire…'}
          </p>
          <Button onPointerDown={cancel}>Annuler</Button>
        </>
      )}
      {status === 'found' && <p className="text-sm text-success">Adversaire trouvé : {opponent} !</p>}
      {status === 'error' && (
        <>
          <p className="text-sm text-danger">{error}</p>
          <Button onPointerDown={() => { setStatus('idle'); }}>Réessayer</Button>
          <Button onPointerDown={() => navigate('main_menu')}>◂ Menu</Button>
        </>
      )}
    </Center>
  );
}

function Center({ children }: { children: ReactNode }) {
  return <main className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-surface p-6 text-center text-white">{children}</main>;
}
