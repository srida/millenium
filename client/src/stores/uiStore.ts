import { create } from 'zustand';
import type { Card, AttributeDef, BoardDef } from '../logic/types.js';
import type { Unit } from '../logic/Unit.js';

export type ScreenName =
  | 'main_menu' | 'auth' | 'reset_password' | 'profile' | 'friends'
  | 'deck_selector' | 'deck_builder' | 'online_lobby' | 'tournament' | 'arcade' | 'missions' | 'shop'
  | 'tutorial' | 'game' | 'game_pvp' | 'combatlab' | 'testbench';

const SCREEN_NAMES: ScreenName[] = [
  'main_menu', 'auth', 'reset_password', 'profile', 'friends',
  'deck_selector', 'deck_builder', 'online_lobby', 'tournament', 'arcade', 'missions', 'shop',
  'tutorial', 'game', 'game_pvp', 'combatlab', 'testbench',
];

// 'manage' = gérer ses decks et choisir le deck ACTIF (celui joué partout) ;
// 'play' = ne choisir que le deck de l'IA avant une partie solo.
export type DeckSelectorMode = 'play' | 'manage';

export interface ScreenParams {
  deckName?: string;
  // Deck confié à l'EnemyAI (mode solo). Absent = miroir du deck joueur.
  // Les adversaires solo sont des decks PUBLICS : ils ne vivent pas dans
  // DeckRepository, donc le contenu voyage avec le nom (qui n'est plus qu'un
  // libellé d'affichage).
  enemyDeckName?: string;
  enemyDeck?: Record<string, string[]>;
  // DeckSelector : 'manage' (gestion + choix du deck actif) ou 'play' (choix du
  // seul deck de l'IA). Propagé au DeckBuilder pour que le retour revienne dans
  // le mode d'origine.
  mode?: DeckSelectorMode;
  // Écran de jeu lancé depuis le Tournoi : la partie compte comme une manche du
  // bracket (adversaire + deck lus dans tournamentStore.pendingGame).
  tournament?: boolean;
  // Écran de jeu lancé depuis l'Arcade : la partie est un duel de la run
  // quotidienne (adversaire, handicap IA et deck lus dans arcadeStore, qui les
  // tient du SERVEUR — c'est ce qui rend la run reprenable après un F5).
  arcade?: boolean;
  // Panneau admin (iframe) : édite un deck PUBLIC (par id) au lieu d'un deck du
  // joueur. Voir App.tsx / DeckBuilder.tsx.
  publicDeckId?: string;
  // Mode tutoriel : l'écran de jeu joue le deck d'entraînement et monte le
  // coach ; le DeckBuilder affiche le guide et revient au tutoriel. Les deux
  // écrans sont les VRAIS écrans — le drapeau ne change que l'accompagnement.
  tutorial?: boolean;
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

  navigate: (screen: ScreenName, params?: ScreenParams) => void;
  showTooltip: (content: TooltipContent, anchor: TooltipAnchor) => void;
  hideTooltip: () => void;
}

// Deep-link ?screen= (parité avec l'ancien routeur maison).
function initialScreen(): ScreenName {
  const raw = new URLSearchParams(window.location.search).get('screen');
  if (raw === 'resetpwd') return 'reset_password'; // alias des anciens liens e-mail
  const s = raw as ScreenName | null;
  return s && SCREEN_NAMES.includes(s) ? s : 'main_menu';
}

// Deep-link ?publicDeckId= : ouvre DeckBuilder sur un deck PUBLIC (panneau
// admin, iframe), plutôt qu'un deck du joueur. Seul param transmis par URL —
// tous les autres passent par navigate() en SPA.
function initialParams(): ScreenParams {
  const publicDeckId = new URLSearchParams(window.location.search).get('publicDeckId');
  return publicDeckId ? { publicDeckId } : {};
}

export const useUiStore = create<UiState>((set) => ({
  screen: initialScreen(),
  params: initialParams(),
  tooltip: null,

  navigate: (screen, params = {}) => set({ screen, params, tooltip: null }),
  showTooltip: (content, anchor) => set({ tooltip: { content, anchor } }),
  hideTooltip: () => set((s) => (s.tooltip ? { tooltip: null } : s)),
}));
