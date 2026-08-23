// GameScreen — shell React autour du board 3D. Assemble HUD, main, cimetière,
// synergies, contrôles de phase, overlays. Possède le timer de préparation
// (60s → combat auto) ; toute la logique de jeu vit dans GameSession/GameController.
import { useEffect, useRef, useState } from 'react';
import { buildSession } from '../game/bootstrap.js';
import { GameController } from '../game/GameController.js';
import { useGameStore } from '../stores/gameStore.js';
import { useUiStore } from '../stores/uiStore.js';
import { useAuthStore } from '../stores/authStore.js';
import { useTournamentStore } from '../stores/tournamentStore.js';
import { useArcadeStore, currentDuel } from '../stores/arcadeStore.js';
import * as PublicDeckDatabase from '../data/PublicDeckDatabase.js';
import Board3DCanvas from '../components/board/Board3DCanvas.js';
import Hud from '../components/hud/Hud.js';
import SynergyPanel from '../components/hud/SynergyPanel.js';
import PhaseControls from '../components/hud/PhaseControls.js';
import GameMenu from '../components/hud/GameMenu.js';
import HandBar from '../components/hand/HandBar.js';
import GraveyardTray from '../components/hand/GraveyardTray.js';
import { SummonOptionMenu, EndRoundOverlay, GameOverScreen } from '../components/overlays/Overlays.js';
import ShoppingLayer from '../components/shopping/ShoppingLayer.js';
import TutorialCoach from '../components/tutorial/TutorialCoach.js';
import { Banner } from '../components/ui/primitives.js';
import { PREP_DURATION_S, SHOPPING_DURATION_S } from '../game/timings.js';
import { buildTutorialDecks } from '../game/tutorialDeck.js';
import * as CardDatabase from '../data/CardDatabase.js';

