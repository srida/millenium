// L'état visuel et l'intention de tap d'une carte de main ou de cimetière —
// **la seule écriture de ces deux tables**, lue par `HandBar` et
// `GraveyardTray`.
//
// Elle vit ici, pure et sans import, pour deux raisons :
//  · la table était RECOPIÉE dans les deux composants (`HandCard` et
//    `GraveCard`), qui posent pourtant la même question à un mot près — le
//    cimetière n'ayant ni « jouable » ni « levée » ;
//  · la suite tourne en `environment: 'node'`, sans DOM : un composant React
//    n'est pas testable dans ce projet, une fonction pure l'est.
//
// ⚠️ Aucune classe Tailwind ici, et aucune dépendance au rendu : ce module dit
// CE QUE la carte est (retenue, candidate, éteinte), pas comment on la dessine.
// C'est ce qui lui permet de survivre au remplacement des vignettes 2D par les
// cartes 3D — le rendu change, la table ne bouge pas.

/** Cadre : or = retenue / candidate, blanc = matériau retenu. Même code couleur
 *  que les unités du board (`three/UnitCardEl.ts` + `styles/board3d.css`). */
export type CardHighlight = 'none' | 'selected' | 'candidate' | 'material';
/** Extinction : `soft` = non sélectionnable (cimetière), `strong` = injouable
 *  ou hors des cibles d'une magie (main). */
export type CardDim = 'none' | 'soft' | 'strong';
/** Sortie de la carte hors de sa bande : vers le haut en portrait, vers le
 *  board (donc à droite) quand la main est un rail vertical. */
export type CardLift = 'none' | 'up' | 'right';

export interface CardVisual {
  highlight: CardHighlight;
  dim: CardDim;
  lift: CardLift;
  /** Exemplaires regroupés sous cette entrée — `null` en dessous de 2. */
  badge: number | null;
  /** Épaisseur de pile : la carte porte visiblement plusieurs exemplaires. */
  stacked: boolean;
}

/** Ce que `HandEntry` (`stores/gameStore`) porte d'utile à cette table.
 *  Structurel et non importé : le module reste sans dépendance, donc chargeable
 *  par un test qui ne monte ni store ni DOM. */
export interface HandCardState {
  idx: number;
  count: number;
  playable: boolean;
  selected: boolean;
}

/** Idem pour `GraveyardEntry` — `candidate` = sélectionnable comme matériau
 *  pour la carte en cours de composition. */
export interface GraveyardCardState {
  candidate: boolean;
  selected: boolean;
}

export interface HandCardContext {
  /** Une magie de la Phase Shopping attend une cible de MAIN. */
  targeting: boolean;
  /** Cette carte-ci fait partie des cibles que la magie peut servir. */
  targetable: boolean;
  /** Mode web : la main est un rail vertical, la carte retenue sort à droite. */
  rail: boolean;
}

/**
 * Cette carte est-elle une cible recevable ?
 *
 * ⚠️ `null` veut dire « aucune restriction » et non « aucune cible » : c'est le
 * cas de trois magies de main sur cinq (`hand_to_graveyard`, `duplicate_card`,
 * `sacrifice_card_hp`), qui acceptent jusqu'aux cartes injouables — c'est même
 * souvent celle-là qu'on veut brûler.
 */
export function handTargetable(handTargets: readonly number[] | null, idx: number): boolean {
  return !handTargets || handTargets.includes(idx);
}

/**
 * ⚠️ En ciblage, « candidate » veut dire TAPABLE : une carte que la magie ne
 * peut pas servir s'éteint au lieu de se laisser choisir pour rien. Et la
 * sélection d'invocation (`selected`) ne s'affiche PAS pendant un ciblage —
 * deux liserés d'or pour deux questions différentes se liraient comme un seul.
 */
export function handCardVisual(entry: HandCardState, ctx: HandCardContext): CardVisual {
  const candidate = ctx.targeting && ctx.targetable;
  const held = entry.selected && !ctx.targeting;
  return {
    highlight: candidate ? 'candidate' : held ? 'selected' : 'none',
    lift: held ? (ctx.rail ? 'right' : 'up') : 'none',
    dim: ctx.targeting ? (candidate ? 'none' : 'strong') : (entry.playable ? 'none' : 'strong'),
    badge: entry.count > 1 ? entry.count : null,
    stacked: entry.count > 1,
  };
}

