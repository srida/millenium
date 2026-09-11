/* eslint-disable @typescript-eslint/no-explicit-any */
// ÉTAPE 0 du moteur d'effets générique — la caractérisation du TERRAIN.
//
// Ce fichier ne décrit aucune règle nouvelle : il **fige ce que les 25 terrains
// livrés font aujourd'hui**, pour que le compilateur `terrain → Effet[]` de
// l'étape 1 puisse être diffé contre un oracle plutôt que contre une intention.
// Cf. `docs/moteur-effets.md` §6.
//
// ⚠️ La différence avec `board-effects.test.ts`, et c'est le partage à tenir :
// celui-là éprouve les RÈGLES sur des terrains synthétiques (le cumul additif,
// le OU du ciblage, le repli `effect` → `effects`) ; celui-ci éprouve le
// CATALOGUE. Une règle qui change casse le premier ; une donnée qui change
// casse le second. Les deux ne doivent jamais se recopier.
//
// ⚠️ Mesuré sur `initial-data/`. Le catalogue JOUÉ vit dans `data/`, sur le
// volume, que `bootstrap()` ne réécrit jamais — l'oracle vaut pour la donnée
// versionnée, pas pour celle de production.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { boardEffects, effectTargets, applyBoardEffects } from '../logic/BoardEffect.js';
import { boardTargetsUnits } from '../data/BoardInfo.js';
import { mirrorCells, mirrorRow } from '../logic/BoardMirror.js';
import { GameState } from '../logic/GameState.js';
import { Unit } from '../logic/Unit.js';
import { makeCard } from './helpers.js';
import type { BoardDef } from '../logic/types.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const boards: BoardDef[] = JSON.parse(readFileSync(path.join(ROOT, 'initial-data/boards.json'), 'utf8'));
const attributes: any[] = JSON.parse(readFileSync(path.join(ROOT, 'initial-data/attributes.json'), 'utf8'));
const ATTR_IDS = new Set(attributes.map(a => a.id));

/** Ce que `BoardEffect.applyEffect` sait exécuter — sa liste de `case`, en dur. */
const HANDLED = new Set(['stat_bonus', 'stat_modifier', 'shield', 'draw_bonus']);

/** Le board du jeu : 5 colonnes × 11 rangées (cf. `logic/Board.ts`). */
const COLS = 5;
const ROWS = 11;

// Tous les attributs que le catalogue vise réellement — le casting doit les
// couvrir, sinon la moitié des effets ne toucheraient personne et l'oracle
// figerait un silence.
const TARGETED = [...new Set(
  boards.flatMap(b => boardEffects(b).flatMap(e => e.target_attributes ?? [])),
)].sort();

// ⚠️ Les deux rythmes sont posés au MILIEU de l'échelle 0–100, et c'est
// délibéré : les bonus livrés vont de +5 à +7, un socle à 100 les écrêterait en
// silence (`clampRate`) et l'oracle figerait un non-effet. `range` a la même
// raison d'être à 3 plutôt qu'à 1 : le plancher à 1 de `_recomputeStats`
// mangerait un malus. L'échelle elle-même s'éprouve dans `speed-scale.test.ts` ;
// ici on veut seulement que chaque effet ait de la place pour se voir.
const BASE = { atk: 20, hp: 100, movement_rate: 50, attack_rate: 50, range: 3 };

function fresh(id: string, attrs: string[], side: 'player' | 'enemy'): Unit {
  return new (Unit as any)(
    makeCard({ id, attributes: attrs, stats: { ...BASE } as any }),
    side,
  ) as Unit;
}

/** Une unité par attribut visé, plus un témoin SANS attribut. */
function cast(side: 'player' | 'enemy'): Unit[] {
  const units = TARGETED.map(attr => fresh(`${side}:${attr}`, [attr], side));
  units.push(fresh(`${side}:aucun`, [], side));
  return units;
}

