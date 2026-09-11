/* eslint-disable @typescript-eslint/no-explicit-any */
// ÉTAPE 1 du moteur d'effets générique — LE MODE OMBRE, sur les MAGIES.
//
// Le troisième porteur, et le plus dispersé : 13 des 23 types ne portent qu'UNE
// magie (§1.1). C'est ce fichier qui a servi à décider si la bascule des magies
// valait la chandelle, en chiffrant ce qui manquait au moteur type par type.
// Cf. `docs/moteur-effets.md` §6.4 et §6.5. Verdict : 49 des 51.
//
// Ce fichier a donc deux rôles, et le second vaut autant que le premier :
//   1. prouver que ce qui compile produit le MÊME état que `GameSession` ;
//   2. **pinner exactement ce qui ne compile pas, et pourquoi.** La frontière
//      doit bouger exprès, jamais par accident.
//
// ⚠️ **CE MODE OMBRE A ÉTÉ CONSOMMÉ PAR SA PROPRE BASCULE**, comme ceux du
// terrain et des attributs avant lui : `GameSession` EST désormais le
// compilateur plus le moteur, donc comparer les deux chemins reviendrait à
// comparer le moteur à lui-même. Les comparaisons d'état sont parties ; ce qui
// garde les 51 magies livrées est le snapshot de
// `magie-characterization.test.ts`, enregistré AVANT la bascule.
//
// ⚠️ **Et la bascule a démenti ce fichier sur DEUX points**, qu'il faut lire
// comme la limite du procédé plutôt que comme des accidents :
//   1. `draw_material` y était « traduit » alors qu'il consomme DEUX tirages
//      là où le moteur n'en fait qu'un — la comparaison d'ÉTAT ne voit pas le
//      flux de hasard, et sur un pool à un seul candidat les deux chemins
//      rendent la même carte ;
//   2. `shift_tier_card` y était vert sans qu'aucune branche « main » de
//      `remplacer` n'existe — AUCUNE magie livrée ne porte ce type (0 sur 51),
//      donc aucun cas ne l'exerçait.
// Deux silences, tous deux invisibles à un mode ombre vert.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileMagie, compileMagies } from '../logic/effects/compile.js';
import { executer, ressourcesVides } from '../logic/effects/engine.js';
import type { Ressources } from '../logic/effects/engine.js';
import { Unit } from '../logic/Unit.js';
import { makeCard } from './helpers.js';
import { tiersOf } from '../logic/Tiers.js';
import type { Magie } from '../logic/types.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const read = (f: string) => JSON.parse(readFileSync(path.join(ROOT, 'initial-data', f), 'utf8'));
const magies: Magie[] = read('magies.json');

// Le même plateau d'essai que l'oracle de l'étape 0 — chaque pièce répond d'une
// famille de magies.
const INVOC = ['ARCH_086', 'ARCH_087', 'ARCH_088', 'ARCH_089', 'ARCH_090'];

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
  // ⚠️ Deux cartes de rechange qui ne sont PAS sur le board, et une carte à
  // matériel unique. Sans elles, les pools des trois magies de tirage sont
  // VIDES — les deux chemins ne font alors rien et s'accordent sur un silence,
  // ce qui ne prouve rien. C'est la quatrième fois que ce piège se présente.
  //
  // ⚠️ Un SEUL candidat par pool, à dessein : le tirage devient déterministe
  // sans avoir à partager le flux de hasard entre les deux chemins. La
  // discipline d'appel à `rand`, elle, s'éprouve à part.
  makeCard({ id: 'DECK_T2B', name: 'Rechange T2', tier: 2,
    stats: { atk: 22, hp: 220, movement_rate: 50, attack_rate: 50, range: 2 } as any, summon_conditions: [] }),
  makeCard({ id: 'DECK_T1B', name: 'Rechange T1', tier: 1,
    stats: { atk: 11, hp: 110, movement_rate: 50, attack_rate: 50, range: 2 } as any, summon_conditions: [] }),
  makeCard({ id: 'DECK_MAT', name: 'À matériel', tier: 3,
    stats: { atk: 33, hp: 330, movement_rate: 50, attack_rate: 50, range: 2 } as any,
    summon_conditions: [{ materials: 1, requires: ['DECK_T5'] }] }),
  // ⚠️ Une carte à coût **par attribut d'invocation visé**, dans la MAIN. Les
  // cinq remises livrées portent un `attribute` (`ARCH_086`…`ARCH_089`) : sans
  // carte porteuse, aucune n'a de cible recevable, les deux chemins ne font
  // rien et s'accordent sur un silence. C'est le même piège que les pools de
  // tirage plus haut — la cinquième fois qu'il se présente.
  ...INVOC.map((attr, i) => makeCard({
    id: `DECK_COUT_${attr}`, name: `Composite ${attr}`, tier: 3, attributes: [attr],
    stats: { atk: 40, hp: 300, movement_rate: 50, attack_rate: 50, range: 1 } as any,
    summon_conditions: [{ materials: 2 + i, requires: ['DECK_T1', 'DECK_T2'] }],
    represented_ids: ['DECK_T1', 'DECK_T2'], material_value: 2,
  })),
];
const BY_ID = new Map(DECK.map(c => [c.id, c]));
const BY_TIER: Record<number, any[]> = {};
for (const c of DECK) for (const t of tiersOf(c as any)) (BY_TIER[t] ??= []).push(c);

