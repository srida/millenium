/* eslint-disable @typescript-eslint/no-explicit-any */
// ÉTAPE 1 du moteur d'effets générique — LE MODE OMBRE, sur les MAGIES.
//
// Le troisième porteur, et **celui où le moteur générique paie le moins**. Ce
// n'est pas un jugement, c'est une mesure : 13 des 23 types ne portent qu'UNE
// magie (§1.1), donc « généraliser » y revient souvent à donner un nom générique
// à un cas unique. Cf. `docs/moteur-effets.md` §6.4.
//
// Ce fichier a donc deux rôles, et le second vaut autant que le premier :
//   1. prouver que ce qui compile produit le MÊME état que `GameSession` ;
//   2. **pinner exactement ce qui ne compile pas, et pourquoi** — c'est la
//      donnée sur laquelle décider si la bascule des magies vaut la chandelle.
//
// ⚠️ Le chemin actuel passe par une vraie `GameSession`, pas par `applyEffect`
// seul : 11 des 23 types vivent dans la session. Comparer au seul `MagieEffect`
// prouverait une moitié de porteur.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GameSession } from '../logic/GameSession.js';
import type { GameSessionDeps } from '../logic/GameSession.js';
import { compileMagie, compileMagies } from '../logic/effects/compile.js';
import { executer, ressourcesVides } from '../logic/effects/engine.js';
import type { Ressources } from '../logic/effects/engine.js';
import { needsUnitTarget, needsGraveyardTarget, needsHandTarget } from '../logic/MagieEffect.js';
import { Unit } from '../logic/Unit.js';
import { makeRandom, hashSeed } from '../logic/Random.js';
import { makeCard } from './helpers.js';
import { tiersOf } from '../logic/Tiers.js';
import type { Magie } from '../logic/types.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const read = (f: string) => JSON.parse(readFileSync(path.join(ROOT, 'initial-data', f), 'utf8'));
const magies: Magie[] = read('magies.json');
const attributes: any[] = read('attributes.json');

// Le même plateau d'essai que l'oracle de l'étape 0 — chaque pièce répond d'une
// famille de magies.
const DECK = [
  ...[1, 2, 3, 4, 5].map(t => makeCard({
    id: `DECK_T${t}`, name: `Socle T${t}`, tier: t,
    stats: { atk: 10 * t, hp: 100 * t, movement_rate: 50, attack_rate: 50, range: 2 } as any,
    summon_conditions: [],
  })),
  makeCard({
    id: 'DECK_POUVOIR', name: 'Porteur', tier: 2,
    stats: { atk: 20, hp: 200, movement_rate: 50, attack_rate: 50, range: 3 } as any,
    power: { id: 'POWER_HEAL', power_rate: 40 } as any, summon_conditions: [],
  }),
];
const BY_ID = new Map(DECK.map(c => [c.id, c]));
const BY_TIER: Record<number, any[]> = {};
for (const c of DECK) for (const t of tiersOf(c as any)) (BY_TIER[t] ??= []).push(c);

const PLACES = ['DECK_T1', 'DECK_POUVOIR', 'DECK_T2'];

function makeSession(): GameSession {
  const deps: GameSessionDeps = {
    cardsByTier: BY_TIER, enemyDeck: {}, attributeList: attributes,
    cardDb: { getCard: (id: string) => (BY_ID.get(id) as any) ?? null } as any,
    getAllBoards: () => [], getAllMagies: () => [], rand: makeRandom(hashSeed('ombre-magies')),
  };
  const s = new GameSession(deps);
  s.startPreparation();
  s.hand = [BY_ID.get('DECK_T1')!, BY_ID.get('DECK_T2')!] as any[];
  PLACES.forEach((id, col) => {
    const u = new (Unit as any)(BY_ID.get(id), 'player') as Unit;
    s.board.placeUnit(u, { col, row: 0 });
    u.current_hp = Math.max(1, Math.round(u.max_hp / 2));
  });
  const mort = new (Unit as any)(BY_ID.get('DECK_T2'), 'player') as Unit;
  mort.is_neutralized = true; mort.current_hp = 0;
  s.graveyard.push(mort);
  s.gameState.player_hp = 700;
  return s;
}

/** Les mêmes unités, hors session, pour le chemin compilé. */
function monde() {
  const alliees = PLACES.map((id, col) => {
    const u = new (Unit as any)(BY_ID.get(id), 'player') as Unit;
    u.position = { col, row: 0 };
    u.current_hp = Math.max(1, Math.round(u.max_hp / 2));
    return u;
  });
  const mort = new (Unit as any)(BY_ID.get('DECK_T2'), 'player') as Unit;
  mort.is_neutralized = true; mort.current_hp = 0;
  return { alliees, neutralisees: [mort] };
}

function etatUnite(u: Unit): string {
  return [
    u.card_id, `pv ${u.current_hp}/${u.max_hp}`, `atq ${u.atk}`,
    `dep ${u.movement_rate}`, `vit ${u.attack_rate}`, `por ${u.range}`, `bcl ${u.shield}`,
    `pouvoir ${u.power_id ?? '—'}:${u.power_rate ?? '—'}:${u.power_value ?? '—'}:${u.power_duration ?? '—'}`,
  ].join(' · ');
}

