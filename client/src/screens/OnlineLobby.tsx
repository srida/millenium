/* eslint-disable @typescript-eslint/no-explicit-any */
// OnlineLobby — matchmaking du Duel en ligne. Connecte le WebSocket, rejoint la
// file avec le deck engagé, et navigue vers l'écran de jeu PvP dès qu'un match
// est trouvé. Le combat lui-même vit dans GameScreenPvp / PvpController.
//
// Le deck n'est PAS choisi ici : c'est le deck actif, choisi au menu principal
// (« Mes decks ») ; ce lobby n'en affiche que le récap (SelectedDeck).
import { useEffect, useRef, useState, type ReactNode } from 'react';
import * as PvpConnection from '../net/PvpConnection.js';
import * as DeckRepository from '../data/DeckRepository.js';
import { useAuthStore } from '../stores/authStore.js';
import { useUiStore } from '../stores/uiStore.js';
import { Button } from '../components/ui/primitives.js';
import SelectedDeck from '../components/deck/SelectedDeck.js';

type Status = 'idle' | 'connecting' | 'searching' | 'found' | 'error';

export default function OnlineLobby() {
  const navigate = useUiStore(s => s.navigate);
  const user = useAuthStore(s => s.user);
  const [status, setStatus] = useState<Status>('idle');
  const [error, setError] = useState<string | null>(null);
  const [opponent, setOpponent] = useState<string | null>(null);
  const startedRef = useRef(false);
  const foundRef = useRef(false);

  // Deck engagé dans le duel = deck actif (choisi au menu). Il part dans
  // `queue:join`, puis sert à bâtir la session PvP.
  const deckName = ((DeckRepository as any).getActiveDeck?.() as string | null) ?? null;
  const hasDeck = !!deckName && !!(DeckRepository as any).loadDeck?.(deckName);
  // Lu via ref pour que le handler `onFound` (abonné une seule fois au montage)
  // utilise toujours la valeur à jour sans re-déclencher l'effet.
  const deckRef = useRef(deckName);
  deckRef.current = deckName;

  // Abonnement au match + sortie de file : MONTAGE/DÉMONTAGE uniquement.
  // Ne jamais dépendre de `status` ici : un re-run de l'effet enverrait
  // `queue:leave` dans son cleanup juste après `queue:join`, ce qui nous
  // retirait aussitôt de la file (aucun match ne pouvait alors se former).
  useEffect(() => {
    const onFound = (msg: any) => {
      foundRef.current = true;
      setOpponent(msg?.opponent?.username ?? 'Adversaire');
      setStatus('found');
      // Petit délai pour afficher « adversaire trouvé » avant de basculer.
      setTimeout(() => navigate('game_pvp', { deckName: deckRef.current ?? undefined }), 700);
    };
    PvpConnection.on('match:found', onFound);
    return () => {
      PvpConnection.off('match:found', onFound);
      // Démontage sans match trouvé (retour menu, navigation) : on sort de la file.
      if (!foundRef.current) { try { PvpConnection.send('queue:leave'); } catch { /* noop */ } }
    };
  }, [navigate]);

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

  // Même en-tête que l'écran Tournoi : retour, titre, deck engagé. Le ◂ passe par
  // `cancel()` pour ne pas laisser le joueur dans la file en quittant.
  return (
    <main className="flex min-h-dvh flex-col bg-surface text-white">
      <header className="flex items-center gap-3 border-b border-line px-4 py-3">
        <Button className="px-3" onPointerDown={cancel}>◂</Button>
        <h1 className="text-lg font-bold tracking-wide">Duel en ligne</h1>
        <span className="ml-auto truncate text-xs text-white/40">deck : {deckName ?? '—'}</span>
      </header>

      <div className="flex flex-1 flex-col items-center gap-3 overflow-y-auto p-4 py-6 text-center">
        <div className="text-4xl">⚔️</div>
        <p className="max-w-xs text-sm text-white/60">
          Duel 1v1 contre un autre joueur, avec ton deck actif. Le combat est simulé
          des deux côtés — même déroulé, même vainqueur.
        </p>

        <div className="w-full max-w-sm text-left">
          <SelectedDeck deckName={deckName} emptyHint="Choisis un deck avant de chercher un duel." />
        </div>

        {status === 'idle' && hasDeck && (
          <Button variant="primary" className="px-8 py-3" onPointerDown={search}>
            Chercher un adversaire
          </Button>
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
          </>
        )}
      </div>
    </main>
  );
}

function Center({ children }: { children: ReactNode }) {
  return <main className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-surface p-6 text-center text-white">{children}</main>;
}
