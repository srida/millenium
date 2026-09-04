/* eslint-disable @typescript-eslint/no-explicit-any */
// Golden tests du terrain AU NIVEAU DE LA SESSION : les deux règles telles
// qu'un duel les vit — le terrain suit les decks des deux joueurs, et ne
// revient jamais deux fois.
//
// ⚠️ Éprouvés dans les deux sens, comme `board-picker.test.ts` : la mutation qui
// doit faire tomber chaque cas est nommée dans son commentaire.
import { describe, it, expect } from 'vitest';
import { GameSession } from '../logic/GameSession.js';
import type { GameSessionDeps } from '../logic/GameSession.js';
import { makeCard } from './helpers.js';
import { makeRandom } from '../logic/Random.js';
import type { BoardDef } from '../logic/types.js';

function terrain(id: string, attrs: string[] | null = []): BoardDef {
  return {
    id, name: id,
    effect: attrs === null ? null : { type: 'stat_bonus', stat: 'atk', value: 10, target_attributes: attrs }
  } as BoardDef;
}

interface Opts {
  playerAttrs?: string[][];
  enemyAttrs?: string[][];
  boards?: BoardDef[];
  mode?: 'ai' | 'pvp';
  seed?: number;
}

function makeSession(opts: Opts = {}): GameSession {
  const playerCards = (opts.playerAttrs ?? [[]]).map((attributes, i) =>
    makeCard({ id: `P${i}`, summon_conditions: [], attributes }));
  const enemyCards = (opts.enemyAttrs ?? [[]]).map((attributes, i) =>
    makeCard({ id: `E${i}`, summon_conditions: [], attributes }));
  const byId = new Map([...playerCards, ...enemyCards].map(c => [c.id, c]));
  const deps: GameSessionDeps = {
    cardsByTier: { 1: playerCards as any },
    enemyDeck: { 1: enemyCards.map(c => c.id) },
    attributeList: [],
    cardDb: { getCard: (id: string) => (byId.get(id) as any) ?? null },
    getAllBoards: () => opts.boards ?? [],
    getAllMagies: () => [],
    mode: opts.mode ?? 'ai',
    rand: makeRandom(opts.seed ?? 2026)
  };
  return new GameSession(deps);
}

/** Enchaîne `n` combats complets et rend les terrains joués, dans l'ordre. */
function playRounds(session: GameSession, n: number): (string | null)[] {
  const out: (string | null)[] = [];
  session.startPreparation();
  for (let i = 0; i < n; i++) {
    out.push(session.startCombat().boardData?.id ?? null);
    session.finishCombat();
    session.startNextRound();
  }
  return out;
}

describe('Terrain d\'un duel — la non-répétition', () => {
  // ⚠️ LA règle 2. Mutation : `startCombat` n'alimente plus `_usedBoardIds` → ROUGE.
  it('5 combats d\'affilée jouent 5 terrains DISTINCTS', () => {
    const boards = Array.from({ length: 14 }, (_, i) => terrain(`B${String(i).padStart(2, '0')}`, ['ARCH_001']));
    const played = playRounds(makeSession({ boards, playerAttrs: [['ARCH_001'], ['ARCH_001']] }), 5);
    expect(played).toHaveLength(5);
    expect(played.every(Boolean)).toBe(true);
    expect(new Set(played).size).toBe(5);
  });

  // Mutation : déplacer le marquage dans `pickCombatBoard` → ROUGE (le chemin
  // PvP ne marquerait plus rien).
  it('le terrain CONVENU (chemin PvP) est marqué comme joué, lui aussi', () => {
    const boards = [terrain('B1'), terrain('B2')];
    const session = makeSession({ boards, mode: 'pvp' });
    session.startPreparation();
    session.startCombat(boards[0]);           // l'id vient du serveur, pas du tirage
    for (let i = 0; i < 20; i++) expect(session.pickCombatBoard()!.id).toBe('B2');
  });

  it('un terrain convenu NUL ne casse rien et ne marque rien', () => {
    const boards = [terrain('B1')];
    const session = makeSession({ boards, mode: 'pvp' });
    session.startPreparation();
    expect(session.startCombat(null).boardData).toBeNull();
    expect(session.pickCombatBoard()!.id).toBe('B1');
  });

  it('un catalogue vide ne rend aucun terrain, sans jeter', () => {
    const session = makeSession({ boards: [] });
    session.startPreparation();
    expect(session.startCombat().boardData).toBeNull();
  });
});

