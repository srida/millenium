// Composition de l'offre de la Phase Shopping : quelles magies ont un effet
// RÉEL dans l'état courant (pertinence), et laquelle sort (rareté).
//
// ⚠️ Module PLAT à dessein — il n'importe que des types et les LECTEURS de
// champ d'effet (`MagieEffect`, lui-même sans le moindre import). La pertinence
// d'une magie est une question sur un ÉTAT, pas sur une session : la poser ici
// la rend testable sans instancier une partie (la suite vitest tourne en node
// sans DOM), et empêche `GameSession` d'être le seul endroit où la règle existe.
// C'est `GameSession._offerContext()` qui traduit son état en
// `MagieOfferContext`, et lui seul touche au deck du joueur.
//
// ⚠️ `tierShift` est IMPORTÉ et non recopié : le repli « 0 vaut +1 » doit être
// le même ici et à l'application, sans quoi une magie serait offerte sur un
// décalage et appliquée sur un autre.
import { tierShift } from './MagieEffect.js';
// ⚠️ IMPORTÉ et non recopié, exactement comme `tierShift` : les critères d'une
// pioche garantie doivent se lire pareil à l'offre, à la pioche et à l'annonce.
// `Draw` est lui aussi plat (il n'importe que des types).
import { guaranteedDrawCriteria, hasGuaranteedDrawCriteria } from './Draw.js';
// ⚠️ Le registre est le SEUL endroit qui dise encore quels types existent : la
// table de pertinence en dérive au lieu d'énumérer. C'est ce qui referme le
// piège documenté juste en dessous — un type ajouté au moteur et oublié ici
// disparaissait du jeu sans un mot.
import { relevanceRule } from './EffectKinds.js';
import type { Magie, MagieRarity } from './types.js';

/**
 * Poids relatifs du tirage. Mesuré sur le catalogue livré (10 Communes,
 * 10 Rares, 4 Légendaires, total 94) : Commune 63,8 % · Rare 31,9 % ·
 * Légendaire 4,3 % par emplacement. Une partie compte 4 phases de Shopping
 * (`MAX_ROUNDS` = 5), soit 12 emplacements : une run sur 2,4 croise une
 * Légendaire, et deux Légendaires dans la même offre de 3 tombent une fois sur
 * 230. Descendre plus bas ferait de « Légendaire » un mot que le joueur ne
 * verrait jamais.
 */
export const RARITY_WEIGHTS: Record<MagieRarity, number> = { 1: 6, 2: 3, 3: 1 };

export const RARITY_LABELS: Record<MagieRarity, string> = {
  1: 'Commune', 2: 'Rare', 3: 'Légendaire',
};

/**
 * ⚠️ `rarity` est FACULTATIF dans la donnée : les magies écrites avant
 * l'existence du champ n'en ont pas, et `initial-data/` n'est relu qu'au premier
 * boot du serveur. Le défaut à 1 est ce qui rend l'oubli inoffensif.
 * ⚠️ `Number()` et non une comparaison stricte : un `<select>` d'admin peut
 * avoir persisté la chaîne `"2"`.
 */
export function rarityOf(magie: Magie | null | undefined): MagieRarity {
  const r = Number((magie as { rarity?: unknown } | null | undefined)?.rarity);
  return r === 2 || r === 3 ? (r as MagieRarity) : 1;
}

