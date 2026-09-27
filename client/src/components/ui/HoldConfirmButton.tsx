// Un geste payé en PV, à MAINTENIR plutôt qu'un tap suivi d'une confirmation
// modale : le reroll de la Phase Shopping et le mulligan de la barre de
// préparation. La charge qui remplit le bouton EST la confirmation — le prix
// ne s'affiche qu'au moment où il est débité, en toast au-dessus du bouton,
// jamais écrit sur le bouton lui-même.
//
// ⚠️ **Même geste pour les achats de la BOUTIQUE** (`currency` posé) : un
// bouton d'emplacement, de booster ou de cosmétique n'ouvre plus de popup de
// confirmation, il se maintient comme le mulligan. `currency` bascule la
// tonalité (surface, texte, toast) sur la couleur de la monnaie plutôt que le
// rouge du coût en PV, et déclenche le son dédié `shop_buy` — un débit n'est
// pas un simple bouton de menu (`menu_button`).
//
// ⚠️ Relâcher — ou glisser hors du bouton — avant la fin de la charge annule
// tout : la barre retombe à zéro, rien n'est débité. Même doctrine qu'un
// appui long relâché trop tôt (`cardPress.ts`) : le geste inachevé ne
// compte pas. Pas de tolérance de déplacement comme `usePressSquash` — sortir
// de la boîte du bouton est le seul signal d'annulation, un doigt qui reste
// dessus peut trembler sans rien perdre.
//
// ⚠️ `fullWidth` est la SEULE différence entre les usages EN PARTIE : le
// reroll occupe la moitié d'une modale (`flex-1`), le mulligan une place fixe
// dans une barre déjà dense (`shrink-0`). Tout le reste — la charge, le
// toast, l'annulation — est écrit une seule fois.
//
// ⚠️ `visible` REMPLACE le montage conditionnel du parent
// (`{cond && <HoldConfirmButton .../>}`) : le mulligan n'a qu'un tir par
// partie, et `onConfirm` fait retomber `canMulligan` à `false` DANS LE MÊME
// tick que le toast s'arme — un démontage par le parent aurait tué le toast
// avant son premier pixel. Le composant reste donc monté tant que le toast
// vit, et ne rend le `<button>` que si `visible` ; sans toast en cours, il
// rend `null` exactement comme l'ancien montage conditionnel.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { BUTTON_BASE, SHADOW_IDLE, SURFACE_DANGER, SURFACE_GOLD, SURFACE_VIOLET } from './primitives.js';
import { CURRENCY, fmt, type CurrencyKey } from './currency.js';
import * as Audio from '../../audio/AudioManager.js';

const HOLD_MS = 600;
const TOAST_VISIBLE_MS = 900;
const TOAST_FADE_MS = 300;

type Tone = 'danger' | 'gold' | 'gems';

interface ToneStyle {
  surface: string;
  text: string;
  toast: string;
  unit: string;
  /** Vide pour le coût en PV — `${cost} PV`, pas `${cost}  PV`. */
  icon: string;
}

const TONE_STYLE: Record<Tone, ToneStyle> = {
  danger: { surface: SURFACE_DANGER, text: 'text-danger', toast: 'bg-danger text-white', unit: 'PV', icon: '' },
  gold: { surface: SURFACE_GOLD, text: 'text-gold', toast: 'bg-gold text-black', unit: CURRENCY.gold.unit, icon: CURRENCY.gold.icon },
  gems: { surface: SURFACE_VIOLET, text: 'text-violet', toast: 'bg-violet text-white', unit: CURRENCY.gems.unit, icon: CURRENCY.gems.icon },
};

