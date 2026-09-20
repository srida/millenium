/* eslint-disable @typescript-eslint/no-explicit-any */
// APPELANT — chaque porteur promet la carte que SA carte nomme.
//
// ⚠️ **Ce n'est pas une invocation, c'est une pioche garantie** : même file
// (`player_guaranteed_draws`), même `Draw.resolveGuaranteedDraws`, même éditeur
// de critères. La seule chose qui n'existait pas avant lui, c'est que la charge
// utile de l'effet vit sur la CARTE et non sur l'effet — un attribut ordinaire
// promet la même chose à tous ses porteurs.
//
// D'où ce que ce fichier éprouve, et rien d'autre :
//   • deux Appelants côte à côte promettent DEUX choses différentes ;
//   • un porteur NEUTRALISÉ appelle quand même (il a démarré le combat) ;
//   • un porteur sans `appel` ne promet rien, et le dit.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AttributeManager } from '../logic/AttributeManager.js';
import { GameSession } from '../logic/GameSession.js';
import type { GameSessionDeps } from '../logic/GameSession.js';
import { compileAttributes } from '../logic/effects/compile.js';
import { makeCard, spawn, makeBoard } from './helpers.js';
import { tiersOf } from '../logic/Tiers.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const attributs: any[] = JSON.parse(readFileSync(path.join(ROOT, 'initial-data/attributes.json'), 'utf8'));
const cartes: any[] = JSON.parse(readFileSync(path.join(ROOT, 'initial-data/cards.json'), 'utf8'));

/** L'attribut Appelant, tel qu'il est LIVRÉ — jamais une copie écrite ici. */
const APPELANT = attributs.find(a => a.name === 'Appelant');

const CATALOGUE = [APPELANT, { id: 'NEUTRE', name: 'Neutre', categorie: 'Archetype', timing: 'none', thresholds: [] }];

function carte(id: string, attrs: string[] = [], appel?: any) {
  return makeCard({ id, attributes: attrs, appel, stats: { atk: 1, hp: 500, range: 1, attack_rate: 0, movement_rate: 0 } } as any);
}

/** Ce que `applyEndOfCombat` rend au joueur, sur un plateau monté à la main. */
function finDeCombat(joueur: any[], ennemi: any[], morts: any[] = []) {
  const mgr = new (AttributeManager as any)(CATALOGUE, joueur, ennemi);
  // ⚠️ `applyStartOfCombat` d'abord, TOUJOURS : c'est lui qui verrouille les
  // seuils. Sans lui, aucun palier n'est actif et le cas figerait un silence.
  mgr.applyStartOfCombat();
  return mgr.applyEndOfCombat(morts, []);
}

/** Les cartes promises par un résultat de fin de combat, à plat. */
const promesses = (r: any) => r.guaranteed_draws.flatMap((d: any) => d.card_ids ?? []);

describe('Appelant — la donnée livrée', () => {
  it('existe, en catégorie MotCle, et porte son unique effet sur un palier à 1', () => {
    expect(APPELANT, 'attribut « Appelant » absent du catalogue').toBeTruthy();
    expect(APPELANT.categorie).toBe('MotCle');
    expect(APPELANT.thresholds).toHaveLength(1);
    expect(APPELANT.thresholds[0].count).toBe(1);
    expect(APPELANT.thresholds[0].effects).toEqual([{ type: 'guaranteed_draw_bearer' }]);
  });

  // ⚠️ `end_of_combat` : la file des pioches garanties est consommée par le
  // `startPreparation()` du round SUIVANT. Sous tout autre timing,
  // `compileAttribute` refuse en « timing incohérent ».
  it('son timing est celui de la fin de combat', () => {
    expect(APPELANT.timing).toBe('end_of_combat');
  });

  // ⚠️ **L'effet ne porte AUCUN champ, et c'est la moitié du mot-clé** : les
  // critères vivent sur la carte. Un champ ici serait une seconde source pour
  // la même promesse.
  it('son effet ne porte aucun critère — ils sont sur la carte', () => {
    expect(Object.keys(APPELANT.thresholds[0].effects[0])).toEqual(['type']);
  });

  // ⚠️ Les deux moitiés vont par paire, et `npm run audit:cards` le vérifie sur
  // tout le catalogue (dans les deux sens). Ici on exige juste qu'il y ait bien
  // un témoin livré, sans quoi le mot-clé n'existerait que sur le papier.
  it('une carte au moins le porte, avec son appel, et appelle une carte connue', () => {
    const porteuses = cartes.filter(c => (c.attributes ?? []).includes(APPELANT.id));
    expect(porteuses.length).toBeGreaterThan(0);
    const ids = new Set(cartes.map(c => c.id));
    for (const c of porteuses) {
      expect(c.appel, `${c.id} porte Appelant sans appel`).toBeTruthy();
      for (const id of c.appel.card_ids ?? []) expect(ids.has(id), `${c.id} appelle ${id}, inconnu`).toBe(true);
    }
  });
});