/**
 * Le cimetière ne connaît ni « jouable » ni « levée » : une unité neutralisée
 * ne se pose pas, elle se désigne. `targeting` (magie `revive` ou
 * `duplicate_graveyard_unit`) rend TOUTE unité sélectionnable — la magie choisit
 * dans le cimetière entier, là où une invocation ne voit que ses matériaux
 * légitimes.
 */
export function graveyardCardVisual(entry: GraveyardCardState, ctx: { targeting: boolean }): CardVisual {
  const selectable = entry.candidate || ctx.targeting;
  return {
    highlight: entry.selected ? 'material' : selectable ? 'candidate' : 'none',
    lift: 'none',
    dim: entry.selected || selectable ? 'none' : 'soft',
    badge: null,
    stacked: false,
  };
}

/**
 * Ce qu'un tap DEMANDE, sans savoir qui l'exécutera.
 *
 * Les trois verbes sont ceux du `GameController` : `magie_target` →
 * `resolveMagieHandTarget` / `resolveMagieGraveyardTarget`, `select` /
 * `deselect` → `selectCard`, `material` → `tapGraveyardUnit`. Les nommer ici
 * plutôt que de les appeler rend la règle testable sans contrôleur.
 */
export type CardTapIntent =
  | { kind: 'none' }
  | { kind: 'magie_target' }
  | { kind: 'select' }
  | { kind: 'deselect' }
  | { kind: 'material' };

/**
 * ⚠️ Le tap sur une carte DÉJÀ retenue la relâche (`deselect`) : c'est une
 * bascule, pas une sélection. Sans elle, une carte choisie par erreur ne se
 * lâchait qu'en en choisissant une autre.
 *
 * ⚠️ Une carte INJOUABLE reste tapable hors ciblage — `selectCard` l'accepte et
 * c'est l'écran qui dit pourquoi elle ne se pose pas (surlignage vide, menu de
 * conditions). La refuser ici priverait le joueur de la seule façon d'apprendre
 * ce qui lui manque.
 */
export function handTapIntent(entry: HandCardState, ctx: HandCardContext): CardTapIntent {
  if (ctx.targeting) return ctx.targetable ? { kind: 'magie_target' } : { kind: 'none' };
  return entry.selected ? { kind: 'deselect' } : { kind: 'select' };
}

/** Le cimetière n'a pas de refus : hors ciblage, le tap bascule le matériau
 *  (`tapGraveyardUnit` filtre lui-même les unités non candidates). */
export function graveyardTapIntent(ctx: { targeting: boolean }): CardTapIntent {
  return ctx.targeting ? { kind: 'magie_target' } : { kind: 'material' };
}

export interface HandVisibilityState {
  /** Le contrôleur est monté — rien à afficher tant que la partie se construit. */
  hasController: boolean;
  combatActive: boolean;
  /** `shopping?.awaitingTarget === 'hand'`. */
  targetingHand: boolean;
  roundIntro: boolean;
  drawPopup: boolean;
}

/**
 * ⚠️ La main se masque sur `roundIntro` / `drawPopup`, et ce n'est PAS du
 * style : `session.hand` porte déjà les cartes du tour dès `startPreparation()`,
 * et la bande les affichait en clair SOUS la popup de pioche avant le tap —
 * exactement le spoil que la popup existe pour éviter.
 *
 * ⚠️ Elle reste visible pendant un ciblage de main malgré `combatActive` : la
 * Phase Shopping a lieu APRÈS le combat, drapeau encore levé.
 */
export function handVisible(s: HandVisibilityState): boolean {
  if (!s.hasController) return false;
  if (s.combatActive && !s.targetingHand) return false;
  return !s.roundIntro && !s.drawPopup;
}

export interface GraveyardVisibilityState {
  hasController: boolean;
  combatActive: boolean;
  /** `shopping?.awaitingTarget === 'graveyard'`. */
  targetingGraveyard: boolean;
  count: number;
}

/**
 * ⚠️ Le cimetière ne se masque PAS à l'ouverture de tour, contrairement à la
 * main : il ne montre que des unités déjà vues au combat précédent, il n'y a
 * aucune pioche à divulguer. Un cimetière vide ne pose pas de bandeau vide.
 */
export function graveyardVisible(s: GraveyardVisibilityState): boolean {
  if (!s.hasController) return false;
  if (s.combatActive && !s.targetingGraveyard) return false;
  return s.count > 0;
}
