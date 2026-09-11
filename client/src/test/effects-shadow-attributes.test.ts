/* eslint-disable @typescript-eslint/no-explicit-any */
// ÉTAPE 1 du moteur d'effets générique — LE MODE OMBRE, sur les ATTRIBUTS.
//
// Le deuxième porteur, et de loin le plus révélateur : c'est lui qui a produit
// onze des vingt-et-un effets morts, et pour une raison que le schéma supprime
// par construction. Cf. `docs/moteur-effets.md` §6.2.
//
// ⚠️ **Le `quand` est dérivé de l'EFFET, jamais de son porteur.** Aujourd'hui le
// `timing` vit sur l'attribut et la forme de l'effet sur l'effet, et rien ne les
// accorde : un `revive` posé sous un `start_of_combat` n'est jamais atteint,
// parce que la passe de fin de combat sort sur `attr.timing !== 'end_of_combat'`.
// Le compilateur, lui, sait qu'un `revive` est de fin de combat où que son
// attribut prétende vivre — et un désaccord devient un REFUS nommé.
//
// ⚠️ Le compilateur émet TOUS les paliers ; c'est la `condition` qui dit lequel
// s'applique. Chaque cas exerce donc un palier précis, cast à sa taille exacte —
// le même geste que l'oracle de l'étape 0. La règle « un seul palier actif, le
// plus élevé atteint » reste celle d'`AttributeManager` et vit dans
// `attributes.test.ts` ; la rejouer ici serait s'en donner deux versions.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AttributeManager } from '../logic/AttributeManager.js';
import { compileAttribute, compileAttributes } from '../logic/effects/compile.js';
import { executer, ressourcesVides } from '../logic/effects/engine.js';
import type { Ressources } from '../logic/effects/engine.js';
import { Unit } from '../logic/Unit.js';
import { makeCard } from './helpers.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const attributes: any[] = JSON.parse(readFileSync(path.join(ROOT, 'initial-data/attributes.json'), 'utf8'));
const ATTR_IDS = new Set<string>(attributes.map(a => a.id));
const AVEC_PALIERS = attributes.filter(a => (a.thresholds ?? []).length > 0);

const BASE = { atk: 20, hp: 200, movement_rate: 50, attack_rate: 50, range: 3 };

function unit(cardId: string, attrs: string[], side: 'player' | 'enemy'): Unit {
  return new (Unit as any)(
    makeCard({ id: cardId, name: cardId, attributes: attrs, stats: { ...BASE } as any }), side,
  ) as Unit;
}

/** Les attributs qu'un palier compte sur le camp adverse (`value_per`). */
function valuePer(seuil: any): string[] {
  return (seuil.effects ?? []).map((e: any) => e.value_per).filter((v: any) => typeof v === 'string' && ATTR_IDS.has(v));
}

function casting(attrId: string, count: number, adverses: string[]) {
  const player: Unit[] = [];
  const enemy: Unit[] = [];
  for (let i = 0; i < count; i++) {
    player.push(unit(`P${i}_${attrId}`, [attrId], 'player'));
    enemy.push(unit(`E${i}_${attrId}`, [attrId, ...adverses], 'enemy'));
  }
  return { player, enemy };
}

/** L'état d'une unité qu'un effet d'attribut peut toucher. */
function etatUnite(u: Unit): string {
  return [
    `pv ${u.current_hp}/${u.max_hp}`, `atq ${u.atk}`,
    `dep ${u.movement_rate}`, `vit ${u.attack_rate}`, `por ${u.range}`, `bcl ${u.shield}`,
    u.is_effect_immune ? 'immunisé' : '', u.is_neutralized ? 'neutralisé' : '',
    u._stat_bonuses.power_charge ? `charge+${u._stat_bonuses.power_charge}` : '',
  ].filter(Boolean).join(' · ');
}

/** Les ressources produites, sous une forme comparable des deux côtés. */
function etatRessources(r: {
  pioches: number; garanties: any[]; slots: number; mult: number; shop: number; reanimees: string[];
}) {
  return {
    pioches: r.pioches,
    garanties: r.garanties.map((d: any) =>
      [d.tier ?? '—', (d.attributes ?? []).join('|') || (d.attribute ?? '—'), (d.card_ids ?? []).join('|') || '—'].join(':')),
    slots: r.slots, multiplicateur: r.mult, shopping: r.shop,
    reanimees: [...r.reanimees].sort(),
  };
}