function garanties(list: any[]): string[] {
  return list.map(d => [d.tier ?? '—', (d.attributes ?? []).join('|') || (d.attribute ?? '—'), (d.card_ids ?? []).join('|') || '—'].join(':'));
}

/** Le chemin ACTUEL — une vraie `GameSession`, par la famille de ciblage. */
function cheminActuel(m: Magie) {
  const s = makeSession();
  const avantPv = s.gameState.player_hp;
  if (needsUnitTarget(m as any)) {
    // La PREMIÈRE cible recevable, jamais un choix de l'oracle : la session
    // porte déjà la règle (`power_cooldown` ne vise que les porteurs de pouvoir).
    const cibles = s.magieUnitTargets(m);
    if (cibles.length) s.applyMagieOnUnit(m, cibles[0]);
  } else if (needsGraveyardTarget(m as any)) {
    if (s.graveyard.length) s.applyMagieOnGraveyardUnit(m, s.graveyard[0]);
  } else if (needsHandTarget(m as any)) {
    const idx = s.magieHandTargets(m);
    const pick = idx === null ? 0 : idx[0];
    if (pick !== undefined) s.applyMagieOnHandCard(m, pick);
  } else {
    s.applyGlobalMagie(m);
  }
  const g = s.gameState;
  const vivantes = s.board.getLivingUnitsOnSide('player');
  // ⚠️ **L'observation d'APRÈS est ce qui prouve le REGISTRE.** Une magie écrit
  // dans `_base`, donc son effet SURVIT à `resetCombatStats()` — c'est sa
  // définition, et ce qui la distingue d'un bonus de terrain ou d'attribut.
  // Sans cette seconde lecture, les deux registres rendent la même stat
  // effective et le mode ombre reste vert quelle que soit la durée compilée
  // (vérifié : muter `partie` en `combat` ne faisait tomber aucun cas).
  const apresReset = vivantes.map(u => { const c = Object.create(Object.getPrototypeOf(u)); Object.assign(c, u); return c as Unit; });
  for (const u of apresReset) u.resetCombatStats();
  return {
    board: vivantes.map(etatUnite),
    apres_reset: apresReset.map(etatUnite),
    cimetiere: s.graveyard.map(etatUnite),
    pv: g.player_hp - avantPv,
    pioches: g.player_extra_draws,
    garanties: garanties(g.player_guaranteed_draws),
    slots: g.player_board_slots,
    multiplicateur: g.player_damage_multiplier_bonus,
  };
}

/** Le chemin COMPILÉ — le compilateur puis le moteur générique. */
function cheminCompile(m: Magie) {
  const { alliees, neutralisees } = monde();
  const ressources: Ressources = ressourcesVides();
  const { effets } = compileMagie(m as any);

  // ⚠️ Une magie à cible UNIQUE vise la première unité recevable, comme la
  // session. Le sélecteur dit `combien: 'un'` ; c'est le moteur qui prend la
  // première du monde, et le monde est dans le même ordre que le board.
  const cibles = m.effect?.type === 'power_cooldown' ? alliees.filter(u => u.power_id) : alliees;
  const trace = executer(effets, 'immediat', {
    unitesAlliees: cibles, unitesEnnemies: [], ressources, neutralisees,
    // Les PV d'AVANT — c'est sur eux que se juge l'accessibilité, jamais sur
    // ceux d'après (sinon une magie qui rend des PV financerait son coût).
    pvJoueur: 700,
  });

  // Les réanimées reviennent sur le board, comme `applyMagieOnGraveyardUnit`.
  const board = [...alliees, ...ressources.reanimees].filter(u => u.isAlive());
  const apresReset = board.map(u => { const c = Object.create(Object.getPrototypeOf(u)); Object.assign(c, u); return c as Unit; });
  for (const u of apresReset) u.resetCombatStats();
  return {
    etat: {
      board: board.map(etatUnite),
      apres_reset: apresReset.map(etatUnite),
      cimetiere: neutralisees.map(etatUnite),
      pv: ressources.pv,
      pioches: ressources.pioches,
      garanties: garanties(ressources.pioches_garanties),
      // Le slot passe par le plafond partagé, comme `grantLimitedBoardSlotBonus`.
      slots: 5 + Math.min(ressources.slots_board, 1),
      multiplicateur: ressources.multiplicateur,
    },
    trace,
  };
}

/** Les magies que le compilateur sait traduire, et les autres. */
const { refus } = compileMagies(magies as any);
const REFUSEES = new Set(refus.map(r => r.porteur.split('#')[0]));
const TRADUITES = magies.filter(m => !REFUSEES.has(m.id));

