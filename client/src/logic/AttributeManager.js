import { effectScale, ALLY_COUNT_SCALE } from './EffectScale.js';
import { specOf } from './EffectKinds.js';

/**
 * AttributeManager
 *
 * Handles all attribute effects across three timings:
 *   start_of_combat  — stat_bonus, shield
 *   during_combat    — stat_modifier (on_enemy_neutralized, on_ally_neutralized)
 *   end_of_combat    — revive, draw_bonus, guaranteed_draw, board_slot_bonus
 *
 * Designed to be stateless between rounds: reconstruct each combat.
 */

// Veterancy: a unit that survives a combat without being neutralized gains 1 point
// (GameScreen3D._finishCombat). From 2 cumulated points onward it gets a permanent
// atk/hp bonus, scaling with the point count, applied/reset alongside start_of_combat
// attribute bonuses (see applyVeterancyBonuses below).
export const VETERANCY_THRESHOLD = 2;
export const VETERANCY_ATK_PER_POINT = 2;
export const VETERANCY_HP_PER_POINT = 15;

/**
 * ⚠️ RÉ-EXPORT, pas une définition : le vocabulaire des échelles vit dans
 * `logic/EffectScale`, que `BoardEffect` lit aussi. Les tests et l'audit du
 * catalogue le nomment par ici — le ré-export garde ce chemin valide sans
 * autoriser une seconde définition.
 */
export { ALLY_COUNT_SCALE };

/**
 * QUELLE unité neutralisée un `revive` d'attribut relève.
 *
 * ⚠️ `first` est le défaut et reproduit exactement ce qui existait — la
 * première morte, dans l'ordre des décès. C'était la seule règle possible, et
 * elle n'était écrite nulle part : un `neutralized[0]` nu ne se lit pas comme
 * un choix. Le nommer est ce qui rend les autres exprimables.
 *
 * ⚠️ Le départage se fait par `card_id`, comme l'ordre d'initiative et pour la
 * même raison : c'est la seule valeur ABSOLUE, identique sur les deux clients
 * PvP. Une réanimation a lieu APRÈS le dernier tick — elle change les
 * survivants, donc les dégâts de fin de combat — et deux clients qui relèvent
 * deux unités différentes divergent sans qu'aucun tick ne diffère.
 *
 * ⚠️ Une cible inconnue retombe sur `first` plutôt que de ne rien relever : un
 * `revive` muet est le mode de panne que ce lot existe pour supprimer.
 */
export function reviveIndex(target, neutralized) {
  if (!neutralized.length) return 0;
  const rank = {
    // ⚠️ `first` et `neutralized_ally` disent la même chose. Le second est la
    // forme HISTORIQUE, portée par quatre attributs livrés — elle n'avait aucun
    // lecteur tant que la cible n'existait pas, et la migrer maintenant qu'elle
    // en a un serait réécrire des données pour ne rien changer. Même geste que
    // l'id d'attribut nu d'une échelle : on élargit le vocabulaire, on ne
    // renomme pas ce qui est déjà écrit.
    first: null,
    neutralized_ally: null,
    highest_hp: (u) => u.max_hp,
    highest_atk: (u) => u.atk,
  }[target];
  if (!rank) return 0;
  let best = 0;
  for (let i = 1; i < neutralized.length; i++) {
    const d = rank(neutralized[i]) - rank(neutralized[best]);
    if (d > 0 || (d === 0 && neutralized[i].card_id.localeCompare(neutralized[best].card_id) < 0)) best = i;
  }
  return best;
}

