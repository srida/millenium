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
  // Une carte à COÛT **par attribut d'invocation visé** : les quatre
  // `reduce_materials` livrées ciblent `ARCH_086`, `ARCH_088` et `ARCH_089`, et
  // `remove_requirements` cible `ARCH_087`. Une seule carte porteuse laisserait
  // les trois autres sans cible — et l'oracle figerait quatre silences qui
  // ressemblent à des effets morts sans en être.
  ...INVOC.map((attr, i) => makeCard({
    id: `DECK_COUT_${attr}`, name: `Composite ${attr}`, tier: 3, attributes: [attr],
    stats: { atk: 40, hp: 300, movement_rate: 50, attack_rate: 50, range: 1 } as any,
    summon_conditions: [{ materials: 2 + i, requires: ['DECK_T1', 'DECK_T2'] }],
    represented_ids: ['DECK_T1', 'DECK_T2'],
    material_value: 2,
  })),
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
  s.hand = [
    BY_ID.get('DECK_FUSION')!, BY_ID.get('DECK_T2')!, BY_ID.get('DECK_T1')!,
    ...INVOC.map(a => BY_ID.get(`DECK_COUT_${a}`)!),
  ] as any[];

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
    // ⚠️ Le coût, et pas seulement l'id : une remise ne change PAS l'identité
    // de la carte, elle change ce qu'elle réclame. Observer l'id seul rendait
    // les cinq remises invisibles — l'oracle les figeait comme des « rien ».
    main: s.hand.map((c: any) => {
      const cd = (c.summon_conditions ?? [])
        .map((x: any) => `${x.materials ?? 0}m${(x.requires ?? []).length ? `+${x.requires.join('/')}` : ''}`)
        .join(' | ');
      return cd ? `${c.id}[${cd}]` : c.id;
    }),
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

describe('Magies livrées — un contrecoup ne se prélève jamais à vide', () => {
  // ⚠️ **`MAGIE_052` est le seul croisement du catalogue, et il est piégeux** :
  // `draw_material` peut ne RIEN trouver (un matériel désigné par attribut n'est
  // pas une carte, un id peut avoir quitté le catalogue), et elle coûte 50 PV.
  // La session résout donc AVANT de payer.
  //
  // ⚠️ Ce cas est écrit pour la BASCULE à venir, pas pour le code d'aujourd'hui :
  // le compilateur émet le contrecoup en PREMIÈRE tâche — il le faut, sinon
  // `drain_life` financerait le sien — donc un moteur branché sans garde
  // prélèverait les 50 PV puis ne trouverait rien. Le mode ombre ne peut pas le
  // voir : son harnais donne toujours un matériel résolvable, et deux chemins
  // qui réussissent tous les deux sont d'accord.
  //
  // Mutation : payer avant de résoudre dans `applyMagieOnHandCard` → ROUGE.
  const CROISEMENTS = magies.filter(m => (m.cost_hp ?? 0) > 0
    && ['draw_material', 'shift_tier_card', 'shift_tier_unit',
      'duplicate_unit', 'duplicate_graveyard_unit',
      'reduce_materials', 'remove_requirements'].includes(m.effect?.type as string));

  it('le catalogue porte bien un tel croisement', () => {
    // Sans ce garde-fou, le cas suivant passerait sur une liste vide le jour où
    // un `cost_hp` est retiré en admin — et personne ne saurait qu'il ne teste
    // plus rien.
    expect(CROISEMENTS.map(m => `${m.id} ${m.effect?.type} −${m.cost_hp}`))
      .toEqual(['MAGIE_052 draw_material −50']);
  });

  it.each(CROISEMENTS.map(m => [`${m.id} ${m.name}`, m.id] as const))(
    '%s — rien à trouver, donc rien de prélevé',
    (_nom, id) => {
      const m = magies.find(x => x.id === id)!;
      const s = makeSession();
      // Une carte SANS matériel résolvable : aucune condition, donc aucun
      // matériel à nommer. C'est précisément ce que `magieHandTargets` écarte —
      // on force ici le chemin que l'écran ne propose pas.
      const nue = makeCard({
        id: 'SANS_MATERIEL', name: 'Nue', tier: 1,
        stats: { atk: 5, hp: 50, movement_rate: 50, attack_rate: 50, range: 1 } as any,
        summon_conditions: [],
      });
      s.hand = [nue] as any[];
      const avantPv = s.gameState.player_hp;
      const avantMain = s.hand.length;

      // La carte n'est PAS une cible recevable — c'est la première moitié de la règle.
      expect(s.magieHandTargets(m)).toEqual([]);

      // Et même forcée, elle ne prélève rien : c'est la seconde moitié, celle
      // qui ne dépend pas du rendu.
      s.applyMagieOnHandCard(m, 0);
      expect(s.gameState.player_hp, 'les PV ne bougent pas').toBe(avantPv);
      expect(s.hand.length, 'la main ne bouge pas').toBe(avantMain);
    },
  );
});

