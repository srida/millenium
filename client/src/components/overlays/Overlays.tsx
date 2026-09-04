// Overlays de la partie : annonce de terrain, menu d'options d'invocation,
// résultat de round, fin de partie. La Phase Shopping vit dans
// components/shopping/.
import { useEffect, useRef, useState } from 'react';
import { useGameStore } from '../../stores/gameStore.js';
import { useUiStore } from '../../stores/uiStore.js';
import { useAuthStore } from '../../stores/authStore.js';
import { Avatar, Button, Illustration, Modal } from '../ui/primitives.js';
import TerrainEffects from '../ui/TerrainEffects.js';
import RecipeRow from '../ui/SummonRecipe.js';
import { summonRecipes } from '../../data/SummonInfo.js';
import { AnimatedLevelGauge } from '../ui/ProgressionStats.js';
import { END_ROUND_DURATION_S, TERRAIN_ALERT_MS } from '../../game/timings.js';
import type { EndRoundResult } from '../../logic/GameSession.js';

/**
 * L'annonce du terrain, à l'entrée en phase de combat.
 *
 * Le terrain décide de bonus de stats RÉELS et change à chaque round (cf. « Le
 * tirage du terrain ») — mais sa seule trace à l'écran était la puce 🗺️ de la
 * barre de combat, qu'il fallait taper pour lire l'effet. On l'annonce donc, le
 * temps que le premier coup se prépare.
 *
 * ⚠️ Ce composant ne PILOTE rien : il n'a pas de minuteur à lui. Le départ du
 * combat appartient au contrôleur, qui retient déjà le premier coup pour la
 * cascade d'arrivée de l'IA. Deux horloges pour un même événement finiraient par
 * ne plus s'accorder — l'annonce se contente de disparaître quand
 * `terrainAlert` repasse à `null`.
 *
 * ⚠️ Pas de `Modal` : elle poserait un voile noir sur ce qu'on vient annoncer.
 * Une couche transparente suffit, et c'est elle qui capte le tap qui passe
 * l'annonce.
 *
 * ⚠️ `z-40`, pas plus : `TutorialCoach` est en `z-50` avec sa bulle en
 * `pointer-events-auto`. Au-dessus, l'annonce lui volerait ses taps pendant
 * deux secondes et demie et le tutoriel perdrait son bouton.
 */
export function TerrainAlert() {
  const alert = useGameStore(s => s.terrainAlert);
  const controller = useGameStore(s => s.controller);
  if (!alert || !controller) return null;
  const { board, boosted } = alert;

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center p-4"
      onPointerDown={(e) => { e.stopPropagation(); controller.dismissTerrainAlert(); }}
    >
      <div
        className="terrain-alert flex w-full max-w-xs flex-col items-center gap-2 rounded-2xl border border-gold/40 bg-surface/95 p-4 text-center shadow-2xl backdrop-blur"
        style={{ ['--terrain-alert-dur' as string]: `${TERRAIN_ALERT_MS}ms` }}
      >
        <div className="text-[9px] uppercase tracking-widest text-white/40">Terrain de combat</div>
        {/* La vignette CARRÉE (/illustrations), pas le fond de grille 5:11 de
            /board-backgrounds — qui serait déformé dans un cadre carré. */}
        {board._has_illustration
          ? <Illustration id={board.id} className="h-24 w-24" framed lazy={false} />
          : <div className="flex h-24 w-24 items-center justify-center rounded-lg border border-line text-4xl">🗺️</div>}
        <div className="text-base font-bold text-gold">{board.name}</div>
        {/* Un terrain porte désormais PLUSIEURS effets : ils s'annoncent tous,
            chacun avec ce qu'il vise — c'est le composant partagé avec
            l'infobulle 🗺️ qui les rend. */}
        <TerrainEffects board={board} center />
        {boosted && <BoostedCount player={boosted.player} enemy={boosted.enemy} />}
      </div>
    </div>
  );
}

/**
 * Qui est concerné, en clair — c'est ce qui fait la différence entre une
 * annonce décorative et une information tactique.
 *
 * ⚠️ Un terrain qui ne touche personne le DIT. La sélection préfère un terrain
 * pertinent mais cède devant la non-répétition (cf. « Le tirage du terrain ») :
 * le cas arrive, et le taire laisserait le joueur croire à un bonus qu'il n'a
 * pas. Les couleurs sont celles des deux camps, déjà lues partout ailleurs.
 */
function BoostedCount({ player, enemy }: { player: number; enemy: number }) {
  if (player === 0 && enemy === 0) {
    return <div className="text-[11px] text-white/40">Aucune unité en jeu n'en profite</div>;
  }
  return (
    <div className="flex items-center gap-2 text-[11px]">
      <span className={player > 0 ? 'font-semibold text-player' : 'text-white/30'}>
        {player === 1 ? '1 des tiennes' : `${player} des tiennes`}
      </span>
      <span className="text-white/20">·</span>
      <span className={enemy > 0 ? 'font-semibold text-enemy' : 'text-white/30'}>
        {enemy === 1 ? '1 adverse' : `${enemy} adverses`}
      </span>
    </div>
  );
}

