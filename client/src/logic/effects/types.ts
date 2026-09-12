// LE SCHÉMA D'EFFET — le vocabulaire que les quatre porteurs finiront par
// partager. Cf. `docs/moteur-effets.md` §4.
//
// ⚠️ Ce fichier ne contient que des TYPES et des tables fermées. Aucune logique,
// aucun import de `data/`, aucun état. C'est ce qui permet au compilateur
// (`compile.ts`) et au moteur (`engine.ts`) de ne jamais se contredire sur le
// vocabulaire : il n'existe qu'ici.
//
// ⚠️ Le principe qui commande tout le reste : **le `trigger` est porté par
// l'EFFET, pas par son porteur.** C'est exactement ce découplage qui manque
// aujourd'hui — un attribut porte un `timing` et ses effets une forme, et rien
// ne les accorde, ce qui a tué onze effets sur treize porteurs (§1.4). Ici, un
// effet qui ne peut pas se déclencher est un effet qui ne compile pas.

import type { Position, GuaranteedDraw } from '../types.js';

// ───────────────────────────────────────────────────────────────────────────
// Quand
// ───────────────────────────────────────────────────────────────────────────

/**
 * Les moments où un effet peut partir.
 *
 * ⚠️ **Table FERMÉE, et la règle d'entrée est stricte : un `quand` n'y figure
 * que si quelque chose sait l'ÉMETTRE et quelque chose sait le JOUER.** Trois
 * entrées y ont vécu sans l'une ni l'autre (`avant_pioche`, `apres_pioche`,
 * `debut_shop`) : elles décrivaient les points de branchement futurs du §3.6, où
 * les cinq files écrites à la main iront un jour. Elles reviendront avec leur
 * émetteur — un `poser_effet` compilé — et pas avant. Du vocabulaire qui promet
 * est exactement ce que ce chantier existe pour supprimer.
 *
 * ⚠️ L'ORDRE de ce tableau est le rang de tri de `cleDeTri` (§5.1). Il est sans
 * effet observable — `executer` filtre par `quand` AVANT de trier, donc le rang
 * est constant à l'intérieur d'un lot — mais il se lit comme la chronologie
 * d'un round, et c'est ce qu'il faut qu'il reste.
 */
export const QUANDS = [
  'a_l_invocation',
  'debut_combat',
  'pouvoir_utilise',
  'allie_detruit',
  'ennemi_detruit',
  'fin_combat',
  'immediat',
] as const;
export type Quand = typeof QUANDS[number];

// ───────────────────────────────────────────────────────────────────────────
// Où
// ───────────────────────────────────────────────────────────────────────────

export const CONTENEURS = ['board', 'main', 'cimetiere', 'joueur'] as const;
export type Conteneur = typeof CONTENEURS[number];

/**
 * ⚠️ `camp` est un SÉLECTEUR, pas une propriété du porteur. C'est lui qui rend
 * exprimable « l'IA porte ses effets comme un vrai joueur » sans que le moteur
 * ait à savoir qui joue : `_applyEndForSide(resources: false)`, la branche qui
 * réserve aujourd'hui les ressources au seul joueur, devient un `camp: 'allie'`
 * comme un autre.
 */
export const CAMPS = ['allie', 'ennemi', 'les_deux'] as const;
export type Camp = typeof CAMPS[number];

/** Un sélecteur : quel conteneur, quel camp, filtré comment, et combien. */
export interface Selecteur {
  conteneur: Conteneur;
  camp: Camp;
  /** Vide = aucun filtre (toutes les entités du conteneur). */
  filtre?: {
    /** OU entre les entrées — une entité est retenue dès qu'elle en porte une. */
    attributs?: readonly string[];
    /** OU entre les entrées, sur l'id de carte. */
    cartes?: readonly string[];
    tiers?: readonly number[];
  };
  /** `tous` est le seul cas que l'existant exerce ; `un` attend un choix. */
  combien: 'tous' | 'un';
}

// ───────────────────────────────────────────────────────────────────────────
// Quoi
// ───────────────────────────────────────────────────────────────────────────

/**
 * Les sept actions. Table FERMÉE — le reste est un champ typé.
 *
 * ⚠️ C'est la table qui fait tout l'intérêt du moteur : les 55 branches
 * d'aujourd'hui s'y réduisent, et le jour où une action manque, ça se voit à la
 * compilation au lieu de se voir en jeu (ou de ne pas se voir du tout).
 */
