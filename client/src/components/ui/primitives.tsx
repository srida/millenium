// Primitives du design system Millenium (Tailwind v4, mobile-first, tap ≥ 44px).
import { useEffect, useState, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { CURRENCY, fmt, type CurrencyKey } from './currency.js';
import { illustrationUrl } from '../../data/CardArt.js';

type Variant = 'primary' | 'ghost' | 'danger';

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-gold/20 border-gold text-gold hover:bg-gold/30',
  ghost: 'bg-surface-raised border-line text-white/90 hover:bg-white/5',
  danger: 'bg-danger/15 border-danger text-danger hover:bg-danger/25',
};

export function Button({
  variant = 'ghost', className = '', children, ...rest
}: { variant?: Variant } & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      className={`inline-flex min-h-tap items-center justify-center gap-2 rounded-lg border px-4 text-sm font-semibold tracking-wide transition-colors active:opacity-80 disabled:cursor-not-allowed disabled:opacity-40 ${VARIANTS[variant]} ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
}

// Les DEUX notifications du jeu, définies une fois pour toutes. Elles ne disent
// pas la même chose et ne s'annulent donc pas l'une l'autre : quand les deux
// s'appliquent, la verte prime — « tu as gagné quelque chose » passe avant « il
// y a du neuf ». Missions, Cadeaux, Arcade, Boutique, Tutoriel et paliers de
// niveau lisent tous ces deux-là.

/**
 * Pastille VERTE chiffrée — « N choses à récupérer ». Un compteur et non un
 * point : la valeur est dénombrable ET actionnable, le joueur doit savoir
 * combien de taps l'attendent. Elle ne s'efface jamais à la visite, seulement
 * quand il ne reste plus rien à prendre — sinon elle mentirait.
 */
export function CountBadge({ children, label, className = '' }: { children: ReactNode; label: string; className?: string }) {
  return (
    <span
      aria-label={label}
      className={`flex h-5 min-w-5 items-center justify-center rounded-full bg-success px-1 text-[11px] font-bold tabular-nums text-black ${className}`}
    >
      {children}
    </span>
  );
}

/**
 * Point DORÉ — « il y a du neuf », non dénombrable. Effacé à la visite, comme
 * une notification. Pas un compteur : ce qu'il annonce ne se compte pas en
 * gestes à faire.
 */
export function NewDot({ label = 'Nouveautés' }: { label?: string }) {
  return <span className="h-2 w-2 rounded-full bg-gold" aria-label={label} />;
}

/**
 * Action réduite à une icône : le libellé passe en infobulle native (survol
 * web) et en nom accessible (lecteurs d'écran, où l'icône ne dit rien).
 *
 * ⚠️ La CIBLE fait toujours 44 px (`--spacing-tap`), y compris en `compact`.
 * C'est tout l'intérêt d'avoir la règle ici plutôt qu'à l'appelant : la
 * boutique s'était fabriqué ses propres boutons 28 × 28 px pour l'épingle et le
 * reroll — les seuls contrôles du jeu sous le seuil, sur deux gestes que le
 * design tient pour des arbitrages à part entière.
 *
 * `compact` garde le CHIP visible petit (28 px) mais élargit la zone tapable
 * autour de lui ; le `-my-2` empêche cette zone de faire grandir la ligne qui
 * l'accueille. Le doigt vise large, la tuile reste dense.
 */
export function IconButton({
  label, icon, tone = 'ghost', compact = false, pressed, disabled, chipClassName = '', className = '', onTap,
}: {
  label: string;
  icon: ReactNode;
  tone?: Variant;
  compact?: boolean;
  pressed?: boolean;
  disabled?: boolean;
  /** Habillage du chip en mode `compact` (bordure/fond/teinte selon l'état). */
  chipClassName?: string;
  className?: string;
  onTap: () => void;
}) {
  if (!compact) {
    return (
      <Button
        variant={tone} className={`px-2 text-base leading-none ${className}`}
        title={label} aria-label={label} aria-pressed={pressed} disabled={disabled}
        onPointerDown={onTap}
      >{icon}</Button>
    );
  }
  return (
    <button
      type="button"
      disabled={disabled}
      onPointerDown={onTap}
      title={label}
      aria-label={label}
      aria-pressed={pressed}
      className={`group -my-2 flex min-h-tap min-w-tap items-center justify-center disabled:cursor-not-allowed disabled:opacity-30 ${className}`}
    >
      <span className={`flex h-7 w-7 items-center justify-center rounded-md border text-[11px] transition-opacity group-active:opacity-70 ${chipClassName}`}>
        {icon}
      </span>
    </button>
  );
}

/**
 * Un montant en monnaie — icône, couleur et séparateur de milliers d'un seul
 * geste. C'est LE point de rendu d'un solde ou d'un gain : les glyphes 💰/💎
 * étaient écrits à la main dans une vingtaine d'endroits, et l'un d'eux s'était
 * trompé de couleur sans que rien ne puisse le signaler (cf. `currency.ts`).
 *
 * `sign` préfixe un `+` : un GAIN se lit autrement qu'un solde.
 */
export function Amount({
  currency, value, sign = false, className = '',
}: { currency: CurrencyKey; value: number; sign?: boolean; className?: string }) {
  const c = CURRENCY[currency];
  return (
    <span className={`tabular-nums ${c.cls} ${className}`} title={c.label}>
      <span aria-hidden="true">{c.icon}</span> {sign && value >= 0 ? '+' : ''}{fmt.format(value)}
      <span className="sr-only"> {c.unit}</span>
    </span>
  );
}

/**
 * L'art d'un id — carte, terrain, magie, variante, icône d'attribut : tous
 * partagent l'espace de noms plat du dossier d'illustrations.
 *
 * Une douzaine de sites réécrivaient le gabarit d'URL à la main, et la moitié
 * répétait en prime la même vignette carrée (`rounded-lg border border-line
 * object-cover`) — pendant que le helper documenté, coincé dans un module à
 * état, n'était appelé que trois fois.
 *
 * `fit="contain"` pour les ICÔNES D'ATTRIBUT : rognée, une icône perd sa
 * silhouette, qui est justement ce qui la distingue. C'est la seule différence
 * de traitement avec l'art des cartes, qui vit dans le même dossier.
 */
export function Illustration({
  id, alt = '', className = '', fit = 'cover', framed = false, lazy = true,
}: {
  id: string;
  alt?: string;
  className?: string;
  fit?: 'cover' | 'contain';
  /** Vignette encadrée (bordure + coins arrondis), la forme la plus courante. */
  framed?: boolean;
  lazy?: boolean;
}) {
  return (
    <img
      src={illustrationUrl(id)}
      alt={alt}
      loading={lazy ? 'lazy' : undefined}
      className={`flex-shrink-0 ${fit === 'cover' ? 'object-cover' : 'object-contain'} ${framed ? 'rounded-lg border border-line' : ''} ${className}`}
    />
  );
}

export function Panel({ className = '', children }: { className?: string; children: ReactNode }) {
  return (
    <div className={`rounded-xl border border-line bg-surface-raised/80 backdrop-blur ${className}`}>
      {children}
    </div>
  );
}

// Portrait générique : `src` image (URL/data-URI) ou emoji/texte court, avec
// repli sur `fallback` (ex. initiale du pseudo, ★ pour un invité). Même
// convention de détection qu'ailleurs (Profil, Amis, Tournoi) : un `src` qui
// commence par http(s)/data:/ est une image, sinon c'est du texte affiché tel quel.
export function Avatar({ src, fallback = '★', className = 'h-8 w-8' }: { src?: string | null; fallback?: string; className?: string }) {
  const value = (src ?? '').trim();
  const isImg = /^(https?:|data:|\/)/i.test(value);
  return (
    <div className={`flex flex-shrink-0 items-center justify-center overflow-hidden rounded-lg border border-line bg-surface-raised text-xs font-semibold ${className}`}>
      {value ? (isImg ? <img src={value} alt="" className="h-full w-full object-cover" /> : <span>{value.slice(0, 2)}</span>) : <span>{fallback}</span>}
    </div>
  );
}

// Jauge horizontale (HP, etc.), remplie de 0→1.
export function Gauge({ value, className = '', fillClassName = 'bg-player' }: { value: number; className?: string; fillClassName?: string }) {
  return (
    <div className={`h-2 overflow-hidden rounded-full bg-black/50 ${className}`}>
      <div className={`h-full rounded-full transition-[width] duration-300 ${fillClassName}`} style={{ width: `${Math.max(0, Math.min(100, value * 100))}%` }} />
    </div>
  );
}

// Compte à rebours vers un instant (prochain lot de missions, rotation de la
// boutique). Rafraîchi à la MINUTE : c'est un repère (« encore 4 h »), pas un
// chronomètre — une seconde qui défile ne dit rien de plus et met la pression.
export function Countdown({ at, className = '', title }: { at: number; className?: string; title?: string }) {
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick(n => n + 1), 60_000);
    return () => clearInterval(t);
  }, []);
  const ms = Math.max(0, at - Date.now());
  const h = Math.floor(ms / 3_600_000);
  const min = Math.floor((ms % 3_600_000) / 60_000);
  return (
    // `whitespace-nowrap` : « 18 h 56 » cassé sur trois lignes triplait la
    // hauteur de l'en-tête de la Boutique — qui est désormais épinglé, donc
    // toujours à l'écran.
    <span className={`whitespace-nowrap text-xs tabular-nums text-white/40 ${className}`} title={title}>
      ⏳ {h > 0 ? `${h} h ${String(min).padStart(2, '0')}` : `${min} min`}
    </span>
  );
}

// Bannière flottante (annonces phase / erreurs / ciblage magie).
export function Banner({ text, tone = 'info' }: { text: string; tone?: 'info' | 'error' }) {
  const toneCls = tone === 'error' ? 'border-danger text-danger' : 'border-gold text-gold';
  return (
    <div className={`pointer-events-none fixed left-1/2 top-16 z-40 -translate-x-1/2 rounded-lg border bg-surface/95 px-4 py-2 text-sm font-semibold shadow-lg ${toneCls}`}>
      {text}
    </div>
  );
}

/**
 * Overlay modal centré, mobile-first (safe-areas iOS). `onClose` (optionnel) est
 * déclenché par un tap sur le fond — jamais sur le contenu.
 *
 * ⚠️ **La modale se rend dans un `createPortal(…, document.body)`, et c'est la
 * primitive qui le fait — plus ses appelants.** Un `filter` / `backdrop-filter`
 * sur un ancêtre crée un BLOC CONTENEUR : rendue sous un `Panel` (qui porte
 * `backdrop-blur`), la modale voyait son `position: fixed` se résoudre sur la
 * tuile et non sur l'écran — enfermée dans une colonne de la grille, boutons
 * rognés. Trois appelants (`ConfirmBuy`, `GiftReveal`, `LevelReveal`) portaient
 * chacun leur propre portal et leur propre copie de cet avertissement, pendant
 * que dix autres `<Modal>` n'en avaient pas et que rien ne disait laquelle en
 * aurait eu besoin. Le piège n'existe plus, au lieu d'être documenté trois fois.
 *
 * Portaler est toujours correct ici : la couche est `fixed inset-0`, elle ne
 * tient à son parent DOM par rien. Et les événements synthétiques React
 * traversent un portal via l'arbre REACT — les `onPointerDown` des ancêtres
 * (fermeture de tooltip, etc.) continuent donc de recevoir les taps.
 */
export function Modal({ children, onClose }: { children: ReactNode; onClose?: () => void }) {
  return createPortal(
    <div
      className="pointer-events-auto fixed inset-0 z-40 flex items-center justify-center bg-black/70 p-4"
      onPointerDown={(e) => { if (e.target === e.currentTarget) onClose?.(); }}
    >
      <div className="max-h-[88dvh] w-full max-w-sm overflow-y-auto rounded-2xl border border-gold/40 bg-surface/97 p-4 shadow-2xl [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {children}
      </div>
    </div>,
    document.body,
  );
}