export class AttributeManager {
  /**
   * @param {Object[]} attributeList   - raw data from AttributeDatabase
   * @param {Unit[]}   playerUnits
   * @param {Unit[]}   enemyUnits
   */
  constructor(attributeList, playerUnits, enemyUnits) {
    this._attributeMap = Object.fromEntries(attributeList.map(a => [a.id, a]));
    this.playerUnits = playerUnits;
    this.enemyUnits = enemyUnits;

    // Bonuses applied to each unit at start of combat (for POWER_DEBUFF reapplication)
    this._appliedBonuses = new Map(); // uid → [{ stat, value }]

    // during_combat thresholds locked at start of combat so unit deaths mid-combat
    // don't deactivate effects that were already unlocked.
    this._duringCombatThresholds = null; // Map<attrId, { player, enemy }> — populated by applyStartOfCombat
  }

  // ── Counting ──

  // Counts distinct units (by card_id) — duplicate copies of the same card
  // only count once toward attribute thresholds.
  _countAttribute(attrId, units) {
    const ids = new Set();
    for (const u of units) {
      if (u.isAlive() && u.attributes.includes(attrId)) ids.add(u.card_id);
    }
    return ids.size;
  }

  // Returns the active threshold for this attribute on the given side, or null
  _activeThreshold(attrId, units) {
    const attr = this._attributeMap[attrId];
    if (!attr) return null;
    const count = this._countAttribute(attrId, units);
    let best = null;
    for (const t of attr.thresholds) {
      if (count >= t.count) best = t;
    }
    return best ? { attr, threshold: best, count } : null;
  }

  // ── Start of combat ──

  applyStartOfCombat() {
    this._applyStartForSide(this.playerUnits);
    this._applyStartForSide(this.enemyUnits);
    this._applyVeterancyBonuses();
    this._lockDuringCombatThresholds();
  }

  // Permanent atk/hp bonus for units with enough veterancy points, applied the same
  // way as attribute stat_bonus effects (so it's wiped by resetCombatStats and
  // recomputed each combat, and restored by reapplyBonuses() after POWER_DEBUFF).
  _applyVeterancyBonuses() {
    for (const u of [...this.playerUnits, ...this.enemyUnits]) {
      if (!u.isAlive() || u.veterancy_points < VETERANCY_THRESHOLD) continue;
      const atkBonus = u.veterancy_points * VETERANCY_ATK_PER_POINT;
      const hpBonus = u.veterancy_points * VETERANCY_HP_PER_POINT;
      u.applyStatBonus('atk', atkBonus);
      this._recordBonus(u, 'atk', atkBonus);
      u.applyStatBonus('hp', hpBonus);
      this._recordBonus(u, 'hp', hpBonus);
    }
  }

  // Snapshot which during_combat attributes are active on each side at combat start.
  // Once locked, mid-combat unit deaths cannot drop a threshold below its unlock level.
  _lockDuringCombatThresholds() {
    this._duringCombatThresholds = new Map();
    for (const attrId of Object.keys(this._attributeMap)) {
      const attr = this._attributeMap[attrId];
      if (attr.timing !== 'during_combat') continue;
      this._duringCombatThresholds.set(attrId, {
        player: this._activeThreshold(attrId, this.playerUnits),
        enemy:  this._activeThreshold(attrId, this.enemyUnits),
      });
    }
  }

  /**
   * Par quoi le `value` d'un effet est multiplié — cf. `logic/EffectScale`, seul
   * lecteur du vocabulaire.
   *
   * ⚠️ Le `defaut` n'est PAS une commodité : c'est ce qui a rendu le barème du
   * bouclier configurable sans le changer. Il multipliait par les alliés
   * vivants, toujours, sans que rien ne le nomme — `ARCH_066` porte un
   * `shield: 50` nu qui en tire 150. Le défaut déclare cette règle au lieu de
   * l'enfouir, et `one` permet désormais d'y renoncer pour un bouclier plat.
   */
  _valueScale(effect, units, defaut = null) {
    const otherUnits = units === this.playerUnits ? this.enemyUnits : this.playerUnits;
    return effectScale(effect.value_per ?? defaut, units, otherUnits);
  }

