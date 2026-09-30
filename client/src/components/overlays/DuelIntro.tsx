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
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useAuthStore } from '../../stores/authStore.js';
import { useGameStore } from '../../stores/gameStore.js';
import { Avatar } from '../ui/primitives.js';
import * as Audio from '../../audio/AudioManager.js';
import { startDuelVortex, DUEL_VORTEX_END, type VortexRefs } from './duelVortex.js';

// La chronologie de `duelVortex.ts` est calée sur cette valeur : un seul
// horloge (rAF) pilote canvas, avatars, titre, VS et noms.
const DEFAULT_DURATION_MS = DUEL_VORTEX_END * 1000;

export interface DuelIntroProps {
  /** Portrait adverse : avatar de profil (PvP) ou avatar du deck public (solo/tournoi/arcade). */
  enemyAvatarSrc?: string | null;
  enemyAvatarFallback?: string;
  /** Pseudo de l'adversaire (PvP) ou nom du deck public (solo/tournoi/arcade). */
  enemyName?: string | null;
  /** Durée totale de l'annonce, en ms (la chronologie est calée sur la valeur par défaut : ne pas la passer). */
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
  const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

  const refs = {
    overlay: useRef<HTMLDivElement>(null), canvas: useRef<HTMLCanvasElement>(null),
    title: useRef<HTMLParagraphElement>(null), rule: useRef<HTMLDivElement>(null),
    vs: useRef<HTMLSpanElement>(null), avP: useRef<HTMLDivElement>(null),
    avE: useRef<HTMLDivElement>(null), nameP: useRef<HTMLDivElement>(null), nameE: useRef<HTMLDivElement>(null),
  };
  // useLayoutEffect : la première image du canvas est peinte avant le premier affichage.
  useLayoutEffect(() => {
    const r = Object.fromEntries(Object.entries(refs).map(([k, v]) => [k, v.current]));
    if (Object.values(r).some(v => !v)) return;
    return startDuelVortex(r as unknown as VortexRefs, { reduced });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- joué une seule fois au montage
  }, []);

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
    <div className={'duel-intro' + (reduced ? ' is-reduced' : '')} aria-hidden="true">
      <div ref={refs.overlay} className="duel-intro-stage">
        <canvas ref={refs.canvas} className="duel-intro-canvas" />
        <div className="duel-intro-top">
          <p ref={refs.title} className="duel-intro-word">C&rsquo;est l&rsquo;heure du duel</p>
          <div ref={refs.rule} className="duel-intro-rule" />
        </div>
        <div className="duel-intro-center">
          <span ref={refs.vs} className="duel-intro-vs">VS</span>
          <div ref={refs.avP} className="duel-intro-side duel-intro-side-player">
            <div className="duel-intro-frame">
              <Avatar src={playerAvatar} fallback="★" className="duel-intro-avatar" />
            </div>
            <div ref={refs.nameP} className="duel-intro-label">
              <i className="duel-intro-bar" />
              <span className="duel-intro-name">{playerName}</span>
            </div>
          </div>
          <div ref={refs.avE} className="duel-intro-side duel-intro-side-enemy">
            <div className="duel-intro-frame">
              <Avatar src={enemyAvatarSrc} fallback={enemyAvatarFallback} className="duel-intro-avatar" />
            </div>
            <div ref={refs.nameE} className="duel-intro-label">
              <i className="duel-intro-bar" />
              <span className="duel-intro-name">{enemyName ?? 'Adversaire'}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
