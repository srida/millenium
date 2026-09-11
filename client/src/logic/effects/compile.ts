// LE COMPILATEUR — traduit la donnée d'un porteur en `Effet[]`.
//
// ⚠️ **Pur, sans état, sans hasard, sans `data/`.** Il prend un objet de
// catalogue et rend des effets ; il n'en applique aucun. C'est ce qui permet au
// mode ombre de l'étape 1 d'exister : on compile, on exécute les deux chemins,
// on compare — sans qu'aucun des deux ne puisse toucher l'autre.
//
// ⚠️ Le compilateur est DÉLIBÉRÉMENT strict : un effet qu'il ne sait pas
// traduire n'est pas ignoré en silence, il est **rapporté**
// (`CompilationResult.refus`). C'est toute la différence avec les moteurs
// actuels, dont chaque `switch` a un `default` muet — la mécanique exacte qui a
// produit les vingt-et-un effets morts.
//
// Cf. `docs/moteur-effets.md` §4 et §6.

import type { BoardDef, BoardEffectDef } from '../types.js';
import { boardEffects } from '../BoardEffect.js';
import { CHAMPS_UNITE, CHAMPS_JOUEUR } from './types.js';
import type { Effet, Tache, Selecteur, ChampUnite, Quand } from './types.js';

/** La forme minimale d'un attribut que le compilateur lit — jamais `data/`. */
export interface AttributeLike {
  id: string;
  timing?: string;
  thresholds?: readonly { count: number; effects?: readonly AttributeEffectLike[] }[];
}

/** Les champs qu'un effet d'attribut peut porter — la donnée, telle qu'elle est. */
export interface AttributeEffectLike {
  type: string;
  stat?: string;
  value?: number;
  value_per?: string;
  trigger?: string;
  max?: number;
  hp_percent?: number;
  tier?: number;
  attribute?: string;
  attributes?: string[];
  card_ids?: string[];
}

/** Ce qu'une compilation rend : ce qui a été traduit, et ce qui ne l'a pas été. */
export interface CompilationResult {
  effets: Effet[];
  /** Un par effet source non traduit, avec sa raison. **Jamais silencieux.** */
  refus: { porteur: string; raison: string; detail: string }[];
}

/**
 * Le nom de champ du MOTEUR pour une stat écrite dans la donnée.
 *
 * ⚠️ La donnée d'aujourd'hui écrit les noms d'`Unit` (`atk`, `hp`,
 * `attack_rate`…), pas ceux du moteur. Cette table est donc le pont, et elle est
 * l'INVERSE de `CHAMPS_UNITE` — construite depuis elle, jamais recopiée : deux
 * tables à tenir d'accord finiraient par ne plus dire la même chose, ce qui est
 * précisément la panne d'origine.
 */
const CHAMP_PAR_STAT: Record<string, ChampUnite> = Object.fromEntries(
  Object.entries(CHAMPS_UNITE).map(([moteur, unite]) => [unite, moteur as ChampUnite]),
) as Record<string, ChampUnite>;

/** Le sélecteur d'un effet de terrain qui vise des unités. */
function cibleUnites(effect: BoardEffectDef): Selecteur {
  const attrs = effect.target_attributes;
  return {
    conteneur: 'board',
    // ⚠️ `les_deux` et non `allie` : un terrain touche les DEUX camps, c'est sa
    // nature même (il est le décor, pas un allié). Le seul effet de terrain qui
    // ne vaille que pour le joueur est `draw_bonus`, et c'est une ressource.
    camp: 'les_deux',
    filtre: attrs?.length ? { attributs: [...attrs] } : undefined,
    combien: 'tous',
  };
}

/**
 * Compile UN terrain en ses effets.
 *
 * Les quatre types de terrain se réduisent à **une seule action**, `modifier`,
 * et c'est la démonstration en petit de ce que vaut le moteur : ce qui les
 * distinguait n'était pas le geste mais le champ visé et l'opérateur.
 */