/**
 * Le choix entre les CONDITIONS d'une carte qui en porte plusieurs.
 *
 * ⚠️ Chaque bouton se lit comme une ligne du tooltip — même composant, donc la
 * même règle d'affichage. Il affichait un `label` par voie d'invocation, une
 * notion que le moteur n'a plus : le contrôleur ne l'émet plus, et les boutons
 * étaient rendus VIDES (le joueur voyait une modale de flèches sans texte).
 */
export function SummonOptionMenu() {
  const menu = useGameStore(s => s.summonOptions);
  const controller = useGameStore(s => s.controller);
  if (!menu || !controller) return null;
  // Les recettes sont indexées comme les conditions : `summonRecipes` en rend
  // une par condition, dans l'ordre, et l'option porte cet index.
  const recipes = summonRecipes(menu.card);
  return (
    <Modal onClose={() => controller.cancelSelection()}>
      <div className="text-xs tracking-widest text-white/50">CONDITION D'INVOCATION</div>
      <div className="mb-2 text-base font-bold">{menu.card.name}</div>
      <div className="space-y-2">
        {menu.options.map(o => (
          <button
            key={o.index}
            disabled={!o.ok}
            onPointerDown={(e) => { e.stopPropagation(); controller.chooseSummonOption(o.index); }}
            className="flex w-full min-h-tap items-center justify-between gap-2 rounded-lg border border-line bg-surface-raised px-3 py-2 text-left text-sm disabled:opacity-40"
          >
            <span className="min-w-0">
              {recipes[o.index]
                ? <RecipeRow recipe={recipes[o.index]} />
                : <span className="font-semibold text-gold">Condition {o.index + 1}</span>}
              {/* Une voie refusée dit POURQUOI : le bouton grisé seul laisse
                  chercher, et la raison vient déjà de `canSummon`. */}
              {!o.ok && o.reason && <div className="mt-0.5 text-[10px] text-enemy">{o.reason}</div>}
            </span>
            <span className="flex-shrink-0 text-white/40">▸</span>
          </button>
        ))}
      </div>
      <Button className="mt-3 w-full" onPointerDown={(e) => { e.stopPropagation(); controller.cancelSelection(); }}>Annuler</Button>
    </Modal>
  );
}

export function EndRoundOverlay() {
  const endRound = useGameStore(s => s.endRound);
  const controller = useGameStore(s => s.controller);
  const round = useGameStore(s => s.round);
  const playerHp = useGameStore(s => s.playerHp);
  const enemyHp = useGameStore(s => s.enemyHp);
  const [countdown, setCountdown] = useState(END_ROUND_DURATION_S);
  // Un seul passage automatique par overlay : sans ce verrou, le 0 laissé par le
  // round précédent est encore l'état courant au premier rendu du round suivant
  // et l'effet ci-dessous congédiait l'overlay instantanément.
  const dismissed = useRef(false);

  useEffect(() => {
    if (!endRound) { dismissed.current = false; setCountdown(END_ROUND_DURATION_S); return; }
    setCountdown(END_ROUND_DURATION_S);
    const t = setInterval(() => {
      // Le coach du tutoriel explique justement ces dégâts : congédier le
      // récapitulatif sous son nez viderait l'explication de son objet.
      if (useGameStore.getState().coachBlocking) return;
      setCountdown(c => (c <= 1 ? 0 : c - 1));
    }, 1000);
    return () => clearInterval(t);
  }, [endRound]);

  // Déclenche le passage à la suite quand le compte à rebours atteint 0 —
  // hors du render (effet séparé) pour ne pas setState pendant le rendu.
  useEffect(() => {
    if (!endRound || countdown > 0 || dismissed.current) return;
    dismissed.current = true;
    controller?.dismissEndRound();
  }, [countdown, endRound, controller]);

  if (!endRound || !controller) return null;
  const { winner, isGameOver } = endRound;
  const title = winner === 'player' ? 'VICTOIRE DU ROUND' : winner === 'enemy' ? 'DÉFAITE DU ROUND' : 'ÉGALITÉ DU ROUND';
  const icon = winner === 'player' ? '⚡' : winner === 'enemy' ? '💀' : '⚖️';
  const tone = winner === 'player' ? 'text-success' : winner === 'enemy' ? 'text-danger' : 'text-gold';

  return (
    <Modal>
      <div className="flex flex-col items-center gap-1">
        <div className="text-4xl">{icon}</div>
        <div className={`text-lg font-bold ${tone}`}>{title}</div>
        <div className="my-2 flex items-center gap-4 text-sm">
          <span className="font-bold text-player tabular-nums">{playerHp} PV</span>
          <span className="text-white/40">VS</span>
          <span className="font-bold text-enemy tabular-nums">{enemyHp} PV</span>
        </div>
        <DamageBreakdown result={endRound} />
        <div className="mt-1 text-xs text-white/40">{countdown}s</div>
        <Button variant="primary" className="mt-1 w-full" onPointerDown={(e) => { e.stopPropagation(); controller.dismissEndRound(); }}>
          {isGameOver ? 'RÉSULTAT FINAL' : `TOUR ${round + 1} ▸`}
        </Button>
      </div>
    </Modal>
  );
}

