// Coach de la partie d'entraînement.
//
// Il OBSERVE `gameStore` et n'appelle jamais le contrôleur pour jouer à la
// place du joueur : c'est ce qui permet au tutoriel de tourner sur la vraie
// partie, avec le vrai `GameController` et la vraie `GameSession`, sans une
// ligne de crochet dans `logic/`. Toute la décision vit dans
// `data/tutorialScript.ts`, en fonctions pures — donc testée.
//
// Deux effets de bord, et deux seulement : la vitesse de combat passe à ×1 au
// montage (×2 est illisible quand on découvre), et `coachBlocking` gèle les
// chronos tant qu'une bulle attend un tap — sans quoi le combat se lancerait
// tout seul au milieu d'une explication.
import { useEffect, useMemo, useState } from 'react';
import { useGameStore } from '../../stores/gameStore.js';
import { useUiStore } from '../../stores/uiStore.js';
import { updateProgress } from '../../data/tutorialProgress.js';
import { advanceGameSteps, gameCoachStep, gameTutorialComplete } from '../../data/tutorialScript.js';
import { useWebLayout } from '../system/useWebLayout.js';
import CoachBubble from './CoachBubble.js';

export default function TutorialCoach() {
  const navigate = useUiStore(s => s.navigate);
  const controller = useGameStore(s => s.controller);
  const web = useWebLayout();

  // Projection minimale du snapshot : que des scalaires, donc pas de nouvelle
  // référence à chaque rendu et pas de boucle d'effets.
  const round = useGameStore(s => s.round);
  const placedCount = useGameStore(s => s.placedCount);
  const handSelected = useGameStore(s => s.hand.some(e => e.selected));
  const synergyCount = useGameStore(s => s.synergies.length);
  const combatActive = useGameStore(s => s.combatActive);
  const hasEndRound = useGameStore(s => s.endRound !== null);
  const shopping = useGameStore(s => s.shopping !== null);
  const gameOver = useGameStore(s => s.gameOver);
  const menuOpen = useGameStore(s => s.menuOpen);
  // L'ouverture de tour (annonce + popup de pioche) : le script s'efface
  // derrière elle — la décision vit dans `gameCoachStep`, ici on ne fait que
  // lui rapporter l'état.
  const roundOpening = useGameStore(s => s.roundIntro !== null || s.drawPopup !== null);

  const [seen, setSeen] = useState<ReadonlySet<string>>(() => new Set<string>());

  const state = useMemo(
    () => ({ round, placedCount, handSelected, synergyCount, combatActive, hasEndRound, shopping, gameOver, roundOpening }),
    [round, placedCount, handSelected, synergyCount, combatActive, hasEndRound, shopping, gameOver, roundOpening],
  );

  // Un combat ×2 défile trop vite pour qu'on y comprenne quoi que ce soit.
  useEffect(() => { controller?.setSpeed(1); }, [controller]);

  useEffect(() => {
    setSeen(prev => {
      const next = advanceGameSteps(state, prev);
      // Même taille = rien de nouveau : on renvoie la référence d'origine pour
      // ne pas relancer le rendu en boucle.
      return next.size === prev.size ? prev : next;
    });
  }, [state]);

  // La boucle a été vue en entier une fois le tour 2 entamé : c'est là que le
  // joueur a tout traversé (placement, combat, dégâts, magie, survivants).
  useEffect(() => {
    if (gameTutorialComplete(seen)) updateProgress({ game: true });
  }, [seen]);

  const step = gameCoachStep(state, seen);
  // Le menu d'options est modal et gèle déjà la partie : deux bulles
  // superposées ne diraient rien de plus.
  const visible = step != null && !menuOpen;
  const blocking = visible && step.blocking;

  useEffect(() => {
    useGameStore.getState().applySnapshot({ coachBlocking: blocking });
  }, [blocking]);

  // Le drapeau ne doit jamais survivre au coach : une partie normale lancée
  // ensuite trouverait ses chronos gelés.
  useEffect(() => () => { useGameStore.getState().applySnapshot({ coachBlocking: false }); }, []);

  if (!visible) return null;

  const terminal = step.id === 'done';
  // Une modale occupe le centre pendant ces trois moments (récapitulatif de
  // round, Phase Shopping, fin de partie) : la bulle passe alors en haut, à la
  // hauteur des bannières, plutôt que de se cacher derrière.
  const top = hasEndRound || shopping || gameOver;
  // Sinon elle se pose au-dessus des contrôles de phase — et, en portrait,
  // au-dessus de la MAIN : l'étape qui demande de taper une carte ne peut pas
  // être celle qui les recouvre. En mode web la main est un rail à gauche, le
  // bas de l'écran est libre.
  const bottom = web
    ? 'bottom-[max(4.5rem,calc(env(safe-area-inset-bottom)+4rem))]'
    : 'bottom-[max(12rem,calc(env(safe-area-inset-bottom)+11.5rem))]';

  return (
    <div className={`pointer-events-none fixed inset-x-0 z-50 flex justify-center px-3 ${
      top ? 'top-[max(4rem,calc(env(safe-area-inset-top)+3.5rem))]' : bottom
    }`}>
      <CoachBubble
        className="w-full max-w-sm"
        title={step.title}
        text={step.text}
        action={terminal ? '▸ Construire mon deck' : step.blocking ? 'Compris ▸' : undefined}
        onAction={() => {
          if (terminal) { navigate('deck_builder', { tutorial: true, mode: 'manage' }); return; }
          setSeen(prev => new Set(prev).add(step.id));
        }}
      />
    </div>
  );
}
