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
import { guaranteedDrawLabel } from './DrawInfo.js';
import { hasGuaranteedDrawCriteria } from '../logic/Draw.js';
import { specIn, renderLabel } from '../logic/EffectKinds.js';
import type { AttributeEffect, BoardEffectDef } from '../logic/types.js';

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
 * Les archétypes visés par un effet, pour l'affichage — `[]` quand l'effet ne
 * vise pas d'unité (`draw_bonus`) ou ne restreint rien (« toutes les unités »,
 * que l'appelant dit alors en clair).
 */
export function boardTargetAttributes(effect: BoardEffectDef | null | undefined): string[] {
  return boardTargetsUnits(effect) ? (effect?.target_attributes ?? []) : [];
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
 * ⚠️ Les VOIES D'INVOCATION visées ne sont jamais dans ce libellé : elles
 * s'affichent en puces, comme les archétypes et pour la même raison — il n'y a
 * plus qu'un ciblage, `target_attributes`.
 *
 * ⚠️ Un effet absent rend « Aucun effet », jamais une chaîne vide : un blanc
 * dans l'annonce se lirait comme un bug d'affichage, pas comme un terrain neutre.
 */
export function boardEffectLabel(
  // ⚠️ Sert les DEUX familles — un effet de terrain et un effet d'attribut (cf.
  // `TooltipHost.describeEffects`) : `guaranteed_draw` n'existe que du second
  // côté, et ses critères ne vivent que dans `AttributeEffect`.
  effect: BoardEffectDef | AttributeEffect | null | undefined,
  attributeNames?: (ids: string[]) => string,
  /** ⚠️ Une pioche garantie peut NOMMER des cartes : sans résolveur, leur id
   *  brut sort à l'écran. Même règle que `MagieEffect.effectLabel`. */
  cardName: (id: string) => string = (id) => id,
): string {
  if (!effect?.type) return 'Aucun effet';
  const targetAttrs = (effect as BoardEffectDef).target_attributes;
  const targets = attributeNames && targetAttrs?.length ? ` (${attributeNames(targetAttrs)})` : '';
  // ⚠️ Les deux domaines sont interrogés dans cet ordre parce que cette
  // fonction ne peut PAS savoir lequel elle décrit : elle ne reçoit qu'un objet
  // d'effet, jamais son porteur. Là où les deux coexistent, leurs gabarits sont
  // identiques — la préférence n'arbitre donc rien aujourd'hui.
  const rule = specIn(effect.type, ['board', 'attribute'])?.label;
  // ⚠️ Repli sur le TYPE BRUT, jamais sur une chaîne vide : un type ajouté à
  // `BoardEffect.applyEffect` mais oublié dans le registre doit se voir à
  // l'écran plutôt que de disparaître en silence.
  if (rule === undefined || rule === null) return effect.type;
  if (typeof rule === 'string') {
    return renderLabel(rule, { ...effect, stat: statLabel(effect.stat as string), targets });
  }
  return BOARD_LABEL_FNS[rule.fn](effect, attributeNames, cardName);
}

/** Les libellés qui se ramifient — cf. `MagieEffect.MAGIE_LABEL_FNS`. */
const BOARD_LABEL_FNS: Record<string, (
  effect: BoardEffectDef | AttributeEffect,
  attributeNames?: (ids: string[]) => string,
  cardName?: (id: string) => string,
) => string> = {
  // ⚠️ Les critères se disent avec la MÊME fonction que la magie et que la
  // popup de pioche (`DrawInfo.guaranteedDrawLabel`) : trois libellés de la
  // même promesse finiraient par ne pas annoncer ce qui est réellement pioché.
  // ⚠️ Ce type n'existe que côté ATTRIBUT : un terrain ne pioche pas.
  guaranteedDrawAttribute: (effect, attributeNames, cardName) => {
    const draw = effect as AttributeEffect;
    return hasGuaranteedDrawCriteria(draw)
      ? `Pioche garantie ${guaranteedDrawLabel(draw, id => attributeNames?.([id]) ?? id, cardName ?? ((id) => id))}`
      : 'Pioche garantie';
  },
  // ⚠️ Effet d'ATTRIBUT, pas de terrain — cette fonction sert les deux (cf.
  // `TooltipHost.describeEffects`). Sans son entrée ici, le palier de synergie
  // annonçait « shopping_bonus » au joueur, en toutes lettres.
  shoppingBonus: (effect) => `+${effect.value ?? 1} magie à la Phase Shopping`,
};
