// « Cet écran demande un compte » — écrit une fois.
//
// Le bloc était recopié dans SEPT écrans (Missions, Boutique, Cadeaux, Profil,
// Amis, Duel en ligne, Arcade), à chaque fois avec le même squelette et une
// seule phrase de différence. Et la copie diverge : celle de l'Arcade avait
// perdu son bouton « ◂ Menu », laissant l'invité sans autre issue que de
// s'inscrire — alors que la branche voisine du même fichier, elle, l'avait.
//
// ⚠️ Le retour au menu N'EST PAS OPTIONNEL. Ces écrans sont atteignables par
// `?screen=…` et une session expirée y atterrit toute seule : sans lui, l'écran
// est un cul-de-sac. C'est justement pour ça qu'il vit ici et non chez chaque
// appelant — un composant ne peut pas l'oublier.
import { useUiStore } from '../../stores/uiStore.js';
import { Button } from './primitives.js';

export function GuestGate({ reason }: {
  /** Pourquoi CET écran a besoin d'un compte. Une phrase, à la deuxième
   *  personne : le joueur doit comprendre ce qu'il gagne à s'inscrire, pas
   *  seulement qu'on lui refuse la porte. */
  reason: string;
}) {
  const navigate = useUiStore(s => s.navigate);
  return (
    <main className="relative z-10 flex min-h-dvh flex-col items-center justify-center gap-4 p-6 text-center text-white">
      <p className="max-w-xs text-sm text-white/60">{reason}</p>
      <Button variant="primary" onPointerDown={() => navigate('auth')}>Se connecter</Button>
      <Button onPointerDown={() => navigate('main_menu')}>◂ Menu</Button>
    </main>
  );
}

export default GuestGate;
