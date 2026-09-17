/* eslint-disable @typescript-eslint/no-explicit-any */
// `invoquer` (`summon_token`) — la HUITIÈME action du moteur (CLAUDE.md,
// section « Le moteur d'effets », et `effects-shadow.test.ts`).
//
// ⚠️ Elle diffère structurellement des sept autres : c'est la SEULE qui fait
// naître une entité qui n'existait nulle part avant — jamais une carte
// (`ajouter`), jamais une substitution sur une case déjà occupée
// (`remplacer`). Deux garanties, chacune éprouvée dans les deux sens :
//   1. Le moteur ne touche jamais `Board` lui-même — il délègue TOUT
//      (résolution du catalogue, tirage de la case, pose) à `Monde.invoquerToken`,
//      et se contente d'inscrire ce qui est rendu dans le bon tableau.
//   2. Sans cette dépendance câblée (tournoi, tutoriel, tout appelant qui ne
//      l'a pas encore), l'effet est un REFUS NOMMÉ (`trace.ignore`), jamais
//      une exception ni un silence.
import { describe, it, expect } from 'vitest';
import { executer, ressourcesVides } from '../logic/effects/engine.js';
import type { Monde } from '../logic/effects/engine.js';
import type { Effet } from '../logic/effects/types.js';
import { compileBoard, compileAttribute, compileMagie } from '../logic/effects/compile.js';
import { Unit } from '../logic/Unit.js';
import { makeCard } from './helpers.js';
import { GameSession } from '../logic/GameSession.js';
import type { GameSessionDeps } from '../logic/GameSession.js';

const TOKEN_DEF = { id: 'TOK_ESPRIT', name: 'Esprit', stats: { atk: 3, hp: 12, movement_rate: 80, attack_rate: 80, range: 1 } };

/** Un `invoquerToken` synthétique : pose sur `cellesLibres[sideReel]`, qui se vide au fur et à mesure. */
function invocateur(cellesLibres: Record<'player' | 'enemy', number>, catalogue: Record<string, any> = { [TOKEN_DEF.id]: TOKEN_DEF }) {
  return (sideReel: 'player' | 'enemy', tokenId: string): Unit | null => {
    const def = catalogue[tokenId];
    if (!def || cellesLibres[sideReel] <= 0) return null;
    cellesLibres[sideReel]--;
    return new (Unit as any)(def, sideReel);
  };
}

function monde(extra: Partial<Monde> = {}): Monde {
  return { unitesAlliees: [], unitesEnnemies: [], ressources: ressourcesVides(), ...extra };
}

const invoquerEffet = (camp: 'allie' | 'ennemi' = 'allie', tokenId = TOKEN_DEF.id): Effet => ({
  id: 'SRC#0', porteur: 'SRC',
  trigger: { quand: 'debut_combat' },
  taches: [{ action: 'invoquer', camp, tokenId }],
});

