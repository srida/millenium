/* eslint-disable @typescript-eslint/no-explicit-any */
// L'ÉCHELLE DE TICKS — le compteur 0–100 qui a remplacé les périodes et les
// durées chiffrées en ticks.
//
// Ce fichier tient quatre choses, et elles ne se recouvrent pas :
//   1. l'échelle elle-même (bornes, aller-retour, additivité), dans ses DEUX
//      lectures — un RYTHME descend en ticks quand le compteur monte, une
//      DURÉE monte avec lui ;
//   2. le CATALOGUE LIVRÉ, qui doit y être entièrement passé — c'est le seul
//      filet contre une reprise de données à moitié faite, exactement comme
//      `tiers.test.ts` l'est pour le champ `tier` ;
//   3. les deux effets qui étaient MUETS avant la bascule et qui ne doivent
//      plus l'être ;
//   4. le CONTRAT de carte, qui refuse en 400 un champ resté en ticks.
// Chaque cas de régression est éprouvé dans les deux sens (cf. la mutation
// annoncée en tête de cas).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  ticksForRate, rateForTicks, clampRate, rateDeltaForTickDelta,
  ticksForDuration, durationForTicks, DURATION_POWERS,
  TICKS_AT_MIN, TICKS_AT_MAX, TICKS_PER_POINT, RATE_STATS, LEGACY_TICK_FIELD,
} from '../../../speed-scale.mjs';
// ⚠️ Le contrat est en CJS (requis par `app.js` et l'audit) : `createRequire`
// est la seule façon de le lire depuis un test ESM.
import { createRequire } from 'node:module';
import { Unit } from '../logic/Unit.js';
import { makeCard } from './helpers.js';

const ROOT = join(__dirname, '../../..');
const readCatalog = (f: string) => JSON.parse(readFileSync(join(ROOT, 'initial-data', f), 'utf8'));
const {
  RATE_FIELDS, missingRates, DURATION_POWERS: CONTRACT_DURATION_POWERS, missingDurations,
} = createRequire(import.meta.url)(join(ROOT, 'card-contract.js'));

describe('speed-scale — l\'échelle', () => {
  it('tient ses deux bornes', () => {
    expect(ticksForRate(0)).toBe(TICKS_AT_MIN);
    expect(ticksForRate(0)).toBe(77);
    expect(ticksForRate(100)).toBe(TICKS_AT_MAX);
    expect(ticksForRate(100)).toBe(2);
    expect(TICKS_PER_POINT).toBe(0.75);
  });

  it('est MONOTONE : un compteur plus haut ne rend jamais une période plus longue', () => {
    for (let c = 1; c <= 100; c++) {
      expect(ticksForRate(c), `compteur ${c}`).toBeLessThanOrEqual(ticksForRate(c - 1));
    }
  });

  // ⚠️ LE test de la reprise de données : c'est lui qui autorise à dire que la
  // migration des 868 cartes n'a pas changé un seul combat. Ce qui le tient est
  // la LARGEUR de l'intervalle (1,33 compteur par tick, donc au moins un entier
  // dedans), pas le sens de l'arrondi.
  // Mutation : `TICKS_AT_MIN = 200` (l'intervalle tombe sous 1) → ROUGE.
  it('l\'aller-retour ticks → compteur → ticks est EXACT sur toute la plage', () => {
    const cassés: number[] = [];
    for (let t = TICKS_AT_MAX; t <= TICKS_AT_MIN; t++) {
      if (ticksForRate(rateForTicks(t)) !== t) cassés.push(t);
    }
    expect(cassés).toEqual([]);
  });

  // ⚠️ Le sens de l'arrondi, lui, se tient ICI et nulle part ailleurs : la
  // période annoncée ne doit jamais être PLUS COURTE que ce que le compteur
  // dit, sans quoi une unité agit un tick avant son propre réglage. Le cas ne
  // se voit pas sur les valeurs du catalogue (elles retombent toutes sur des
  // fractions ≤ 0,5, où `round` et `ceil` coïncident) — il n'apparaît que sur
  // un compteur saisi à la main en admin.
  // Mutation : `ticksForRate` en `Math.round` → ROUGE (au compteur 1).
  it('n\'annonce JAMAIS une période plus courte que le compteur ne le dit', () => {
    for (let c = 0; c <= 100; c++) {
      expect(ticksForRate(c), `compteur ${c}`).toBeGreaterThanOrEqual(TICKS_AT_MIN - TICKS_PER_POINT * c);
    }
  });

  // La seule propriété que la courbe linéaire a et qu'aucune autre n'a. Elle
  // porte tous les `stat_bonus` du jeu : un bonus vaut la même chose où qu'il
  // tombe, et deux bonus s'additionnent sans se contredire.
  it('est ADDITIVE : +4 compteur vaut exactement −3 ticks, partout', () => {
    for (let c = 0; c <= 96; c += 4) {
      expect(ticksForRate(c) - ticksForRate(c + 4), `depuis ${c}`).toBe(3);
    }
  });

  it('écrête hors bornes plutôt que de sortir de l\'échelle', () => {
    expect(clampRate(-40)).toBe(0);
    expect(clampRate(420)).toBe(100);
    // ⚠️ Un pouvoir à 250 ticks n'a pas d'équivalent : il tombe au plus lent.
    // C'est le plafonnement VOULU, pas un accident de conversion.
    expect(rateForTicks(250)).toBe(0);
    expect(rateForTicks(1)).toBe(100);
  });

  it('une entrée illisible ne fabrique pas une unité figée', () => {
    expect(clampRate(undefined)).toBe(0);
    expect(clampRate(NaN)).toBe(0);
    expect(rateDeltaForTickDelta(undefined)).toBe(0);
  });

  it('un delta de ticks se retourne en delta de compteur', () => {
    // ⚠️ Le signe s'INVERSE : « −5 ticks » (l'ancien Raigeki) est une
    // accélération, donc un compteur qui MONTE.
    expect(rateDeltaForTickDelta(-5)).toBe(7);
    expect(rateDeltaForTickDelta(-3)).toBe(4);
    expect(rateDeltaForTickDelta(3)).toBe(-4);
  });
});

