/* eslint-disable @typescript-eslint/no-explicit-any */
// ÉTAPE 0 du moteur d'effets générique — la caractérisation des ATTRIBUTS.
//
// Le troisième et dernier porteur de l'étape 0, après le terrain et les magies.
// Il ne décrit aucune règle nouvelle : il **fige ce que les attributs livrés
// font aujourd'hui, palier par palier**, pour que le compilateur
// `attribut → Effet[]` de l'étape 1 se diffe contre un oracle plutôt que contre
// une intention. Cf. `docs/moteur-effets.md` §6.1.
//
// ⚠️ Le partage avec `attributes.test.ts`, à tenir : celui-là éprouve les RÈGLES
// (le comptage par `card_id` distinct, le verrouillage des seuils, le balayage
// de fin de combat) sur des attributs synthétiques ; celui-ci éprouve le
// CATALOGUE. Une règle qui change casse le premier, une donnée qui change casse
// celui-ci.
//
// ⚠️ C'est le porteur le plus RICHE des trois, et la seule raison en est le
// `timing` : les mêmes huit types d'effet passent par TROIS passes distinctes,
// chacune n'en exécutant qu'une poignée. C'est ce découplage — le `timing` vit
// sur l'attribut, la forme de l'effet sur l'effet — qui a produit onze des
// vingt-et-un effets morts (§1.4). L'oracle exerce donc chaque palier dans la
// passe que son `timing` désigne, et nulle part ailleurs.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AttributeManager } from '../logic/AttributeManager.js';
import { Unit } from '../logic/Unit.js';
import { makeCard } from './helpers.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const attributes: any[] = JSON.parse(readFileSync(path.join(ROOT, 'initial-data/attributes.json'), 'utf8'));
const ATTR_IDS = new Set<string>(attributes.map(a => a.id));

/** Ce que chaque passe d'`AttributeManager` sait exécuter — ses `case`, en dur. */
const PAR_TIMING: Record<string, Set<string>> = {
  start_of_combat: new Set(['stat_bonus', 'shield', 'effect_immunity']),
  during_combat: new Set(['stat_modifier']),
  end_of_combat: new Set(['revive', 'draw_bonus', 'guaranteed_draw', 'board_slot_bonus', 'damage_multiplier_bonus', 'shopping_bonus']),
  none: new Set(),
};

/** Les deux déclencheurs que `_triggerStatModifiers` connaît. */
const TRIGGERS = ['on_ally_neutralized', 'on_enemy_neutralized'];

const BASE = { atk: 20, hp: 200, movement_rate: 50, attack_rate: 50, range: 3 };

/** Les attributs qui portent au moins un palier — les seuls qui font quelque chose. */
const AVEC_PALIERS = attributes.filter(a => (a.thresholds ?? []).length > 0);

function unit(cardId: string, attrs: string[], side: 'player' | 'enemy'): Unit {
  return new (Unit as any)(
    makeCard({ id: cardId, name: cardId, attributes: attrs, stats: { ...BASE } as any }),
    side,
  ) as Unit;
}

/**
 * Les attributs qu'un palier compte SUR LE CAMP ADVERSE (`value_per`).
 *
 * ⚠️ `value_per` ne nomme PAS l'attribut porteur, mais un autre : `ARCH_016`
 * (Épée Destructrice) multiplie son bonus par le nombre d'ennemis portant
 * `ARCH_003` (Dragon). Un casting qui ne peuplerait le camp adverse que de
 * porteurs de l'attribut testé rendrait un multiplicateur NUL — et
 * `applyStartOfCombat` sort sur `if (bonus === 0) break`, donc l'oracle
 * figerait un silence sur un effet parfaitement vivant.
 */
function valuePerAttributes(threshold: any, connus: Set<string>): string[] {
  return (threshold.effects ?? [])
    .map((e: any) => e.value_per)
    .filter((v: any) => typeof v === 'string' && connus.has(v));
}

/**
 * Le casting d'un palier : `count` unités de `card_id` DISTINCTS portant
 * l'attribut, de chaque côté.
 *
 * ⚠️ Distincts, et c'est la règle elle-même : `AttributeManager` compte les
 * unités par `card_id` unique — deux exemplaires de la même carte ne valent
 * qu'un lien. Un casting qui les répéterait n'atteindrait jamais le palier, et
 * l'oracle figerait un silence.
 *
 * ⚠️ Le camp adverse est peuplé du MÊME nombre : c'est ce que `value_per`
 * multiplie (« × le nombre d'unités adverses portant l'attribut »). Sans lui,
 * tout `stat_bonus` à `value_per` figerait un zéro.
 */
