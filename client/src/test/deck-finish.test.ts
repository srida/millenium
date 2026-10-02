// Part pure de l'édition des finitions d'un deck (`data/DeckFinish`) et
// balisage partagé des calques (`three/finishLayers`).
import { describe, it, expect } from 'vitest';
import { hasAnyFinish, pruneFinishes, visibleFinish, NO_OWNED_FINISHES, type OwnedFinishes } from '../data/DeckFinish.js';
import { effectLayersHtml, frameClass, frameInnerHtml, inkClass, inkLayersHtml, sparkleSpecs, SPARKLES } from '../three/finishLayers.js';
import { frameVars } from '../three/cardPalette.js';

const OWNED: OwnedFinishes = { foil: false, holo: true, sparkle: false, inks: ['sepia'], frames: ['gravure'] };

describe('DeckFinish', () => {
  it('visibleFinish ne garde que ce qui est possédé', () => {
    expect(visibleFinish({ holo: true, sparkle: true, ink: 'sepia', frame: 'courant' }, OWNED))
      .toEqual({ holo: true, ink: 'sepia' });
    expect(visibleFinish({ holo: true }, NO_OWNED_FINISHES)).toEqual({});
    expect(visibleFinish({ holo: true }, null)).toEqual({});
  });

  it('pruneFinishes retire les cartes sorties du deck et les finitions perdues', () => {
    const out = pruneFinishes(
      { A: { holo: true, frame: 'gravure' }, B: { holo: true }, C: { sparkle: true } },
      new Set(['A', 'C']),
      (id) => (id === 'A' ? OWNED : NO_OWNED_FINISHES),
    );
    expect(out).toEqual({ A: { holo: true, frame: 'gravure' } });
  });

  it('hasAnyFinish ignore le reflet (qui a son propre interrupteur)', () => {
    expect(hasAnyFinish({ ...NO_OWNED_FINISHES, foil: true })).toBe(false);
    expect(hasAnyFinish(OWNED)).toBe(true);
  });
});

describe('finishLayers', () => {
  it('18 éclats, taille proportionnelle à la largeur de face, limités à la demande', () => {
    expect(SPARKLES).toHaveLength(18);
    expect(sparkleSpecs()).toHaveLength(18);
    expect(sparkleSpecs(10)).toHaveLength(10);
    expect(sparkleSpecs(1)[0]).toEqual({ left: '24%', top: '18%', width: '13.1%', delay: '0s' });
  });

  it('le balisage suit la finition, et rien sans finition', () => {
    expect(effectLayersHtml({})).toBe('');
    expect(inkLayersHtml({})).toBe('');
    expect(frameInnerHtml({})).toBe('');
    expect(effectLayersHtml({ holo: true })).toContain('finish-holo');
    expect((effectLayersHtml({ sparkle: true }, 10).match(/<i /g) ?? [])).toHaveLength(10);
    expect(inkLayersHtml({ ink: 'tier' })).toContain('finish-ink-tint tier');
    expect(inkLayersHtml({ ink: 'nb' })).not.toContain('finish-ink-tint'); // N&B : grain seul
    expect(inkClass({ ink: 'sepia' })).toBe('ink-sepia');
    expect(frameClass({ frame: 'facettes' })).toBe('frame-facettes');
    expect(frameClass({})).toBe('');
  });

  it('la palette expose l\'encre et le fond profond du tier du haut', () => {
    const v = frameVars([3, 4]);
    expect(v['--uc-ink']).toBe('#d6bdf6');
    expect(v['--uc-deep']).toBe('#1c1038');
  });
});
