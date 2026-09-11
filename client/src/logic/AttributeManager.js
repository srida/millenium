/**
 * AttributeManager — **les SEUILS**, et rien d'autre depuis la bascule.
 *
 * ⚠️ Ce fichier n'exécute plus aucun effet : `compileAttributes` les traduit,
 * `executer` les applique (cf. `docs/moteur-effets.md` §6.5). Ce qui reste ici
 * est ce que le moteur ignore et doit ignorer — **quel palier est actif, sur
 * quel camp** :
 *
 *   • un seul palier actif à la fois, le plus élevé atteint ;
 *   • le décompte porte sur les `card_id` DISTINCTS ;
 *   • en fin de combat il inclut les neutralisées, aux autres passes non ;
 *   • les paliers `during_combat` sont VERROUILLÉS au début du combat.
 *
 * Le compilateur émet TOUS les paliers ; c'est cette classe qui choisit. La
 * règle vivait déjà ici, elle n'a pas bougé — seule l'exécution est partie.
 *
 * Trois passes, et le moteur tourne **une fois par camp** à chacune : un
 * attribut profite à qui le PORTE, des deux côtés. Ce n'est pas un effet
 * « allié », c'est un effet de porteur.
 *
 * Reconstruit à chaque combat, comme avant.
 */
import { compileAttributes } from './effects/compile.js';
import { executer, ressourcesVides } from './effects/engine.js';