/** L'état courant réduit aux seuls faits dont dépend la pertinence d'une magie. */
export interface MagieOfferContext {
  /** Unités VIVANTES du joueur sur le board. */
  boardUnitCount: number;
  /** Unités Fusion AVEC matériaux — la règle exacte de `GameSession.magieUnitTargets`. */
  defusableFusionCount: number;
  /** Unités du joueur PORTANT un pouvoir — lu sur l'unité, pas sur sa carte
   *  (`grant_power` a pu lui en poser un). */
  poweredUnitCount: number;
  /** Unités du board dont la CARTE est retrouvable au catalogue — les seules
   *  qu'une duplication puisse copier (`GameSession._duplicableUnits`). */
  duplicableUnitCount: number;
  /** Le pendant au CIMETIÈRE. Distinct de `graveyardCount`, qui suffit à
   *  `revive` : celui-ci ne lit que l'unité, la duplication lit sa carte. */
  duplicableGraveyardCount: number;
  graveyardCount: number;
  handCount: number;
  /** Tiers des cartes de la MAIN — ce que `shift_tier_card` peut remplacer. */
  handTiers: number[];
  /** Tiers des unités du BOARD dont la carte est au catalogue — ce que
   *  `shift_tier_unit` peut remplacer. Distinct de `handTiers` : les deux
   *  magies ne désignent pas la même chose. */
  boardTiers: number[];
  /** Cartes de la main dont un matériel d'invocation peut être RENDU en main
   *  (`draw_material`). ⚠️ Ni `handCount` ni « la carte a des matériels » ne
   *  suffisent : un matériel désigné par attribut (`ARCH_*`) n'est une carte
   *  que si le deck en porte une, et un id de matériel peut avoir quitté le
   *  catalogue. Même famille que `duplicableUnitCount`. */
  materialSourceCount: number;
  /** Tiers effectivement présents dans le DECK du joueur (pas dans sa main). */
  deckTiers: number[];
  /** Attributs présents dans le DECK — le pendant de `deckTiers` pour une
   *  pioche garantie filtrée par `attribute`. Les voies d'invocation étant
   *  devenues des attributs, elles y figurent comme les autres. */
  deckAttributes: string[];
  /** Ids des cartes du DECK — le pendant des deux précédents pour une pioche
   *  garantie qui NOMME ses cartes. ⚠️ Ce sont des ids, pas des cartes : le deck
   *  ne sort pas de la session, `_offerContext` en dérive ce qu'il faut. */
  deckCardIds: string[];
  // ⚠️ Les deux drapeaux suivants portent sur le DECK, jamais sur la main :
  // les modificateurs de main sont DIFFÉRÉS au `startPreparation()` suivant,
  // donc appliqués après une pioche de cinq cartes neuves — la main du moment
  // ne dit rien de ce qu'ils vont trouver. Chacun reprend le prédicat EXACT que
  // `startPreparation` appliquera.
  //
  // Ils étaient QUATRE, un par voie d'invocation remisable ; il n'y a plus que
  // deux gestes possibles sur une condition, donc deux questions à poser.
  /** Une carte du deck a-t-elle une condition qui coûte des matériels ? */
  deckHasMaterialCost: boolean;
  /** Une carte du deck a-t-elle une condition qui NOMME un matériel ? */
  deckHasNamedRequirement: boolean;
  /**
   * Les attributs portés par ces cartes-là — ce qu'il faut pour juger une
   * remise VISÉE (`effect.attribute`). ⚠️ Une liste vide ne veut pas dire
   * « aucune carte retouchable » : une carte sans attribut n'y figure pas.
   */
  deckMaterialCostAttributes: string[];
  deckNamedRequirementAttributes: string[];
  /** Le cap partagé +1 slot de board est-il encore libre ? */
  boardSlotBonusAvailable: boolean;
  /** `player_hp` est-il sous son plafond (`PLAYER_HP_CAP`) ? */
  playerHpBelowCap: boolean;
  /** Un bonus de multiplicateur de dégâts change-t-il quelque chose ici ?
   *  FAUX en PvP, où `enemy_hp` est réécrit chaque round depuis les PV
   *  autoritaires de l'adversaire — cf. `GameSession._offerContext`. */
  damageMultiplierMatters: boolean;
}

/** Une cible existe-t-elle dont le tier décalé de `shift` soit dans le deck ? */
function _hasTierShift(targetTiers: readonly number[], deckTiers: readonly number[], shift: number): boolean {
  return targetTiers.some(t => deckTiers.includes(t + shift));
}