const PLACES = ['DECK_T1', 'DECK_POUVOIR', 'DECK_T2'];


/** Le même monde que la session, hors session, pour le chemin compilé. */
function monde() {
  const alliees = PLACES.map((id, col) => {
    const u = new (Unit as any)(BY_ID.get(id), 'player') as Unit;
    u.position = { col, row: 0 };
    u.current_hp = Math.max(1, Math.round(u.max_hp / 2));
    return u;
  });
  const mort = new (Unit as any)(BY_ID.get('DECK_T2'), 'player') as Unit;
  mort.is_neutralized = true; mort.current_hp = 0;
  // La MAIN et le CIMETIÈRE sont maintenant des conteneurs que le moteur touche.
  const main = [BY_ID.get('DECK_MAT')!, BY_ID.get('DECK_T1')!,
    ...INVOC.map(a => BY_ID.get(`DECK_COUT_${a}`)!)].map(c => ({ ...c })) as any[];
  // ⚠️ UN SEUL tableau pour les deux : le cimetière EST la réserve de corps
  // réanimables. Deux tableaux distincts portant les mêmes unités feraient
  // qu'une réanimation viderait l'un sans vider l'autre — le corps reviendrait
  // sur le board tout en restant au cimetière.
  const cimetiere = [mort];
  return { alliees, neutralisees: cimetiere, cimetiere, main };
}