describe('speed-scale — le catalogue livré', () => {
  const cards = readCatalog('cards.json');

  it('porte partout les compteurs, et plus une seule période résiduelle', () => {
    const résidus: string[] = [];
    const horsBornes: string[] = [];
    for (const c of cards) {
      for (const legacy of ['attack_speed', 'movement_speed']) {
        if (legacy in (c.stats ?? {})) résidus.push(`${c.id}.stats.${legacy}`);
      }
      if ('power_speed' in (c.power ?? {})) résidus.push(`${c.id}.power.power_speed`);
      for (const stat of RATE_STATS) {
        const v = c.stats?.[stat];
        if (typeof v !== 'number' || v < 0 || v > 100) horsBornes.push(`${c.id}.${stat} = ${v}`);
      }
      const pr = c.power?.power_rate;
      if (pr != null && (pr < 0 || pr > 100)) horsBornes.push(`${c.id}.power_rate = ${pr}`);
    }
    expect(résidus).toEqual([]);
    expect(horsBornes).toEqual([]);
  });

  // Tout le propos de la bascule tient dans ce cas : avant, CHAQUE bonus de
  // vitesse livré s'écrivait en négatif (« Raigeki −5 », « Magicien −1/−2/−3 »,
  // sept terrains), parce qu'un bonus devait faire BAISSER une période. Un
  // joueur n'avait aucun moyen de le deviner.
  it('n\'écrit plus un seul bonus de vitesse en négatif', () => {
    const négatifs: string[] = [];
    const visit = (effets: any, source: string) => {
      for (const e of ([] as any[]).concat(effets ?? [])) {
        if (!e) continue;
        if (e.thresholds) { for (const t of e.thresholds) visit(t.effects, source); continue; }
        if (RATE_STATS.includes(e.stat) && e.value < 0) négatifs.push(`${source} : ${e.stat} ${e.value}`);
      }
    };
    for (const m of readCatalog('magies.json')) visit(m.effect, `${m.id} (${m.name})`);
    for (const a of readCatalog('attributes.json')) {
      visit(a.effects, `${a.id} (${a.name})`);
      visit(a.effect, `${a.id} (${a.name})`);
      for (const t of a.thresholds ?? []) visit(t.effects, `${a.id} (${a.name})`);
    }
    for (const b of readCatalog('boards.json')) {
      visit(b.effects, `${b.id} (${b.name})`);
      visit(b.effect, `${b.id} (${b.name})`);
    }
    expect(négatifs).toEqual([]);
  });
});

