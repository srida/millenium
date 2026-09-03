/* eslint-disable @typescript-eslint/no-explicit-any */
// GameScreenPvp — variante Duel en ligne de GameScreen. Même shell (board 3D,
// HUD, main, cimetière, contrôles, Phase Shopping, overlays) mais piloté par
// PvpController. L'identité de l'adversaire (avatar + pseudo) vit dans le HUD
// (`HudWithOpponent`). Ajoute l'overlay d'attente (poignée de main réseau /
// résultat) et l'abandon.
//
// ⚠️ Cet écran sert AUSSI les duels contre un adversaire artificiel, servis par
// le serveur quand la file d'attente ne trouve personne (cf.
// ws/MatchmakingQueue.BOT_DELAY_MIN_MS → BOT_DELAY_MAX_MS). Seul le contrôleur
// change — BotController au lieu de PvpController, et la session est bâtie en
// mode 'ai' sur le deck annoncé. Tout le reste de l'écran est écrit une seule fois et ne sait pas
// lequel des deux il pilote : c'est ce qui rend les deux duels indistinguables
// à l'écran, et ce qui interdit d'ajouter ici la moindre branche visible.
import { useEffect, useState } from 'react';
import { buildSession, pvpDeps } from '../game/bootstrap.js';
import { PvpController } from '../game/PvpController.js';
import { BotController } from '../game/BotController.js';
import * as PvpConnection from '../net/PvpConnection.js';
import { useGameStore } from '../stores/gameStore.js';
import { useUiStore } from '../stores/uiStore.js';
import { useAuthStore } from '../stores/authStore.js';
import Board3DCanvas from '../components/board/Board3DCanvas.js';
import Hud from '../components/hud/Hud.js';
import SynergyPanel from '../components/hud/SynergyPanel.js';
import PhaseControls from '../components/hud/PhaseControls.js';
import GameMenu from '../components/hud/GameMenu.js';
import HandBar from '../components/hand/HandBar.js';
import GraveyardTray from '../components/hand/GraveyardTray.js';
import { TerrainAlert, SummonOptionMenu, EndRoundOverlay, GameOverScreen } from '../components/overlays/Overlays.js';
import ShoppingLayer from '../components/shopping/ShoppingLayer.js';
import { PhaseTimer, Banners } from '../components/hud/PhaseTimer.js';
import { RoundIntro, DrawPopup } from '../components/overlays/RoundStart.js';
import { PREP_DURATION_S, SHOPPING_DURATION_S, DRAW_POPUP_AUTO_MS } from '../game/timings.js';

