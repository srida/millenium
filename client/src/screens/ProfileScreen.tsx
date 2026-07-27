/* eslint-disable @typescript-eslint/no-explicit-any */
// ProfileScreen — édition du profil (pseudo, avatar) via /profile/me.
// L'utilisateur modifie lui-même ses données ; le compte doit être connecté.
import { useState } from 'react';
import * as AuthClient from '../data/AuthClient.js';
import { useAuthStore } from '../stores/authStore.js';
import { useUiStore } from '../stores/uiStore.js';
import { Button } from '../components/ui/primitives.js';
import { ProgressionPanel } from '../components/ui/ProgressionStats.js';

export default function ProfileScreen() {
  const navigate = useUiStore(s => s.navigate);
  const user = useAuthStore(s => s.user);
  const setUser = useAuthStore(s => s.setUser);

  const [username, setUsername] = useState(user?.username ?? '');
  const [avatar, setAvatar] = useState<string>((user as any)?.avatar ?? '');
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

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
  const isImg = /^(https?:|data:)/i.test(avatarPreview);

  return (
    <main className="flex min-h-dvh flex-col bg-surface text-white">
      <header className="flex items-center gap-3 border-b border-line px-4 py-3">
        <Button className="px-3" onPointerDown={() => navigate('main_menu')}>◂</Button>
        <h1 className="text-lg font-bold tracking-wide">Profil</h1>
        <span className="ml-auto text-xs text-white/40">#{(user as any).tag ?? '—'}</span>
      </header>

      <div className="flex flex-1 flex-col items-center gap-5 p-6">
        <div className="flex h-24 w-24 items-center justify-center overflow-hidden rounded-full border border-gold/40 bg-surface-raised text-3xl">
          {avatarPreview
            ? (isImg ? <img src={avatarPreview} alt="" className="h-full w-full object-cover" /> : <span>{avatarPreview.slice(0, 2)}</span>)
            : <span>{user.username.slice(0, 1).toUpperCase()}</span>}
        </div>

        {/* Progression : lecture seule, au-dessus des champs éditables. */}
        <ProgressionPanel user={user} />

        <div className="flex w-full max-w-xs flex-col gap-3">
          <label className="text-[10px] tracking-widest text-white/40">PSEUDO</label>
          <input
            value={username} maxLength={20} onChange={(e) => { setUsername(e.target.value); setSaved(false); }}
            className="min-h-tap rounded-lg border border-line bg-surface-raised px-3 text-sm text-white"
          />
          <label className="text-[10px] tracking-widest text-white/40">AVATAR (emoji, ou URL d'image)</label>
          <input
            value={avatar} onChange={(e) => { setAvatar(e.target.value); setSaved(false); }}
            placeholder="🐉 ou https://…"
            className="min-h-tap rounded-lg border border-line bg-surface-raised px-3 text-sm text-white placeholder:text-white/30"
          />
          {error && <p className="text-xs text-danger">{error}</p>}
          {saved && <p className="text-xs text-success">✓ Profil enregistré</p>}
          <Button variant="primary" disabled={busy || !username.trim()} className="w-full" onPointerDown={save}>
            {busy ? '…' : 'Enregistrer'}
          </Button>
          <Button className="w-full" onPointerDown={() => navigate('friends')}>Mes amis →</Button>
        </div>
      </div>
    </main>
  );
}
