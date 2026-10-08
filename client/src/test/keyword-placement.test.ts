/* eslint-disable @typescript-eslint/no-explicit-any */
// Le placement des mots-clés des familles 1 et 2, par l'IA et l'auto-joueur.
// La règle vit dans `KeywordPlacement` ; ce fichier l'éprouve sur `EnemyAI`
// (camp ennemi, rangées 7–10) et dans le repère du joueur (rangées 0–3).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { EnemyAI } from '../logic/EnemyAI.js';
import { indexPlacementKeywords, placementKeyword, bestKeywordCell } from '../logic/KeywordPlacement.js';
import { makeCard, spawn, makeBoard } from './helpers.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
// Embusqué et Flanc ne sont plus portés par aucun attribut livré (les rôles
// les ont remplacés) ; le moteur les sait toujours, on les éprouve sur deux
// attributs synthétiques.
const synthetique = (id: string, type: string) => ({ id, name: id, categorie: 'MotCle', timing: 'start_of_combat',
  thresholds: [{ count: 1, effects: [{ type }] }] });
const attributs: any[] = [
  ...JSON.parse(readFileSync(path.join(ROOT, 'initial-data/attributes.json'), 'utf8')),
  synthetique('T_EMB', 'embusque'), synthetique('T_FLANC', 'flanc'),
];
const INDEX = indexPlacementKeywords(attributs);
const idDe = (type: string) => attributs.find(a => a.thresholds?.some((t: any) => t.effects?.some((e: any) => e.type === type))).id;

function ia() { return new (EnemyAI as any)({ 1: [] }, { getCard: () => null }, 'enemy', () => 0.5); }
const keywordOf = (u: any) => placementKeyword(u.attributes, INDEX);

/** Cinq unités ennemies, dont une porteuse de `type` (ou aucune). */
function plateau(type: string | null, blocked: { col: number; row: number }[] = []) {
  const board = makeBoard();
  if (blocked.length) board.setBlockedCells(blocked);
  const stats = [
    { range: 1, hp: 300 }, { range: 1, hp: 200 }, { range: 3, hp: 100 }, { range: 3, hp: 90 }, { range: 1, hp: 150 },
  ];
  const units = stats.map((st, i) => spawn(board, makeCard({
    id: `U${i}`, attributes: i === 4 && type ? [idDe(type)] : [], stats: { atk: 5, movement_rate: 50, attack_rate: 50, ...st },
  }), 'enemy', { col: i, row: 10 }));
  units[1].current_hp = 40; // le plus blessé : le protégé d'un Garde du corps
  return { board, units, porteur: units[4] };
}
const disposition = (board: any) => board.getLivingUnitsOnSide('enemy').map((u: any) => `${u.card_id}@${u.position.col},${u.position.row}`).sort();

describe('Placement des mots-clés — lecture des attributs', () => {
  it('lit la famille 2 avant Tireur d\'élite, dans le rang du moteur ; rien sans porteur', () => {
    expect(placementKeyword([idDe('tireur_elite'), idDe('flanc')], INDEX)).toBe('flanc');
    expect(placementKeyword([idDe('flanc'), idDe('garde_du_corps')], INDEX)).toBe('garde_du_corps');
    expect(placementKeyword([idDe('chasseur')], INDEX)).toBeNull();
    expect(placementKeyword([], INDEX)).toBeNull();
  });
});

describe('EnemyAI.rearrangeUnits — les porteurs', () => {
  // ⚠️ La garantie de non-régression : sans porteur, le placement est celui
  // d'avant au bit près — c'est ce qui laisse la simulation inchangée.
  it('sans porteur, la lecture des mots-clés ne change rien', () => {
    const a = plateau(null); ia().rearrangeUnits(a.board);
    const b = plateau(null); ia().rearrangeUnits(b.board, null, keywordOf);
    expect(disposition(b.board)).toEqual(disposition(a.board));
  });

  it('Tireur d\'élite au fond', () => {
    const { board, porteur } = plateau('tireur_elite');
    ia().rearrangeUnits(board, null, keywordOf);
    expect(porteur.position.row).toBe(10);
  });

  it('Embusqué en première ligne, face à un couloir libre', () => {
    // Sans le mot-clé, le porteur (mêlée) tomberait en colonne 3, dont le
    // couloir est bloqué.
    const { board, porteur } = plateau('embusque', [{ col: 3, row: 5 }]);
    ia().rearrangeUnits(board, null, keywordOf);
    expect(porteur.position.row).toBe(7);
    expect(porteur.position.col).not.toBe(3);
  });

  it('Flanc sur une colonne de bord', () => {
    const { board, porteur } = plateau('flanc');
    ia().rearrangeUnits(board, null, keywordOf);
    expect([0, 4]).toContain(porteur.position.col);
  });

  it('Tank en première ligne', () => {
    const { board, porteur } = plateau('tank');
    ia().rearrangeUnits(board, null, keywordOf);
    expect(porteur.position.row).toBe(7);
  });

  it('Garde du corps au contact de l\'allié le plus blessé', () => {
    const { board, units, porteur } = plateau('garde_du_corps');
    ia().rearrangeUnits(board, null, keywordOf);
    const ward = units[1].position;
    expect(Math.abs(porteur.position.col - ward.col) + Math.abs(porteur.position.row - ward.row)).toBe(1);
  });
});

describe('Placement des mots-clés — le repère du joueur (auto-joueur)', () => {
  const ctx = (extra: any = {}) => ({ board: makeBoard(), frontRow: 3, rowStep: -1, range: 1, ward: null, ...extra });
  const cells = Array.from({ length: 20 }, (_, i) => ({ col: i % 5, row: Math.floor(i / 5) }));

  it('Tireur d\'élite rangée 0, Embusqué rangée 3, Flanc colonne 0', () => {
    expect(bestKeywordCell('tireur_elite', cells, ctx())).toEqual({ col: 2, row: 0 });
    expect(bestKeywordCell('embusque', cells, ctx())).toEqual({ col: 2, row: 3 });
    expect(bestKeywordCell('flanc', cells, ctx())).toEqual({ col: 0, row: 3 });
  });

  it('Garde du corps sans protégé ne dit rien (placement par défaut)', () => {
    expect(bestKeywordCell('garde_du_corps', cells, ctx())).toBeNull();
    const libres = cells.filter(c => !(c.col === 4 && c.row === 0)); // la case du protégé est occupée
    expect(bestKeywordCell('garde_du_corps', libres, ctx({ ward: { col: 4, row: 0 } }))).toEqual({ col: 3, row: 0 });
  });
});

describe('Placement des mots-clés — le câblage', () => {
  // L'auto-joueur et l'IA passent bien par la règle : un Flanc posé par
  // l'auto-joueur tombe sur un bord, là où une carte nue tombe au centre.
  it('l\'auto-joueur pose un Flanc sur une colonne de bord', async () => {
    const { GameSession } = await import('../logic/GameSession.js');
    const { playPreparation } = await import('../sim/autoPlayer.js');
    const pose = (attrs: string[]) => {
      const card = makeCard({ id: 'F', attributes: attrs, summon_conditions: [] });
      const s: any = new (GameSession as any)({
        cardsByTier: { 1: [] }, enemyDeck: { 1: [] }, attributeList: attributs,
        cardDb: { getCard: () => card }, getAllBoards: () => [], getAllMagies: () => [], mode: 'ai',
      });
      s.startPreparation();
      s.hand.splice(0, s.hand.length, card);
      return playPreparation(s)[0].position;
    };
    expect([0, 4]).toContain(pose([idDe('flanc')])!.col);
    expect(pose([])!.col).toBe(2);
  });
});
