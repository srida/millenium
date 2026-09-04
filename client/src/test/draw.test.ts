/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect } from 'vitest';
import { resolveGuaranteedDraws, deckPoolByTier, poolForRound, drawHand } from '../logic/Draw.js';
import { makeCard } from './helpers.js';

// Partagée par GameSession.startPreparation (joueur) et EnemyAI.drawHand
// (ennemi) — le refactor doit rendre exactement ce que l'inline d'avant
// rendait : mêmes filtres, même ordre de repli, un `rand()` par entrée
// honorée (zéro pour une entrée impossible sur un pool vide).
describe('Draw.resolveGuaranteedDraws', () => {
  it('un tier et un attribut qui matchent piochent dedans', () => {
    const pool = [
      makeCard({ id: 'A', tier: 2, summon_conditions: [{ materials: 0 }], attributes: ['ARCH_X'] }),
      makeCard({ id: 'B', tier: 3, summon_conditions: [], attributes: [] })
    ];
    const rand = () => 0; // premier élément filtré
    const drawn = resolveGuaranteedDraws(pool as any, [{ tier: 2, attribute: 'ARCH_X' }], rand);
    expect(drawn.map(c => c.id)).toEqual(['A']);
  });

  it('sans correspondance exacte, repli SANS le tier', () => {
    const pool = [
      makeCard({ id: 'A', tier: 5, summon_conditions: [{ materials: 0 }], attributes: [] })
    ];
    const drawn = resolveGuaranteedDraws(pool as any, [{ tier: 1 }], () => 0);
    expect(drawn.map(c => c.id)).toEqual(['A']);
  });

  it('sans aucune correspondance, repli sur tout le pool', () => {
    const pool = [makeCard({ id: 'A', tier: 1, summon_conditions: [], attributes: [] })];
    const drawn = resolveGuaranteedDraws(pool as any, [{ tier: 5, attribute: 'ARCH_NOPE' }], () => 0);
    expect(drawn.map(c => c.id)).toEqual(['A']);
  });

  it('pool vide : aucune carte, aucun appel à rand', () => {
    let calls = 0;
    const drawn = resolveGuaranteedDraws([], [{ tier: 1 }], () => { calls++; return 0; });
    expect(drawn).toEqual([]);
    expect(calls).toBe(0);
  });

  it('une entrée par pioche garantie, dans l\'ordre', () => {
    const pool = [makeCard({ id: 'A', tier: 1, summon_conditions: [], attributes: [] })];
    const drawn = resolveGuaranteedDraws(pool as any, [{ tier: 1 }, { tier: 1 }, { tier: 1 }], () => 0);
    expect(drawn).toHaveLength(3);
  });

  it('rend des CLONES — deux tirages de la même carte sont des objets distincts', () => {
    const pool = [makeCard({ id: 'A', tier: 1, summon_conditions: [], attributes: [] })];
    const [a, b] = resolveGuaranteedDraws(pool as any, [{ tier: 1 }, { tier: 1 }], () => 0);
    expect(a).not.toBe(b);
    expect(a).toEqual(b);
  });
});

// ── Plusieurs critères, et des cartes nommées ──────────────────────────────
//
// La forme historique (`tier` + `attribute` unique) ne savait promettre qu'une
// chose à la fois. Les critères se CUMULENT (ET), à une exception : `card_ids`
// est une liste de cartes acceptables, donc un OU entre ses entrées.
describe('Draw — critères multiples et cartes nommées', () => {
  const DRAGON_FEU = makeCard({ id: 'DF', tier: 3, attributes: ['ARCH_DRAGON', 'ARCH_FEU'] });
  const DRAGON = makeCard({ id: 'D', tier: 3, attributes: ['ARCH_DRAGON'] });
  const FEU = makeCard({ id: 'F', tier: 3, attributes: ['ARCH_FEU'] });
  const pool = [DRAGON, FEU, DRAGON_FEU];

  // Mutation : ne lire que le premier attribut de la liste → ROUGE (D passerait).
  it('deux attributs se CUMULENT : il faut les porter tous les deux', () => {
    const drawn = resolveGuaranteedDraws(
      pool as any, [{ attributes: ['ARCH_DRAGON', 'ARCH_FEU'] }], () => 0);
    expect(drawn.map(c => c.id)).toEqual(['DF']);
  });

  // L'ancienne forme reste lue, et se cumule à la nouvelle : rien à migrer.
  it('`attribute` et `attributes` se fondent', () => {
    const drawn = resolveGuaranteedDraws(
      pool as any, [{ attribute: 'ARCH_DRAGON', attributes: ['ARCH_FEU'] }], () => 0);
    expect(drawn.map(c => c.id)).toEqual(['DF']);
  });

  // Mutation : ignorer `card_ids` → ROUGE (le premier du pool sortirait).
  it('une liste de cartes restreint le tirage à ces cartes', () => {
    const drawn = resolveGuaranteedDraws(pool as any, [{ card_ids: ['F'] }], () => 0);
    expect(drawn.map(c => c.id)).toEqual(['F']);
  });

  it('les cartes nommées sont un OU entre elles, et se cumulent au reste', () => {
    // Deux cartes acceptables, mais une seule est Tier 3 ET Dragon.
    const drawn = resolveGuaranteedDraws(
      pool as any, [{ tier: 3, attributes: ['ARCH_DRAGON'], card_ids: ['F', 'D'] }], () => 0);
    expect(drawn.map(c => c.id)).toEqual(['D']);
  });

  // Le repli garde sa règle : c'est le TIER qui saute d'abord, jamais la carte
  // nommée — sinon la magie rendrait une carte qu'elle n'a jamais promise.
  it('repli : le tier saute, la carte nommée tient', () => {
    const drawn = resolveGuaranteedDraws(pool as any, [{ tier: 5, card_ids: ['F'] }], () => 0);
    expect(drawn.map(c => c.id)).toEqual(['F']);
  });

  it('une carte nommée absente du deck retombe sur tout le pool', () => {
    const drawn = resolveGuaranteedDraws(pool as any, [{ card_ids: ['ABSENTE'] }], () => 0);
    expect(drawn.map(c => c.id)).toEqual(['D']);
  });
});

