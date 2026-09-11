/* eslint-disable @typescript-eslint/no-explicit-any */
// ÉTAPE 4 — `pouvoir_utilise`, le second trigger neuf.
//
// Le §3.5 le donnait comme « point de branchement présent, AUCUN effet ». Le
// point existait en effet : `CombatManager` sait exactement quand un pouvoir
// part, puisqu'il vide la jauge juste après.
//
// ⚠️ **C'est le seul trigger de ce lot qui vive dans la BOUCLE DE COMBAT**, là
// où une divergence coûte un duel aux deux joueurs. Deux garde-fous, tous deux
// repris de `onUnitNeutralized` plutôt qu'inventés :
//   • les paliers sont ceux VERROUILLÉS au début du combat — un pouvoir qui part
//     au tick 200 ne doit pas voir un palier que les morts ont défait ;
//   • les écritures ressortent en `stat_change`, depuis le JOURNAL du moteur et
//     jamais d'une seconde lecture de la donnée.
//
// ⚠️ Et le §4.3 tient : la boucle NOMME un moment, elle ne connaît aucun effet.
// Les tâches entrent dans le moteur, l'ordonnanceur n'y entre pas.
import { describe, it, expect } from 'vitest';
import { AttributeManager } from '../logic/AttributeManager.js';
import { compileAttribute } from '../logic/effects/compile.js';
import { Board } from '../logic/Board.js';
import { CombatManager } from '../logic/CombatManager.js';
import { Unit } from '../logic/Unit.js';
import { makeCard } from './helpers.js';

const ARCH = 'ARCH_POW';

const attribut = (extra: Record<string, unknown> = {}) => ({
  id: ARCH, name: 'Test', categorie: 'Archetype', timing: 'start_of_combat',
  thresholds: [{ count: 1, effects: [{ type: 'stat_bonus', stat: 'atk', value: 10, timing: 'on_power_fired', ...extra }] }],
});

const carte = (id: string, over: Record<string, unknown> = {}) => makeCard({
  id, tier: 1, attributes: [ARCH],
  stats: { atk: 5, hp: 500, movement_rate: 100, attack_rate: 100, range: 5 },
  ...over,
});

/** Une unité avec un pouvoir qui part au premier tick possible. */
function unite(id: string, side: 'player' | 'enemy', pouvoir: unknown = null) {
  const c = carte(id, pouvoir ? { power: pouvoir } : {});
  return new (Unit as any)(c, side);
}

// ───────────────────────────────────────────────────────────────────────────

describe('pouvoir_utilise — la donnée le dit', () => {
  it('compile sur les trois types qui visent des unités', () => {
    for (const type of ['stat_bonus', 'shield', 'effect_immunity']) {
      const effets = [{ type, stat: 'atk', value: 10, timing: 'on_power_fired' }];
      const { effets: out, refus } = compileAttribute(
        { id: ARCH, timing: 'start_of_combat', thresholds: [{ count: 1, effects: effets as any }] } as any,
        new Set([ARCH]),
      );
      expect(refus, type).toEqual([]);
      expect(out[0].trigger.quand).toBe('pouvoir_utilise');
    }
  });

  // ⚠️ Une ressource de fin de combat n'a rien à faire au moment où un pouvoir
  // part : elle se verse une fois le combat résolu. C'est la règle qui a tué
  // onze effets, tenue sur un moment de plus.
  it('REFUSE une ressource de fin de combat à ce moment', () => {
    const { refus } = compileAttribute(
      { id: ARCH, timing: 'end_of_combat', thresholds: [{ count: 1, effects: [{ type: 'draw_bonus', value: 1, timing: 'on_power_fired' }] as any }] } as any,
      new Set([ARCH]),
    );
    expect(refus[0].raison).toBe('moment impossible');
  });

  // ⚠️ `AttributeManager` est reconstruit à chaque combat : il pourrait tenir un
  // `une_fois_par_combat`, jamais un `une_fois_par_partie`. Offrir la moitié
  // d'une table serait pire que rien — donc la portée est refusée ici, entière.
  it('REFUSE une portée : personne n’y tient le compte', () => {
    const { refus } = compileAttribute(attribut({ portee: 'une_fois_par_combat' }) as any, new Set([ARCH]));
    expect(refus[0].raison).toBe('portée sans mémoire');
  });
});

