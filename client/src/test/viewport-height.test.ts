import { describe, expect, it } from 'vitest';
import { fullScreenHeight } from '../app/viewportHeight.js';

// iPhone 16 Pro Max : 440 × 956 pt, encoche de 62 pt.
const IPHONE = { screenW: 440, screenH: 956 };

describe('fullScreenHeight — le viewport raccourci de l\'appli installée iOS', () => {
  it('portrait au lancement : le viewport trop court est remplacé par la hauteur de l\'écran', () => {
    expect(fullScreenHeight({ standalone: true, ...IPHONE, innerW: 440, innerH: 894 })).toBe(956);
  });

  it('portrait après rotation aller-retour : viewport juste, rien à imposer', () => {
    expect(fullScreenHeight({ standalone: true, ...IPHONE, innerW: 440, innerH: 956 })).toBeNull();
  });

  it('paysage : c\'est le petit côté qui est attendu', () => {
    expect(fullScreenHeight({ standalone: true, ...IPHONE, innerW: 956, innerH: 400 })).toBe(440);
    expect(fullScreenHeight({ standalone: true, ...IPHONE, innerW: 956, innerH: 440 })).toBeNull();
  });

  it('dans le navigateur, on ne touche à rien (100dvh est juste)', () => {
    expect(fullScreenHeight({ standalone: false, ...IPHONE, innerW: 440, innerH: 700 })).toBeNull();
  });

  it('fenêtre partielle (Split View) : aucune déduction possible', () => {
    expect(fullScreenHeight({ standalone: true, screenW: 1024, screenH: 1366, innerW: 507, innerH: 1300 })).toBeNull();
  });
});