describe('Appelant — ce que le compilateur en fait', () => {
  // ⚠️ Les deux sélecteurs ne répondent pas à la même question, et c'est tout
  // le cas : `cible` dit QUI REÇOIT (le joueur, sa file de pioches),
  // `criteresDesPorteurs` dit OÙ LIRE (les porteurs). Première fois du projet
  // que les deux réponses diffèrent.
  it('vise le joueur pour le crédit, et les porteurs pour les critères', () => {
    const { effets, refus } = compileAttributes(CATALOGUE, new Set(CATALOGUE.map((a: any) => a.id)));
    expect(refus).toEqual([]);
    expect(effets).toHaveLength(1);
    const [tache] = (effets[0] as any).taches;
    expect(tache.champ).toBe('pioches_garanties');
    expect(tache.cible.conteneur).toBe('joueur');
    expect(tache.criteres).toBeUndefined();
    expect(tache.criteresDesPorteurs).toEqual({
      conteneur: 'board', camp: 'allie',
      filtre: { attributs: [APPELANT.id], inclureNeutralisees: true },
      combien: 'tous',
    });
  });
});

describe('Appelant — en fin de combat', () => {
  /**
   * LE cas du mot-clé : deux porteurs, deux promesses DIFFÉRENTES.
   *
   * Mutation : écrire les critères dans la tâche (le geste de
   * `guaranteed_draw`) au lieu de les lire sur chaque porteur → ROUGE, les deux
   * appels deviennent le même.
   */
  it('chaque porteur promet ce que SA carte nomme', () => {
    const board = makeBoard();
    const a = spawn(board, carte('A', [APPELANT.id], { card_ids: ['APPELEE_A'] }) as any, 'player', { col: 0, row: 0 });
    const b = spawn(board, carte('B', [APPELANT.id], { card_ids: ['APPELEE_B'] }) as any, 'player', { col: 1, row: 0 });
    const e = spawn(board, carte('E', ['NEUTRE']) as any, 'enemy', { col: 0, row: 10 });

    expect(promesses(finDeCombat([a, b], [e])).sort()).toEqual(['APPELEE_A', 'APPELEE_B']);
  });

  // Le témoin : une unité ordinaire ne promet rien.
  it('une unité SANS le mot-clé ne promet rien', () => {
    const board = makeBoard();
    const u = spawn(board, carte('U', ['NEUTRE'], { card_ids: ['JAMAIS'] }) as any, 'player', { col: 0, row: 0 });
    const e = spawn(board, carte('E', ['NEUTRE']) as any, 'enemy', { col: 0, row: 10 });

    expect(finDeCombat([u], [e]).guaranteed_draws).toEqual([]);
  });

  /**
   * ⚠️ **Le porteur mort appelle quand même**, et c'est la RÈGLE, pas une
   * tolérance : « chaque round où l'unité appelante démarre la phase de combat ».
   * À `fin_combat`, `unitesAlliees` porte exactement ceux qui l'ont commencé
   * (`AttributeManager` garde ses tableaux, `finishCombat` fait le ménage
   * après) — d'où `inclureNeutralisees` sur le sélecteur.
   * Mutation : retirer `inclureNeutralisees` → ROUGE.
   */
  it('un porteur NEUTRALISÉ pendant le combat appelle quand même', () => {
    const board = makeBoard();
    const mort = spawn(board, carte('MORT', [APPELANT.id], { card_ids: ['APPELEE'] }) as any, 'player', { col: 0, row: 0 });
    const e = spawn(board, carte('E', ['NEUTRE']) as any, 'enemy', { col: 0, row: 10 });
    mort.is_neutralized = true;
    mort.current_hp = 0;

    expect(promesses(finDeCombat([mort], [e], [mort]))).toEqual(['APPELEE']);
  });

  /**
   * ⚠️ Un porteur sans `appel` ne promet RIEN — jamais une pioche « au choix »,
   * qui serait une promesse inventée à sa place. C'est le cas que
   * `npm run audit:cards` nomme dans les deux sens.
   * Mutation : retomber sur `{}` faute d'appel → ROUGE (une promesse vide part).
   */
  it('un porteur sans appel ne promet rien', () => {
    const board = makeBoard();
    const muet = spawn(board, carte('MUET', [APPELANT.id]) as any, 'player', { col: 0, row: 0 });
    const e = spawn(board, carte('E', ['NEUTRE']) as any, 'enemy', { col: 0, row: 10 });

    expect(finDeCombat([muet], [e]).guaranteed_draws).toEqual([]);
  });

  /**
   * ⚠️ **L'IA porte le mot-clé comme un vrai joueur** : le moteur accumule pour
   * les deux camps sans drapeau d'asymétrie, et la pioche a bien un destinataire
   * côté adverse (`EnemyAI.drawHand`). Ce qui n'en a pas — slot, multiplicateur,
   * Shopping — n'est pas ce mot-clé.
   */
  it('un Appelant adverse remplit la file de l\'IA, pas celle du joueur', () => {
    const board = makeBoard();
    const moi = spawn(board, carte('MOI', ['NEUTRE']) as any, 'player', { col: 0, row: 0 });
    const lui = spawn(board, carte('LUI', [APPELANT.id], { card_ids: ['APPELEE_IA'] }) as any, 'enemy', { col: 0, row: 10 });

    const r = finDeCombat([moi], [lui]);
    expect(r.guaranteed_draws).toEqual([]);
    expect(r.enemy_guaranteed_draws.flatMap((d: any) => d.card_ids ?? [])).toEqual(['APPELEE_IA']);
  });
});

