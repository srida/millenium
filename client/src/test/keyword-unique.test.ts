/* eslint-disable @typescript-eslint/no-explicit-any */
// UNIQUE — le mot-clé qui retire une carte du pool de pioche pour le reste
// de la partie, dès qu'elle est tirée une première fois (main normale ou
// pioche garantie).
//
// ⚠️ Ce n'est PAS un effet : le moteur n'a aucune tâche pour « exclure un id
// d'un pool de pioche », exactement le statut de `cimetiere_permanent` et de
// `multiple`. La règle vit dans `Draw.ts` (générique, `excluded` en paramètre
// — ce module ne sait pas ce qu'« Unique » veut dire), et c'est
// `GameSession`/`EnemyAI` qui tiennent le registre des ids déjà tirés.
//
// ⚠️ Portée assumée : l'exclusion joue ENTRE deux appels (deux tours, un
// mulligan) — PAS à l'intérieur d'un même tirage de 5 cartes. Un pool si
// pauvre qu'il ne contient qu'elle peut donc encore la donner plusieurs fois
// dans la MÊME main, exactement comme n'importe quelle carte piochée « avec
// remise » (`Draw.drawHand`). Ce n'est pas un oubli : durcir la règle
// demanderait à `Draw.ts` de savoir ce qu'un mot-clé veut dire, ce que ce
// fichier lui interdit précisément.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { drawHand, poolForRound, resolveGuaranteedDraws } from '../logic/Draw.js';
import { EnemyAI } from '../logic/EnemyAI.js';
import { GameSession } from '../logic/GameSession.js';
import type { GameSessionDeps } from '../logic/GameSession.js';
import { MOT_CLE_CATEGORY } from '../logic/Keywords.js';
import { makeCard } from './helpers.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const attributs: any[] = JSON.parse(readFileSync(path.join(ROOT, 'initial-data/attributes.json'), 'utf8'));
const cartes: any[] = JSON.parse(readFileSync(path.join(ROOT, 'initial-data/cards.json'), 'utf8'));

/** L'attribut Unique, tel qu'il est LIVRÉ — jamais une copie écrite ici. */
const UNIQUE = attributs.find(a => a.mot_cle === 'unique');

const UNIQ = makeCard({ id: 'UNIQ', tier: 1, attributes: [UNIQUE?.id ?? 'ARCH_101'] });
const NORMAL = makeCard({ id: 'NORMAL', tier: 2 });

describe('Unique — la donnée livrée', () => {
  it('existe, en catégorie MotCle, porte le mot-clé et aucun seuil', () => {
    expect(UNIQUE, 'attribut « Unique » absent du catalogue').toBeTruthy();
    expect(UNIQUE.categorie).toBe(MOT_CLE_CATEGORY);
    expect(UNIQUE.mot_cle).toBe('unique');
    expect(UNIQUE.thresholds).toEqual([]);
  });

  it('au moins une carte livrée le porte', () => {
    const porteurs = cartes.filter(c => (c.attributes ?? []).includes(UNIQUE.id));
    expect(porteurs.length).toBeGreaterThan(0);
  });
});

// ── Draw.ts — pur, générique : il reçoit des ids à exclure, il ne sait pas
//    ce qu'« Unique » veut dire. ────────────────────────────────────────────
describe('Draw — le paramètre `excluded`', () => {
  const byTier = { 1: [makeCard({ id: 'A', tier: 1 }), makeCard({ id: 'B', tier: 1 })] };

  it('poolForRound retire les ids exclus, et n\'y touche pas si `excluded` est vide', () => {
    expect(poolForRound(byTier as any, 1).map(c => c.id)).toEqual(['A', 'B']);
    expect(poolForRound(byTier as any, 1, new Set(['A'])).map(c => c.id)).toEqual(['B']);
  });

  it('drawHand ne pioche plus jamais un id exclu', () => {
    // `rand` toujours à 0 : sans exclusion ce serait toujours 'A'.
    const drawn = drawHand(byTier as any, 1, 5, () => 0, new Set(['A']));
    expect(drawn.every(c => c.id === 'B')).toBe(true);
  });

  it('un pool intégralement exclu ne pioche rien, sans jeter', () => {
    expect(drawHand(byTier as any, 1, 3, () => 0, new Set(['A', 'B']))).toEqual([]);
  });

  it('resolveGuaranteedDraws respecte la même exclusion, ses deux replis compris', () => {
    const pool = [makeCard({ id: 'A', tier: 1, attributes: ['ARCH_X'] })];
    // Seul candidat du pool, et exclu : ni le match exact, ni le repli sans
    // tier, ni le repli sur « tout le pool » ne doivent le ramener.
    expect(resolveGuaranteedDraws(pool as any, [{ tier: 1, attribute: 'ARCH_X' }], () => 0, new Set(['A']))).toEqual([]);
  });
});

