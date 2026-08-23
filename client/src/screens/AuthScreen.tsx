/* eslint-disable @typescript-eslint/no-explicit-any */
// AuthScreen — connexion / inscription minimales (D2). L'auth est optionnelle :
// se connecter active la synchro serveur des decks ; « Continuer en invité »
// revient au menu sans compte. Prohibé côté agent : la saisie d'identifiants est
// faite par l'utilisateur lui-même.
import { useState } from 'react';
import * as AuthClient from '../data/AuthClient.js';
import { useAuthStore } from '../stores/authStore.js';
import { useUiStore } from '../stores/uiStore.js';
import { Button } from '../components/ui/primitives.js';
import { AppVersion } from '../components/system/AppVersion.js';

type Mode = 'login' | 'register' | 'forgot';

export default function AuthScreen() {
  const [mode, setMode] = useState<Mode>('login');
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [rememberMe, setRememberMe] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const navigate = useUiStore(s => s.navigate);
  const onAuthenticated = useAuthStore(s => s.onAuthenticated);

  async function submit() {
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      if (mode === 'forgot') {
        await (AuthClient as any).forgotPassword(email);
        setNotice('Si un compte existe pour cet e-mail, un lien de réinitialisation a été envoyé.');
        return;
      }
      const user = mode === 'login'
        ? await (AuthClient as any).login({ email, password, rememberMe })
        : await (AuthClient as any).register({ email, username, password });
      await onAuthenticated(user);
      navigate('main_menu');
    } catch (e: any) {
      setError(e?.message ?? 'Une erreur est survenue');
    } finally {
      setBusy(false);
    }
  }

  const canSubmit = mode === 'forgot'
    ? !!email.trim()
    : email.trim() && password && (mode === 'login' || username.trim());

  return (
    <main className="relative z-10 flex min-h-dvh flex-col items-center justify-center gap-6 p-6 text-white">
      <div className="text-center">
        <h1 className="text-3xl font-bold tracking-[0.2em] text-gold">MILLENIUM</h1>
        <p className="mt-1 text-sm text-white/50">
          {mode === 'login' ? 'Connexion' : mode === 'register' ? 'Créer un compte' : 'Mot de passe oublié'}
        </p>
      </div>

      {mode !== 'forgot' && (
        <div className="flex w-full max-w-xs overflow-hidden rounded-lg border border-line">
          {(['login', 'register'] as Mode[]).map(m => (
            <button
              key={m}
              onPointerDown={() => { setMode(m); setError(null); setNotice(null); }}
              className={`min-h-tap flex-1 text-sm font-semibold ${mode === m ? 'bg-gold/20 text-gold' : 'bg-surface-raised text-white/60'}`}
            >
              {m === 'login' ? 'Se connecter' : "S'inscrire"}
            </button>
          ))}
        </div>
      )}

      <form
        className="flex w-full max-w-xs flex-col gap-3"
        onSubmit={(e) => { e.preventDefault(); if (canSubmit && !busy) submit(); }}
      >
        <input
          type="email" autoComplete="email" placeholder="E-mail" value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="min-h-tap rounded-lg border border-line bg-surface-raised px-3 text-white placeholder:text-white/30"
        />
        {mode === 'register' && (
          <input
            type="text" autoComplete="username" placeholder="Pseudo" value={username}
            onChange={(e) => setUsername(e.target.value)}
            className="min-h-tap rounded-lg border border-line bg-surface-raised px-3 text-white placeholder:text-white/30"
          />
        )}
        {mode !== 'forgot' && (
          <input
            type="password" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} placeholder="Mot de passe" value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="min-h-tap rounded-lg border border-line bg-surface-raised px-3 text-white placeholder:text-white/30"
          />
        )}
        {mode === 'login' && (
          <div className="flex items-center justify-between text-xs text-white/60">
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={rememberMe} onChange={(e) => setRememberMe(e.target.checked)} />
              Rester connecté
            </label>
            <button type="button" onPointerDown={() => { setMode('forgot'); setError(null); setNotice(null); }} className="underline">
              Mot de passe oublié ?
            </button>
          </div>
        )}
        {error && <p className="text-xs text-danger">{error}</p>}
        {notice && <p className="text-xs text-success">{notice}</p>}
        <Button type="submit" variant="primary" disabled={!canSubmit || busy} className="w-full">
          {busy ? '…' : mode === 'login' ? 'Se connecter' : mode === 'register' ? 'Créer le compte' : 'Envoyer le lien'}
        </Button>
        {mode === 'forgot' && (
          <button type="button" onPointerDown={() => { setMode('login'); setError(null); setNotice(null); }} className="text-xs text-white/50 underline">
            ← Retour à la connexion
          </button>
        )}
      </form>

      <button onPointerDown={() => navigate('main_menu')} className="text-xs text-white/50 underline">
        Continuer en invité →
      </button>
      <AppVersion className="absolute bottom-[max(0.75rem,env(safe-area-inset-bottom))]" />
    </main>
  );
}
