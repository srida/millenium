/* eslint-disable @typescript-eslint/no-explicit-any */
// ÉTAPE 1 du moteur d'effets générique — LE MODE OMBRE, sur le terrain.
//
// Les deux chemins s'exécutent sur le même monde et on **compare l'état**, pas
// l'intention : le moteur actuel (`BoardEffect.applyBoardEffects`) d'un côté, le
// compilateur + le moteur générique de l'autre. Cf. `docs/moteur-effets.md` §6.
//
// ⚠️ C'est le geste de `CombatRecorder` appliqué aux effets, et il en porte la
// leçon la plus chère : **un outil de diagnostic qui crie au loup sur les cas
// sains est pire qu'un outil absent.** D'où la comparaison sur l'état final des
// unités et des ressources, jamais sur la forme des tâches — deux chemins qui
// écrivent le même état par des routes différentes sont d'accord, et c'est tout
// ce qu'on leur demande.
//
// ⚠️ Le critère d'acceptation de l'étape 1 est **zéro refus et zéro écart** sur
// les 25 terrains livrés. Tant qu'il n'est pas tenu, aucune bascule (étape 2) ne
// peut commencer : on ne remplace pas un chemin par un autre tant qu'on n'a pas
// prouvé qu'ils disent la même chose.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyBoardEffects, boardEffects } from '../logic/BoardEffect.js';
import { compileBoard, compileBoards } from '../logic/effects/compile.js';
import { executer, ressourcesVides } from '../logic/effects/engine.js';
import type { Ressources } from '../logic/effects/engine.js';
import { cleDeTri, QUANDS, ACTIONS, DUREES } from '../logic/effects/types.js';
import { GameState } from '../logic/GameState.js';
import { Unit } from '../logic/Unit.js';
import { makeCard } from './helpers.js';
import type { BoardDef } from '../logic/types.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const boards: BoardDef[] = JSON.parse(readFileSync(path.join(ROOT, 'initial-data/boards.json'), 'utf8'));

/** Le même casting que l'oracle de l'étape 0 — un porteur par attribut visé. */
const TARGETED = [...new Set(
  boards.flatMap(b => boardEffects(b).flatMap(e => e.target_attributes ?? [])),
)].sort();

const BASE = { atk: 20, hp: 100, movement_rate: 50, attack_rate: 50, range: 3 };

function cast(side: 'player' | 'enemy'): Unit[] {
  const units = TARGETED.map(attr => new (Unit as any)(
    makeCard({ id: `${side}:${attr}`, attributes: [attr], stats: { ...BASE } as any }), side,
  ) as Unit);
  units.push(new (Unit as any)(
    makeCard({ id: `${side}:aucun`, attributes: [], stats: { ...BASE } as any }), side,
  ) as Unit);
  return units;
}

/**
 * L'état observable après application — **ce que les deux chemins doivent
 * rendre identique**.
 *
 * ⚠️ On lit les compteurs ET les périodes : un chemin qui poserait le bon
 * compteur sans que la période bouge aurait écrit dans le mauvais registre, et
 * c'est exactement la panne que tout ce chantier existe pour rendre visible.
 */
function etat(player: Unit[], enemy: Unit[], g: GameState) {
  const u = (x: Unit) => [
    x.card_id, `atq ${x.atk}`, `pv ${x.current_hp}/${x.max_hp}`, `por ${x.range}`,
    `vit ${x.attack_rate}/${x.attack_period}t`, `dep ${x.movement_rate}/${x.movement_period}t`,
    `bcl ${x.shield}`,
  ].join(' · ');
  return {
    joueur: player.map(u),
    ennemi: enemy.map(u),
    pioches: g.player_extra_draws,
    sources: g.player_draw_sources.map((s: any) => `${s.kind}:${s.ref}:${s.value}`),
    slots: g.player_board_slots,
    pv: g.player_hp,
  };
}

/** Joue un terrain par le chemin ACTUEL et rend l'état. */
function cheminActuel(b: BoardDef) {
  const player = cast('player');
  const enemy = cast('enemy');
  const g = new GameState();
  applyBoardEffects(b, { playerUnits: player, enemyUnits: enemy, gameState: g });
  return etat(player, enemy, g);
}

/**
 * Verse un accumulateur de ressources dans un `GameState`.
 *
 * ⚠️ Le moteur n'écrit PAS dans `GameState` (cf. l'en-tête d'`engine.ts`) : il
 * accumule, et l'appelant verse. C'est ce qui lui permet d'exprimer le
 * `damage_multiplier_bonus` d'un attribut, qui n'a aucun champ où se poser.
 * Cette fonction est donc le pendant, côté terrain, de ce que
 * `GameState.applyEndOfCombat` fait côté attribut — et elle en est le modèle
 * pour l'étape 2.
 */
