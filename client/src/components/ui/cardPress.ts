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
  /**
   * Le glisser-déposer. `start` est appelé quand le doigt s'éloigne assez pour
   * que ce ne soit plus un tap ; il peut REFUSER en rendant `false` (une carte
   * qui ouvre un menu de conditions, une carte qu'une magie cible…), auquel cas
   * le geste redevient un simple tap annulé.
   *
   * ⚠️ Le hook pose la CAPTURE DU POINTEUR sur l'élément de départ : une souris
   * n'a pas la capture implicite du tactile, donc sans elle le glisser s'arrête
   * dès que le curseur quitte la carte — c'est-à-dire immédiatement.
   */
  drag?: {
    start: (e: ReactPointerEvent<HTMLElement>) => boolean | void;
    move: (e: ReactPointerEvent<HTMLElement>) => void;
    end: (e: ReactPointerEvent<HTMLElement>) => void;
  };
}

export function useCardPress({
  tapOn = 'down', tooltip = null, disabled = false, onTap, drag,
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
      if (dragged.current) { drag!.move(e); return; }
      if (!start.current) return;
      const dx = e.clientX - start.current.x;
      const dy = e.clientY - start.current.y;
      if (dx * dx + dy * dy <= TAP_MOVE_TOLERANCE_PX * TAP_MOVE_TOLERANCE_PX) return;
      cancelTap();
      if (!drag || disabled) return;
      if (drag.start(e) === false) return;
      dragged.current = true;
      // ⚠️ Sans capture, une SOURIS cesse de nous envoyer ses déplacements dès
      // qu'elle quitte la carte — donc dès le premier pixel du glisser.
      (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
      drag.move(e);
    },

    onPointerUp: (e: ReactPointerEvent<HTMLElement>) => {
      clearLong();
      if (dragged.current) {
        dragged.current = false;
        (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
        drag!.end(e);
      } else if (tapOn === 'up' && armed.current && !suppressTap.current) {
        fire();
      }
      armed.current = false;
      suppressTap.current = false;
      start.current = null;
    },

    // Sortir de la vignette avant de relâcher annule le tap (le doigt a glissé).
    // ⚠️ PAS pendant un glisser : la capture du pointeur garde l'élément comme
    // cible, mais un `pointerleave` reste émis au franchissement de sa boîte —
    // l'écouter annulerait le geste au premier pixel.
    onPointerLeave: () => { if (!dragged.current) cancelTap(); },
    onPointerCancel: (e: ReactPointerEvent<HTMLElement>) => {
      if (dragged.current) { dragged.current = false; drag!.end(e); }
      cancelTap();
    },
  };
}
