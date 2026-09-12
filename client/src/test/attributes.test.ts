/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect } from 'vitest';
import { AttributeManager } from '../logic/AttributeManager.js';
import { guaranteedDrawCriteria } from '../logic/Draw.js';
import { GameState } from '../logic/GameState.js';
import { makeBoard, makeCard, spawn } from './helpers.js';

function units(board: any, defs: { id: string; attrs?: string[]; col: number; row: number; side?: 'player' | 'enemy' }[]) {
  return defs.map(d => spawn(board, makeCard({ id: d.id, attributes: d.attrs ?? [] }), d.side ?? 'player', { col: d.col, row: d.row }));
}

describe('AttributeManager — comptage des seuils', () => {
  it('deux exemplaires de la même carte comptent pour 1', () => {
    const attrs = [{
      id: 'ARCH_X', name: 'X', timing: 'start_of_combat',
      thresholds: [{ count: 2, effects: [{ type: 'stat_bonus', stat: 'atk', value: 5 }] }],
    }];
    const board = makeBoard();
    const [a, b] = units(board, [
      { id: 'SAME', attrs: ['ARCH_X'], col: 0, row: 0 },
      { id: 'SAME', attrs: ['ARCH_X'], col: 1, row: 0 },
    ]);
    const am = new (AttributeManager as any)(attrs, [a, b], []);
    am.applyStartOfCombat();
    // Seuil count:2 non atteint (1 carte distincte) → pas de bonus
    expect(a.atk).toBe(5);

    const board2 = makeBoard();
    const [c, d] = units(board2, [
      { id: 'CARD_A', attrs: ['ARCH_X'], col: 0, row: 0 },
      { id: 'CARD_B', attrs: ['ARCH_X'], col: 1, row: 0 },
    ]);
    const am2 = new (AttributeManager as any)(attrs, [c, d], []);
    am2.applyStartOfCombat();
    expect(c.atk).toBe(10);
    expect(d.atk).toBe(10);
  });

  it('value_per : bonus multiplié par les unités ENNEMIES portant l\'attribut', () => {
    // ⚠️ `ARCH_PREY` DOIT figurer dans la liste, même sans palier : depuis la
    // bascule, un `value_per` qui ne nomme aucun attribut CONNU ne compile pas
    // (c'est la garde contre `active_unit`, que le `<select>` de l'admin propose
    // et que le moteur ne sait pas lire — cf. §6.1). En jeu, `attributeList` est
    // toujours le catalogue entier ; ici la liste était synthétique et partielle.
    const attrs = [{
      id: 'ARCH_HUNTER', name: 'Chasseur', timing: 'start_of_combat',
      thresholds: [{ count: 1, effects: [{ type: 'stat_bonus', stat: 'atk', value: 3, value_per: 'ARCH_PREY' }] }],
    }, { id: 'ARCH_PREY', name: 'Proie', timing: 'none', thresholds: [] }];
    const board = makeBoard();
    const hunter = spawn(board, makeCard({ id: 'HUNTER', attributes: ['ARCH_HUNTER'] }), 'player', { col: 0, row: 0 });
    const prey1 = spawn(board, makeCard({ id: 'PREY_1', attributes: ['ARCH_PREY'] }), 'enemy', { col: 0, row: 7 });
    const prey2 = spawn(board, makeCard({ id: 'PREY_2', attributes: ['ARCH_PREY'] }), 'enemy', { col: 1, row: 7 });
    const am = new (AttributeManager as any)(attrs, [hunter], [prey1, prey2]);
    am.applyStartOfCombat();
    expect(hunter.atk).toBe(5 + 3 * 2);
  });

  it('shield : valeur × alliés vivants', () => {
    const attrs = [{
      id: 'ARCH_GUARD', name: 'Garde', timing: 'start_of_combat',
      thresholds: [{ count: 1, effects: [{ type: 'shield', value: 8 }] }],
    }];
    const board = makeBoard();
    const g = spawn(board, makeCard({ id: 'G', attributes: ['ARCH_GUARD'] }), 'player', { col: 0, row: 0 });
    units(board, [{ id: 'A1', col: 1, row: 0 }, { id: 'A2', col: 2, row: 0 }]);
    const allUnits = board.getUnitsOnSide('player');
    const am = new (AttributeManager as any)(attrs, allUnits, []);
    am.applyStartOfCombat();
    expect(g.shield).toBe(8 * 3);
  });
});

