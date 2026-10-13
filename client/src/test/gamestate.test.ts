/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect } from 'vitest';
import { GameState, Phase, PLAYER_HP_CAP } from '../logic/GameState.js';
import { tiersForRound } from '../logic/Draw.js';
import { applyBoardEffects } from '../logic/BoardEffect.js';

describe('GameState — multiplicateurs et joker', () => {
  it('500 PV au départ', () => {
    const gs = new (GameState as any)();
    expect(PLAYER_HP_CAP).toBe(500);
    expect(gs.player_hp).toBe(500);
    expect(gs.enemy_hp).toBe(500);
  });

  it('plus de facteur de tour : ×1 à tous les tours', () => {
    for (const round of [1, 3, 5]) {
      const gs = new (GameState as any)();
      gs.round = round;
      gs.startCombat();
      expect(gs.player_multiplier).toBe(1);
      expect(gs.enemy_multiplier).toBe(1);
      expect(gs.round_joker_factor).toBe(1);
    }
  });

  // Le joker multiplie les dégâts des DEUX camps, et deux jokers se multiplient.
  const roundWith = (pj: string | null, ej: string | null, winner = 'timeout') => {
    const gs = new (GameState as any)();
    gs.player_joker = pj; gs.enemy_joker = ej;
    gs.startCombat();
    gs.applyEndOfCombat(winner, 40, 20);
    return gs;
  };

  it('×2 posé par le joueur : il frappe double… et encaisse double', () => {
    const gs = roundWith('x2', null);
    expect(gs.enemy_hp).toBe(500 - 80);
    expect(gs.player_hp).toBe(500 - 40);
  });

  it('×0,5 posé par le joueur : il encaisse moitié… et frappe moitié', () => {
    const gs = roundWith('half', null);
    expect(gs.enemy_hp).toBe(500 - 20);
    expect(gs.player_hp).toBe(500 - 10);
  });

  it('×2 et ×2 font ×4, ×0,5 et ×0,5 font ×0,25, ×2 et ×0,5 se neutralisent', () => {
    expect(roundWith('x2', 'x2').round_joker_factor).toBe(4);
    expect(roundWith('x2', 'x2').enemy_hp).toBe(500 - 160);
    expect(roundWith('half', 'half').round_joker_factor).toBe(0.25);
    expect(roundWith('half', 'half').enemy_hp).toBe(500 - 10);
    expect(roundWith('x2', 'half').round_joker_factor).toBe(1);
    expect(roundWith('half', 'x2').enemy_hp).toBe(500 - 40);
  });

  it('le joker est joué au lancement du combat et ne revient pas', () => {
    const gs = new (GameState as any)();
    gs.player_joker = 'x2';
    expect(gs.canPlayJoker()).toBe(true);
    gs.startCombat();
    expect(gs.player_joker_used).toBe(true);
    gs.applyEndOfCombat('player', 10, 0);
    gs.nextRound();
    expect(gs.player_joker).toBe(null);
    expect(gs.round_joker_factor).toBe(1);
    expect(gs.canPlayJoker()).toBe(false);
  });

  it('applyEndOfCombat rend le facteur appliqué', () => {
    const gs = new (GameState as any)();
    gs.enemy_joker = 'half';
    gs.startCombat();
    expect(gs.applyEndOfCombat('enemy', 0, 30).jokerFactor).toBe(0.5);
    expect(gs.player_hp).toBe(500 - 15);
  });
});

