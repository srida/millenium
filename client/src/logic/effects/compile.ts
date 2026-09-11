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

// ───────────────────────────────────────────────────────────────────────────
// Les MAGIES
//
// ⚠️ **Le porteur où le moteur générique paie le moins, et c'est mesuré.** Côté
// magies, un type d'effet ≈ une intention de design ≈ UNE carte : 13 types sur
// 23 ne portent qu'une seule magie (§1.1). Les 51 magies livrées se répartissent
// ainsi devant le vocabulaire du moteur :
//
//   • 29 magies (10 types) entrent dans le vocabulaire tel quel ;
//   •  7 magies (2 types) demandent deux champs d'unité — faits ici ;
//   •  7 magies (7 types) demandent des actions de CONTENEUR (main, cimetière) ;
//   •  3 magies (2 types) demandent un POOL de deck, donc `rand` et le deck lui-
//      même, que `GameSession` ne laisse pas sortir ;
//   •  5 magies (2 types) demandent `poser_effet` — un effet qui pose un effet,
//      consommé au tour suivant.
//
// Les trois derniers lots ne sont pas traduits, et ils ne sont pas ignorés : ils
// sortent en **refus nommés**. C'est la donnée qui manquait pour décider si le
// jeu vaut la chandelle — cf. `docs/moteur-effets.md` §6.4.
// ───────────────────────────────────────────────────────────────────────────

/** La forme minimale d'une magie que le compilateur lit — jamais `data/`. */
export interface MagieLike {
  id: string;
  cost_hp?: number;
  effect?: MagieEffectLike | null;
}

/** Les champs qu'un effet de magie peut porter — la donnée, telle qu'elle est. */
export interface MagieEffectLike {
  type: string;
  stat?: string;
  value?: number;
  power_id?: string;
  power_rate?: number;
  duration?: number;
  tier?: number;
  attribute?: string;
  attributes?: string[];
  card_ids?: string[];
}

/** Ce qui manque au moteur pour traduire un type, quand ça manque. */
const MANQUE: Record<string, string> = {
  // ⚠️ `defuse_fusion` reste dehors, et c'est le seul. Il ne DÉPLACE pas une
  // entité : il en fait naître plusieurs à partir de la lignée de la carte, avec
  // un repli sur le cimetière quand le board est plein. C'est une règle
  // d'invocation déguisée en effet, et `InvocationManager` en est le
  // propriétaire — le §4.3 dit explicitement que l'invocation n'entre pas dans
  // le moteur.
  defuse_fusion: 'lecture de la lignée + repli de placement (règle d\'invocation)',
  // ⚠️ `draw_material` consomme DEUX tirages là où `remplacer` n'en fait qu'un :
  // le premier choisit QUEL matériel (en préférant ceux qui manquent), le second
  // QUELLE carte le porte — un matériel d'attribut en a plusieurs dans le deck.
  // Aplatir les deux en un seul pool changerait la distribution (un matériel à
  // trois porteurs deviendrait trois fois plus probable) et le nombre d'appels,
  // donc tout le flux semé qui suit.
  //
  // ⚠️ **Le mode ombre ne pouvait PAS le voir** : il compare l'ÉTAT, et sur un
  // pool à un seul candidat les deux chemins rendent la même carte. C'est ce
  // qui a fait croire ce type traduisible — cf. `docs/moteur-effets.md` §6.5.
  draw_material: 'deux tirages (quel matériel, puis quelle carte le porte)',
};

/**
 * Compile UNE magie.
 *
 * ⚠️ Le `quand` est `immediat` : une magie part au tap du joueur, pendant la
 * Phase Shopping. Elle n'a pas de déclencheur à attendre — c'est le seul porteur
 * dont le moment est un geste et non un état du jeu.
 *
 * ⚠️ La `duree` est `partie` pour tout ce qui touche une unité, et c'est la
 * règle la plus importante du porteur : une magie écrit dans `_base`, donc son
 * effet SURVIT à `resetCombatStats()` et **voyage dans `round:board_ready`**
 * (§5.3). C'est ce qui la distingue d'un bonus de terrain ou d'attribut, qui ne
 * valent que pour le combat en cours.
 */
