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

module.exports = { REQUIRED_CATEGORIES, missingCategories };