describe('Appelant — le tour d\'après', () => {
  /**
   * Le trajet COMPLET, et la seule preuve que la promesse est tenue : un round
   * joué de bout en bout, puis la carte appelée dans la main du tour suivant.
   *
   * ⚠️ Le deck ne contient que des cartes de tier 3, sauf l'appelée qui est de
   * tier 5 : le round 2 ne tire que dans les tiers 1–2, donc la seule façon
   * qu'elle a d'entrer en main est la pioche GARANTIE, qui ignore la
   * restriction de tier du tour. Sans ce décalage, le cas passerait au vert sur
   * un tirage ordinaire.
   */
  it('la carte appelée entre en main au tour suivant', () => {
    const appelee = makeCard({ id: 'APPELEE', tier: 5, summon_conditions: [] });
    const ordinaire = makeCard({ id: 'ORDINAIRE', tier: 3, summon_conditions: [] });
    const deck = [appelee, ordinaire];
    const byTier: Record<number, any[]> = {};
    for (const c of deck) for (const t of tiersOf(c)) (byTier[t] ??= []).push(c);

    const deps: GameSessionDeps = {
      cardsByTier: byTier,
      enemyDeck: {},
      attributeList: CATALOGUE as any,
      cardDb: { getCard: (id: string) => (deck.find(c => c.id === id) as any) ?? null },
      getAllBoards: () => [],
      getAllMagies: () => [],
    };
    const session = new GameSession(deps);
    session.startPreparation();

    const appelant = spawn(session.board, carte('APPELANT_1', [APPELANT.id], { card_ids: ['APPELEE'] }) as any, 'player', { col: 0, row: 0 });
    (session as any)._combatPlayerUnits = [appelant];
    session.startCombat(null);
    (session as any)._combat.isOver = true;
    (session as any)._combat.winner = 'player';
    session.finishCombat();

    expect(session.gameState.player_guaranteed_draws.map((d: any) => d.card_ids))
      .toEqual([['APPELEE']]);

    const draw = session.startPreparation();
    expect(draw.guaranteed).toHaveLength(1);
    expect(session.hand.some(c => c.id === 'APPELEE'), 'la carte appelée n\'est pas entrée en main').toBe(true);
  });
});
