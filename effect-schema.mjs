// LE VOCABULAIRE D'EFFETS — quel effet existe, sur quel porteur, avec quels
// champs, et à quel moment il part.
//
// ⚠️ **Pur, sans aucun import**, à la racine — comme `card-query.mjs` et
// `speed-scale.mjs`, et pour la même raison : `admin.html` ne peut rien importer
// du bundle, et le bundle ne peut rien importer d'`admin.html`. Un vocabulaire
// écrit deux fois est un vocabulaire qui diverge au premier type ajouté.
//
// ⚠️ **C'est le troisième endroit qui disparaît.** `CLAUDE.md` le disait en
// toutes lettres : *« un effet d'attribut n'existe pour de bon qu'aux TROIS
// endroits à la fois : le moteur, le `<select>` de l'onglet Attributs, et le
// libellé français. Deux sur trois donnent une fonctionnalité que personne ne
// peut ni écrire ni lire — c'est arrivé à `shopping_bonus`. »* Les trois n'en
// font plus qu'un : ce fichier DÉCLARE, `compile.ts` TRADUIT, et
// `effect-schema.test.ts` les fait répondre la même chose sur chaque type et
// sur chaque champ.
//
// ⚠️ Ce fichier ne décide de RIEN. Il ne sait ni appliquer, ni compiler : il dit
// ce qui est offrable. Le juge reste le compilateur — un type déclaré ici qui
// ne compile pas fait ROUGE, il ne s'affiche pas dans un `<select>` en espérant.
//
// Cf. `docs/moteur-effets.md` §6.6 (étape 3).

// ───────────────────────────────────────────────────────────────────────────
// Les porteurs
// ───────────────────────────────────────────────────────────────────────────

/**
 * Les trois porteurs d'effets que le moteur connaît.
 *
 * ⚠️ Les POUVOIRS n'y sont pas, et ce n'est pas un oubli : leurs tâches vivent
 * dans la boucle de combat (décision 2 du §7, périmètre du §4.3). Le jour où ils
 * entrent, ils entrent ici — pas dans un quatrième `<select>`.
 */
export const PORTEURS = Object.freeze(['terrain', 'attribut', 'magie']);

export const PORTEUR_LABELS = Object.freeze({
  terrain: 'Terrain',
  attribut: 'Attribut',
  magie: 'Magie',
});

// ───────────────────────────────────────────────────────────────────────────
// Quand
// ───────────────────────────────────────────────────────────────────────────

/**
 * Le moment où un effet part, EN FRANÇAIS — le jumeau d'affichage de `QUANDS`
 * (`client/src/logic/effects/types.ts`).
 *
 * ⚠️ Le `quand` est une propriété du TYPE, jamais du porteur. C'est la règle qui
 * a tué onze effets (§1.4) : un `revive` posé sous un `start_of_combat` ne se
 * déclenchait jamais. L'admin doit donc l'AFFICHER, pas le demander — c'est la
 * seule façon qu'un auteur voie que son `revive` partira en fin de combat quoi
 * qu'il fasse.
 */
export const QUAND_LABELS = Object.freeze({
  a_l_invocation: 'quand une unité est invoquée',
  debut_combat: 'au début du combat',
  pouvoir_utilise: 'quand un pouvoir part',
  fin_combat: 'à la fin du combat',
  allie_detruit: 'quand un allié est neutralisé',
  ennemi_detruit: 'quand un ennemi est neutralisé',
  immediat: 'au tap du joueur',
});

/** Les deux déclencheurs d'un `stat_modifier`, qui portent leur `quand` eux-mêmes. */
export const TRIGGERS = Object.freeze([
  ['on_ally_neutralized', 'Quand un allié est neutralisé'],
  ['on_enemy_neutralized', 'Quand un ennemi est neutralisé'],
]);

const QUAND_PAR_TRIGGER = Object.freeze({
  on_ally_neutralized: 'allie_detruit',
  on_enemy_neutralized: 'ennemi_detruit',
});

