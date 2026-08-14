// En-tête commun aux écrans secondaires (retour, titre, contenu propre à
// l'écran) — avec le statut du joueur toujours aligné à droite. En web,
// niveau + gold + gemmes s'ajoutent au profil ; en mobile, seul le profil
// reste (la place manque, et les écrans qui ont besoin de leurs soldes en
// jeu — ex. ShopScreen — portent leur propre affichage compact).
// Rien n'est rendu côté joueur en invité, comme partout ailleurs.
//
// ⚠️ L'en-tête est COLLANT (`sticky top-0`) : le bouton « retour » doit rester
// à portée de pouce quel que soit le défilement. Les écrans dont le contenu
// scrolle en interne (`flex-1 overflow-y-auto`) le pinnaient déjà de fait ;
// ceux qui laissent scroller le document (Boutique, Missions, Cadeaux, Profil,
// Tutoriel) emportaient le retour hors de l'écran. Le fond doit rester OPAQUE
// (`bg-surface`, pas de `backdrop-blur`) : le contenu passe dessous, et un
// `backdrop-filter` créerait un bloc conteneur qui piégerait les `position:
// fixed` de ses descendants (cf. le portail de `ConfirmBuy`).
import type { ReactNode } from 'react';
import { useAuthStore } from '../../stores/authStore.js';
import { useUiStore } from '../../stores/uiStore.js';
import { Button } from './primitives.js';
import { ProgressionPills, ProfilePill } from './ProgressionStats.js';

export function ScreenHeader({
  title,
  onBack,
  right,
  subtitle,
  below,
  safeAreaTop = false,
  className = '',
}: {
  title: string;
  onBack: () => void;
  right?: ReactNode;
  subtitle?: ReactNode;
  /** Barre pleine largeur épinglée AVEC l'en-tête (onglets de la Boutique, du
   *  Deck-building…) — hors du padding, sous la ligne titre. */
  below?: ReactNode;
  safeAreaTop?: boolean;
  className?: string;
}) {
  const user = useAuthStore(s => s.user);
  const navigate = useUiStore(s => s.navigate);

  return (
    <header className={`sticky top-0 z-20 shrink-0 border-b border-line bg-surface ${className}`}>
      <div className={`px-4 py-3 ${safeAreaTop ? 'pt-[max(0.75rem,env(safe-area-inset-top))]' : ''}`}>
        {/* Ordre de sacrifice quand la largeur manque (mobile) : le pseudo se
            tronque en premier (`shrink-[4]`), le titre ensuite, le retour
            jamais. Sans ces bornes, la pastille de profil débordait l'écran
            par la droite — l'en-tête étant épinglé, ce débordement resterait
            désormais visible en permanence. */}
        <div className="flex items-center gap-3">
          <Button className="shrink-0 px-3" onPointerDown={onBack}>◂</Button>
          <h1 className="truncate text-lg font-bold tracking-wide">{title}</h1>
          <div className="ml-auto flex min-w-0 shrink-[4] items-center gap-3">
            {right}
            {user && (
              <>
                {/* Même geste qu'au menu : la jauge de niveau mène au Profil,
                    où les paliers à venir sont annoncés. */}
                <ProgressionPills user={user} className="hidden shrink-0 sm:flex" onOpen={() => navigate('profile')} />
                <ProfilePill user={user} compact className="min-w-0" onPointerDown={() => navigate('profile')} />
              </>
            )}
          </div>
        </div>
        {subtitle}
      </div>
      {below}
    </header>
  );
}