// ───────────────────────────────────────────────────────────────────────────
// Les deux chemins
// ───────────────────────────────────────────────────────────────────────────

/**
 * Le chemin ACTUEL — `AttributeManager`, dans la passe que le `timing` désigne.
 *
 * ⚠️ Les tableaux sont liés à des VARIABLES : `_triggerStatModifiers` reconnaît
 * le camp par égalité de référence. Un tableau neuf portant les mêmes unités
 * lirait le cache du camp adverse et ne déclencherait rien.
 */
function cheminActuel(attr: any, seuil: any, catalogue: any[] = attributes) {
  const { player, enemy } = casting(attr.id, seuil.count, valuePer(seuil));
  const mgr = new (AttributeManager as any)(catalogue, player, enemy);
  const morts: Unit[] = [];
  let res: any = null;

  mgr.applyStartOfCombat();
  if (attr.timing === 'during_combat') {
    const allie = player[player.length - 1];
    allie.is_neutralized = true;
    mgr.onUnitNeutralized(allie, player, enemy);
    const adverse = enemy[enemy.length - 1];
    adverse.is_neutralized = true;
    mgr.onUnitNeutralized(adverse, player, enemy);
  } else if (attr.timing === 'end_of_combat') {
    const mort = player[player.length - 1];
    mort.is_neutralized = true;
    mort.current_hp = 0;
    morts.push(mort);
    res = mgr.applyEndOfCombat(morts, []);
  }

  return {
    joueur: player.map(etatUnite),
    ennemi: enemy.map(etatUnite),
    ressources: etatRessources({
      pioches: res?.draw_bonus ?? 0,
      garanties: res?.guaranteed_draws ?? [],
      slots: res?.board_slot_bonus ?? 0,
      mult: res?.damage_multiplier_bonus ?? 0,
      shop: res?.shopping_bonus ?? 0,
      reanimees: (res?.revived ?? []).map((u: Unit) => u.card_id),
    }),
    sources: (res?.draw_sources ?? []).map((s: any) => `${s.kind}:${s.ref}:${s.value}:${s.guaranteed ?? false}`),
  };
}

/** Le chemin COMPILÉ — le compilateur puis le moteur générique. */
/**
 * Le chemin COMPILÉ — le compilateur puis le moteur générique.
 *
 * ⚠️ Il ne prend PAS le catalogue, là où le chemin actuel en a besoin : le
 * compilateur traduit UN attribut et n'a rien à résoudre ailleurs. C'est une
 * petite chose, et c'est exactement la propriété visée — `AttributeManager`
 * doit tenir la liste entière pour retrouver `_attributeMap[attrId]`.
 */
