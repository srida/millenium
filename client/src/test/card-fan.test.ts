// `components/hand/cardFan` — la géométrie de l'éventail (portrait) et de la
// pile à deux colonnes (rails du mode web).
//
// Tout se joue sur UN invariant, et il est vérifié en balayage plutôt que sur
// quelques cas choisis : **rien ne déborde en silence**. Le choix retenu est de
// montrer toute la main sans défilement, donc la seule variable d'ajustement est
// la taille — une main que l'on ne peut pas faire tenir doit le DIRE
// (`overflow`), jamais sortir de la bande sans prévenir.
import { describe, it, expect } from 'vitest';
import {
  fanLayout, railLayout, railJitter,
  CARD_ASPECT, PITCH_IDEAL, PITCH_MIN, SCALE_MIN, ARC_MAX_DEG, RAIL_JITTER_DEG,
} from '../components/hand/cardFan.js';

// Bande du mode portrait sur un téléphone étroit : 390 px moins les marges et
// le rembourrage de la bande. Carte `h-28` → 112 px de haut, donc 80 de large.
const PHONE_WIDTH = 362;
const CARD_W = 80;
// Rail web : `w-52` (208 px) moins les marges, deux colonnes.
const RAIL_W = 192;
const RAIL_H = 520;

const fan = (count: number, width = PHONE_WIDTH, cardWidth = CARD_W) =>
  fanLayout({ count, width, cardWidth });
const rail = (count: number, height = RAIL_H) =>
  railLayout({ count, width: RAIL_W, height, cardWidth: 84 });

describe('fanLayout — les cas dégénérés', () => {
  for (const [label, count] of [['vide', 0], ['négatif', -3]] as const) {
    it(`main ${label} → aucune carte`, () => {
      expect(fan(count).cards).toEqual([]);
    });
  }

  it('largeur nulle → aucune carte, et surtout aucun NaN', () => {
    expect(fanLayout({ count: 5, width: 0, cardWidth: CARD_W }).cards).toEqual([]);
  });

  it('une seule carte : centrée, droite, à plat', () => {
    const { cards, scale } = fan(1);
    expect(cards).toHaveLength(1);
    expect(cards[0]).toMatchObject({ x: 0, y: 0, rotZ: 0, scale: 1 });
    expect(scale).toBe(1);
  });
});

describe('fanLayout — la symétrie', () => {
  for (const count of [2, 3, 5, 8, 13]) {
    it(`${count} cartes : l'éventail est son propre miroir`, () => {
      const { cards } = fan(count);
      for (let i = 0; i < count; i++) {
        const mirror = cards[count - 1 - i];
        expect(cards[i].x).toBeCloseTo(-mirror.x, 6);
        expect(cards[i].rotZ).toBeCloseTo(-mirror.rotZ, 6);
        expect(cards[i].y).toBeCloseTo(mirror.y, 6);
      }
    });
  }

  it('le centre de gravité est le centre de la bande', () => {
    const sum = fan(7).cards.reduce((a, c) => a + c.x, 0);
    expect(sum).toBeCloseTo(0, 6);
  });
});

describe('fanLayout — l’ordre', () => {
  it('les x croissent strictement, donc l’ordre de la main se lit', () => {
    const { cards } = fan(9);
    for (let i = 1; i < cards.length; i++) expect(cards[i].x).toBeGreaterThan(cards[i - 1].x);
  });

  it('l’empilement suit la main, de gauche à droite', () => {
    // ⚠️ Un z uniforme laisserait l'ordre de peinture du DOM décider, donc
    // changerait au moindre re-render.
    expect(fan(6).cards.map(c => c.zIndex)).toEqual([0, 1, 2, 3, 4, 5]);
  });
});

describe('fanLayout — l’arc', () => {
  it('s’ouvre avec la main puis PLAFONNE', () => {
    const amplitude = (n: number) => {
      const { cards } = fan(n);
      return cards[cards.length - 1].rotZ - cards[0].rotZ;
    };
    expect(amplitude(3)).toBeGreaterThan(amplitude(2));
    expect(amplitude(30)).toBeCloseTo(ARC_MAX_DEG, 6);
    expect(amplitude(200)).toBeCloseTo(ARC_MAX_DEG, 6);
  });

  it('creuse vers le bas aux extrémités, jamais au centre', () => {
    const { cards } = fan(9);
    expect(cards[4].y).toBeCloseTo(0, 6);
    for (const c of cards) expect(c.y).toBeGreaterThanOrEqual(0);
    expect(cards[0].y).toBeGreaterThan(cards[3].y);
    expect(cards[0].y).toBeCloseTo(cards[8].y, 6);
  });
});

