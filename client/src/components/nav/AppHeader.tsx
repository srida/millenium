// AppHeader — en-tête commun à TOUTES les pages (accueil compris) : profil ou
// invite à se connecter à gauche, progression à droite. Ni titre, ni bouton
// retour : la navigation retour se fait via le raccourci Accueil du footer
// (`AppFooter`), pas par un bouton du header. Le lien Admin vit désormais
// dans la popup Outils dev de l'accueil, pas ici (cf. `DevMenu` dans
// `MainMenu.tsx`).
//
// Rendu une seule fois par `App.tsx`, jamais par un écran — comme le décor
// spatial (`SpaceBackground`), pour que le compte et sa progression restent
// visibles au même endroit partout, sans que chaque écran ait à le reposer.
import { useAuthStore } from '../../stores/authStore.js';
import { useUiStore } from '../../stores/uiStore.js';
import { FullscreenButton } from '../system/DeviceGuards.js';
import { ProgressionPills, ProfilePill } from '../ui/ProgressionStats.js';

export function AppHeader() {
  const navigate = useUiStore(s => s.navigate);
  const user = useAuthStore(s => s.user);

  return (
    <header className="sticky top-0 z-20 shrink-0 border-b border-line bg-surface">
      <div className="flex min-h-tap items-center gap-2 px-4 py-3 pt-[max(0.75rem,env(safe-area-inset-top))] text-xs sm:text-sm">
        {user ? (
          // ⚠️ `min-w-0` : c'est le PSEUDO qui cède quand la ligne déborde, pas
          // les soldes. Un nom tronqué se lit encore ; un « 1 24… » de gold
          // serait un chiffre faux.
          <ProfilePill user={user} compact className="min-w-0" onPointerDown={() => navigate('profile')} />
        ) : (
          <button
            type="button"
            onPointerDown={() => navigate('auth')}
            className="flex min-h-tap items-center rounded-full border border-dashed border-gold/60 px-3 text-xs font-semibold text-gold active:opacity-80"
          >
            Connexion
          </button>
        )}
        <div className="flex-1" />
        {/* `shrink-0` : le pendant du `min-w-0` ci-dessus — les pastilles de
            progression gardent leur largeur, la ligne se reprend sur le pseudo. */}
        {user && <ProgressionPills user={user} className="shrink-0" onOpen={() => navigate('profile')} />}
        <FullscreenButton className="hidden sm:flex" />
      </div>
    </header>
  );
}
