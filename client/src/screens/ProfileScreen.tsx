/* eslint-disable @typescript-eslint/no-explicit-any */
// ProfileScreen — édition du profil (pseudo, avatar) via /profile/me,
// plus la section Amis (recherche, demandes, liste) via /users/search et /friends.
import { useEffect, useState, useCallback, type ReactNode } from 'react';
import * as AuthClient from '../data/AuthClient.js';
import { illustrationUrl } from '../data/CardArt.js';
import { useAuthStore } from '../stores/authStore.js';
import { useCosmeticStore } from '../stores/cosmeticStore.js';
import { useUiStore } from '../stores/uiStore.js';
import { Button } from '../components/ui/primitives.js';
import { ScreenHeader } from '../components/ui/ScreenHeader.js';
import { LevelRewardsPanel, ProgressionPanel } from '../components/ui/ProgressionStats.js';
import type { LevelRewardsView } from '../components/ui/ProgressionStats.js';
import { GuestGate } from '../components/ui/GuestGate.js';

interface UserRow { id: string; username: string; tag?: number; avatar?: string | null; relation?: string; friendship_id?: string }

function FriendAvatar({ u }: { u: UserRow }) {
  const a = u.avatar ?? '';
  const isImg = /^(https?:|data:|\/)/i.test(a);
  return (
    <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center overflow-hidden rounded-full border border-line bg-surface text-sm">
      {a ? (isImg ? <img src={a} alt="" className="h-full w-full object-cover" /> : <span>{a.slice(0, 2)}</span>) : <span>{u.username.slice(0, 1).toUpperCase()}</span>}
    </div>
  );
}

function FriendRow({ u, children }: { u: UserRow; children?: ReactNode }) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-line bg-surface-raised/60 p-2">
      <FriendAvatar u={u} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-semibold">{u.username}</div>
        {u.tag != null && <div className="text-[10px] text-white/40">#{u.tag}</div>}
      </div>
      {children}
    </div>
  );
}

function FriendSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h2 className="mb-1.5 text-[10px] tracking-widest text-white/40">{title.toUpperCase()}</h2>
      <div className="space-y-1.5">{children}</div>
    </section>
  );
}

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

  // Section Amis — recherche de joueurs, demandes (entrantes/sortantes), liste.
  const [friendQuery, setFriendQuery] = useState('');
  const [friendResults, setFriendResults] = useState<UserRow[]>([]);
  const [friends, setFriends] = useState<UserRow[]>([]);
  const [incoming, setIncoming] = useState<UserRow[]>([]);
  const [outgoing, setOutgoing] = useState<UserRow[]>([]);
  const [friendsError, setFriendsError] = useState<string | null>(null);

  // Une session expirée côté serveur (cookie effacé, serveur redémarré) ne doit
  // pas se lire comme une erreur de la page : on repasse en invité, l'écran
  // propose alors « Se connecter ».
  const handleFriendsError = useCallback((e: any) => {
    if (e?.status === 401) { setUser(null); return; }
    setFriendsError(e?.message ?? 'Erreur');
  }, [setUser]);

  const refreshFriends = useCallback(async () => {
    setFriendsError(null);
    try {
      const [f, r] = await Promise.all([(AuthClient as any).getFriends(), (AuthClient as any).getRequests()]);
      setFriends(f); setIncoming(r.incoming); setOutgoing(r.outgoing);
    } catch (e: any) { handleFriendsError(e); }
  }, [handleFriendsError]);

  useEffect(() => { if (user) refreshFriends(); }, [user, refreshFriends]);

  // Recherche débouncée.
  useEffect(() => {
    if (friendQuery.trim().length < 2) { setFriendResults([]); return; }
    const t = setTimeout(async () => {
      try { setFriendResults(await (AuthClient as any).searchUsers(friendQuery.trim())); setFriendsError(null); }
      catch (e: any) { setFriendResults([]); handleFriendsError(e); }
    }, 300);
    return () => clearTimeout(t);
  }, [friendQuery, handleFriendsError]);

  if (!user) return <GuestGate reason="Connecte-toi pour accéder à ton profil." />;

  const friendAct = (fn: () => Promise<any>) => async () => {
    setFriendsError(null);
    try {
      await fn(); await refreshFriends();
      if (friendQuery.trim().length >= 2) setFriendResults(await (AuthClient as any).searchUsers(friendQuery.trim()));
    } catch (e: any) { handleFriendsError(e); }
  };

  async function save() {
    setError(null); setSaved(false); setBusy(true);
    try {
      const updated = await (AuthClient as any).updateProfile({
        username: username.trim(),
        avatar: avatar.trim() || null,
      });
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
    <main className="flex min-h-dvh flex-col relative z-10 text-white">
      <ScreenHeader
        title="Profil"
        onBack={() => navigate('main_menu')}
        right={<span className="text-xs text-white/40">#{(user as any).tag ?? '—'}</span>}
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
            className="min-h-tap rounded-lg border border-line bg-surface-raised px-3 text-white"
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
        </div>

        <div className="w-full max-w-xs space-y-5">
          <h2 className="text-[10px] tracking-widest text-white/40">AMIS</h2>

          {friendsError && (
            <div className="flex items-center gap-2 rounded-lg border border-danger/40 bg-danger/10 p-2">
              <p className="flex-1 text-xs text-danger">{friendsError}</p>
              <Button className="px-2 text-xs" onPointerDown={() => { void refreshFriends(); }}>Réessayer</Button>
            </div>
          )}

          <section>
            <input
              value={friendQuery} onChange={(e) => setFriendQuery(e.target.value)} placeholder="Rechercher un joueur (2+ lettres)…"
              className="min-h-tap w-full rounded-lg border border-line bg-surface-raised px-3 text-white placeholder:text-white/30"
            />
            <div className="mt-2 space-y-1.5">
              {friendResults.map(u => (
                <FriendRow key={u.id} u={u}>
                  {u.relation === 'friends' ? <span className="text-xs text-success">Ami</span>
                    : u.relation === 'outgoing' ? <span className="text-xs text-white/40">Envoyée</span>
                    : u.relation === 'incoming' ? <Button className="px-2 text-xs" onPointerDown={friendAct(() => (AuthClient as any).sendRequest(u.id))}>Accepter</Button>
                    : <Button variant="primary" className="px-2 text-xs" onPointerDown={friendAct(() => (AuthClient as any).sendRequest(u.id))}>+ Ajouter</Button>}
                </FriendRow>
              ))}
            </div>
          </section>

          {incoming.length > 0 && (
            <FriendSection title={`Demandes reçues · ${incoming.length}`}>
              {incoming.map(u => (
                <FriendRow key={u.friendship_id} u={u}>
                  <Button variant="primary" className="px-2 text-xs" onPointerDown={friendAct(() => (AuthClient as any).acceptRequest(u.friendship_id))}>✓</Button>
                  <Button variant="danger" className="px-2 text-xs" onPointerDown={friendAct(() => (AuthClient as any).declineRequest(u.friendship_id))}>✕</Button>
                </FriendRow>
              ))}
            </FriendSection>
          )}

          {outgoing.length > 0 && (
            <FriendSection title={`Demandes envoyées · ${outgoing.length}`}>
              {outgoing.map(u => (
                <FriendRow key={u.friendship_id} u={u}>
                  <Button className="px-2 text-xs" onPointerDown={friendAct(() => (AuthClient as any).removeFriend(u.friendship_id))}>Annuler</Button>
                </FriendRow>
              ))}
            </FriendSection>
          )}

          <FriendSection title={`Mes amis · ${friends.length}`}>
            {friends.length === 0
              ? <p className="text-xs text-white/40">Aucun ami pour l'instant.</p>
              : friends.map(u => (
                <FriendRow key={u.friendship_id} u={u}>
                  <Button variant="danger" className="px-2 text-xs" onPointerDown={friendAct(() => (AuthClient as any).removeFriend(u.friendship_id))}>Retirer</Button>
                </FriendRow>
              ))}
          </FriendSection>
        </div>

        <div className="w-full max-w-xs">
          <button onPointerDown={() => { logout(); navigate('main_menu'); }} className="w-full text-center text-xs text-white/50 underline">
            Se déconnecter
          </button>
        </div>
      </div>
    </main>
  );
}