export function compileBoard(board: BoardDef | null | undefined): CompilationResult {
  const effets: Effet[] = [];
  const refus: CompilationResult['refus'] = [];
  const porteur = board?.id ?? '';

  boardEffects(board).forEach((effect, i) => {
    const id = `${porteur}#${i}`;
    const refuse = (raison: string, detail: string) => refus.push({ porteur: id, raison, detail });

    // ⚠️ Un terrain s'applique AU LANCEMENT DU COMBAT et ses bonus sont nettoyés
    // par `resetCombatStats()` : `debut_combat` + `duree: 'combat'` n'est pas un
    // choix, c'est la lecture de ce que le moteur actuel fait.
    const trigger = { quand: 'debut_combat' as const };

    switch (effect.type) {
      case 'stat_bonus':
      case 'stat_modifier': {
        const champ = CHAMP_PAR_STAT[effect.stat as string];
        if (!champ) {
          // Le refus qui n'existe nulle part aujourd'hui : `applyStatBonus`
          // écrit dans `_stat_bonuses` quel que soit le nom, et `_recomputeStats`
          // ne relit que ce qu'il connaît. L'effet s'appliquait « sans erreur »
          // et ne faisait rien.
          refuse('champ inconnu', `${effect.type} → stat '${effect.stat}'`);
          return;
        }
        const tache: Tache = {
          action: 'modifier',
          cible: cibleUnites(effect),
          champ,
          // ⚠️ `stat_modifier` est un MULTIPLICATEUR, et c'est la seule
          // différence entre les deux types. Le moteur actuel le convertit en
          // additif (`_base[stat] × (value − 1)`) pour que `resetCombatStats`
          // sache le nettoyer ; le schéma garde l'INTENTION (`*`) et laisse
          // cette conversion au moteur, qui seul connaît les registres.
          operateur: effect.type === 'stat_modifier' ? '*' : '+',
          valeur: effect.value as number,
          duree: 'combat',
        };
        effets.push({ id, porteur, trigger, taches: [tache] });
        return;
      }

      case 'shield': {
        effets.push({
          id, porteur, trigger,
          taches: [{
            action: 'modifier',
            cible: cibleUnites(effect),
            champ: 'bouclier',
            operateur: '+',
            valeur: effect.value as number,
            duree: 'combat',
          }],
        });
        return;
      }

      case 'draw_bonus': {
        effets.push({
          id, porteur, trigger,
          taches: [{
            action: 'modifier',
            // ⚠️ `draw_bonus` ne lit AUCUN ciblage, et c'est une règle du jeu,
            // pas un oubli : c'est une ressource de joueur, pas un bonus
            // d'unité. Le sélecteur le dit — conteneur `joueur`, camp `allie` —
            // là où la donnée le disait par omission.
            cible: { conteneur: 'joueur', camp: 'allie', combien: 'un' },
            champ: 'pioches',
            operateur: '+',
            valeur: effect.value as number,
            duree: 'round',
            provenance: 'terrain',
          }],
        });
        return;
      }

      default:
        refuse('type non traduit', `${effect.type}`);
    }
  });

  return { effets, refus };
}

/** Compile plusieurs terrains d'un coup — l'entrée du mode ombre. */
export function compileBoards(boards: readonly (BoardDef | null | undefined)[]): CompilationResult {
  const out: CompilationResult = { effets: [], refus: [] };
  for (const b of boards) {
    const r = compileBoard(b);
    out.effets.push(...r.effets);
    out.refus.push(...r.refus);
  }
  return out;
}

/** Les champs du joueur que le moteur sait écrire — exporté pour le moteur seul. */
export { CHAMPS_JOUEUR };

// ───────────────────────────────────────────────────────────────────────────
// Les ATTRIBUTS
//
// ⚠️ **C'est ici que se joue la seconde famille d'effets morts, et elle s'y joue
// par construction.** Aujourd'hui le `timing` vit sur l'ATTRIBUT et la forme de
// l'effet sur l'EFFET, et rien ne les accorde : un `revive` posé sous un
// `start_of_combat` traverse le combat sans être atteint, parce que la passe de
// fin de combat sort sur `attr.timing !== 'end_of_combat'`. Onze effets sur
// treize porteurs sont morts de ça.
//
// Le compilateur dérive le `quand` de l'EFFET, pas du porteur : un `revive` est
// de fin de combat parce que `revive` est de fin de combat, où que son attribut
// prétende vivre. Le `timing` de la donnée ne sert plus qu'à VÉRIFIER — et un
// désaccord devient un refus nommé, là où c'était un silence.
// ───────────────────────────────────────────────────────────────────────────