export const ACTIONS = ['ajouter', 'retirer', 'deplacer', 'remplacer', 'modifier', 'poser_statut', 'poser_effet'] as const;
export type Action = typeof ACTIONS[number];

export const OPERATEURS = ['+', '-', '*', '/', '='] as const;
export type Operateur = typeof OPERATEURS[number];

/**
 * Combien de temps ce qu'une tâche écrit doit survivre.
 *
 * ⚠️ C'est LE champ qui supprime la première famille d'effets morts. Les trois
 * gestes d'aujourd'hui (`_base`, `_stat_bonuses`, champ direct) ne sont pas
 * trois intentions : ce sont trois durées de vie, écrites à la main sur chaque
 * site d'appel et impossibles à vérifier. Ici la durée est une DONNÉE, et c'est
 * le moteur qui choisit le registre.
 *
 * ⚠️ INVARIANT PvP (§5.3) : `partie` veut dire que la donnée doit voyager dans
 * `round:board_ready`. Le moteur écrit donc `partie` dans `_base`, qui est déjà
 * dans la liste fermée du payload — aucun champ nouveau à faire voyager tant
 * qu'aucune tâche ne sort de ce registre.
 */
export const DUREES = ['combat', 'round', 'partie'] as const;
export type Duree = typeof DUREES[number];

/**
 * Combien de fois un effet part sous son trigger — §3.5.
 *
 * ⚠️ Sans elle, « quand un allié est détruit » est AMBIGU : une fois, ou à
 * chaque mort ? Aujourd'hui la réponse est « à chaque fois » et elle est écrite
 * en dur dans `AttributeManager` ; ici c'est une donnée, donc quelque chose
 * qu'un auteur peut choisir et qu'un lecteur peut voir.
 *
 * ⚠️ **Le moteur ne TIENT pas le compte, il le demande** (`Monde.consommePortee`).
 * C'est l'appelant qui sait quand un combat finit, quand un round tourne, et
 * quand la partie s'arrête — lui donner cette mémoire reviendrait à lui donner
 * un cycle de vie, qu'il n'a pas. Même partage que les ressources : le moteur
 * accumule, l'appelant verse.
 */
export const PORTEES = ['a_chaque_fois', 'une_fois_par_combat', 'une_fois_par_round', 'une_fois_par_partie'] as const;
export type Portee = typeof PORTEES[number];

/**
 * Les champs modifiables d'une UNITÉ, et leur nom de code côté `Unit`.
 *
 * ⚠️ **C'est le vocabulaire partagé dont l'absence a produit la première
 * famille d'effets morts.** Il existait en trois exemplaires implicites — la
 * lecture de `_recomputeStats`, la branche d'`applyStatModifier`, le `<select>`
 * de l'admin — qui avaient divergé sans que rien ne le dise. Ici il n'existe
 * qu'une fois, et le compilateur REFUSE un champ qui n'y est pas.
 *
 * ⚠️ Les noms de gauche sont ceux du MOTEUR (stables, en français, ce que
 * l'admin écrira) ; ceux de droite ceux d'`Unit` (qui ont déjà bougé une fois —
 * `attack_speed` est devenu `attack_rate`). Les séparer est ce qui permet de
 * renommer un champ d'`Unit` sans réécrire la donnée.
 */
export const CHAMPS_UNITE = Object.freeze({
  atk: 'atk',
  /**
   * ⚠️ `pv` est le MAXIMUM (la stat), `pv_courant` la jauge. Les séparer n'est
   * pas un raffinement : un `stat_bonus hp` de magie augmente le socle ET la
   * jauge, là où un `heal` ne touche que la jauge. Un seul nom pour les deux
   * rendrait l'un des deux gestes inexprimable.
   */
  pv: 'hp',
  pv_courant: 'current_hp',
  pouvoir: 'power_id',
  vitesse_pouvoir: 'power_rate',
  bouclier: 'bouclier',
  vitesse_attaque: 'attack_rate',
  vitesse_deplacement: 'movement_rate',
  portee: 'range',
  charge_pouvoir: 'power_charge',
} as const);
export type ChampUnite = keyof typeof CHAMPS_UNITE;

