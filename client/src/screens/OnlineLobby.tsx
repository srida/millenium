/* eslint-disable @typescript-eslint/no-explicit-any */
// OnlineLobby — matchmaking du Duel en ligne. Connecte le WebSocket, rejoint la
// file avec le deck engagé, et navigue vers l'écran de jeu PvP dès qu'un match
// est trouvé — après avoir présenté l'adversaire (MATCH_REVEAL_MS). Le combat
// lui-même vit dans GameScreenPvp / PvpController.
//
// Le deck n'est PAS choisi ici : c'est le deck actif, choisi au menu principal
// (« Mes decks ») ; ce lobby n'en affiche que le récap (SelectedDeck).
import { useEffect, useRef, useState } from 'react';
import * as PvpConnection from '../net/PvpConnection.js';
import * as DeckRepository from '../data/DeckRepository.js';
import { useAuthStore } from '../stores/authStore.js';
import { useUiStore } from '../stores/uiStore.js';
import { Button } from '../components/ui/primitives.js';
import MatchFoundReveal, { MATCH_REVEAL_MS, type MatchOpponent as Opponent } from '../components/online/MatchFoundReveal.js';
import SelectedDeck from '../components/deck/SelectedDeck.js';
import MusicThemePicker from '../components/ui/MusicThemePicker.js';
import { GuestGate } from '../components/ui/GuestGate.js';
import UiIcon from '../components/ui/UiIcon.js';
import { useWebLayout } from '../components/system/useWebLayout.js';

type Status = 'idle' | 'connecting' | 'searching' | 'found' | 'error';


export default function OnlineLobby() {
  const navigate = useUiStore(s => s.navigate);
  const user = useAuthStore(s => s.user);
  const [status, setStatus] = useState<Status>('idle');
  const [error, setError] = useState<string | null>(null);
  const [opponent, setOpponent] = useState<Opponent | null>(null);
  const startedRef = useRef(false);
  const foundRef = useRef(false);
  const revealRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Deck engagé dans le duel = deck actif (choisi au menu). Il part dans
  // `queue:join`, puis sert à bâtir la session PvP.
  const deckName = ((DeckRepository as any).getActiveDeck?.() as string | null) ?? null;
  const hasDeck = !!deckName && !!(DeckRepository as any).loadDeck?.(deckName);
  // Lu via ref pour que le handler `onFound` (abonné une seule fois au montage)
  // utilise toujours la valeur à jour sans re-déclencher l'effet.
  const deckRef = useRef(deckName);
  deckRef.current = deckName;

  const web = useWebLayout();
  const classname_title = `border-b border-line py-3${web ? ' px-22' : ' px-6'}`;

  // Abonnement au match + sortie de file : MONTAGE/DÉMONTAGE uniquement.
  // Ne jamais dépendre de `status` ici : un re-run de l'effet enverrait
  // `queue:leave` dans son cleanup juste après `queue:join`, ce qui nous
  // retirait aussitôt de la file (aucun match ne pouvait alors se former).
  useEffect(() => {
    const onFound = (msg: any) => {
      foundRef.current = true;
      setOpponent(msg?.opponent ?? {});
      setStatus('found');
      // On présente l'adversaire (pseudo + avatar) avant de basculer sur le duel.
      revealRef.current = setTimeout(
        () => navigate('game_pvp', { deckName: deckRef.current ?? undefined }),
        MATCH_REVEAL_MS,
      );
    };
    PvpConnection.on('match:found', onFound);
    return () => {
      PvpConnection.off('match:found', onFound);
      // La présentation dure MATCH_REVEAL_MS : un démontage entre-temps (retour
      // navigateur, navigation) ne doit pas faire naviguer l'écran suivant.
      if (revealRef.current) { clearTimeout(revealRef.current); revealRef.current = null; }
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
      // Le serveur lit sa PROPRE copie du deck pour en dériver les
      // illustrations transmises à l'adversaire. La synchro étant debouncée à
      // 500 ms, une variante choisie juste avant d'entrer dans la file ne
      // serait pas encore en base : on force l'envoi ici.
      await (DeckRepository as any).flushSync?.();
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

  if (!user) return <GuestGate reason="Connecte-toi pour jouer en ligne." />;

  // Le libellé du menu, ce mode étant devenu la voie principale. Aucun bouton
  // retour ici : quitter en pleine recherche passe déjà par le bouton
  // « Annuler » plus bas (lui seul appelle `cancel()`, pour ne pas laisser le
  // joueur dans la file) ; sans recherche en cours, le footer Accueil suffit.
  return (
    <main className="flex min-h-full flex-col relative z-10 text-white">
      <div className={classname_title}>
        <h1 className="text-lg font-bold tracking-wide">Jouer</h1>
      </div>

      <div className="flex flex-1 flex-col items-center gap-3 overflow-y-auto p-4 py-6 text-center">
        <UiIcon id="UI_DUEL" className="h-10 w-10" />
        <p className="max-w-xs text-sm text-white/60">
          Duel 1v1 contre un autre joueur, avec ton deck actif. Le combat est simulé
          des deux côtés — même déroulé, même vainqueur.
        </p>

        <div className="w-full max-w-sm text-left">
          <SelectedDeck deckName={deckName} emptyHint="Choisis un deck avant de chercher un duel." />
        </div>
        <MusicThemePicker />

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
        {status === 'error' && (
          <>
            <p className="text-sm text-danger">{error}</p>
            <Button onPointerDown={() => { setStatus('idle'); }}>Réessayer</Button>
          </>
        )}
      </div>

      {status === 'found' && <MatchFoundReveal opponent={opponent} />}
    </main>
  );
}