/** Le moment où un type d'effet se déclenche RÉELLEMENT, quoi qu'en dise son porteur. */
const QUAND_PAR_TYPE: Record<string, Quand> = {
  stat_bonus: 'debut_combat',
  shield: 'debut_combat',
  effect_immunity: 'debut_combat',
  revive: 'fin_combat',
  draw_bonus: 'fin_combat',
  guaranteed_draw: 'fin_combat',
  board_slot_bonus: 'fin_combat',
  damage_multiplier_bonus: 'fin_combat',
  shopping_bonus: 'fin_combat',
};

/** Les deux déclencheurs d'un `stat_modifier`, qui portent leur `quand` eux-mêmes. */
const QUAND_PAR_TRIGGER: Record<string, Quand> = {
  on_ally_neutralized: 'allie_detruit',
  on_enemy_neutralized: 'ennemi_detruit',
};

/** Le `timing` que la donnée déclare, traduit — pour le contrôle de cohérence. */
const QUAND_PAR_TIMING: Record<string, Quand> = {
  start_of_combat: 'debut_combat',
  end_of_combat: 'fin_combat',
};

/**
 * Compile UN attribut en ses effets — un par effet de chaque palier.
 *
 * ⚠️ Le palier est porté par la CONDITION, pas par l'effet : `paliersActifs`
 * dit lesquels s'appliquent, et le compilateur les émet tous. C'est l'appelant
 * (le moteur de seuils, aujourd'hui `AttributeManager`) qui choisit — le
 * compilateur ne décide pas ce qui est actif, il décrit ce qui existe.
 */