export default function GameScreenPvp() {
  const [controller, setControllerLocal] = useState<PvpController | BotController | null>(null);
  const [opponentAvatar, setOpponentAvatar] = useState<string | null>(null);
  const setController = useGameStore(s => s.setController);
  const reset = useGameStore(s => s.reset);
  // Pilotage des deux chronos partagés (cf. components/hud/PhaseTimer).
  const round = useGameStore(s => s.round);
  const shoppingOpen = useGameStore(s => !!s.shopping);
  const navigate = useUiStore(s => s.navigate);
  const deckName = useUiStore(s => s.params.deckName as string | undefined);

  useEffect(() => {
    const role = (PvpConnection as any).getRole() as 'A' | 'B' | null;
    if (!role) { navigate('online_lobby'); return; }
    const opponentUser = (PvpConnection as any).getOpponent();
    const opponent = opponentUser?.username ?? 'Adversaire';
    setOpponentAvatar(opponentUser?.avatar ?? null);
    // Duel contre bot : la session est un solo (mode 'ai' + deck du bot), pas
    // une session PvP — il n'y a pas de second client à synchroniser, et
    // l'EnemyAI a besoin d'un deck adverse pour jouer.
    const bot = (PvpConnection as any).getBotMatch();
    const session = bot
      ? buildSession(deckName, 'ai', opponent, bot.deck)
      // ⚠️ Le rôle est passé à la session, et pour une seule raison : le terrain.
      // Le monde du rôle B étant le reflet de celui de A, ses cases bloquées
      // doivent être miroitées — sans quoi les deux clients simulent deux
      // plateaux différents (cf. `logic/BoardMirror`).
      : buildSession(deckName, 'pvp', undefined, null, null, null, role);
    const ctrl = bot
      ? new BotController(session, opponent)
      : new PvpController(session, pvpDeps(), role, opponent);
    setControllerLocal(ctrl);
    setController(ctrl);
    ctrl.begin();
    return () => {
      ctrl.dispose();
      setController(null);
      reset();
      // Ne fermer la socket PvP (singleton) QUE si on quitte réellement l'écran.
      // En dev, StrictMode démonte puis remonte ce composant : lors de ce
      // démontage transitoire, `screen` vaut toujours 'game_pvp' (aucune
      // navigation), donc on préserve la socket + le rôle. Les fermer ici
      // renverrait `getRole()===null` au remontage → rebond vers le lobby et
      // « adversaire déconnecté » côté opposant.
      if (useUiStore.getState().screen !== 'game_pvp') {
        (PvpConnection as any).disconnect();
      }
    };
    // Montage unique : le duel se noue une fois. Remettre `deckName` ou
    // `navigate` en dépendances relancerait la poignée de main en pleine partie.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- cf. ci-dessus
  }, []);

  if (!controller) return <div className="flex min-h-dvh items-center justify-center bg-surface text-white">Connexion au duel…</div>;

  return (
    <div className="relative h-dvh overflow-hidden bg-surface text-white" onPointerDown={() => useUiStore.getState().hideTooltip()}>
      <Board3DCanvas controller={controller} />
      <HudWithOpponent opponentAvatar={opponentAvatar} />
      <SynergyPanel />
      <GraveyardTray />
      <HandBar />
      <PhaseControls pvp />
      {/* Le chrono de préparation PvP n'est PAS gelé par le menu : l'adversaire
          attend à la barrière réseau, on ne peut pas le bloquer en l'ouvrant. */}
      <GameMenu onQuit={() => controller.forfeit()} quitLabel="Abandonner le duel" />
      {/* Chronos partagés avec GameScreen. Deux différences avec le solo, et
          elles tiennent au réseau : `pvpWaiting` gèle la préparation (on attend
          l'adversaire à la barrière), et rien ne gèle le shopping — l'adversaire
          attend derrière, le choix doit être borné. Pas de `coachBlocking` non
          plus : il n'y a pas de tutoriel en duel. */}
      <PhaseTimer
        durationS={PREP_DURATION_S}
        field="prepRemaining"
        restartKey={round}
        isActive={s => s.phase === 'preparation' && !s.combatActive && !s.endRound && !s.shopping && !s.pvpWaiting && !s.gameOver}
        onTimeout={() => controller.startCombat()}
      />
      {shoppingOpen && (
        <PhaseTimer
          durationS={SHOPPING_DURATION_S}
          field="shoppingRemaining"
          restartKey="shopping"
          isActive={() => true}
          onTimeout={() => controller.skipShopping()}
        />
      )}
      <Banners />
      <SummonOptionMenu />
      <WaitingOverlay />
      {/* Ouverture de tour. ⚠️ La popup de pioche NE GÈLE PAS le chrono ici
          (il n'apparaît pas dans le prédicat ci-dessus) : c'est la règle du
          GameMenu — l'adversaire attend à la barrière réseau et ne doit pas
          pouvoir être bloqué. En contrepartie elle se congédie seule, sinon un
          joueur distrait jouerait sa préparation sous un voile. Rien de tout ça
          ne prend de branche sur `bot` : le duel contre bot passe par le même
          écran, et le joueur ne doit pas pouvoir les distinguer. */}
      <RoundIntro />
      <DrawPopup autoDismissMs={DRAW_POPUP_AUTO_MS} />
      <TerrainAlert />
      <EndRoundOverlay />
      <ShoppingLayer />
      <ResultOverlay opponentAvatar={opponentAvatar} />
    </div>
  );
}

// Portrait du vainqueur sur l'écran de résultat : le mien (profil connecté,
// ★ en invité) ou celui de l'adversaire, récupéré à la poignée de main.
function ResultOverlay({ opponentAvatar }: { opponentAvatar: string | null }) {
  const user = useAuthStore(s => s.user);
  const opponentName = useGameStore(s => s.pvpOpponent);
  // La modale recouvre la bannière de jeu : c'est ici, et nulle part ailleurs,
  // qu'un « le serveur n'a pas pu enregistrer ce duel » atteint le joueur.
  const note = useGameStore(s => s.errorFlash);
  return (
    <GameOverScreen
      playerAvatarSrc={user?.avatar ?? null}
      playerAvatarFallback={(user?.username ?? '?').slice(0, 2).toUpperCase()}
      enemyAvatarSrc={opponentAvatar}
      enemyAvatarFallback={(opponentName ?? '?').slice(0, 2).toUpperCase()}
      note={note}
    />
  );
}

// Portrait de l'adversaire dans le HUD : avatar de profil + pseudo, récupérés
// à la poignée de main (l'avatar peut être une image ou un emoji, cf. `Avatar`).
function HudWithOpponent({ opponentAvatar }: { opponentAvatar: string | null }) {
  const opponentName = useGameStore(s => s.pvpOpponent);
  return (
    <Hud
      enemyAvatarSrc={opponentAvatar}
      enemyAvatarFallback={(opponentName ?? '?').slice(0, 2).toUpperCase()}
      enemyName={opponentName}
    />
  );
}

function WaitingOverlay() {
  const waiting = useGameStore(s => s.pvpWaiting);
  const gameOver = useGameStore(s => s.gameOver);
  if (!waiting || gameOver) return null;
  return (
    <div className="pointer-events-auto fixed inset-0 z-40 flex items-center justify-center bg-black/60">
      <div className="flex flex-col items-center gap-2 rounded-2xl border border-gold/40 bg-surface/95 px-6 py-5">
        <div className="text-2xl">⏳</div>
        <div className="animate-pulse text-sm text-white/70">En attente de l'adversaire…</div>
      </div>
    </div>
  );
}