describe('speed-scale — l\'unité', () => {
  const unit = (rates: Record<string, number>, power?: any) =>
    new Unit(makeCard({ stats: { ...rates } as any, power }) as any, 'player');

  it('dérive ses deux périodes de ses compteurs', () => {
    const u = unit({ attack_rate: 92, movement_rate: 76 });
    expect(u.attack_period).toBe(8);
    expect(u.movement_period).toBe(20);
  });

  // ⚠️ Le piège que `null` existe pour éviter : 0 est une valeur LÉGITIME du
  // compteur depuis la bascule (le pouvoir le plus lent), là où l'ancien seuil
  // en ticks ne pouvait pas valoir zéro. Confondre les deux — ce que ferait un
  // `||` — donnerait un pouvoir à qui n'en a pas.
  // Mutation : `power_rate ?? null` → `power_rate || 0` dans `Unit` → ROUGE.
  it('distingue « pas de vitesse de pouvoir » du compteur 0', () => {
    const muet = unit({}, { id: 'POWER_HEAL' });
    expect(muet.power_rate).toBeNull();
    expect(muet.powerPeriod()).toBe(Infinity);
    expect(muet.isPowerReady()).toBe(false);

    const lent = unit({}, { id: 'POWER_HEAL', power_rate: 0 });
    expect(lent.powerPeriod()).toBe(77);
    lent.power_gauge = 77;
    expect(lent.isPowerReady()).toBe(true);
  });

  // ⚠️ RÉGRESSION. `_recomputeStats` recopiait `_base.movement_speed` sans
  // jamais lire son bonus : tous les effets de déplacement livrés (attributs
  // Bête et Aquatique, terrains Cimetière, Vallée des rois, Mur du Labyrinthe,
  // Monde transparent) ne faisaient RIEN, et rien ne le signalait — une unité
  // qui ne va pas plus vite ressemble à une unité normale.
  // Mutation : `this.movement_rate = clampRate(this._base.movement_rate)` → ROUGE.
  it('applique le bonus de DÉPLACEMENT, qui était muet', () => {
    const u = unit({ movement_rate: 50 });
    expect(u.movement_period).toBe(40);
    u.applyStatBonus('movement_rate', 20);
    expect(u.movement_rate).toBe(70);
    expect(u.movement_period).toBe(25);
  });

  // ⚠️ RÉGRESSION. `applyStatModifier` ne connaissait qu'`atk` et `hp` : le
  // seul attribut du catalogue qui vise un rythme en `during_combat`
  // (`ARCH_045` Volant) traversait le combat sans rien faire.
  // Mutation : retirer la branche `RATE_STATS` d'`applyStatModifier` → ROUGE.
  it('applique un stat_modifier de rythme, qui était muet', () => {
    const u = unit({ attack_rate: 60 });
    expect(u.attack_period).toBe(32);
    u.applyStatModifier('attack_rate', 12);
    expect(u.attack_rate).toBe(72);
    expect(u.attack_period).toBe(23);
  });

  // Un rythme passe par `_stat_bonuses`, donc il doit SURVIVRE au recalcul que
  // déclenche n'importe quel autre bonus — c'est ce qu'une écriture directe sur
  // la stat effective (le geste d'`atk`) aurait perdu au premier appel venu.
  it('un bonus de rythme survit au recalcul déclenché par un autre bonus', () => {
    const u = unit({ attack_rate: 60 });
    u.applyStatModifier('attack_rate', 12);
    u.applyStatBonus('atk', 5);
    expect(u.attack_rate).toBe(72);
  });

  // ⚠️ Le bornage EST la fonctionnalité : « limiter ces statistiques » était la
  // demande. Un empilement de bonus ne peut plus descendre sous 2 ticks.
  it('BORNE l\'empilement des bonus aux deux extrémités', () => {
    const vif = unit({ attack_rate: 90 });
    vif.applyStatBonus('attack_rate', 50);
    expect(vif.attack_rate).toBe(100);
    expect(vif.attack_period).toBe(2);

    const lourd = unit({ movement_rate: 10 });
    lourd.applyStatBonus('movement_rate', -50);
    expect(lourd.movement_rate).toBe(0);
    expect(lourd.movement_period).toBe(77);
  });

  // ⚠️ Le départage d'initiative compare la PÉRIODE, donc la plus lente
  // d'abord — c'est ce qu'il faisait quand la stat était elle-même une période.
  // Le comparer sur le compteur inverserait l'ordre d'action de toutes les
  // égalités d'initiative, en silence, et ferait diverger un PvP.
  // Mutation : comparer `attack_rate` dans `CombatManager` → ROUGE.
  it('la période, et non le compteur, ordonne les égalités d\'initiative', () => {
    const rapide = unit({ attack_rate: 100 });
    const lent = unit({ attack_rate: 40 });
    expect(lent.effectiveAttackPeriod()).toBeGreaterThan(rapide.effectiveAttackPeriod());
    expect(lent.attack_rate).toBeLessThan(rapide.attack_rate);
  });
});

