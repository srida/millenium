/* eslint-disable @typescript-eslint/no-explicit-any */
// ProfileScreen — édition du profil (pseudo, avatar) via /profile/me.
// L'utilisateur modifie lui-même ses données ; le compte doit être connecté.
import { useEffect, useState } from 'react';
import * as AuthClient from '../data/AuthClient.js';
import { illustrationUrl } from '../data/CardDatabase.js';
import { useAuthStore } from '../stores/authStore.js';
import { useCosmeticStore } from '../stores/cosmeticStore.js';
import { useUiStore } from '../stores/uiStore.js';
import { Button } from '../components/ui/primitives.js';
import { ScreenHeader } from '../components/ui/ScreenHeader.js';
import { LevelRewardsPanel, ProgressionPanel } from '../components/ui/ProgressionStats.js';
import type { LevelRewardsView } from '../components/ui/ProgressionStats.js';

// Les avatars portables viennent du SERVEUR (cosmetics.js) : les offerts
// d'office, puis ceux achetés dans l'onglet cosmétique de la boutique. La
// liste n'est plus codée ici — c'est le serveur qui valide l'enregistrement,
// les deux ne doivent pas pouvoir diverger.
//
// Repli si l'appel échoue : les 7 avatars de la dotation de départ, pour que
// l'écran ne se retrouve jamais sans aucun choix.
const FALLBACK_AVATARS = ['CORE_001', 'CORE_002', 'CORE_003', 'CORE_004', 'CORE_005', 'CORE_006', 'CORE_007'];

export default function ProfileScreen() {
  const navigate = useUiStore(s => s.navigate);
  const user = useAuthStore(s => s.user);
  const setUser = useAuthStore(s => s.setUser);
  const logout = useAuthStore(s => s.logout);

  const [username, setUsername] = useState(user?.username ?? '');
  const [avatar, setAvatar] = useState<string>((user as any)?.avatar ?? '');
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  const loadCosmetics = useCosmeticStore(s => s.load);
  const selectableAvatars = useCosmeticStore(s => s.selectableAvatars);
  const cosmeticSnapshot = useCosmeticStore(s => s.snapshot);
  useEffect(() => { void loadCosmetics(); }, [loadCosmetics]);
  const avatarIds = cosmeticSnapshot ? selectableAvatars() : FALLBACK_AVATARS;

  // Paliers de niveau : le BARÈME vient du serveur (levels.js) plutôt que
  // d'être recopié ici — les deux ne peuvent donc pas diverger. Pas de store
  // dédié : la donnée ne sert qu'à cet écran et ne survit pas à sa fermeture.
  // La réponse porte aussi la collection complète, déjà chargée ailleurs :
  // c'est le prix d'un appel de moins à écrire côté serveur.
  const [levels, setLevels] = useState<LevelRewardsView | null>(null);
  const [levelsBust, setLevelsBust] = useState(0);
  useEffect(() => {
    let alive = true;
    (AuthClient as any).getProgression()
      .then((p: any) => { if (alive) setLevels(p?.levels ?? null); })
      .catch(() => { /* section masquée : elle n'a rien d'indispensable */ });
    return () => { alive = false; };
    // Rechargé après une récupération : les paliers en attente ont bougé, et le
    // prochain rendez-vous avec.
  }, [levelsBust]);

  if (!user) {
    return (
      <main className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-surface p-6 text-white">
        <p className="text-sm text-white/60">Connecte-toi pour accéder à ton profil.</p>
        <Button variant="primary" onPointerDown={() => navigate('auth')}>Se connecter</Button>
        <Button onPointerDown={() => navigate('main_menu')}>◂ Menu</Button>
      </main>
    );
  }

  async function save() {
    setError(null); setSaved(false); setBusy(true);
    try {
      const updated = await (AuthClient as any).updateProfile({ username: username.trim(), avatar: avatar.trim() || null });
      setUser(updated);
      setSaved(true);
    } catch (e: any) {
      setError(e?.message ?? 'Erreur');
    } finally {
      setBusy(false);
    }
  }

  const avatarPreview = avatar.trim();
  const isImg = /^(https?:|data:|\/)/i.test(avatarPreview);

  return (
    <main className="flex min-h-dvh flex-col bg-surface text-white">
      <ScreenHeader
        title="Profil"
        onBack={() => navigate('main_menu')}
        right={<span className="text-xs text-white/40">#{(user as any).tag ?? '—'}</span>}
        safeAreaTop
      />

      <div className="flex flex-1 flex-col items-center gap-5 p-6">
        <div className="flex h-24 w-24 items-center justify-center overflow-hidden rounded-full border border-gold/40 bg-surface-raised text-3xl">
          {avatarPreview
            ? (isImg ? <img src={avatarPreview} alt="" className="h-full w-full object-cover" /> : <span>{avatarPreview.slice(0, 2)}</span>)
            : <span>{user.username.slice(0, 1).toUpperCase()}</span>}
        </div>

        {/* Progression : lecture seule, au-dessus des champs éditables. Le
            détail des paliers suit la jauge — « où j'en suis », puis « ce que
            ça me rapportera ». */}
        <ProgressionPanel user={user} />
        <LevelRewardsPanel user={user} levels={levels} onClaimed={() => setLevelsBust(n => n + 1)} />

        <div className="flex w-full max-w-xs flex-col gap-3">
          <label className="text-[10px] tracking-widest text-white/40">PSEUDO</label>
          <input
            value={username} maxLength={20} onChange={(e) => { setUsername(e.target.value); setSaved(false); }}
            className="min-h-tap rounded-lg border border-line bg-surface-raised px-3 text-sm text-white"
          />
          <div className="flex items-baseline justify-between">
            <label className="text-[10px] tracking-widest text-white/40">AVATAR</label>
            <button
              onPointerDown={() => navigate('shop')}
              className="text-[10px] text-white/40 underline"
            >
              En débloquer d'autres →
            </button>
          </div>
          <div className="grid grid-cols-4 gap-2">
            {avatarIds.map((id) => {
              const url = illustrationUrl(id);
              const selected = avatar === url;
              return (
                <button
                  key={id}
                  type="button"
                  onPointerDown={() => { setAvatar(url); setSaved(false); }}
                  aria-label={`Avatar ${id}`}
                  className={`aspect-square overflow-hidden rounded-lg border ${selected ? 'border-gold' : 'border-line'} bg-surface-raised active:opacity-80`}
                >
                  <img src={url} alt="" className="h-full w-full object-cover" />
                </button>
              );
            })}
          </div>
          {error && <p className="text-xs text-danger">{error}</p>}
          {saved && <p className="text-xs text-success">✓ Profil enregistré</p>}
          <Button variant="primary" disabled={busy || !username.trim()} className="w-full" onPointerDown={save}>
            {busy ? '…' : 'Enregistrer'}
          </Button>
          <Button className="w-full" onPointerDown={() => navigate('friends')}>Mes amis →</Button>
          <button onPointerDown={() => { logout(); navigate('main_menu'); }} className="w-full text-center text-xs text-white/50 underline">
            Se déconnecter
          </button>
        </div>
      </div>
    </main>
  );
}
