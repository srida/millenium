/* eslint-disable @typescript-eslint/no-explicit-any */
// `grant_keyword` — le type de magie qui ajoute un mot-clé à une unité.
//
// ⚠️ Le geste est le même que `grant_power` : une tâche `modifier` sur un
// champ DÉDIÉ (`mot_cle`, jamais un champ de stat) qui écrit directement sur
// `Unit`, ici `unit.attributes`, plutôt que dans un registre de combat. Une
// fois posé, le mot-clé reste jusqu'à la fin de la partie — `resetCombatStats`
// ne le touche pas — et `AttributeManager`, reconstruit à chaque combat, le
// relit comme n'importe quel attribut de catalogue.
import { describe, it, expect } from 'vitest';
import { executer, ressourcesVides } from '../logic/effects/engine.js';
import type { Monde } from '../logic/effects/engine.js';
import type { Effet } from '../logic/effects/types.js';
import { compileMagie } from '../logic/effects/compile.js';
import { Unit } from '../logic/Unit.js';
import { makeCard } from './helpers.js';
import { GameSession } from '../logic/GameSession.js';
import type { GameSessionDeps } from '../logic/GameSession.js';

const CARD = makeCard({ id: 'GK_CARD', attributes: [] });

function monde(extra: Partial<Monde> = {}): Monde {
  return { unitesAlliees: [], unitesEnnemies: [], ressources: ressourcesVides(), ...extra };
}

const grantEffet = (motCle: string): Effet => ({
  id: 'SRC#0', porteur: 'SRC',
  trigger: { quand: 'immediat' },
  taches: [{ action: 'modifier', cible: { conteneur: 'board', camp: 'allie', combien: 'un' }, champ: 'mot_cle', operateur: '=', valeur: 0, motCle } as any],
});

describe('moteur — modifier/mot_cle', () => {
  it('ajoute l’id à unit.attributes', () => {
    const u = new (Unit as any)(CARD, 'player') as Unit;
    const trace = executer([grantEffet('ARCH_TOUR')], 'immediat', monde({ unitesAlliees: [u] }));
    expect(u.attributes).toContain('ARCH_TOUR');
    expect(trace.applique).toEqual(['GK_CARD·mot_cle→ARCH_TOUR']);
  });

  it('idempotent — redonner un mot-clé déjà porté ne le duplique pas (« neant », pas une erreur)', () => {
    const u = new (Unit as any)(CARD, 'player') as Unit;
    u.attributes = [...u.attributes, 'ARCH_TOUR'];
    const trace = executer([grantEffet('ARCH_TOUR')], 'immediat', monde({ unitesAlliees: [u] }));
    expect(u.attributes.filter(a => a === 'ARCH_TOUR')).toHaveLength(1);
    expect(trace.applique).toEqual([]);
    expect(trace.neant).toHaveLength(1);
  });

  it('rend « ignore » — REFUS NOMMÉ — si aucun id n’est porté par la tâche', () => {
    const u = new (Unit as any)(CARD, 'player') as Unit;
    const effet: Effet = {
      id: 'SRC#0', porteur: 'SRC', trigger: { quand: 'immediat' },
      taches: [{ action: 'modifier', cible: { conteneur: 'board', camp: 'allie', combien: 'un' }, champ: 'mot_cle', operateur: '=', valeur: 0 } as any],
    };
    const trace = executer([effet], 'immediat', monde({ unitesAlliees: [u] }));
    expect(u.attributes).toEqual([]);
    expect(trace.ignore).toHaveLength(1);
  });
});

describe('compileMagie — grant_keyword', () => {
  it('compile en une tâche modifier/mot_cle, immédiate', () => {
    const { effets, refus } = compileMagie({ id: 'M', effect: { type: 'grant_keyword', attribute: 'ARCH_TOUR' } as any } as any);
    expect(refus).toEqual([]);
    expect(effets[0].trigger.quand).toBe('immediat');
    expect(effets[0].taches).toEqual([
      { action: 'modifier', cible: { conteneur: 'board', camp: 'allie', combien: 'un' }, champ: 'mot_cle', operateur: '=', valeur: 0, duree: 'partie', motCle: 'ARCH_TOUR' },
    ]);
  });

  it('refuse un mot-clé sans id, nommément', () => {
    const { effets, refus } = compileMagie({ id: 'M', effect: { type: 'grant_keyword' } as any } as any);
    expect(effets).toEqual([]);
    expect(refus).toHaveLength(1);
    expect(refus[0].raison).toBe('mot-clé sans id');
  });
});

describe('GameSession.applyMagieOnUnit — grant_keyword, bout en bout', () => {
  const MAGIE: any = { id: 'MAGIE_GK', name: 'Don de Tour', effect: { type: 'grant_keyword', attribute: 'ARCH_TOUR' } };

  function makeSession(overrides: Partial<GameSessionDeps> = {}): GameSession {
    const card = makeCard({ id: 'P1', summon_conditions: [] });
    const deps: GameSessionDeps = {
      cardsByTier: { 1: [card as any] },
      enemyDeck: {},
      attributeList: [],
      cardDb: { getCard: () => null },
      getAllBoards: () => [],
      getAllMagies: () => [MAGIE],
      rand: () => 0,
      ...overrides,
    };
    const session = new GameSession(deps);
    session.board.placeUnit(new (Unit as any)(card, 'player'), { col: 2, row: 2 });
    return session;
  }

  it('ajoute le mot-clé, permanent — survit à un combat (resetCombatStats ne le touche pas)', () => {
    const session = makeSession();
    const unit = session.board.getUnit({ col: 2, row: 2 })!;
    session.applyMagieOnUnit(MAGIE, unit);
    expect(unit.attributes).toContain('ARCH_TOUR');

    const { combat } = session.startCombat(null);
    while (!combat.isOver) combat.step();
    session.finishCombat();

    expect(unit.attributes).toContain('ARCH_TOUR');
  });

  // ⚠️ RÉGRESSION — le mot-clé donné doit produire un effet RÉEL au combat
  // suivant, exactement comme s'il figurait sur la carte : rouge si le moteur
  // écrivait ailleurs que sur `unit.attributes` (un champ qu'`AttributeManager`
  // ne relit jamais).
  it('le mot-clé donné déclenche son effet au combat suivant (Tour : immobile + portée)', () => {
    const TOUR: any = {
      id: 'ARCH_TOUR', name: 'Tour', categorie: 'MotCle', mot_cle: 'immobilite_de_test',
      thresholds: [{ count: 1, effects: [
        { type: 'immobile' },
        { type: 'stat_bonus', stat: 'range', value: 10 },
      ] }],
    };
    const session = makeSession({ attributeList: [TOUR] });
    const unit = session.board.getUnit({ col: 2, row: 2 })!;
    expect(unit.is_immobile).toBe(false);

    session.applyMagieOnUnit(MAGIE, unit);
    const { combat } = session.startCombat(null);
    combat.step();
    expect(unit.is_immobile).toBe(true);
    expect(unit.range).toBe(11);
  });
});