export default function HoldConfirmButton({
  icon, label, cost, onConfirm, fullWidth = false, visible = true, disabled = false,
  currency, actionLabel, title, className = '',
}: {
  icon?: ReactNode;
  label: string;
  cost: number;
  onConfirm: () => void | Promise<unknown>;
  /** `true` : le bouton occupe toute la largeur de son conteneur flex (reroll,
   *  côte à côte avec Passer). `false` : taille intrinsèque, dans une barre
   *  dense (mulligan, à côté de ↺/☰/PRÊT). */
  fullWidth?: boolean;
  /** Le geste doit rester possible. `false` masque le BOUTON, jamais un toast
   *  déjà en cours (cf. note ci-dessus). */
  visible?: boolean;
  /** Le geste reste visible mais n'est pas ARMABLE (achat trop cher, un autre
   *  achat déjà en vol…) — distinct de `visible`, qui masque le bouton entier. */
  disabled?: boolean;
  /** Posé UNIQUEMENT pour un achat de boutique : bascule la tonalité (surface,
   *  texte, toast) sur la couleur de cette monnaie plutôt que le rouge PV, et
   *  déclenche `shop_buy` au lieu de rien. Omis, le bouton reste le geste payé
   *  en PV d'origine (mulligan, reroll). */
  currency?: CurrencyKey;
  /** Le verbe employé dans le nom accessible (« Maintenir pour ACHETER,
   *  moins… ») — `label` en minuscules par défaut (« mulligan », « re-roll »),
   *  qui ne dit pas grand-chose pour un bouton dont le libellé n'est qu'un
   *  prix (« 500 »). */
  actionLabel?: string;
  /** Infobulle native — le seul endroit où dire POURQUOI le bouton est
   *  désactivé (« Pas assez de golds »), le geste lui-même n'ayant aucune
   *  confirmation où l'écrire. */
  title?: string;
  className?: string;
}) {
  const [progress, setProgress] = useState(0);
  const [toastPhase, setToastPhase] = useState<'idle' | 'in' | 'out'>('idle');
  const raf = useRef<number | null>(null);
  const startedAt = useRef<number | null>(null);
  const toastTimers = useRef<number[]>([]);

  const tone = TONE_STYLE[currency === 'gold' ? 'gold' : currency === 'gems' ? 'gems' : 'danger'];
  const toastAmount = tone.icon ? `−${fmt.format(cost)} ${tone.icon}` : `−${cost} ${tone.unit}`;

  const stopCharge = () => {
    if (raf.current !== null) { cancelAnimationFrame(raf.current); raf.current = null; }
    startedAt.current = null;
  };
  const cancelCharge = () => { stopCharge(); setProgress(0); };

  const tick = (t: number) => {
    if (startedAt.current === null) startedAt.current = t;
    const p = Math.min(1, (t - startedAt.current) / HOLD_MS);
    setProgress(p);
    if (p >= 1) {
      stopCharge();
      setProgress(0);
      onConfirm();
      // ⚠️ `currency` seul déclenche `shop_buy` : le geste payé en PV
      // (mulligan/reroll) joue déjà SON son dédié depuis l'action elle-même
      // (`GameController.mulligan()` / `rerollShoppingMagies()` →
      // `Audio.playSfx('mulligan_reroll')`), pas depuis le bouton — le
      // sonner ici aussi le ferait sonner deux fois.
      if (currency) Audio.playSfx('shop_buy');
      toastTimers.current.forEach(id => window.clearTimeout(id));
      setToastPhase('in');
      toastTimers.current = [
        window.setTimeout(() => setToastPhase('out'), TOAST_VISIBLE_MS),
        window.setTimeout(() => setToastPhase('idle'), TOAST_VISIBLE_MS + TOAST_FADE_MS),
      ];
      return;
    }
    raf.current = requestAnimationFrame(tick);
  };

  useEffect(() => () => {
    stopCharge();
    toastTimers.current.forEach(id => window.clearTimeout(id));
  }, []);

  if (!visible && toastPhase === 'idle') return null;

  return (
    <div className={`relative ${fullWidth ? 'min-w-0 flex-1' : 'shrink-0'}`}>
      {toastPhase !== 'idle' && (
        <div
          aria-hidden="true"
          className={`pointer-events-none absolute -top-7 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-extrabold shadow-lg transition-[opacity,transform] duration-300 ${tone.toast} ${
            toastPhase === 'in' ? 'translate-y-0 opacity-100' : '-translate-y-2 opacity-0'
          }`}
        >
          {toastAmount}
        </div>
      )}
      {visible && (
        <button
          type="button"
          disabled={disabled}
          title={title}
          aria-label={`Maintenir pour ${actionLabel ?? label.toLowerCase()}, moins ${toastAmount.replace('−', '')}`}
          onPointerDown={(e) => { e.stopPropagation(); if (disabled) return; stopCharge(); raf.current = requestAnimationFrame(tick); }}
          onPointerUp={(e) => { e.stopPropagation(); cancelCharge(); }}
          onPointerLeave={(e) => { e.stopPropagation(); cancelCharge(); }}
          onPointerCancel={(e) => { e.stopPropagation(); cancelCharge(); }}
          className={`${BUTTON_BASE} ${SHADOW_IDLE} ${tone.surface} gap-1 px-2 text-xs ${tone.text} ${fullWidth ? 'w-full' : 'whitespace-nowrap'} ${className}`}
        >
          <span
            aria-hidden="true"
            className="pointer-events-none absolute inset-y-0 left-0 z-0 bg-white/25"
            style={{ width: `${progress * 100}%` }}
          />
          <span className="relative z-10 inline-flex items-center gap-1">
            {icon && <span className="text-base leading-none">{icon}</span>}
            <span>{label}</span>
          </span>
        </button>
      )}
    </div>
  );
}
