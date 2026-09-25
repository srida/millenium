// L'annonce de lancement de partie — entraînement, jeu en ligne, Arcade,
// Tournoi : un tourbillon de braises aspire l'écran, un flash claque, puis
// « C'est l'heure du duel » s'imprime au centre avec l'avatar et le nom des
// deux joueurs dessous.
//
// Bundle Claude Design `millenium-duel-transition.js` — même traitement que
// `OutcomeTransition` (écran de fin de partie) et `PhaseWipe` (volets de
// combat/shopping) : le custom element / shadow DOM du prototype est traduit
// en classes CSS ordinaires (`styles/duelIntro.css`), et l'unique ajout de
// fond (avatar + pseudo de chaque camp) vient combler ce que le prototype
// laissait à un sous-titre optionnel.
//
// ⚠️ Local à l'écran qui le monte, pas de minuteur possédé par
// `GameController` — elle joue une seule fois, avant même que la préparation
// ne débute vraiment à l'écran, et se retire d'elle-même. Elle pose et lève
// tout de même `gameStore.duelIntro`, sur le modèle de `menuOpen` /
// `coachBlocking` : sans lui, le chrono de préparation grignotait ses
// premières secondes sous l'annonce.
//
// ⚠️ OPAQUE dès la première peinture, sans fondu ni classe `is-playing`
// posée après coup (`styles/duelIntro.css`) : un fondu d'entrée piloté par
// React (`rAF` puis transition CSS) laisse passer une à deux frames où le
// board/HUD est déjà rendu dessous pendant que la couche est encore
// transparente — c'est exactement le board qu'on voyait une fraction de
// seconde avant l'annonce. Le noir doit être là AVANT que quoi que ce soit
// d'autre n'ait la moindre chance de peindre, donc c'est un simple attribut
// CSS statique de la classe, jamais un état posé après le montage.
//
// ⚠️ `pointer-events-none` sur toute la couche, comme les autres transitions
// de phase : rien ne doit pouvoir bloquer un geste en dessous, même si dans
// les faits le joueur n'a rien à taper avant la fin de l'annonce.
import { useEffect, useRef, useState } from 'react';
import { useAuthStore } from '../../stores/authStore.js';
import { useGameStore } from '../../stores/gameStore.js';
import { Avatar } from '../ui/primitives.js';
import * as Audio from '../../audio/AudioManager.js';

const DEFAULT_DURATION_MS = 3000;
// Fixe : la vitesse du tourbillon ne doit pas dépendre de la durée totale
// (cf. l'avertissement en tête de `duelIntro.css`).
const VORTEX_DURATION_MS = 1500;

// Braises aspirées : angle de départ, rayon, taille, retard — déterministe
// (même calcul que le prototype d'origine), pour que le motif soit identique
// à chaque partie plutôt que de gigoter d'un lancement à l'autre.
function embers(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    key: i,
    angleDeg: (i * 360) / n + (((i * 53) % 13) - 6) * 2,
    radius: 40 + ((i * 17) % 10) * 3.2,
    size: 0.4 + ((i * 7) % 5) * 0.22,
    delayFrac: ((i * 29) % 17) / 17,
  }));
}
const EMBERS = embers(26);

export interface DuelIntroProps {
  /** Portrait adverse : avatar de profil (PvP) ou avatar du deck public (solo/tournoi/arcade). */
  enemyAvatarSrc?: string | null;
  enemyAvatarFallback?: string;
  /** Pseudo de l'adversaire (PvP) ou nom du deck public (solo/tournoi/arcade). */
  enemyName?: string | null;
  /** Durée totale de l'annonce, en ms (le tourbillon, lui, garde son propre rythme fixe). */
  duration?: number;
  /**
   * Appelé UNE fois, à l'échéance de l'annonce (ou à son annulation
   * prématurée) — c'est ce qui permet à l'écran appelant de retarder
   * `GameController.begin()` jusque-là : la partie (préparation, main,
   * annonce de tour) ne doit pas démarrer SOUS l'annonce, mais APRÈS elle.
   */
  onDone?: () => void;
}

/**
 * Joue une fois au montage de l'écran de jeu puis se retire — `null` après
 * coup, comme les autres transitions ponctuelles de ce projet, plutôt que de
 * rester posée en couche invisible.
 */