function cheminCompile(attr: any, seuil: any) {
  const { player, enemy } = casting(attr.id, seuil.count, valuePer(seuil));
  const ressources: Ressources = ressourcesVides();
  const neutralisees: Unit[] = [];

  // Seuls les effets DE CE PALIER : le compilateur les émet tous, la condition
  // dit lequel s'applique.
  const { effets } = compileAttribute(attr, ATTR_IDS);
  const duPalier = effets.filter(e => e.condition?.minimum === seuil.count);

  const neutraliseesEnnemies: Unit[] = [];
  const ressourcesEnnemies = ressourcesVides();

  // ⚠️ **Le moteur tourne UNE FOIS PAR CAMP, et c'est la lecture fidèle de
  // l'existant** : `applyStartOfCombat` appelle `_applyStartForSide` deux fois,
  // `applyEndOfCombat` fait de même. Un attribut profite à qui le PORTE, des
  // deux côtés — ce n'est pas un effet « allié », c'est un effet de porteur.
  // Un sélecteur `les_deux` ne suffirait pas : `parAttributAdverse` lit « le
  // camp d'en face », qui n'a pas le même sens selon le côté d'où l'on part.
  const cote = (alliees: Unit[], ennemies: Unit[], res: Ressources, morts: Unit[], limite: boolean) => ({
    unitesAlliees: alliees, unitesEnnemies: ennemies,
    ressources: res, neutralisees: morts, ressourcesLimitees: limite,
  });
  const joueur = () => cote(player, enemy, ressources, neutralisees, false);
  // ⚠️ Le camp adverse ne reçoit que la PIOCHE (`resources: false`) — cf. le
  // commentaire de `Monde.ressourcesLimitees`.
  const adverse = () => cote(enemy, player, ressourcesEnnemies, neutraliseesEnnemies, true);

  const trace = executer(duPalier, 'debut_combat', joueur());
  const ajoute = (t: { applique: string[]; neant: string[]; ignore: string[] }) => {
    trace.applique.push(...t.applique); trace.neant.push(...t.neant); trace.ignore.push(...t.ignore);
  };
  ajoute(executer(duPalier, 'debut_combat', adverse()));

  if (attr.timing === 'during_combat') {
    // ⚠️ **UNE mort déclenche les DEUX triggers, un par camp**, et c'est la
    // lecture exacte d'`onUnitNeutralized` : le camp du mort reçoit
    // `on_ally_neutralized`, le camp d'en face reçoit `on_enemy_neutralized`.
    // N'en jouer qu'un laisserait la moitié des porteurs muets — et ce serait
    // invisible, puisque l'autre moitié réagirait normalement.
    const mortDuCote = (mort: Unit, sonCamp: () => any, autreCamp: () => any) => {
      mort.is_neutralized = true;
      ajoute(executer(duPalier, 'allie_detruit', sonCamp()));
      ajoute(executer(duPalier, 'ennemi_detruit', autreCamp()));
    };
    mortDuCote(player[player.length - 1], joueur, adverse);
    mortDuCote(enemy[enemy.length - 1], adverse, joueur);
  } else if (attr.timing === 'end_of_combat') {
    const mort = player[player.length - 1];
    mort.is_neutralized = true;
    mort.current_hp = 0;
    neutralisees.push(mort);
    ajoute(executer(duPalier, 'fin_combat', joueur()));
    ajoute(executer(duPalier, 'fin_combat', adverse()));
  }

  return {
    etat: {
      joueur: player.map(etatUnite),
      ennemi: enemy.map(etatUnite),
      ressources: etatRessources({
        pioches: ressources.pioches,
        garanties: ressources.pioches_garanties,
        slots: ressources.slots_board,
        mult: ressources.multiplicateur,
        shop: ressources.magies_shop,
        reanimees: ressources.reanimees.map(u => u.card_id),
      }),
      sources: ressources.sources.map((s: any) => `${s.kind}:${s.ref}:${s.value}:${s.guaranteed ?? false}`),
    },
    trace,
  };
}

/** Tous les paliers du catalogue, à plat — un cas de test par palier. */
const PALIERS = AVEC_PALIERS.flatMap(a =>
  (a.thresholds ?? []).filter((t: any) => (t.effects ?? []).length)
    .map((t: any) => [`${a.id} ${a.name} · palier ${t.count}`, a.id, t.count] as const));

