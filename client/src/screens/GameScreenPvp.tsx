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
import { useEffect, useRef, useState } from 'react';
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
import { SummonOptionMenu, EndRoundOverlay, GameOverScreen } from '../components/overlays/Overlays.js';
import ShoppingLayer from '../components/shopping/ShoppingLayer.js';
import { Banner } from '../components/ui/primitives.js';
import { PREP_DURATION_S, SHOPPING_DURATION_S } from '../game/timings.js';

export default function GameScreenPvp() {
  const [controller, setControllerLocal] = useState<PvpController | BotController | null>(null);
  const [opponentAvatar, setOpponentAvatar] = useState<string | null>(null);
  const setController = useGameStore(s => s.setController);
  const reset = useGameStore(s => s.reset);
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
      : buildSession(deckName, 'pvp');
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
    // Montage unique.
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
      <PrepTimer controller={controller} />
      <ShoppingTimer controller={controller} />
      <PvpBanners />
      <SummonOptionMenu />
      <WaitingOverlay />
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
  return (
    <GameOverScreen
      playerAvatarSrc={user?.avatar ?? null}
      playerAvatarFallback={(user?.username ?? '?').slice(0, 2).toUpperCase()}
      enemyAvatarSrc={opponentAvatar}
      enemyAvatarFallback={(opponentName ?? '?').slice(0, 2).toUpperCase()}
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

// Timer de préparation : déclenche la poignée de main de combat à 0.
function PrepTimer({ controller }: { controller: PvpController | BotController }) {
  const round = useGameStore(s => s.round);
  const applySnapshot = useGameStore(s => s.applySnapshot);
  const remaining = useRef(PREP_DURATION_S);
  useEffect(() => {
    remaining.current = PREP_DURATION_S;
    applySnapshot({ prepRemaining: PREP_DURATION_S });
    const t = setInterval(() => {
      const s = useGameStore.getState();
      const active = s.phase === 'preparation' && !s.combatActive && !s.endRound && !s.shopping && !s.pvpWaiting && !s.gameOver;
      if (!active) return;
      remaining.current -= 1;
      if (remaining.current <= 0) { clearInterval(t); applySnapshot({ prepRemaining: 0 }); controller.startCombat(); return; }
      applySnapshot({ prepRemaining: remaining.current });
    }, 1000);
    return () => clearInterval(t);
  }, [round, controller, applySnapshot]);
  return null;
}

// Chrono de la Phase Shopping. En PvP, l'adversaire attend à la barrière
// réseau tant que je n'ai pas choisi : le choix est donc borné, et « passer »
// est automatique à 0. Affiché dans la popup elle-même (ShoppingLayer, via
// gameStore.shoppingRemaining) plutôt qu'en overlay séparé.
function ShoppingTimer({ controller }: { controller: PvpController | BotController }) {
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

function PvpBanners() {
  const errorFlash = useGameStore(s => s.errorFlash);
  const invocationBanner = useGameStore(s => s.invocationBanner);
  const combatActive = useGameStore(s => s.combatActive);
  if (errorFlash) return <Banner text={`⚠ ${errorFlash}`} tone="error" />;
  if (invocationBanner && !combatActive) return <Banner text={invocationBanner} />;
  return null;
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