describe('Magies livrées — les trois règles que le snapshot ne peut pas voir', () => {
  // ⚠️ **CES TROIS CAS ONT ÉTÉ ÉCRITS À LA BASCULE, et la mesure disait qu'il
  // le fallait** : sur cinq mutations du compilateur de magie, QUATRE restaient
  // vertes sur toute la suite. Le snapshot de ce fichier n'y peut rien — il
  // observe l'état juste après l'application, où ces trois règles ne laissent
  // aucune trace :
  //
  //   • le REGISTRE (`_base` vs `_stat_bonuses`) rend la même stat effective ;
  //   • l'ORDRE du contrecoup ne se voit que si l'effet rend des PV ;
  //   • la GARDE d'accessibilité ne se voit que sur une magie impayable.
  //
  // Aucune magie livrée ne croise ces cas, d'où trois magies SYNTHÉTIQUES.

  // ⚠️ La règle la plus importante du porteur : une magie écrit dans `_base`,
  // donc son effet SURVIT au combat et voyage dans `round:board_ready` (§5.3).
  // C'est ce qui la distingue d'un bonus de terrain ou d'attribut.
  // Mutation : `duree: 'combat'` dans le compilateur → ROUGE.
  it('un bonus de magie SURVIT à la fin du combat', () => {
    const s = makeSession();
    const cible = s.getPlayerUnits()[0];
    const avant = cible.atk;
    s.applyMagieOnUnit({ id: 'M', name: 'Lame', cost_hp: 0,
      effect: { type: 'stat_bonus', stat: 'atk', value: 30 } } as any, cible);
    expect(cible.atk, 'le bonus est posé').toBe(avant + 30);

    // `resetCombatStats()` balaie `_stat_bonuses` — un bonus de COMBAT
    // disparaîtrait ici, un bonus de MAGIE non.
    cible.resetCombatStats();
    expect(cible.atk, 'et il survit au balayage de fin de combat').toBe(avant + 30);
  });

  // ⚠️ `drain_life` rend des PV au joueur ET coûte des PV : si le contrecoup
  // partait APRÈS, la magie financerait son propre coût avec ce qu'elle
  // rapporte. C'est la seule raison pour laquelle le compilateur émet le
  // contrecoup en PREMIÈRE tâche.
  // Mutation : le contrecoup en dernier → ROUGE.
  it('le contrecoup part AVANT l\'effet, donc une magie ne se finance pas elle-même', () => {
    const s = makeSession();
    const cible = s.getPlayerUnits()[0];
    const pv = cible.current_hp;
    const avant = s.gameState.player_hp;
    s.applyMagieOnUnit({ id: 'M', name: 'Absorption', cost_hp: 50,
      effect: { type: 'drain_life' } } as any, cible);
    // −50 de contrecoup, puis + les PV COURANTS de l'unité drainée.
    expect(s.gameState.player_hp).toBe(Math.min(avant - 50 + pv, 1000));
  });

  // ⚠️ Une magie impayable ne s'applique pas DU TOUT — elle n'ampute rien au
  // passage. La garde et le paiement ne se désolidarisent jamais.
  //
  // ⚠️ **DEUX gardes qui se couvrent**, donc aucune prouvable seule : celle de
  // la session (`canAffordMagie`, en tête des quatre chemins) et celle du
  // compilateur (`condition.pvJoueurSuperieurA`, jugée sur les PV d'AVANT).
  // Retirer l'une ne fait rouge aucun test ; les retirer ENSEMBLE fait rouge
  // celui-ci. Même situation que les ressources adverses côté attribut — une
  // mutation isolée y donne un faux négatif.
  it('une magie impayable ne prélève RIEN et ne fait RIEN', () => {
    const s = makeSession();
    s.gameState.player_hp = 40;
    const cible = s.getPlayerUnits()[0];
    const atk = cible.atk;
    // ⚠️ La comparaison est STRICTE : payer laisse toujours 1 PV. À 40 PV, un
    // coût de 40 est déjà refusé.
    const magie = { id: 'M', name: 'Trop chère', cost_hp: 40,
      effect: { type: 'stat_bonus', stat: 'atk', value: 30 } } as any;
    expect(s.canAffordMagie(magie), 'le HUD la verrouille').toBe(false);

    // ⚠️ Et même forcée, elle ne fait rien : la règle ne dépend pas du rendu.
    s.applyMagieOnUnit(magie, cible);
    expect(s.gameState.player_hp, 'aucun PV prélevé').toBe(40);
    expect(cible.atk, 'aucun bonus posé').toBe(atk);
  });
});

describe('Magies livrées — une magie d\'unité n\'est pas une magie d\'ÉQUIPE', () => {
  // ⚠️ Ce cas vient du mode ombre, qui était le SEUL à l'attraper avant la
  // bascule. La distinction ne se lit pas dans le snapshot : celui-ci n'applique
  // chaque magie qu'à une cible, et une magie d'équipe posée sur une seule unité
  // fait exactement ce qu'une magie d'unité ferait.
  //
  // Mutation : `uneUnite()` rendant `combien: 'tous'` → ROUGE.
  //
  // ⚠️ **DEUX gardes qui se couvrent, une troisième fois** : l'appelant
  // restreint le MONDE (`unitesAlliees: [unit]`) et le sélecteur restreint la
  // CIBLE (`combien: 'un'`). Retirer l'une ne fait rouge aucun test ; les
  // retirer ensemble, si.
  it('un `stat_bonus` ne touche QUE la cible désignée', () => {
    const s = makeSession();
    const [cible, ...autres] = s.getPlayerUnits();
    const avant = autres.map(u => u.atk);
    s.applyMagieOnUnit({ id: 'M', name: 'Lame', cost_hp: 0,
      effect: { type: 'stat_bonus', stat: 'atk', value: 30 } } as any, cible);
    expect(autres.map(u => u.atk), 'les autres ne bougent pas').toEqual(avant);
  });

  it('un `team_stat_bonus` touche TOUT le board du joueur', () => {
    const s = makeSession();
    const toutes = s.getPlayerUnits();
    const avant = toutes.map(u => u.atk);
    s.applyGlobalMagie({ id: 'M', name: 'Renfort', cost_hp: 0,
      effect: { type: 'team_stat_bonus', stat: 'atk', value: 30 } } as any);
    expect(toutes.map(u => u.atk)).toEqual(avant.map(a => a + 30));
  });
});