function casting(attrId: string, count: number, comptesAdverses: string[] = []) {
  const player: Unit[] = [];
  const enemy: Unit[] = [];
  for (let i = 0; i < count; i++) {
    player.push(unit(`P${i}_${attrId}`, [attrId], 'player'));
    // Le camp adverse porte l'attribut testé ET ceux que `value_per` compte.
    enemy.push(unit(`E${i}_${attrId}`, [attrId, ...comptesAdverses], 'enemy'));
  }
  return { player, enemy };
}

/** L'état d'une unité qu'un effet d'attribut peut toucher. */
function etat(u: Unit): string {
  return [
    `pv ${u.current_hp}/${u.max_hp}`, `atq ${u.atk}`,
    `dep ${u.movement_rate}`, `vit ${u.attack_rate}`, `por ${u.range}`,
    `bcl ${u.shield}`,
    u.is_effect_immune ? 'immunisé' : null,
    u._stat_bonuses.power_charge ? `charge +${u._stat_bonuses.power_charge}` : null,
    u.is_neutralized ? 'neutralisé' : null,
  ].filter(Boolean).join(' · ');
}

/** Ce qui a bougé sur un camp, unité par unité — ou rien. */
function deltas(units: Unit[], avant: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  units.forEach((u, i) => { if (avant[i] !== etat(u)) out[u.card_id] = `${avant[i]} → ${etat(u)}`; });
  return out;
}

/**
 * Exerce UN palier dans la passe que son `timing` désigne, et rend ce qu'il a
 * changé.
 */
function exerce(attr: any, threshold: any) {
  const { player, enemy } = casting(attr.id, threshold.count, valuePerAttributes(threshold, ATTR_IDS));
  // ⚠️ Les deux tableaux sont liés à des VARIABLES et passés tels quels :
  // `_triggerStatModifiers` reconnaît le camp par ÉGALITÉ DE RÉFÉRENCE
  // (`affectedUnits === this.playerUnits`). Un tableau neuf portant les mêmes
  // unités ferait lire le cache du camp adverse — donc ne déclencherait rien,
  // en silence. La production passe bien les mêmes références
  // (`CombatManager`) ; ce test s'y est fait prendre en premier.
  const mgr = new (AttributeManager as any)(attributes, player, enemy);

  const avantP = player.map(etat);
  const avantE = enemy.map(etat);
  let resultat: any = null;

  if (attr.timing === 'start_of_combat') {
    mgr.applyStartOfCombat();
  } else if (attr.timing === 'during_combat') {
    // ⚠️ `applyStartOfCombat` d'abord, TOUJOURS : c'est lui qui VERROUILLE les
    // seuils `during_combat`. Sans cet appel, `_duringCombatThresholds` est nul
    // et aucun `stat_modifier` ne part — l'oracle figerait un silence là où le
    // combat, lui, déclenche.
    mgr.applyStartOfCombat();
    // Les deux déclencheurs, dans un ordre fixe : un allié tombe, puis un
    // ennemi. Chacun ne réveille que les effets qui le nomment.
    const allie = player[player.length - 1];
    allie.is_neutralized = true;
    mgr.onUnitNeutralized(allie, player, enemy);
    const adverse = enemy[enemy.length - 1];
    adverse.is_neutralized = true;
    mgr.onUnitNeutralized(adverse, player, enemy);
  } else if (attr.timing === 'end_of_combat') {
    // Un mort de chaque côté : `revive` n'a rien à réanimer sans lui, et le
    // décompte de fin de combat inclut les neutralisés à dessein (le palier
    // tient même si ses porteurs sont morts).
    const mortP = player[player.length - 1];
    mortP.is_neutralized = true;
    mortP.current_hp = 0;
    resultat = mgr.applyEndOfCombat([mortP], []);
  }

  return {
    joueur: deltas(player, avantP),
    ennemi: deltas(enemy, avantE),
    ressources: resultat ? {
      pioches: resultat.draw_bonus,
      garanties: resultat.guaranteed_draws.map((d: any) =>
        [d.tier ?? '—', (d.attributes ?? []).join('|') || (d.attribute ?? '—'), (d.card_ids ?? []).join('|') || '—'].join(':')),
      slots: resultat.board_slot_bonus,
      multiplicateur: resultat.damage_multiplier_bonus,
      shopping: resultat.shopping_bonus,
      reanimes: resultat.revived.map((u: Unit) => u.card_id),
    } : null,
  };
}

/** Un palier a-t-il produit quoi que ce soit ? */
function muet(r: ReturnType<typeof exerce>): boolean {
  if (Object.keys(r.joueur).length || Object.keys(r.ennemi).length) return false;
  const res = r.ressources;
  if (!res) return true;
  return res.pioches === 0 && res.garanties.length === 0 && res.slots === 0
    && res.multiplicateur === 0 && res.shopping === 0 && res.reanimes.length === 0;
}