describe('Mode ombre — le compilateur d\'attribut', () => {
  // ⚠️ LE critère d'acceptation, côté compilation. Il vaut plus ici que partout
  // ailleurs : le refus « timing incohérent » est exactement la panne des onze
  // effets morts, transformée en erreur au lieu d'un silence.
  // Mutation : passer `ARCH_020` en `start_of_combat` → ROUGE, nommément.
  it('les attributs livrés compilent SANS AUCUN refus', () => {
    const { refus } = compileAttributes(AVEC_PALIERS);
    expect(refus).toEqual([]);
  });

  it('un effet compilé par effet source, avec sa condition de palier', () => {
    const { effets } = compileAttributes(AVEC_PALIERS);
    const sources = AVEC_PALIERS.reduce(
      (n, a) => n + (a.thresholds ?? []).reduce((m: number, t: any) => m + (t.effects ?? []).length, 0), 0);
    expect(effets).toHaveLength(sources);
    for (const e of effets) {
      expect(e.condition, e.id).toBeTruthy();
      expect(e.condition!.attribut, e.id).toBe(e.porteur);
    }
  });

  // ⚠️ LE critère d'acceptation, côté exécution — un cas par PALIER, pas par
  // attribut : deux paliers d'un même attribut ne font pas la même chose, et
  // c'est ce que l'étape 0 a figé.
  it.each(PALIERS)('%s — les deux chemins rendent le MÊME état', (_nom, attrId, count) => {
    const attr = attributes.find(a => a.id === attrId)!;
    const seuil = attr.thresholds.find((t: any) => t.count === count)!;
    expect(cheminCompile(attr, seuil).etat).toEqual(cheminActuel(attr, seuil));
  });

  it('aucune tâche n\'est ignorée à l\'exécution', () => {
    const ignores: string[] = [];
    for (const [nom, attrId, count] of PALIERS) {
      const attr = attributes.find(a => a.id === attrId)!;
      const seuil = attr.thresholds.find((t: any) => t.count === count)!;
      for (const x of cheminCompile(attr, seuil).trace.ignore) ignores.push(`${nom} → ${x}`);
    }
    expect(ignores).toEqual([]);
  });

  // Deux chemins qui ne font rien sont d'accord, et cet accord ne prouve rien.
  it('le chemin compilé écrit vraiment quelque chose, sur chaque palier', () => {
    const muets: string[] = [];
    for (const [nom, attrId, count] of PALIERS) {
      const attr = attributes.find(a => a.id === attrId)!;
      const seuil = attr.thresholds.find((t: any) => t.count === count)!;
      if (!cheminCompile(attr, seuil).trace.applique.length) muets.push(nom);
    }
    expect(muets).toEqual([]);
  });
});


// ───────────────────────────────────────────────────────────────────────────
// Ce que le CATALOGUE n'exerce pas
//
// ⚠️ Les attributs livrés n'exercent que huit des dix types codés :
// `board_slot_bonus` et `shopping_bonus` sont **codés des deux côtés et exercés
// par aucun**, et un seul effet du catalogue porte un plafond `max` — qui ne
// mord jamais sur un casting de la taille de son palier. Le mode ombre joué sur
// le seul catalogue laisserait donc trois branches sans preuve : vérifié en
// retirant le plafond du compilateur, qui ne faisait tomber AUCUN cas.
//
// Même geste que pour le terrain : des attributs SYNTHÉTIQUES, qui n'existent
// pas dans la donnée et existent pour que le compilateur soit comparé au moteur
// actuel sur tout ce qu'il sait traduire.
// ───────────────────────────────────────────────────────────────────────────

const SYNTHETIQUES: any[] = [
  {
    id: 'ARCH_SYNTH_SLOT', name: 'Slot', timing: 'end_of_combat',
    thresholds: [{ count: 2, effects: [{ type: 'board_slot_bonus', value: 1 }] }],
  },
  {
    id: 'ARCH_SYNTH_SHOP', name: 'Shopping', timing: 'end_of_combat',
    thresholds: [{ count: 2, effects: [{ type: 'shopping_bonus', value: 2, max: 3 }] }],
  },
  {
    // ⚠️ Le plafond MORD ici : deux effets de +3 sous un `max: 4` rendent 4, pas
    // 6. Le crédit réel est mesuré de part et d'autre, et c'est lui que le
    // registre de provenance doit annoncer — pas ce que l'effet demandait.
    id: 'ARCH_SYNTH_PIOCHE', name: 'Pioche plafonnée', timing: 'end_of_combat',
    thresholds: [{ count: 2, effects: [
      { type: 'draw_bonus', value: 3, max: 4 },
      { type: 'draw_bonus', value: 3, max: 4 },
    ] }],
  },
  {
    // Une valeur absente vaut 1 pour le seul `shopping_bonus` (`value ?? 1`).
    id: 'ARCH_SYNTH_SHOP_DEFAUT', name: 'Shopping par défaut', timing: 'end_of_combat',
    thresholds: [{ count: 1, effects: [{ type: 'shopping_bonus' }] }],
  },
];