describe('AttributeManager — seuils during_combat verrouillés', () => {
  const attrs = [{
    id: 'ARCH_RAGE', name: 'Rage', timing: 'during_combat',
    thresholds: [{ count: 2, effects: [{ type: 'stat_modifier', stat: 'atk', value: 4, trigger: 'on_ally_neutralized' }] }],
  }];

  it('les morts en cours de combat ne désactivent pas un seuil déjà actif', () => {
    const board = makeBoard();
    const [r1, r2, bait] = units(board, [
      { id: 'R1', attrs: ['ARCH_RAGE'], col: 0, row: 0 },
      { id: 'R2', attrs: ['ARCH_RAGE'], col: 1, row: 0 },
      { id: 'BAIT', col: 2, row: 0 },
    ]);
    // Même référence de tableau pour le constructeur et l'appel : AttributeManager
    // identifie le côté par identité de référence (comme le fait CombatManager).
    const playerUnits = [r1, r2, bait];
    const am = new (AttributeManager as any)(attrs, playerUnits, []);
    am.applyStartOfCombat();

    // R2 meurt : le compte vivant tombe à 1, mais le seuil reste verrouillé
    r2.is_neutralized = true;
    const events = am.onUnitNeutralized(r2, playerUnits, []);
    expect(r1.atk).toBe(5 + 4);
    expect(events.filter((e: any) => e.type === 'stat_change')).toHaveLength(1); // r1 seul (r2 mort)
  });

  it('un seuil non atteint au start ne se déclenche jamais', () => {
    const board = makeBoard();
    const [r1, bait] = units(board, [
      { id: 'R1', attrs: ['ARCH_RAGE'], col: 0, row: 0 },
      { id: 'BAIT', col: 2, row: 0 },
    ]);
    const playerUnits = [r1, bait];
    const am = new (AttributeManager as any)(attrs, playerUnits, []);
    am.applyStartOfCombat();
    bait.is_neutralized = true;
    am.onUnitNeutralized(bait, playerUnits, []);
    expect(r1.atk).toBe(5);
  });
});