/**
 * Une magie a-t-elle un effet réel ici et maintenant ?
 *
 * ⚠️ `default: false` — la table est FERMÉE, et c'est délibéré. Un `effect` nul
 * ou d'un type inconnu traverse le `switch` d'`applyEffect` sans rien faire :
 * l'offrir, c'est offrir un blanc, très précisément ce que ce filtre existe pour
 * supprimer. **Corollaire à connaître : un nouveau type d'effet ajouté à
 * `MagieEffect.applyEffect` mais oublié ici disparaît silencieusement du jeu.**
 * C'est pour l'attraper que `magie-offer.test.ts` relit `initial-data/magies.json`
 * et exige que chaque magie livrée soit pertinente sous un contexte permissif.
 */
export function isMagieRelevant(magie: Magie, ctx: MagieOfferContext): boolean {
  const effect = magie?.effect;
  if (!effect?.type) return false;
  const rule = relevanceRule(effect.type);
  // ⚠️ LE `default: false`, désormais structurel : un type que le registre ne
  // déclare pas, ou qu'il déclare sans règle de pertinence, n'est pas offert.
  // La table reste FERMÉE — elle a seulement cessé d'être recopiée à la main.
  if (!rule) return false;
  if (rule === 'always') return true;
  // Les deux formes régulières couvrent 21 des 27 types : un compteur du
  // contexte à comparer à zéro, ou un booléen à lire tel quel.
  if ('gt0' in rule) return (ctx[rule.gt0 as keyof MagieOfferContext] as number) > 0;
  if ('flag' in rule) return !!ctx[rule.flag as keyof MagieOfferContext];
  return RELEVANCE_FNS[rule.fn](effect, magie, ctx);
}

/**
 * Les six pertinences qui ne se réduisent pas à un compteur — parce qu'elles
 * croisent PLUSIEURS faits, pas parce qu'elles sont compliquées. Le registre les
 * nomme, elles vivent ici : `EffectKinds` ne connaît pas `MagieOfferContext`.
 */
const RELEVANCE_FNS: Record<string,
  (effect: NonNullable<Magie['effect']>, magie: Magie, ctx: MagieOfferContext) => boolean> = {

  // ⚠️ Un tier absent du deck n'est PAS un no-op : `startPreparation` a un
  // double repli et pioche quand même — dans tout le deck, sans la restriction
  // de tier du tour. La magie n'est donc pas inerte, elle MENT : son libellé
  // promet un tier qu'elle ne rendra pas. On ne l'offre pas.
  // ⚠️ Les filtres sont FACULTATIFS et se cumulent : une magie qui ne porte
  // qu'un attribut n'a pas de tier à valider, et l'ancienne écriture
  // (`ctx.deckTiers.includes(effect.tier ?? 0)`) l'aurait rendue à JAMAIS non
  // pertinente — donc jamais offerte, en silence.
  guaranteedDraw: (effect, _magie, ctx) => {
    // Sans AUCUN critère, la magie ne promet rien de nommable : elle déplace un
    // slot de pioche aléatoire vers… une pioche aléatoire. C'est le cas
    // « blanc » que ce filtre existe pour supprimer, et il reste rejeté.
    if (!hasGuaranteedDrawCriteria(effect)) return false;
    const { tier, attributes, cardIds } = guaranteedDrawCriteria(effect);
    // ⚠️ Chaque critère est vérifié SÉPARÉMENT contre le deck : le contexte ne
    // porte que des listes, pas les cartes, donc « un Tier 4 » et « un Dragon »
    // ne prouvent pas « un Dragon de Tier 4 ». C'est indulgent d'un cheveu,
    // comme la pertinence du remplacement par tier — et l'inverse (exporter le
    // deck) coûterait la règle qui le garde dans la session.
    return (!tier || ctx.deckTiers.includes(tier))
      && attributes.every(id => ctx.deckAttributes.includes(id))
      && (cardIds.length === 0 || cardIds.some(id => ctx.deckCardIds.includes(id)));
  },

  // Remplacement par tier : il faut une cible ET un pool où puiser. Le pool est
  // le DECK du joueur, comme celui d'une pioche garantie — c'est la seule
  // réserve de cartes qu'une partie connaisse.
  //
  // ⚠️ Optimiste d'un cheveu côté BOARD, et c'est assumé : le ciblage écarte en
  // plus les unités dont tout le pool est DÉJÀ VIVANT sur le terrain (la règle
  // du doublon, cf. `GameSession._boardTierShiftPool`), ce que des tiers seuls
  // ne peuvent pas dire. Le cas demande que toutes les cartes du deck à ce tier
  // soient posées en même temps ; il retombe alors sur la garde « Aucune cible
  // valide » de `GameController.chooseMagie`, qui ne consomme pas la magie.
  shiftTierCard: (_effect, magie, ctx) => _hasTierShift(ctx.handTiers, ctx.deckTiers, tierShift(magie)),
  shiftTierUnit: (_effect, magie, ctx) => _hasTierShift(ctx.boardTiers, ctx.deckTiers, tierShift(magie)),

  // ⚠️ Les DEUX conditions : une main vide n'a rien à sacrifier, et à PV pleins
  // la magie brûlerait une carte pour rien. Même exigence que `player_hp_bonus`,
  // dont c'est le jumeau côté gain.
  sacrificeCardHp: (_effect, _magie, ctx) => ctx.handCount > 0 && ctx.playerHpBelowCap,

  // ⚠️ Une remise VISÉE (`attribute`) doit trouver une carte qui porte
  // l'attribut ET que le geste peut retoucher : les deux séparément se
  // contentent d'un deck où ce sont deux cartes différentes, et la magie serait
  // alors offerte pour ne rien faire.
  reduceMaterials: (effect, _magie, ctx) => effect.attribute
    ? ctx.deckMaterialCostAttributes.includes(effect.attribute)
    : ctx.deckHasMaterialCost,
  removeRequirements: (effect, _magie, ctx) => effect.attribute
    ? ctx.deckNamedRequirementAttributes.includes(effect.attribute)
    : ctx.deckHasNamedRequirement,
};

