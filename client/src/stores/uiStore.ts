import { create } from 'zustand';
import type { Card, AttributeDef, BoardDef } from '../logic/types.js';
import type { Unit } from '../logic/Unit.js';

export type ScreenName = 'main_menu' | 'game' | 'combatlab';

export interface ScreenParams {
  deckName?: string;
  [key: string]: unknown;
}

// Ancre écran d'un tooltip (coordonnées viewport). rect optionnel pour un
// positionnement au-dessus/en dessous d'un élément (cartes, unités 3D projetées).
export interface TooltipAnchor {
  left: number;
  top: number;
  bottom: number;
  width: number;
  height: number;
}

export type TooltipContent =
  | { kind: 'card'; card: Card }
  | { kind: 'unit'; unit: Unit }
  | { kind: 'attribute'; attr: AttributeDef; count: number; activeThreshold: unknown }
  | { kind: 'terrain'; board: BoardDef };

interface TooltipState {
  content: TooltipContent;
  anchor: TooltipAnchor;
}

interface UiState {
  screen: ScreenName;
  params: ScreenParams;
  tooltip: TooltipState | null;
  landscapeWarning: boolean;

  navigate: (screen: ScreenName, params?: ScreenParams) => void;
  showTooltip: (content: TooltipContent, anchor: TooltipAnchor) => void;
  hideTooltip: () => void;
  setLandscapeWarning: (on: boolean) => void;
}

// Deep-link ?screen= (parité avec l'ancien routeur maison).
function initialScreen(): ScreenName {
  const s = new URLSearchParams(window.location.search).get('screen');
  if (s === 'game' || s === 'combatlab' || s === 'main_menu') return s;
  return 'main_menu';
}

export const useUiStore = create<UiState>((set) => ({
  screen: initialScreen(),
  params: {},
  tooltip: null,
  landscapeWarning: false,

  navigate: (screen, params = {}) => set({ screen, params, tooltip: null }),
  showTooltip: (content, anchor) => set({ tooltip: { content, anchor } }),
  hideTooltip: () => set((s) => (s.tooltip ? { tooltip: null } : s)),
  setLandscapeWarning: (on) => set({ landscapeWarning: on }),
}));