export default function DuelIntro({
  enemyAvatarSrc = null,
  enemyAvatarFallback = '?',
  enemyName = null,
  duration = DEFAULT_DURATION_MS,
  onDone,
}: DuelIntroProps) {
  const user = useAuthStore(s => s.user);
  const playerAvatar = (user as { avatar?: string | null } | null)?.avatar ?? null;
  const playerName = user?.username ?? 'Toi';

  const [done, setDone] = useState(false);

  // `onDone` change d'identité à chaque rendu du parent (closure sur
  // `controller`) ; le garder dans une ref évite de le figer dans l'effet de
  // montage — même patron que `PhaseTimer.activeRef`/`timeoutRef`.
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;
  // Un seul appel, jamais deux (échéance normale PUIS nettoyage d'unmount).
  const firedRef = useRef(false);
  const fireDone = () => {
    if (firedRef.current) return;
    firedRef.current = true;
    onDoneRef.current?.();
  };

  useEffect(() => {
    // ⚠️ Posé au montage ET levé explicitement à l'échéance — pas seulement
    // au nettoyage de l'effet : `done` ne démonte pas le composant (il rend
    // `null` par lui-même, cf. plus bas), donc le nettoyage d'unmount ne
    // tournerait qu'à la sortie de l'écran de jeu. Sans ce lever explicite, le
    // chrono de préparation resterait gelé pour le reste de la partie.
    useGameStore.getState().applySnapshot({ duelIntro: true });
    Audio.playSfx('duel_start');
    // Coupe toute musique de MENU restée en fond (l'écran de jeu ne règle pas
    // son propre thème avant `begin()`, appelé par `onDone` ci-dessous) — le
    // thème de PARTIE la remplacera de lui-même au premier `_openRound`.
    Audio.setMusicTheme(null);
    const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    const total = reduced ? Math.min(duration, 1600) : duration;
    const t = setTimeout(() => {
      setDone(true);
      useGameStore.getState().applySnapshot({ duelIntro: false });
      fireDone();
    }, total + 60);
    return () => {
      clearTimeout(t);
      // Filet pour une sortie prématurée (abandon via le menu pendant
      // l'annonce, qui reste tapable — elle n'a que `pointer-events-none`
      // sur SA propre couche) : la partie se termine, le drapeau ne doit pas
      // survivre au démontage réel de l'écran, et l'appelant qui attendait
      // `onDone` pour démarrer la partie ne doit pas rester bloqué.
      useGameStore.getState().applySnapshot({ duelIntro: false });
      fireDone();
    };
    // Joué une seule fois, à l'entrée sur l'écran — `duration` ne change
    // jamais en cours de partie.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- cf. ci-dessus
  }, []);

  if (done) return null;

  return (
    <div
      className="duel-intro"
      style={{
        ['--dur' as string]: `${duration}ms`,
        ['--dur-vortex' as string]: `${VORTEX_DURATION_MS}ms`,
      }}
      aria-hidden="true"
    >
      <div className="duel-intro-stage">
        <div className="duel-intro-layer duel-intro-veil" />
        <div className="duel-intro-layer duel-intro-mid duel-intro-swirl duel-intro-swirl-c" />
        <div className="duel-intro-layer duel-intro-mid duel-intro-swirl duel-intro-swirl-b" />
        <div className="duel-intro-layer duel-intro-mid duel-intro-swirl duel-intro-swirl-a" />
        <div className="duel-intro-layer duel-intro-core" />
        {EMBERS.map(e => (
          <div
            key={e.key}
            className="duel-intro-layer duel-intro-ember"
            style={{
              ['--ang' as string]: `${e.angleDeg.toFixed(1)}deg`,
              ['--rad' as string]: `${e.radius.toFixed(1)}`,
              ['--sz' as string]: `${e.size.toFixed(2)}`,
              ['--dl' as string]: `${e.delayFrac.toFixed(3)}`,
            }}
          />
        ))}
        <div className="duel-intro-layer duel-intro-flash" />
        <div className="duel-intro-copy">
          <p className="duel-intro-word">C&rsquo;est l&rsquo;heure du duel</p>
          <div className="duel-intro-rule" />
          <div className="duel-intro-versus">
            <div className="duel-intro-side duel-intro-side-player">
              <Avatar src={playerAvatar} fallback="★" className="duel-intro-avatar" />
              <span className="duel-intro-name">{playerName}</span>
            </div>
            <span className="duel-intro-vs">VS</span>
            <div className="duel-intro-side duel-intro-side-enemy">
              <Avatar src={enemyAvatarSrc} fallback={enemyAvatarFallback} className="duel-intro-avatar" />
              <span className="duel-intro-name">{enemyName ?? 'Adversaire'}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
