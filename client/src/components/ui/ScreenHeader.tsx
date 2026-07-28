// En-tête commun aux écrans secondaires (retour, titre, contenu propre à
// l'écran) — avec le statut du joueur toujours aligné à droite. En web,
// niveau + gold + gemmes s'ajoutent au profil ; en mobile, seul le profil
// reste (la place manque, et les écrans qui ont besoin de leurs soldes en
// jeu — ex. ShopScreen — portent leur propre affichage compact).
// Rien n'est rendu côté joueur en invité, comme partout ailleurs.
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
  safeAreaTop = false,
  className = '',
}: {
  title: string;
  onBack: () => void;
  right?: ReactNode;
  subtitle?: ReactNode;
  safeAreaTop?: boolean;
  className?: string;
}) {
  const user = useAuthStore(s => s.user);
  const navigate = useUiStore(s => s.navigate);

  return (
    <header
      className={`border-b border-line px-4 py-3 ${safeAreaTop ? 'pt-[max(0.75rem,env(safe-area-inset-top))]' : ''} ${className}`}
    >
      <div className="flex items-center gap-3">
        <Button className="px-3" onPointerDown={onBack}>◂</Button>
        <h1 className="text-lg font-bold tracking-wide">{title}</h1>
        <div className="ml-auto flex items-center gap-3">
          {right}
          {user && (
            <>
              <ProgressionPills user={user} className="hidden sm:flex" />
              <ProfilePill user={user} onPointerDown={() => navigate('profile')} />
            </>
          )}
        </div>
      </div>
      {subtitle}
    </header>
  );
}
