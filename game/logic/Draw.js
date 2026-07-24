// Tiers available per round:
// T1: R1  T2: R1+  T3: R3+  T4: R4+  T5: R5+
// R1:[1]  R2:[1,2]  R3:[1,2,3]  R4:[2,3,4]  R5+:[3,4,5]
export function tiersForRound(round) {
  if (round <= 1) return [1];
  if (round === 2) return [1, 2];
  if (round === 3) return [1, 2, 3];
  if (round === 4) return [2, 3, 4];
  return [3, 4, 5];
}

// Draw `count` cards randomly from the eligible tiers (duplicates allowed)
export function drawHand(cardsByTier, round, count) {
  const pool = tiersForRound(round).flatMap(t => cardsByTier[t] ?? []);
  if (pool.length === 0) return [];
  const hand = [];
  for (let i = 0; i < count; i++) {
    // Clone so two draws of the same card_id are distinct object instances —
    // HandUI's selection (in non-grouped mode) compares cards by reference.
    hand.push({ ...pool[Math.floor(Math.random() * pool.length)] });
  }
  return hand;
}