export function compileMagie(magie: MagieLike): CompilationResult {
  const effets: Effet[] = [];
  const refus: CompilationResult['refus'] = [];
  const porteur = magie?.id ?? '';
  const e = magie?.effect;
  if (!e?.type) return { effets, refus };

  const id = `${porteur}#0`;
  const refuse = (raison: string, detail: string) => refus.push({ porteur: id, raison, detail });

  /** La cible d'une magie à unité unique — le joueur l'a désignée. */
  const uneUnite = (): Selecteur => ({ conteneur: 'board', camp: 'allie', combien: 'un' });
  const toutesUnites = (): Selecteur => ({ conteneur: 'board', camp: 'allie', combien: 'tous' });
  const leJoueur = (): Selecteur => ({ conteneur: 'joueur', camp: 'allie', combien: 'un' });
  const trigger = { quand: 'immediat' as const };

  /**
   * Le CONTRECOUP (`cost_hp`) — un champ de premier niveau, orthogonal au type
   * d'effet, que les quatre chemins d'application prélèvent.
   *
   * ⚠️ **Il part EN PREMIER dans la liste de tâches**, et ce n'est pas un
   * détail d'ordre : `GameSession._payMagieCost` prélève AVANT l'effet, faute de
   * quoi `drain_life` financerait son propre contrecoup. Une liste de tâches est
   * résolue dans l'ordre ; le mettre en tête est la seule façon de le dire.
   *
   * ⚠️ Et la garde l'accompagne toujours : une magie impayable ne s'applique pas
   * DU TOUT, elle n'ampute pas au passage. Les deux ne se désolidarisent jamais.
   */
  const cout = Number(magie.cost_hp) || 0;
  const condition = cout > 0 ? { pvJoueurSuperieurA: cout } : undefined;
  const contrecoup: Tache[] = cout > 0
    ? [{ action: 'modifier', cible: leJoueur(), champ: 'pv', operateur: '-', valeur: cout, duree: 'partie' }]
    : [];

  const pousse = (taches: Tache[]) => effets.push({ id, porteur, condition, trigger, taches: [...contrecoup, ...taches] });

  if (MANQUE[e.type]) { refuse('vocabulaire manquant', `${e.type} — ${MANQUE[e.type]}`); return { effets, refus }; }

  switch (e.type) {
    case 'stat_bonus':
    case 'team_stat_bonus':
    case 'stat_modifier': {
      const champ = CHAMP_PAR_STAT[e.stat as string];
      if (!champ) { refuse('champ inconnu', `${e.type} → stat '${e.stat}'`); return { effets, refus }; }
      pousse([{
        action: 'modifier',
        cible: e.type === 'team_stat_bonus' ? toutesUnites() : uneUnite(),
        champ,
        operateur: e.type === 'stat_modifier' ? '*' : '+',
        valeur: e.value as number,
        // ⚠️ `partie`, pas `combat` : une magie est un achat permanent.
        duree: 'partie',
      }]);
      return { effets, refus };
    }

    case 'heal':
      // ⚠️ Soin TOTAL, et `value` n'est PAS lu — des entrées anciennes en
      // portent un. Le `=` dit « au maximum », qui suit le max COURANT (bonus
      // et vétérance compris), jamais un chiffre figé.
      pousse([{ action: 'modifier', cible: uneUnite(), champ: 'pv_courant', operateur: '=', valeur: 0, duree: 'partie' }]);
      return { effets, refus };

    case 'team_heal':
      // Chiffré, là où `heal` est total : un soin de masse complet n'aurait
      // aucun contrepoids.
      pousse([{ action: 'modifier', cible: toutesUnites(), champ: 'pv_courant', operateur: '+', valeur: e.value as number, duree: 'partie' }]);
      return { effets, refus };

    case 'shield':
      pousse([{ action: 'modifier', cible: uneUnite(), champ: 'bouclier', operateur: '+', valeur: e.value as number, duree: 'partie' }]);
      return { effets, refus };

    case 'revive':
      pousse([{
        action: 'deplacer',
        cible: { conteneur: 'cimetiere', camp: 'allie', combien: 'un' },
        destination: 'board',
        pourcentagePv: (e.value as number) ?? 50,
      }]);
      return { effets, refus };

    case 'grant_power':
      if (!e.power_id) { refuse('pouvoir sans id', 'grant_power'); return { effets, refus }; }
      pousse([{
        action: 'modifier', cible: uneUnite(), champ: 'pouvoir',
        operateur: '=', valeur: 0, duree: 'partie',
        pouvoir: {
          id: e.power_id as string,
          rate: (e.power_rate as number) ?? null,
          valeur: (e.value as number) ?? null,
          duree: (e.duration as number) ?? null,
        },
      }]);
      return { effets, refus };

    case 'power_cooldown':
      pousse([{
        action: 'modifier', cible: uneUnite(), champ: 'vitesse_pouvoir',
        operateur: '/', valeur: (e.value as number) ?? 2, duree: 'partie',
      }]);
      return { effets, refus };

    case 'player_hp_bonus':
      pousse([{ action: 'modifier', cible: leJoueur(), champ: 'pv', operateur: '+', valeur: e.value as number, duree: 'partie' }]);
      return { effets, refus };

    case 'board_slot_bonus':
      pousse([{ action: 'modifier', cible: leJoueur(), champ: 'slots_board', operateur: '+', valeur: (e.value as number) || 1, duree: 'partie', provenance: 'magie' }]);
      return { effets, refus };

    case 'draw_bonus':
      pousse([{ action: 'modifier', cible: leJoueur(), champ: 'pioches', operateur: '+', valeur: (e.value as number) || 1, duree: 'round', provenance: 'magie' }]);
      return { effets, refus };

    case 'damage_multiplier_bonus':
      pousse([{ action: 'modifier', cible: leJoueur(), champ: 'multiplicateur', operateur: '+', valeur: e.value as number, duree: 'partie' }]);
      return { effets, refus };

    // ── Les actions de CONTENEUR ──────────────────────────────────────────

    case 'destroy_unit':
      // ⚠️ `deplacer`, pas `retirer` : l'unité PART AU CIMETIÈRE, elle n'est pas
      // effacée. Elle y libère un slot et redevient un matériau d'invocation —
      // c'est tout le sens de la magie.
      pousse([{ action: 'deplacer', cible: uneUnite(), destination: 'cimetiere' }]);
      return { effets, refus };

    case 'drain_life':
      // Le même déplacement, plus le versement. ⚠️ Les PV COURANTS et non le
      // maximum : c'est ce qui en fait un remplaçant honnête de `destroy_unit`.
      // ⚠️ Le versement part AVANT le déplacement — une fois au cimetière,
      // l'unité n'est plus une cible du sélecteur `board`.
      pousse([
        { action: 'modifier', cible: leJoueur(), champ: 'pv', operateur: '+', valeur: 100, duree: 'partie', valeurDepuis: 'pv_courant_cible' },
        { action: 'deplacer', cible: uneUnite(), destination: 'cimetiere' },
      ]);
      return { effets, refus };

    case 'hand_to_graveyard':
      // ⚠️ Aucun corps n'est posé sur le terrain : la carte devient un matériau,
      // et rien d'autre. Elle disparaît au lancement du combat si personne ne
      // l'a consommée — la magie ne met pas une carte en réserve, elle la brûle
      // pour un tour.
      pousse([{ action: 'deplacer', cible: { conteneur: 'main', camp: 'allie', combien: 'un' }, destination: 'cimetiere' }]);
      return { effets, refus };

    case 'sacrifice_card_hp':
      // ⚠️ `retirer` et non `deplacer` : la carte est BRÛLÉE, elle ne va pas au
      // cimetière — sinon le choix avec `hand_to_graveyard` serait sans objet.
      // Les PV lus sont ceux de la CARTE : rien n'est encore posé.
      pousse([
        { action: 'modifier', cible: leJoueur(), champ: 'pv', operateur: '+', valeur: (e.value as number) || 100, duree: 'partie', valeurDepuis: 'pv_carte_cible' },
        { action: 'retirer', cible: { conteneur: 'main', camp: 'allie', combien: 'un' } },
      ]);
      return { effets, refus };

    case 'duplicate_unit':
    case 'duplicate_graveyard_unit':
    case 'duplicate_card':
      // ⚠️ **Trois sélecteurs, UNE action** — la démonstration du §4.2. Ce qui
      // les distinguait n'était pas le geste mais l'endroit où l'on regarde :
      // board, cimetière ou main. Et dans les trois cas c'est la CARTE de
      // catalogue qui part en main, jamais l'entité.
      pousse([{
        action: 'ajouter',
        cible: {
          conteneur: e.type === 'duplicate_unit' ? 'board' : e.type === 'duplicate_graveyard_unit' ? 'cimetiere' : 'main',
          camp: 'allie', combien: 'un',
        },
        destination: 'main',
        quantite: (e.value as number) || 1,
      }]);
      return { effets, refus };

    // ── Les deux remises d'invocation ─────────────────────────────────────
    //
    // ⚠️ Elles ne compilaient PAS tant qu'elles étaient différées : il aurait
    // fallu un `poser_effet` consommé au tour suivant. Devenues immédiates et
    // ciblées, elles sont une modification de CARTE comme une autre — et c'est
    // le seul porteur de champs qui n'est ni une unité ni le joueur.
    case 'reduce_materials':
    case 'remove_requirements':
      pousse([{
        action: 'modifier',
        cible: { conteneur: 'main', camp: 'allie', combien: 'un' },
        champ: e.type === 'reduce_materials' ? 'cout_materiels' : 'exigences',
        operateur: '-',
        valeur: Math.max(1, (e.value as number) || 1),
        duree: 'partie',
      }]);
      return { effets, refus };

    // ── Le POOL de deck ───────────────────────────────────────────────────
    //
    // ⚠️ Les seules tâches du moteur qui consomment du HASARD. Le pool est
    // INJECTÉ (`Monde.pool`) : `GameSession` ne laisse pas sortir le deck du
    // joueur, le moteur demande des candidats pour un usage et ignore d'où ils
    // viennent. Discipline d'appel : celle de `BoardPicker` — exactement un
    // tirage, AUCUN sur un pool vide.

    case 'shift_tier_unit':
      // ⚠️ Une SUBSTITUTION : l'ancienne unité quitte la partie sans passer par
      // le cimetière (l'y laisser ferait payer la magie deux fois), ne garde
      // aucun acquis, et la CASE est conservée — `initial_position` comprise.
      pousse([{ action: 'remplacer', cible: uneUnite(), source: 'tier_voisin', decalage: (e.value as number) || 1 }]);
      return { effets, refus };

    case 'shift_tier_card':
      pousse([{
        action: 'remplacer',
        cible: { conteneur: 'main', camp: 'allie', combien: 'un' },
        source: 'tier_voisin', decalage: (e.value as number) || 1,
      }]);
      return { effets, refus };

    case 'guaranteed_draw':
      pousse([{
        action: 'modifier', cible: leJoueur(), champ: 'pioches_garanties',
        operateur: '+', valeur: 0, duree: 'round', provenance: 'magie',
        criteres: {
          tier: e.tier as number | undefined,
          attribute: (e.attribute as string) ?? null,
          attributes: e.attributes as string[] | undefined,
          card_ids: e.card_ids as string[] | undefined,
        },
      }]);
      return { effets, refus };

    default:
      refuse('type non traduit', e.type as string);
      return { effets, refus };
  }
}

export function compileMagies(magies: readonly MagieLike[]): CompilationResult {
  const out: CompilationResult = { effets: [], refus: [] };
  for (const m of magies) {
    const r = compileMagie(m);
    out.effets.push(...r.effets);
    out.refus.push(...r.refus);
  }
  return out;
}