/**
 * Ce que la DONNÉE écrit pour nommer un moment, et ce que le moteur en fait.
 *
 * ⚠️ Jumeau de `QUAND_PAR_TIMING` (`compile.ts`), séparé par la frontière
 * ESM-racine / TS-bundle comme `tiers.js` l'est de `logic/Tiers.ts`.
 * `effect-schema.test.ts` les fait répondre la même chose — c'est le seul filet
 * contre leur dérive.
 */
export const TIMING_PAR_QUAND = Object.freeze({
  debut_combat: 'start_of_combat',
  fin_combat: 'end_of_combat',
  a_l_invocation: 'on_summon',
  pouvoir_utilise: 'on_power_fired',
});

/**
 * Les moments où un APPELANT tient la mémoire des portées.
 *
 * ⚠️ Ce n'est pas « les moments qui se répètent » : c'est « ceux où quelqu'un
 * compte ». Le moteur ne compte rien lui-même (§3.5), il demande. Aujourd'hui
 * seule `GameSession.place()` fournit cette mémoire ; offrir une portée
 * ailleurs ferait refuser l'effet à l'exécution — un effet mort découvert en
 * jeu, quand le compilateur peut le refuser à l'écriture.
 *
 * ⚠️ JUMEAU de `QUANDS_AVEC_MEMOIRE` (`compile.ts`), et
 * `effect-schema.test.ts` les fait répondre la même chose.
 */
export const QUANDS_AVEC_MEMOIRE = Object.freeze(['a_l_invocation']);

export const PORTEE_LABELS = Object.freeze({
  a_chaque_fois: 'à chaque fois',
  une_fois_par_combat: 'une fois par combat',
  une_fois_par_round: 'une fois par round',
  une_fois_par_partie: 'une fois par partie',
});

/** Les moments qu'un type sait honorer sur ce porteur. */
export function quandsDe(porteur, type) {
  return TYPES[type]?.[porteur]?.quands ?? [];
}

/**
 * Le moment d'un effet : celui qu'il NOMME s'il en nomme un, sinon le défaut de
 * son type (le premier de la liste).
 *
 * ⚠️ Le principe qui a tué onze effets ne bouge pas — un effet ne part jamais à
 * un moment que son type ne sait pas honorer. Ce qui change, c'est qu'un type
 * qui en sait honorer plusieurs laisse l'auteur choisir, au lieu de rendre le
 * second inexprimable.
 */
export function quandDe(porteur, type, effet) {
  const quands = quandsDe(porteur, type);
  if (!quands.length) return null;
  if (quands[0] === 'selon_trigger') return QUAND_PAR_TRIGGER[effet?.trigger] ?? null;
  const nomme = Object.entries(TIMING_PAR_QUAND).find(([, t]) => t === effet?.timing)?.[0];
  return nomme && quands.includes(nomme) ? nomme : quands[0];
}

// ───────────────────────────────────────────────────────────────────────────
// Les stats modifiables
// ───────────────────────────────────────────────────────────────────────────

/**
 * Les stats d'unité qu'un effet peut viser — UNE liste, pour les trois porteurs.
 *
 * ⚠️ Elles vivaient en trois exemplaires qui avaient divergé sans raison :
 * l'onglet Attributs offrait `power_charge`, les deux autres non. Aucune règle
 * ne le justifiait — le compilateur, lui, accepte le même jeu de champs quel que
 * soit le porteur (`CHAMP_PAR_STAT`, l'inverse de `CHAMPS_UNITE`). Un test le
 * prouve stat par stat.
 */
export const STATS = Object.freeze([
  ['atk', 'ATK'],
  ['hp', 'PV'],
  ['attack_rate', "Vitesse d'attaque (compteur 0–100)"],
  ['movement_rate', 'Vitesse de déplacement (compteur 0–100)'],
  ['range', 'Portée'],
  ['power_charge', 'Charge de pouvoir (+N par step)'],
]);

// ───────────────────────────────────────────────────────────────────────────
// Les champs
// ───────────────────────────────────────────────────────────────────────────

