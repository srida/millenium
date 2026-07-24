/* eslint-disable @typescript-eslint/no-explicit-any */
// ResetPasswordScreen — atterrissage du lien e-mail (?screen=reset_password&token=…).
// L'utilisateur saisit lui-même son nouveau mot de passe (jamais l'agent).
import { useState } from 'react';
import * as AuthClient from '../data/AuthClient.js';
import { useUiStore } from '../stores/uiStore.js';
import { Button } from '../components/ui/primitives.js';

export default function ResetPasswordScreen() {
  const navigate = useUiStore(s => s.navigate);
  const token = new URLSearchParams(window.location.search).get('token') ?? '';
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  async function submit() {
    setError(null);
    if (password.length < 8) { setError('Mot de passe : 8 caractères minimum.'); return; }
    if (password !== confirm) { setError('Les mots de passe ne correspondent pas.'); return; }
    setBusy(true);
    try {
      await (AuthClient as any).resetPassword({ token, password });
      setDone(true);
    } catch (e: any) {
      setError(e?.message ?? 'Lien expiré ou invalide.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-6 bg-surface p-6 text-white">
      <h1 className="text-3xl font-bold tracking-[0.2em] text-gold">MILLENIUM</h1>
      {!token ? (
        <>
          <p className="text-sm text-danger">Lien invalide (jeton manquant).</p>
          <Button onPointerDown={() => navigate('auth')}>Retour à la connexion</Button>
        </>
      ) : done ? (
        <>
          <div className="text-4xl">✓</div>
          <p className="text-sm text-success">Mot de passe réinitialisé.</p>
          <Button variant="primary" onPointerDown={() => navigate('auth')}>Se connecter</Button>
        </>
      ) : (
        <form className="flex w-full max-w-xs flex-col gap-3" onSubmit={(e) => { e.preventDefault(); if (!busy) submit(); }}>
          <p className="text-center text-sm text-white/60">Choisis un nouveau mot de passe</p>
          <input
            type="password" autoComplete="new-password" placeholder="Nouveau mot de passe" value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="min-h-tap rounded-lg border border-line bg-surface-raised px-3 text-sm text-white placeholder:text-white/30"
          />
          <input
            type="password" autoComplete="new-password" placeholder="Confirmer" value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            className="min-h-tap rounded-lg border border-line bg-surface-raised px-3 text-sm text-white placeholder:text-white/30"
          />
          {error && <p className="text-xs text-danger">{error}</p>}
          <Button type="submit" variant="primary" disabled={busy} className="w-full">
            {busy ? '…' : 'Réinitialiser'}
          </Button>
        </form>
      )}
    </main>
  );
}