describe('speed-scale — le contrat de carte', () => {
  // ⚠️ LE cas qui manquait, et la panne qu'il a coûtée : `bootstrap()` ne
  // recopie jamais `initial-data/` sur un `data/` déjà peuplé, donc toute
  // installation antérieure à la bascule garde son `attack_speed` en ticks.
  // `Unit` lisait alors `clampRate(undefined)` — c'est-à-dire 0, le rythme le
  // PLUS LENT — et rien nulle part ne le disait : les unités jouaient au
  // ralenti, l'admin affichait le milieu du curseur, et le tooltip laissait
  // deux cases blanches. Le contrat est ce qui rend ce silence impossible.
  // Mutation : vider `missingRates` → ROUGE.
  it('refuse une carte restée en TICKS, et le dit champ par champ', () => {
    const legacy = {
      id: 'VIEILLE', name: 'Vieille',
      stats: { atk: 5, hp: 30, movement_speed: 10, attack_speed: 14, initiative: 5, range: 1 },
      power: { id: 'POWER_HEAL', power_speed: 60 },
    };
    const problems = missingRates(legacy);
    expect(problems.join(' | ')).toContain('attack_speed');
    expect(problems.join(' | ')).toContain('movement_speed');
    expect(problems.join(' | ')).toContain('power_speed');
    // Le remède est NOMMÉ : un refus qui ne dit pas quoi faire se re-diagnostique.
    expect(problems.join(' | ')).toContain('migrate-speeds');
  });

  it('refuse une carte dont le compteur est simplement ABSENT', () => {
    expect(missingRates({ id: 'X', stats: { atk: 5, hp: 30, initiative: 5, range: 1 } }))
      .toHaveLength(2);
    // ⚠️ `0` est une valeur LÉGITIME : le contrat teste la présence, pas la
    // vérité. Le confondre avec une absence interdirait le pouvoir le plus lent.
    expect(missingRates({ id: 'X', stats: { atk: 5, hp: 30, attack_rate: 0, movement_rate: 0 } }))
      .toEqual([]);
  });

  it('laisse passer le catalogue livré', () => {
    const fautives = readCatalog('cards.json').filter((c: any) => missingRates(c).length);
    expect(fautives.map((c: any) => c.id)).toEqual([]);
  });

  // ⚠️ Les deux listes sont des JUMELLES séparées par la frontière CJS / ESM
  // (`card-contract.js` est requis par `app.js` et l'audit ; `speed-scale.mjs`
  // est importé par le bundle et `admin.html`). C'est le seul filet contre leur
  // dérive — exactement le rôle que `tiers.test.ts` tient pour `tiers.js`.
  it('le contrat et l\'échelle nomment les mêmes rythmes', () => {
    expect(Object.keys(RATE_FIELDS).sort()).toEqual([...RATE_STATS].sort());
    for (const [rate, legacy] of Object.entries(RATE_FIELDS)) {
      expect((LEGACY_TICK_FIELD as Record<string, string>)[rate]).toBe(legacy);
    }
  });
});