/**
 * Le descripteur par défaut d'un champ. Un type peut en surcharger n'importe
 * quelle clé — c'est ce qui permet à `value` de s'appeler « Nombre de copies »
 * sur une duplication et « Facteur de division » sur un `power_cooldown` sans
 * qu'il y ait deux champs.
 *
 * `lecteur` dit QUI lit le champ :
 *   • `moteur`  — le compilateur le traduit en tâche. C'est le cas normal, et
 *                 un test le prouve par une SONDE : on change le champ, la
 *                 compilation doit changer.
 *   • `session` — l'appelant le lit, pas le moteur. Un seul cas aujourd'hui, et
 *                 c'est la frontière du §6.5 : l'ÉLIGIBILITÉ d'une cible
 *                 (`GameSession.magieHandTargets`) n'est pas un effet.
 *
 * `masqueSi` nomme une condition que l'éditeur sait résoudre. ⚠️ Elle reste un
 * MOT, pas un calcul : la seule qui existe demande de savoir quels pouvoirs
 * lisent une durée, ce qui vit dans `speed-scale.mjs` — et ce fichier n'importe
 * rien, à dessein. Le vocabulaire déclare la règle, l'éditeur la résout.
 *
 * `declenche` dit qu'un autre champ dépend de celui-ci, donc que l'éditeur doit
 * se re-rendre quand il change.
 *
 * `omettreSiDefaut` dit de ne PAS persister une valeur égale au défaut. Réservé
 * aux champs qu'on vient d'ouvrir : les écrire partout sèmerait dans tout le
 * catalogue une clé qui ne dit rien de plus que son absence.
 *
 * `offert` dit si l'ÉDITEUR le propose. ⚠️ Les deux questions sont distinctes, et
 * la table doit répondre aux deux : un champ encore LU par le moteur mais qu'on
 * ne veut plus voir écrire est une forme HISTORIQUE — la déclarer `offert: false`
 * la sort du formulaire sans la sortir du vocabulaire. L'omettre tout court la
 * rendrait invisible du test, et on serait revenu à un champ lu que rien ne
 * documente : exactement la panne que ce fichier existe pour fermer.
 */
const CHAMP_DEFAUT = { saisie: 'nombre', defaut: 0, facultatif: false, lecteur: 'moteur', offert: true, declenche: false, omettreSiDefaut: false };