describe('AttributeManager — end_of_combat', () => {
  it('compte vivants + neutralisés ; revive restaure la première unité morte', () => {
    const attrs = [{
      id: 'ARCH_NECRO', name: 'Nécro', timing: 'end_of_combat',
      thresholds: [{ count: 2, effects: [{ type: 'revive', hp_percent: 30 }, { type: 'draw_bonus', value: 1 }] }],
    }];
    const board = makeBoard();
    const [n1, n2] = units(board, [
      { id: 'N1', attrs: ['ARCH_NECRO'], col: 0, row: 0 },
      { id: 'N2', attrs: ['ARCH_NECRO'], col: 1, row: 0 },
    ]);
    // N2 est mort pendant le combat — il compte quand même pour le seuil
    n2.is_neutralized = true;
    n2.current_hp = 0;

    const am = new (AttributeManager as any)(attrs, [n1, n2], []);
    const neutralized = [n2];
    const result = am.applyEndOfCombat(neutralized, []);

    expect(result.revived).toEqual([n2]);
    expect(n2.is_neutralized).toBe(false);
    expect(n2.current_hp).toBe(Math.floor(n2.max_hp * 0.3));
    expect(neutralized).toHaveLength(0); // retirée de la liste des morts
    expect(result.draw_bonus).toBe(1);
  });

  // La pioche a un destinataire des DEUX côtés (`EnemyAI` pioche aussi),
  // contrairement à l'emplacement, au multiplicateur et au Shopping —
  // ressources exclusivement joueur, cf. les trois tests suivants.
  it('draw_bonus côté ENNEMI crédite enemy_draw_bonus, pas draw_bonus', () => {
    const attrs = [{
      id: 'ARCH_SCOUT', name: 'Éclaireur', timing: 'end_of_combat',
      thresholds: [{ count: 1, effects: [{ type: 'draw_bonus', value: 2 }] }],
    }];
    const board = makeBoard();
    const [e1] = units(board, [{ id: 'E1', attrs: ['ARCH_SCOUT'], col: 0, row: 7, side: 'enemy' }]);
    const am = new (AttributeManager as any)(attrs, [], [e1]);
    const result = am.applyEndOfCombat([], []);

    expect(result.enemy_draw_bonus).toBe(2);
    expect(result.draw_bonus).toBe(0);
    // Rien n'affiche la provenance de la pioche adverse.
    expect(result.draw_sources).toEqual([]);
  });

  // ⚠️ Un effet d'attribut et une magie du même type alimentent la MÊME file et
  // sont résolus par le même `Draw.resolveGuaranteedDraws` : leur donner deux
  // pouvoirs d'expression, c'était laisser l'attribut ne savoir promettre qu'un
  // attribut, là où la magie sait nommer un tier et des cartes.
  // Mutation : ne recopier que `effect.attribute` dans le push → ROUGE.
  it('guaranteed_draw d’attribut porte les MÊMES critères qu’une magie', () => {
    const attrs = [{
      id: 'ARCH_ORACLE', name: 'Oracle', timing: 'end_of_combat',
      thresholds: [{
        count: 1,
        effects: [{
          type: 'guaranteed_draw',
          tier: 4,
          attributes: ['ARCH_003', 'ARCH_009'],
          card_ids: ['CORE_001', 'CORE_002'],
        }],
      }],
    }];
    const board = makeBoard();
    const [p1] = units(board, [{ id: 'P1', attrs: ['ARCH_ORACLE'], col: 0, row: 0 }]);
    const am = new (AttributeManager as any)(attrs, [p1], []);
    const result = am.applyEndOfCombat([], []);

    expect(result.guaranteed_draws).toEqual([{
      tier: 4,
      attribute: null,
      attributes: ['ARCH_003', 'ARCH_009'],
      card_ids: ['CORE_001', 'CORE_002'],
    }]);
    // Et ces critères se relisent EXACTEMENT comme ceux d'une magie.
    expect(guaranteedDrawCriteria(result.guaranteed_draws[0])).toEqual({
      tier: 4,
      attributes: ['ARCH_003', 'ARCH_009'],
      cardIds: ['CORE_001', 'CORE_002'],
    });
  });

  it('guaranteed_draw côté ENNEMI alimente enemy_guaranteed_draws, pas guaranteed_draws', () => {
    const attrs = [{
      id: 'ARCH_FORGE', name: 'Forge', timing: 'end_of_combat',
      thresholds: [{ count: 1, effects: [{ type: 'guaranteed_draw', attribute: 'ARCH_086' }] }],
    }];
    const board = makeBoard();
    const [e1] = units(board, [{ id: 'E1', attrs: ['ARCH_FORGE'], col: 0, row: 7, side: 'enemy' }]);
    const am = new (AttributeManager as any)(attrs, [], [e1]);
    const result = am.applyEndOfCombat([], []);

    expect(result.enemy_guaranteed_draws).toEqual([{ attribute: 'ARCH_086' }]);
    expect(result.guaranteed_draws).toEqual([]);
  });

  // Cap partagé (slot), dégâts (multiplicateur) et Shopping restent
  // exclusivement JOUEUR : l'IA n'a ni Phase Shopping ni cap de slot dérivé de
  // l'attribut, et le multiplicateur d'attribut est volontairement asymétrique
  // (contrat de déterminisme PvP, cf. CLAUDE.md « damage_multiplier_bonus »).
  it('board_slot_bonus / damage_multiplier_bonus / shopping_bonus côté ENNEMI ne donnent rien', () => {
    const attrs = [
      { id: 'ARCH_SLOT', name: 'S', timing: 'end_of_combat', thresholds: [{ count: 1, effects: [{ type: 'board_slot_bonus', value: 1 }] }] },
      { id: 'ARCH_DMG', name: 'D', timing: 'end_of_combat', thresholds: [{ count: 1, effects: [{ type: 'damage_multiplier_bonus', value: 2 }] }] },
      { id: 'ARCH_SHOP', name: 'H', timing: 'end_of_combat', thresholds: [{ count: 1, effects: [{ type: 'shopping_bonus', value: 1 }] }] },
    ];
    const board = makeBoard();
    const [e1, e2, e3] = units(board, [
      { id: 'E1', attrs: ['ARCH_SLOT'], col: 0, row: 7, side: 'enemy' },
      { id: 'E2', attrs: ['ARCH_DMG'], col: 1, row: 7, side: 'enemy' },
      { id: 'E3', attrs: ['ARCH_SHOP'], col: 2, row: 7, side: 'enemy' },
    ]);
    const am = new (AttributeManager as any)(attrs, [], [e1, e2, e3]);
    const result = am.applyEndOfCombat([], []);

    expect(result.board_slot_bonus).toBe(0);
    expect(result.damage_multiplier_bonus).toBe(0);
    expect(result.shopping_bonus).toBe(0);
  });
});

