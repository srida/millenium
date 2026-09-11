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
  debut_combat: 'au début du combat',
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

/** Le moment d'un effet, son `trigger` compris quand il en porte un. */
export function quandDe(porteur, type, effet) {
  const def = TYPES[type]?.[porteur];
  if (!def) return null;
  if (def.quand !== 'selon_trigger') return def.quand;
  return QUAND_PAR_TRIGGER[effet?.trigger] ?? null;
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
 * `offert` dit si l'ÉDITEUR le propose. ⚠️ Les deux questions sont distinctes, et
 * la table doit répondre aux deux : un champ encore LU par le moteur mais qu'on
 * ne veut plus voir écrire est une forme HISTORIQUE — la déclarer `offert: false`
 * la sort du formulaire sans la sortir du vocabulaire. L'omettre tout court la
 * rendrait invisible du test, et on serait revenu à un champ lu que rien ne
 * documente : exactement la panne que ce fichier existe pour fermer.
 */
const CHAMP_DEFAUT = { saisie: 'nombre', defaut: 0, facultatif: false, lecteur: 'moteur', offert: true };

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
  power_id: { label: 'Pouvoir donné', saisie: 'choix', options: 'pouvoirs', defaut: '' },
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
    terrain: { quand: 'debut_combat', champs: { stat: {}, value: {}, target_attributes: {} } },
    attribut: { quand: 'debut_combat', champs: { stat: {}, value: {}, value_per: {} } },
    magie: { quand: 'immediat', champs: { stat: {}, value: {} } },
  },
  stat_modifier: {
    label: 'Modificateur de stat (multiplicateur)',
    terrain: { quand: 'debut_combat', champs: { stat: {}, value: { label: 'Facteur (1 = aucun effet)', defaut: 1 }, target_attributes: {} } },
    attribut: { quand: 'selon_trigger', champs: { stat: {}, value: {}, trigger: {} } },
    magie: { quand: 'immediat', champs: { stat: {}, value: { label: 'Facteur (1 = aucun effet)', defaut: 1 } } },
  },
  team_stat_bonus: {
    label: 'Bonus de stat — TOUTES tes unités',
    magie: { quand: 'immediat', champs: { stat: {}, value: {} } },
  },
  shield: {
    label: 'Bouclier',
    terrain: { quand: 'debut_combat', champs: { value: {}, target_attributes: {} } },
    // ⚠️ Pas de `value_per` ici, et c'est un RETRAIT volontaire : le bouclier
    // d'attribut est TOUJOURS × alliés vivants, le compilateur pose
    // `parAllieVivant: true` sans jamais lire `value_per`. Le champ était
    // décoratif, et c'est lui qui rendait `active_unit` proposable (§6.1).
    attribut: { quand: 'debut_combat', champs: { value: {} } },
    magie: { quand: 'immediat', champs: { value: {} } },
  },
  heal: {
    label: 'Soin TOTAL (une unité)',
    // ⚠️ Aucun champ : le soin suit le max COURANT, bonus et vétérance compris.
    // `value` n'est PAS lu — des entrées anciennes en portent un, il est ignoré.
    magie: { quand: 'immediat', champs: {} },
  },
  team_heal: {
    label: 'Soin de masse — TOUTES tes unités',
    magie: { quand: 'immediat', champs: { value: { label: 'PV rendus' } } },
  },
  effect_immunity: {
    label: 'Immunité aux effets négatifs (poison, paralysie, push, burn…)',
    attribut: { quand: 'debut_combat', champs: {} },
  },
  revive: {
    label: 'Réanimation d’une unité du cimetière',
    // ⚠️ Les deux porteurs ne chiffrent pas le pourcentage dans le même champ,
    // et la donnée livrée le fait déjà : l'attribut écrit `hp_percent`, la magie
    // écrit `value`. Le schéma le DIT au lieu de laisser deux éditeurs le
    // deviner — c'est précisément le genre d'écart qui se lit comme un bug.
    attribut: { quand: 'fin_combat', champs: { hp_percent: {} } },
    magie: { quand: 'immediat', champs: { value: { label: '% des PV max', defaut: 50 } } },
  },
  grant_power: {
    label: 'Donner / remplacer le pouvoir d’une unité',
    // ⚠️ `value` et `duration` S'EXCLUENT, et c'est le POUVOIR DONNÉ qui
    // tranche, pas le type d'effet : les quatre pouvoirs de `DURATION_POWERS`
    // lisent la durée, les dix autres la valeur. Les deux sont donc facultatifs
    // ici — l'éditeur n'en montre qu'un, et un `value` résiduel sur un pouvoir
    // de durée est refusé en 400 par le contrat de carte.
    magie: {
      quand: 'immediat',
      champs: {
        power_id: {}, power_rate: {},
        value: { label: 'Valeur du pouvoir', facultatif: true },
        duration: { facultatif: true },
      },
    },
  },
  power_cooldown: {
    label: 'Accélérer le pouvoir d’une unité',
    magie: { quand: 'immediat', champs: { value: { label: 'Facteur de division', defaut: 2 } } },
  },

  // ── Ce qui touche le joueur ──────────────────────────────────────────────
  draw_bonus: {
    label: 'Pioche supplémentaire',
    terrain: { quand: 'debut_combat', champs: { value: { label: 'Cartes en plus', defaut: 1 } } },
    attribut: { quand: 'fin_combat', champs: { value: { label: 'Cartes en plus', defaut: 1 }, max: {} } },
    magie: { quand: 'immediat', champs: { value: { label: 'Cartes en plus', defaut: 1 } } },
  },
  guaranteed_draw: {
    label: 'Pioche garantie (tier, attributs, cartes)',
    // ⚠️ MÊMES champs des deux côtés : les deux effets alimentent la même file
    // (`player_guaranteed_draws`) et passent par le même
    // `Draw.resolveGuaranteedDraws`. Un attribut ne doit pas savoir promettre
    // moins qu'une magie.
    // ⚠️ `attribute` au singulier est la forme HISTORIQUE, fondue dans
    // `attributes` par `Draw.guaranteedDrawCriteria`. Le compilateur la lit
    // encore — de la donnée livrée en porte — mais l'éditeur ne la propose plus :
    // deux champs pour la même question laisseraient écrire deux réponses.
    attribut: { quand: 'fin_combat', champs: { tier: {}, attributes: {}, card_ids: {}, attribute: { offert: false, ...CRITERE_HISTORIQUE } } },
    magie: { quand: 'immediat', champs: { tier: {}, attributes: {}, card_ids: {}, attribute: { offert: false, ...CRITERE_HISTORIQUE } } },
  },
  board_slot_bonus: {
    label: 'Slot de board supplémentaire',
    attribut: { quand: 'fin_combat', champs: { value: { defaut: 1 }, max: {} } },
    magie: { quand: 'immediat', champs: { value: { defaut: 1 } } },
  },
  damage_multiplier_bonus: {
    label: 'Multiplicateur de dégâts supplémentaire',
    attribut: { quand: 'fin_combat', champs: { value: {}, max: {} } },
    magie: { quand: 'immediat', champs: { value: {} } },
  },
  shopping_bonus: {
    label: 'Magie supplémentaire à la Phase Shopping',
    attribut: { quand: 'fin_combat', champs: { value: { defaut: 1 }, max: {} } },
  },
  player_hp_bonus: {
    label: 'Bonus de PV du joueur',
    magie: { quand: 'immediat', champs: { value: {} } },
  },

  // ── Ce qui déplace des entités entre conteneurs ──────────────────────────
  destroy_unit: {
    label: 'Détruire une unité alliée (→ cimetière)',
    magie: { quand: 'immediat', champs: {} },
  },
  drain_life: {
    label: 'Absorber les PV d’une unité alliée',
    magie: { quand: 'immediat', champs: {} },
  },
  hand_to_graveyard: {
    label: 'Envoyer une carte de la main au cimetière',
    magie: { quand: 'immediat', champs: {} },
  },
  sacrifice_card_hp: {
    label: 'Sacrifier une carte de la main → PV du joueur',
    magie: { quand: 'immediat', champs: { value: { label: '% des PV de la carte', defaut: 100 } } },
  },
  duplicate_unit: {
    label: 'Dupliquer une unité du terrain → sa carte en main',
    magie: { quand: 'immediat', champs: { value: { label: 'Nombre de copies', defaut: 1 } } },
  },
  duplicate_graveyard_unit: {
    label: 'Dupliquer une unité du cimetière → sa carte en main',
    magie: { quand: 'immediat', champs: { value: { label: 'Nombre de copies', defaut: 1 } } },
  },
  duplicate_card: {
    label: 'Dupliquer une carte de la main',
    magie: { quand: 'immediat', champs: { value: { label: 'Nombre de copies', defaut: 1 } } },
  },
  shift_tier_card: {
    label: 'Remplacer une carte de la main par une carte du tier voisin',
    magie: { quand: 'immediat', champs: { value: { label: 'Décalage de tier (signé)', defaut: 1 } } },
  },
  shift_tier_unit: {
    label: 'Remplacer une unité du terrain par une unité du tier voisin',
    magie: { quand: 'immediat', champs: { value: { label: 'Décalage de tier (signé)', defaut: 1 } } },
  },

  // ── Ce qui retouche une CARTE ────────────────────────────────────────────
  reduce_materials: {
    label: 'Baisser le coût en matériels (main)',
    magie: { quand: 'immediat', champs: { value: { label: 'Slots retirés', defaut: 1 }, attribute: {} } },
  },
  remove_requirements: {
    label: 'Lever des exigences nommées (main)',
    magie: { quand: 'immediat', champs: { value: { label: 'Exigences levées', defaut: 1 }, attribute: {} } },
  },

  // ── Les deux que le moteur ne traduit pas ────────────────────────────────
  defuse_fusion: {
    label: 'Séparer une Fusion en ses matériaux',
    moteur: false,
    raison: 'Lit la lignée de la carte et replie sur le cimetière si le board est plein — c’est une règle d’invocation, et l’invocation n’entre pas dans le moteur.',
    magie: { quand: 'immediat', champs: {} },
  },
  draw_material: {
    label: 'Piocher un matériel d’invocation d’une carte de la main',
    moteur: false,
    raison: 'Consomme DEUX tirages (quel matériel, puis quelle carte le porte) là où le moteur n’en fait qu’un — les aplatir changerait la distribution et le flux semé.',
    magie: { quand: 'immediat', champs: {} },
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
      quand: def[porteur].quand,
      moteur: def.moteur !== false,
      raison: def.raison ?? null,
    }));
}

/** Les champs d'un effet, descripteurs complets, dans l'ordre de la table. */
export function champsDe(porteur, type) {
  const def = TYPES[type]?.[porteur];
  if (!def) return [];
  return Object.entries(def.champs).map(([id, surcharge]) => descripteur(id, surcharge));
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

/** Le libellé français d'un type — le seul, pour tout le projet. */
export function libelleType(type) {
  return TYPES[type]?.label ?? type;
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