// Veterancy: a unit that survives a combat without being neutralized gains 1 point
// (GameScreen3D._finishCombat). From 2 cumulated points onward it gets a permanent
// atk/hp bonus, scaling with the point count, applied/reset alongside start_of_combat
// attribute bonuses (see applyVeterancyBonuses below).
export const VETERANCY_THRESHOLD = 2;
export const VETERANCY_ATK_PER_POINT = 2;
export const VETERANCY_HP_PER_POINT = 15;
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

    // ⚠️ La compilation a lieu UNE FOIS, à la construction — donc une fois par
    // combat, comme le manager lui-même. Elle est pure : mêmes attributs, mêmes
    // effets, aucun état.
    //
    // ⚠️ Les REFUS sont gardés et non jetés. Ce qu'ils nomment était déjà mort
    // avant la bascule — un `revive` sous `start_of_combat` n'était jamais
    // atteint, un `value_per` qui ne nomme aucun attribut rendait un
    // multiplicateur nul, une stat que `_recomputeStats` ne relit pas
    // s'écrivait dans le vide. Le comportement est donc inchangé ; ce qui
    // change, c'est qu'il a maintenant un nom (`compilationRefusee`).
    const { effets, refus } = compileAttributes(attributeList, new Set(attributeList.map(a => a.id)));
    this._effets = effets;
    this.compilationRefusee = refus;

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
   * Les effets compilés que ces paliers actifs désignent.
   *
   * ⚠️ **C'est ici que « un seul palier actif » s'applique**, et nulle part
   * ailleurs : le compilateur émet tous les paliers d'un attribut, chacun avec
   * sa condition `{ attribut, minimum }`. On ne garde que ceux dont le
   * `minimum` est EXACTEMENT le palier actif de ce camp — pas « au plus », ce
   * qui cumulerait les paliers.
   *
   * @param {Map<string, number>} actifs  attrId → `count` du palier actif
   */
  _effetsDesPaliers(actifs) {
    return this._effets.filter(e => actifs.get(e.condition?.attribut) === e.condition?.minimum);
  }

  /** Les paliers actifs d'un camp, au décompte des VIVANTES (deux premières passes). */
  _paliersVivants(units) {
    const actifs = new Map();
    for (const attrId of new Set(units.flatMap(u => u.attributes))) {
      const r = this._activeThreshold(attrId, units);
      if (r) actifs.set(attrId, r.threshold.count);
    }
    return actifs;
  }

  /**
   * Joue les effets d'un MOMENT donné, au décompte des vivantes.
   *
   * ⚠️ La classe ne garde que les SEUILS (§6.5) : c'est elle qui dit quel palier
   * est actif, le moteur qui applique. Un appelant qui voudrait déclencher un
   * moment sans passer par ici devrait recompter les paliers — donc s'en donner
   * une seconde version.
   */
  joueMoment(quand, monde) {
    return executer(this._effetsDesPaliers(this._paliersVivants(monde.unitesAlliees)), quand, monde);
  }

  /** Le monde d'un camp, tel que le moteur l'attend. */
  _monde(units, other, ressources, neutralisees, limite) {
    return {
      unitesAlliees: units, unitesEnnemies: other,
      ressources, neutralisees, ressourcesLimitees: limite,
    };
  }

  _applyStartForSide(units) {
    const other = units === this.playerUnits ? this.enemyUnits : this.playerUnits;
    const trace = executer(
      this._effetsDesPaliers(this._paliersVivants(units)),
      'debut_combat',
      this._monde(units, other, ressourcesVides(), [], units !== this.playerUnits),
    );
    // ⚠️ **Le journal du moteur REMPLACE `_recordBonus`.** Il n'y a plus qu'un
    // endroit qui sache ce qui a été écrit : celui qui l'a écrit. Restaurer
    // après un `POWER_DEBUFF` demandait auparavant de recopier chaque geste à
    // côté de lui-même — et le bouclier, lui, n'y était PAS recopié : il n'est
    // donc jamais restauré, ni avant ni maintenant (`resetCombatStats` l'efface
    // et rien ne le remet). Le journal ne porte que les stats, exactement comme
    // `_recordBonus`.
    for (const { unite, stat, valeur } of trace.ecritures) this._recordBonus(unite, stat, valeur);
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

  /**
   * ⚠️ **`affectedUnits` est comparé par RÉFÉRENCE à `this.playerUnits`** —
   * c'est le piège de harnais le mieux documenté du lot (§6.1) : un tableau
   * neuf portant les mêmes unités lit le cache du camp d'en face et ne
   * déclenche rien. Inchangé par la bascule, et volontairement : c'est ce que
   * `CombatManager` passe.
   */
  _triggerStatModifiers(trigger, affectedUnits, referenceUnits, events) {
    const isPlayerSide = affectedUnits === this.playerUnits;
    // ⚠️ Les paliers sont ceux VERROUILLÉS au début du combat, jamais recomptés :
    // les morts en cours de combat ne désactivent pas un effet déjà débloqué.
    const actifs = new Map();
    for (const attrId of new Set(affectedUnits.flatMap(u => u.attributes))) {
      const cached = this._duringCombatThresholds?.get(attrId);
      const r = cached ? (isPlayerSide ? cached.player : cached.enemy) : null;
      if (r) actifs.set(attrId, r.threshold.count);
    }

    const other = isPlayerSide ? this.enemyUnits : this.playerUnits;
    const quand = trigger === 'on_ally_neutralized' ? 'allie_detruit' : 'ennemi_detruit';
    const trace = executer(
      this._effetsDesPaliers(actifs), quand,
      this._monde(affectedUnits, other, ressourcesVides(), [], !isPlayerSide),
    );
    // ⚠️ **Les événements `stat_change` sortent du JOURNAL**, pas d'une seconde
    // lecture de la donnée. L'animateur doit MONTRER ce qui a été écrit ; le
    // dériver de l'effet plutôt que de l'écriture, c'est s'autoriser à annoncer
    // un bonus que personne n'a reçu — la même faute que l'annonce de terrain
    // recomptant ses cibles à côté d'`effectTargets`.
    for (const { unite, stat, valeur } of trace.ecritures) {
      events.push({ type: 'stat_change', unit: unite, stat, value: valeur });
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
    const joueur = this._applyEndForSide(this.playerUnits, playerNeutralized, this.enemyUnits, false);
    const adverse = this._applyEndForSide(this.enemyUnits, enemyNeutralized, this.playerUnits, true);

    // ⚠️ **Le moteur ACCUMULE, c'est ici qu'on VERSE.** Les deux accumulateurs
    // portent les mêmes champs ; ce sont leurs DESTINATAIRES qui diffèrent, et
    // c'est la seule chose que cette traduction dit. Un accumulateur qui
    // connaîtrait les noms de `EndOfCombatAttributeResult` saurait à qui il
    // parle — et le moteur n'a pas à le savoir.
    return {
      revived: joueur.reanimees,
      enemyRevived: adverse.reanimees,
      draw_bonus: joueur.pioches,
      guaranteed_draws: joueur.pioches_garanties, // cf. types.GuaranteedDraw
      board_slot_bonus: joueur.slots_board,
      damage_multiplier_bonus: joueur.multiplicateur,
      shopping_bonus: joueur.magies_shop,
      // Quel ATTRIBUT a crédité quelle pioche (cf. types.DrawSourceEntry). Pure
      // description : la popup de pioche le lit, aucun calcul ne s'en sert.
      draw_sources: joueur.sources,
      // Pendant de draw_bonus / guaranteed_draws pour l'IA. ⚠️ Pas de
      // `sources` : rien n'affiche la provenance de la pioche adverse, et le
      // moteur ne les inscrit donc pas (`ressourcesLimitees`).
      enemy_draw_bonus: adverse.pioches,
      enemy_guaranteed_draws: adverse.pioches_garanties,
    };
  }

  /**
   * Une passe de fin de combat, pour UN camp.
   *
   * ⚠️ Le décompte de palier y inclut les NEUTRALISÉES, contrairement aux deux
   * autres passes : le palier tient même si ses porteurs sont morts au combat.
   * C'est la seule règle de seuil qui diffère, et c'est pour ça qu'elle est
   * écrite ici plutôt que dans `_paliersVivants`.
   *
   * @param {boolean} limite  Le camp ne reçoit que la PIOCHE. Vrai pour le camp
   *   d'en face : slot, multiplicateur et Shopping n'y ont aucun destinataire.
   */
  _applyEndForSide(units, neutralized, other, limite) {
    const actifs = new Map();
    for (const attrId of new Set(units.flatMap(u => u.attributes))) {
      const attr = this._attributeMap[attrId];
      if (!attr) continue;
      const count = new Set(
        units.filter(u => u.attributes.includes(attrId)).map(u => u.card_id)
      ).size;
      let best = null;
      for (const t of attr.thresholds) {
        if (count >= t.count) best = t;
      }
      if (best) actifs.set(attrId, best.count);
    }

    const ressources = ressourcesVides();
    // ⚠️ `neutralized` est MUTÉ par le moteur (`splice`) — c'est déjà ce que
    // faisait `revive`, et `finishCombat` compte dessus.
    executer(
      this._effetsDesPaliers(actifs), 'fin_combat',
      this._monde(units, other, ressources, neutralized, limite),
    );
    return ressources;
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