describe('AttributeManager — reapplyBonuses (POWER_DEBUFF)', () => {
  it('ré-applique les bonus start_of_combat après un reset', () => {
    const attrs = [{
      id: 'ARCH_W', name: 'W', timing: 'start_of_combat',
      thresholds: [{ count: 1, effects: [{ type: 'stat_bonus', stat: 'atk', value: 6 }] }],
    }];
    const board = makeBoard();
    const u = spawn(board, makeCard({ id: 'W1', attributes: ['ARCH_W'] }), 'player', { col: 0, row: 0 });
    const am = new (AttributeManager as any)(attrs, [u], []);
    am.applyStartOfCombat();
    expect(u.atk).toBe(11);

    u.resetCombatStats(); // POWER_DEBUFF
    expect(u.atk).toBe(5);
    am.reapplyBonuses(u);
    expect(u.atk).toBe(11);
  });
});

describe('AttributeManager — getActiveSynergies', () => {
  it('retourne compte, palier actif et palier suivant, trié par compte', () => {
    const attrs = [
      {
        id: 'ARCH_A', name: 'A', timing: 'start_of_combat',
        thresholds: [
          { count: 1, effects: [{ type: 'stat_bonus', stat: 'atk', value: 1 }] },
          { count: 3, effects: [{ type: 'stat_bonus', stat: 'atk', value: 3 }] },
        ],
      },
      { id: 'ARCH_VIDE', name: 'Archétype sans effet', timing: 'start_of_combat', thresholds: [] },
    ];
    const board = makeBoard();
    const list = units(board, [
      { id: 'U1', attrs: ['ARCH_A'], col: 0, row: 0 },
      { id: 'U2', attrs: ['ARCH_A', 'ARCH_VIDE'], col: 1, row: 0 },
    ]);
    const am = new (AttributeManager as any)(attrs, list, []);
    const syn = am.getActiveSynergies(list);

    expect(syn).toHaveLength(1); // ARCH_VIDE (sans thresholds) exclu
    expect(syn[0].count).toBe(2);
    expect(syn[0].activeThreshold.count).toBe(1);
    expect(syn[0].nextThreshold.count).toBe(3);
  });
});

describe('AttributeManager — le partage joueur / adverse des ressources', () => {
  // ⚠️ **CE cas ferme un trou de couverture réel.** Deux attributs du catalogue
  // seulement portent une ressource joueur-seul (`ARCH_017`, `ARCH_027`), et
  // aucun scénario livré ne les fait tomber du côté ADVERSE — si bien que
  // supprimer l'asymétrie entière (`ressourcesLimitees`) ne faisait rougir
  // AUCUN test. Deux chemins qui ne donnent rien à personne sont d'accord, et
  // cet accord ne prouve rien : c'est le même piège que les pools de tirage des
  // magies et que les remises sans carte porteuse.
  //
  // La règle : la PIOCHE a un destinataire des deux côtés (l'IA pioche aussi) ;
  // l'emplacement, le multiplicateur et le Shopping n'en ont qu'un.
  // Mutation : `ressourcesLimitees: false` côté adverse → ROUGE.
  const ATTRS = [{
    id: 'ARCH_RES', name: 'Ressources', timing: 'end_of_combat',
    thresholds: [{
      count: 1,
      effects: [
        { type: 'draw_bonus', value: 2 },
        { type: 'board_slot_bonus', value: 1 },
        { type: 'damage_multiplier_bonus', value: 3 },
        { type: 'shopping_bonus', value: 2 },
        { type: 'guaranteed_draw', tier: 3 },
      ],
    }],
  }];

  function joue(side: 'player' | 'enemy') {
    const board = makeBoard();
    const list = units(board, [{ id: 'PORTEUR', attrs: ['ARCH_RES'], col: 0, row: side === 'player' ? 0 : 7, side }]);
    const am = new (AttributeManager as any)(
      ATTRS, side === 'player' ? list : [], side === 'enemy' ? list : [],
    );
    am.applyStartOfCombat();
    return am.applyEndOfCombat([], []);
  }

  it('le camp du JOUEUR reçoit les quatre ressources et la pioche garantie', () => {
    const r = joue('player');
    expect(r.draw_bonus).toBe(2);
    expect(r.board_slot_bonus).toBe(1);
    expect(r.damage_multiplier_bonus).toBe(3);
    expect(r.shopping_bonus).toBe(2);
    expect(r.guaranteed_draws).toHaveLength(1);
    // La provenance voyage AVEC le crédit — l'invariant de `draw-summary`.
    expect(r.draw_sources.filter((s: any) => !s.guaranteed)
      .reduce((n: number, s: any) => n + s.value, 0)).toBe(r.draw_bonus);
  });

  // ⚠️ **Décision 3 du §7, branchée à l'étape 4 : l'IA porte ses effets comme un
  // vrai joueur.** Ce cas disait auparavant « le camp adverse ne reçoit QUE la
  // pioche » ; il dit maintenant ce qui a un DESTINATAIRE de ce côté. Deux
  // ressources en ont un — l'emplacement de plateau (`placeFromHand` le lit) et
  // le multiplicateur de dégâts ; le Shopping n'en a pas, et ce n'est pas une
  // limite du moteur mais un fait du jeu.
  it('le camp ADVERSE reçoit tout ce qui a un destinataire chez lui', () => {
    const r = joue('enemy');
    expect(r.enemy_draw_bonus).toBe(2);
    expect(r.enemy_guaranteed_draws).toHaveLength(1);
    expect(r.enemy_board_slot_bonus).toBe(1);
    expect(r.enemy_damage_multiplier_bonus).toBe(3);
    // ⚠️ Et rien ne fuit vers le joueur : ni sa pioche, ni son emplacement, ni
    // son multiplicateur, ni sa provenance. C'est le sélecteur `camp` qui le
    // tient, plus une exception écrite dans le moteur.
    expect(r.draw_bonus).toBe(0);
    expect(r.board_slot_bonus).toBe(0);
    expect(r.damage_multiplier_bonus).toBe(0);
    expect(r.guaranteed_draws).toEqual([]);
    expect(r.draw_sources).toEqual([]);
  });

  // ⚠️ La provenance de pioche reste un champ du JOUEUR — mais parce que le
  // versement ne la publie que de ce côté, plus parce que le moteur refuse de
  // l'inscrire. Le drapeau qui le faisait (`sansProvenance`, reste de
  // `ressourcesLimitees`) a été RETIRÉ : rien ne lit `adverse.sources`, donc
  // aucune mutation ne le faisait rougir. Un garde qu'on ne peut pas éprouver
  // est un garde qu'on retire.
  it('la provenance de pioche n’est publiée QUE pour le joueur', () => {
    expect(joue('enemy').draw_sources).toEqual([]);
    expect(joue('player').draw_sources.length).toBeGreaterThan(0);
  });
});