export default function GameScreen() {
  const [controller, setControllerLocal] = useState<GameController | null>(null);
  const setController = useGameStore(s => s.setController);
  const reset = useGameStore(s => s.reset);
  const deckName = useUiStore(s => s.params.deckName as string | undefined);
  const enemyDeckName = useUiStore(s => s.params.enemyDeckName as string | undefined);
  // Deck public choisi dans le sélecteur : transmis en clair (il n'est pas dans
  // DeckRepository, un nom ne suffirait pas à le recharger).
  const enemyDeck = useUiStore(s => s.params.enemyDeck as Record<string, string[]> | undefined);
  // Id du deck public adverse (mode 'play', absent en miroir) — pour son avatar.
  const enemyDeckId = useUiStore(s => s.params.enemyDeckId as string | undefined);
  // Manche de tournoi : adversaire et deck viennent du bracket, et la sortie
  // (fin de partie ou abandon) est comptabilisée puis renvoyée vers l'écran Tournoi.
  const inTournament = useUiStore(s => s.params.tournament === true);
  // Partie d'entraînement : le VRAI écran de jeu, avec deux decks dérivés du
  // catalogue et un coach par-dessus. Rien du mode solo n'est simulé.
  const inTutorial = useUiStore(s => s.params.tutorial === true);
  // Duel de la run Arcade : l'adversaire et le handicap donné à l'IA viennent de
  // l'instantané SERVEUR, pas des params — c'est ce qui permet de reprendre la
  // run là où elle en était après un rechargement.
  const inArcade = useUiStore(s => s.params.arcade === true);
  const arcadeDuel = useArcadeStore(s => (inArcade ? currentDuel(s.snapshot) : null));
  const pendingOpponentAvatarId = useTournamentStore(s => s.pendingGame?.opponentAvatarId);
  const pendingOpponentName = useTournamentStore(s => s.pendingGame?.opponentName);
  // Avatar adverse dans le HUD : deck public choisi (solo), du bracket (tournoi)
  // ou de l'échelon d'Arcade ; sans choix (miroir), repli sur l'avatar par
  // défaut — le serveur renvoie déjà ce même repli quand un deck n'a pas le sien.
  const enemyAvatarSrc = PublicDeckDatabase.avatarUrl(
    (inTournament ? pendingOpponentAvatarId : inArcade ? arcadeDuel?.deck_id : enemyDeckId) ?? 'PUBLIC_DECK_000',
  );
  // Nom du deck public adverse — absent en miroir, rien à afficher alors.
  const enemyName = (inTournament ? pendingOpponentName : inArcade ? arcadeDuel?.deck_name : enemyDeckName) ?? null;

  useEffect(() => {
    const pending = inTournament ? useTournamentStore.getState().pendingGame : null;
    // Tournoi sans manche en attente (rechargement de page, deep-link) : rien à jouer.
    if (inTournament && !pending) { useUiStore.getState().navigate('tournament'); return; }
    // Même garde côté Arcade : sans run en cours dans l'instantané, il n'y a pas
    // de duel à jouer (deep-link, ou run terminée dans un autre onglet).
    const duel = inArcade ? currentDuel(useArcadeStore.getState().snapshot) : null;
    if (inArcade && !duel) { useUiStore.getState().navigate('arcade'); return; }
    // Le deck d'entraînement ne vit pas dans DeckRepository : il est dérivé du
    // catalogue à chaque lancement, comme les decks publics adverses, et voyage
    // donc en clair jusqu'à buildSession.
    const tutorialDecks = inTutorial ? buildTutorialDecks(CardDatabase.getAllCards()) : null;
    const session = buildSession(
      // Le deck engagé dans la run est figé à son lancement : en changer d'actif
      // en cours de parcours ne doit pas changer d'arme entre deux duels.
      (duel ? useArcadeStore.getState().snapshot?.run?.deck_name : null) ?? pending?.playerDeckName ?? deckName,
      'ai',
      enemyDeckName,
      duel?.deck ?? tutorialDecks?.enemy ?? pending?.opponentDeck ?? enemyDeck,
      tutorialDecks?.player,
      duel?.bonus ? { atk: duel.bonus.atk, hp: duel.bonus.hp } : null,
    );
    const ctrl = new GameController(session);
    setControllerLocal(ctrl);
    setController(ctrl);
    ctrl.begin();
    return () => {
      ctrl.dispose();
      setController(null);
      reset();
    };
    // Montage unique : la session/partie ne se reconstruit pas sur changement de
    // deps. Les paramètres de la partie (deck, adversaire, mode) sont lus une
    // fois au montage — les remettre en dépendances rebâtirait la partie en
    // cours de jeu.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- cf. ci-dessus
  }, []);

  if (!controller) return <div className="flex min-h-dvh items-center justify-center bg-surface text-white">Chargement…</div>;

  return (
    <div className="relative h-dvh overflow-hidden bg-surface text-white" onPointerDown={() => useUiStore.getState().hideTooltip()}>
      <Board3DCanvas controller={controller} />
      <Hud enemyAvatarSrc={enemyAvatarSrc} enemyName={enemyName} />
      <SynergyPanel />
      <GraveyardTray />
      <HandBar />
      <PhaseControls />
      {inTournament ? (
        // Abandonner une manche de tournoi la concède : le bracket ne peut pas
        // rester en suspens, et rejouer à volonté viderait le Bo5 de son sens.
        <GameMenu quitLabel="Abandonner la manche" onQuit={() => exitTournamentGame('enemy')} />
      ) : inArcade ? (
        // Même règle en Arcade : quitter un duel le concède, donc clôt la run.
        // Sans ça, un duel mal engagé se relancerait à volonté et le handicap
        // croissant ne voudrait plus rien dire.
        <GameMenu quitLabel="Abandonner le duel" onQuit={() => { void exitArcadeGame('enemy'); }} />
      ) : inTutorial ? (
        <GameMenu quitLabel="Quitter l'entraînement" onQuit={() => useUiStore.getState().navigate('tutorial')} />
      ) : (
        <GameMenu onQuit={() => useUiStore.getState().navigate('main_menu')} />
      )}
      <PrepTimer controller={controller} />
      <ShoppingTimer controller={controller} />
      <AiWinReward inTournament={inTournament} inTutorial={inTutorial} />
      {inTutorial && <TutorialCoach />}
      {/* Pas de bandeau de contexte Tournoi/Arcade : posé sous la barre de PV,
          il recouvrait les synergies d'attributs — la seule information de cette
          zone qui se lit EN JOUANT. L'adversaire est déjà nommé dans le HUD
          (`enemyName`), et l'échelon comme le score du Bo5 se relisent sur
          l'écran Arcade / Tournoi, où ils sont actionnables. */}
      <Banners />
      <SummonOptionMenu />
      <EndRoundOverlay />
      <ShoppingLayer />
      {inTournament
        ? <GameOverScreen exitLabel="◂ RETOUR AU TOURNOI" onExit={exitTournamentGame} />
        : inArcade
          ? <GameOverScreen exitLabel="◂ RETOUR À L'ARCADE" onExit={(w) => { void exitArcadeGame(w); }} />
          : inTutorial
            ? <GameOverScreen exitLabel="◂ RETOUR AU TUTORIEL" onExit={() => useUiStore.getState().navigate('tutorial')} />
            : <GameOverScreen />}
    </div>
  );
}

// Gain d'XP de la victoire solo, crédité une seule fois par partie (`claimed`).
//
// Une MANCHE de tournoi ne compte pas ici : le tournoi a son propre gain, à la
// victoire finale. Créditer les deux ferait rapporter à un tournoi jusqu'à
// 9 manches × 10 + 50, bien au-delà du barème voulu.
//
// La partie d'ENTRAÎNEMENT non plus : son adversaire est choisi par nous pour
// être battu, et elle se rejoue à volonté. Le tutoriel est pédagogique, il ne
// paie rien — c'est la contrepartie de n'avoir aucune vérification serveur.
function AiWinReward({ inTournament, inTutorial }: { inTournament: boolean; inTutorial: boolean }) {
  const gameOver = useGameStore(s => s.gameOver);
  const winner = useGameStore(s => s.winner);
  const claimed = useRef(false);

  useEffect(() => {
    if (inTournament || inTutorial || claimed.current) return;
    if (!gameOver || winner !== 'player') return;
    claimed.current = true;
    void useAuthStore.getState().claimReward('ai_win');
  }, [gameOver, winner, inTournament, inTutorial]);

  return null;
}