describe('GameState — séries et réserve', () => {
  const run = (winners: string[]) => {
    const gs = new (GameState as any)();
    const gains = winners.map(w => gs.creditRoundOutcome(w).gain);
    return { gs, gains };
  };

  it('victoires : rien à la première, +2 à la deuxième, +3 ensuite', () => {
    const { gs, gains } = run(['player', 'player', 'player', 'player']);
    expect(gains).toEqual([0, 2, 3, 3]);
    expect(gs.player_energy_reserve).toBe(8);
  });

  it('défaites : +1 puis +2 ensuite', () => {
    const { gs, gains } = run(['enemy', 'enemy', 'enemy']);
    expect(gains).toEqual([1, 2, 2]);
    expect(gs.player_energy_reserve).toBe(5);
  });

  it('rompre une série remet son compteur à zéro', () => {
    const { gains } = run(['player', 'player', 'enemy', 'player', 'player']);
    expect(gains).toEqual([0, 2, 1, 0, 2]);
  });

  it('un nul ou un timeout rompt les deux séries et ne rapporte rien', () => {
    const { gs, gains } = run(['enemy', 'timeout', 'enemy', 'draw', 'player']);
    expect(gains).toEqual([1, 0, 1, 0, 0]);
    expect(gs.player_win_streak).toBe(1);
    expect(gs.player_loss_streak).toBe(0);
  });

  it('applyEndOfCombat verse la série et rend sa raison', () => {
    const gs = new (GameState as any)();
    gs.startCombat();
    const out = gs.applyEndOfCombat('enemy', 0, 10);
    expect(out.reserveGain).toBe(1);
    expect(out.reserveGainReason).toBe('loss');
    expect(gs.player_energy_reserve).toBe(1);
  });
});

