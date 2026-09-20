/* eslint-disable @typescript-eslint/no-explicit-any */
// LES MOTS-CLÉS — l'index, et la première règle qu'il sert : **Second souffle**.
//
// ⚠️ Ce fichier couvre la seule famille de mots-clés que le moteur d'effets ne
// peut pas exprimer : une **durée de vie de conteneur**. Les mots-clés qui SONT
// des effets (Tour, Explosif, Appelant) se testent là où les effets se testent —
// `effect-schema.test.ts` pour le vocabulaire, `effects-shadow-attributes` pour
// la traduction. Un mot-clé qui arriverait ici sans raison serait le signe qu'on
// s'est écrit un second moteur.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GameSession } from '../logic/GameSession.js';
import type { GameSessionDeps } from '../logic/GameSession.js';
import { AttributeManager } from '../logic/AttributeManager.js';
import { indexeMotsCles, porteMotCle, catalogueDeclare, MOT_CLE_CATEGORY } from '../logic/Keywords.js';
import { MOTS_CLES } from '../../../effect-schema.mjs';
import { makeCard, spawn } from './helpers.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const attributs: any[] = JSON.parse(readFileSync(path.join(ROOT, 'initial-data/attributes.json'), 'utf8'));
const cartes: any[] = JSON.parse(readFileSync(path.join(ROOT, 'initial-data/cards.json'), 'utf8'));

/** Un catalogue d'attributs minimal portant le mot-clé sur `MOT`. */
const CATALOGUE = [
  { id: 'MOT', name: 'Second souffle', categorie: MOT_CLE_CATEGORY, mot_cle: 'cimetiere_permanent', thresholds: [] },
  { id: 'AUTRE', name: 'Dragon', categorie: 'Archetype', thresholds: [] },
];

function makeSession(attributeList: any[] = CATALOGUE): GameSession {
  const deps: GameSessionDeps = {
    cardsByTier: { 1: [makeCard({ id: 'P1', summon_conditions: [] }) as any] },
    enemyDeck: { 1: [] },
    attributeList: attributeList as any,
    cardDb: { getCard: () => null } as any,
    getAllBoards: () => [],
    getAllMagies: () => [],
  };
  return new GameSession(deps);
}

// ───────────────────────────────────────────────────────────────────────────
// L'index
// ───────────────────────────────────────────────────────────────────────────

