// La jauge d'énergie et le filtre de la liste de bonus (`components/hud/`).
// Modules PURS : la suite tourne en node sans DOM.
//
// ⚠️ Éprouvés dans les deux sens : la mutation attendue est nommée par cas.
import { describe, it, expect } from 'vitest';
import { gaugeModel, RESERVE_CELLS_MAX } from '../components/hud/energyGauge.js';
import { isShownSynergy, isNearThreshold, orderShownSynergies } from '../components/hud/synergyFilter.js';
import type { SynergyEntry } from '../stores/gameStore.js';

describe('gaugeModel', () => {
  it('sépare occupé, libre et réserve', () => {
    expect(gaugeModel(3, 8, 4)).toEqual({ used: 5, free: 3, reserveCells: 4, reserveMerged: false, reserve: 4, empty: false });
  });

  // Mutation : seuil de fusion retiré → ROUGE.
  it('fusionne la réserve au-delà de dix cases', () => {
    const m = gaugeModel(0, 21, 27);
    expect(m.reserveMerged).toBe(true);
    expect(m.reserveCells).toBe(0);
    expect(gaugeModel(0, 8, RESERVE_CELLS_MAX).reserveMerged).toBe(false);
  });

  // Mutation : borne retirée → ROUGE (cases négatives).
  it('borne le reste au budget', () => {
    expect(gaugeModel(12, 8, 0)).toMatchObject({ used: 0, free: 8 });
    expect(gaugeModel(-2, 8, -1)).toMatchObject({ used: 8, free: 0, reserve: 0, empty: true });
  });
});

const syn = (count: number, next: number | null, active: boolean): SynergyEntry => ({
  attr: { id: 'A', name: 'A' }, count, activeThreshold: active ? {} : null, nextThreshold: next === null ? null : { count: next },
});

describe('isShownSynergy', () => {
  it('garde un palier atteint, même sans suivant', () => {
    expect(isShownSynergy(syn(4, null, true))).toBe(true);
    expect(isShownSynergy(syn(2, 4, true))).toBe(true);
  });
  // Mutation : `=== 1` passé à `<= 2` → ROUGE sur le 1/3.
  it('garde ce qui est à une unité du palier, écarte le reste', () => {
    expect(isShownSynergy(syn(1, 2, false))).toBe(true);
    expect(isShownSynergy(syn(2, 3, false))).toBe(true);
    expect(isShownSynergy(syn(1, 3, false))).toBe(false);
  });
  it('« à une près » ne qualifie pas un palier déjà atteint', () => {
    expect(isNearThreshold(syn(3, 4, true))).toBe(false);
    expect(isNearThreshold(syn(1, 2, false))).toBe(true);
  });
});

describe('orderShownSynergies', () => {
  const named = (id: string, active: boolean): SynergyEntry => ({ ...syn(2, 3, active), attr: { id, name: id } });
  // Mutation : tri retiré (ordre reçu rendu tel quel) → ROUGE.
  it('met les paliers atteints en tête, en gardant l\'ordre de chaque groupe', () => {
    const list = [named('a', false), named('b', true), named('c', false), named('d', true)];
    expect(orderShownSynergies(list).map(s => s.attr.id)).toEqual(['b', 'd', 'a', 'c']);
  });
  it('ne mute pas la liste reçue', () => {
    const list = [named('a', false), named('b', true)];
    orderShownSynergies(list);
    expect(list.map(s => s.attr.id)).toEqual(['a', 'b']);
  });
});
