// MainMenu — hub : jouer (→ sélection de deck), gérer ses decks, se connecter /
// déconnecter (auth optionnelle, D2). Lien dev vers le CombatLab.
import { useUiStore } from '../stores/uiStore.js';
import { useAuthStore } from '../stores/authStore.js';
import { Button } from '../components/ui/primitives.js';
import { FullscreenButton } from '../components/system/DeviceGuards.js';

export default function MainMenu() {
  const navigate = useUiStore(s => s.navigate);
  const user = useAuthStore(s => s.user);
  const logout = useAuthStore(s => s.logout);

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-6 bg-surface p-6 pt-[max(1.5rem,env(safe-area-inset-top))] text-white">
      <FullscreenButton className="absolute right-3 top-[max(0.75rem,env(safe-area-inset-top))]" />
      <div className="text-center">
        <h1 className="text-4xl font-bold tracking-[0.2em] text-gold">MILLENIUM</h1>
        <p className="mt-1 text-sm text-white/50">Auto-battler tactique</p>
      </div>

      <div className="flex w-full max-w-xs flex-col gap-3">
        <Button variant="primary" className="w-full py-3 text-base" onPointerDown={() => navigate('deck_selector')}>
          Jouer
        </Button>
        <Button className="w-full" onPointerDown={() => navigate('deck_builder')}>
          Construire un deck
        </Button>
        <div className="flex gap-2">
          <Button className="flex-1 text-xs opacity-70" onPointerDown={() => navigate('testbench')}>
            TestBench (dev)
          </Button>
          <Button className="flex-1 text-xs opacity-70" onPointerDown={() => navigate('combatlab')}>
            CombatLab (dev)
          </Button>
        </div>
      </div>

      <div className="flex flex-col items-center gap-2 text-xs">
        {user ? (
          <>
            <div className="flex gap-3">
              <button onPointerDown={() => navigate('profile')} className="text-white/70 underline">Profil</button>
              <button onPointerDown={() => navigate('friends')} className="text-white/70 underline">Amis</button>
            </div>
            <span className="text-white/60">Connecté : <span className="font-semibold text-gold">{user.username}</span></span>
            <button onPointerDown={() => logout()} className="text-white/50 underline">Se déconnecter</button>
          </>
        ) : (
          <button onPointerDown={() => navigate('auth')} className="text-white/60 underline">Se connecter / créer un compte</button>
        )}
      </div>
    </main>
  );
}