// ---------------------------------------------------------------------------
// LES DURÉES — la même fenêtre de ticks, lue dans l'autre sens.
// ---------------------------------------------------------------------------

describe('speed-scale — l\'échelle de durée', () => {
  // ⚠️ LE cas qui distingue les deux lectures, et le contresens qu'il interdit.
  // Mutation : faire rendre `ticksForRate` à `ticksForDuration` → ROUGE.
  it('MONTE avec le compteur, là où le rythme descend', () => {
    expect(ticksForDuration(0)).toBe(TICKS_AT_MAX);   // 2 ticks : le plus bref
    expect(ticksForDuration(100)).toBe(TICKS_AT_MIN); // 77 ticks : le plus long
    // Le sens, énoncé sans dépendre d'une borne : plus de compteur, plus long.
    for (let c = 1; c <= 100; c++) {
      expect(ticksForDuration(c)).toBeGreaterThanOrEqual(ticksForDuration(c - 1));
    }
    expect(ticksForDuration(100)).toBeGreaterThan(ticksForDuration(0));
    // …et c'est exactement l'inverse du rythme, sur la MÊME fenêtre.
    expect(ticksForRate(100)).toBe(ticksForDuration(0));
    expect(ticksForRate(0)).toBe(ticksForDuration(100));
  });

  it('est ADDITIVE : +4 compteur vaut +3 ticks, où qu\'on tombe', () => {
    for (const base of [0, 13, 40, 61, 96]) {
      expect(ticksForDuration(base + 4) - ticksForDuration(base)).toBe(3);
    }
  });

  // ⚠️ Le bornage EST la fonctionnalité : c'est ce que la demande appelait
  // « limiter ces statistiques ». Mutation : retirer `clampRate` de
  // `ticksForDuration` → ROUGE.
  it('BORNE : rien ne dure plus de 77 ticks, ni moins de 2', () => {
    expect(ticksForDuration(250)).toBe(TICKS_AT_MIN);
    expect(ticksForDuration(-50)).toBe(TICKS_AT_MAX);
    expect(ticksForDuration('n\'importe quoi' as never)).toBe(TICKS_AT_MAX);
  });

  // ⚠️ C'est la LARGEUR de l'intervalle (1,33 compteur par tick) qui porte la
  // garantie, pas l'arrondi. Sans elle, la reprise des 83 cartes changerait des
  // combats en silence.
  it('l\'aller-retour est EXACT sur toute la fenêtre', () => {
    for (let t = TICKS_AT_MAX; t <= TICKS_AT_MIN; t++) {
      expect(ticksForDuration(durationForTicks(t))).toBe(t);
    }
    expect(TICKS_PER_POINT).toBeLessThan(1); // la raison, en un chiffre
  });

  // ⚠️ Le sens de l'arrondi : une durée annoncée ne peut pas être PLUS COURTE
  // que le compteur ne le dit. Mutation : `Math.floor` → ROUGE (compteur 1 vaut
  // 2,75 ticks exacts, donc 3 au supérieur et 2 à l'inférieur).
  it('n\'annonce jamais une durée plus courte que le compteur', () => {
    for (let c = 0; c <= 100; c++) {
      expect(ticksForDuration(c)).toBeGreaterThanOrEqual(TICKS_AT_MAX + TICKS_PER_POINT * c);
    }
    expect(ticksForDuration(1)).toBe(3);
  });

  // ⚠️ Une valeur illisible rend le compteur MINIMAL, jamais le maximal : se
  // tromper de sens donnerait à un pouvoir muet la paralysie la plus dure.
  it('une durée illisible est BRÈVE, pas éternelle', () => {
    expect(durationForTicks(undefined as never)).toBe(0);
    expect(durationForTicks(NaN)).toBe(0);
  });
});

