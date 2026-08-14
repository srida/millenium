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
import { useEffect, useState } from 'react';
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

/**
 * Ligne compacte `Nv. 1 ▓▒░ 25/100 · 💰 0 · 💎 0` — menu principal.
 *
 * `onOpen` rend la pastille de NIVEAU tapable (→ écran Profil, où le détail de
 * la progression et les paliers à venir sont annoncés). Seule celle-là : les
 * soldes sont des chiffres, ils ne mènent nulle part, et un `min-h-tap` sur
 * chaque pastille ferait deux lignes sous l'identité du menu.
 */
export function ProgressionPills({ user, className = '', onOpen }: { user: AuthUser | null; className?: string; onOpen?: () => void }) {
  if (!user) return null;

  const level = (
    <>
      <span className="font-semibold tabular-nums text-gold">Nv. {fmt.format(user.level ?? 1)}</span>
      <Gauge value={xpOf(user) / XP_PER_LEVEL} className="h-1.5 w-14" fillClassName="bg-player" />
      <span className="text-[10px] tabular-nums text-white/40">{fmt.format(xpOf(user))}/{XP_PER_LEVEL}</span>
    </>
  );
  const levelClass = 'flex items-center gap-2 rounded-full border border-gold/50 bg-gold/10 px-2.5 py-1';

  return (
    <div className={`flex flex-wrap items-center justify-center gap-1.5 ${className}`} aria-label="Progression">
      {/* Niveau + jauge du palier : la barre tient dans la pastille pour ne pas
          ajouter une ligne au menu. */}
      {onOpen ? (
        <button
          onPointerDown={onOpen}
          title={`${xpTitle(user)} — voir la progression`}
          aria-label="Progression — voir le détail"
          className={`${levelClass} min-h-tap active:opacity-80`}
        >
          {level}
        </button>
      ) : (
        <span title={xpTitle(user)} className={levelClass}>{level}</span>
      )}
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

/** Pastille de profil (avatar + pseudo). Tap → écran Profil. Elle dit déjà qui
 * est connecté : pas de ligne « Connecté : … » en plus. L'avatar suit la même
 * règle qu'ailleurs (URL/data → image, sinon emoji, sinon initiale du pseudo). */
/** `compact` : le pseudo tombe sous `sm` et il ne reste que l'avatar. Réservé
 *  aux en-têtes d'écran, où la place manque en portrait — et où le pseudo est
 *  la seule information que le joueur connaît déjà par cœur, là où le titre de
 *  l'écran, lui, doit rester lisible en entier. */
export function ProfilePill({ user, onPointerDown, compact = false, className = '' }: { user: AuthUser; onPointerDown?: () => void; compact?: boolean; className?: string }) {
  const avatar = (user.avatar ?? '').trim();
  const isImg = /^(https?:|data:|\/)/i.test(avatar);

  return (
    <button
      onPointerDown={onPointerDown}
      title="Profil"
      aria-label={`Profil de ${user.username}`}
      className={`flex min-h-tap items-center gap-2 rounded-full border border-line bg-surface-raised/70 px-2 py-1 active:opacity-80 ${compact ? 'pr-2 sm:pr-3' : 'pr-3'} ${className}`}
    >
      <span className="flex h-6 w-6 flex-shrink-0 items-center justify-center overflow-hidden rounded-full border border-gold/40 bg-surface text-xs">
        {avatar
          ? (isImg ? <img src={avatar} alt="" className="h-full w-full object-cover" /> : <span>{avatar.slice(0, 2)}</span>)
          : <span>{user.username.slice(0, 1).toUpperCase()}</span>}
      </span>
      <span className={`max-w-[9rem] truncate font-semibold text-white ${compact ? 'hidden sm:inline' : ''}`}>{user.username}</span>
    </button>
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

// --- Paliers de niveau ---

/**
 * Barème et paliers à venir, tels que le SERVEUR les annonce
 * (`levels.preview`, servi par GET /me/progression). Rien n'est recalculé ici :
 * le client afficherait sinon une règle et le serveur en appliquerait une
 * autre, sans que rien ne le signale.
 */
export interface LevelRewardsView {
  rules: {
    gold_per_level: number;
    gems: { every: number; amount: number };
    draw: { every: number; kinds: string[] };
  };
  upcoming: { level: number; gold: number; gems: number; draw: boolean }[];
  next_gems_level: number;
  next_draw_level: number;
}

// Le serveur nomme les familles, le client les écrit en français : c'est de
// l'interface, elle n'a rien à faire dans le barème.
const KIND_LABELS: Record<string, string> = { card: 'carte', avatar: 'avatar', variant: 'variante' };
const kindList = (kinds: string[]) => kinds.map(k => KIND_LABELS[k] ?? k).join(', ');

/** Une marche de la liste « prochains paliers ». */
function UpcomingRow({ step }: { step: LevelRewardsView['upcoming'][number] }) {
  // Un palier à objet est un rendez-vous, pas une ligne de plus : il est le
  // seul à être souligné, sinon la liste se lit comme quatre fois la même chose.
  return (
    <li className={`flex items-center justify-between rounded-lg px-2 py-1.5 ${step.draw ? 'bg-gold/10 ring-1 ring-inset ring-gold/40' : 'bg-surface/60'}`}>
      <span className="text-[11px] font-semibold tabular-nums text-white/70">Nv. {fmt.format(step.level)}</span>
      <span className="flex items-center gap-2 text-[11px] tabular-nums">
        <span className="text-gold">💰 {fmt.format(step.gold)}</span>
        {step.gems > 0 && <span className="text-tier-4">💎 {fmt.format(step.gems)}</span>}
        {step.draw && <span className="text-white/80">🎁 objet</span>}
      </span>
    </li>
  );
}

/**
 * Section « Paliers de niveau » de l'écran Profil : ce que donne le prochain
 * niveau, et les rendez-vous qui suivent.
 *
 * Elle répond à la seule question que la jauge laisse en suspens — « et si je
 * monte, qu'est-ce que j'y gagne ? ». Sans elle, le niveau est un chiffre qui
 * augmente : le joueur ne peut pas savoir qu'un objet l'attend au multiple de 10.
 */
export function LevelRewardsPanel({ user, levels, className = '' }: { user: AuthUser | null; levels: LevelRewardsView | null; className?: string }) {
  if (!user || !levels) return null;

  const { rules } = levels;
  const level = user.level ?? 1;

  return (
    <Panel className={`w-full max-w-xs p-3 ${className}`}>
      <div className="flex items-baseline justify-between">
        <span className="text-[10px] tracking-widest text-white/40">PALIERS DE NIVEAU</span>
        <span className="text-[10px] tabular-nums text-white/40">Nv. {fmt.format(level)}</span>
      </div>

      {/* La règle en une phrase, avant la liste : c'est elle qui rend les quatre
          lignes suivantes lisibles comme un rythme et non comme un tableau. */}
      <p className="mt-2 text-[11px] leading-relaxed text-white/60">
        Chaque niveau rapporte <span className="font-semibold text-gold">💰 {fmt.format(rules.gold_per_level)}</span>,
        tous les {rules.gems.every} niveaux <span className="font-semibold text-tier-4">💎 {fmt.format(rules.gems.amount)}</span> en plus,
        et tous les {rules.draw.every} niveaux un objet tiré au sort ({kindList(rules.draw.kinds)}).
      </p>

      <ul className="mt-2 flex flex-col gap-1">
        {levels.upcoming.map(step => <UpcomingRow key={step.level} step={step} />)}
      </ul>

      {/* Les deux rendez-vous, redits en clair : la liste ne va pas toujours
          assez loin pour les montrer (un objet peut être à 10 niveaux). */}
      <dl className="mt-2 grid grid-cols-2 gap-2 text-center">
        <div className="rounded-lg border border-line bg-surface/60 px-1 py-2">
          <dt className="text-[10px] tracking-widest text-white/40">💎 PROCHAINES</dt>
          <dd className="mt-1 text-sm font-bold tabular-nums text-tier-4">Nv. {fmt.format(levels.next_gems_level)}</dd>
        </div>
        <div className="rounded-lg border border-line bg-surface/60 px-1 py-2">
          <dt className="text-[10px] tracking-widest text-white/40">🎁 PROCHAIN OBJET</dt>
          <dd className="mt-1 text-sm font-bold tabular-nums text-gold">Nv. {fmt.format(levels.next_draw_level)}</dd>
        </div>
      </dl>
    </Panel>
  );
}

/**
 * Jauge de niveau animée d'un instantané de progression à un autre — utilisée
 * par l'écran de résultat du duel pour visualiser le gain XP de la victoire au
 * lieu de basculer directement sur le nouvel état. Un gain de partie (10 à 70
 * XP, cf. `progression.REWARDS`) ne dépasse jamais `XP_PER_LEVEL` : au plus un
 * palier est franchi, la jauge se remplit puis revient à 0 avant de reprendre.
 */
export function AnimatedLevelGauge({
  fromLevel, fromXp, toLevel, toXp, className = '',
}: { fromLevel: number; fromXp: number; toLevel: number; toXp: number; className?: string }) {
  const [level, setLevel] = useState(fromLevel);
  const [xp, setXp] = useState(fromXp);

  useEffect(() => {
    setLevel(fromLevel);
    setXp(fromXp);
    const leveledUp = toLevel > fromLevel;
    const timers = [
      setTimeout(() => setXp(leveledUp ? XP_PER_LEVEL : toXp), 60),
    ];
    if (leveledUp) {
      timers.push(setTimeout(() => { setLevel(toLevel); setXp(0); }, 500));
      timers.push(setTimeout(() => setXp(toXp), 560));
    }
    return () => timers.forEach(clearTimeout);
  }, [fromLevel, fromXp, toLevel, toXp]);

  return (
    <div className={className}>
      <div className="flex items-baseline justify-between text-[10px] tracking-widest text-white/40">
        <span>NIVEAU</span>
        <span className="text-sm font-bold tabular-nums text-gold">{fmt.format(level)}</span>
      </div>
      <Gauge value={xp / XP_PER_LEVEL} className="mt-1" fillClassName="bg-player" />
      <div className="mt-1 text-right text-[10px] tabular-nums text-white/40">{fmt.format(xp)}/{XP_PER_LEVEL}</div>
    </div>
  );
}
