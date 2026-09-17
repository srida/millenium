/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect } from 'vitest';
import { GameState, Phase } from '../logic/GameState.js';
import { tiersForRound } from '../logic/Draw.js';

describe('GameState — multiplicateurs', () => {
  it.each([
    [5, 1.0], [6, 1.0], [4, 1.2], [3, 1.5], [2, 2.0], [1, 3.0], [0, 3.0],
  ])('%i unités → ×%d', (count, expected) => {
    const gs = new (GameState as any)();
    gs.startCombat(count, 5);
    expect(gs.player_unit_multiplier).toBe(expected);
  });

  it('le multiplicateur final inclut le tour (unit_mult × round)', () => {
    const gs = new (GameState as any)();
    gs.round = 4;
    gs.startCombat(3, 5);
    expect(gs.player_multiplier).toBe(1.5 * 4);
    expect(gs.enemy_multiplier).toBe(1.0 * 4);
  });
});

describe('GameState — fin de combat', () => {
  it('victoire joueur : seuls les HP ennemis baissent', () => {
    const gs = new (GameState as any)();
    gs.startCombat(5, 5);
    gs.applyEndOfCombat('player', 40, 25);
    expect(gs.enemy_hp).toBe(1000 - 40);
    expect(gs.player_hp).toBe(1000);
    expect(gs.phase).toBe(Phase.END_ROUND);
  });

  it('timeout : les deux camps prennent des dégâts', () => {
    const gs = new (GameState as any)();
    gs.round = 2;
    gs.startCombat(3, 4); // player ×1.5×2=3, enemy ×1.2×2=2.4
    gs.applyEndOfCombat('timeout', 10, 10);
    expect(gs.enemy_hp).toBe(1000 - Math.round(10 * 3));
    expect(gs.player_hp).toBe(1000 - Math.round(10 * 2.4));
  });

  it('damage_multiplier_bonus (attribut) s\'ajoute au multiplicateur joueur', () => {
    const gs = new (GameState as any)();
    gs.startCombat(5, 5);
    gs.applyEndOfCombat('player', 20, 0, { damage_multiplier_bonus: 0.5 });
    expect(gs.enemy_hp).toBe(1000 - Math.round(20 * 1.5));
  });

  it('les HP sont clampés à 0', () => {
    const gs = new (GameState as any)();
    gs.startCombat(1, 5); // ×3
    gs.applyEndOfCombat('player', 500, 0);
    expect(gs.enemy_hp).toBe(0);
  });

  it('accumule extra draws, guaranteed draws et shopping bonus', () => {
    const gs = new (GameState as any)();
    gs.startCombat(5, 5);
    gs.applyEndOfCombat('player', 0, 0, {
      draw_bonus: 2,
      guaranteed_draws: [{ category: 'fusion', attribute: null }],
      shopping_bonus: 1,
    });
    expect(gs.player_extra_draws).toBe(2);
    expect(gs.player_guaranteed_draws).toEqual([{ category: 'fusion', attribute: null }]);
    expect(gs.player_extra_shopping_magies).toBe(1);
  });

  // ⚠️ Régression : `player_hp_bonus` d'attribut n'était versé nulle part.
  // Mutation : retirer le bloc `playerHpBonus` d'`applyEndOfCombat` → ROUGE
  // (le PV ne bouge plus, et l'invariant sum(sources)===bonus n'a plus rien à
  // vérifier).
  it('player_hp_bonus (attribut) crédite player_hp et le rend avec sa provenance', () => {
    const gs = new (GameState as any)();
    gs.startCombat(5, 5);
    const out = gs.applyEndOfCombat('draw', 0, 0, {
      player_hp_bonus: 30,
      player_hp_sources: [{ kind: 'attribut', ref: 'ARCH_X', value: 30 }],
    });
    expect(gs.player_hp).toBe(1000); // déjà au plafond, le gain est écrêté
    expect(out.playerHpBonus).toBe(30);
    expect(out.playerHpSources).toEqual([{ kind: 'attribut', ref: 'ARCH_X', value: 30 }]);
  });

  it('player_hp_bonus négatif (attribut) inflige et se clampe à 0', () => {
    const gs = new (GameState as any)();
    gs.player_hp = 20;
    gs.startCombat(5, 5);
    gs.applyEndOfCombat('draw', 0, 0, {
      player_hp_bonus: -50,
      player_hp_sources: [{ kind: 'attribut', ref: 'ARCH_X', value: -50 }],
    });
    expect(gs.player_hp).toBe(0);
  });

  // Le terrain crédite AVANT ce combat (`player_hp_sources` déjà posé) ; le
  // registre doit se cumuler avec la part attribut, puis se vider.
  it('cumule le PV posé par un terrain (avant) avec celui d\'un attribut (fin_combat)', () => {
    const gs = new (GameState as any)();
    gs.startCombat(5, 5);
    gs.player_hp = 900;
    gs.player_hp_sources.push({ kind: 'terrain', ref: 'BOARD_X', value: 10 });
    const out = gs.applyEndOfCombat('draw', 0, 0, {
      player_hp_bonus: 5,
      player_hp_sources: [{ kind: 'attribut', ref: 'ARCH_X', value: 5 }],
    });
    expect(gs.player_hp).toBe(915);
    expect(out.playerHpBonus).toBe(15);
    expect(out.playerHpSources).toEqual([
      { kind: 'terrain', ref: 'BOARD_X', value: 10 },
      { kind: 'attribut', ref: 'ARCH_X', value: 5 },
    ]);
    // Transitoire : vidé pour le combat suivant.
    expect(gs.player_hp_sources).toEqual([]);
  });

  // Pendant ENNEMI des mêmes deux champs — la pioche a un destinataire des
  // deux côtés, contrairement au Shopping (exclusivement joueur).
  it('accumule enemy_extra_draws et enemy_guaranteed_draws', () => {
    const gs = new (GameState as any)();
    gs.startCombat(5, 5);
    gs.applyEndOfCombat('player', 0, 0, {
      enemy_draw_bonus: 3,
      enemy_guaranteed_draws: [{ category: 'sacrifice', attribute: null }],
    });
    expect(gs.enemy_extra_draws).toBe(3);
    expect(gs.enemy_guaranteed_draws).toEqual([{ category: 'sacrifice', attribute: null }]);
    // Les champs joueur restent intouchés.
    expect(gs.player_extra_draws).toBe(0);
    expect(gs.player_guaranteed_draws).toEqual([]);
  });
});

