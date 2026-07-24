/* eslint-disable @typescript-eslint/no-explicit-any */
// FriendsScreen — recherche de joueurs, demandes d'ami (entrantes/sortantes),
// liste d'amis. CRUD sur /users/search et /friends via AuthClient.
import { useEffect, useState, useCallback, type ReactNode } from 'react';
import * as AuthClient from '../data/AuthClient.js';
import { useAuthStore } from '../stores/authStore.js';
import { useUiStore } from '../stores/uiStore.js';
import { Button } from '../components/ui/primitives.js';

interface UserRow { id: string; username: string; tag?: number; avatar?: string | null; relation?: string; friendship_id?: string }

function Avatar({ u }: { u: UserRow }) {
  const a = u.avatar ?? '';
  const isImg = /^(https?:|data:)/i.test(a);
  return (
    <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center overflow-hidden rounded-full border border-line bg-surface text-sm">
      {a ? (isImg ? <img src={a} alt="" className="h-full w-full object-cover" /> : <span>{a.slice(0, 2)}</span>) : <span>{u.username.slice(0, 1).toUpperCase()}</span>}
    </div>
  );
}

function Row({ u, children }: { u: UserRow; children?: ReactNode }) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-line bg-surface-raised/60 p-2">
      <Avatar u={u} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-semibold">{u.username}</div>
        {u.tag != null && <div className="text-[10px] text-white/40">#{u.tag}</div>}
      </div>
      {children}
    </div>
  );
}

export default function FriendsScreen() {
  const navigate = useUiStore(s => s.navigate);
  const user = useAuthStore(s => s.user);

  const [query, setQuery] = useState('');
  const [results, setResults] = useState<UserRow[]>([]);
  const [friends, setFriends] = useState<UserRow[]>([]);
  const [incoming, setIncoming] = useState<UserRow[]>([]);
  const [outgoing, setOutgoing] = useState<UserRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [f, r] = await Promise.all([(AuthClient as any).getFriends(), (AuthClient as any).getRequests()]);
      setFriends(f); setIncoming(r.incoming); setOutgoing(r.outgoing);
    } catch (e: any) { setError(e?.message ?? 'Erreur'); }
  }, []);

  useEffect(() => { if (user) refresh(); }, [user, refresh]);

  // Recherche débouncée.
  useEffect(() => {
    if (query.trim().length < 2) { setResults([]); return; }
    const t = setTimeout(async () => {
      try { setResults(await (AuthClient as any).searchUsers(query.trim())); }
      catch { /* ignore */ }
    }, 300);
    return () => clearTimeout(t);
  }, [query]);

  if (!user) {
    return (
      <main className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-surface p-6 text-white">
        <p className="text-sm text-white/60">Connecte-toi pour gérer tes amis.</p>
        <Button variant="primary" onPointerDown={() => navigate('auth')}>Se connecter</Button>
        <Button onPointerDown={() => navigate('main_menu')}>◂ Menu</Button>
      </main>
    );
  }

  const act = (fn: () => Promise<any>) => async () => {
    setError(null);
    try { await fn(); await refresh(); if (query.trim().length >= 2) setResults(await (AuthClient as any).searchUsers(query.trim())); }
    catch (e: any) { setError(e?.message ?? 'Erreur'); }
  };

  return (
    <main className="flex min-h-dvh flex-col bg-surface text-white">
      <header className="flex items-center gap-3 border-b border-line px-4 py-3">
        <Button className="px-3" onPointerDown={() => navigate('main_menu')}>◂</Button>
        <h1 className="text-lg font-bold tracking-wide">Amis</h1>
      </header>

      <div className="flex-1 space-y-5 overflow-y-auto p-4">
        {error && <p className="text-xs text-danger">{error}</p>}

        <section>
          <input
            value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Rechercher un joueur (2+ lettres)…"
            className="min-h-tap w-full rounded-lg border border-line bg-surface-raised px-3 text-sm text-white placeholder:text-white/30"
          />
          <div className="mt-2 space-y-1.5">
            {results.map(u => (
              <Row key={u.id} u={u}>
                {u.relation === 'friends' ? <span className="text-xs text-success">Ami</span>
                  : u.relation === 'outgoing' ? <span className="text-xs text-white/40">Envoyée</span>
                  : u.relation === 'incoming' ? <Button className="px-2 text-xs" onPointerDown={act(() => (AuthClient as any).sendRequest(u.id))}>Accepter</Button>
                  : <Button variant="primary" className="px-2 text-xs" onPointerDown={act(() => (AuthClient as any).sendRequest(u.id))}>+ Ajouter</Button>}
              </Row>
            ))}
          </div>
        </section>

        {incoming.length > 0 && (
          <Section title={`Demandes reçues · ${incoming.length}`}>
            {incoming.map(u => (
              <Row key={u.friendship_id} u={u}>
                <Button variant="primary" className="px-2 text-xs" onPointerDown={act(() => (AuthClient as any).acceptRequest(u.friendship_id))}>✓</Button>
                <Button variant="danger" className="px-2 text-xs" onPointerDown={act(() => (AuthClient as any).declineRequest(u.friendship_id))}>✕</Button>
              </Row>
            ))}
          </Section>
        )}

        {outgoing.length > 0 && (
          <Section title={`Demandes envoyées · ${outgoing.length}`}>
            {outgoing.map(u => (
              <Row key={u.friendship_id} u={u}>
                <Button className="px-2 text-xs" onPointerDown={act(() => (AuthClient as any).removeFriend(u.friendship_id))}>Annuler</Button>
              </Row>
            ))}
          </Section>
        )}

        <Section title={`Mes amis · ${friends.length}`}>
          {friends.length === 0
            ? <p className="text-xs text-white/40">Aucun ami pour l'instant.</p>
            : friends.map(u => (
              <Row key={u.friendship_id} u={u}>
                <Button variant="danger" className="px-2 text-xs" onPointerDown={act(() => (AuthClient as any).removeFriend(u.friendship_id))}>Retirer</Button>
              </Row>
            ))}
        </Section>
      </div>
    </main>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h2 className="mb-1.5 text-[10px] tracking-widest text-white/40">{title.toUpperCase()}</h2>
      <div className="space-y-1.5">{children}</div>
    </section>
  );
}
