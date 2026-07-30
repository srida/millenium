// Numéro de version en pied de page (accueil, connexion). Source de vérité :
// package.json côté serveur (`GET /api/version`), incrémenté automatiquement
// à chaque push sur main (.github/workflows/version-bump.yml) — jamais saisi
// à la main ici.
import { useEffect, useState } from 'react';

export function AppVersion({ className = '' }: { className?: string }) {
  const [version, setVersion] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/version')
      .then(res => res.json())
      .then(data => { if (!cancelled) setVersion(data?.version ?? null); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  if (!version) return null;

  return (
    <p className={`text-xs text-white/30 ${className}`}>v{version}</p>
  );
}