  _applyStartForSide(units) {
    const attrIds = new Set(units.flatMap(u => u.attributes));
    for (const attrId of attrIds) {
      const result = this._activeThreshold(attrId, units);
      if (!result) continue;
      const { attr, threshold } = result;
      if (attr.timing !== 'start_of_combat') continue;

      for (const effect of threshold.effects) {
        switch (effect.type) {
          case 'stat_bonus': {
            const bonus = effect.value * this._valueScale(effect, units);
            if (bonus === 0) break;
            for (const u of units.filter(u => u.isAlive() && u.attributes.includes(attrId))) {
              u.applyStatBonus(effect.stat, bonus);
              this._recordBonus(u, effect.stat, bonus);
            }
            break;
          }

          case 'shield': {
            // ⚠️ Le bouclier a une échelle PAR DÉFAUT (× alliés vivants) là où
            // `stat_bonus` n'en a pas : c'est son barème historique, et le
            // retirer coûterait 100 points à `ARCH_066`. Il se surcharge comme
            // n'importe quelle autre, `one` compris.
            // ⚠️ Le défaut se LIT dans le registre, il n'est plus écrit ici :
            // c'est ce qui fait que le formulaire d'admin et le moteur
            // annoncent le même barème. Le retirer du registre coûterait 100
            // points de bouclier à `ARCH_066` — `effect-behaviour` le voit.
            const defaut = specOf('shield', 'attribute')?.scale_default ?? null;
            const amount = effect.value * this._valueScale(effect, units, defaut);
            if (amount === 0) break;
            for (const u of units.filter(u => u.isAlive() && u.attributes.includes(attrId))) {
              u.applyShield(amount);
            }
            break;
          }

          case 'effect_immunity':
            for (const u of units.filter(u => u.isAlive() && u.attributes.includes(attrId))) {
              u.is_effect_immune = true;
            }
            break;
        }
      }
    }
  }

  // ── During combat — triggered on death ──

  /**
   * Called by CombatManager when a unit is neutralized.
   * Returns extra events (stat changes) for the animator.
   */
  onUnitNeutralized(deadUnit, playerUnits, enemyUnits) {
    const events = [];
    const allySide = deadUnit.side === 'player' ? playerUnits : enemyUnits;
    const enemySide = deadUnit.side === 'player' ? enemyUnits : playerUnits;

    // Allies react to a dead ally
    this._triggerStatModifiers('on_ally_neutralized', allySide, allySide, events);
    // Enemies react to a dead enemy
    this._triggerStatModifiers('on_enemy_neutralized', enemySide, enemySide, events);

    return events;
  }

  _triggerStatModifiers(trigger, affectedUnits, referenceUnits, events) {
    const attrIds = new Set(affectedUnits.flatMap(u => u.attributes));
    const isPlayerSide = affectedUnits === this.playerUnits;

    for (const attrId of attrIds) {
      const cached = this._duringCombatThresholds?.get(attrId);
      const result = cached ? (isPlayerSide ? cached.player : cached.enemy) : null;
      if (!result) continue;
      const { attr, threshold } = result;

      for (const effect of threshold.effects) {
        if (effect.type !== 'stat_modifier' || effect.trigger !== trigger) continue;
        for (const u of affectedUnits.filter(u => u.isAlive() && u.attributes.includes(attrId))) {
          u.applyStatModifier(effect.stat, effect.value);
          events.push({ type: 'stat_change', unit: u, stat: effect.stat, value: effect.value });
        }
      }
    }
  }

  // ── End of combat ──

