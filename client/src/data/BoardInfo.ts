// Ce qu'on DIT d'un terrain de combat : son effet en français, et s'il vise des
// unités.
//
// Module PUR — il n'importe que le vocabulaire des stats, aucune database, aucun
// composant. Même raison d'être que `data/SummonInfo.ts` : la suite vitest
// tourne en node SANS DOM, aucun test de composant n'est possible dans ce
// projet. Ce qui doit être vérifié doit donc vivre hors des composants.
//
// Deux lecteurs, et c'est pourquoi ça n'est plus privé à l'un d'eux :
// l'infobulle 🗺️ (`TooltipHost`) et l'annonce de terrain à l'entrée en combat
// (`TerrainAlert`). Deux descriptions du même terrain, c'est deux descriptions
// qui finissent par ne plus dire la même chose.
import { statLabel } from './StatLabels.js';
import type { BoardEffectDef } from '../logic/types.js';

/**
 * Cet effet lit-il `target_attributes` ?
 *
 * ⚠️ Seuls ces trois-là le lisent (cf. `logic/BoardEffect.applyEffect`).
 * `draw_bonus` crédite le joueur QUOI QU'IL ARRIVE : annoncer sous lui des
 * « archétypes boostés » ou un décompte d'unités ferait mentir l'écran. La
 * règle était écrite en dur dans le tooltip ; elle est ici pour que l'annonce
 * ne puisse pas en prendre une autre.
 */
export function boardTargetsUnits(effect: BoardEffectDef | null | undefined): boolean {
  return !!effect && ['stat_bonus', 'stat_modifier', 'shield'].includes(effect.type);
}

/**
 * L'effet d'un terrain, en une ligne.
 *
 * `withTargets` ajoute les noms d'attributs entre parenthèses — l'infobulle ne
 * le fait PAS (elle affiche les archétypes juste en dessous, avec leur icône :
 * un attribut se reconnaît à son pictogramme bien avant son nom), d'où le
 * paramètre. Les noms sont résolus par l'appelant, qui seul peut atteindre
 * `AttributeDatabase` sans faire entrer une database dans ce module pur.
 *
 * ⚠️ Un effet absent rend « Aucun effet », jamais une chaîne vide : un blanc
 * dans l'annonce se lirait comme un bug d'affichage, pas comme un terrain neutre.
 */
export function boardEffectLabel(
  effect: BoardEffectDef | null | undefined,
  attributeNames?: (ids: string[]) => string,
): string {
  if (!effect?.type) return 'Aucun effet';
  const targets = attributeNames && effect.target_attributes?.length
    ? ` (${attributeNames(effect.target_attributes)})`
    : '';
  switch (effect.type) {
    case 'stat_bonus':        return `+${effect.value} ${statLabel(effect.stat as string)}${targets}`;
    case 'stat_modifier':     return `×${effect.value} ${statLabel(effect.stat as string)}${targets}`;
    case 'shield':            return `Bouclier +${effect.value}${targets}`;
    case 'draw_bonus':        return `+${effect.value} pioche`;
    case 'guaranteed_draw':   return 'Pioche garantie';
    case 'revive':            return 'Réanimation';
    case 'board_slot_bonus':  return `+${effect.value} slot`;
    // ⚠️ Repli sur le TYPE BRUT, jamais sur une chaîne vide : un type ajouté à
    // `BoardEffect.applyEffect` mais oublié ici doit se voir à l'écran plutôt
    // que de disparaître en silence.
    default:                  return effect.type;
  }
}
