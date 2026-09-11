/* eslint-disable @typescript-eslint/no-explicit-any */
// ÉTAPE 0 du moteur d'effets générique — la caractérisation des MAGIES.
//
// Le pendant de `board-characterization.test.ts` pour le deuxième porteur. Il ne
// décrit aucune règle nouvelle : il **fige ce que les 51 magies livrées font
// aujourd'hui**, pour que le compilateur `magie → Effet[]` de l'étape 1 se diffe
// contre un oracle plutôt que contre une intention. Cf. `docs/moteur-effets.md`
// §6.1.
//
// ⚠️ Le partage avec `magie.test.ts` et `magie-offer.test.ts`, à tenir :
//   • `magie.test.ts`       éprouve les RÈGLES sur des magies synthétiques ;
//   • `magie-offer.test.ts` éprouve la PERTINENCE (ce qui est offert) ;
//   • celui-ci éprouve le CATALOGUE (ce que les magies livrées FONT).
// Une règle qui change casse le premier, une donnée qui change casse celui-ci.
//
// ⚠️ L'oracle passe par une vraie `GameSession`, pas par `applyEffect` seul :
// **11 des 23 types vivent dans la session**, pas dans `MagieEffect` (les
// duplications, les remplacements par tier, la main, le cimetière, les remises
// de coût). Les figer depuis `applyEffect` ne montrerait rien — c'est
// précisément la moitié du porteur que le moteur générique devra absorber.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GameSession } from '../logic/GameSession.js';
import type { GameSessionDeps } from '../logic/GameSession.js';
import { Unit } from '../logic/Unit.js';
import { needsUnitTarget, needsGraveyardTarget, needsHandTarget } from '../logic/MagieEffect.js';
import { makeRandom, hashSeed } from '../logic/Random.js';
import { makeCard } from './helpers.js';
import { tiersOf } from '../logic/Tiers.js';
import { DURATION_POWERS } from '../../../speed-scale.mjs';
import type { Magie } from '../logic/types.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const read = (f: string) => JSON.parse(readFileSync(path.join(ROOT, 'initial-data', f), 'utf8'));
const magies: Magie[] = read('magies.json');
const attributes: any[] = read('attributes.json');
const powers: any[] = read('powers.json');
const ATTR_IDS = new Set(attributes.map(a => a.id));
const POWER_IDS = new Set(powers.map(p => p.id));

/** Les cinq attributs d'invocation et les cinq de tier, que les magies visent. */
const INVOC = ['ARCH_086', 'ARCH_087', 'ARCH_088', 'ARCH_089', 'ARCH_090'];

// ───────────────────────────────────────────────────────────────────────────
// Le plateau d'essai
//
// ⚠️ Il n'est pas « riche » par confort : chaque pièce est là pour qu'une
// famille de magies ait de quoi mordre. Sans l'unité à pouvoir, `power_cooldown`
// et `grant_power` ne figeraient qu'un no-op ; sans la carte à matériaux,
// `draw_material` et les deux remises de coût aussi. Un oracle qui fige un
// silence ne dit rien du jour où le compilateur le rompra.
// ───────────────────────────────────────────────────────────────────────────

const DECK = [
  // Un palier par tier : c'est le pool des deux `shift_tier_*`, qui puisent
  // dans le DECK et jamais dans le catalogue.
  ...[1, 2, 3, 4, 5].map(t => makeCard({
    id: `DECK_T${t}`, name: `Socle T${t}`, tier: t,
    stats: { atk: 10 * t, hp: 100 * t, movement_rate: 50, attack_rate: 50, range: 2 } as any,
    summon_conditions: [],
  })),
  // Une carte à COÛT, portant un attribut d'invocation : ce que `reduce_materials`
  // et `remove_requirements` retouchent, et la seule source de `draw_material`.
  makeCard({
    id: 'DECK_FUSION', name: 'Composite', tier: 3, attributes: [INVOC[1]],
    stats: { atk: 40, hp: 300, movement_rate: 50, attack_rate: 50, range: 1 } as any,
    summon_conditions: [{ materials: 2, requires: ['DECK_T1', 'DECK_T2'] }],
    represented_ids: ['DECK_T1', 'DECK_T2'],
    material_value: 2,
  }),
  // Une carte à pouvoir, pour que `power_cooldown` ait une jauge à diviser.
  makeCard({
    id: 'DECK_POUVOIR', name: 'Porteur', tier: 2,
    stats: { atk: 20, hp: 200, movement_rate: 50, attack_rate: 50, range: 3 } as any,
    power: { id: 'POWER_HEAL', power_rate: 40 } as any,
    summon_conditions: [],
  }),
];

