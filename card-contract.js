// Le CONTRAT D'ATTRIBUTS d'une carte.
//
// Depuis que le tier est un attribut, trois catégories ne sont plus
// facultatives — sans elles la carte est muette pour le moteur :
//
//   Tiers       — à quel(s) round(s) elle se pioche. Sans lui, elle n'entre
//                 dans AUCUN pool : elle existe au catalogue et ne sort jamais.
//   Invocation  — comment elle se pose. Un terrain, une mission et une magie la
//                 désignent par là.
//   Element     — sa signature élémentaire, lue par les effets visuels.
//
// ⚠️ `Type` n'en fait PAS partie : 12 cartes livrées n'en portent aucun, et
// aucune règle du moteur ne le lit. L'exiger ferait échouer une écriture sur une
// donnée que personne ne consomme.
//
// PUR et sans aucun require : la liste d'attributs est passée en argument, ce
// qui permet au serveur (catalogue en cache) et à `scripts/audit-cards.js`
// (dossier de données quelconque) d'appliquer LA MÊME règle. C'est la seule
// raison d'être de ce fichier — la recopier ailleurs, c'est se donner deux
// contrats qui finiront par diverger.
const REQUIRED_CATEGORIES = Object.freeze(['Tiers', 'Invocation', 'Element']);

/** Les catégories exigées qu'une carte ne porte pas. `[]` = conforme. */
function missingCategories(card, attributes) {
  const byId = new Map((attributes ?? []).map(a => [a.id, a]));
  const cats = new Set(
    (card?.attributes ?? []).map(id => byId.get(id)?.categorie).filter(Boolean),
  );
  return REQUIRED_CATEGORIES.filter(cat => !cats.has(cat));
}

/**
 * Les deux COMPTEURS DE VITESSE qu'une carte doit porter, et le champ en ticks
 * que chacun a remplacé.
 *
 * ⚠️ **Jumeau assumé de `RATE_STATS` / `LEGACY_TICK_FIELD` (`speed-scale.mjs`)**,
 * pour la raison qui interdit déjà un module partagé à `tiers.js` et
 * `logic/Tiers.ts` : la frontière CJS / ESM. Ce fichier est requis par `app.js`
 * et l'audit (CJS) ; `speed-scale.mjs` est importé par le bundle et
 * `admin.html` (ESM). `speed-scale.test.ts` les fait répondre la même chose —
 * c'est le seul filet contre leur dérive.
 *
 * ⚠️ Les deux listes ne posent d'ailleurs pas la même question :
 * `speed-scale.RATE_STATS` dit « quelles STATS D'EFFET sont des rythmes »
 * (bonus de magie, d'attribut, de terrain) ; celle-ci dit « quels CHAMPS une
 * carte doit porter ». Elles se recouvrent aujourd'hui sur deux noms.
 */
const RATE_FIELDS = Object.freeze({
  attack_rate: 'attack_speed',
  movement_rate: 'movement_speed',
});

/**
 * Ce qui cloche dans les vitesses d'une carte. `[]` = conforme.
 *
 * ⚠️ Le refus est en **400**, comme celui du tier, et pour la même raison : une
 * carte sans compteur n'est pas *invalide à l'écran*, elle est **jouable et
 * fausse**. `Unit` lit `clampRate(undefined)`, c'est-à-dire **0**, donc le
 * rythme le plus lent de l'échelle — l'unité bouge et frappe une fois toutes
 * les 77 ticks, sans qu'une seule ligne ne le signale nulle part. C'est
 * exactement le repli muet que le contrat existe pour rendre impossible.
 *
 * ⚠️ Un champ de TICKS résiduel est compté comme une faute, pas comme une
 * information : il ne peut venir que d'un catalogue jamais repris
 * (`scripts/migrate-speeds.js`), et le laisser passer laisserait vivre deux
 * formats dont un seul est lu. Même règle que le champ `tier` résiduel.
 */
function missingRates(card) {
  const problems = [];
  const stats = card?.stats ?? {};
  for (const [rate, legacy] of Object.entries(RATE_FIELDS)) {
    if (legacy in stats) {
      problems.push(`${legacy} (champ en ticks résiduel — voir scripts/migrate-speeds.js)`);
      continue;
    }
    if (!Number.isFinite(Number(stats[rate])) || stats[rate] === null || stats[rate] === '') {
      problems.push(`${rate} (compteur de vitesse manquant)`);
    }
  }
  if (card?.power && 'power_speed' in card.power) {
    problems.push('power.power_speed (champ en ticks résiduel — voir scripts/migrate-speeds.js)');
  }
  return problems;
}

module.exports = { REQUIRED_CATEGORIES, missingCategories, RATE_FIELDS, missingRates };
