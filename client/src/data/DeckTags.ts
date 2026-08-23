/* eslint-disable @typescript-eslint/no-explicit-any */
// Tags automatiques d'un deck : ses deux attributs dominants, puis un mot sur son
// profil de combat. Trois au maximum — au-delà, la carte de deck ne se lit plus
// d'un coup d'œil et les tags cessent de distinguer quoi que ce soit.
//
// Un seul calcul pour les deux camps, mais deux MOMENTS : le deck du joueur les
// fige à l'enregistrement (DeckBuilder → DeckRepository.setDeckTags, ils font
// partie de son méta), un deck public les dérive à l'affichage (DeckSelector) —
// il n'a pas de méta local où les ranger et sa composition change en admin.
import * as AttributeDatabase from './AttributeDatabase.js';
import type { Card } from '../logic/types.js';

/** Un attribut doit porter au moins 2 cartes pour être dit « dominant ». */
const MIN_ATTRIBUTE_OCCURRENCES = 2;
const MAX_TAGS = 3;

export function computeDeckTags(cards: Card[]): string[] {
  const n = cards.length;
  const attrCounts: Record<string, number> = {};
  for (const card of cards) for (const id of (card.attributes ?? [])) attrCounts[id] = (attrCounts[id] || 0) + 1;
  // ⚠️ Le tri a DEUX critères, et le second n'est pas cosmétique : à effectif
  // égal, sans lui, c'est l'ordre de parcours des cartes qui tranche. Deux decks
  // de composition identique mais d'ordre différent afficheraient donc des tags
  // différents — et un deck public, dont la composition se réordonne en admin,
  // changerait de tags sans avoir changé de contenu. L'`id` d'attribut est une
  // valeur ABSOLUE ; même geste que le départage par `card_id` de l'ordre
  // d'initiative dans `CombatManager`, et pour la même raison.
  const dominant = Object.entries(attrCounts)
    .filter(([, c]) => c >= MIN_ATTRIBUTE_OCCURRENCES)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 2)
    .map(([id]) => (AttributeDatabase as any).getAttribute(id)?.name ?? id);
  const tags = [...dominant];
  if (n > 0) {
    const meleeR = cards.filter(c => ((c as any).stats?.range ?? 1) === 1).length / n;
    if (meleeR >= 0.65) tags.push('Mêlée');
    else if (meleeR <= 0.35) tags.push('Distance');
    else {
      const avg = cards.reduce((s, c) => s + ((c as any).stats?.atk ?? 0), 0) / n;
      if (cards.filter(c => ((c as any).stats?.atk ?? 0) > 28).length >= 2) tags.push('Brutal');
      else if (avg > 22) tags.push('Offensif');
    }
  }
  return tags.slice(0, MAX_TAGS);
}