function verser(r: Ressources, g: GameState): void {
  g.player_extra_draws += r.pioches;
  g.player_draw_sources.push(...r.sources);
  g.player_guaranteed_draws.push(...r.pioches_garanties);
  if (r.slots_board) g.grantLimitedBoardSlotBonus(r.slots_board);
  g.player_extra_shopping_magies += r.magies_shop;
  g.player_hp += r.pv;
}

/** Joue le même terrain par le chemin COMPILÉ et rend l'état. */
function cheminCompile(b: BoardDef) {
  const player = cast('player');
  const enemy = cast('enemy');
  const g = new GameState();
  const ressources = ressourcesVides();
  const { effets } = compileBoard(b);
  const trace = executer(effets, 'debut_combat', {
    unitesAlliees: player, unitesEnnemies: enemy, ressources,
  });
  verser(ressources, g);
  return { etat: etat(player, enemy, g), trace };
}

describe('Mode ombre — le compilateur de terrain', () => {
  // ⚠️ LE critère d'acceptation de l'étape 1, côté compilation : un effet que le
  // compilateur ne sait pas traduire est **rapporté**, jamais ignoré. C'est la
  // différence de fond avec les `switch` d'aujourd'hui, dont chaque `default`
  // est muet — la mécanique exacte des vingt-et-un effets morts.
  // Mutation : retirer le `case 'shield'` du compilateur → ROUGE.
  it('les 25 terrains livrés compilent SANS AUCUN refus', () => {
    const { effets, refus } = compileBoards(boards);
    expect(refus).toEqual([]);
    // Un effet compilé par effet source : le compilateur ne fusionne ni ne
    // duplique. C'est ce qui rend le diff de l'étape 2 lisible.
    const sources = boards.reduce((n, b) => n + boardEffects(b).length, 0);
    expect(effets).toHaveLength(sources);
  });

  // ⚠️ LE critère d'acceptation de l'étape 1, côté exécution. C'est ce test qui
  // autorise la bascule du terrain : tant qu'il est vert, remplacer un chemin
  // par l'autre ne change rien d'observable.
  //
  // ⚠️ Il ne couvre que ce que le CATALOGUE porte — `stat_bonus` et `shield`.
  // Les deux autres branches du compilateur ont leur propre bloc plus bas ; ne
  // pas attendre de ce cas-ci qu'il voie une régression du multiplicateur ou de
  // la pioche, il n'en a aucun exemplaire à jouer.
  // Mutation : `duree: 'partie'` sur les bonus de stat → ROUGE (le registre
  // change, donc `resetCombatStats` ne nettoie plus).
  it.each(boards.map(b => [b.id, b.name] as const))(
    '%s %s — les deux chemins rendent le MÊME état',
    (id) => {
      const b = boards.find(x => x.id === id)!;
      expect(cheminCompile(b).etat).toEqual(cheminActuel(b));
    },
  );

  // Le moteur ne doit rien laisser tomber en route : une tâche qu'aucun registre
  // ne sait écrire est tracée. Sur les terrains livrés, il n'y en a aucune.
  it('aucune tâche n\'est ignorée à l\'exécution', () => {
    const ignores = boards.flatMap(b => cheminCompile(b).trace.ignore.map(x => `${b.id} → ${x}`));
    expect(ignores).toEqual([]);
  });

  // ⚠️ Le pendant du test d'égalité : deux chemins qui ne font RIEN sont
  // d'accord, et cet accord-là ne prouve rien. On exige donc que le chemin
  // compilé ait effectivement écrit quelque chose pour chaque terrain.
  // Mutation : `executer` rendant une trace vide → ROUGE.
  it('le chemin compilé écrit vraiment quelque chose, sur chacun des 25', () => {
    const muets = boards
      .filter(b => cheminCompile(b).trace.applique.length === 0)
      .map(b => `${b.id} ${b.name}`);
    expect(muets).toEqual([]);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Les deux types que le CATALOGUE n'exerce pas
//
// ⚠️ Les 25 terrains livrés ne portent que `stat_bonus` (31×) et `shield` (2×).
// `stat_modifier` et `draw_bonus` sont **codés des deux côtés et exercés par
// aucun** : le mode ombre ci-dessus, joué sur le seul catalogue, ne prouverait
// donc que la moitié du compilateur — et le jour où un terrain multiplicateur
// serait écrit en admin, il partirait sans qu'aucun test ne l'ait vu passer.
//
// D'où ces terrains SYNTHÉTIQUES : ils n'existent pas dans la donnée, ils
// existent pour que les quatre branches du compilateur soient comparées au
// moteur actuel. C'est le pendant exact du partage entre
// `board-characterization.test.ts` (le catalogue) et `board-effects.test.ts`
// (les règles) — ici, les règles.
// ───────────────────────────────────────────────────────────────────────────

const SYNTHETIQUES: BoardDef[] = [
  {
    id: 'SYNTH_MULT', name: 'Multiplicateur',
    effects: [{ type: 'stat_modifier', stat: 'hp', value: 2, target_attributes: [TARGETED[0]] }],
  },
  {
    id: 'SYNTH_MULT2', name: 'Deux multiplicateurs',
    // ⚠️ Le cas qui vaut à lui seul le déplacement : deux « ×2 PV » donnent
    // **×3**, jamais ×4. Les deux écrivent dans le registre additif depuis le
    // même socle `_base`, ils ne se composent donc pas — et c'est ce qui rend le
    // résultat indépendant de l'ordre de la liste. Un moteur qui appliquerait
    // les multiplicateurs l'un sur l'autre donnerait ×4 et dépendrait de l'ordre
    // d'écriture en admin.
    effects: [
      { type: 'stat_modifier', stat: 'hp', value: 2, target_attributes: [TARGETED[0]] },
      { type: 'stat_modifier', stat: 'hp', value: 2, target_attributes: [TARGETED[0]] },
    ],
  },
  {
    id: 'SYNTH_MULT_ATQ', name: 'Multiplicateur d\'attaque',
    effects: [{ type: 'stat_modifier', stat: 'atk', value: 3 }],
  },
  {
    id: 'SYNTH_PIOCHE', name: 'Pioche',
    effects: [{ type: 'draw_bonus', value: 2 }],
  },
  {
    id: 'SYNTH_MIXTE', name: 'Mixte',
    effects: [
      { type: 'stat_bonus', stat: 'atk', value: 10, target_attributes: [TARGETED[1]] },
      { type: 'stat_modifier', stat: 'hp', value: 2 },
      { type: 'shield', value: 25, target_attributes: [TARGETED[1]] },
      { type: 'draw_bonus', value: 1 },
    ],
  },
] as any;

describe('Mode ombre — les branches que le catalogue n\'exerce pas', () => {
  it.each(SYNTHETIQUES.map(b => [b.id, b.name] as const))(
    '%s %s — les deux chemins rendent le MÊME état',
    (id) => {
      const b = SYNTHETIQUES.find(x => x.id === id)!;
      expect(cheminCompile(b).etat).toEqual(cheminActuel(b));
    },
  );

  // ⚠️ Le `draw_bonus` porte un INVARIANT que l'égalité d'état seule ne
  // montrerait pas bien : `sum(sources.value) === extraDraws`, vérifié par
  // `draw-summary.test.ts`. Un quatrième émetteur qui oublierait de s'inscrire
  // ferait annoncer au joueur un « +2 » venu de nulle part — le moteur
  // générique est précisément un quatrième émetteur.
  // Mutation : retirer le `player_draw_sources.push` du moteur → ROUGE.
  it('le moteur inscrit sa PROVENANCE en même temps que le crédit', () => {
    for (const b of SYNTHETIQUES) {
      const player = cast('player');
      const g = new GameState();
      const ressources = ressourcesVides();
      const { effets } = compileBoard(b);
      executer(effets, 'debut_combat', { unitesAlliees: player, unitesEnnemies: [], ressources });
      verser(ressources, g);
      const somme = g.player_draw_sources.reduce((n: number, s: any) => n + s.value, 0);
      expect(somme, b.id).toBe(g.player_extra_draws);
      // Et la source nomme bien le terrain, jamais une chaîne vide.
      for (const s of g.player_draw_sources) expect(s.ref, b.id).toBe(b.id);
    }
  });

  // Le multiplicateur est converti en additif par le MOTEUR, pas par le
  // compilateur : le schéma garde l'intention (`*`), ce que l'admin écrira.
  it('le schéma garde l\'intention « × », le moteur fait la conversion', () => {
    const { effets } = compileBoard(SYNTHETIQUES[0]);
    expect((effets[0].taches[0] as any).operateur).toBe('*');
    expect((effets[0].taches[0] as any).valeur).toBe(2);
  });
});

describe('Mode ombre — les invariants du schéma', () => {
  // ⚠️ INVARIANT §5.1 : l'ordre de résolution est ABSOLU, jamais celui
  // d'insertion. Deux clients PvP compilent la même donnée et doivent en tirer
  // le même ordre.
  //
  // ⚠️ Ce qu'on observe est la SÉQUENCE de la trace, pas l'état final : sur le
  // terrain, tout est additif, donc l'état ne dépend PAS de l'ordre — comparer
  // des états laisserait passer un moteur sans tri, et le test serait
  // tautologique (première écriture de ce cas : elle comparait deux ensembles
  // triés à eux-mêmes, et ne tombait sur aucune mutation).
  //
  // Le jour où une tâche non commutative arrivera (`=`, `remplacer`, une
  // position), l'état en dépendra — et c'est trop tard pour s'en apercevoir
  // alors. La trace le prouve dès maintenant.
  // Mutation : `executer` sans son `.sort()` → ROUGE.
  it('la séquence de résolution ne dépend pas de l\'ordre d\'arrivée', () => {
    const monde = () => ({
      unitesAlliees: cast('player'), unitesEnnemies: cast('enemy'), ressources: ressourcesVides(),
    });
    const tous = compileBoards([...boards, ...SYNTHETIQUES]).effets;
    const endroit = executer(tous, 'debut_combat', monde()).applique;
    const envers = executer([...tous].reverse(), 'debut_combat', monde()).applique;
    // Un mélange déterministe, pour ne pas ne prouver que le cas « à l'envers ».
    const melange = tous.map((e, i) => ({ e, k: (i * 7919) % tous.length }))
      .sort((a, b) => a.k - b.k).map(x => x.e);
    const brasse = executer(melange, 'debut_combat', monde()).applique;

    expect(envers).toEqual(endroit);
    expect(brasse).toEqual(endroit);
    // Et la séquence n'est pas vide, sans quoi l'égalité ne prouverait rien.
    expect(endroit.length).toBeGreaterThan(50);
  });

  // Une clé de tri qui se répète ferait dépendre l'ordre du tri lui-même
  // (`localeCompare` n'est pas stable entre moteurs sur des clés égales).
  it('deux effets n\'ont jamais la même clé de tri', () => {
    const cles = compileBoards(boards).effets.map(cleDeTri);
    expect(new Set(cles).size).toBe(cles.length);
  });

  // ⚠️ INVARIANT §5.2 : le moteur ne touche à `Math.random` nulle part. Aucune
  // tâche compilée aujourd'hui ne consomme de hasard — et le vérifier vaut la
  // peine, parce que le jour où l'une en consommera, le nombre d'appels devra
  // être stable (les golden tests de `sim/` et le filet PvP en dépendent).
  // Mutation : un `Math.random()` dans `executer` → ROUGE.
  it('l\'exécution ne consomme AUCUN hasard', () => {
    const vrai = Math.random;
    let appels = 0;
    Math.random = () => { appels++; return 0.5; };
    try {
      for (const b of boards) cheminCompile(b);
    } finally {
      Math.random = vrai;
    }
    expect(appels).toBe(0);
  });

  // Les tables du vocabulaire sont FERMÉES : c'est ce qui permet à un effet
  // intraduisible de ne pas compiler, au lieu de se taire à l'exécution.
  it('les tables du vocabulaire sont fermées et non vides', () => {
    for (const table of [QUANDS, ACTIONS, DUREES]) {
      expect(table.length).toBeGreaterThan(0);
      expect(new Set(table).size).toBe(table.length);
    }
    // Les sept actions du §4.1, ni plus ni moins.
    expect(ACTIONS).toHaveLength(7);
  });

  // ⚠️ Le compilateur REFUSE ce qu'il ne sait pas traduire, et c'est ce refus
  // qui est la fonctionnalité. Éprouvé sur un terrain synthétique : un type
  // inconnu et une stat sans champ effectif sortent tous deux en refus nommé,
  // là où les deux moteurs actuels les appliqueraient « sans erreur ».
  it('un effet intraduisible est REFUSÉ, nommément, jamais ignoré', () => {
    const bancal = {
      id: 'BOARD_TEST', name: 'Bancal',
      effects: [
        { type: 'revive', value: 1 },
        { type: 'stat_bonus', stat: 'vitesse', value: 5 },
        { type: 'stat_bonus', stat: 'atk', value: 5 },
      ],
    } as any;
    const { effets, refus } = compileBoard(bancal);
    expect(refus.map(r => r.raison)).toEqual(['type non traduit', 'champ inconnu']);
    expect(refus.map(r => r.detail)).toEqual(['revive', "stat_bonus → stat 'vitesse'"]);
    // Le troisième, lui, compile : un refus n'emporte pas ses voisins.
    expect(effets).toHaveLength(1);
  });
});
