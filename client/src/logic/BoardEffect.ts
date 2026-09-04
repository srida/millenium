import type { BoardDef, BoardEffectDef } from './types.js';
import type { Unit } from './Unit.js';
import type { GameState } from './GameState.js';

interface BoardEffectContext {
  playerUnits?: Unit[];
  enemyUnits?: Unit[];
  gameState?: GameState | null;
  /** Id du terrain d'où vient l'effet, posé par `applyBoardEffects`. Ne sert
   *  qu'au registre de provenance des pioches (`draw_bonus`) : un effet
   *  appliqué seul, hors de son terrain, n'a rien à nommer. */
  sourceId?: string | null;
}

/**
 * Les effets d'un terrain — le SEUL lecteur de `board.effects` et de
 * `board.effect`.
 *
 * ⚠️ Deux formes dans la donnée, et une seule ici : `effects` (la liste
 * cumulée) l'emporte dès qu'elle porte quelque chose, `effect` (l'effet unique
 * historique) sert de repli. Les terrains livrés — et `data/boards.json` sur le
 * volume, que `bootstrap()` ne recopie jamais — sont encore en `effect` : le
 * repli n'est pas une politesse, c'est ce qui fait qu'aucune migration n'est
 * nécessaire. L'admin, lui, écrit `effects` et n'écrit plus `effect` (le PUT
 * remplace l'objet entier).
 *
 * ⚠️ Un effet sans `type` est ÉCARTÉ ici, une fois pour toutes : c'est ce qui
 * dispense chaque appelant de sa propre garde, et un `null` traînant dans la
 * liste (lot vide laissé en admin) ne peut pas atteindre le combat.
 */
export function boardEffects(board: BoardDef | null | undefined): BoardEffectDef[] {
  const list = Array.isArray(board?.effects) ? board.effects.filter((e): e is BoardEffectDef => !!e?.type) : [];
  if (list.length) return list;
  return board?.effect?.type ? [board.effect] : [];
}

/**
 * Les unités qu'un effet de terrain touche, parmi celles qu'on lui donne.
 *
 * ⚠️ Extrait d'`applyEffect`, qui l'appelle — et JAMAIS recopié ailleurs :
 * l'annonce de terrain (`GameController`, à l'entrée en combat) compte ses
 * unités boostées avec cette fonction. Deux expressions du même filtre, ce
 * serait s'autoriser à annoncer au joueur un décompte que l'effet n'a pas
 * appliqué.
 *
 * UN SEUL ciblage : `target_attributes` — vide ou absent = tous les archétypes.
 *
 * ⚠️ Le second ciblage (`target_summon_types`) a disparu avec les voies
 * d'invocation : celles-ci sont devenues des attributs comme les autres, donc
 * « les Dragons invoqués par Fusion » s'écrit avec les deux ids dans cette
 * seule liste. Le OU se demande toujours en posant DEUX effets sur le terrain.
 *
 * ⚠️ La liste est cumulative en OU entre ses entrées : une unité est touchée
 * dès qu'elle porte **l'un** des attributs visés.
 */
export function effectTargets(effect: BoardEffectDef | null | undefined, units: Unit[]): Unit[] {
  if (!effect) return [];
  const attrs = effect.target_attributes;
  if (!attrs?.length) return units;
  return units.filter(u => u.attributes.some(a => attrs.includes(a)));
}

export function applyEffect(effect: BoardEffectDef | null | undefined, { playerUnits = [], enemyUnits = [], gameState = null, sourceId = null }: BoardEffectContext = {}): void {
  if (!effect) return;
  const targets = effectTargets(effect, [...playerUnits, ...enemyUnits]);
  switch (effect.type) {
    case 'stat_bonus':
      for (const u of targets) u.applyStatBonus(effect.stat as string, effect.value as number);
      break;
    case 'stat_modifier':
      // Convert multiplicative to additive equivalent so resetCombatStats() cleans it up
      for (const u of targets) u.applyStatBonus(effect.stat as string, Math.round(u._base[effect.stat as string] * ((effect.value as number) - 1)));
      break;
    case 'shield':
      for (const u of targets) u.applyShield(effect.value as number);
      break;
    case 'draw_bonus':
      if (gameState) {
        gameState.player_extra_draws = (gameState.player_extra_draws || 0) + (effect.value as number);
        // Provenance, pour la popup de pioche du tour suivant : un terrain
        // crédite au lancement du combat, la main s'en aperçoit un round plus
        // tard — sans le nom, le bonus paraîtrait sortir de nulle part.
        gameState.player_draw_sources.push({ kind: 'terrain', ref: sourceId ?? '', value: effect.value as number });
      }
      break;
  }
}

/**
 * Tous les effets d'un terrain, appliqués — le point d'entrée du combat.
 *
 * ⚠️ Le cumul est ADDITIF et l'ORDRE de la liste n'y change rien : les trois
 * effets qui touchent une unité écrivent dans `_stat_bonuses` (ou dans le
 * bouclier), jamais dans `_base` que `stat_modifier` relit. Deux `×2 PV` sur un
 * même terrain donnent donc `×3` (deux fois +100 % du socle) et non `×4` — un
 * empilement de multiplicateurs se composerait, et ferait dépendre le résultat
 * de l'ordre d'écriture en admin.
 */
export function applyBoardEffects(board: BoardDef | null | undefined, ctx: BoardEffectContext = {}): void {
  // Le terrain se nomme ici et nulle part ailleurs : `applyEffect` ne reçoit
  // qu'un effet, qui ne sait pas d'où il vient.
  const scoped = { ...ctx, sourceId: board?.id ?? null };
  for (const effect of boardEffects(board)) applyEffect(effect, scoped);
}