// Solde la manche dans le bracket puis rend la main à l'écran Tournoi.
function exitTournamentGame(winner: 'player' | 'enemy' | 'draw' | null) {
  useTournamentStore.getState().finishGame(winner);
  useUiStore.getState().navigate('tournament');
}

// Rapporte le duel au serveur (qui fait avancer ou clôt la run) puis rend la
// main à l'écran Arcade. Une ÉGALITÉ n'est pas rapportée : comme au tournoi, le
// duel se rejoue — ni le joueur ni l'IA n'a pris le dessus, et consommer un
// échelon là-dessus serait arbitraire.
//
// ⚠️ Le rapport est ATTENDU avant de naviguer, et ce n'est pas cosmétique :
// l'écran Arcade recharge son instantané au montage. Naviguer d'abord lançait
// ce GET pendant que le POST était encore en vol — la lecture pouvait traverser
// le serveur AVANT que le duel n'y soit soldé et revenir en dernier, effaçant
// la victoire de l'affichage. Le joueur rejouait alors un duel que le serveur
// tenait déjà pour gagné, et son second rapport partait sur un index périmé
// (409) : c'est le score de la partie PRÉCÉDENTE qui restait au tableau.
// `arcadeStore` se défend aussi de son côté (compteur `revision`), pour les
// croisements qui ne passent pas par ici — deux onglets, retour navigateur.
async function exitArcadeGame(winner: 'player' | 'enemy' | 'draw' | null) {
  if (winner === 'player' || winner === 'enemy') {
    await useArcadeStore.getState().reportDuel(winner === 'player' ? 'win' : 'loss');
  }
  useUiStore.getState().navigate('arcade');
}

// Timer de préparation : redémarre à chaque nouvelle manche, ne décompte que
// hors combat/overlay, déclenche le combat à 0.
function PrepTimer({ controller }: { controller: GameController }) {
  const round = useGameStore(s => s.round);
  const applySnapshot = useGameStore(s => s.applySnapshot);
  const remaining = useRef(PREP_DURATION_S);

  useEffect(() => {
    remaining.current = PREP_DURATION_S;
    applySnapshot({ prepRemaining: PREP_DURATION_S });
    const t = setInterval(() => {
      const s = useGameStore.getState();
      // `coachBlocking` gèle la préparation comme `menuOpen` : une bulle du
      // tutoriel qui attend un tap ne doit pas voir le combat partir sous elle.
      const prepActive = s.phase === 'preparation' && !s.combatActive && !s.endRound && !s.shopping && !s.menuOpen && !s.coachBlocking && !s.gameOver;
      if (!prepActive) return;
      remaining.current -= 1;
      if (remaining.current <= 0) {
        clearInterval(t);
        applySnapshot({ prepRemaining: 0 });
        controller.onPrepTimeout();
        return;
      }
      applySnapshot({ prepRemaining: remaining.current });
    }, 1000);
    return () => clearInterval(t);
  }, [round, controller, applySnapshot]);

  return null;
}

// Chrono de la Phase Shopping (solo + tournoi) : passage automatique à 0,
// même règle qu'en PvP (GameScreenPvp.tsx). Affiché dans la popup elle-même
// (ShoppingLayer, via gameStore.shoppingRemaining) plutôt qu'en overlay
// séparé — un chrono à côté de la décision qu'il borne, pas au-dessus.
function ShoppingTimer({ controller }: { controller: GameController }) {
  const active = useGameStore(s => !!s.shopping);
  const applySnapshot = useGameStore(s => s.applySnapshot);
  const remaining = useRef(SHOPPING_DURATION_S);
  const skipped = useRef(false);

  useEffect(() => {
    if (!active) { skipped.current = false; return; }
    remaining.current = SHOPPING_DURATION_S;
    skipped.current = false;
    applySnapshot({ shoppingRemaining: SHOPPING_DURATION_S });
    const t = setInterval(() => {
      // Même gel que la préparation : le coach explique le choix de magie,
      // le chrono ne doit pas trancher à sa place.
      if (useGameStore.getState().coachBlocking) return;
      remaining.current -= 1;
      if (remaining.current <= 0) {
        clearInterval(t);
        applySnapshot({ shoppingRemaining: 0 });
        if (!skipped.current) { skipped.current = true; controller.skipShopping(); }
        return;
      }
      applySnapshot({ shoppingRemaining: remaining.current });
    }, 1000);
    return () => clearInterval(t);
  }, [active, controller, applySnapshot]);

  return null;
}

function Banners() {
  const errorFlash = useGameStore(s => s.errorFlash);
  const invocationBanner = useGameStore(s => s.invocationBanner);
  const combatActive = useGameStore(s => s.combatActive);
  // La bannière de ciblage magie est rendue par ShoppingLayer (avec Annuler).
  if (errorFlash) return <Banner text={`⚠ ${errorFlash}`} tone="error" />;
  if (invocationBanner && !combatActive) return <Banner text={invocationBanner} />;
  return null;
}