describe('pouvoir_utilise — dans un vrai combat', () => {
  /** Deux unités face à face, l'alliée portant un pouvoir prêt à partir. */
  function combat(pouvoir: unknown, attrs: any[] = [attribut()]) {
    const board = new (Board as any)();
    const moi = unite('C1', 'player', pouvoir);
    const lui = unite('C2', 'enemy');
    board.placeUnit(moi, { col: 2, row: 3 });
    board.placeUnit(lui, { col: 2, row: 7 });
    const mgr = new (AttributeManager as any)(attrs, [moi], [lui]);
    mgr.applyStartOfCombat();
    const cm = new (CombatManager as any)(board, [moi], [lui], mgr);
    return { cm, moi, lui };
  }

  // ⚠️ Le champ de la CARTE est `power.id`, pas `power.power_id` — et
  // `power.power_rate`, pas `power.rate`. Mal écrit, `Unit` garde son `null` et
  // AUCUN pouvoir ne part : le filet PvP a tourné un temps avec des pouvoirs
  // muets pour cette raison exacte (§Tests).
  const SUPER = { id: 'POWER_SUPER_ATTACK', power_rate: 100, value: 20 };

  it('un pouvoir qui part déclenche l’effet, et l’animateur le voit', () => {
    const { cm, moi } = combat(SUPER);
    const avant = moi.atk;
    let vus: any[] = [];
    for (let i = 0; i < 6 && !vus.length; i++) {
      vus = (cm.step() as any[]).filter(e => e.type === 'stat_change');
    }
    expect(vus.length).toBeGreaterThan(0);
    expect(vus[0]).toMatchObject({ stat: 'atk', value: 10 });
    expect(moi.atk).toBeGreaterThan(avant);
  });

  it('une unité SANS pouvoir ne déclenche rien', () => {
    const { cm } = combat(null);
    const vus: any[] = [];
    for (let i = 0; i < 10; i++) vus.push(...(cm.step() as any[]).filter(e => e.type === 'stat_change'));
    expect(vus).toEqual([]);
  });

  // ⚠️ Le camp est celui du LANCEUR : un pouvoir adverse ne doit pas nourrir les
  // attributs du joueur. C'est le sélecteur qui le dit, pas une branche — et
  // c'est exactement l'asymétrie qui a coûté un duel au §6.5.
  it('le pouvoir de l’ADVERSAIRE ne touche pas le camp joueur', () => {
    const board = new (Board as any)();
    const moi = unite('C1', 'player');
    const lui = unite('C2', 'enemy', SUPER);
    board.placeUnit(moi, { col: 2, row: 3 });
    board.placeUnit(lui, { col: 2, row: 7 });
    const mgr = new (AttributeManager as any)([attribut()], [moi], [lui]);
    mgr.applyStartOfCombat();
    const cm = new (CombatManager as any)(board, [moi], [lui], mgr);

    const avantMoi = moi.atk;
    for (let i = 0; i < 6; i++) cm.step();
    expect(moi.atk).toBe(avantMoi);
    expect(lui.atk).toBeGreaterThan(5);
  });

  // ⚠️ **UNE fois par pouvoir parti, pas deux.** Le trigger est posé sous la
  // même condition que la remise à zéro de la jauge (`fired !== false`) — et
  // c'est le seul témoin qu'on puisse en donner.
  //
  // ⚠️ Ce cas a d'abord prétendu prouver autre chose : « un pouvoir qui ÉCHOUE
  // ne déclenche rien », monté sur un téléport au contact. Il passait, et il ne
  // prouvait rien — un `_firePower` qui rend `false` est en fait INATTEIGNABLE
  // depuis ce site d'appel, `_isPowerRelevant` retenant déjà la charge dans
  // exactement les mêmes cas. La garde reste (elle est juste, et elle suit la
  // jauge), mais elle n'est pas observable, et un test ne doit pas faire croire
  // le contraire.
  it('un pouvoir parti déclenche l’effet UNE fois, pas deux', () => {
    const { cm } = combat(SUPER);
    let pouvoirs = 0;
    let changements = 0;
    for (let i = 0; i < 12; i++) {
      for (const e of cm.step() as any[]) {
        if (e.type === 'power') pouvoirs += 1;
        if (e.type === 'stat_change') changements += 1;
      }
    }
    expect(pouvoirs).toBeGreaterThan(1);
    expect(changements).toBe(pouvoirs);
  });
});