describe('speed-scale — le catalogue livré, côté durées', () => {
  const cards = readCatalog('cards.json');
  const magies = readCatalog('magies.json');

  // ⚠️ Le filet contre une reprise à moitié faite, jumeau exact de celui des
  // rythmes : sur ces quatre pouvoirs, un `value` résiduel est du TICK que plus
  // personne ne lit — le moteur retomberait sur son repli, en silence.
  it('plus aucune carte ne porte de `power.value` sur un pouvoir de durée', () => {
    const fautives = cards.filter((c: any) =>
      DURATION_POWERS.includes(c.power?.id) && 'value' in (c.power ?? {}));
    expect(fautives.map((c: any) => c.id)).toEqual([]);
  });

  it('aucun pouvoir SANS durée ne porte de `power.duration`', () => {
    const fautives = cards.filter((c: any) =>
      c.power?.id && !DURATION_POWERS.includes(c.power.id) && 'duration' in c.power);
    expect(fautives.map((c: any) => c.id)).toEqual([]);
  });

  it('toutes les durées livrées tiennent dans les bornes', () => {
    const hors = cards
      .filter((c: any) => c.power?.duration != null)
      .filter((c: any) => c.power.duration < 0 || c.power.duration > 100);
    expect(hors.map((c: any) => c.id)).toEqual([]);
  });

  // ⚠️ Une magie `grant_power` chiffrait la durée du pouvoir donné dans le même
  // `value` que les autres. La laisser en ticks ferait durer la paralysie
  // donnée le REPLI du moteur, pas ce que la magie annonce.
  it('les `grant_power` de durée portent `duration` et non `value`', () => {
    const grants = magies.filter((m: any) =>
      m.effect?.type === 'grant_power' && DURATION_POWERS.includes(m.effect.power_id));
    expect(grants.length).toBeGreaterThan(0); // sinon le cas ne prouve rien
    for (const m of grants) {
      expect(m.effect).not.toHaveProperty('value');
      expect(typeof m.effect.duration).toBe('number');
    }
  });
});

describe('speed-scale — le contrat de durée', () => {
  const power = (p: any) => ({ id: 'X', stats: {}, power: p });

  // Mutation : vider `missingDurations` → ROUGE.
  it('refuse un `power.value` resté en ticks, et nomme le remède', () => {
    const problems = missingDurations(power({ id: 'POWER_PARALYSIS', value: 40 }));
    expect(problems.join(' | ')).toContain('POWER_PARALYSIS');
    expect(problems.join(' | ')).toContain('migrate-speeds');
  });

  it('refuse une `duration` sur un pouvoir qui n\'en lit aucune', () => {
    expect(missingDurations(power({ id: 'POWER_SUPER_ATTACK', duration: 40 })))
      .toHaveLength(1);
    // …et laisse sa `value` tranquille : c'est l'inverse exact.
    expect(missingDurations(power({ id: 'POWER_SUPER_ATTACK', value: 100 })))
      .toEqual([]);
  });

  it('refuse une durée hors de 0–100', () => {
    expect(missingDurations(power({ id: 'POWER_BLOCK', duration: 140 }))).toHaveLength(1);
    expect(missingDurations(power({ id: 'POWER_BLOCK', duration: -1 }))).toHaveLength(1);
    expect(missingDurations(power({ id: 'POWER_BLOCK', duration: 0 }))).toEqual([]);
  });

  // ⚠️ Une durée ABSENTE reste conforme, contrairement aux compteurs de
  // vitesse : le moteur porte un repli par pouvoir, et trois cartes livrées
  // s'en servent. L'exiger ferait échouer leur enregistrement.
  it('tolère une durée ABSENTE — le repli du moteur est une intention', () => {
    expect(missingDurations(power({ id: 'POWER_BLOCK', power_rate: 36 }))).toEqual([]);
    expect(missingDurations({ id: 'X', stats: {} })).toEqual([]);
  });

  it('laisse passer le catalogue livré', () => {
    const fautives = readCatalog('cards.json').filter((c: any) => missingDurations(c).length);
    expect(fautives.map((c: any) => c.id)).toEqual([]);
  });

  // ⚠️ Jumelles séparées par la frontière CJS / ESM, comme `RATE_FIELDS` et
  // `RATE_STATS`. Seul filet contre leur dérive : une liste qui gagnerait un
  // pouvoir d'un seul côté laisserait passer à l'écriture ce que le combat lit
  // — ou refuserait ce qu'il ne lit pas.
  it('le contrat et l\'échelle nomment les mêmes pouvoirs de durée', () => {
    expect([...CONTRACT_DURATION_POWERS].sort()).toEqual([...DURATION_POWERS].sort());
  });
});