export const CHAMPS = Object.freeze({
  stat: { label: 'Stat ciblée', saisie: 'choix', options: 'stats', defaut: 'atk' },
  value: { label: 'Valeur', saisie: 'nombre', defaut: 0 },
  value_per: {
    label: 'Multiplié par le nombre d’ennemis portant',
    saisie: 'choix', options: 'attributs', facultatif: true, defaut: '',
    // ⚠️ `value_per` attend un ID D'ATTRIBUT, et rien d'autre. Le `<select>`
    // d'avant proposait en plus `active_unit`, qui n'en est pas un : le
    // multiplicateur valait ZÉRO et le bonus était nul, en silence (§6.1). Le
    // compilateur le refuse désormais ; la liste ne le propose plus.
    aide: 'Un attribut du catalogue. Vide = pas de multiplication.',
  },
  max: { label: 'Maximum (optionnel)', saisie: 'nombre', facultatif: true, defaut: '' },
  trigger: { label: 'Déclencheur', saisie: 'choix', options: 'triggers', defaut: 'on_enemy_neutralized' },
  hp_percent: { label: '% des PV max', saisie: 'nombre', defaut: 50 },
  tier: { label: 'Tier de la carte garantie', saisie: 'choix', options: 'tiers', facultatif: true, defaut: '' },
  // ⚠️ Les deux listes de critères sont rendues PAR UN SEUL widget
  // (`renderGuaranteedDrawCriteria`) : elles s'éditent par re-render, jamais en
  // relisant le DOM. Le schéma les nomme, l'éditeur sait qu'elles vont ensemble.
  attributes: { label: 'Attributs exigés', saisie: 'criteres', facultatif: true, defaut: [] },
  card_ids: { label: 'Cartes acceptables', saisie: 'criteres', facultatif: true, defaut: [] },
  attribute: {
    label: 'Attribut visé (optionnel)',
    saisie: 'choix', options: 'attributs', facultatif: true, defaut: '', lecteur: 'session',
    aide: 'Restreint les cartes de la main que la magie peut viser. Vide = toutes.',
  },
  target_attributes: { label: 'Archétypes ciblés', saisie: 'attributs_multi', facultatif: true, defaut: [] },
  timing: {
    label: 'Quand il part', saisie: 'choix_direct', defaut: '', declenche: true,
    // ⚠️ Ne s'écrit QUE s'il s'écarte du défaut du type. Sans ça, ouvrir puis
    // enregistrer une fiche sèmerait `"timing": "start_of_combat"` sur tous les
    // paliers du catalogue — du bruit qui ressemble à un changement, et la
    // pollution exacte qu'on a retirée à l'ancien éditeur (`value: 0` sur un
    // `revive`).
    omettreSiDefaut: true,
    // ⚠️ Le seul champ dont les OPTIONS dépendent du type : ce sont les moments
    // que ce type sait honorer, et rien d'autre. En proposer un de plus
    // rouvrirait la panne des onze effets morts.
    aide: 'Ce type sait partir à plusieurs moments. Un moment qu’il ne sait pas honorer est refusé à l’écriture.',
  },
  portee: {
    label: 'Combien de fois', saisie: 'choix_direct', facultatif: true, defaut: '',
    omettreSiDefaut: true,
    options: Object.entries(PORTEE_LABELS),
    aide: 'Vide = à chaque fois, le comportement par défaut.',
  },
  power_id: {
    label: 'Pouvoir donné', saisie: 'choix', options: 'pouvoirs', defaut: '',
    // ⚠️ `declenche` dit qu'un AUTRE champ dépend de celui-ci : le changer doit
    // re-rendre l'éditeur, sinon « Valeur » resterait à l'écran sur un pouvoir
    // qui lit une durée.
    declenche: true,
  },
  power_rate: {
    label: 'Vitesse du pouvoir', saisie: 'compteur', defaut: 50,
    // ⚠️ Obligatoire : sans lui l'unité garde le `null` d'`Unit` (« pas de
    // pouvoir ») et le pouvoir ne partirait JAMAIS.
    aide: 'Compteur 0–100. Obligatoire : sans lui, le pouvoir ne part jamais.',
  },
  duration: {
    label: 'Durée du pouvoir', saisie: 'compteur_duree', defaut: 50,
    aide: 'Compteur 0–100. Les quatre pouvoirs de durée lisent ceci, jamais « Valeur ».',
  },
});

/**
 * La surcharge d'un critère de pioche garantie resté sous sa forme d'origine :
 * lu par le moteur, plus jamais écrit par l'éditeur.
 */
const CRITERE_HISTORIQUE = Object.freeze({
  label: 'Attribut exigé (forme historique)',
  lecteur: 'moteur',
  facultatif: true,
  aide: 'Remplacé par « Attributs exigés ». Conservé pour la donnée déjà écrite.',
});

/** Le descripteur complet d'un champ, surcharges du type comprises. */
function descripteur(id, surcharge) {
  return { id, ...CHAMP_DEFAUT, ...CHAMPS[id], ...(surcharge || {}) };
}

// ───────────────────────────────────────────────────────────────────────────
// La table des types — LA déclaration
// ───────────────────────────────────────────────────────────────────────────

/**
 * Un type par entrée ; une entrée par porteur qui l'accepte.
 *
 * ⚠️ **Table FERMÉE.** Un type absent d'ici n'est offert nulle part, et un type
 * présent ici doit compiler — les deux sens sont éprouvés. C'est la même
 * discipline que `MagieOffer` (`default: false`), pour la même raison : une
 * table ouverte laisse passer l'effet que personne ne peut ni écrire ni lire.
 *
 * ⚠️ `moteur: false` n'est pas une panne, c'est la FRONTIÈRE du §6.5 rendue
 * visible à l'écran. Ces deux effets fonctionnent exactement comme avant ; ils
 * gardent leur chemin écrit à la main dans `GameSession` au lieu de passer par
 * le moteur générique. L'admin le DIT, plutôt que de laisser l'information vivre
 * dans un commentaire du compilateur.
 */
