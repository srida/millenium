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

export function buildDeckFromIds(idsByTier) {
  // idsByTier: { "1": ["CORE_001", ...], "2": [...], ... }
  const result = {};
  for (const [tier, ids] of Object.entries(idsByTier)) {
    result[tier] = ids.map(id => {
      const card = getCard(id);
      if (!card) throw new Error(`Unknown card id: ${id}`);
      return card;
    });
  }
  return result;
}

export function illustrationUrl(id) {
  return `/illustrations/${id}`;
}

export function costHint(card) {
  if (Array.isArray(card.summon_options) && card.summon_options.length > 0) return '🔀';
  if (card.summon_type === 'sacrifice') {
    const n = card.cost?.sacrifice ?? 0;
    return n > 0 ? `×${n}💀` : null;
  }
  if (card.summon_type === 'fusion') return '⚗';
  if (card.summon_type === 'heritage') return '🔮';
  if (card.summon_type === 'transformation') return '🔄';
  return null;
}