/**
 * Les champs modifiables du JOUEUR.
 *
 * ⚠️ Ce sont des noms de RESSOURCE, pas des champs de `GameState`, et la nuance
 * est structurante : `multiplicateur` n'a aucun champ où se poser côté attribut
 * (il est consommé en vol par le calcul de dégâts et jamais stocké), tandis que
 * le champ `player_damage_multiplier_bonus` appartient aux magies et vaut pour
 * toute la partie. Les confondre reviendrait à rendre permanent un bonus de
 * round. Le moteur accumule ces noms ; l'appelant seul sait où les verser.
 */
export const CHAMPS_JOUEUR = Object.freeze({
  pv: 'pv',
  pioches: 'pioches',
  pioches_garanties: 'pioches_garanties',
  slots_board: 'slots_board',
  multiplicateur: 'multiplicateur',
  magies_shop: 'magies_shop',
} as const);
export type ChampJoueur = keyof typeof CHAMPS_JOUEUR;

/**
 * Les champs modifiables d'une CARTE (en main).
 *
 * ⚠️ Une carte n'est pas une unité : elle n'a ni PV courants ni position, elle a
 * un COÛT. Les deux remises d'invocation sont les seules à les toucher, et elles
 * sont ORTHOGONALES — `cout_materiels` baisse le prix, `exigences` lève une
 * contrainte sans rien rendre moins cher.
 */
export const CHAMPS_CARTE = Object.freeze({
  cout_materiels: 'materials',
  exigences: 'requires',
} as const);
export type ChampCarte = keyof typeof CHAMPS_CARTE;

/** Les statuts qu'une tâche peut poser sur une unité. */
export const STATUTS = ['immunite', 'poison', 'brulure', 'paralysie', 'confusion', 'provocation', 'blocage_pouvoir'] as const;
export type Statut = typeof STATUTS[number];

// ───────────────────────────────────────────────────────────────────────────
// La tâche
// ───────────────────────────────────────────────────────────────────────────

/** `modifier` — la seule action que le terrain exerce, et de loin la plus employée. */
export interface TacheModifier {
  action: 'modifier';
  cible: Selecteur;
  champ: ChampUnite | ChampJoueur | ChampCarte;
  operateur: Operateur;
  valeur: number;
  duree: Duree;
  /**
   * Multiplie `valeur` par le nombre d'entités adverses portant cet attribut.
   *
   * ⚠️ Il nomme un attribut, JAMAIS le porteur, et jamais un mot-clé : c'est
   * `value_per` d'aujourd'hui, dont le `<select>` d'admin propose en plus un
   * `active_unit` que seul `stat_bonus` ne sait pas lire (cf. §6.1). Typé ici
   * comme un id, le mot-clé ne compile pas.
   */
  parAttributAdverse?: string;
  /**
   * Multiplie `valeur` par le nombre d'alliés VIVANTS du camp visé.
   *
   * ⚠️ Distinct de `parAttributAdverse` : celui-ci ne lit aucun attribut. C'est
   * le geste du `shield` d'attribut (`value × alliés vivants`), et c'est
   * pourquoi le `value_per` que la donnée y pose est **décoratif** — le moteur
   * actuel ne le lit pas (cf. §6.1). Le nommer ici est ce qui empêche de croire
   * qu'il s'agit du même multiplicateur.
   */
  parAllieVivant?: boolean;
  /** Plafond sur le TOTAL accumulé — le `max` d'aujourd'hui, pas une borne par tâche. */
  plafond?: number;
  /** Les critères d'une pioche garantie (`champ: 'pioches_garanties'`). */
  criteres?: GuaranteedDraw;
  /** Ce que le registre de provenance inscrit comme origine. */
  provenance?: 'attribut' | 'terrain' | 'magie';
  /**
   * La valeur se LIT SUR LA CIBLE au lieu d'être écrite dans la tâche.
   *
   * ⚠️ C'est ce que font `drain_life` (les PV COURANTS de l'unité, pas son
   * maximum) et `sacrifice_card_hp` (les PV de la CARTE — rien n'est encore
   * posé, il n'y a pas de PV courants à lire). Sans ce champ il faudrait une
   * action par source, alors que le geste est le même : verser au joueur ce que
   * la cible valait. `valeur` sert alors de POURCENTAGE.
   */
  valeurDepuis?: 'pv_courant_cible' | 'pv_carte_cible';
  /**
   * Le pouvoir POSÉ par la tâche (`champ: 'pouvoir'`), avec ses trois chiffres.
   *
   * ⚠️ Ils voyagent ENSEMBLE parce qu'un pouvoir donné n'hérite rien de
   * l'ancien. Et `duree` et `valeur` s'excluent : les quatre pouvoirs de
   * `DURATION_POWERS` lisent la première, les dix autres la seconde.
   */
  pouvoir?: { id: string; rate?: number | null; valeur?: number | null; duree?: number | null };
}