export const TYPES = Object.freeze({
  // ── Ce qui touche une unité ──────────────────────────────────────────────
  stat_bonus: {
    label: 'Bonus de stat',
    terrain: { quands: ['debut_combat'], champs: { stat: {}, value: {}, target_attributes: {} } },
    attribut: { quands: ['debut_combat', 'a_l_invocation', 'pouvoir_utilise'], champs: { stat: {}, value: {}, value_per: {} } },
    magie: { quands: ['immediat'], champs: { stat: {}, value: {} } },
  },
  stat_modifier: {
    label: 'Modificateur de stat (multiplicateur)',
    court: 'Modificateur de stat',
    terrain: { quands: ['debut_combat'], champs: { stat: {}, value: { label: 'Facteur (1 = aucun effet)', defaut: 1 }, target_attributes: {} } },
    // ⚠️ `trigger` avant `value` : l'ordre des champs est celui que
    // `readEffectFromForm` écrit, donc celui du JSON enregistré. Le faire
    // coller à la donnée livrée évite de réécrire 10 attributs à la première
    // ouverture de fiche — du bruit de diff qui ressemble à un changement.
    attribut: { quands: ['selon_trigger'], champs: { stat: {}, trigger: {}, value: {} } },
    magie: { quands: ['immediat'], champs: { stat: {}, value: { label: 'Facteur (1 = aucun effet)', defaut: 1 } } },
  },
  team_stat_bonus: {
    label: 'Bonus de stat — TOUTES tes unités',
    court: 'Bonus de stat (équipe)',
    magie: { quands: ['immediat'], champs: { stat: {}, value: {} } },
  },
  shield: {
    label: 'Bouclier',
    terrain: { quands: ['debut_combat'], champs: { value: {}, target_attributes: {} } },
    // ⚠️ Pas de `value_per` ici, et c'est un RETRAIT volontaire : le bouclier
    // d'attribut est TOUJOURS × alliés vivants, le compilateur pose
    // `parAllieVivant: true` sans jamais lire `value_per`. Le champ était
    // décoratif, et c'est lui qui rendait `active_unit` proposable (§6.1).
    attribut: { quands: ['debut_combat', 'a_l_invocation', 'pouvoir_utilise'], champs: { value: {} } },
    magie: { quands: ['immediat'], champs: { value: {} } },
  },
  heal: {
    label: 'Soin TOTAL (une unité)',
    court: 'Soin total',
    // ⚠️ Aucun champ : le soin suit le max COURANT, bonus et vétérance compris.
    // `value` n'est PAS lu — des entrées anciennes en portent un, il est ignoré.
    magie: { quands: ['immediat'], champs: {} },
  },
  team_heal: {
    label: 'Soin de masse — TOUTES tes unités',
    court: 'Soin de masse',
    magie: { quands: ['immediat'], champs: { value: { label: 'PV rendus' } } },
  },
  effect_immunity: {
    label: 'Immunité aux effets négatifs (poison, paralysie, push, burn…)',
    court: 'Immunité aux effets',
    attribut: { quands: ['debut_combat', 'a_l_invocation', 'pouvoir_utilise'], champs: {} },
  },
  revive: {
    label: 'Réanimation d’une unité du cimetière',
    court: 'Réanimation',
    // ⚠️ Les deux porteurs ne chiffrent pas le pourcentage dans le même champ,
    // et la donnée livrée le fait déjà : l'attribut écrit `hp_percent`, la magie
    // écrit `value`. Le schéma le DIT au lieu de laisser deux éditeurs le
    // deviner — c'est précisément le genre d'écart qui se lit comme un bug.
    attribut: { quands: ['fin_combat'], champs: { hp_percent: {} } },
    magie: { quands: ['immediat'], champs: { value: { label: '% des PV max', defaut: 50 } } },
  },
  grant_power: {
    label: 'Donner / remplacer le pouvoir d’une unité',
    court: 'Donner un pouvoir',
    // ⚠️ `value` et `duration` S'EXCLUENT, et c'est le POUVOIR DONNÉ qui
    // tranche, pas le type d'effet : les quatre pouvoirs de `DURATION_POWERS`
    // lisent la durée, les dix autres la valeur. Les deux sont donc facultatifs
    // ici — l'éditeur n'en montre qu'un, et un `value` résiduel sur un pouvoir
    // de durée est refusé en 400 par le contrat de carte.
    magie: {
      quands: ['immediat'],
      champs: {
        power_id: {}, power_rate: {},
        value: { label: 'Valeur du pouvoir', facultatif: true, masqueSi: 'pouvoir_de_duree' },
        duration: { facultatif: true, masqueSi: 'pouvoir_sans_duree' },
      },
    },
  },
  power_cooldown: {
    label: 'Accélérer le pouvoir d’une unité',
    court: 'Accélérer un pouvoir',
    magie: { quands: ['immediat'], champs: { value: { label: 'Facteur de division', defaut: 2 } } },
  },

  // ── Ce qui touche le joueur ──────────────────────────────────────────────
  draw_bonus: {
    label: 'Pioche supplémentaire',
    court: 'Pioche',
    terrain: { quands: ['debut_combat'], champs: { value: { label: 'Cartes en plus', defaut: 1 } } },
    attribut: { quands: ['fin_combat'], champs: { value: { label: 'Cartes en plus', defaut: 1 }, max: {} } },
    magie: { quands: ['immediat'], champs: { value: { label: 'Cartes en plus', defaut: 1 } } },
  },
  guaranteed_draw: {
    label: 'Pioche garantie (tier, attributs, cartes)',
    court: 'Pioche garantie',
    // ⚠️ MÊMES champs des deux côtés : les deux effets alimentent la même file
    // (`player_guaranteed_draws`) et passent par le même
    // `Draw.resolveGuaranteedDraws`. Un attribut ne doit pas savoir promettre
    // moins qu'une magie.
    // ⚠️ `attribute` au singulier est la forme HISTORIQUE, fondue dans
    // `attributes` par `Draw.guaranteedDrawCriteria`. Le compilateur la lit
    // encore — de la donnée livrée en porte — mais l'éditeur ne la propose plus :
    // deux champs pour la même question laisseraient écrire deux réponses.
    attribut: { quands: ['fin_combat'], champs: { tier: {}, attributes: {}, card_ids: {}, attribute: { offert: false, ...CRITERE_HISTORIQUE } } },
    magie: { quands: ['immediat'], champs: { tier: {}, attributes: {}, card_ids: {}, attribute: { offert: false, ...CRITERE_HISTORIQUE } } },
  },
  board_slot_bonus: {
    label: 'Slot de board supplémentaire',
    court: 'Slot de board',
    attribut: { quands: ['fin_combat'], champs: { value: { defaut: 1 }, max: {} } },
    magie: { quands: ['immediat'], champs: { value: { defaut: 1 } } },
  },
  damage_multiplier_bonus: {
    label: 'Multiplicateur de dégâts supplémentaire',
    court: 'Multiplicateur de dégâts',
    attribut: { quands: ['fin_combat'], champs: { value: {}, max: {} } },
    magie: { quands: ['immediat'], champs: { value: {} } },
  },
  shopping_bonus: {
    label: 'Magie supplémentaire à la Phase Shopping',
    court: 'Magie de Shopping en plus',
    attribut: { quands: ['fin_combat'], champs: { value: { defaut: 1 }, max: {} } },
  },
  player_hp_bonus: {
    label: 'Bonus de PV du joueur',
    court: 'Bonus PV joueur',
    magie: { quands: ['immediat'], champs: { value: {} } },
  },

  // ── Ce qui déplace des entités entre conteneurs ──────────────────────────
  destroy_unit: {
    label: 'Détruire une unité alliée (→ cimetière)',
    court: 'Détruire une unité',
    magie: { quands: ['immediat'], champs: {} },
  },
  drain_life: {
    label: 'Absorber les PV d’une unité alliée',
    court: 'Absorber les PV d’une unité',
    magie: { quands: ['immediat'], champs: {} },
  },
  hand_to_graveyard: {
    label: 'Envoyer une carte de la main au cimetière',
    court: 'Main → cimetière',
    magie: { quands: ['immediat'], champs: {} },
  },
  sacrifice_card_hp: {
    label: 'Sacrifier une carte de la main → PV du joueur',
    court: 'Sacrifier une carte → PV joueur',
    magie: { quands: ['immediat'], champs: { value: { label: '% des PV de la carte', defaut: 100 } } },
  },
  duplicate_unit: {
    label: 'Dupliquer une unité du terrain → sa carte en main',
    court: 'Dupliquer une unité',
    magie: { quands: ['immediat'], champs: { value: { label: 'Nombre de copies', defaut: 1 } } },
  },
  duplicate_graveyard_unit: {
    label: 'Dupliquer une unité du cimetière → sa carte en main',
    court: 'Dupliquer une unité du cimetière',
    magie: { quands: ['immediat'], champs: { value: { label: 'Nombre de copies', defaut: 1 } } },
  },
  duplicate_card: {
    label: 'Dupliquer une carte de la main',
    magie: { quands: ['immediat'], champs: { value: { label: 'Nombre de copies', defaut: 1 } } },
  },
  shift_tier_card: {
    label: 'Remplacer une carte de la main par une carte du tier voisin',
    court: 'Remplacer une carte (tier voisin)',
    magie: { quands: ['immediat'], champs: { value: { label: 'Décalage de tier (signé)', defaut: 1 } } },
  },
  shift_tier_unit: {
    label: 'Remplacer une unité du terrain par une unité du tier voisin',
    court: 'Remplacer une unité (tier voisin)',
    magie: { quands: ['immediat'], champs: { value: { label: 'Décalage de tier (signé)', defaut: 1 } } },
  },

  // ── Ce qui retouche une CARTE ────────────────────────────────────────────
  reduce_materials: {
    label: 'Baisser le coût en matériels (main)',
    court: 'Baisser le coût en matériels',
    magie: { quands: ['immediat'], champs: { value: { label: 'Slots retirés', defaut: 1 }, attribute: {} } },
  },
  remove_requirements: {
    label: 'Lever des exigences nommées (main)',
    court: 'Lever des exigences nommées',
    magie: { quands: ['immediat'], champs: { value: { label: 'Exigences levées', defaut: 1 }, attribute: {} } },
  },

  // ── Les deux que le moteur ne traduit pas ────────────────────────────────
  defuse_fusion: {
    label: 'Séparer une Fusion en ses matériaux',
    court: 'Séparer une fusion',
    moteur: false,
    raison: 'Lit la lignée de la carte et replie sur le cimetière si le board est plein — c’est une règle d’invocation, et l’invocation n’entre pas dans le moteur.',
    magie: { quands: ['immediat'], champs: {} },
  },
  draw_material: {
    label: 'Piocher un matériel d’invocation d’une carte de la main',
    court: 'Piocher un matériel',
    moteur: false,
    raison: 'Consomme DEUX tirages (quel matériel, puis quelle carte le porte) là où le moteur n’en fait qu’un — les aplatir changerait la distribution et le flux semé.',
    magie: { quands: ['immediat'], champs: {} },
  },
});

