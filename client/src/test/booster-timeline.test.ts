import { describe, it, expect } from 'vitest';
import { frameAt, layout, durationAfterB, endTime, CARD_W, CARD_PITCH, SHAKE_MIN } from '../components/shop/boosterTimeline.js';

describe('boosterTimeline', () => {
  it('sans résultat (tB = null), le sachet ne s’ouvre jamais, quel que soit t', () => {
    for (const t of [0, 0.4, 1, 2, 5, 30, 600]) {
      const f = frameAt(t, null, 5);
      expect(f.end).toBe(false);
      expect(f.tear.opacity).toBe(0);
      expect(f.top.opacity).toBe(1);
      expect(f.body.opacity).toBe(1);
      expect(f.flash).toBe(0);
      expect(f.cta.interactive).toBe(false);
      expect(f.cards.every(c => c.opacity === 0 && c.flip === 0)).toBe(true);
    }
  });

  it('le tremblement tient tant que les cartes n’arrivent pas', () => {
    expect(frameAt(30, null, 5).glow).toBeGreaterThan(0.5);
  });

  it('layout(n) : centré, sans chevauchement, pour 1 à 5 cartes', () => {
    for (let n = 1; n <= 5; n++) {
      const P = layout(n);
      expect(P).toHaveLength(n);
      const rows = new Map<number, number[]>();
      P.forEach(p => rows.set(p.y, [...(rows.get(p.y) ?? []), p.x]));
      for (const xs of rows.values()) {
        expect(xs.reduce((a, b) => a + b, 0)).toBeCloseTo(0);
        const s = [...xs].sort((a, b) => a - b);
        for (let i = 1; i < s.length; i++) expect(s[i] - s[i - 1]).toBeGreaterThanOrEqual(CARD_W);
      }
      if (n > 3) expect(rows.size).toBe(2);
      expect(CARD_PITCH).toBeGreaterThan(CARD_W);
    }
  });

  it('la fin est atteinte en moins de 4 s après tB (5 cartes) et pose les cartes retournées', () => {
    expect(durationAfterB(5)).toBeLessThan(4);
    const tB = 0.8;
    const before = frameAt(tB + durationAfterB(5) - 0.05, tB, 5);
    expect(before.end).toBe(false);
    const f = frameAt(tB + durationAfterB(5), tB, 5);
    expect(f.end).toBe(true);
    expect(f.cta.interactive).toBe(true);
    const P = layout(5);
    f.cards.forEach((c, i) => {
      expect(c.flip).toBeCloseTo(180);
      expect(c.x).toBeCloseTo(P[i].x);
      expect(c.y).toBeCloseTo(P[i].y);
    });
  });

  it('une réponse tardive reprend la même séquence', () => {
    const a = frameAt(SHAKE_MIN + 1.2, SHAKE_MIN, 3);
    const b = frameAt(3 + 1.2, 3, 3);
    expect(b.top.x).toBeCloseTo(a.top.x);
    expect(b.cards[0].x).toBeCloseTo(a.cards[0].x);
  });

  it('endTime croît avec le nombre de cartes', () => {
    expect(endTime(5)).toBeGreaterThan(endTime(1));
  });
});