describe('fanLayout — les concessions, dans l’ordre', () => {
  it('main courte sur écran large : pas nominal, échelle pleine', () => {
    const { scale, pitch } = fan(4, 1200);
    expect(scale).toBe(1);
    expect(pitch).toBeCloseTo(CARD_W * PITCH_IDEAL, 6);
  });

  it('① la main s’allonge : le PAS se resserre, la taille ne bouge pas', () => {
    const { scale, pitch } = fan(9);
    expect(scale).toBe(1);
    expect(pitch).toBeLessThan(CARD_W * PITCH_IDEAL);
    expect(pitch).toBeGreaterThanOrEqual(CARD_W * PITCH_MIN);
  });

  it('② le pas touche son plancher : c’est l’ÉCHELLE qui cède', () => {
    const { scale, pitch } = fan(28);
    expect(scale).toBeLessThan(1);
    expect(pitch).toBeCloseTo(CARD_W * scale * PITCH_MIN, 6);
  });

  it('③ l’échelle a un plancher, et le débordement est ANNONCÉ', () => {
    const huge = fan(200);
    expect(huge.scale).toBe(SCALE_MIN);
    expect(huge.overflow).toBe(true);
  });

  it('le pas ne descend JAMAIS sous son plancher, à l’échelle en cours', () => {
    for (let n = 2; n <= 120; n++) {
      const { pitch, scale } = fan(n);
      expect(pitch, `${n} cartes`).toBeGreaterThanOrEqual(CARD_W * scale * PITCH_MIN - 1e-9);
    }
  });
});

describe('fanLayout — L’INVARIANT : rien ne déborde en silence', () => {
  it('de 1 à 150 cartes, ça tient dans la bande ou `overflow` le dit', () => {
    for (let n = 1; n <= 150; n++) {
      const r = fan(n);
      if (!r.overflow) {
        expect(r.boundsWidth, `${n} cartes`).toBeLessThanOrEqual(PHONE_WIDTH + 0.5);
      }
    }
  });

  it('la place de la DERNIÈRE carte est comptée', () => {
    // ⚠️ L'erreur classique : ne compter que les pas. Le dépassement vaut alors
    // exactement une carte, et ne se voit que sur la main la plus longue.
    for (const n of [5, 9, 14, 20]) {
      const r = fan(n);
      const span = (n - 1) * r.pitch;
      expect(r.boundsWidth, `${n} cartes`).toBeGreaterThan(span);
    }
  });

  it('une main qui tient PILE n’est pas déclarée en débordement', () => {
    // Le cas que la mesure sur la boîte droite ratait : une carte tournée
    // déborde de sa boîte, et l'écart vaut un tiers de pas.
    for (let n = 2; n <= 40; n++) {
      const r = fan(n);
      if (r.boundsWidth <= PHONE_WIDTH) expect(r.overflow, `${n} cartes`).toBe(false);
    }
  });

  it('la hauteur réservée couvre la rotation ET le creux de l’arc', () => {
    // Le conteneur n'a pas le droit de rogner : `overflow: hidden` couperait la
    // carte levée. Il lui faut donc la vraie hauteur.
    const r = fan(11);
    const cardHeight = (CARD_W / CARD_ASPECT) * r.scale;
    expect(r.boundsHeight).toBeGreaterThan(cardHeight);
  });

  it('aucune valeur n’est NaN ou infinie, même sur une main absurde', () => {
    for (const n of [1, 2, 47, 300, 1000]) {
      for (const c of fan(n).cards) {
        for (const v of [c.x, c.y, c.rotZ, c.rotY, c.scale, c.zIndex]) {
          expect(Number.isFinite(v), `${n} cartes`).toBe(true);
        }
      }
    }
  });
});

describe('fanLayout — L’AUTRE moitié : la place doit être EXPLOITÉE', () => {
  // ⚠️ Ces trois cas-là manquaient, et deux mutations leur ont échappé : le
  // drapeau `overflow` se dérivant de l'encombrement réel, il reste honnête
  // même quand le calcul abandonne trop tôt. Une bande qui renonce à 20 cartes
  // là où 28 tiennent est aussi fautive qu'une bande qui déborde — simplement,
  // elle ment par excès de prudence au lieu de mentir par optimisme.

  /** Le plus grand nombre de cartes que la bande avale sans déborder. */
  const capacity = (width = PHONE_WIDTH, cardWidth = CARD_W) => {
    let n = 0;
    while (n < 500 && !fanLayout({ count: n + 1, width, cardWidth }).overflow) n++;
    return n;
  };

  it('dès que la largeur contraint, la bande est REMPLIE au pixel près', () => {
    // De 7 cartes jusqu'à la capacité, le pas est dicté par la largeur : la
    // bande doit donc être pleine, pas seulement « pas débordée ».
    for (let n = 7; n <= capacity(); n++) {
      const r = fan(n);
      expect(r.overflow, `${n} cartes`).toBe(false);
      expect(r.boundsWidth, `${n} cartes`).toBeGreaterThan(PHONE_WIDTH - 1.5);
    }
  });

  it('un téléphone étroit avale au moins 28 cartes sans défilement', () => {
    // C'est LE chiffre du contrat « sans défilement » : en dessous, la main
    // d'une fin de partie ne tiendrait plus et il faudrait rouvrir la question.
    expect(capacity()).toBeGreaterThanOrEqual(28);
  });

  it('un écran large en avale strictement plus', () => {
    expect(capacity(900)).toBeGreaterThan(capacity(362));
  });

  it('le débordement est MONOTONE : pas de trou dans la capacité', () => {
    // Une carte de plus ne peut pas faire re-tenir une main qui débordait.
    let seen = false;
    for (let n = 1; n <= 120; n++) {
      const o = fan(n).overflow;
      if (seen) expect(o, `${n} cartes`).toBe(true);
      seen ||= o;
    }
  });
});

