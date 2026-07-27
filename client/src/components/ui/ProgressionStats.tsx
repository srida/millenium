// Progression du joueur (niveau, XP, gold, gemmes) — rendu partagé entre le
// menu principal et le profil, pour que les mêmes chiffres aient partout la
// même icône et la même couleur.
//
// Les valeurs viennent de `authStore.user` : le serveur les sert déjà dans
// `publicUser()` (cf. progression.js), aucun fetch supplémentaire ici. Rien
// n'est rendu en invité — un joueur non connecté n'a pas de progression.
//
// L'XP n'a PAS de compteur à elle : elle n'existe qu'au travers de la jauge du
// niveau. C'est la seule lecture qui compte (« où j'en suis du palier »), là où
// un nombre nu ne dit rien sans son plafond ; le décompte exact reste en petit
// sous la barre. Gold et gemmes, eux, sont des soldes → chiffres.
import type { AuthUser } from '../../stores/authStore.js';
import { Gauge, Panel } from './primitives.js';

const fmt = new Intl.NumberFormat('fr-FR');

// Palier de niveau — doit rester aligné sur `XP_PER_LEVEL` de progression.js
// (serveur). `user.xp` est la progression DANS le niveau, jamais un cumul de
// carrière : le serveur absorbe le passage de palier, la jauge va donc de 0 à
// 100 sans calcul côté client.
const XP_PER_LEVEL = 100;

type CurrencyKey = 'gold' | 'gems';

// `short` est l'étiquette AFFICHÉE dans les tuiles ; le libellé complet reste
// dans title/aria. 💰 plutôt que 🪙 : la pièce n'a pas de glyphe couleur partout
// et retombe en disque gris (constaté dans le rendu Chromium du preview).
const CURRENCIES: { key: CurrencyKey; label: string; short: string; icon: string; cls: string }[] = [
  { key: 'gold', label: 'Gold',   short: 'Gold',   icon: '💰', cls: 'text-gold' },
  { key: 'gems', label: 'Gemmes', short: 'Gemmes', icon: '💎', cls: 'text-tier-4' },
];

const xpOf = (user: AuthUser) => user.xp ?? 0;
const xpTitle = (user: AuthUser) =>
  `Expérience — ${xpOf(user)} / ${XP_PER_LEVEL} avant le niveau ${(user.level ?? 1) + 1}`;

/** Ligne compacte `Nv. 1 ▓▒░ 25/100 · 💰 0 · 💎 0` — menu principal. */
export function ProgressionPills({ user, className = '' }: { user: AuthUser | null; className?: string }) {
  if (!user) return null;

  return (
    <div className={`flex flex-wrap items-center justify-center gap-1.5 ${className}`} aria-label="Progression">
      {/* Niveau + jauge du palier : la barre tient dans la pastille pour ne pas
          ajouter une ligne au menu. */}
      <span
        title={xpTitle(user)}
        className="flex items-center gap-2 rounded-full border border-gold/50 bg-gold/10 px-2.5 py-1"
      >
        <span className="font-semibold tabular-nums text-gold">Nv. {fmt.format(user.level ?? 1)}</span>
        <Gauge value={xpOf(user) / XP_PER_LEVEL} className="h-1.5 w-14" fillClassName="bg-player" />
        <span className="text-[10px] tabular-nums text-white/40">{fmt.format(xpOf(user))}/{XP_PER_LEVEL}</span>
      </span>
      {CURRENCIES.map(c => (
        <span
          key={c.key}
          title={c.label}
          className="flex items-center gap-1 rounded-full border border-line bg-surface-raised/70 px-2.5 py-1"
        >
          <span aria-hidden="true">{c.icon}</span>
          <span className={`font-semibold tabular-nums ${c.cls}`}>{fmt.format(user[c.key] ?? 0)}</span>
          <span className="sr-only">{c.label}</span>
        </span>
      ))}
    </div>
  );
}

/** Bloc détaillé (jauge pleine largeur + soldes) — écran Profil. */
export function ProgressionPanel({ user, className = '' }: { user: AuthUser | null; className?: string }) {
  if (!user) return null;

  return (
    <Panel className={`w-full max-w-xs p-3 ${className}`}>
      <div className="mb-3 border-b border-line pb-3" title={xpTitle(user)}>
        <div className="flex items-baseline justify-between">
          <span className="text-[10px] tracking-widest text-white/40">NIVEAU</span>
          <span className="text-lg font-bold tabular-nums text-gold">{fmt.format(user.level ?? 1)}</span>
        </div>
        {/* Jauge du palier : 0 → 100 XP, repart de 0 à chaque niveau gagné. */}
        <Gauge value={xpOf(user) / XP_PER_LEVEL} className="mt-1.5" fillClassName="bg-player" />
        <div className="mt-1 flex justify-between text-[10px] tabular-nums text-white/40">
          <span>✨ EXPÉRIENCE</span>
          <span>{fmt.format(xpOf(user))} / {XP_PER_LEVEL}</span>
        </div>
      </div>
      <dl className="grid grid-cols-2 gap-2 text-center">
        {CURRENCIES.map(c => (
          <div key={c.key} title={c.label} className="rounded-lg border border-line bg-surface/60 px-1 py-2">
            <dt className="text-[10px] tracking-widest text-white/40">
              <span aria-hidden="true">{c.icon}</span> {c.short.toUpperCase()}
            </dt>
            <dd className={`mt-1 text-sm font-bold tabular-nums ${c.cls}`}>{fmt.format(user[c.key] ?? 0)}</dd>
          </div>
        ))}
      </dl>
    </Panel>
  );
}
