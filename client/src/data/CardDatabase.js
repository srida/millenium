let cards = null;
let byId = null;
let byTier = null;

export async function init() {
  if (cards) return cards;
  const res = await fetch('/api/cards');
  if (!res.ok) throw new Error(`CardDatabase: fetch failed (${res.status})`);
  cards = await res.json();
  byId = Object.fromEntries(cards.map(c => [c.id, c]));
  byTier = {};
  for (const c of cards) {
    if (!byTier[c.tier]) byTier[c.tier] = [];
    byTier[c.tier].push(c);
  }
  return cards;
}

export function getCard(id) {
  if (!byId) throw new Error('CardDatabase not initialised — call init() first');
  return byId[id] ?? null;
}

export function getCardsByTier(tier) {
  if (!byTier) throw new Error('CardDatabase not initialised — call init() first');
  return byTier[tier] ?? [];
}

export function getAllCards() {
  if (!cards) throw new Error('CardDatabase not initialised — call init() first');
  return cards;
}


// Décrit la pastille de coût d'invocation d'une carte — description
// STRUCTURÉE, pas un rendu : ce module n'importe pas React, c'est CardTile.tsx
// qui décide de l'icône réelle (image admin ou emoji de repli) à partir d'elle.
export function costHint(card) {
  if (Array.isArray(card.summon_options) && card.summon_options.length > 0) return { kind: 'multi' };
  if (card.summon_type === 'sacrifice') {
    const n = card.cost?.sacrifice ?? 0;
    return n > 0 ? { kind: 'type', type: 'sacrifice', count: n } : null;
  }
  if (['fusion', 'heritage', 'transformation'].includes(card.summon_type)) {
    return { kind: 'type', type: card.summon_type };
  }
  return null;
}