// ⚠️ Les champs observés sont ceux de la forme JOUÉE, pas ceux de la donnée :
// les deux rythmes voyagent en compteur (`*_rate`) mais le combat ne lit que la
// période en ticks (`*_period`), et c'est elle qui dit si l'unité agit plus
// souvent. Figer l'un sans l'autre laisserait passer une traduction cassée — un
// compteur qui monte pour une période qui ne bouge pas.
const WATCHED = [
  'atk', 'max_hp', 'current_hp', 'range', 'shield',
  'attack_rate', 'attack_period', 'movement_rate', 'movement_period',
] as (keyof Unit)[];

function snapshotOf(u: Unit): Record<string, number> {
  return Object.fromEntries(WATCHED.map(f => [f, u[f] as number]));
}

/** Ce qui a bougé sur une unité, en une ligne lisible — ou rien. */
function deltaOf(before: Record<string, number>, u: Unit): string | null {
  const parts = WATCHED
    .filter(f => before[f as string] !== (u[f] as number))
    .map(f => `${String(f)} ${before[f as string]}→${u[f]}`);
  return parts.length ? parts.join(', ') : null;
}

describe('Terrains livrés — invariants du catalogue', () => {
  it('les 25 terrains sont là, et chacun porte au moins un effet', () => {
    expect(boards).toHaveLength(25);
    for (const b of boards) expect(boardEffects(b).length).toBeGreaterThan(0);
  });

  // ⚠️ LE garde-fou de l'étape 0 : un type que `applyEffect` n'exécute pas est
  // un effet MORT — écrit en donnée, appliqué sans erreur, sans effet en jeu.
  // C'est la seconde famille d'effets morts (cf. §1.4 du doc), attrapée ici au
  // niveau de la donnée pour qu'elle ne puisse plus jamais être livrée.
  // Mutation : un `type: 'revive'` glissé dans un terrain → ROUGE.
  it('aucun effet ne porte un type que le moteur n\'exécute pas', () => {
    const morts = boards.flatMap(b => boardEffects(b)
      .filter(e => !HANDLED.has(e.type))
      .map(e => `${b.id} ${b.name} → ${e.type}`));
    expect(morts).toEqual([]);
  });

  // ⚠️ La PREMIÈRE famille d'effets morts, au niveau de la donnée : `BOARD_008`,
  // `009`, `010` et `025` écrivaient une vitesse que `_recomputeStats` ne
  // relisait pas — l'effet s'appliquait sans erreur et ne faisait rien.
  //
  // ⚠️ La vérification est une SONDE, pas une table de noms recopiée : on pose
  // le bonus sur une unité neuve et on demande si quoi que ce soit a bougé. Une
  // liste en dur serait un inventaire de plus du vocabulaire des stats —
  // exactement la décorrélation entre registre d'écriture et registre de lecture
  // qui a produit la panne. La sonde suit le moteur sans qu'on l'y aide, et une
  // stat ajoutée au jeu n'a rien à venir déclarer ici.
  //
  // ⚠️ Vaut pour les TERRAINS, dont aucun ne nomme `power_charge` — la seule
  // stat du jeu qui ne passe pas par `_recomputeStats` (le combat la lit
  // directement dans `_stat_bonuses`). Un terrain qui s'en servirait ferait
  // rougir ce test à tort : c'est alors l'exception qu'il faudra écrire, en la
  // documentant, pas la sonde qu'il faudra affaiblir.
  // Mutation : `stat: 'vitesse'` sur un terrain → ROUGE.
  it('toute stat nommée par un terrain bouge quelque chose sur l\'unité', () => {
    const mortes: string[] = [];
    for (const b of boards) {
      for (const e of boardEffects(b)) {
        if (e.stat == null) continue;
        const u = fresh('sonde', [], 'player');
        const avant = snapshotOf(u);
        // Le signe n'importe pas : on cherche un mouvement, pas sa direction.
        u.applyStatBonus(e.stat, 7);
        if (deltaOf(avant, u) === null) mortes.push(`${b.id} ${b.name} → ${e.stat}`);
      }
    }
    expect(mortes).toEqual([]);
  });

  // Un attribut mal saisi vise le vide : l'effet s'applique à zéro unité, en
  // silence. Même famille de panne, troisième forme.
  // Mutation : `target_attributes: ['ARCH_999']` sur un terrain → ROUGE.
  it('tout attribut visé existe au catalogue d\'attributs', () => {
    const inconnus = boards.flatMap(b => boardEffects(b)
      .flatMap(e => (e.target_attributes ?? [])
        .filter(a => !ATTR_IDS.has(a))
        .map(a => `${b.id} ${b.name} → ${a}`)));
    expect(inconnus).toEqual([]);
  });

  // Les cases bloquées sont de la donnée POSITIONNELLE : hors bornes, elles ne
  // bloquent rien et personne ne le dit.
  // Mutation : une case `{ col: 7, row: 2 }` → ROUGE.
  it('toute case bloquée est dans les bornes du board', () => {
    const hors = boards.flatMap(b => (b.blocked_cells ?? [])
      .filter(c => c.col < 0 || c.col >= COLS || c.row < 0 || c.row >= ROWS)
      .map(c => `${b.id} → ${c.col},${c.row}`));
    expect(hors).toEqual([]);
  });

  // ⚠️ Le contrat PvP : le rôle B joue le MIROIR du terrain. Un terrain dont le
  // miroir sortirait des bornes ferait diverger le duel.
  // Mutation : `MIRROR_AXIS` passé à 9 → ROUGE.
  it('le miroir de chaque terrain reste dans les bornes, et se rejoue à l\'identique', () => {
    for (const b of boards) {
      const cells = b.blocked_cells ?? [];
      const mirrored = mirrorCells(cells);
      expect(mirrored).toHaveLength(cells.length);
      for (const c of mirrored) {
        expect(c.row).toBeGreaterThanOrEqual(0);
        expect(c.row).toBeLessThan(ROWS);
        expect(c.col).toBe(cells[mirrored.indexOf(c)]?.col ?? c.col);
      }
      // Involution : miroiter deux fois rend le terrain d'origine.
      expect(mirrorCells(mirrored)).toEqual(cells.map(c => ({ col: c.col, row: mirrorRow(mirrorRow(c.row)) })));
    }
  });

  // ⚠️ Ce que l'annonce DIT ne peut pas contredire ce que l'effet FAIT — vérifié
  // ici sur les 25 terrains réels, là où `board-alert.test.ts` l'éprouve sur des
  // terrains synthétiques. Le décompte est l'UNION, jamais la somme.
  // Mutation : `terrainAlertFor` recomptant avec son propre filtre → ROUGE.
  it('le décompte annoncé est l\'union exacte des unités que les effets touchent', () => {
    for (const b of boards) {
      const units = cast('player');
      const visant = boardEffects(b).filter(boardTargetsUnits);
      const union = new Set<Unit>();
      for (const e of visant) for (const u of effectTargets(e, units)) union.add(u);

      const avant = units.map(snapshotOf);
      applyBoardEffects(b, { playerUnits: units, enemyUnits: [], gameState: new GameState() });
      const bouges = units.filter((u, i) => deltaOf(avant[i], u) !== null);

      // Toute unité qui a bougé était dans l'union annoncée. L'inverse n'est pas
      // vrai : un effet à `value: 0` toucherait sans rien changer.
      for (const u of bouges) expect(union.has(u)).toBe(true);
    }
  });
});

