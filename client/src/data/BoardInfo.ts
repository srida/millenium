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
import { RARITY_LABELS } from '../logic/MagieOffer.js';
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
  /** ⚠️ `guaranteed_magie` peut NOMMER une magie : sans résolveur, son id brut
   *  sort à l'écran. Même règle que `cardName` pour `guaranteed_draw`. */
  magieName: (id: string) => string = (id) => id,
  /**
   * Ce que la CARTE porteuse appelle — le seul paramètre d'effet du projet qui
   * ne vit pas sur l'effet (mot-clé **Appelant**, `guaranteed_draw_bearer`).
   *
   * ⚠️ Un argument et non une lecture : cette fonction est PURE et ne connaît
   * aucune carte. C'est exactement le statut de `cardName` et de `magieName` —
   * l'appelant sait de quelle carte il parle, pas elle.
   */
  appel?: import('../logic/types.js').GuaranteedDraw | null,
): string {
  if (!effect?.type) return 'Aucun effet';
  const targetAttrs = (effect as BoardEffectDef).target_attributes;
  const targets = attributeNames && targetAttrs?.length ? ` (${attributeNames(targetAttrs)})` : '';
  switch (effect.type) {
    case 'stat_bonus':        return `+${effect.value} ${statLabel(effect.stat as string)}${targets}`;
    case 'stat_modifier':     return `×${effect.value} ${statLabel(effect.stat as string)}${targets}`;
    case 'shield':            return `Bouclier +${effect.value}${targets}`;
    case 'draw_bonus':        return `+${effect.value} pioche`;
    // ⚠️ `value` n'est PAS lu — le soin suit le max courant, jamais un chiffre
    // figé (cf. `compile.ts`). Le dire en toutes lettres évite qu'un joueur
    // cherche un montant qui n'existe pas.
    case 'heal':               return `Soin total${targets}`;
    // ⚠️ Le signe se DÉRIVE de `value`, jamais écrit en dur : un `player_hp_bonus`
    // peut infliger (`value` négatif) autant que soigner. `target` ne vaut que
    // côté terrain (seul porteur qui sache viser l'adversaire) — absent, c'est
    // toujours le joueur.
    case 'player_hp_bonus': {
      const v = (effect.value as number) ?? 0;
      const qui = (effect as BoardEffectDef).target === 'ennemi' ? 'adversaire' : 'joueur';
      return `${v > 0 ? '+' : ''}${v} PV (${qui})`;
    }
    // ⚠️ Même geste que `guaranteed_draw` juste en dessous : la rareté ET la
    // magie nommée sont FACULTATIVES et se cumulent, donc l'absence des deux
    // annonce juste la promesse nue.
    case 'guaranteed_magie': {
      const g = effect as AttributeEffect;
      const bits: string[] = [];
      if (g.rarity) bits.push(RARITY_LABELS[g.rarity as 1 | 2 | 3] ?? `rareté ${g.rarity}`);
      if (g.magie_id) bits.push(magieName(g.magie_id));
      return bits.length ? `Magie garantie (${bits.join(', ')})` : 'Magie garantie';
    }
    // ⚠️ Les critères se disent avec la MÊME fonction que la magie et que la
    // popup de pioche (`DrawInfo.guaranteedDrawLabel`) : trois libellés de la
    // même promesse finiraient par ne pas annoncer ce qui est réellement pioché.
    case 'guaranteed_draw': {
      // ⚠️ Ce type n'existe que côté ATTRIBUT : un terrain ne pioche pas.
      const draw = effect as AttributeEffect;
      return hasGuaranteedDrawCriteria(draw)
        ? `Pioche garantie ${guaranteedDrawLabel(draw, id => attributeNames?.([id]) ?? id, cardName)}`
        : 'Pioche garantie';
    }
    // ⚠️ Le mot-clé **Appelant**. Le seul libellé du fichier qui dépende d'une
    // donnée EXTÉRIEURE à l'effet : ses critères vivent sur la carte porteuse.
    // Sans `appel`, on annonce la mécanique sans la promesse — jamais « Au
    // choix », qui serait une promesse que le moteur ne tiendra pas (un porteur
    // sans appel ne pousse rien).
    case 'guaranteed_draw_bearer':
      return appel && hasGuaranteedDrawCriteria(appel)
        ? `Appelle ${guaranteedDrawLabel(appel, id => attributeNames?.([id]) ?? id, cardName)} au tour suivant`
        : 'Appelle ce que sa carte nomme, au tour suivant';
    case 'revive':            return 'Réanimation';
    // ⚠️ Le mot-clé **Tour**, et il DIT SES DEUX MOITIÉS : « immobile » seul
    // (le repli sur le type brut, qui sortait avant) laisse croire qu'on peut
    // la repousser — or c'est justement ce qu'il interdit. Un mot-clé qui
    // n'annonce que la moitié de sa règle est pire qu'un mot-clé muet.
    case 'immobile':          return 'Ne se déplace pas et ne peut pas être poussée';
    // ⚠️ Le mot-clé **Explosif**, et il nomme les DEUX choses que le joueur ne
    // peut pas deviner : *quand* (en mourant) et *laquelle* (la plus proche).
    // Le repli sur le type brut sortait « destroy_enemy » à l'écran.
    case 'destroy_enemy':     return 'En mourant, détruit l\'unité adverse la plus proche';
    case 'board_slot_bonus':  return `+${effect.value} slot`;
    // ⚠️ Effet d'ATTRIBUT, pas de terrain — cette fonction sert les deux (cf.
    // `TooltipHost.describeEffects`). Sans son entrée ici, le palier de synergie
    // annonçait « shopping_bonus » au joueur, en toutes lettres.
    case 'shopping_bonus':    return `+${effect.value ?? 1} magie à la Phase Shopping`;
    // ⚠️ Repli sur le TYPE BRUT, jamais sur une chaîne vide : un type ajouté à
    // `BoardEffect.applyEffect` mais oublié ici doit se voir à l'écran plutôt
    // que de disparaître en silence.
    default:                  return effect.type;
  }
}