// ── GameSession — le joueur ──────────────────────────────────────────────────
describe('GameSession — Unique ne se pioche qu\'une fois par partie', () => {
  // `rand` toujours à 0 : toujours le premier candidat du pool — déterministe.
  function makeSession(cardsByTier: Record<number, any[]>, attributeList: any[] = [UNIQUE]): GameSession {
    const deps: GameSessionDeps = {
      cardsByTier: cardsByTier as any,
      enemyDeck: { 1: [] },
      attributeList: attributeList as any,
      cardDb: { getCard: () => null } as any,
      getAllBoards: () => [],
      getAllMagies: () => [],
      rand: () => 0,
    };
    return new GameSession(deps);
  }

  it('une fois tirée au tour 1, elle ne ressort plus au tour 2 même si le pool s\'élargit', () => {
    const session = makeSession({ 1: [UNIQ], 2: [NORMAL] });

    session.startPreparation(); // round 1 : tiers [1] → pool = [UNIQ] seul
    expect(session.hand).toHaveLength(5);
    expect(session.hand.every(c => c.id === 'UNIQ')).toBe(true);

    session.startCombat(null);
    session.finishCombat();
    session.startNextRound(); // round 2 : tiers [1,2] → pool = [UNIQ, NORMAL] moins UNIQ

    expect(session.hand.filter(c => c.id === 'UNIQ')).toHaveLength(5); // inchangé
    expect(session.hand.filter(c => c.id === 'NORMAL')).toHaveLength(5); // le round 2 entier
  });

  // ⚠️ La sortie sèche : sans le mot-clé au catalogue, aucune exclusion — le
  // tour 2 repioche la même carte, comme n'importe quelle autre.
  // Mutation : oublier `this._uniqueDrawn` dans `startPreparation` → ROUGE
  // (le test ci-dessus resterait vert par accident, celui-ci le démasque).
  it('un catalogue qui ne déclare pas le mot-clé pioche sans jamais exclure', () => {
    const session = makeSession({ 1: [UNIQ], 2: [NORMAL] }, []);

    session.startPreparation();
    session.startCombat(null);
    session.finishCombat();
    session.startNextRound();

    // Round 2 tire aussi dans [UNIQ, NORMAL] avec le même `rand` → UNIQ encore.
    expect(session.hand.filter(c => c.id === 'UNIQ')).toHaveLength(10);
  });

  it('une pioche garantie ne la ramène pas non plus, même par son repli le plus large', () => {
    const session = makeSession({ 1: [UNIQ] });

    session.startPreparation();
    expect(session.hand).toHaveLength(5);

    (session as any).gameState.player_guaranteed_draws.push({ tier: 1 });
    session.startCombat(null);
    session.finishCombat();
    session.startNextRound();

    // UNIQ est la SEULE carte du deck : une fois exclue, ni la pioche
    // normale ni la pioche garantie n'ont plus rien à rendre.
    expect(session.hand).toHaveLength(5);
  });

  // Mutation : supprimer `_forgetUniqueDraws` dans `mulligan` → ROUGE (la main
  // resterait vide, le pool étant épuisé par l'exclusion qu'on vient de poser).
  it('le mulligan rend la main au deck : une Unique qu\'on tenait redevient piochable', () => {
    const session = makeSession({ 1: [UNIQ] });

    session.startPreparation(); // main : [UNIQ]×5 — UNIQ est la seule carte
    expect(session.hand).toHaveLength(5);

    session.mulligan();
    // La même carte peut revenir : le mulligan l'a rendue au deck. Sans
    // `_forgetUniqueDraws`, le pool serait vide et la main le resterait.
    expect(session.hand).toHaveLength(5);
    expect(session.hand.every(c => c.id === 'UNIQ')).toBe(true);
  });
});

// ── EnemyAI — même règle côté adversaire ────────────────────────────────────
describe('EnemyAI — même exclusion côté adversaire', () => {
  const cardDb = { getCard: (id: string) => (id === 'UNIQ' ? UNIQ : id === 'NORMAL' ? NORMAL : null) };
  const isUnique = (card: any) => card.id === 'UNIQ';

  it('ne repioche pas une Unique déjà tirée', () => {
    // Le deck ne porte QU'UNIQ au tier 1 (`NORMAL` est tier 2, hors round 1) :
    // le premier appel la tire donc à chaque fois qu'il pioche (pool à une
    // seule carte, « avec remise » — pas ce que ce test éprouve). Ce qui
    // compte est le SECOND appel, une fois UNIQ enregistrée.
    const ai = new (EnemyAI as any)({ 1: ['UNIQ', 'NORMAL'] }, cardDb, 'enemy', () => 0);
    const first = ai.drawHand(1, null, 0, [], isUnique);
    expect(first.every((c: any) => c.id === 'UNIQ')).toBe(true);

    const second = ai.drawHand(1, null, 0, [], isUnique);
    expect(second).toEqual([]); // pool épuisé : plus rien à tier 1
  });

  it('sans le prédicat (comportement par défaut), aucune exclusion', () => {
    const ai = new (EnemyAI as any)({ 1: ['UNIQ', 'NORMAL'] }, cardDb, 'enemy', () => 0);
    ai.drawHand(1);
    const second = ai.drawHand(1);
    expect(second.filter((c: any) => c.id === 'UNIQ').length).toBeGreaterThan(0);
  });
});