const BY_ID = new Map(DECK.map(c => [c.id, c]));
const BY_TIER: Record<number, any[]> = {};
for (const c of DECK) for (const t of tiersOf(c as any)) (BY_TIER[t] ??= []).push(c);

function makeSession(): GameSession {
  const deps: GameSessionDeps = {
    cardsByTier: BY_TIER,
    enemyDeck: {},
    attributeList: attributes,
    cardDb: { getCard: (id: string) => (BY_ID.get(id) as any) ?? null } as any,
    getAllBoards: () => [],
    getAllMagies: () => [],
    rand: makeRandom(hashSeed('oracle-magies')),
  };
  const s = new GameSession(deps);

  // ⚠️ La main et le plateau sont POSÉS, pas piochés : l'oracle doit figer
  // l'effet de la magie, pas le tirage qui l'a précédé. Une main aléatoire
  // ferait bouger le snapshot au moindre changement du flux semé.
  s.startPreparation();
  s.hand = [BY_ID.get('DECK_FUSION')!, BY_ID.get('DECK_T2')!, BY_ID.get('DECK_T1')!] as any[];

  const place = (id: string, col: number) => {
    const u = new (Unit as any)(BY_ID.get(id), 'player') as Unit;
    s.board.placeUnit(u, { col, row: 0 });
    // ⚠️ Les unités sont BLESSÉES, et c'est indispensable : `heal` et
    // `team_heal` sur une unité à PV pleins ne font rien, et l'oracle figerait
    // alors deux « rien » qui ressemblent à des effets morts sans en être. Les
    // PV ne se régénèrent pas entre les rounds — un board blessé est l'état
    // normal d'une Phase Shopping, pas un cas limite.
    u.current_hp = Math.max(1, Math.round(u.max_hp / 2));
    return u;
  };
  place('DECK_T1', 0);
  place('DECK_POUVOIR', 1);
  place('DECK_FUSION', 2);

  // Un corps au cimetière : `revive` l'en sort, `duplicate_graveyard_unit` l'y
  // laisse — deux magies que seul un cimetière non vide distingue.
  const mort = new (Unit as any)(BY_ID.get('DECK_T2'), 'player') as Unit;
  mort.is_neutralized = true;
  mort.current_hp = 0;
  s.graveyard.push(mort);

  // ⚠️ Les PV joueur sont SOUS le plafond, sinon `player_hp_bonus`,
  // `drain_life` et `sacrifice_card_hp` figeraient tous les trois un zéro : une
  // partie commence à 1000, qui est le plafond.
  s.gameState.player_hp = 700;
  return s;
}

// ───────────────────────────────────────────────────────────────────────────
// Ce qu'on observe
// ───────────────────────────────────────────────────────────────────────────

/** L'état complet qu'une magie peut toucher, en une valeur comparable. */
function snapshot(s: GameSession) {
  const unit = (u: Unit) => [
    u.card_id,
    u.position ? `${u.position.col},${u.position.row}` : '—',
    `pv ${u.current_hp}/${u.max_hp}`,
    `atq ${u.atk}`, `dep ${u.movement_rate}`, `vit ${u.attack_rate}`, `por ${u.range}`,
    `bcl ${u.shield}`,
    `pouvoir ${u.power_id ?? '—'}:${u.power_rate ?? '—'}:${u.power_value ?? '—'}:${u.power_duration ?? '—'}`,
  ].join(' · ');
  const g = s.gameState;
  return {
    pv_joueur: g.player_hp,
    pioches: g.player_extra_draws,
    garanties: g.player_guaranteed_draws.map((d: any) =>
      [d.tier ?? '—', (d.attributes ?? []).join('|') || (d.attribute ?? '—'), (d.card_ids ?? []).join('|') || '—'].join(':')),
    slots: g.player_board_slots,
    multiplicateur: g.player_damage_multiplier_bonus ?? 0,
    shopping: g.player_extra_shopping_magies ?? 0,
    retouches: (g.player_hand_modifiers ?? []).map((m: any) => `${m.type}:${m.value ?? '—'}:${m.attribute ?? 'tous'}`),
    main: s.hand.map((c: any) => c.id),
    board: s.board.getLivingUnitsOnSide('player').map(unit),
    cimetiere: s.graveyard.map(unit),
  };
}