/** `deplacer` — change une entité de conteneur (la réanimation, aujourd'hui). */
export interface TacheDeplacer {
  action: 'deplacer';
  cible: Selecteur;
  destination: Conteneur;
  /** Les PV rendus, en pourcentage du max. Défaut 50, comme `revive`. */
  pourcentagePv?: number;
}

/**
 * `ajouter` — fait entrer une entité dans un conteneur.
 *
 * ⚠️ Ce qu'on ajoute est une CARTE de catalogue, jamais l'entité visée : c'est
 * la règle des trois duplications (ce qu'on lit sur une unité ne voyage pas —
 * ni bonus de Shopping, ni vétérance, ni PV courants, ni pouvoir posé). Sans
 * cette étanchéité, la magie rendrait deux fois un investissement.
 */
export interface TacheAjouter {
  action: 'ajouter';
  /** Ce qu'on désigne pour SAVOIR QUOI ajouter (l'unité qu'on duplique). */
  cible: Selecteur;
  /** Où ça va. */
  destination: Conteneur;
  /** Combien d'exemplaires. */
  quantite: number;
}

/**
 * `remplacer` — une entité en cède la place à une autre, tirée d'un POOL.
 *
 * ⚠️ Le pool est une **dépendance injectée** (`Monde.pool`), jamais le deck
 * lui-même : `GameSession` ne le laisse pas sortir, et c'est une règle du projet.
 * Le moteur demande « des candidats pour tel usage », il ne sait pas d'où ils
 * viennent — le patron exact de `deps.rand`.
 *
 * ⚠️ Et il CONSOMME du hasard, le seul de tout le moteur : exactement **un
 * appel par tirage, aucun sur un pool vide** (la règle de `BoardPicker`). Les
 * golden tests de `sim/` et le filet PvP à 300 graines en dépendent.
 */
export interface TacheRemplacer {
  action: 'remplacer';
  cible: Selecteur;
  /**
   * Ce que le pool doit fournir.
   *
   * ⚠️ UNE seule source, et c'est un choix mesuré : `draw_material` en
   * demandait une seconde, mais il consomme DEUX tirages (quel matériel, puis
   * quelle carte le porte) là où `remplacer` n'en fait qu'un. Le traduire
   * changerait la distribution ET le nombre d'appels à `rand` — cf. `MANQUE`
   * dans `compile.ts`.
   */
  source: 'tier_voisin';
  /** Le décalage de tier, pour `tier_voisin`. */
  decalage?: number;
}

/** `retirer` — sort une entité d'un conteneur, sans destination. */
export interface TacheRetirer {
  action: 'retirer';
  cible: Selecteur;
}

/** `poser_statut` — pose un statut sur une entité. */
export interface TachePoserStatut {
  action: 'poser_statut';
  cible: Selecteur;
  statut: Statut;
  duree: Duree;
}

/**
 * ⚠️ Les tâches qui portent une POSITION ont leur propre forme, et c'est
 * l'invariant §5.4 : la position doit être TROUVABLE pour que `BoardMirror`
 * puisse la traduire. Un `{col,row}` anonyme noyé dans un payload générique
 * serait exactement ce qu'on ne sait pas auditer. Aucun effet livré n'en porte
 * aujourd'hui — le type existe pour que le jour où l'un en portera, il n'y ait
 * pas de place où l'oublier.
 */
export interface TachePosition {
  action: 'modifier';
  cible: Selecteur;
  champ: 'position';
  position: Position;
  duree: Duree;
}

/**
 * Toutes les tâches SAUF `poser_effet`.
 *
 * ⚠️ C'est ce type — et lui seul — qui porte la **profondeur 1** du §3.6 : un
 * effet peut poser un effet, l'effet posé ne peut pas en poser un autre. Écrite
 * ici, la borne est tenue par le compilateur TypeScript et non par une garde
 * qu'on pourrait oublier. Sans elle, l'ordre de résolution devient impossible à
 * prouver identique sur deux clients PvP.
 */
export type TacheSimple = TacheModifier | TachePosition | TacheDeplacer | TachePoserStatut | TacheAjouter | TacheRetirer | TacheRemplacer;