describe('invoquer — le moteur délègue tout à Monde.invoquerToken', () => {
  it('pousse le token rendu dans unitesAlliees quand camp=allie', () => {
    const alliees: Unit[] = [];
    const trace = executer([invoquerEffet('allie')], 'debut_combat', monde({
      unitesAlliees: alliees,
      invoquerToken: invocateur({ player: 1, enemy: 1 }),
      cotesReels: { allie: 'player', ennemi: 'enemy' },
    }));
    expect(alliees).toHaveLength(1);
    expect(alliees[0].card_id).toBe(TOKEN_DEF.id);
    expect(alliees[0].side).toBe('player');
    expect(trace.applique).toEqual(['invoque TOK_ESPRIT→player']);
  });

  it('pousse dans unitesEnnemies quand camp=ennemi, sur le côté réel qui lui correspond', () => {
    const alliees: Unit[] = [];
    const ennemies: Unit[] = [];
    executer([invoquerEffet('ennemi')], 'debut_combat', monde({
      unitesAlliees: alliees, unitesEnnemies: ennemies,
      invoquerToken: invocateur({ player: 1, enemy: 1 }),
      cotesReels: { allie: 'player', ennemi: 'enemy' },
    }));
    expect(alliees).toHaveLength(0);
    expect(ennemies).toHaveLength(1);
    expect(ennemies[0].side).toBe('enemy');
  });

  it('traduit correctement quand `allie` du monde vaut `enemy` en vrai (cas attribut ennemi)', () => {
    const alliees: Unit[] = [];
    executer([invoquerEffet('allie')], 'debut_combat', monde({
      unitesAlliees: alliees,
      invoquerToken: invocateur({ player: 1, enemy: 1 }),
      cotesReels: { allie: 'enemy', ennemi: 'player' },
    }));
    expect(alliees).toHaveLength(1);
    expect(alliees[0].side).toBe('enemy');
  });

  it('rend "neant" — pas d\'erreur — si le token est inconnu du catalogue', () => {
    const alliees: Unit[] = [];
    const trace = executer([invoquerEffet('allie', 'TOK_INCONNU')], 'debut_combat', monde({
      unitesAlliees: alliees,
      invoquerToken: invocateur({ player: 1, enemy: 1 }),
      cotesReels: { allie: 'player', ennemi: 'enemy' },
    }));
    expect(alliees).toHaveLength(0);
    expect(trace.neant).toHaveLength(1);
  });

  it('rend "neant" si le côté visé n\'a plus une seule case libre', () => {
    const alliees: Unit[] = [];
    const trace = executer([invoquerEffet('allie')], 'debut_combat', monde({
      unitesAlliees: alliees,
      invoquerToken: invocateur({ player: 0, enemy: 1 }),
      cotesReels: { allie: 'player', ennemi: 'enemy' },
    }));
    expect(alliees).toHaveLength(0);
    expect(trace.neant).toHaveLength(1);
  });

  it('rend "ignore" — REFUS NOMMÉ — si aucun invocateur n\'est câblé', () => {
    const trace = executer([invoquerEffet('allie')], 'debut_combat', monde());
    expect(trace.applique).toEqual([]);
    expect(trace.neant).toEqual([]);
    expect(trace.ignore).toHaveLength(1);
    expect(trace.ignore[0]).toContain('aucun invocateur');
  });

  it('RÉGRESSION — sans le branchement de cotesReels, l’effet ne doit PAS planter ni se poser en silence', () => {
    // Rouge si on "oublie" cotesReels tout en gardant invoquerToken : la garde
    // `!monde.invoquerToken || !monde.cotesReels` doit couvrir les DEUX absences,
    // pas seulement la première — sinon `t.camp === 'ennemi' ? monde.cotesReels.ennemi : ...`
    // jetterait sur `cotesReels` undefined.
    const alliees: Unit[] = [];
    expect(() => executer([invoquerEffet('allie')], 'debut_combat', monde({
      unitesAlliees: alliees,
      invoquerToken: invocateur({ player: 1, enemy: 1 }),
      // cotesReels volontairement absent
    }))).not.toThrow();
    expect(alliees).toHaveLength(0);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Le compilateur — les trois porteurs
// ───────────────────────────────────────────────────────────────────────────

describe('compileBoard — summon_token', () => {
  it('compile en une tâche `invoquer`, camp par défaut = allie', () => {
    const { effets, refus } = compileBoard({ id: 'B', effects: [{ type: 'summon_token', token_id: TOKEN_DEF.id } as any] } as any);
    expect(refus).toEqual([]);
    expect(effets[0].trigger.quand).toBe('debut_combat');
    expect(effets[0].taches).toEqual([{ action: 'invoquer', camp: 'allie', tokenId: TOKEN_DEF.id }]);
  });

  it('respecte camp=ennemi', () => {
    const { effets } = compileBoard({ id: 'B', effects: [{ type: 'summon_token', token_id: TOKEN_DEF.id, camp: 'ennemi' } as any] } as any);
    expect(effets[0].taches).toEqual([{ action: 'invoquer', camp: 'ennemi', tokenId: TOKEN_DEF.id }]);
  });

  it('refuse un token sans id, nommément', () => {
    const { effets, refus } = compileBoard({ id: 'B', effects: [{ type: 'summon_token' } as any] } as any);
    expect(effets).toEqual([]);
    expect(refus).toHaveLength(1);
    expect(refus[0].raison).toBe('token sans id');
  });
});

describe('compileAttribute — summon_token', () => {
  it('honore debut_combat, a_l_invocation, pouvoir_utilise — pas fin_combat', () => {
    for (const [timing, quand] of [['start_of_combat', 'debut_combat'], ['on_summon', 'a_l_invocation'], ['on_power_fired', 'pouvoir_utilise']] as const) {
      const { effets, refus } = compileAttribute({
        id: 'ARCH_T', thresholds: [{ count: 2, effects: [{ type: 'summon_token', token_id: TOKEN_DEF.id, timing } as any] }],
      } as any, new Set(['ARCH_T']));
      expect(refus, timing).toEqual([]);
      expect(effets[0].trigger.quand).toBe(quand);
    }
  });

  it('refuse fin_combat — un token né après le dernier tick n’a rien où se battre', () => {
    const { effets, refus } = compileAttribute({
      id: 'ARCH_T', thresholds: [{ count: 2, effects: [{ type: 'summon_token', token_id: TOKEN_DEF.id, timing: 'end_of_combat' } as any] }],
    } as any, new Set(['ARCH_T']));
    expect(effets).toEqual([]);
    expect(refus[0].raison).toBe('moment impossible');
  });
});

describe('compileMagie — summon_token', () => {
  it('compile pour son propre camp (immédiat)', () => {
    const { effets, refus } = compileMagie({ id: 'M', effect: { type: 'summon_token', token_id: TOKEN_DEF.id } as any } as any);
    expect(refus).toEqual([]);
    expect(effets[0].trigger.quand).toBe('immediat');
    expect(effets[0].taches).toEqual([{ action: 'invoquer', camp: 'allie', tokenId: TOKEN_DEF.id }]);
  });

  it('refuse camp=ennemi — une magie ne peut pas poser un token chez l’adversaire (PvP)', () => {
    const { effets, refus } = compileMagie({ id: 'M', effect: { type: 'summon_token', token_id: TOKEN_DEF.id, camp: 'ennemi' } as any } as any);
    expect(effets).toEqual([]);
    expect(refus).toHaveLength(1);
    expect(refus[0].raison).toBe('camp interdit');
  });
});

// ───────────────────────────────────────────────────────────────────────────
// GameSession — bout en bout, les trois porteurs
// ───────────────────────────────────────────────────────────────────────────

const SUMMON_BOARD: any = {
  id: 'BOARD_SUMMON', name: 'Sanctuaire',
  effects: [{ type: 'summon_token', token_id: TOKEN_DEF.id }],
};

const TOKEN_DB = { getToken: (id: string) => (id === TOKEN_DEF.id ? (TOKEN_DEF as any) : null) };

function makeSummonSession(overrides: Partial<GameSessionDeps> = {}): GameSession {
  const card = makeCard({ id: 'P1', summon_conditions: [] });
  const deps: GameSessionDeps = {
    cardsByTier: { 1: [card as any] },
    enemyDeck: {},
    attributeList: [],
    cardDb: { getCard: () => null },
    tokenDb: TOKEN_DB,
    getAllBoards: () => [SUMMON_BOARD],
    getAllMagies: () => [],
    rand: () => 0,
    ...overrides,
  };
  const session = new GameSession(deps);
  session.board.placeUnit(new (Unit as any)(card, 'player'), { col: 2, row: 2 });
  return session;
}

describe('GameSession — summon_token de TERRAIN, bout en bout', () => {
  it('le token apparaît au lancement du combat, combat, puis disparaît à la clôture', () => {
    const session = makeSummonSession();
    const { combat, playerUnits } = session.startCombat(SUMMON_BOARD);
    expect(playerUnits).toHaveLength(2);
    const token = playerUnits.find(u => u.card_id === TOKEN_DEF.id);
    expect(token?.is_token).toBe(true);
    expect(session.board.getUnit(token!.position!)).toBe(token);

    while (!combat.isOver) combat.step();
    session.finishCombat();

    // ⚠️ RÉGRESSION : un token doit disparaître comme POWER_SUMMON_TOKEN — ni
    // cimetière, ni vétérance, ni case occupée. Rouge si `finishCombat` cessait
    // de le filtrer (cf. `token-summon.test.ts`, dont c'est ici le pendant pour
    // une invocation par TERRAIN plutôt que par POUVOIR).
    expect(session.graveyard.some(u => u.card_id === TOKEN_DEF.id)).toBe(false);
    expect(session.board.getAllUnits().some(u => u.card_id === TOKEN_DEF.id)).toBe(false);
  });

  it('DÉSACTIVÉ EN PVP — même terrain, aucun token n’apparaît', () => {
    const session = makeSummonSession({ mode: 'pvp' });
    const { playerUnits } = session.startCombat(SUMMON_BOARD);
    expect(playerUnits).toHaveLength(1);
    expect(playerUnits.some(u => u.card_id === TOKEN_DEF.id)).toBe(false);
  });

  it('sans case libre du côté visé, aucun token — et rien ne plante', () => {
    const session = makeSummonSession();
    // Sature toutes les cases joueur restantes.
    for (const pos of session.board.freeCellsOnSide('player')) {
      session.board.placeUnit(new (Unit as any)(makeCard({ id: `FILLER_${pos.col}_${pos.row}` }), 'player'), pos);
    }
    const { playerUnits } = session.startCombat(SUMMON_BOARD);
    expect(playerUnits.some(u => u.card_id === TOKEN_DEF.id)).toBe(false);
  });
});

describe('GameSession — summon_token d’ATTRIBUT, la traduction allié/ennemi', () => {
  const ATTR_ID = 'ARCH_TEST_TOKEN';
  const attr = { id: ATTR_ID, name: 'Sanctuaire', thresholds: [{ count: 1, effects: [{ type: 'summon_token', token_id: TOKEN_DEF.id }] }] };

  function sessionAvecAttribut(): GameSession {
    return makeSummonSession({ attributeList: [attr as any], getAllBoards: () => [] });
  }

  it('`allie` invoque du côté du PORTEUR — joueur', () => {
    const session = sessionAvecAttribut();
    // Le porteur : la carte posée en (2,2) doit annoncer l'attribut.
    session.board.getUnit({ col: 2, row: 2 })!.attributes.push(ATTR_ID);
    const { playerUnits, enemyUnits } = session.startCombat(null);
    expect(playerUnits.some(u => u.card_id === TOKEN_DEF.id)).toBe(true);
    expect(enemyUnits.some(u => u.card_id === TOKEN_DEF.id)).toBe(false);
  });

  it('`allie` invoque du côté du PORTEUR — ennemi, sans qu\'aucune ligne ne le distingue', () => {
    const session = sessionAvecAttribut();
    const enemyCard = makeCard({ id: 'E1', attributes: [ATTR_ID] });
    session.board.placeUnit(new (Unit as any)(enemyCard, 'enemy'), { col: 2, row: 8 });
    const { playerUnits, enemyUnits } = session.startCombat(null);
    expect(enemyUnits.some(u => u.card_id === TOKEN_DEF.id)).toBe(true);
    expect(playerUnits.some(u => u.card_id === TOKEN_DEF.id)).toBe(false);
  });
});

describe('GameSession — summon_token de MAGIE (Phase Shopping)', () => {
  const magieToken = { id: 'MAGIE_TOKEN', name: 'Invocation', effect: { type: 'summon_token', token_id: TOKEN_DEF.id } };

  it('pose le token directement sur le board, hors combat', () => {
    const session = makeSummonSession({ getAllBoards: () => [] });
    const avant = session.board.getLivingUnitsOnSide('player').length;
    session.applyGlobalMagie(magieToken as any);
    const apres = session.board.getLivingUnitsOnSide('player');
    expect(apres).toHaveLength(avant + 1);
    expect(apres.some(u => u.card_id === TOKEN_DEF.id && u.is_token)).toBe(true);
  });

  it('DÉSACTIVÉ EN PVP — la magie ne pose rien', () => {
    const session = makeSummonSession({ mode: 'pvp', getAllBoards: () => [] });
    session.applyGlobalMagie(magieToken as any);
    expect(session.board.getLivingUnitsOnSide('player')).toHaveLength(1);
  });
});