  /**
   * Resolve end-of-combat effects.
   * @param {Unit[]} playerNeutralized - units neutralized this combat (player side)
   * @param {Unit[]} enemyNeutralized  - units neutralized this combat (enemy side)
   * @returns {{ revived: Unit[], draw_bonus: number, guaranteed_draws: Object[], board_slot_bonus: number, draw_sources: Object[] }}
   */
  applyEndOfCombat(playerNeutralized, enemyNeutralized) {
    const result = {
      revived: [],
      enemyRevived: [],
      draw_bonus: 0,
      guaranteed_draws: [], // { tier?, attribute? } — cf. types.GuaranteedDraw
      board_slot_bonus: 0,
      damage_multiplier_bonus: 0,
      shopping_bonus: 0,
      // Quel ATTRIBUT a crédité quelle pioche (cf. types.DrawSourceEntry). Pure
      // description : la popup de pioche le lit, aucun calcul ne s'en sert.
      draw_sources: [],
      // Pendant de draw_bonus / guaranteed_draws pour l'IA — cf. `_applyEndForSide`.
      enemy_draw_bonus: 0,
      enemy_guaranteed_draws: [],
    };

    // ⚠️ La RÉANIMATION vaut pour les DEUX camps ; la PIOCHE aussi (l'IA pioche
    // comme le joueur — cf. `EnemyAI.drawHand`). Les effets de ressource
    // restants (emplacement, multiplicateur, Shopping) n'ont de destinataire
    // que côté joueur : slot et multiplicateur touchent au board/aux dégâts
    // dans des voies déjà asymétriques (déterminisme PvP), et Shopping n'existe
    // structurellement pas pour l'IA.
    //
    // C'est la seule distinction qui compte ici, et elle a coûté un duel : tout
    // `end_of_combat` ne regardait que `this.playerUnits`, si bien qu'en duel
    // l'unité réanimée d'un joueur ressuscitait chez LUI et restait morte chez
    // son adversaire. Les deux clients ne comptaient donc pas les mêmes
    // survivants — donc pas les mêmes dégâts de fin de combat. Constaté sur le
    // duel `7ce04deb` : un camp voyait quatre survivants, l'autre trois.
    //
    // ⚠️ Et c'est invisible dans le log de combat : la réanimation a lieu APRÈS
    // le dernier tick, dans `finishCombat`. Cf. l'épilogue de `CombatRecorder`.
    this._applyEndForSide(this.playerUnits, playerNeutralized, result, {
      resources: true,
      draws: { bonusKey: 'draw_bonus', guaranteedKey: 'guaranteed_draws', sourcesKey: 'draw_sources' },
    });
    this._applyEndForSide(this.enemyUnits, enemyNeutralized, result, {
      resources: false,
      draws: { bonusKey: 'enemy_draw_bonus', guaranteedKey: 'enemy_guaranteed_draws', sourcesKey: null },
    });

    return result;
  }

