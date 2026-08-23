/// <reference types="node" />
// Golden tests de `data/CardArt` — « quelle illustration pour cette carte ? ».
//
// Le module est minuscule mais il porte trois invariants dont le jeu dépend, et
// dont aucun ne se voit à l'écran quand il casse : on obtient une image d'origine
// là où on attendait une variante, ou pire, la variante d'un adversaire sur ses
// propres cartes. Il est pur et sans aucun import — c'est ce qui autorise
// `three/UnitCardEl.ts` à s'en servir sans traîner `data/` dans la couche de
// rendu, et c'est aussi ce qui le rend testable ici, dans une suite node sans
// jsdom.
//
// Les trois invariants :
//   1. REPLI SYSTÉMATIQUE sur `cardId`. Une variante supprimée du catalogue
//      entre-temps rend l'art d'origine, jamais un trou.
//   2. DEUX TABLES ÉTANCHES, une par camp. Les variantes de l'adversaire ne
//      doivent jamais habiller les cartes du joueur, ni l'inverse.
//   3. `setEnemyVariants(null)` PURGE. `GameController.dispose()` s'en sert pour
//      que l'art adverse ne fuite pas dans la partie suivante.
import { describe, it, expect, beforeEach } from 'vitest';
import { setPlayerVariants, setEnemyVariants, artFor } from '../data/CardArt.js';

// Le module porte un état de module : chaque test repart d'une table vide.
beforeEach(() => {
  setPlayerVariants(null);
  setEnemyVariants(null);
});

// ── 1. Repli ────────────────────────────────────────────────────────────────

describe('repli sur la carte', () => {
  it('rend l\'id de la carte quand aucune variante n\'est posée', () => {
    expect(artFor('CORE_001')).toBe('CORE_001');
    expect(artFor('CORE_001', 'enemy')).toBe('CORE_001');
  });

  it('rend l\'id de la carte pour une carte absente de la table', () => {
    setPlayerVariants({ CORE_001: 'VAR_001' });
    expect(artFor('CORE_002')).toBe('CORE_002');
  });

  it('rend la variante quand elle est posée', () => {
    setPlayerVariants({ CORE_001: 'VAR_001' });
    expect(artFor('CORE_001')).toBe('VAR_001');
  });

  it('traite `player` comme le camp par défaut', () => {
    setPlayerVariants({ CORE_001: 'VAR_001' });
    expect(artFor('CORE_001')).toBe(artFor('CORE_001', 'player'));
  });
});

// ── 2. Étanchéité des deux camps ────────────────────────────────────────────

describe('étanchéité des camps', () => {
  it('n\'habille pas les cartes du joueur avec les variantes de l\'adversaire', () => {
    setEnemyVariants({ CORE_001: 'VAR_ENEMY' });
    expect(artFor('CORE_001', 'player')).toBe('CORE_001');
    expect(artFor('CORE_001', 'enemy')).toBe('VAR_ENEMY');
  });

  it('n\'habille pas les cartes de l\'adversaire avec celles du joueur', () => {
    setPlayerVariants({ CORE_001: 'VAR_PLAYER' });
    expect(artFor('CORE_001', 'enemy')).toBe('CORE_001');
    expect(artFor('CORE_001', 'player')).toBe('VAR_PLAYER');
  });

  it('rend deux arts DIFFÉRENTS pour la même carte des deux côtés', () => {
    setPlayerVariants({ CORE_001: 'VAR_PLAYER' });
    setEnemyVariants({ CORE_001: 'VAR_ENEMY' });
    expect(artFor('CORE_001', 'player')).toBe('VAR_PLAYER');
    expect(artFor('CORE_001', 'enemy')).toBe('VAR_ENEMY');
  });
});

// ── 3. Purge ────────────────────────────────────────────────────────────────

describe('purge', () => {
  it('vide le camp adverse sur `null` — sinon l\'art fuiterait dans la partie suivante', () => {
    setEnemyVariants({ CORE_001: 'VAR_ENEMY' });
    setEnemyVariants(null);
    expect(artFor('CORE_001', 'enemy')).toBe('CORE_001');
  });

  it('laisse le camp JOUEUR intact quand on purge l\'adversaire', () => {
    // `GameController.dispose()` ne purge que l'adverse : les menus continuent
    // d'afficher les variantes du deck actif après la partie.
    setPlayerVariants({ CORE_001: 'VAR_PLAYER' });
    setEnemyVariants({ CORE_001: 'VAR_ENEMY' });
    setEnemyVariants(null);
    expect(artFor('CORE_001', 'player')).toBe('VAR_PLAYER');
  });

  it('traite `undefined` comme `null`', () => {
    setPlayerVariants({ CORE_001: 'VAR_PLAYER' });
    setPlayerVariants(undefined);
    expect(artFor('CORE_001')).toBe('CORE_001');
  });

  it('REMPLACE la table au lieu de la fusionner', () => {
    setPlayerVariants({ CORE_001: 'VAR_A', CORE_002: 'VAR_B' });
    setPlayerVariants({ CORE_001: 'VAR_C' });
    expect(artFor('CORE_001')).toBe('VAR_C');
    expect(artFor('CORE_002')).toBe('CORE_002');
  });
});

// ── Pureté ──────────────────────────────────────────────────────────────────

describe('pureté', () => {
  it('ne mute pas la table qu\'on lui confie', () => {
    const map = { CORE_001: 'VAR_001' };
    setPlayerVariants(map);
    artFor('CORE_001');
    artFor('CORE_002');
    expect(map).toEqual({ CORE_001: 'VAR_001' });
  });

  it('rend le même art à chaque appel', () => {
    setPlayerVariants({ CORE_001: 'VAR_001' });
    expect(artFor('CORE_001')).toBe(artFor('CORE_001'));
  });
});
