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
import { useEffect, useState, type ReactNode } from 'react';
import { useAuthStore } from '../../stores/authStore.js';
import type { AuthUser, LevelReward } from '../../stores/authStore.js';
import { Amount, Button, CountBadge, Gauge, Illustration, Modal, Panel, SHADOW_IDLE, SHADOW_SQUASHED, SURFACE_NEUTRAL, usePressSquash } from './primitives.js';
import { CURRENCIES, fmt, XP_ICON } from './currency.js';
import UiIcon from './UiIcon.js';
import * as Audio from '../../audio/AudioManager.js';

// Palier de niveau — doit rester aligné sur `XP_PER_LEVEL` de progression.js
// (serveur). `user.xp` est la progression DANS le niveau, jamais un cumul de
// carrière : le serveur absorbe le passage de palier, la jauge va donc de 0 à
// 100 sans calcul côté client.
const XP_PER_LEVEL = 100;

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

  // Paliers à récupérer : la MÊME pastille verte que les Missions et les
  // Cadeaux (`CountBadge`), pour la même raison — c'est le même genre de gain
  // en attente, il doit se signaler pareil.
  //
  // Elle prend la place du décompte d'XP plutôt que de s'y ajouter : une
  // quatrième valeur ferait déborder la pastille sur deux lignes au menu comme
  // dans l'en-tête. La jauge continue de dire où en est le palier, et le
  // décompte exact reste dans le `title`.
  const pending = user.pending_levels ?? 0;
  const level = (
    <>
      <span className="font-semibold tabular-nums text-gold">Nv. {fmt.format(user.level ?? 1)}</span>
      <Gauge value={xpOf(user) / XP_PER_LEVEL} className="h-1.5 w-9 sm:w-14" fillClassName="bg-player" />
      {/* Le décompte exact reste caché sous `sm` : la jauge tient déjà la
          réponse à « où j'en suis », et l'en-tête y est plein (profil, or,
          gemmes). Le `title` le dit à qui le cherche. */}
      <span className="hidden text-[10px] tabular-nums text-white/40 sm:inline">
        {fmt.format(xpOf(user))}/{XP_PER_LEVEL}
      </span>
      {/* ⚠️ **Le palier gagné se signale à TOUTES les tailles, et EN SURIMPRESSION**
          — c'est le geste des tuiles du footer (`AppFooter.DockTile`), et pour la
          raison qui le leur a imposé : une pastille posée DANS le flux coûte sa
          largeur, or l'en-tête en portrait n'en a plus une seule (mesuré : 390 px
          d'écran pour 355 de contenu), si bien qu'elle faisait passer les soldes
          à la ligne. En surimpression elle ne coûte rien, et elle dit exactement
          ce qu'elle a à dire : il y a quelque chose à récupérer ICI.
          Elle prenait la place du décompte d'XP, et n'était donc rendue qu'à
          partir de `sm` — c'est-à-dire jamais sur le téléphone où le jeu se
          joue. */}
      {pending > 0 && (
        <CountBadge
          label={`${pending} palier${pending > 1 ? 's' : ''} à récupérer`}
          className="absolute -right-1 -top-1 h-4 min-w-4 text-[10px]"
        >
          {fmt.format(pending)}
        </CountBadge>
      )}
    </>
  );
  // `relative` : l'ancre de la pastille de palier ci-dessus.
  const levelClass = 'relative flex items-center gap-1.5 sm:gap-2 rounded-full border border-gold/50 bg-gold/10 px-2 py-0.5 sm:px-2.5 sm:py-1';

  return (
    <div className={`flex flex-wrap items-center justify-center gap-1 sm:gap-1.5 ${className}`} aria-label="Progression">
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
          className="flex items-center gap-1 rounded-full border border-line bg-surface-raised/70 px-2 py-0.5 sm:px-2.5 sm:py-1"
        >
          <UiIcon id={c.icon} className="h-3.5 w-3.5" />
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
/**
 * `compact` : le pseudo se RESSERRE sous `sm` (il ne tombe plus).
 *
 * ⚠️ Il tombait entièrement, et il ne restait que l'avatar — or un avatar est
 * une image que le joueur a choisie, pas un nom : sur un portrait de téléphone,
 * l'en-tête ne disait donc plus sous quel compte on jouait, et c'est la première
 * chose qu'on vient y chercher quand on en a plusieurs. La place se prend sur la
 * LARGEUR MAXIMALE du pseudo (tronqué), pas sur sa présence.
 */
export function ProfilePill({ user, onPointerDown, compact = false, className = '' }: { user: AuthUser; onPointerDown?: () => void; compact?: boolean; className?: string }) {
  const avatar = (user.avatar ?? '').trim();
  const isImg = /^(https?:|data:|\/)/i.test(avatar);
  const { squashed, handlers } = usePressSquash<HTMLButtonElement>(onPointerDown, false);

  return (
    <button
      title="Profil"
      aria-label={`Profil de ${user.username}`}
      className={`flex min-h-tap items-center gap-2 rounded-full border px-2 py-1 transition-[transform,box-shadow] duration-100 ease-out ${SURFACE_NEUTRAL} ${squashed ? SHADOW_SQUASHED : SHADOW_IDLE} ${compact ? 'pr-2 sm:pr-3' : 'pr-3'} ${className}`}
      {...handlers}
    >
      <span className="flex h-6 w-6 flex-shrink-0 items-center justify-center overflow-hidden rounded-full border border-gold bg-surface text-xs">
        {avatar
          ? (isImg ? <img src={avatar} alt="" className="h-full w-full object-cover" /> : <span>{avatar.slice(0, 2)}</span>)
          : <span>{user.username.slice(0, 1).toUpperCase()}</span>}
      </span>
      <span className={`truncate font-semibold text-white ${compact ? 'max-w-[4rem] sm:max-w-[9rem]' : 'max-w-[9rem]'}`}>{user.username}</span>
    </button>
  );
}

// --- Paliers de niveau ---

/**
 * Barème et paliers à venir, tels que le SERVEUR les annonce
 * (`levels.preview`, servi par GET /me/progression). Rien n'est recalculé ici :
 * le client afficherait sinon une règle et le serveur en appliquerait une
 * autre, sans que rien ne le signale.
 */
export interface LevelStep { level: number; gold: number; gems: number; draw: boolean }

export interface LevelRewardsView {
  rules: {
    gold_per_level: number;
    gems: { every: number; amount: number };
    draw: { every: number; kinds: string[] };
    /** Les niveaux qui ÉCHANGENT leurs golds : `steps` sont des rangs dans la
     *  dizaine (2 et 7 → gemmes, 3 et 8 → objet), pas des niveaux. */
    swaps?: {
      cycle: number;
      gems: { steps: number[]; amount: number };
      draw: { steps: number[] };
    };
  };
  /** Paliers gagnés qui attendent le tap. */
  pending: LevelStep[];
  pending_totals: { gold: number; gems: number; draws: number };
  upcoming: LevelStep[];
  next_gems_level: number;
  next_draw_level: number;
}

// Le serveur nomme les familles, le client les écrit en français : c'est de
// l'interface, elle n'a rien à faire dans le barème.
const KIND_LABELS: Record<string, string> = { card: 'carte', avatar: 'avatar', variant: 'variante' };
const kindList = (kinds: string[]) => kinds.map(k => KIND_LABELS[k] ?? k).join(', ');

// « 2 et 7 » — les rangs d'échange, écrits comme on les dit. Le serveur ne
// transmet que les nombres : la conjonction est de l'interface.
const stepList = (steps: number[]) =>
  steps.length > 1 ? `${steps.slice(0, -1).join(', ')} et ${steps[steps.length - 1]}` : String(steps[0] ?? '');

const HALO = 'shadow-[0_0_0_4px_color-mix(in_srgb,var(--color-success)_18%,transparent),0_0_12px_color-mix(in_srgb,var(--color-success)_50%,transparent)]';

// La frise compte cinq cases : `levels.upcoming` en porte au moins cinq.
const TRACK_STEPS = 5;

/** Récompenses d'une marche à venir. ⚠️ Un montant nul ne s'affiche pas : sur
 *  un niveau d'échange, un « 💰 0 » se lirait comme une perte. */
function StepRewards({ step }: { step: LevelStep }) {
  return (
    <span className="flex items-center gap-2.5 text-sm font-semibold tabular-nums">
      {step.gold > 0 && <Amount currency="gold" value={step.gold} />}
      {step.gems > 0 && <Amount currency="gems" value={step.gems} />}
      {step.draw && <span className="flex items-center gap-1 text-white/85"><UiIcon id="UI_GIFTS" className="h-[15px] w-[15px]" /> objet</span>}
    </span>
  );
}

/**
 * Bloc « niveau » de l'écran Profil : où j'en suis, ce qui attend d'être
 * récupéré, ce que donne la marche suivante.
 *
 * Une frise de cinq cases (au plus deux paliers gagnés, puis les marches à
 * venir) et UNE carte de détail — le gain à récupérer, sinon le prochain
 * objectif. C'est le SEUL endroit où un palier se récupère : un niveau se gagne
 * partout (fin de combat, missions, cadeau), le geste, lui, tient ici.
 *
 * Tout vient du serveur (`LevelRewardsView`) : rien n'est recalculé. Les soldes
 * sont déjà dans l'en-tête de l'appli.
 *
 * `onClaimed` permet à l'écran de recharger son barème après le tap (les
 * paliers en attente ont bougé) ; la récupération elle-même vit ici.
 */
export function LevelTrack({ user, levels, onClaimed, className = '' }: {
  user: AuthUser | null;
  levels: LevelRewardsView | null;
  onClaimed?: () => void;
  className?: string;
}) {
  const claimLevels = useAuthStore(s => s.claimLevels);
  const [busy, setBusy] = useState(false);
  const [reveal, setReveal] = useState<LevelReward[] | null>(null);
  const [rulesOpen, setRulesOpen] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const claimSquash = usePressSquash<HTMLButtonElement>(() => void claim(), busy);

  if (!user || !levels) return null;

  const { rules } = levels;
  const level = user.level ?? 1;
  const xp = xpOf(user);
  const pending = levels.pending ?? [];
  const totals = levels.pending_totals ?? { gold: 0, gems: 0, draws: 0 };

  const shown = pending.slice(-2);
  const upcoming = (levels.upcoming ?? []).slice(0, TRACK_STEPS - shown.length);
  const steps = [
    ...shown.map(s => ({ ...s, st: 'claim' as const })),
    ...upcoming.map((s, i) => ({ ...s, st: i === 0 ? 'next' as const : 'todo' as const })),
  ];
  const leftOf = (i: number) => `${((i + 1) / TRACK_STEPS) * 100}%`;
  const fill = Math.min(1, (shown.length + xp / XP_PER_LEVEL) / TRACK_STEPS) * 100;
  const iconOf = (s: LevelStep) => (s.draw ? 'UI_GIFTS' : s.gems ? 'UI_GEMS' : 'UI_GOLD') as 'UI_GIFTS' | 'UI_GEMS' | 'UI_GOLD';
  const nextStep = levels.upcoming?.[0];

  async function claim() {
    // Verrouillé pendant l'appel : la récupération n'est pas idempotente côté
    // serveur (le second tap échouerait en 409, mais autant ne pas l'envoyer).
    setBusy(true);
    setErr(null);
    try {
      const res = await claimLevels();
      if (res) setReveal(res.lines);
      onClaimed?.();
    } catch (e) {
      setErr((e as Error)?.message ?? 'Erreur');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel className={`flex flex-col gap-2.5 p-3 ${className}`}>
      <div className="flex items-baseline justify-between">
        <span className="flex items-baseline gap-2">
          <span className="text-[10px] tracking-widest text-white/40">NIVEAU</span>
          <span className="text-lg font-bold tabular-nums text-gold">{fmt.format(level)}</span>
        </span>
        <span className="flex items-center gap-1 text-[11px] tabular-nums text-white/50" title={xpTitle(user)}>
          <UiIcon id={XP_ICON} className="h-3 w-3" /> {fmt.format(xp)} / {XP_PER_LEVEL} XP
        </span>
      </div>

      {/* Frise : le point bleu est le niveau actuel, les cases les marches à
          venir, régulièrement espacées (ce n'est pas une échelle d'XP). */}
      <div className="relative ml-1 mr-4 h-[30px]">
        <div className="absolute inset-x-0 top-3 h-1.5 overflow-hidden rounded-full bg-black/50">
          <div className="h-full rounded-full bg-player" style={{ width: `${fill}%` }} />
        </div>
        <span className="absolute left-0 top-[11px] h-2 w-2 -translate-x-1/2 rounded-full bg-player" />
        {steps.map((s, i) => {
          const pos = 'absolute top-0 flex h-[30px] w-0 items-center justify-center';
          const wrap = (node: ReactNode) => <div key={`${s.st}-${s.level}`} className={pos} style={{ left: leftOf(i) }}>{node}</div>;
          if (s.st === 'claim') {
            return wrap(
              <button
                type="button"
                disabled={busy}
                onPointerDown={() => { Audio.playSfx('menu_button'); void claim(); }}
                aria-label={`Récupérer le palier du niveau ${s.level}`}
                className={`flex h-[30px] w-[30px] flex-shrink-0 items-center justify-center rounded-full border-2 border-success bg-[color-mix(in_srgb,var(--color-success)_30%,var(--color-surface-raised))] ${HALO} active:scale-90 disabled:opacity-40`}
              >
                <UiIcon id={iconOf(s)} className="h-[15px] w-[15px]" />
              </button>,
            );
          }
          if (s.st === 'next') {
            return wrap(
              <span className="flex h-[30px] w-[30px] flex-shrink-0 items-center justify-center rounded-full border-2 border-gold bg-surface-raised shadow-[0_0_10px_color-mix(in_srgb,var(--color-gold)_35%,transparent)]">
                <UiIcon id={iconOf(s)} className="h-[15px] w-[15px]" />
              </span>,
            );
          }
          return wrap(
            <span className={`flex h-[26px] w-[26px] flex-shrink-0 items-center justify-center rounded-full border-[1.5px] bg-surface-sunken ${s.draw ? 'border-gold/55' : 'border-line-strong'}`}>
              <UiIcon id={iconOf(s)} className="h-[13px] w-[13px] opacity-70" />
            </span>,
          );
        })}
      </div>

      {pending.length > 0 ? (
        <button
          type="button"
          disabled={busy}
          {...claimSquash.handlers}
          className={`flex min-h-[52px] w-full items-center gap-3 rounded-[10px] border border-success bg-gradient-to-b from-[color-mix(in_srgb,var(--color-success)_28%,var(--color-surface-raised))] to-[color-mix(in_srgb,var(--color-success)_12%,var(--color-surface))] px-3 py-2 text-left text-success transition-[transform,box-shadow] duration-100 disabled:opacity-60 ${claimSquash.squashed ? SHADOW_SQUASHED : SHADOW_IDLE}`}
        >
          <UiIcon id="UI_GIFTS" className="h-[22px] w-[22px]" />
          <span className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="text-[13px] font-semibold">
              {pending.length} palier{pending.length > 1 ? 's' : ''} à récupérer
              <span className="ml-1.5 whitespace-nowrap font-normal text-white/50">
                Nv. {fmt.format(pending[0].level)}
                {pending.length > 1 ? ` → ${fmt.format(pending[pending.length - 1].level)}` : ''}
              </span>
            </span>
            <span className="flex items-center gap-2.5 text-xs tabular-nums">
              {totals.gold > 0 && <Amount currency="gold" value={totals.gold} />}
              {totals.gems > 0 && <Amount currency="gems" value={totals.gems} />}
              {/* L'objet n'est pas nommé : il n'est tiré qu'au tap (zéro
                  doublon). L'annoncer, ce serait le promettre avant. */}
              {totals.draws > 0 && <span className="flex items-center gap-1">objet ×{totals.draws}</span>}
            </span>
          </span>
          <span className="text-xs font-bold tracking-wide">{busy ? '…' : 'RÉCUPÉRER'}</span>
        </button>
      ) : nextStep && (
        <div className="flex min-h-[52px] items-center justify-between gap-3 rounded-[10px] border border-gold/45 bg-[color-mix(in_srgb,var(--color-gold)_8%,var(--color-surface-sunken))] px-3 py-2">
          <div className="flex min-w-0 flex-col gap-1">
            <span className="text-[10px] tracking-widest text-white/45">NIVEAU {fmt.format(level + 1)}</span>
            <StepRewards step={nextStep} />
          </div>
          <div className="flex flex-col items-end leading-none">
            <span className="text-lg font-bold tabular-nums">{XP_PER_LEVEL - xp}</span>
            <span className="mt-0.5 text-[10px] text-white/45">XP restants</span>
          </div>
        </div>
      )}

      {err && (
        <p role="alert" className="rounded-lg border border-danger/50 bg-danger/10 px-2 py-1.5 text-xs leading-snug text-danger">{err}</p>
      )}

      {reveal && <LevelReveal lines={reveal} onClose={() => setReveal(null)} />}

      <button
        type="button"
        aria-expanded={rulesOpen}
        onPointerDown={() => setRulesOpen(o => !o)}
        className="flex min-h-8 items-center justify-between text-[11px] text-white/45"
      >
        Barème des niveaux <span aria-hidden>{rulesOpen ? '−' : '+'}</span>
      </button>
      {rulesOpen && (
        <div className="flex flex-col gap-1 text-[11px] leading-relaxed text-white/60">
          <p>
            Chaque niveau rapporte <Amount currency="gold" value={rules.gold_per_level} className="font-semibold" />,
            tous les {rules.gems.every} niveaux <Amount currency="gems" value={rules.gems.amount} className="font-semibold" /> en plus,
            et tous les {rules.draw.every} niveaux un objet tiré au sort ({kindList(rules.draw.kinds)}).
          </p>
          {/* Les échanges, en phrase à part : « en plus » et « à la place » sont
              deux règles opposées, les fondre ferait lire les rangs comme des
              bonus supplémentaires. */}
          {rules.swaps && (
            <p>
              À la place des golds : les niveaux en {stepList(rules.swaps.gems.steps)} donnent{' '}
              <Amount currency="gems" value={rules.swaps.gems.amount} className="font-semibold" />,
              ceux en {stepList(rules.swaps.draw.steps)} un objet.
            </p>
          )}
        </div>
      )}
    </Panel>
  );
}

/**
 * La FAMILLE d'un objet tiré, écrite en toutes lettres.
 *
 * ⚠️ Elle s'écrivait en emoji (🃏 / 🎭 / 🎨), et les trois ne se distinguaient
 * pas : rien ne dit qu'un masque est un avatar plutôt qu'une carte, et c'est
 * pourtant la famille qui décide où l'objet se retrouve (Profil pour un avatar,
 * DeckBuilder pour une variante) — la phrase sous la grille le dit déjà, mais
 * elle ne servait à rien tant qu'on ne savait pas lequel des trois on venait
 * d'obtenir. `KIND_LABELS` porte déjà ces mots pour le barème : c'est la même
 * question, donc la même table.
 */
const itemKindLabel = (type: string) => KIND_LABELS[type] ?? 'objet';

/** Révélation de ce qui vient d'être récupéré, palier par palier. */
function LevelReveal({ lines, onClose }: { lines: LevelReward[]; onClose: () => void }) {
  const gold = lines.reduce((n, l) => n + l.gold, 0);
  const gems = lines.reduce((n, l) => n + l.gems, 0);
  const items = lines.filter(l => l.item).map(l => l.item!);
  const last = lines[lines.length - 1];

  return (
    <Modal onClose={onClose}>
      <div className="flex flex-col gap-4">
        <div className="text-center">
          <p className="text-[10px] tracking-widest text-white/40">
            {lines.length > 1 ? `${lines.length} PALIERS RÉCUPÉRÉS` : 'PALIER RÉCUPÉRÉ'}
          </p>
          <p className="mt-1 text-base font-semibold text-gold">Niveau {fmt.format(last?.level ?? 1)}</p>
        </div>

        {/* Une série peut n'être faite que d'échanges (un palier en 3 seul ne
            donne qu'un objet) : la ligne de monnaies disparaît alors au lieu
            d'annoncer deux zéros sous les illustrations. */}
        {(gold > 0 || gems > 0) && (
          <div className="flex justify-center gap-4 text-sm font-semibold">
            {gold > 0 && <Amount currency="gold" value={gold} sign />}
            {gems > 0 && <Amount currency="gems" value={gems} sign />}
          </div>
        )}

        {!!items.length && (
          <div className="flex flex-wrap justify-center gap-3">
            {items.map((item, i) => (
              <div key={`${item.id}-${i}`} className="flex w-24 flex-col items-center gap-1">
                {/* Cartes, avatars et variantes partagent le dossier
                    d'illustrations : une seule URL les rend tous les trois. */}
                <Illustration id={item.id} framed className="h-24 w-24 border-gold/40" />
                <span className="text-[9px] uppercase tracking-widest text-gold/80">{itemKindLabel(item.type)}</span>
                <span className="w-full truncate text-center text-[10px] text-white/70" title={item.label}>
                  {item.label}
                </span>
              </div>
            ))}
            <p className="w-full text-center text-[10px] leading-relaxed text-white/30">
              Les avatars se choisissent au Profil, les illustrations dans le DeckBuilder.
            </p>
          </div>
        )}

        <Button variant="primary" className="w-full justify-center" onPointerDown={onClose}>
          Continuer
        </Button>
      </div>
    </Modal>
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