describe('Mode ombre — le compilateur de magie', () => {
  it.each(TRADUITES.map(m => [`${m.id} ${m.name} (${m.effect?.type})`, m.id] as const))(
    '%s — les deux chemins rendent le MÊME état',
    (_nom, id) => {
      const m = magies.find(x => x.id === id)!;
      expect(cheminCompile(m).etat).toEqual(cheminActuel(m));
    },
  );

  it('aucune tâche n\'est ignorée à l\'exécution', () => {
    const ignores = TRADUITES.flatMap(m => cheminCompile(m).trace.ignore.map(x => `${m.id} → ${x}`));
    expect(ignores).toEqual([]);
  });

  it('le chemin compilé écrit vraiment quelque chose', () => {
    const muets = TRADUITES.filter(m => !cheminCompile(m).trace.applique.length).map(m => `${m.id} ${m.name}`);
    expect(muets).toEqual([]);
  });
});


describe('Mode ombre — ce que le catalogue n\'exerce pas', () => {
  // ⚠️ `DECK_POUVOIR` porte un POWER_HEAL sans valeur ni durée : remplacer son
  // pouvoir par un autre ne prouve donc RIEN sur l'héritage, puisque `null`
  // hérité vaut `null` posé. Vérifié — faire hériter `grant_power` des chiffres
  // de l'ancien pouvoir ne faisait tomber AUCUN cas.
  //
  // Une unité dont le pouvoir est CHARGÉ le prouve : un pouvoir donné n'hérite
  // rien de l'ancien, ni sa valeur, ni sa durée, ni sa jauge.
  // Mutation : `t.pouvoir.duree ?? u.power_duration` dans le moteur → ROUGE.
  it('un pouvoir donné n\'hérite RIEN de celui qu\'il remplace', () => {
    const charge = new (Unit as any)(makeCard({
      id: 'CHARGE', stats: { atk: 20, hp: 200, movement_rate: 50, attack_rate: 50, range: 2 } as any,
      power: { id: 'POWER_PARALYSIS', power_rate: 30, duration: 77 } as any,
    }), 'player') as Unit;
    charge.power_value = 42;
    charge.power_gauge = 99;

    const magie = { id: 'M_TEST', name: 'Don', cost_hp: 0,
      effect: { type: 'grant_power', power_id: 'POWER_AOE_ATTACK', power_rate: 60, value: 50 } };
    const { effets } = compileMagie(magie as any);
    executer(effets, 'immediat', {
      unitesAlliees: [charge], unitesEnnemies: [], ressources: ressourcesVides(), pvJoueur: 700,
    });

    expect(charge.power_id).toBe('POWER_AOE_ATTACK');
    expect(charge.power_rate).toBe(60);
    expect(charge.power_value).toBe(50);
    // La durée de l'ANCIEN pouvoir ne survit pas : le nouveau n'en lit aucune.
    expect(charge.power_duration).toBeNull();
    // Et la jauge repart de zéro — héritée pleine, le pouvoir partirait au
    // premier step, ce que rien n'annonce.
    expect(charge.power_gauge).toBe(0);
  });
});

describe('Mode ombre — ce que le vocabulaire ne couvre PAS encore', () => {
  // ⚠️ **CE cas est le livrable de l'étape, autant que les précédents.** Il ne
  // constate pas un échec : il PINNE la frontière, type par type, avec ce qui
  // manque au moteur pour la franchir. C'est la donnée sur laquelle décider si
  // la bascule des magies vaut son prix — et sans elle, la décision se prendrait
  // au doigt mouillé.
  //
  // Un type qui deviendrait traduisible fait tomber ce cas, et c'est voulu : la
  // frontière doit bouger exprès, jamais par accident.
  it('la frontière est exactement celle-ci, et elle est nommée', () => {
    const parRaison = new Map<string, string[]>();
    for (const r of refus) {
      const type = r.detail.split(' — ')[0];
      const manque = r.detail.split(' — ')[1] ?? r.raison;
      if (!parRaison.has(manque)) parRaison.set(manque, []);
      parRaison.get(manque)!.push(type);
    }
    const resume = [...parRaison.entries()]
      .map(([manque, types]) => `${manque} : ${[...new Set(types)].sort().join(', ')}`)
      .sort();
    // ⚠️ `destroy_unit` n'y figure PAS, et c'est correct : le moteur le code et
    // **zéro magie livrée ne le porte** (un des quatre types orphelins du
    // §1.1). Un type que personne n'exerce ne se compile jamais, donc ne se
    // refuse jamais — la frontière décrit le CATALOGUE, pas le code.
    expect(resume).toEqual([
      'action de conteneur (ajouter à la main) : duplicate_card, duplicate_graveyard_unit, duplicate_unit',
      'action de conteneur (board → cimetière) + PV joueur : drain_life',
      'action de conteneur (main → cimetière) : hand_to_graveyard',
      'action de conteneur (retirer de la main) : sacrifice_card_hp',
      'action de conteneur + lecture du catalogue : defuse_fusion',
      'pool de deck (donc rand, et le deck ne sort pas de la session) : draw_material, shift_tier_unit',
      'poser_effet (différé au tour suivant) : reduce_materials, remove_requirements',
    ]);
  });

  it('la part traduite est mesurée, pas estimée', () => {
    expect(TRADUITES.length + REFUSEES.size).toBe(new Set(magies.map(m => m.id)).size);
    // 36 des 51 magies livrées entrent dans le vocabulaire actuel.
    expect(TRADUITES).toHaveLength(36);
  });
});