/** La main, lue par son contenu ET par ce qu'il coûte. */
function etatMain(main: any[]): string[] {
  return main.map(c => {
    const cd = (c.summon_conditions ?? [])
      .map((x: any) => `${x.materials ?? 0}m${(x.requires ?? []).length ? `+${x.requires.join('/')}` : ''}`).join(' | ');
    return cd ? `${c.id}[${cd}]` : c.id;
  });
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

// ⚠️ **`cheminActuel` a été SUPPRIMÉ à la bascule** : `GameSession` EST le
// chemin compilé, donc la fonction qui l'appelait pour le comparer au moteur
// comparait le moteur à lui-même. Les quatre règles qu'elle prouvait encore ont
// été DÉPLACÉES dans `magie-characterization.test.ts` avant le retrait, et
// chacune y est éprouvée par sa mutation — c'est la mesure qui a décidé du
// déplacement, pas l'intuition.

/** Le chemin COMPILÉ — le compilateur puis le moteur générique. */
function cheminCompile(m: Magie) {
  const { alliees, neutralisees, cimetiere, main } = monde();
  const ressources: Ressources = ressourcesVides();
  const remplacements: { ancienne: Unit; nouvelle: Unit }[] = [];
  const { effets } = compileMagie(m as any);

  // ⚠️ Une magie à cible UNIQUE vise la première unité recevable, comme la
  // session. Le sélecteur dit `combien: 'un'` ; c'est le moteur qui prend la
  // première du monde, et le monde est dans le même ordre que le board.
  // ⚠️ Le SÉLECTEUR ne porte pas encore la règle d'ÉLIGIBILITÉ d'une cible :
  // `power_cooldown` ne vise que les porteurs de pouvoir, `shift_tier_unit` que
  // les unités dont le pool n'est pas vide. Ces règles vivent dans
  // `magieUnitTargets` et l'appelant les applique — exactement comme la
  // sélection de palier côté attribut. Les recopier dans le sélecteur serait
  // s'en donner deux versions.
  const poolTier = (carte: any, decalage: number) => {
    const vivants = new Set(alliees.filter(u => u.isAlive()).map(u => u.card_id));
    return tiersOf(carte)
      .flatMap((t: number) => BY_TIER[t + decalage] ?? [])
      .filter((c: any) => !vivants.has(c.id));
  };
  const type = m.effect?.type;
  const decalage = ((m.effect as any)?.value as number) || 1;
  // La carte DÉSIGNÉE : la même que celle que la session juge recevable.
  const attribut = (m.effect as any)?.attribute as string | undefined;
  const retouchable = (c: any) => (c.summon_conditions ?? []).some((cd: any) =>
    type === 'reduce_materials' ? (cd.materials ?? 0) > 0 : (cd.requires ?? []).length > 0);
  const cibleMain = (type === 'reduce_materials' || type === 'remove_requirements')
    ? main.findIndex((c: any) => (!attribut || (c.attributes ?? []).includes(attribut)) && retouchable(c))
    : 0;
  const cibles = type === 'power_cooldown' ? alliees.filter(u => u.power_id)
    : type === 'shift_tier_unit'
      ? alliees.filter(u => poolTier(BY_ID.get(u.card_id), decalage).length > 0)
      : alliees;
  const trace = executer(effets, 'immediat', {
    unitesAlliees: cibles, unitesEnnemies: [], ressources, neutralisees, cimetiere, main,
    // ⚠️ Le catalogue est INJECTÉ, jamais importé : `logic/` n'importe pas
    // `data/`, et c'est ce qui permet aux duplications de rendre la carte.
    catalogue: (id: string) => (BY_ID.get(id) as any) ?? null,
    remplacements, cibleMain: Math.max(0, cibleMain),
    // ⚠️ Le pool est INJECTÉ : le deck ne sort pas de la session, le moteur
    // demande des candidats pour un usage. Ce miroir reproduit exactement ce que
    // `_boardTierShiftPool` et `_drawableMaterialIds` rendent.
    pool: (source: string, ctx: any) => {
      if (source === 'materiau') {
        const named = (ctx.carte?.summon_conditions ?? []).flatMap((cd: any) => cd.requires ?? []);
        return [...new Set(named)].map((id: any) => BY_ID.get(id)).filter(Boolean) as any[];
      }
      return poolTier(ctx.carte, ctx.decalage ?? 1) as any[];
    },
    // Les PV d'AVANT — c'est sur eux que se juge l'accessibilité, jamais sur
    // ceux d'après (sinon une magie qui rend des PV financerait son coût).
    pvJoueur: 700,
  });

  // ⚠️ Le moteur ne POSE rien : il dit qui remplace qui, l'appelant fait le
  // geste. `Board.placeUnit` jette sur une case occupée, et l'ordre
  // retrait/pose est une règle de plateau, pas d'effet.
  // ⚠️ Le remplacement se fait **SUR PLACE** : la nouvelle unité prend la CASE
  // de l'ancienne, donc son rang dans le balayage du board. La poser en fin de
  // liste rendrait le même ensemble d'unités dans un autre ordre — et l'ordre
  // d'action du combat se joue sur le board, pas sur cet ensemble.
  const parAncienne = new Map(remplacements.map(r => [r.ancienne, r.nouvelle]));
  const board = [
    ...alliees.map(u => parAncienne.get(u) ?? u),
    ...ressources.reanimees,
  ].filter(u => u.isAlive());
  const apresReset = board.map(u => { const c = Object.create(Object.getPrototypeOf(u)); Object.assign(c, u); return c as Unit; });
  for (const u of apresReset) u.resetCombatStats();
  return {
    etat: {
      board: board.map(etatUnite),
      apres_reset: apresReset.map(etatUnite),
      main: etatMain(main),
      cimetiere: cimetiere.map(etatUnite),
      // ⚠️ **Le PLAFOND de PV est au VERSEMENT, pas dans le moteur** — comme le
      // slot juste en dessous. `player_hp` vit dans `GameState`, que le moteur
      // n'importe pas ; les trois écritures de la session (`player_hp_bonus`,
      // `drain_life`, `sacrifice_card_hp`) l'écrêtent chacune à `PLAYER_HP_CAP`.
      // Sans ce `min`, une carte à 330 PV versée sur un joueur à 700 en rendrait
      // 330 là où la partie en rend 300.
      pv: Math.min(700 + ressources.pv, 1000) - 700,
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
  // ⚠️ **Le cas qui vivait ici — « les deux chemins rendent le même état », un
  // par magie traduite — a été RETIRÉ à la bascule.** Il avait fait son travail :
  // c'est lui qui autorisait à remplacer un chemin par l'autre, et c'est sa
  // mesure type par type qui a servi à décider d'aller au bout. Ce qui garde les
  // 51 magies livrées est le snapshot de `magie-characterization.test.ts`.

  it('aucune tâche n\'est ignorée à l\'exécution', () => {
    const ignores = TRADUITES.flatMap(m => cheminCompile(m).trace.ignore.map(x => `${m.id} → ${x}`));
    expect(ignores).toEqual([]);
  });

  it('le chemin compilé écrit vraiment quelque chose', () => {
    const muets = TRADUITES.filter(m => !cheminCompile(m).trace.applique.length).map(m => `${m.id} ${m.name}`);
    expect(muets).toEqual([]);
  });
});


describe('Mode ombre — la discipline d\'appel à `rand`', () => {
  // ⚠️ **La comparaison d'état ne peut PAS voir ça.** Deux chemins qui tirent le
  // même remplaçant s'accordent quel que soit le nombre d'appels consommés pour
  // y arriver — or c'est le NOMBRE qui compte : le flux est semé et partagé avec
  // la pioche, l'IA et le tirage du terrain. Un appel de trop décale tout ce qui
  // suit, sans qu'aucun état ne diffère au moment du décalage. C'est la même
  // règle que `BoardPicker` : *exactement un appel par tirage, AUCUN sur un pool
  // vide*.
  const REMPLACANTES = magies.filter(m => !REFUSEES.has(m.id))
    .filter(m => compileMagie(m as any).effets.some(e => e.taches.some(t => t.action === 'remplacer')));

  /** Combien d'appels à `rand` pour exécuter cette magie sur ce pool ? */
  function appels(m: Magie, pool: any[]): number {
    let n = 0;
    const { alliees, neutralisees, cimetiere, main } = monde();
    executer(compileMagie(m as any).effets, 'immediat', {
      unitesAlliees: alliees, unitesEnnemies: [], ressources: ressourcesVides(),
      neutralisees, cimetiere, main, remplacements: [],
      catalogue: (id: string) => (BY_ID.get(id) as any) ?? null,
      pool: () => pool as any, cibleMain: 0, pvJoueur: 700,
      rand: () => { n += 1; return 0; },
    });
    return n;
  }

  it('le catalogue porte bien des magies qui tirent', () => {
    // Sans ce garde-fou, les deux cas suivants passeraient sur une liste vide.
    // ⚠️ `MAGIE_052` (`draw_material`) N'Y EST PLUS : elle est refusée depuis la
    // bascule, parce qu'elle consomme deux tirages là où `remplacer` n'en fait
    // qu'un. C'est ce cas-ci qui l'aurait dit si on l'avait su plus tôt.
    expect(REMPLACANTES.map(m => m.id)).toEqual(['MAGIE_050', 'MAGIE_053']);
  });

  it('un pool non vide coûte EXACTEMENT un appel', () => {
    // Mutation : tirer deux fois (un tirage puis un départage) → ROUGE.
    const hors = REMPLACANTES.map(m => [m.id, appels(m, [BY_ID.get('DECK_T2B')!, BY_ID.get('DECK_T1B')!])] as const)
      .filter(([, n]) => n !== 1);
    expect(hors).toEqual([]);
  });

  it('un pool VIDE n\'en coûte AUCUN', () => {
    // ⚠️ C'est la moitié qu'on oublie, et la plus silencieuse : un `rand()`
    // dépensé pour apprendre qu'il n'y a rien à tirer ne change aucun état et
    // décale tout le reste de la partie.
    // Mutation : appeler `r()` avant le test de pool vide → ROUGE.
    const hors = REMPLACANTES.map(m => [m.id, appels(m, [])] as const).filter(([, n]) => n !== 0);
    expect(hors).toEqual([]);
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
  // ⚠️ **CE cas est un livrable, autant que les comparaisons d'état.** Il ne
  // constate pas un échec : il PINNE la frontière, type par type, avec ce qui
  // manque au moteur pour la franchir. Un type qui devient traduisible le fait
  // tomber, et c'est voulu — la frontière doit bouger exprès, jamais par
  // accident.
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
    expect(resume).toEqual([
      'deux tirages (quel matériel, puis quelle carte le porte) : draw_material',
      "lecture de la lignée + repli de placement (règle d'invocation) : defuse_fusion",
    ]);
  });

  it('la part traduite est mesurée, pas estimée', () => {
    expect(TRADUITES.length + REFUSEES.size).toBe(new Set(magies.map(m => m.id)).size);
    // 49 des 51 magies livrées entrent dans le vocabulaire du moteur, et les
    // deux refus n'ont PAS la même nature :
    //
    //   • `defuse_fusion` ne lit pas un CHAMP mais une RÈGLE d'invocation (la
    //     lignée d'un composite, et le repli au cimetière quand il n'y a plus de
    //     case) — le traduire demanderait de donner `InvocationManager` au
    //     moteur, c'est-à-dire de recopier la règle du doublon ;
    //   • `draw_material` serait exprimable, mais il consomme DEUX tirages
    //     (quel matériel manque, puis quelle carte le porte) là où `remplacer`
    //     n'en fait qu'un. Les aplatir changerait la DISTRIBUTION et le nombre
    //     d'appels à `rand`, donc tout le flux semé qui suit.
    //
    // ⚠️ Le second n'a été vu qu'à la BASCULE : ce fichier le comptait traduit,
    // parce qu'une comparaison d'état ne voit pas le flux de hasard.
    expect(TRADUITES).toHaveLength(49);
    expect(REFUSEES.size).toBe(2);
  });
});