// ───────────────────────────────────────────────────────────────────────────
// Les lectures
// ───────────────────────────────────────────────────────────────────────────

/** Les types qu'un porteur accepte, dans l'ordre de la table. */
export function typesPour(porteur) {
  return Object.entries(TYPES)
    .filter(([, def]) => def[porteur])
    .map(([id, def]) => ({
      id,
      label: def.label,
      quands: def[porteur].quands,
      moteur: def.moteur !== false,
      raison: def.raison ?? null,
    }));
}

/**
 * Les champs d'un effet, descripteurs complets, dans l'ordre de la table.
 *
 * ⚠️ Deux champs sont UNIVERSELS et ne figurent dans aucune entrée : `timing` et
 * `portee`. Les recopier sur les vingt-sept types serait vingt-sept endroits où
 * les oublier ; les dériver de ce que le type sait faire les rend impossibles à
 * désaccorder — un `timing` n'apparaît que si le type honore plus d'un moment,
 * une `portee` que si ce moment se reproduit.
 */
export function champsDe(porteur, type) {
  const def = TYPES[type]?.[porteur];
  if (!def) return [];
  const champs = Object.entries(def.champs).map(([id, surcharge]) => descripteur(id, surcharge));

  // ⚠️ Les deux sont TOUJOURS déclarés et pas toujours OFFERTS, et la nuance est
  // celle de la forme historique `attribute` : le compilateur les lit quoi qu'il
  // arrive — pour REFUSER un moment que le type ne sait pas honorer, ou une
  // portée que personne ne compte. Les omettre de `champsDe` les rendrait
  // invisibles de la sonde, donc non documentés ; les OFFRIR partout donnerait
  // des `<select>` à une seule option, le contrôle décoratif qu'on vient de
  // retirer ailleurs.
  // ⚠️ Les deux n'existent que sur l'ATTRIBUT, et pour deux raisons distinctes.
  // Un effet de TERRAIN part au lancement du combat, un point final ; une MAGIE
  // part au tap du joueur, et « une fois par partie » y demanderait une mémoire
  // que personne ne tient. Les offrir là serait promettre un réglage sans
  // porteur.
  //
  // ⚠️ Et ils sont TOUJOURS déclarés, pas toujours OFFERTS — la nuance de la
  // forme historique `attribute` : le compilateur les lit quoi qu'il arrive,
  // pour REFUSER un moment que le type ne sait pas honorer ou une portée que
  // personne ne compte. Les omettre de `champsDe` les rendrait invisibles de la
  // sonde ; les offrir partout donnerait des `<select>` à une seule option, le
  // contrôle décoratif qu'on vient de retirer ailleurs.
  if (porteur !== 'attribut') return champs;
  const quands = def.quands;
  // ⚠️ `selon_trigger` porte son moment dans son `trigger`, pas dans un `timing` :
  // il n'a donc AUCUN moment nommable, et le champ sort avec une liste vide. Il
  // reste déclaré — sans quoi la sonde inverse exigerait qu'un `timing` écrit
  // là-dessus ne change rien, alors qu'il est (justement) refusé.
  const moments = quands[0] === 'selon_trigger' ? [] : quands;
  champs.unshift(descripteur('timing', {
    offert: moments.length > 1,
    options: moments.map(q => [TIMING_PAR_QUAND[q], QUAND_LABELS[q]]),
    defaut: TIMING_PAR_QUAND[moments[0]] ?? '',
  }));
  champs.push(descripteur('portee', {
    offert: quands.some(q => QUANDS_AVEC_MEMOIRE.includes(q)),
  }));
  return champs;
}