// ===========================================================================
//  Le multi-tier — une carte peut se piocher à PLUSIEURS rounds
// ===========================================================================
// Aucune carte du catalogue livré n'est encore multi-tiers : ces cas sont donc
// les SEULS à exercer la règle, et sans eux elle serait écrite sans être jouée.
describe('Draw — une carte à plusieurs tiers', () => {
  // ⚠️ `makeCard` pose le champ `tier` historique ; `_tiers` est la forme
  // résolue que le serveur sert. On écrit les deux formes pour vérifier que
  // c'est bien la RÉSOLUE qui commande.
  const multi = { ...makeCard({ id: 'M', tier: 2, summon_conditions: [] }), _tiers: [2, 4] } as any;
  const t2 = makeCard({ id: 'A', tier: 2, summon_conditions: [] }) as any;
  const t4 = { ...makeCard({ id: 'B', tier: 2, summon_conditions: [] }), _tiers: [4] } as any;
  const db = { getCard: (id: string) => [multi, t2, t4].find(c => c.id === id) ?? null };

  it("entre dans CHAQUE case de l'index, quelle que soit sa lane", () => {
    // Rangée en lane 2 — sa lane ne dit rien de ses tiers.
    const byTier = deckPoolByTier({ 2: ['M', 'A'], 4: ['B'] }, db);
    expect(byTier[2].map((c: any) => c.id)).toEqual(['M', 'A']);
    expect(byTier[4].map((c: any) => c.id)).toEqual(['M', 'B']);
    expect(byTier[1]).toEqual([]);
    expect(byTier[3]).toEqual([]);
  });

  it('se pioche donc à plus de rounds — round 2 comme round 4', () => {
    const byTier = deckPoolByTier({ 2: ['M', 'A'], 4: ['B'] }, db);
    // Round 2 : tiers [1,2]. Round 5 : tiers [3,4,5].
    expect(poolForRound(byTier, 2).map(c => c.id)).toEqual(['M', 'A']);
    expect(poolForRound(byTier, 5).map(c => c.id)).toEqual(['M', 'B']);
  });

  it("⚠️ mais UNE SEULE FOIS dans le sac d'un round qui couvre ses deux tiers", () => {
    const byTier = deckPoolByTier({ 2: ['M', 'A'], 4: ['B'] }, db);
    // Round 4 : tiers [2,3,4] — les deux tiers de M sont éligibles.
    const pool = poolForRound(byTier, 4);
    expect(pool.map(c => c.id)).toEqual(['M', 'A', 'B']);
    // Sans dédoublonnage elle sortirait deux fois plus souvent que ses voisines,
    // ce qui n'est pas ce que « plusieurs tiers » veut dire.
    expect(pool.filter(c => c.id === 'M')).toHaveLength(1);
  });

  it('et le tirage indexe ce sac-là', () => {
    const byTier = deckPoolByTier({ 2: ['M', 'A'], 4: ['B'] }, db);
    // `rand` renvoyant 0, c'est toujours le premier du sac.
    expect(drawHand(byTier, 4, 3, () => 0).map(c => c.id)).toEqual(['M', 'M', 'M']);
    // Round 1 : aucun de ses tiers n'est éligible, elle ne sort pas.
    expect(drawHand(byTier, 1, 3, () => 0)).toEqual([]);
  });

  it('une carte rangée hors de ses tiers se pioche selon SES tiers', () => {
    // `B` est tier 4 et rangée en lane 1 : c'est la carte qui décide.
    const byTier = deckPoolByTier({ 1: ['B'] }, db);
    expect(poolForRound(byTier, 1)).toEqual([]);
    expect(poolForRound(byTier, 5).map(c => c.id)).toEqual(['B']);
  });
});