  /**
   * @param {Object} opts
   * @param {boolean} opts.resources  Collecter aussi les effets de ressource
   *   exclusivement JOUEUR (emplacement, multiplicateur, Shopping). Faux pour
   *   le camp d'en face, où ils n'ont aucun destinataire.
   * @param {Object} opts.draws  Où écrire draw_bonus / guaranteed_draw pour CE
   *   camp — la pioche, contrairement aux trois ressources ci-dessus, a un
   *   destinataire des deux côtés.
   */
  _applyEndForSide(units, neutralized, result, { resources, draws }) {
    const attrIds = new Set(units.flatMap(u => u.attributes));

    for (const attrId of attrIds) {
      const attr = this._attributeMap[attrId];
      if (!attr || attr.timing !== 'end_of_combat') continue;

      // For end_of_combat, count ALL distinct units that participated (alive + neutralized)
      // so the threshold is met even if some attribute units died during combat
      const count = new Set(
        units.filter(u => u.attributes.includes(attrId)).map(u => u.card_id)
      ).size;
      let best = null;
      for (const t of attr.thresholds) {
        if (count >= t.count) best = t;
      }
      if (!best) continue;
      const threshold = best;

      for (const effect of threshold.effects) {
        if (effect.type === 'revive') {
          const idx = reviveIndex(effect.target, neutralized);
          const candidate = neutralized[idx];
          if (candidate) {
            const hpPct = (effect.hp_percent ?? 50) / 100;
            candidate.current_hp = Math.floor(candidate.max_hp * hpPct);
            candidate.is_neutralized = false;
            candidate._deathEmitted = false;
            candidate.dot_effects = [];
            candidate.paralysis_remaining = 0;
            candidate.attack_speed_modifier = 0;
            neutralized.splice(idx, 1);
            (resources ? result.revived : result.enemyRevived).push(candidate);
          }
          continue;
        }

        if (effect.type === 'draw_bonus') {
          // ⚠️ La ligne du registre porte le crédit RÉEL, mesuré de part et
          // d'autre du plafond : sous `max`, un attribut qui demande +3 n'en
          // donne parfois qu'un, et la popup doit annoncer ce qui est arrivé
          // en main, pas ce qui était demandé. Un attribut entièrement rogné
          // n'inscrit donc rien. Pas de `sourcesKey` côté ennemi : rien
          // n'affiche la provenance de sa pioche.
          const before = result[draws.bonusKey];
          result[draws.bonusKey] = Math.min(before + effect.value, effect.max ?? Infinity);
          const granted = result[draws.bonusKey] - before;
          if (granted > 0 && draws.sourcesKey) {
            result[draws.sourcesKey].push({ kind: 'attribut', ref: attrId, value: granted });
          }
          continue;
        }
        if (effect.type === 'guaranteed_draw') {
          // ⚠️ Les critères voyagent EN BLOC (cf. `types.GuaranteedDraw`) : un
          // effet d'attribut peut nommer plusieurs attributs ou des cartes
          // exactement comme une magie, et recopier le seul `attribute`
          // perdait le reste en silence.
          result[draws.guaranteedKey].push({
            tier: effect.tier,
            attribute: effect.attribute ?? null,
            attributes: effect.attributes,
            card_ids: effect.card_ids,
          });
          if (draws.sourcesKey) {
            result[draws.sourcesKey].push({ kind: 'attribut', ref: attrId, value: 0, guaranteed: true });
          }
          continue;
        }

        if (!resources) continue;

        switch (effect.type) {
          case 'board_slot_bonus':
            result.board_slot_bonus = Math.min(result.board_slot_bonus + effect.value, effect.max ?? Infinity);
            break;
          case 'damage_multiplier_bonus':
            result.damage_multiplier_bonus += effect.value;
            break;
          case 'shopping_bonus':
            result.shopping_bonus = Math.min(result.shopping_bonus + (effect.value ?? 1), effect.max ?? Infinity);
            break;
        }
      }
    }
  }

  // ── POWER_DEBUFF support ──

  _recordBonus(unit, stat, value) {
    if (!this._appliedBonuses.has(unit.uid)) this._appliedBonuses.set(unit.uid, []);
    this._appliedBonuses.get(unit.uid).push({ stat, value });
  }

  // Re-apply only the start-of-combat stat bonuses after POWER_DEBUFF reset
  reapplyBonuses(unit) {
    const bonuses = this._appliedBonuses.get(unit.uid) ?? [];
    for (const { stat, value } of bonuses) unit.applyStatBonus(stat, value);
  }

  // ── Public API for UI ──

  /** Returns active attribute synergies for display */
  getActiveSynergies(units) {
    const attrIds = new Set(units.flatMap(u => u.attributes));
    const synergies = [];
    for (const attrId of attrIds) {
      const attr = this._attributeMap[attrId];
      if (!attr) continue;
      if (!attr.thresholds || attr.thresholds.length === 0) continue; // archétype sans effet : pas affiché
      const count = this._countAttribute(attrId, units);
      const result = this._activeThreshold(attrId, units);
      const activeThreshold = result?.threshold ?? null;
      const nextThreshold = attr.thresholds
        .filter(t => t.count > count)
        .sort((a, b) => a.count - b.count)[0] ?? null;
      synergies.push({ attr, count, activeThreshold, nextThreshold });
    }
    return synergies.sort((a, b) => b.count - a.count);
  }
}
