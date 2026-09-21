// Ce qu'une barre de vie annonce quand elle bouge (`components/hud/hpBar.ts`).
// Module PUR : la suite tourne en node sans DOM, c'est la seule façon
// d'éprouver une décision d'affichage dans ce projet.
//
// ⚠️ Éprouvés dans les deux sens : la mutation attendue est nommée par cas.
import { describe, it, expect } from 'vitest';
import { hpRatio, hpDeltaLabel, hpTweenValue, HP_MAX } from '../components/hud/hpBar.js';

describe('hpRatio — la part remplie', () => {
  it('rend la fraction des PV de départ', () => {
    expect(hpRatio(500)).toBeCloseTo(0.5);
    expect(hpRatio(HP_MAX)).toBe(1);
  });

  // Mutation : bornes retirées → ROUGE. Une barre qui déborde sa gouttière
  // recouvre le pseudo posé juste à côté.
  it('BORNE : rien ne sort de la gouttière', () => {
    expect(hpRatio(-40)).toBe(0);
    expect(hpRatio(4000)).toBe(1);
  });

  // Un barème absent ou nul ne doit pas rendre NaN — la largeur CSS serait
  // « NaN% », donc silencieusement ignorée, donc une barre pleine.
  it('un barème nul rend 0, jamais NaN', () => {
    expect(hpRatio(100, 0)).toBe(0);
  });
});

describe('hpDeltaLabel — le montant encaissé', () => {
  // ⚠️ Mutation : `0` rendu comme « 0 » → ROUGE. Un montant nul se lirait
  // comme une perte (même règle que les paliers de niveau).
  it('un delta NUL ne s\'annonce pas', () => {
    expect(hpDeltaLabel(0)).toBeNull();
    expect(hpDeltaLabel(0.4)).toBeNull();
  });

  // Mutation : signe omis → ROUGE. « 40 » sur une barre de vie ne dit pas dans
  // quel sens elle va.
  it('le SIGNE est toujours écrit', () => {
    expect(hpDeltaLabel(-120)).toBe('−120');
    expect(hpDeltaLabel(40)).toBe('+40');
  });
});

describe('hpTweenValue — le décompte du chiffre', () => {
  it('part de la valeur d\'avant et progresse', () => {
    expect(hpTweenValue(1000, 600, 0)).toBe(1000);
    const mid = hpTweenValue(1000, 600, 0.5);
    expect(mid).toBeLessThan(1000);
    expect(mid).toBeGreaterThan(600);
  });

  // ⚠️ Mutation : `p >= 1` traité comme les autres avancements → le chiffre
  // s'arrête à l'arrondi de l'interpolation. C'est le total que le joueur relit
  // au récapitulatif : il doit être exact, pas approché.
  it('ARRIVE exactement sur la cible', () => {
    expect(hpTweenValue(1000, 637, 1)).toBe(637);
    expect(hpTweenValue(1000, 637, 1.4)).toBe(637);
  });

  it('un gain se décompte comme une perte, en sens inverse', () => {
    const mid = hpTweenValue(400, 700, 0.5);
    expect(mid).toBeGreaterThan(400);
    expect(mid).toBeLessThan(700);
  });
});