describe('Attributs livrés — invariants du catalogue', () => {
  it('le catalogue est là, et ses porteurs d\'effet aussi', () => {
    expect(attributes.length).toBeGreaterThan(50);
    expect(AVEC_PALIERS.length).toBeGreaterThan(40);
    for (const a of attributes) expect(typeof a.id, a.name).toBe('string');
  });

  // ⚠️ LE garde-fou de l'étape 0 côté attributs, et la panne qu'il ferme est la
  // plus grosse des deux familles d'effets morts : le `timing` vit sur
  // l'ATTRIBUT, la forme de l'effet sur l'EFFET, et rien ne les accorde. Un
  // `revive` posé sous un `start_of_combat` traverse le combat sans être
  // atteint — `_applyEndForSide` sort sur `attr.timing !== 'end_of_combat'`.
  // C'est ce qui a tué onze effets sur treize porteurs.
  // Mutation : passer `ARCH_020` en `start_of_combat` → ROUGE.
  it('aucun effet ne porte un type que la passe de son timing n\'exécute pas', () => {
    const morts: string[] = [];
    for (const a of AVEC_PALIERS) {
      const handled = PAR_TIMING[a.timing];
      if (handled === undefined) { morts.push(`${a.id} ${a.name} → timing inconnu '${a.timing}'`); continue; }
      for (const t of a.thresholds) {
        for (const e of (t.effects ?? [])) {
          if (!handled.has(e.type)) morts.push(`${a.id} ${a.name} (palier ${t.count}) → ${e.type} sous ${a.timing}`);
        }
      }
    }
    expect(morts).toEqual([]);
  });

  // ⚠️ Un `stat_modifier` sans `trigger` connu ne part jamais :
  // `_triggerStatModifiers` compare `effect.trigger` aux deux déclencheurs, et
  // un troisième nom ne réveille rien. Même famille de panne, quatrième forme.
  // Mutation : `trigger: 'on_round_start'` sur `ARCH_045` → ROUGE.
  it('tout stat_modifier nomme un déclencheur que le moteur connaît', () => {
    const orphelins: string[] = [];
    for (const a of AVEC_PALIERS) {
      for (const t of a.thresholds) {
        for (const e of (t.effects ?? [])) {
          if (e.type === 'stat_modifier' && !TRIGGERS.includes(e.trigger)) {
            orphelins.push(`${a.id} ${a.name} → trigger '${e.trigger}'`);
          }
        }
      }
    }
    expect(orphelins).toEqual([]);
  });

  // Même sonde que pour les terrains et les magies, et pour la même raison : une
  // table de noms recopiée serait un inventaire de plus du vocabulaire des
  // stats — exactement la décorrélation écriture/lecture qui a produit la
  // première famille d'effets morts.
  //
  // ⚠️ `power_charge` est l'EXCEPTION du jeu, et les attributs sont le seul
  // porteur qui s'en serve : elle ne passe pas par `_recomputeStats`, le combat
  // la lit directement dans `_stat_bonuses` (`CombatManager` :
  // `power_gauge += 1 + power_charge`). La sonde la reconnaît donc à part —
  // écrite, elle est vivante.
  // Mutation : `stat: 'vitesse'` sur un attribut → ROUGE.
  it('toute stat nommée par un attribut bouge quelque chose sur l\'unité', () => {
    const mortes: string[] = [];
    for (const a of AVEC_PALIERS) {
      for (const t of a.thresholds) {
        for (const e of (t.effects ?? [])) {
          if (e.stat == null) continue;
              const u = unit('sonde', [a.id], 'player');
          const avant = etat(u);
          u.applyStatBonus(e.stat, 7);
          if (etat(u) === avant) mortes.push(`${a.id} ${a.name} → ${e.stat}`);
        }
      }
    }
    expect(mortes).toEqual([]);
  });

  // Les paliers d'un attribut sont testés en `count >= t.count` et le PLUS HAUT
  // atteint gagne : deux paliers de même effectif rendraient le premier
  // inatteignable, et un palier non croissant serait ignoré en silence.
  // Mutation : dupliquer un `count` sur un attribut → ROUGE.
  it('les paliers d\'un attribut sont strictement croissants', () => {
    const fautes: string[] = [];
    for (const a of AVEC_PALIERS) {
      const counts = a.thresholds.map((t: any) => t.count);
      for (let i = 1; i < counts.length; i++) {
        if (!(counts[i] > counts[i - 1])) fautes.push(`${a.id} ${a.name} → ${counts.join(' → ')}`);
      }
      if (counts.some((c: number) => !Number.isInteger(c) || c < 1)) fautes.push(`${a.id} ${a.name} → palier invalide`);
    }
    expect([...new Set(fautes)]).toEqual([]);
  });

  // ⚠️ `value_per` n'est lu QUE par `stat_bonus`, et il y désigne un **attribut**
  // dont on compte les porteurs adverses. Le `<select>` de l'admin propose en
  // plus `active_unit` (« unités alliées vivantes ») — une valeur que
  // `stat_bonus` ne sait pas lire : il chercherait des unités portant un
  // attribut nommé `active_unit`, n'en trouverait aucune, et
  // `applyStartOfCombat` sort sur `if (bonus === 0) break`. **Le bonus serait
  // nul, en silence.**
  //
  // Les trois paliers d'`ARCH_023` (Elfe) le portent déjà, mais sur un `shield`
  // — qui ignore `value_per` de bout en bout et multiplie toujours par le nombre
  // d'alliés vivants. Le champ y est décoratif et le résultat se trouve être
  // celui qu'il annonce ; c'est pour ça que rien ne se voit aujourd'hui. Le
  // même champ posé sur un `stat_bonus` est à un clic, et donnerait zéro.
  // Mutation : `value_per: 'active_unit'` sur le stat_bonus d'`ARCH_016` → ROUGE.
  it('tout value_per lu par un stat_bonus désigne un attribut qui existe', () => {
    const morts: string[] = [];
    for (const a of AVEC_PALIERS) {
      for (const t of a.thresholds) {
        for (const e of (t.effects ?? [])) {
          if (e.type !== 'stat_bonus' || e.value_per == null) continue;
          if (!ATTR_IDS.has(e.value_per)) morts.push(`${a.id} ${a.name} (palier ${t.count}) → value_per '${e.value_per}'`);
        }
      }
    }
    expect(morts).toEqual([]);
  });

  // Un attribut à paliers dont le `timing` est `none` n'a aucune passe : il est
  // écrit, éditable, annoncé au SynergyPanel — et ne fera jamais rien.
  // Mutation : passer un attribut à effets en `timing: 'none'` → ROUGE.
  it('aucun attribut porteur d\'effets n\'est en timing « none »', () => {
    const descriptifs = AVEC_PALIERS
      .filter(a => a.timing === 'none' && a.thresholds.some((t: any) => (t.effects ?? []).length > 0))
      .map(a => `${a.id} ${a.name}`);
    expect(descriptifs).toEqual([]);
  });
});