describe('GameState — le versement des ressources adverses', () => {
  const resultat = (extra: Record<string, unknown>) => ({
    revived: [], enemyRevived: [], guaranteed_draws: [], draw_sources: [], ...extra,
  });

  it('le multiplicateur adverse s’ajoute aux dégâts du round, comme celui du joueur', () => {
    const gs = new (GameState as any)();
    gs.startCombat(5, 5);
    const avant = gs.player_hp;
    gs.applyEndOfCombat('enemy', 0, 10, resultat({}));
    const sansBonus = avant - gs.player_hp;

    const gs2 = new (GameState as any)();
    gs2.startCombat(5, 5);
    gs2.applyEndOfCombat('enemy', 0, 10, resultat({ enemy_damage_multiplier_bonus: 2 }));
    expect(avant - gs2.player_hp).toBe(sansBonus + 20);
  });

  // ⚠️ Le versement traverse bien `applyEndOfCombat` — appeler le `grant…`
  // directement prouverait le cap et PAS le branchement. La première version de
  // ce cas ne faisait que ça, et retirer l'appel de `GameState` la laissait
  // verte.
  it('l’emplacement adverse arrive jusqu’à `enemy_board_slots`', () => {
    const gs = new (GameState as any)();
    const avant = gs.enemy_board_slots;
    gs.applyEndOfCombat('player', 0, 0, resultat({ enemy_board_slot_bonus: 1 }));
    expect(gs.enemy_board_slots).toBe(avant + 1);
  });

  // ⚠️ DEUX compteurs de cap, un par camp : « +1 par camp sur toute la partie »,
  // pas « +1 en tout ». Un compteur partagé ferait qu'un attribut du joueur
  // fermerait la porte à l'IA, ce qu'aucune règle ne dit.
  it('le cap d’emplacement est PAR CAMP, pas partagé', () => {
    const gs = new (GameState as any)();
    expect(gs.grantLimitedBoardSlotBonus(1)).toBe(1);
    expect(gs.grantEnemyBoardSlotBonus(1)).toBe(1);
    // Chacun a consommé le sien, et seulement le sien.
    expect(gs.grantLimitedBoardSlotBonus(1)).toBe(0);
    expect(gs.grantEnemyBoardSlotBonus(1)).toBe(0);
    expect(gs.enemy_board_slots).toBe(gs.player_board_slots);
  });
});
