// Le GESTE d'une carte — tap, appui long, et tout ce qui l'annule.
//
// Extrait de `CardTile` pour que la carte 3D ne s'en écrive pas une seconde
// version : ce bloc porte quatre corrections gagnées une à une (l'armement, la
// tolérance de déplacement, la capture implicite du tactile, la suppression du
// tap après un tooltip), et une copie les aurait perdues une par une.
//
// ⚠️ Le tap est au `pointerdown` par défaut : retour instantané, indispensable
// en préparation chronométrée. `tapOn: 'up'` bascule au relâchement — le
// DeckBuilder s'en sert pour qu'un appui long (tooltip) n'ajoute pas la carte.
import { useRef } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { useUiStore, type TooltipContent } from '../../stores/uiStore.js';
import { TAP_MOVE_TOLERANCE_PX } from './primitives.js';

export const LONG_PRESS_MS = 500;

export interface CardPressOptions {
  tapOn?: 'down' | 'up';
  tooltip?: TooltipContent | null;
  disabled?: boolean;
  onTap?: () => void;
  /** Appelé quand le doigt s'éloigne assez pour que ce ne soit plus un tap.
   *  C'est le crochet du glisser-déposer ; sans lui, le geste est annulé net. */
  onDragStart?: (e: ReactPointerEvent<HTMLElement>) => void;
}

export function useCardPress({
  tapOn = 'down', tooltip = null, disabled = false, onTap, onDragStart,
}: CardPressOptions) {
  const showTooltip = useUiStore(s => s.showTooltip);
  const longPress = useRef<ReturnType<typeof setTimeout> | null>(null);
  const suppressTap = useRef(false); // un appui long a ouvert le tooltip → annule le tap
  const armed = useRef(false);       // un pointerdown a bien eu lieu ICI
  const dragged = useRef(false);
  const start = useRef<{ x: number; y: number } | null>(null);

  const clearLong = () => {
    if (longPress.current) { clearTimeout(longPress.current); longPress.current = null; }
  };
  const cancelTap = () => { clearLong(); armed.current = false; start.current = null; };
  const fire = () => { if (!disabled) onTap?.(); };

  return {
    onPointerDown: (e: ReactPointerEvent<HTMLElement>) => {
      e.stopPropagation();
      suppressTap.current = false;
      dragged.current = false;
      armed.current = true;
      start.current = { x: e.clientX, y: e.clientY };
      if (tapOn === 'down') fire();
      if (!tooltip) return;
      const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
      longPress.current = setTimeout(() => {
        longPress.current = null;
        suppressTap.current = true;
        showTooltip(tooltip, { left: r.left, top: r.top, bottom: r.bottom, width: r.width, height: r.height });
      }, LONG_PRESS_MS);
    },

    // ⚠️ Un pointeur TACTILE garde une capture implicite sur sa cible de départ
    // pendant tout le glissé : il ne change pas de cible et ne déclenche donc
    // PAS `pointerleave` en défilant. Sans ce contrôle sur le déplacement,
    // chaque défilement commencé sur une carte s'y lisait comme un tap au
    // relâchement.
    onPointerMove: (e: ReactPointerEvent<HTMLElement>) => {
      if (!start.current || dragged.current) return;
      const dx = e.clientX - start.current.x;
      const dy = e.clientY - start.current.y;
      if (dx * dx + dy * dy <= TAP_MOVE_TOLERANCE_PX * TAP_MOVE_TOLERANCE_PX) return;
      cancelTap();
      if (onDragStart && !disabled) { dragged.current = true; onDragStart(e); }
    },

    onPointerUp: () => {
      clearLong();
      if (tapOn === 'up' && armed.current && !suppressTap.current) fire();
      armed.current = false;
      suppressTap.current = false;
      start.current = null;
    },

    // Sortir de la vignette avant de relâcher annule le tap (le doigt a glissé).
    onPointerLeave: cancelTap,
    onPointerCancel: cancelTap,
  };
}