/**
 * L'offre : on FILTRE d'abord, on tire ensuite — roulette pondérée par rareté,
 * sans remise (une magie ne peut pas occuper deux emplacements de la même offre).
 *
 * ⚠️ Aucun repli sur une magie non pertinente. L'offre peut donc être plus
 * courte que `count`, et vide — `GameController._startShopping` saute déjà la
 * phase sur une offre vide.
 *
 * ⚠️ La rareté est CONDITIONNELLE à la pertinence : les 4,3 % de Légendaire ne
 * valent que pool complet. Dans un état pauvre (board, main et cimetière vides)
 * il ne reste qu'une poignée de magies éligibles, dont la part de Légendaires
 * est bien plus haute. Aucune renormalisation n'est faite — un état pauvre offre
 * peu de choix, et c'est cohérent.
 */
export function pickMagies(
  pool: readonly Magie[],
  ctx: MagieOfferContext,
  count: number,
  rand: () => number = Math.random,
): Magie[] {
  const candidates = pool.filter(m => isMagieRelevant(m, ctx));
  const picked: Magie[] = [];
  while (picked.length < count && candidates.length > 0) {
    // Le total est RECALCULÉ à chaque pioche plutôt que maintenu par
    // soustraction : sur 24 entrées au plus, le coût est nul et la correction ne
    // dépend d'aucune accumulation.
    let total = 0;
    for (const m of candidates) total += RARITY_WEIGHTS[rarityOf(m)];
    let roll = rand() * total;
    // Le dernier index sert de repli : `rand()` rendant [0,1[, `roll < total`
    // est toujours vrai — mais on ne fait pas dépendre la correction d'un
    // flottant.
    let idx = candidates.length - 1;
    for (let i = 0; i < candidates.length; i++) {
      roll -= RARITY_WEIGHTS[rarityOf(candidates[i])];
      if (roll < 0) { idx = i; break; }
    }
    picked.push(candidates[idx]);
    candidates.splice(idx, 1);
  }
  return picked;
}