/**
 * `poser_effet` — une tâche inscrit un effet dans le registre — §3.6.
 *
 * ⚠️ **C'est le mécanisme qui remplace les CINQ files écrites à la main** du
 * §1.6 (pioches garanties, remises de coût, poison, brûlure, multiplicateur
 * permanent). Chacune était un champ d'état, un point de dépôt et un point de
 * consommation, tenus d'accord de tête.
 *
 * ⚠️ Le registre appartient à l'APPELANT (`Monde.registre`), comme les
 * ressources : lui seul sait quand un round tourne, donc quand purger. Le
 * moteur inscrit et ne relit jamais ce qu'il a inscrit — sans quoi un effet
 * posé pourrait partir dans le lot qui vient de le poser.
 */
export interface TachePoserEffet {
  action: 'poser_effet';
  effet: EffetPose;
  /** Combien de temps l'effet posé reste dans le registre. */
  duree: Duree;
}

export type Tache = TacheSimple | TachePoserEffet;

// ───────────────────────────────────────────────────────────────────────────
// L'effet
// ───────────────────────────────────────────────────────────────────────────

export interface Trigger {
  quand: Quand;
  /**
   * ⚠️ `verrouille` reproduit le gel des seuils `during_combat` : les morts en
   * cours de combat ne désactivent pas un effet déjà actif. C'était une clause
   * implicite d'`AttributeManager` (`_duringCombatThresholds`), ici c'est une
   * donnée — donc quelque chose qu'on peut lire sur l'effet.
   */
  verrouille?: boolean;
  /**
   * Combien de fois l'effet part. Absente = `a_chaque_fois`, le comportement
   * d'aujourd'hui.
   *
   * ⚠️ Une portée que l'appelant ne sait pas tenir (pas de `consommePortee`)
   * fait **refuser l'effet nommément**, jamais partir quand même : un effet qui
   * promet « une fois par combat » et part à chaque mort ne se voit pas, il se
   * subit.
   */
  portee?: Portee;
}

/**
 * La condition d'un effet — §3.4.
 *
 * ⚠️ Forme minimale, parce que c'est tout ce que l'existant EXERCE : un palier
 * d'attribut, c'est-à-dire « au moins N unités DISTINCTES par `card_id` portant
 * cet attribut ». Le compilateur émet TOUS les paliers d'un attribut ; c'est la
 * condition qui dit lequel s'applique. Sans elle, un effet compilé ne saurait
 * pas dire à quel palier il appartient — et il faudrait le redemander à la
 * donnée, donc se donner deux sources pour une même question.
 */
export interface Condition {
  attribut?: string;
  minimum?: number;
  /**
   * Les PV joueur qu'il faut avoir — STRICTEMENT — pour que l'effet parte.
   *
   * ⚠️ Strictement, et c'est la règle du contrecoup : payer laisse toujours au
   * moins 1 PV (`canAffordMagie` compare en `>`). Une magie impayable ne
   * s'applique pas du tout — elle n'ampute rien au passage.
   */
  pvJoueurSuperieurA?: number;
}

export interface Effet {
  /** Identité stable, dérivée du porteur — jamais un compteur. Cf. §5.1. */
  id: string;
  /** Absente = l'effet s'applique toujours (le cas du terrain). */
  condition?: Condition;
  /** Qui l'apporte : id de terrain, de magie, d'attribut, de carte. */
  porteur: string;
  trigger: Trigger;
  taches: readonly Tache[];
}

/** Un effet POSÉ — même forme, sans le droit d'en poser un autre (§3.6). */
export interface EffetPose extends Omit<Effet, 'taches'> {
  taches: readonly TacheSimple[];
}

/** Une entrée du registre : l'effet posé, et combien de temps il y reste. */
export interface EntreeRegistre {
  effet: EffetPose;
  duree: Duree;
}

/**
 * La clé de tri d'un effet — **absolue**, donc identique sur les deux clients.
 *
 * ⚠️ INVARIANT §5.1 : deux clients doivent résoudre les mêmes tâches dans le
 * même ordre, et **jamais** dans l'ordre d'insertion. C'est le précédent du
 * départage par `card_id` de l'ordre d'action : une valeur absolue, pas une
 * position dans un tableau. Le rang du `quand` vient de `QUANDS`, qui est figé.
 */
export function cleDeTri(e: Effet): string {
  const rang = QUANDS.indexOf(e.trigger.quand);
  return `${String(rang).padStart(2, '0')}|${e.porteur}|${e.id}`;
}
