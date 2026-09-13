// Filet de caractérisation de `components/hand/handVisual` — la table d'état
// visuel et d'intention de tap des cartes de main et de cimetière.
//
// Il est écrit sur le comportement des vignettes 2D d'aujourd'hui (`HandBar` /
// `GraveyardTray` + `CardTile`), AVANT leur remplacement par les cartes 3D :
// c'est lui qui dit que « on conserve les logiques actuelles » a été tenu.
// D'où l'énumération EXHAUSTIVE des combinaisons plutôt qu'une poignée de cas
// choisis — une table de quatre booléens tient en seize lignes, et un cas non
// écrit est un cas qu'on peut casser sans le voir.
import { describe, it, expect } from 'vitest';
import {
  handTargetable, handCardVisual, handTapIntent, handVisible,
  graveyardCardVisual, graveyardTapIntent, graveyardVisible,
  type CardVisual, type CardTapIntent,
} from '../components/hand/handVisual.js';

const BOOLS = [false, true] as const;

function handEntry(playable: boolean, selected: boolean, count = 1) {
  return { idx: 3, count, playable, selected };
}

describe('handTargetable', () => {
  it('sans restriction, toute carte est une cible', () => {
    // ⚠️ `null` = « aucune restriction », pas « aucune cible » : c'est le cas de
    // trois magies de main sur cinq.
    expect(handTargetable(null, 0)).toBe(true);
    expect(handTargetable(null, 99)).toBe(true);
  });

  it('avec une liste, seuls les index nommés sont des cibles', () => {
    expect(handTargetable([1, 4], 4)).toBe(true);
    expect(handTargetable([1, 4], 2)).toBe(false);
  });

  it('une liste VIDE ne cible rien', () => {
    // Le cas qu'un `!handTargets?.length` aurait confondu avec `null`.
    expect(handTargetable([], 0)).toBe(false);
  });
});

describe('handCardVisual — table complète hors ciblage', () => {
  // Hors ciblage : le liseré dit la sélection d'invocation, l'extinction dit
  // « injouable », la levée sort la carte de sa bande.
  const CASES: { playable: boolean; selected: boolean; rail: boolean; want: Partial<CardVisual> }[] = [
    { playable: true,  selected: false, rail: false, want: { highlight: 'none',     dim: 'none',   lift: 'none' } },
    { playable: false, selected: false, rail: false, want: { highlight: 'none',     dim: 'strong', lift: 'none' } },
    { playable: true,  selected: true,  rail: false, want: { highlight: 'selected', dim: 'none',   lift: 'up' } },
    { playable: false, selected: true,  rail: false, want: { highlight: 'selected', dim: 'strong', lift: 'up' } },
    // Mode web : la carte retenue sort vers le board, donc à droite.
    { playable: true,  selected: true,  rail: true,  want: { highlight: 'selected', dim: 'none',   lift: 'right' } },
    { playable: true,  selected: false, rail: true,  want: { highlight: 'none',     dim: 'none',   lift: 'none' } },
  ];

  for (const c of CASES) {
    it(`jouable=${c.playable} retenue=${c.selected} rail=${c.rail}`, () => {
      const got = handCardVisual(handEntry(c.playable, c.selected), {
        targeting: false, targetable: true, rail: c.rail,
      });
      expect(got).toMatchObject(c.want);
    });
  }
});

describe('handCardVisual — table complète en ciblage de magie', () => {
  // ⚠️ En ciblage, la sélection d'invocation ne s'affiche plus : deux liserés
  // d'or pour deux questions différentes se liraient comme un seul.
  for (const targetable of BOOLS) {
    for (const selected of BOOLS) {
      for (const playable of BOOLS) {
        it(`cible=${targetable} retenue=${selected} jouable=${playable}`, () => {
          const got = handCardVisual(handEntry(playable, selected), {
            targeting: true, targetable, rail: false,
          });
          expect(got.highlight).toBe(targetable ? 'candidate' : 'none');
          expect(got.dim).toBe(targetable ? 'none' : 'strong');
          // La levée appartient à la sélection d'invocation : jamais en ciblage.
          expect(got.lift).toBe('none');
        });
      }
    }
  }

  it("l'extinction en ciblage ignore « jouable »", () => {
    // Une carte INJOUABLE mais recevable reste pleinement allumée : c'est
    // souvent celle qu'on veut envoyer au cimetière ou brûler.
    const got = handCardVisual(handEntry(false, false), { targeting: true, targetable: true, rail: false });
    expect(got.dim).toBe('none');
  });
});

describe('handCardVisual — regroupement', () => {
  it('un exemplaire ne porte ni badge ni épaisseur', () => {
    const got = handCardVisual(handEntry(true, false, 1), { targeting: false, targetable: true, rail: false });
    expect(got.badge).toBeNull();
    expect(got.stacked).toBe(false);
  });

  it('deux exemplaires ou plus portent le compte et la pile', () => {
    const got = handCardVisual(handEntry(true, false, 3), { targeting: false, targetable: true, rail: false });
    expect(got.badge).toBe(3);
    expect(got.stacked).toBe(true);
  });
});