/** Ce qui a changé entre deux instantanés, champ par champ — ou « rien ». */
function diff(before: any, after: any): Record<string, string> | 'rien' {
  const out: Record<string, string> = {};
  for (const k of Object.keys(before)) {
    const a = JSON.stringify(before[k]);
    const b = JSON.stringify(after[k]);
    if (a !== b) out[k] = `${a} → ${b}`;
  }
  return Object.keys(out).length ? out : 'rien';
}

/** La famille de ciblage d'une magie, et la cible que l'oracle lui donne. */
function famille(m: Magie): 'unité' | 'cimetière' | 'main' | 'globale' {
  if (needsUnitTarget(m as any)) return 'unité';
  if (needsGraveyardTarget(m as any)) return 'cimetière';
  if (needsHandTarget(m as any)) return 'main';
  return 'globale';
}

/** Applique une magie sur une session neuve et rend ce qu'elle a changé. */
function applique(m: Magie) {
  const s = makeSession();
  const avant = snapshot(s);
  const fam = famille(m);
  let cible = '—';

  if (fam === 'unité') {
    // La première cible que la session juge recevable — jamais un choix de
    // l'oracle : `magieUnitTargets` porte déjà la règle (`power_cooldown` ne
    // vise que les porteurs de pouvoir, `defuse_fusion` que les composites).
    const targets = s.magieUnitTargets(m);
    if (!targets.length) return { cible: 'AUCUNE CIBLE RECEVABLE', delta: 'rien' as const };
    cible = targets[0].card_id;
    s.applyMagieOnUnit(m, targets[0]);
  } else if (fam === 'cimetière') {
    if (!s.graveyard.length) return { cible: 'CIMETIÈRE VIDE', delta: 'rien' as const };
    cible = s.graveyard[0].card_id;
    s.applyMagieOnGraveyardUnit(m, s.graveyard[0]);
  } else if (fam === 'main') {
    const idx = s.magieHandTargets(m);
    const pick = idx === null ? 0 : idx[0];
    if (pick === undefined) return { cible: 'AUCUNE CARTE RECEVABLE', delta: 'rien' as const };
    cible = (s.hand[pick] as any).id;
    s.applyMagieOnHandCard(m, pick);
  } else {
    s.applyGlobalMagie(m);
  }

  return { cible, delta: diff(avant, snapshot(s)) };
}

// ───────────────────────────────────────────────────────────────────────────