function DamageBreakdown({ result }: { result: EndRoundResult }) {
  const survivors = result.winner === 'enemy' ? result.enemySurvivors : result.playerSurvivors;
  if (!survivors.length) return null;
  return (
    <div className="w-full rounded-lg border border-white/10 bg-white/5 p-2 text-[11px]">
      <div className="mb-1 tracking-widest text-white/40">SURVIVANTS</div>
      {survivors.map((u, i) => (
        <div key={i} className="flex justify-between"><span className="truncate text-white/70">{u.name}</span><span className="tabular-nums text-white/50">{u.atk}</span></div>
      ))}
    </div>
  );
}

/**
 * Fin de partie. `onExit` permet à l'appelant de détourner la sortie — le
 * Tournoi renvoie vers son bracket après avoir comptabilisé la manche, au lieu
 * de retomber sur le menu principal.
 *
 * `playerAvatarSrc`/`enemyAvatarSrc` sont optionnels et **volontairement sans
 * valeur par défaut** (`undefined`, pas `null`) : seul l'appelant qui les
 * fournit (le Duel en ligne, où les deux portraits sont connus) voit le
 * portrait du vainqueur affiché ; le mode solo/tournoi, qui ne les passe pas,
 * garde l'écran inchangé.
 */
export function GameOverScreen({
  onExit, exitLabel = '◂ MENU PRINCIPAL',
  playerAvatarSrc, playerAvatarFallback = '★',
  enemyAvatarSrc, enemyAvatarFallback = '?',
  note = null,
}: {
  onExit?: (winner: 'player' | 'enemy' | 'draw' | null) => void;
  exitLabel?: string;
  playerAvatarSrc?: string | null;
  playerAvatarFallback?: string;
  enemyAvatarSrc?: string | null;
  enemyAvatarFallback?: string;
  /**
   * Réserve pour ce que le RÉSULTAT ne dit pas de lui-même. Aujourd'hui : le
   * duel en ligne dont le serveur n'a pas pu enregistrer l'issue. La bannière
   * de jeu (hud/PhaseTimer.Banners) passe SOUS cette modale — sans ce relais,
   * l'avertissement serait écrit et invisible.
   */
  note?: string | null;
} = {}) {
  const gameOver = useGameStore(s => s.gameOver);
  const winner = useGameStore(s => s.winner);
  const playerHp = useGameStore(s => s.playerHp);
  const enemyHp = useGameStore(s => s.enemyHp);
  const navigate = useUiStore(s => s.navigate);
  const user = useAuthStore(s => s.user);
  // Progression d'avant-partie, capturée au montage de l'écran (avant tout
  // gain de cette partie) — sert de point de départ à l'animation de la jauge
  // de niveau à la victoire.
  const startProgression = useRef({ level: user?.level ?? 1, xp: user?.xp ?? 0 });
  if (!gameOver) return null;

  const title = winner === 'player' ? 'VICTOIRE' : winner === 'enemy' ? 'DÉFAITE' : 'ÉGALITÉ';
  const icon = winner === 'player' ? '🏆' : winner === 'enemy' ? '💀' : '⚖️';
  const tone = winner === 'player' ? 'text-success' : winner === 'enemy' ? 'text-danger' : 'text-gold';
  const winnerAvatar = winner === 'player'
    ? { src: playerAvatarSrc, fallback: playerAvatarFallback }
    : winner === 'enemy'
      ? { src: enemyAvatarSrc, fallback: enemyAvatarFallback }
      : null;
  const showWinnerAvatar = winnerAvatar && (playerAvatarSrc !== undefined || enemyAvatarSrc !== undefined);

  return (
    <Modal>
      <div className="flex flex-col items-center gap-2">
        {showWinnerAvatar && (
          <Avatar src={winnerAvatar.src} fallback={winnerAvatar.fallback} className="h-16 w-16 border-gold/60" />
        )}
        <div className="text-5xl">{icon}</div>
        <div className={`text-2xl font-bold ${tone}`}>{title}</div>
        <div className="text-xs tracking-widest text-white/40">FIN DE PARTIE</div>
        <div className="my-2 flex items-center gap-4 text-sm">
          <span className="font-bold text-player tabular-nums">{playerHp} PV</span>
          <span className="text-white/40">VS</span>
          <span className="font-bold text-enemy tabular-nums">{enemyHp} PV</span>
        </div>
        {winner === 'player' && user && (
          <AnimatedLevelGauge
            className="w-full"
            fromLevel={startProgression.current.level}
            fromXp={startProgression.current.xp}
            toLevel={user.level ?? startProgression.current.level}
            toXp={user.xp ?? startProgression.current.xp}
          />
        )}
        {note && <div className="mb-1 text-center text-xs text-danger">⚠ {note}</div>}
        <Button
          variant="primary"
          className="w-full"
          onPointerDown={(e) => { e.stopPropagation(); if (onExit) onExit(winner); else navigate('main_menu'); }}
        >
          {exitLabel}
        </Button>
      </div>
    </Modal>
  );
}
