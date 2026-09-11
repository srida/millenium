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
import type { Effet, Tache, Selecteur, ChampUnite } from './types.js';

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