describe('Attributs livrés — l\'oracle de l\'étape 0', () => {
  // ⚠️ CE snapshot est le contrat que le moteur générique devra reproduire,
  // palier par palier. Il ne se met PAS à jour à la légère : une ligne qui bouge
  // veut dire que l'attribut ne fait plus la même chose, ce qui est soit la
  // donnée qui a changé, soit une régression.
  it('ce que chaque palier de chaque attribut fait, figé', () => {
    const oracle = AVEC_PALIERS.map(a => ({
      id: a.id,
      nom: a.name,
      timing: a.timing,
      categorie: a.categorie,
      paliers: a.thresholds.map((t: any) => ({
        palier: t.count,
        effets: (t.effects ?? []).map((e: any) => [
          e.type, e.stat ?? null, e.value ?? null,
          e.value_per ? `par:${e.value_per}` : null,
          e.trigger ?? null, e.max != null ? `max:${e.max}` : null,
          e.hp_percent != null ? `pv%:${e.hp_percent}` : null,
          e.attributes?.join('|') ?? e.attribute ?? null,
          e.tier != null ? `tier:${e.tier}` : null,
        ].filter(x => x !== null).join(' · ')),
        ...exerce(a, t),
      })),
    }));
    expect(oracle).toMatchSnapshot();
  });

  // ⚠️ Le pendant du snapshot, et il n'est pas redondant : le snapshot dit CE
  // QUI arrive, celui-ci dit qu'AUCUN palier livré n'est muet. Un palier qui ne
  // fait rien est un effet mort — et dans un snapshot de cette taille, un
  // « rien » se relit sans y penser. C'est le test qui aurait attrapé les
  // vingt-et-un, et celui qui attrapera le vingt-deuxième.
  // Mutation : `type: 'revive'` sous un `start_of_combat` → ROUGE.
  it('aucun palier livré ne s\'applique sans rien produire', () => {
    const muets: string[] = [];
    for (const a of AVEC_PALIERS) {
      for (const t of a.thresholds) {
        if (!(t.effects ?? []).length) continue;
        if (muet(exerce(a, t))) muets.push(`${a.id} ${a.name} (palier ${t.count}) — ${t.effects.map((e: any) => e.type).join(', ')}`);
      }
    }
    expect(muets).toEqual([]);
  });
});