export function compileAttribute(attr: AttributeLike, connus?: ReadonlySet<string>): CompilationResult {
  const effets: Effet[] = [];
  const refus: CompilationResult['refus'] = [];
  const porteur = attr?.id ?? '';

  (attr?.thresholds ?? []).forEach((seuil) => {
    (seuil.effects ?? []).forEach((effect, j) => {
      const id = `${porteur}@${seuil.count}#${j}`;
      const refuse = (raison: string, detail: string) => refus.push({ porteur: id, raison, detail });

      // Le `quand` vient de l'EFFET. Pour un `stat_modifier`, c'est son propre
      // `trigger` qui le porte — et un trigger inconnu ne compile pas, là où il
      // ne déclenchait simplement jamais.
      const quand = effect.type === 'stat_modifier'
        ? QUAND_PAR_TRIGGER[effect.trigger as string]
        : QUAND_PAR_TYPE[effect.type];
      if (!quand) {
        refuse(effect.type === 'stat_modifier' ? 'déclencheur inconnu' : 'type non traduit',
          effect.type === 'stat_modifier' ? `stat_modifier → trigger '${effect.trigger}'` : effect.type);
        return;
      }

      // ⚠️ Le contrôle qui n'existe nulle part aujourd'hui : la donnée annonce un
      // `timing`, l'effet en impose un autre. Aujourd'hui le désaccord est un
      // silence ; ici c'est un refus, nommé, avec les deux moments en clair.
      const annonce = QUAND_PAR_TIMING[attr.timing as string];
      const attendu = effect.type === 'stat_modifier' ? 'during_combat' : null;
      if (attendu ? attr.timing !== attendu : (annonce && annonce !== quand)) {
        refuse('timing incohérent', `${effect.type} sous '${attr.timing}' (se déclenche à '${quand}')`);
        return;
      }

      const trigger = { quand, verrouille: effect.type === 'stat_modifier' };
      const condition = { attribut: porteur, minimum: seuil.count };
      const pousse = (taches: Tache[]) => effets.push({ id, porteur, condition, trigger, taches });

      // Le camp : un attribut vaut pour le camp qui le PORTE. `_applyEndForSide`
      // le rejoue deux fois, une par camp ; ici c'est un sélecteur.
      const cibleUnite = (): Selecteur => ({
        conteneur: 'board', camp: 'allie',
        filtre: { attributs: [porteur] }, combien: 'tous',
      });

      switch (effect.type) {
        case 'stat_bonus':
        case 'stat_modifier': {
          const champ = CHAMP_PAR_STAT[effect.stat as string];
          if (!champ) { refuse('champ inconnu', `${effect.type} → stat '${effect.stat}'`); return; }
          // ⚠️ `value_per` doit nommer un ATTRIBUT. Le `<select>` de l'admin
          // propose en plus `active_unit`, que `stat_bonus` ne sait pas lire :
          // il chercherait des porteurs d'un attribut de ce nom, n'en trouverait
          // aucun, et le bonus vaudrait ZÉRO — en silence. Ici il ne compile pas.
          if (effect.type === 'stat_bonus' && effect.value_per && connus && !connus.has(effect.value_per)) {
            refuse('value_per inconnu', `stat_bonus → value_per '${effect.value_per}'`);
            return;
          }
          pousse([{
            action: 'modifier', cible: cibleUnite(), champ,
            operateur: '+', valeur: effect.value as number, duree: 'combat',
            // ⚠️ `value_per` n'est lu QUE par `stat_bonus`, et il y désigne un
            // ATTRIBUT. Le `<select>` de l'admin propose en plus `active_unit`,
            // que le moteur ne sait pas lire — ici, il ne compile pas.
            ...(effect.type === 'stat_bonus' && effect.value_per
              ? { parAttributAdverse: effect.value_per as string } : {}),
          }]);
          return;
        }

        case 'shield':
          pousse([{
            action: 'modifier', cible: cibleUnite(), champ: 'bouclier',
            operateur: '+', valeur: effect.value as number, duree: 'combat',
            // Le bouclier d'attribut est TOUJOURS × alliés vivants — c'est le
            // geste, pas une option. `value_per` y est décoratif (§6.1).
            parAllieVivant: true,
          }]);
          return;

        case 'effect_immunity':
          pousse([{ action: 'poser_statut', cible: cibleUnite(), statut: 'immunite', duree: 'combat' }]);
          return;

        case 'revive':
          pousse([{
            action: 'deplacer',
            cible: { conteneur: 'cimetiere', camp: 'allie', combien: 'un' },
            destination: 'board',
            pourcentagePv: (effect.hp_percent as number) ?? 50,
          }]);
          return;

        case 'draw_bonus':
        case 'board_slot_bonus':
        case 'damage_multiplier_bonus':
        case 'shopping_bonus': {
          const champ = ({
            draw_bonus: 'pioches', board_slot_bonus: 'slots_board',
            damage_multiplier_bonus: 'multiplicateur', shopping_bonus: 'magies_shop',
          } as const)[effect.type];
          pousse([{
            action: 'modifier',
            cible: { conteneur: 'joueur', camp: 'allie', combien: 'un' },
            champ,
            operateur: '+',
            // ⚠️ `shopping_bonus` est le seul dont la valeur a un défaut (1) :
            // `_applyEndForSide` lit `effect.value ?? 1`. Les trois autres
            // exigent leur chiffre.
            valeur: (effect.value as number) ?? (effect.type === 'shopping_bonus' ? 1 : 0),
            duree: 'round',
            ...(effect.max != null ? { plafond: effect.max as number } : {}),
            provenance: 'attribut',
          }]);
          return;
        }

        case 'guaranteed_draw':
          pousse([{
            action: 'modifier',
            cible: { conteneur: 'joueur', camp: 'allie', combien: 'un' },
            champ: 'pioches_garanties',
            operateur: '+', valeur: 0, duree: 'round',
            // ⚠️ Les critères voyagent EN BLOC : un effet peut nommer plusieurs
            // attributs ou des cartes exactement comme une magie, et recopier le
            // seul `attribute` en perdrait le reste en silence.
            criteres: {
              tier: effect.tier as number | undefined,
              attribute: (effect.attribute as string) ?? null,
              attributes: effect.attributes as string[] | undefined,
              card_ids: effect.card_ids as string[] | undefined,
            },
            provenance: 'attribut',
          }]);
          return;

        default:
          refuse('type non traduit', effect.type);
      }
    });
  });

  return { effets, refus };
}

export function compileAttributes(attrs: readonly AttributeLike[], connus?: ReadonlySet<string>): CompilationResult {
  // Sans liste fournie, les attributs du lot font foi : un `value_per` qui nomme
  // un attribut du catalogue est légitime, un mot-clé ne l'est pas.
  const ids = connus ?? new Set(attrs.map(a => a.id));
  const out: CompilationResult = { effets: [], refus: [] };
  for (const a of attrs) {
    const r = compileAttribute(a, ids);
    out.effets.push(...r.effets);
    out.refus.push(...r.refus);
  }
  return out;
}