describe('GameState — fin de combat', () => {
  it('victoire joueur : seuls les HP ennemis baissent', () => {
    const gs = new (GameState as any)();
    gs.startCombat();
    gs.applyEndOfCombat('player', 40, 25);
    expect(gs.enemy_hp).toBe(500 - 40);
    expect(gs.player_hp).toBe(500);
    expect(gs.phase).toBe(Phase.END_ROUND);
  });

  it('timeout : les deux camps prennent des dégâts', () => {
    const gs = new (GameState as any)();
    gs.round = 2;
    gs.startCombat(); // ×1 des deux côtés, à tous les tours
    gs.applyEndOfCombat('timeout', 10, 20);
    expect(gs.enemy_hp).toBe(500 - 10);
    expect(gs.player_hp).toBe(500 - 20);
  });

  it('damage_multiplier_bonus (attribut) s\'ajoute au multiplicateur joueur', () => {
    const gs = new (GameState as any)();
    gs.startCombat();
    gs.applyEndOfCombat('player', 20, 0, { damage_multiplier_bonus: 0.5 });
    expect(gs.enemy_hp).toBe(500 - Math.round(20 * 1.5));
  });

  it('les HP sont clampés à 0', () => {
    const gs = new (GameState as any)();
    gs.startCombat();
    gs.applyEndOfCombat('player', 1500, 0);
    expect(gs.enemy_hp).toBe(0);
  });

  it('accumule extra draws, guaranteed draws et shopping bonus', () => {
    const gs = new (GameState as any)();
    gs.startCombat();
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
    gs.startCombat();
    const out = gs.applyEndOfCombat('draw', 0, 0, {
      player_hp_bonus: 30,
      player_hp_sources: [{ kind: 'attribut', ref: 'ARCH_X', value: 30 }],
    });
    expect(gs.player_hp).toBe(500); // déjà au plafond, le gain est écrêté
    expect(out.playerHpBonus).toBe(30);
    expect(out.playerHpSources).toEqual([{ kind: 'attribut', ref: 'ARCH_X', value: 30 }]);
  });

  it('player_hp_bonus négatif (attribut) inflige et se clampe à 0', () => {
    const gs = new (GameState as any)();
    gs.player_hp = 20;
    gs.startCombat();
    gs.applyEndOfCombat('draw', 0, 0, {
      player_hp_bonus: -50,
      player_hp_sources: [{ kind: 'attribut', ref: 'ARCH_X', value: -50 }],
    });
    expect(gs.player_hp).toBe(0);
  });

  // Le terrain crédite AVANT ce combat, par `applyBoardEffects` ; le registre
  // doit se cumuler avec la part attribut dans le RÉCAPITULATIF, puis se vider.
  // ⚠️ Régression : la part terrain était reversée ici une seconde fois.
  // Mutation : verser `playerHpBonus` au lieu de la seule part attribut → ROUGE
  // (410 + 10 + 5 = 425).
  it('cumule le PV d\'un terrain (avant) et d\'un attribut (fin_combat) sans verser deux fois le terrain', () => {
    const gs = new (GameState as any)();
    gs.player_hp = 400;
    applyBoardEffects(
      { id: 'BOARD_X', name: 'B', effects: [{ type: 'player_hp_bonus', value: 10 }] } as any,
      { gameState: gs } as any
    );
    expect(gs.player_hp).toBe(410);
    gs.startCombat();
    const out = gs.applyEndOfCombat('draw', 0, 0, {
      player_hp_bonus: 5,
      player_hp_sources: [{ kind: 'attribut', ref: 'ARCH_X', value: 5 }],
    });
    expect(gs.player_hp).toBe(415);
    expect(out.playerHpBonus).toBe(15);
    expect(out.playerHpSources).toEqual([
      { kind: 'terrain', ref: 'BOARD_X', value: 10 },
      { kind: 'attribut', ref: 'ARCH_X', value: 5 },
    ]);
    // Transitoire : vidé pour le combat suivant.
    expect(gs.player_hp_sources).toEqual([]);
  });

  // ⚠️ Régression PvP : le gain/perte de PV d'attribut de l'adversaire n'était
  // versé nulle part — il se le versait chez lui, pas chez nous.
  // Mutation : retirer le bloc `enemyHpBonus` d'`applyEndOfCombat` → ROUGE.
  it('verse enemy_hp_bonus (attribut adverse) dans enemy_hp, écrêté', () => {
    const gs = new (GameState as any)();
    gs.startCombat();
    gs.enemy_hp = 300;
    gs.applyEndOfCombat('draw', 0, 0, { enemy_hp_bonus: -40 });
    expect(gs.enemy_hp).toBe(260);
    gs.startCombat();
    gs.applyEndOfCombat('draw', 0, 0, { enemy_hp_bonus: 500 });
    expect(gs.enemy_hp).toBe(500);
    expect(gs.player_hp).toBe(500);
  });

  // ⚠️ Régression PvP : le bonus PERMANENT de magie de l'adversaire (reçu du
  // réseau) n'entrait pas dans ses dégâts infligés.
  // Mutation : retirer `+ this.enemy_damage_multiplier_bonus` → ROUGE.
  it('le bonus de magie adverse entre dans enemyMultiplier, avec sa provenance', () => {
    const gs = new (GameState as any)();
    gs.enemy_damage_multiplier_bonus = 1.5;
    gs.enemy_multiplier_sources = [{ kind: 'magie', ref: 'MAGIC_X', value: 1.5 }];
    gs.startCombat();
    const out = gs.applyEndOfCombat('enemy', 0, 100, {
      enemy_damage_multiplier_bonus: 0.5,
      enemy_damage_multiplier_sources: [{ kind: 'attribut', ref: 'ARCH_X', value: 0.5 }],
    });
    expect(out.enemyMultiplier).toBe(1 + 0.5 + 1.5);
    expect(out.enemyDamageDealt).toBe(300);
    expect(gs.player_hp).toBe(200);
    expect(out.enemyMultiplierSources).toEqual([
      { kind: 'attribut', ref: 'ARCH_X', value: 0.5 },
      { kind: 'magie', ref: 'MAGIC_X', value: 1.5 },
    ]);
  });

  // Pendant ENNEMI des mêmes deux champs — la pioche a un destinataire des
  // deux côtés, contrairement au Shopping (exclusivement joueur).
  it('accumule enemy_extra_draws et enemy_guaranteed_draws', () => {
    const gs = new (GameState as any)();
    gs.startCombat();
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

describe('GameState — tours et fin de partie', () => {
  it('nextRound incrémente et reset les multiplicateurs', () => {
    const gs = new (GameState as any)();
    gs.startCombat();
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