describe('Magies livrées — invariants du catalogue', () => {
  it('les 51 magies sont là, et chacune porte un effet typé', () => {
    expect(magies).toHaveLength(51);
    for (const m of magies) {
      expect(m.effect, m.id).toBeTruthy();
      expect(typeof m.effect!.type, m.id).toBe('string');
    }
  });

  // ⚠️ Les trois familles s'EXCLUENT : `GameController.chooseMagie` les teste
  // dans l'ordre unité → cimetière → main, donc un type reconnu par deux
  // d'entre elles n'atteindrait jamais la troisième branche — et personne ne le
  // verrait, la magie ferait simplement autre chose que ce qu'elle annonce.
  // Mutation : ajouter `revive` à `needsUnitTarget` → ROUGE.
  it('aucune magie livrée n\'appartient à deux familles de ciblage', () => {
    const doubles = magies
      .map(m => ({ id: m.id, n: [needsUnitTarget(m as any), needsGraveyardTarget(m as any), needsHandTarget(m as any)].filter(Boolean).length }))
      .filter(x => x.n > 1)
      .map(x => x.id);
    expect(doubles).toEqual([]);
  });

  // Même sonde que pour les terrains, et pour la même raison : une table de noms
  // recopiée serait un inventaire de plus du vocabulaire des stats. On pose le
  // bonus sur une unité neuve et on demande si quoi que ce soit a bougé.
  // Mutation : `stat: 'vitesse'` sur une magie → ROUGE.
  it('toute stat nommée par une magie bouge quelque chose sur l\'unité', () => {
    const mortes: string[] = [];
    for (const m of magies) {
      const stat = (m.effect as any)?.stat;
      if (stat == null) continue;
      const u = new (Unit as any)(makeCard({
        stats: { atk: 20, hp: 100, movement_rate: 50, attack_rate: 50, range: 3 } as any,
      }), 'player') as Unit;
      const before = JSON.stringify([u.atk, u.max_hp, u.range, u.attack_rate, u.movement_rate]);
      u.applyStatBonus(stat, 7);
      if (JSON.stringify([u.atk, u.max_hp, u.range, u.attack_rate, u.movement_rate]) === before) {
        mortes.push(`${m.id} ${m.name} → ${stat}`);
      }
    }
    expect(mortes).toEqual([]);
  });

  // Un id qui ne désigne rien vise le vide, en silence : la magie s'applique
  // sans erreur et ne peut rien donner.
  // Mutation : `attributes: ['ARCH_999']` sur une magie → ROUGE.
  it('tout attribut et tout pouvoir nommés par une magie existent', () => {
    const morts: string[] = [];
    for (const m of magies) {
      const e = m.effect as any;
      if (!e) continue;
      for (const a of [...(e.attributes ?? []), ...(e.attribute ? [e.attribute] : [])]) {
        if (!ATTR_IDS.has(a)) morts.push(`${m.id} → attribut ${a}`);
      }
      if (e.power_id && !POWER_IDS.has(e.power_id)) morts.push(`${m.id} → pouvoir ${e.power_id}`);
    }
    expect(morts).toEqual([]);
  });

  // ⚠️ `power.duration` et `power.value` S'EXCLUENT (cf. `speed-scale.mjs`), et
  // rien ne le vérifie côté MAGIE : `card-contract.js` ne garde que les CARTES.
  // Un `grant_power` qui donnerait POWER_PARALYSIS avec une `value` verrait sa
  // durée ignorée — l'unité retomberait sur le repli du moteur, et la magie
  // promettrait une paralysie qu'elle ne pose pas.
  // Mutation : passer la `duration` de `MAGIE_041` en `value` → ROUGE.
  it('un grant_power chiffre sa DURÉE ou sa VALEUR selon le pouvoir donné, jamais l\'autre', () => {
    const fautes: string[] = [];
    for (const m of magies) {
      const e = m.effect as any;
      if (e?.type !== 'grant_power' || !e.power_id) continue;
      const duree = DURATION_POWERS.includes(e.power_id);
      if (duree && e.value != null) fautes.push(`${m.id} ${e.power_id} : value sur un pouvoir de durée`);
      if (!duree && e.duration != null) fautes.push(`${m.id} ${e.power_id} : duration sur un pouvoir qui n'en lit pas`);
      // Sans compteur de vitesse, l'unité garde le `null` d'`Unit` : le pouvoir
      // donné ne partirait jamais.
      if (e.power_rate == null) fautes.push(`${m.id} ${e.power_id} : aucune vitesse`);
    }
    expect(fautes).toEqual([]);
  });

  // Le contrecoup laisse toujours au moins 1 PV (`canAffordMagie` est STRICT).
  // Une magie dont le coût atteint le plafond est injouable toute la partie.
  it('aucun contrecoup ne rend sa magie injouable à PV pleins', () => {
    const bloquees = magies
      .filter(m => (m.cost_hp ?? 0) >= 1000)
      .map(m => `${m.id} → ${m.cost_hp}`);
    expect(bloquees).toEqual([]);
  });
});

describe('Magies livrées — l\'oracle de l\'étape 0', () => {
  // ⚠️ CE snapshot est le contrat que le moteur générique devra reproduire. Il
  // ne se met PAS à jour à la légère : une ligne qui bouge veut dire que la
  // magie ne fait plus la même chose, ce qui est soit la donnée qui a changé,
  // soit une régression.
  it('ce que chacune des 51 magies fait, figé', () => {
    const oracle = magies.map(m => {
      const { cible, delta } = applique(m);
      return {
        id: m.id,
        nom: m.name,
        effet: [
          m.effect!.type,
          (m.effect as any).stat ?? null,
          (m.effect as any).value ?? null,
          (m.effect as any).attribute ?? (m.effect as any).attributes?.join('|') ?? null,
          (m.effect as any).power_id ?? null,
        ].filter(x => x !== null).join(' · '),
        contrecoup: m.cost_hp ?? 0,
        famille: famille(m),
        cible,
        change: delta,
      };
    });
    expect(oracle).toMatchSnapshot();
  });

  // ⚠️ Le pendant du snapshot, et il n'est pas redondant : le snapshot dit CE
  // QUI arrive, celui-ci dit qu'AUCUNE magie livrée n'est un no-op. Une magie
  // qui ne change rien est un effet mort — la panne que tout ce chantier existe
  // pour rendre impossible — et dans un snapshot de 51 entrées, un « rien » se
  // relit sans y penser.
  // Mutation : un type inconnu sur une magie → ROUGE.
  it('aucune magie livrée ne s\'applique sans rien changer', () => {
    const muettes = magies
      .map(m => ({ id: m.id, nom: m.name, type: m.effect!.type, ...applique(m) }))
      .filter(x => x.delta === 'rien')
      .map(x => `${x.id} ${x.nom} (${x.type}) — cible ${x.cible}`);
    expect(muettes).toEqual([]);
  });
});