describe('indexeMotsCles', () => {
  it('range les attributs par mot-clé', () => {
    const index = indexeMotsCles(CATALOGUE);
    expect(index.parMotCle.get('cimetiere_permanent')).toEqual(new Set(['MOT']));
    expect(index.refus).toEqual([]);
    expect(catalogueDeclare('cimetiere_permanent', index)).toBe(true);
  });

  it('un catalogue sans mot-clé ne déclare rien — la sortie sèche de l\'appelant', () => {
    const index = indexeMotsCles([{ id: 'AUTRE', categorie: 'Archetype' }]);
    expect(catalogueDeclare('cimetiere_permanent', index)).toBe(false);
    expect(index.refus).toEqual([]);
  });

  // ⚠️ La discipline de `CompilationResult.refus` : une faute de frappe en admin
  // donnerait un mot-clé qui ne fait rien, et rien ne le dirait.
  it('un mot-clé inconnu est REFUSÉ NOMMÉMENT, jamais rangé en silence', () => {
    const index = indexeMotsCles([{ id: 'X', mot_cle: 'seconde_vie' }]);
    expect(index.refus).toEqual([{ attribut: 'X', mot_cle: 'seconde_vie' }]);
    expect(index.parMotCle.size).toBe(0);
  });

  // ⚠️ C'est le champ qui porte la mécanique, pas la catégorie : les lier
  // rendrait un mot-clé muet sur un attribut bien renseigné mais mal classé.
  it('la CATÉGORIE n\'entre pas dans le verdict', () => {
    const index = indexeMotsCles([{ id: 'X', categorie: 'Archetype', mot_cle: 'cimetiere_permanent' }]);
    expect(porteMotCle(['X'], 'cimetiere_permanent', index)).toBe(true);
  });

  it('porteMotCle ne répond vrai que sur un porteur', () => {
    const index = indexeMotsCles(CATALOGUE);
    expect(porteMotCle(['MOT', 'AUTRE'], 'cimetiere_permanent', index)).toBe(true);
    expect(porteMotCle(['AUTRE'], 'cimetiere_permanent', index)).toBe(false);
    expect(porteMotCle([], 'cimetiere_permanent', index)).toBe(false);
    expect(porteMotCle(undefined, 'cimetiere_permanent', index)).toBe(false);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Le catalogue livré
// ───────────────────────────────────────────────────────────────────────────

describe('Mots-clés livrés — conformité du catalogue', () => {
  // ⚠️ Le pendant de `magie-offer.test.ts` : le code sait refuser un mot-clé
  // inconnu, encore faut-il que la donnée livrée n'en porte aucun.
  it('tout mot_cle du catalogue est un mot-clé que le code connaît', () => {
    expect(indexeMotsCles(attributs).refus).toEqual([]);
  });

  it('un attribut qui porte un mot_cle est rangé dans la catégorie des mots-clés', () => {
    const malRanges = attributs
      .filter(a => a.mot_cle && a.categorie !== MOT_CLE_CATEGORY)
      .map(a => `${a.id} ${a.name} (categorie '${a.categorie}')`);
    expect(malRanges).toEqual([]);
  });

  // ⚠️ Un mot-clé déclaré que personne ne porte est du vocabulaire qui promet —
  // la famille exacte que ce projet ferme partout ailleurs.
  it('chaque mot-clé déclaré a au moins une carte qui le porte', () => {
    const index = indexeMotsCles(attributs);
    const orphelins: string[] = [];
    for (const cle of Object.keys(MOTS_CLES)) {
      const ids = index.parMotCle.get(cle as any) ?? new Set<string>();
      const porteurs = cartes.filter(c => (c.attributes ?? []).some((a: string) => ids.has(a)));
      if (!porteurs.length) orphelins.push(cle);
    }
    expect(orphelins).toEqual([]);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Second souffle
// ───────────────────────────────────────────────────────────────────────────

describe('Second souffle — le corps survit à la purge des cimetières', () => {
  /** Pose un corps neutralisé dans le cimetière du camp demandé. */
  function corps(session: GameSession, attrs: string[], side: 'player' | 'enemy' = 'player') {
    const unit = spawn(session.board, makeCard({ id: `C_${attrs.join('_') || 'nu'}`, attributes: attrs }) as any, side, { col: 0, row: side === 'player' ? 0 : 10 });
    unit.is_neutralized = true;
    session.board.removeUnit(unit);
    (side === 'player' ? session.graveyard : session.enemyGraveyard).push(unit);
    return unit;
  }

  it('un corps sans le mot-clé est purgé au lancement du combat, un porteur est épargné', () => {
    const session = makeSession();
    const nu = corps(session, ['AUTRE']);
    const porteur = corps(session, ['MOT']);

    session.startCombat(null);

    expect(session.graveyard).toEqual([porteur]);
    expect(session.graveyard).not.toContain(nu);
  });

  // ⚠️ LE cas de régression du lot : `finishCombat` AFFECTE le cimetière au lieu
  // d'y pousser. Sans la reprise des rescapés, le mot-clé aurait l'air de
  // marcher pendant exactement une préparation.
  // Mutation : remettre `this.graveyard = playerUnits.filter(...)` → ROUGE ici.
  it('il traverse TROIS combats, pas seulement le premier', () => {
    const session = makeSession();
    const porteur = corps(session, ['MOT']);

    for (let round = 0; round < 3; round++) {
      session.startCombat(null);
      session.finishCombat();
      expect(session.graveyard, `round ${round + 1}`).toContain(porteur);
    }
  });

  it('consommé comme matériau, il disparaît — c\'est la seule sortie', () => {
    const session = makeSession();
    const porteur = corps(session, ['MOT']);

    // La consommation retire du cimetière (`GameSession._consumeMaterials`) ;
    // on reproduit ici son geste, le splice, sans rejouer l'invocation.
    session.graveyard.splice(session.graveyard.indexOf(porteur), 1);
    session.startCombat(null);

    expect(session.graveyard).toEqual([]);
  });

  // ⚠️ Un mot-clé profite à qui le PORTE — l'IA comme le joueur, sans drapeau
  // d'asymétrie (décision 3 du §7).
  it('vaut pour le camp adverse aussi', () => {
    const session = makeSession();
    const nu = corps(session, ['AUTRE'], 'enemy');
    const porteur = corps(session, ['MOT'], 'enemy');

    session.startCombat(null);

    expect(session.enemyGraveyard).toEqual([porteur]);
    expect(session.enemyGraveyard).not.toContain(nu);
  });

  // ⚠️ La sortie sèche : sans le mot-clé au catalogue, la purge est la ligne
  // d'avant, à l'identique.
  it('un catalogue qui ne déclare pas le mot-clé purge tout, comme avant', () => {
    const session = makeSession([{ id: 'AUTRE', categorie: 'Archetype', thresholds: [] }]);
    const porteur = corps(session, ['MOT']);

    session.startCombat(null);

    expect(session.graveyard).toEqual([]);
    expect(porteur.is_neutralized).toBe(true);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Affichage
// ───────────────────────────────────────────────────────────────────────────

describe('Un mot-clé n\'est pas une synergie', () => {
  it('le panneau de synergies écarte les attributs de la catégorie des mots-clés', () => {
    const motCle = { id: 'MOT_EFFET', name: 'Tour', categorie: MOT_CLE_CATEGORY,
      timing: 'start_of_combat', thresholds: [{ count: 1, effects: [{ type: 'stat_bonus', stat: 'range', value: 20 }] }] };
    const archetype = { id: 'AUTRE', name: 'Dragon', categorie: 'Archetype',
      timing: 'start_of_combat', thresholds: [{ count: 1, effects: [{ type: 'stat_bonus', stat: 'atk', value: 5 }] }] };

    const board = makeSession().board;
    const unit = spawn(board, makeCard({ id: 'U', attributes: ['MOT_EFFET', 'AUTRE'] }) as any, 'player', { col: 0, row: 0 });
    const mgr = new (AttributeManager as any)([motCle, archetype], [unit], []);

    const noms = mgr.getActiveSynergies([unit]).map((s: any) => s.attr.id);
    expect(noms).toEqual(['AUTRE']);
  });
});