describe('Terrains livrés — l\'oracle de l\'étape 0', () => {
  // ⚠️ CE snapshot est le contrat que le moteur générique devra reproduire au
  // bit près. Il ne se met PAS à jour à la légère : une ligne qui bouge veut
  // dire que le terrain ne fait plus la même chose, ce qui est soit la donnée
  // qui a changé, soit une régression.
  it('ce que chacun des 25 terrains fait, figé', () => {
    const oracle = boards.map(b => {
      const player = cast('player');
      const enemy = cast('enemy');
      const gameState = new GameState();
      const avantP = player.map(snapshotOf);
      const avantE = enemy.map(snapshotOf);

      applyBoardEffects(b, { playerUnits: player, enemyUnits: enemy, gameState });

      const deltas = (units: Unit[], avant: Record<string, number>[]) => Object.fromEntries(
        units.map((u, i) => [u.card_id.split(':')[1], deltaOf(avant[i], u)])
          .filter(([, d]) => d !== null),
      );

      return {
        id: b.id,
        nom: b.name,
        effets: boardEffects(b).map(e => [
          e.type,
          e.stat ?? null,
          e.value ?? null,
          (e.target_attributes ?? []).join('|') || 'tous',
        ].join(' · ')),
        cases_bloquees: (b.blocked_cells ?? []).length,
        joueur: deltas(player, avantP),
        ennemi: deltas(enemy, avantE),
        pioches: gameState.player_extra_draws,
        sources_pioche: gameState.player_draw_sources.map(s => `${s.kind}:${s.ref}:${s.value}`),
      };
    });

    expect(oracle).toMatchSnapshot();
  });

  // ⚠️ Le pendant du snapshot, et il n'est pas redondant : le snapshot dit CE
  // QUI arrive, celui-ci dit que RIEN d'autre n'arrive. Sans lui, un effet qui
  // se mettrait à toucher le camp adverse passerait pour une simple ligne de
  // plus dans le snapshot qu'on accepterait sans y penser.
  // Mutation : `draw_bonus` créditant les deux camps → ROUGE.
  it('aucun terrain ne crédite de ressource au camp adverse', () => {
    for (const b of boards) {
      const gameState = new GameState();
      applyBoardEffects(b, { playerUnits: [], enemyUnits: cast('enemy'), gameState });
      expect(gameState.enemy_extra_draws).toBe(0);
      expect(gameState.enemy_guaranteed_draws).toEqual([]);
      expect(gameState.player_board_slots).toBe(new GameState().player_board_slots);
    }
  });

  // Les quatre terrains de la première famille d'effets morts, nommément : ils
  // font désormais quelque chose, et le test dit QUOI.
  //
  // ⚠️ Le SENS a été retourné par la bascule vers le compteur 0–100 : ces
  // terrains portaient un `movement_speed` NÉGATIF, qui chiffrait une période en
  // ticks (moins de ticks = plus rapide). Ils portent maintenant un
  // `movement_rate` POSITIF, et un compteur qui monte accélère. Le jeu est le
  // même ; c'est le chiffre qui a cessé de mentir au joueur.
  // Mutation : `_recomputeStats` rendue à sa lecture de `_base` seul → ROUGE.
  it.each(['BOARD_008', 'BOARD_009', 'BOARD_010', 'BOARD_025'])(
    '%s applique enfin son bonus de vitesse de déplacement',
    (id) => {
      const b = boards.find(x => x.id === id)!;
      const effet = boardEffects(b).find(e => e.stat === 'movement_rate')!;
      expect(effet.value as number).toBeGreaterThan(0);

      const units = cast('player');
      const avant = units.map(snapshotOf);
      applyBoardEffects(b, { playerUnits: units, enemyUnits: [], gameState: new GameState() });

      const touchees = effectTargets(effet, units);
      expect(touchees.length).toBeGreaterThan(0);
      for (const u of touchees) {
        const i = units.indexOf(u);
        expect(u.movement_rate).toBe(BASE.movement_rate + (effet.value as number));
        // ⚠️ Le compteur ne suffit pas : ce que le combat lit est la PÉRIODE, et
        // c'est elle qui doit descendre. Un compteur qui monte sans que la
        // période bouge serait la panne d'origine, déplacée d'un cran.
        expect(u.movement_period).toBeLessThan(avant[i].movement_period);
      }
    },
  );
});