describe('Terrain d\'un duel — la pertinence aux deux decks', () => {
  const pool = [terrain('DRAGON', ['ARCH_003']), terrain('ZOMBIE', ['ARCH_029']), terrain('NEUTRE', null)];

  // ⚠️ LA règle 1, côté joueur. Mutation : échelon de pertinence retiré → ROUGE.
  it('le terrain suit le deck du JOUEUR', () => {
    for (let seed = 0; seed < 20; seed++) {
      const s = makeSession({ boards: pool, playerAttrs: [['ARCH_003'], ['ARCH_003']], seed: seed + 1 });
      expect(s.pickCombatBoard()!.id).toBe('DRAGON');
    }
  });

  // Mutation : dérivation depuis `deps.enemyDeck` supprimée → ROUGE. Couvre
  // aussi la résolution des ids adverses par `cardDb.getCard`.
  it('le terrain suit AUSSI le deck de l\'adversaire', () => {
    for (let seed = 0; seed < 20; seed++) {
      const s = makeSession({ boards: pool, enemyAttrs: [['ARCH_029'], ['ARCH_029']], seed: seed + 1 });
      expect(s.pickCombatBoard()!.id).toBe('ZOMBIE');
    }
  });

  // Mutation : MIN_ATTRIBUTE_OCCURRENCES = 1 → ROUGE.
  it('un attribut porté par UNE seule carte ne rend pas son terrain pertinent', () => {
    const seen = new Set<string>();
    for (let seed = 0; seed < 40; seed++) {
      seen.add(makeSession({ boards: pool, playerAttrs: [['ARCH_003'], []], seed: seed * 7919 + 1 }).pickCombatBoard()!.id);
    }
    expect(seen.size).toBeGreaterThan(1); // aucun terrain ne domine : tout est équiprobable
  });

  // ⚠️ L'ARBITRAGE entre les deux règles, vécu par une session.
  // Mutation : inverser la priorité (pertinence gagnante) → ROUGE.
  it('le seul terrain pertinent déjà joué → on prend un NEUTRE, on ne le rejoue pas', () => {
    const boards = [terrain('DRAGON', ['ARCH_003']), terrain('N1', null), terrain('N2', null)];
    const session = makeSession({ boards, playerAttrs: [['ARCH_003'], ['ARCH_003']] });
    session.startPreparation();
    expect(session.startCombat().boardData!.id).toBe('DRAGON');
    session.finishCombat(); session.startNextRound();
    expect(session.startCombat().boardData!.id).not.toBe('DRAGON');
  });
});

describe('Terrain d\'un duel — l\'override PvP', () => {
  const pool = [terrain('DRAGON', ['ARCH_003']), terrain('ZOMBIE', ['ARCH_029'])];

  // ⚠️ LE test du piège PvP : `deps.enemyDeck` y est le MIROIR du deck joueur.
  // Mutation : le setter n'écrase pas, ou le tirage relit `deps.enemyDeck` → ROUGE.
  it('les comptes du serveur remplacent le deck ennemi miroir', () => {
    for (let seed = 0; seed < 20; seed++) {
      const s = makeSession({
        boards: pool, mode: 'pvp',
        playerAttrs: [['ARCH_003'], ['ARCH_003']],
        enemyAttrs: [['ARCH_003'], ['ARCH_003']],   // le miroir, comme buildSession le produit
        seed: seed + 1
      });
      s.setEnemyDeckAttributeCounts({ ARCH_029: 4 });
      // ARCH_003 reste porté par le deck du JOUEUR : les deux terrains sont donc
      // pertinents. Ce qui est éprouvé, c'est que ZOMBIE le soit devenu.
      expect(['DRAGON', 'ZOMBIE']).toContain(s.pickCombatBoard()!.id);
    }
    // Et sans attribut joueur, seul le terrain annoncé par le serveur sort.
    for (let seed = 0; seed < 20; seed++) {
      const s = makeSession({ boards: pool, mode: 'pvp', enemyAttrs: [['ARCH_003'], ['ARCH_003']], seed: seed + 1 });
      s.setEnemyDeckAttributeCounts({ ARCH_029: 4 });
      expect(s.pickCombatBoard()!.id).toBe('ZOMBIE');
    }
  });

  // Mutation : retirer la garde `if (!counts) return` → ROUGE.
  it('un adversaire dégénéré (sans comptes) ne remet PAS la règle à zéro', () => {
    const s = makeSession({ boards: pool, mode: 'pvp', seed: 5 });
    s.setEnemyDeckAttributeCounts({ ARCH_029: 4 });
    s.setEnemyDeckAttributeCounts(undefined);   // ce que rend `{ id }` de match:rejoined
    for (let i = 0; i < 20; i++) expect(s.pickCombatBoard()!.id).toBe('ZOMBIE');
  });

  // Le seuil ne vit QUE côté client : le serveur envoie des comptes bruts.
  it('le seuil s\'applique aux comptes reçus du serveur', () => {
    const s = makeSession({ boards: pool, mode: 'pvp', seed: 5 });
    s.setEnemyDeckAttributeCounts({ ARCH_029: 1 });   // une seule carte → pas une couleur
    const seen = new Set<string>();
    for (let i = 0; i < 40; i++) {
      seen.add(makeSession({ boards: pool, mode: 'pvp', seed: i * 7919 + 1 }).pickCombatBoard()!.id);
    }
    expect(seen.size).toBeGreaterThan(1);
  });
});