describe('Mode ombre — les branches que le catalogue n\'exerce pas', () => {
  // ⚠️ Les attributs synthétiques doivent être CONNUS du manager : il résout
  // `this._attributeMap[attrId]` depuis la liste qu'on lui donne, et un attribut
  // absent de cette liste ne déclenche rien — les deux chemins seraient alors
  // d'accord sur un silence.
  const catalogue = [...attributes, ...SYNTHETIQUES];

  it.each(SYNTHETIQUES.flatMap(a => a.thresholds.map((t: any) => [`${a.id} · palier ${t.count}`, a.id, t.count] as const)))(
    '%s — les deux chemins rendent le MÊME état',
    (_nom, attrId, count) => {
      const attr = catalogue.find(a => a.id === attrId)!;
      const seuil = attr.thresholds.find((t: any) => t.count === count)!;
      expect(cheminCompile(attr, seuil).etat).toEqual(cheminActuel(attr, seuil, catalogue));
    },
  );

  it('le compilateur traduit les types que le catalogue n\'exerce pas', () => {
    const { effets, refus } = compileAttributes(SYNTHETIQUES, ATTR_IDS);
    expect(refus).toEqual([]);
    expect(effets.length).toBe(5);
  });
});

describe('Mode ombre — ce que le schéma rend impossible', () => {
  // ⚠️ **Le cœur de tout le chantier, en un cas.** La panne des onze effets
  // morts n'est pas rattrapée par le moteur générique : elle ne peut plus
  // s'écrire. Le `quand` vient du TYPE de l'effet, donc un `revive` est de fin
  // de combat où que son porteur prétende vivre — et le désaccord avec le
  // `timing` déclaré sort en refus NOMMÉ, avec les deux moments en clair.
  it('un effet dont le timing contredit son type est REFUSÉ, jamais muet', () => {
    const malPose = {
      id: 'ARCH_TEST', timing: 'start_of_combat',
      thresholds: [{ count: 1, effects: [{ type: 'revive', hp_percent: 10 }] }],
    };
    const { effets, refus } = compileAttribute(malPose as any);
    expect(effets).toEqual([]);
    expect(refus).toHaveLength(1);
    expect(refus[0].raison).toBe('timing incohérent');
    expect(refus[0].detail).toContain('fin_combat');
  });

  // Le pendant : bien posé, il compile et se déclenche au bon moment.
  it('le même effet, bien posé, compile et se déclenche à la fin du combat', () => {
    const bienPose = {
      id: 'ARCH_TEST', timing: 'end_of_combat',
      thresholds: [{ count: 1, effects: [{ type: 'revive', hp_percent: 10 }] }],
    };
    const { effets, refus } = compileAttribute(bienPose as any);
    expect(refus).toEqual([]);
    expect(effets[0].trigger.quand).toBe('fin_combat');
  });

  // ⚠️ Un `stat_modifier` porte son `quand` dans son propre `trigger`. Un
  // déclencheur inconnu ne déclenchait simplement jamais ; ici, il ne compile
  // pas.
  it('un stat_modifier au déclencheur inconnu est REFUSÉ', () => {
    const orphelin = {
      id: 'ARCH_TEST', timing: 'during_combat',
      thresholds: [{ count: 1, effects: [{ type: 'stat_modifier', stat: 'atk', value: 2, trigger: 'on_round_start' }] }],
    };
    const { effets, refus } = compileAttribute(orphelin as any);
    expect(effets).toEqual([]);
    expect(refus[0].raison).toBe('déclencheur inconnu');
  });

  // ⚠️ Le `value_per` que le `<select>` de l'admin propose (`active_unit`) n'est
  // pas un attribut : sur un `stat_bonus`, le moteur actuel chercherait des
  // porteurs d'un attribut de ce nom, n'en trouverait aucun, et le bonus vaudrait
  // ZÉRO en silence. Le compilateur le refuse.
  it('un value_per qui ne nomme pas un attribut est REFUSÉ sur un stat_bonus', () => {
    const piege = {
      id: 'ARCH_TEST', timing: 'start_of_combat',
      thresholds: [{ count: 1, effects: [{ type: 'stat_bonus', stat: 'atk', value: 5, value_per: 'active_unit' }] }],
    };
    const { refus } = compileAttribute(piege as any, ATTR_IDS);
    expect(refus.map(r => r.raison)).toEqual(['value_per inconnu']);
  });
});