describe('GameState — bonus de slot partagé (cap +1)', () => {
  it('Yeux bleus / Réaction en chaîne / Fission partagent un seul +1', () => {
    const gs = new (GameState as any)();
    expect(gs.grantLimitedBoardSlotBonus(1)).toBe(1);
    expect(gs.player_board_slots).toBe(6);
    // Deuxième source : cap atteint, rien accordé
    expect(gs.grantLimitedBoardSlotBonus(1)).toBe(0);
    expect(gs.player_board_slots).toBe(6);
  });
});

describe('GameState — tours et fin de partie', () => {
  it('nextRound incrémente et reset les multiplicateurs', () => {
    const gs = new (GameState as any)();
    gs.startCombat(2, 2);
    gs.applyEndOfCombat('player', 10, 0);
    expect(gs.nextRound()).toBe(Phase.PREPARATION);
    expect(gs.round).toBe(2);
    expect(gs.player_multiplier).toBe(1.0);
  });

  it('game over au tour 5 ou à 0 HP', () => {
    const gs = new (GameState as any)();
    gs.round = 5;
    expect(gs.nextRound()).toBe(Phase.GAME_OVER);

    const gs2 = new (GameState as any)();
    gs2.player_hp = 0;
    expect(gs2.isGameOver()).toBe(true);
    expect(gs2.getWinner()).toBe('enemy');
  });
});

describe('Draw — tiers par tour', () => {
  it.each([
    [1, [1]], [2, [1, 2]], [3, [1, 2, 3]], [4, [2, 3, 4]], [5, [3, 4, 5]], [6, [3, 4, 5]],
  ])('tour %i → tiers %j', (round, expected) => {
    expect(tiersForRound(round)).toEqual(expected);
  });
});
