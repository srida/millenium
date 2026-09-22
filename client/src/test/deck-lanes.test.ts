// Golden tests de `logic/DeckLanes` — le rangement des cartes multi-tiers dans
// les lanes du DeckBuilder.
//
// Ce qui est verrouillé, et pourquoi :
//   • une carte multi-tiers DESCEND automatiquement vers un tier plus bas dès
//     qu'un retrait y libère une place (`settle`) ;
//   • un ajout qui bloque sur un tier plein passe quand même s'il peut faire
//     BASCULER un occupant multi-tiers vers un de SES autres tiers
//     (`placeCard` / `canPlace`) ;
//   • sans occupant capable de basculer, l'ajout et la place restent refusés
//     (`canPlace` rend faux, `placeCard` rend `null`).
import { describe, it, expect } from 'vitest';
import type { Card } from '../logic/types.js';
import { laneOf, canPlace, placeCard, settle, type DeckLanes } from '../logic/DeckLanes.js';

/** Carte minimale : seul `_tiers` pèse sur le rangement. */
const card = (id: string, tiers: number[]): Card =>
  ({ id, name: id, _tiers: tiers } as unknown as Card);

function emptyLanes(): DeckLanes {
  return { 1: [], 2: [], 3: [], 4: [], 5: [] };
}

/** `n` cartes mono-tier `t`, avec un id déterministe. */
function fill(t: number, n: number, prefix = 'T'): Card[] {
  return Array.from({ length: n }, (_, i) => card(`${prefix}${t}_${i}`, [t]));
}

const tierMax: Record<number, number> = { 1: 8, 2: 8, 3: 8, 4: 8, 5: 8 };

describe('settle — descente en cascade après un retrait', () => {
  it('une carte multi-tiers bascule vers le tier libéré', () => {
    // 8 cartes tier 2 (plein) + ZANE en tier 3.
    const zane = card('ZANE_004', [2, 3]);
    let d: DeckLanes = { ...emptyLanes(), 2: fill(2, 8), 3: [zane] };

    // On retire une carte tier 2 : une place se libère.
    d = { ...d, 2: d[2].slice(1) };
    d = settle(d, tierMax);

    expect(laneOf(d, 'ZANE_004')).toBe(2);
    expect(d[2]).toHaveLength(8);
    expect(d[3]).toHaveLength(0);
  });

  it('sans place libre, une carte multi-tiers ne bouge pas', () => {
    const zane = card('ZANE_004', [2, 3]);
    const d: DeckLanes = { ...emptyLanes(), 2: fill(2, 8), 3: [zane] };
    expect(settle(d, tierMax)).toEqual(d);
  });

  it('cascade sur plusieurs niveaux', () => {
    // Tier 2 plein, un multi-tiers [2,3] en tier 3, un multi-tiers [3,4] en
    // tier 4. Libérer le tier 2 doit faire descendre le [2,3] en tier 2, ce
    // qui libère le tier 3 pour le [3,4].
    const a = card('A', [2, 3]);
    const b = card('B', [3, 4]);
    let d: DeckLanes = { ...emptyLanes(), 2: fill(2, 8), 3: [a], 4: [b] };
    d = { ...d, 2: d[2].slice(1) };
    d = settle(d, tierMax);

    expect(laneOf(d, 'A')).toBe(2);
    expect(laneOf(d, 'B')).toBe(3);
    expect(d[4]).toHaveLength(0);
  });
});

describe('placeCard / canPlace — ajout avec bascule d\'un occupant', () => {
  it('un ajout normal se pose au plus bas tier disponible', () => {
    const zane = card('ZANE_004', [2, 3]);
    const d: DeckLanes = { ...emptyLanes(), 2: fill(2, 7) };
    const next = placeCard(zane, d, tierMax);
    expect(next).not.toBeNull();
    expect(laneOf(next!, 'ZANE_004')).toBe(2);
  });

  it('un tier plein pousse son occupant multi-tiers vers un autre tier', () => {
    // 7 cartes tier2 + ZANE(2,3) déjà posé en tier2 (plein). On ajoute une
    // carte mono-tier2 : ZANE doit basculer en tier3 pour lui faire place.
    const zane = card('ZANE_004', [2, 3]);
    const d: DeckLanes = { ...emptyLanes(), 2: [...fill(2, 7), zane] };
    const x = card('X', [2]);

    expect(canPlace(x, d, tierMax)).toBe(true);
    const next = placeCard(x, d, tierMax);
    expect(next).not.toBeNull();
    expect(laneOf(next!, 'X')).toBe(2);
    expect(laneOf(next!, 'ZANE_004')).toBe(3);
    expect(next![2]).toHaveLength(8);
    expect(next![3]).toHaveLength(1);
  });

  it('aucun occupant ne peut basculer : l\'ajout est refusé et le pool grisé', () => {
    // Tier2 (7 cartes) + tier3 (8, plein, aucune multi-tiers). On ajoute
    // ZANE(2,3) qui se pose directement en tier2 (qui a de la place) — puis on
    // vérifie que tier2 ET tier3 sont désormais injoignables pour une carte
    // mono-tier, faute d'occupant capable de basculer.
    const zane = card('ZANE_004', [2, 3]);
    let d: DeckLanes = { ...emptyLanes(), 2: fill(2, 7), 3: fill(3, 8) };
    const placed = placeCard(zane, d, tierMax);
    expect(placed).not.toBeNull();
    d = placed!;
    expect(d[2]).toHaveLength(8);
    expect(d[3]).toHaveLength(8);

    const onlyTier2 = card('Y', [2]);
    const onlyTier3 = card('Z', [3]);
    expect(canPlace(onlyTier2, d, tierMax)).toBe(false);
    expect(canPlace(onlyTier3, d, tierMax)).toBe(false);
    expect(placeCard(onlyTier2, d, tierMax)).toBeNull();
    expect(placeCard(onlyTier3, d, tierMax)).toBeNull();
  });

  it('sans aucune place, même en cascade, placeCard rend null', () => {
    const d: DeckLanes = { ...emptyLanes(), 2: fill(2, 8) };
    const c = card('C', [2]);
    expect(canPlace(c, d, tierMax)).toBe(false);
    expect(placeCard(c, d, tierMax)).toBeNull();
  });
});