describe('railLayout — deux colonnes, ordre de lecture', () => {
  it('remplit de gauche à droite puis de haut en bas', () => {
    const { cards } = rail(6);
    // Rangée 0 = les deux premières, et la gauche est bien à gauche.
    expect(cards[0].x).toBeLessThan(cards[1].x);
    expect(cards[0].y).toBeCloseTo(cards[1].y, 6);
    // Rangée 1 en dessous.
    expect(cards[2].y).toBeGreaterThan(cards[0].y);
    expect(cards[2].x).toBeCloseTo(cards[0].x, 6);
  });

  it('les deux colonnes encadrent le centre du rail', () => {
    const { cards } = rail(2);
    expect(cards[0].x).toBeCloseTo(-cards[1].x, 6);
  });

  it('un compte impair laisse la dernière rangée à une carte', () => {
    const { cards } = rail(5);
    expect(cards[4].x).toBeCloseTo(cards[0].x, 6);
    expect(cards[4].y).toBeGreaterThan(cards[2].y);
  });

  it('la rangée du dessous passe AU-DESSUS', () => {
    const z = rail(6).cards.map(c => c.zIndex);
    expect(z).toEqual([0, 0, 1, 1, 2, 2]);
  });
});

describe('railLayout — la place', () => {
  it('une carte ne dépasse jamais de sa colonne', () => {
    for (let n = 1; n <= 40; n++) {
      const r = rail(n);
      expect(r.boundsWidth, `${n} cartes`).toBeLessThanOrEqual(RAIL_W + 0.5);
    }
  });

  it('ça tient dans la hauteur, ou `overflow` le dit', () => {
    for (let n = 1; n <= 80; n++) {
      const r = rail(n);
      if (!r.overflow) expect(r.boundsHeight, `${n} cartes`).toBeLessThanOrEqual(RAIL_H + 0.5);
    }
  });

  it('peu de cartes : taille pleine et un interstice entre les rangées', () => {
    const r = rail(4);
    expect(r.scale).toBeCloseTo(1, 6);
    expect(r.pitch).toBeGreaterThan((84 / CARD_ASPECT) * r.scale);
  });

  it('rail court : les rangées se resserrent avant que la taille ne cède', () => {
    const serre = rail(12, 300);
    expect(serre.pitch).toBeLessThan(rail(4).pitch);
  });
});

describe('railLayout — la place doit être exploitée aussi', () => {
  it('dès que la hauteur contraint, le rail est REMPLI', () => {
    for (let n = 10; n <= 30; n++) {
      const r = rail(n);
      expect(r.overflow, `${n} cartes`).toBe(false);
      expect(r.boundsHeight, `${n} cartes`).toBeGreaterThan(RAIL_H - 2);
    }
  });

  it('un rail web avale au moins 40 cartes', () => {
    let n = 0;
    while (n < 500 && !rail(n + 1).overflow) n++;
    expect(n).toBeGreaterThanOrEqual(40);
  });
});

describe('railJitter — semé, jamais tiré', () => {
  it('le même index donne toujours le même bruit', () => {
    expect(railJitter(7)).toBe(railJitter(7));
    // ⚠️ Sans ça, chaque re-render redresserait les cartes sous les doigts.
    expect(rail(9).cards.map(c => c.rotZ)).toEqual(rail(9).cards.map(c => c.rotZ));
  });

  it('reste dans [-1, 1] et ne rend pas toujours la même chose', () => {
    const vals = Array.from({ length: 20 }, (_, i) => railJitter(i));
    for (const v of vals) expect(Math.abs(v)).toBeLessThanOrEqual(1);
    expect(new Set(vals).size).toBeGreaterThan(10);
  });

  it('la rotation de pile reste discrète', () => {
    for (const c of rail(20).cards) expect(Math.abs(c.rotZ)).toBeLessThanOrEqual(RAIL_JITTER_DEG);
  });
});