/**
 * Les champs que l'ÉDITEUR propose — `champsDe` moins les formes historiques.
 *
 * ⚠️ C'est la seule lecture qu'un formulaire doit faire. `champsDe`, elle, rend
 * le vocabulaire ENTIER : c'est ce que le test sonde, et ce qui garantit qu'un
 * champ retiré du formulaire ne disparaisse pas aussi de la documentation.
 */
export function champsOfferts(porteur, type) {
  return champsDe(porteur, type).filter(c => c.offert);
}

/**
 * Le libellé français d'un type — le seul, pour tout le projet.
 *
 * ⚠️ Deux rendus d'une seule donnée, jamais deux tables : `label` explique
 * (c'est ce qu'on lit dans un `<select>` pour CHOISIR), `court` désigne (c'est
 * ce qu'on lit dans une liste pour RECONNAÎTRE). Même geste que `CardTile`, qui
 * prend la liste des tiers quand le liseré prend le plus haut. Un type sans
 * `court` est déjà assez court.
 */
export function libelleType(type, { court = false } = {}) {
  const def = TYPES[type];
  if (!def) return type;
  return court ? (def.court ?? def.label) : def.label;
}

/** Un porteur accepte-t-il ce type ? */
export function accepte(porteur, type) {
  return Boolean(TYPES[type]?.[porteur]);
}

/**
 * L'effet neuf d'un type donné, avec ses défauts.
 *
 * ⚠️ Il ne porte QUE les champs déclarés. C'est ce qui empêche un `value: 0`
 * parasite de se persister sur un type qui ne lit pas de valeur — le piège des
 * deux listes `noValue` que l'ancien formulaire de magie tenait à la main.
 */
export function effetNeuf(porteur, type) {
  const out = { type };
  for (const champ of champsDe(porteur, type)) {
    if (champ.facultatif) continue;
    out[champ.id] = Array.isArray(champ.defaut) ? [...champ.defaut] : champ.defaut;
  }
  return out;
}
