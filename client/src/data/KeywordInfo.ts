// Ce qu'un MOT-CLÉ veut dire, en une phrase.
//
// Module PUR — il n'importe que le vocabulaire des effets (racine) et le
// libellé d'un effet, aucune database, aucun composant. Même raison d'être que
// `data/BoardInfo.ts` et `data/SummonInfo.ts` : la suite vitest tourne en node
// SANS DOM, donc ce qui doit être vérifié doit vivre hors des composants.
//
// ⚠️ **DEUX lecteurs, et c'est pourquoi ça n'est plus privé à l'un d'eux** :
// l'infobulle de carte (`TooltipHost`) et le codex du tutoriel
// (`ChapterBlocks`). Deux explications du même mot-clé, c'est deux explications
// qui finissent par ne plus dire la même chose — et celle du codex est
// précisément celle qu'un joueur lit pour APPRENDRE la règle.
import { MOTS_CLES, MOT_CLE_CATEGORY } from '../../../effect-schema.mjs';
import { boardEffectLabel } from './BoardInfo.js';
import type { GuaranteedDraw } from '../logic/types.js';

export { MOT_CLE_CATEGORY };

/** La forme minimale d'un attribut que ce module lit — jamais `data/`. */
export interface KeywordAttribute {
  id: string;
  name?: string;
  icon?: string;
  categorie?: string;
  mot_cle?: string;
  thresholds?: { count: number; effects?: unknown[] }[];
}

/**
 * Ce que ce mot-clé fait, en une phrase — ou `null` si ce n'en est pas un.
 *
 * ⚠️ **Deux sources, dans cet ordre, et c'est le partage des mots-clés** :
 *   • `MOTS_CLES` pour ceux dont la règle n'est PAS une tâche du moteur
 *     (Second souffle, une durée de vie de conteneur) — une phrase écrite à la
 *     main, la seule qu'il y ait ;
 *   • sinon les EFFETS de ses paliers, mis en mots par `boardEffectLabel` — la
 *     même fonction que le tooltip d'attribut et que l'annonce de terrain, donc
 *     le même vocabulaire que partout ailleurs. Un mot-clé qui est un effet se
 *     décrit donc tout seul : changer sa portée en admin change ce que le
 *     joueur lit, sans une ligne de code.
 *
 * ⚠️ Il prend l'attribut DÉJÀ RÉSOLU, jamais son id : la résolution passe par
 * `AttributeDatabase`, qui **jette** tant qu'elle n'est pas initialisée (bancs
 * de dev) — c'est à l'appelant de s'en garder, comme le fait `AttrIcon`.
 *
 * @param appel Ce que la CARTE porteuse appelle, quand le mot-clé est paramétré
 *   par carte (Appelant). Absent, la phrase annonce la mécanique sans la
 *   promesse — ce qui est exactement ce que le codex doit dire.
 */
export function keywordText(
  attr: KeywordAttribute | null | undefined,
  appel?: GuaranteedDraw | null,
  attributeName: (id: string) => string = (id) => id,
  cardName: (id: string) => string = (id) => id,
): string | null {
  if (!attr) return null;
  const def = (MOTS_CLES as Record<string, { aide?: string }>)[attr.mot_cle as string];
  if (def) return def.aide ?? null;
  if (attr.categorie !== MOT_CLE_CATEGORY) return null;
  // ⚠️ Le résolveur d'attributs est passé **même si aucun mot-clé n'annonce de
  // cibles** : `boardEffectLabel` ne s'en sert pour un suffixe « (…) » que s'il
  // lit un `target_attributes`, qu'un effet de mot-clé n'a pas (sa cible est le
  // porteur, et c'est le compilateur qui le dit). Mais il s'en sert AUSSI pour
  // NOMMER les attributs qu'une pioche garantie exige — sans lui, un Appelant
  // qui appelle « un Dragon » annoncerait « ARCH_047 ». Même règle que
  // `MagieEffect.effectLabel` : sans résolveur, un id brut sort à l'écran.
  const texte = (attr.thresholds ?? [])
    .flatMap(t => (t.effects ?? []) as Record<string, unknown>[])
    .map(e => boardEffectLabel(e as never, ids => ids.map(attributeName).join(', '), cardName, undefined, appel))
    .join(', ');
  return texte || null;
}

/**
 * Les mots-clés d'un catalogue d'attributs, triés par id.
 *
 * ⚠️ **Le tri est la règle, pas un détail** : le codex montre une liste, et une
 * liste qui change d'ordre d'un rendu à l'autre est une liste qu'on ne peut pas
 * relire. Même discipline que les sélecteurs de `tutorialContent`.
 *
 * ⚠️ La CATÉGORIE fait foi ici, et c'est le seul endroit du projet où elle
 * décide de quelque chose : ailleurs, c'est le champ `mot_cle` qui porte la
 * mécanique. Ici on ne cherche pas une mécanique, on RANGE — et ranger est
 * exactement ce à quoi la catégorie sert.
 */
export function keywordAttributes(all: KeywordAttribute[]): KeywordAttribute[] {
  return all
    .filter(a => a.categorie === MOT_CLE_CATEGORY)
    .sort((a, b) => a.id.localeCompare(b.id));
}