describe('handTapIntent', () => {
  const CASES: { targeting: boolean; targetable: boolean; selected: boolean; want: CardTapIntent['kind'] }[] = [
    { targeting: false, targetable: true,  selected: false, want: 'select' },
    // ⚠️ Bascule : taper une carte déjà retenue la relâche.
    { targeting: false, targetable: true,  selected: true,  want: 'deselect' },
    // Hors ciblage, `targetable` ne veut rien dire — la carte reste tapable.
    { targeting: false, targetable: false, selected: false, want: 'select' },
    { targeting: true,  targetable: true,  selected: false, want: 'magie_target' },
    { targeting: true,  targetable: true,  selected: true,  want: 'magie_target' },
    // Une cible non recevable ne se laisse pas choisir pour rien.
    { targeting: true,  targetable: false, selected: false, want: 'none' },
    { targeting: true,  targetable: false, selected: true,  want: 'none' },
  ];

  for (const c of CASES) {
    it(`ciblage=${c.targeting} cible=${c.targetable} retenue=${c.selected} → ${c.want}`, () => {
      const entry = handEntry(true, c.selected);
      expect(handTapIntent(entry, { targeting: c.targeting, targetable: c.targetable, rail: false }).kind)
        .toBe(c.want);
    });
  }
});

describe('graveyardCardVisual', () => {
  const CASES: { candidate: boolean; selected: boolean; targeting: boolean; want: Partial<CardVisual> }[] = [
    { candidate: false, selected: false, targeting: false, want: { highlight: 'none',      dim: 'soft' } },
    { candidate: true,  selected: false, targeting: false, want: { highlight: 'candidate', dim: 'none' } },
    { candidate: false, selected: true,  targeting: false, want: { highlight: 'material',  dim: 'none' } },
    { candidate: true,  selected: true,  targeting: false, want: { highlight: 'material',  dim: 'none' } },
    // ⚠️ En ciblage, TOUTE unité du cimetière est sélectionnable : une magie
    // `revive` choisit dans le cimetière entier, là où une invocation ne voit
    // que ses matériaux légitimes.
    { candidate: false, selected: false, targeting: true,  want: { highlight: 'candidate', dim: 'none' } },
    { candidate: false, selected: true,  targeting: true,  want: { highlight: 'material',  dim: 'none' } },
  ];

  for (const c of CASES) {
    it(`candidat=${c.candidate} retenu=${c.selected} ciblage=${c.targeting}`, () => {
      expect(graveyardCardVisual({ candidate: c.candidate, selected: c.selected }, { targeting: c.targeting }))
        .toMatchObject(c.want);
    });
  }

  it('une unité neutralisée ne se lève ni ne se regroupe', () => {
    // Le cimetière est indexé par `uid` : deux exemplaires d'une même carte y
    // sont deux corps distincts, jamais une pile.
    const got = graveyardCardVisual({ candidate: true, selected: false }, { targeting: false });
    expect(got.lift).toBe('none');
    expect(got.badge).toBeNull();
    expect(got.stacked).toBe(false);
  });
});

describe('graveyardTapIntent', () => {
  it('hors ciblage, le tap bascule le matériau', () => {
    expect(graveyardTapIntent({ targeting: false }).kind).toBe('material');
  });

  it('en ciblage, le tap sert la magie', () => {
    expect(graveyardTapIntent({ targeting: true }).kind).toBe('magie_target');
  });
});

describe('handVisible', () => {
  const base = {
    hasController: true, combatActive: false, targetingHand: false,
    roundIntro: false, drawPopup: false,
  };

  it('visible en préparation', () => {
    expect(handVisible(base)).toBe(true);
  });

  it('rien tant que le contrôleur n’est pas monté', () => {
    expect(handVisible({ ...base, hasController: false })).toBe(false);
  });

  it('masquée pendant le combat', () => {
    expect(handVisible({ ...base, combatActive: true })).toBe(false);
  });

  it('⚠️ VISIBLE en ciblage de main MALGRÉ `combatActive`', () => {
    // La Phase Shopping a lieu APRÈS le combat, drapeau encore levé : sans
    // cette exception, aucune magie de main n'aurait de cible à désigner.
    expect(handVisible({ ...base, combatActive: true, targetingHand: true })).toBe(true);
  });

  it('⚠️ masquée sur l’ouverture de tour — anti-spoil de la popup de pioche', () => {
    // `session.hand` porte déjà les cartes du tour : sans cette garde, la bande
    // les affiche en clair SOUS la popup, avant le tap qui les révèle.
    expect(handVisible({ ...base, roundIntro: true })).toBe(false);
    expect(handVisible({ ...base, drawPopup: true })).toBe(false);
  });

  it('l’ouverture de tour masque même en ciblage de main', () => {
    expect(handVisible({ ...base, targetingHand: true, drawPopup: true })).toBe(false);
  });
});

describe('graveyardVisible', () => {
  const base = { hasController: true, combatActive: false, targetingGraveyard: false, count: 2 };

  it('visible en préparation dès qu’une unité y repose', () => {
    expect(graveyardVisible(base)).toBe(true);
  });

  it('un cimetière vide ne pose pas de bandeau vide', () => {
    expect(graveyardVisible({ ...base, count: 0 })).toBe(false);
  });

  it('rien tant que le contrôleur n’est pas monté', () => {
    expect(graveyardVisible({ ...base, hasController: false })).toBe(false);
  });

  it('masqué pendant le combat, sauf en ciblage revive', () => {
    expect(graveyardVisible({ ...base, combatActive: true })).toBe(false);
    expect(graveyardVisible({ ...base, combatActive: true, targetingGraveyard: true })).toBe(true);
  });

  it('⚠️ PAS masqué à l’ouverture de tour, contrairement à la main', () => {
    // Il ne montre que des unités déjà vues au combat précédent : aucune pioche
    // à divulguer. Le champ n'existe donc même pas dans son état de visibilité.
    expect(graveyardVisible({ ...base, count: 1 })).toBe(true);
  });
});
