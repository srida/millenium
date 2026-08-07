// Coach du DeckBuilder guidé.
//
// Il ne réimplémente aucune règle : `MIN_DECK`, le plafond par tier
// (`min(8, pool)`) et les compteurs sont déjà calculés à chaque rendu par le
// DeckBuilder, qui les lui passe. Le coach ne fait que les traduire en une
// phrase — et il n'a pas d'index d'étape, seulement l'état : un joueur qui
// retire des cartes revient donc naturellement au message précédent.
//
// Rendu EN FLUX, juste au-dessus du pied de page, plutôt qu'en surimpression :
// la grille de cartes est déjà dense, une bulle flottante y cacherait
// forcément quelque chose.
import { deckCoachStep, type DeckCoachState } from '../../data/tutorialScript.js';
import CoachBubble from './CoachBubble.js';

export default function DeckCoach(props: DeckCoachState) {
  const step = deckCoachStep(props);
  if (!step) return null;

  return (
    <div className="border-t border-line bg-surface/95 px-3 pt-3">
      <CoachBubble title={step.title} text={step.text} />
    </div>
  );
}
