// LE MOTEUR — exécute des `Effet[]`.
//
// ⚠️ Il ne connaît AUCUN porteur. Il ne sait pas ce qu'est un terrain, une
// magie ou un attribut : il reçoit des effets compilés et les applique. C'est
// cette ignorance qui fait tout l'intérêt — un porteur de plus n'est qu'un
// compilateur de plus, jamais une branche de plus ici.
//
// ⚠️ Il n'écrit PAS l'état lui-même : il délègue aux primitives d'`Unit`
// (`applyStatBonus`, `applyShield`) et ACCUMULE les ressources du joueur dans un
// objet à part. Le moteur décide QUEL REGISTRE selon la `durée` ; il ne
// réimplémente pas ce que le registre fait. Sans ça on se donnerait une seconde
// version de `_recomputeStats`, et le jour où elles divergeraient, personne ne
// le verrait.
//
// ⚠️ **Le moteur n'importe PAS `GameState`, et c'est une contrainte de fond,
// pas un goût.** Le `damage_multiplier_bonus` d'un attribut n'a aucun champ où
// se poser : il est consommé EN VOL par le calcul de dégâts d'`applyEndOfCombat`
// et n'est jamais stocké. Un moteur qui écrirait directement dans `GameState`
// ne saurait donc pas l'exprimer — il le confondrait avec le champ permanent du
// même nom, qui appartient aux magies. Le moteur accumule ; c'est l'appelant qui
// verse, et qui seul sait où.
//
// Cf. `docs/moteur-effets.md` §4 et §5.

import type { Unit } from '../Unit.js';
import type { GuaranteedDraw, DrawSourceEntry } from '../types.js';
import { CHAMPS_UNITE, cleDeTri } from './types.js';
import { clampRate, rateForTicks } from '../../../../speed-scale.mjs';
import type { Effet, Tache, TacheModifier, TacheDeplacer, TachePoserStatut, Selecteur, ChampUnite } from './types.js';

/**
 * Ce qu'un lot d'effets a produit pour le JOUEUR — le pendant exact de
 * `EndOfCombatAttributeResult`, mais sans porteur ni phase.
 *
 * ⚠️ C'est un ACCUMULATEUR, pas un état : il ne connaît ni plafond partagé
 * (`grantLimitedBoardSlotBonus`) ni règle de round. L'appelant le verse où il
 * faut, et c'est là que les règles du jeu s'appliquent.
 */
export interface Ressources {
  pioches: number;
  pioches_garanties: GuaranteedDraw[];
  slots_board: number;
  multiplicateur: number;
  magies_shop: number;
  pv: number;
  /** Provenance, versée EN MÊME TEMPS que le crédit (cf. `draw-summary.test.ts`). */
  sources: DrawSourceEntry[];
  reanimees: Unit[];
}

export function ressourcesVides(): Ressources {
  return {
    pioches: 0, pioches_garanties: [], slots_board: 0, multiplicateur: 0,
    magies_shop: 0, pv: 0, sources: [], reanimees: [],
  };
}

export interface Monde {
  unitesAlliees: readonly Unit[];
  unitesEnnemies: readonly Unit[];
  /** Les ressources du camp allié. Créé par l'appelant, muté par le moteur. */
  ressources: Ressources;
  /** Les ressources du camp ennemi — la pioche a un destinataire des deux côtés. */
  ressourcesEnnemies?: Ressources;
  /** Corps neutralisés disponibles pour une réanimation. **Muté** (splice). */
  neutralisees?: Unit[];
  neutraliseesEnnemies?: Unit[];
  /**
   * ⚠️ INVARIANT §5.2 : le hasard est une dépendance INJECTÉE, jamais
   * `Math.random`. Aucune tâche compilée aujourd'hui n'en consomme — le champ
   * existe pour qu'il n'y ait jamais de raison d'aller en chercher ailleurs, et
   * pour que le jour où `combien: 'un'` arrivera, le nombre d'appels soit
   * comptable depuis un seul endroit.
   */
  rand?: () => number;
  /**
   * Le camp courant ne reçoit que les ressources de PIOCHE.
   *
   * ⚠️ C'est le `resources: false` d'`_applyEndForSide`, et c'est une
   * asymétrie assumée du jeu d'aujourd'hui : la pioche a un destinataire des
   * deux côtés (`EnemyAI` pioche aussi), le slot, le multiplicateur et le
   * Shopping n'en ont qu'un. La reproduire est obligatoire tant que le critère
   * est « zéro changement observable » — c'est la décision 3 du §7 qui la
   * lèvera, à l'étape 4, et elle deviendra alors un `camp` comme un autre.
   */
  ressourcesLimitees?: boolean;
  /** Les PV du joueur AVANT le lot — lus par les conditions, jamais écrits. */
  pvJoueur?: number;
  /** Nom du porteur, posé par `executer` pour les registres de provenance. */
  source?: string;
}

/** Ce qu'une exécution a réellement fait — le matériau du mode ombre. */
export interface Trace {
  applique: string[];
  /** Une ligne par tâche qu'aucun registre n'a su écrire. **Jamais silencieux.** */
  ignore: string[];
}

/** Les unités qu'un sélecteur désigne, dans l'ordre du monde. */
function resoudre(sel: Selecteur, monde: Monde): Unit[] {
  const pool = sel.conteneur === 'cimetiere'
    ? (sel.camp === 'ennemi' ? monde.neutraliseesEnnemies ?? [] : monde.neutralisees ?? [])
    : sel.camp === 'allie' ? [...monde.unitesAlliees]
      : sel.camp === 'ennemi' ? [...monde.unitesEnnemies]
        : [...monde.unitesAlliees, ...monde.unitesEnnemies];

  const vivantes = sel.conteneur === 'cimetiere' ? [...pool] : pool.filter(u => u.isAlive());
  const f = sel.filtre;
  const filtrees = !f ? vivantes : vivantes.filter(u => {
    if (f.attributs?.length && !u.attributes.some(a => f.attributs!.includes(a))) return false;
    if (f.cartes?.length && !f.cartes.includes(u.card_id)) return false;
    if (f.tiers?.length && !f.tiers.includes(u.tier)) return false;
    return true;
  });
  return sel.combien === 'un' ? filtrees.slice(0, 1) : filtrees;
}

/** Le multiplicateur d'un `parAttributAdverse` — 1 quand il n'y en a pas. */
function multiplicateur(t: TacheModifier, sel: Selecteur, monde: Monde): number {
  if (t.parAttributAdverse) {
    // ⚠️ « Adverse » se lit depuis le camp VISÉ, pas depuis le porteur : c'est
    // ce que fait `applyStartOfCombat` (`units === playerUnits ? enemy : player`).
    const autre = sel.camp === 'ennemi' ? monde.unitesAlliees : monde.unitesEnnemies;
    return autre.filter(u => u.isAlive() && u.attributes.includes(t.parAttributAdverse!)).length;
  }
  if (t.parAllieVivant) {
    // Le geste du `shield` d'attribut : × le nombre d'alliés vivants DU CAMP
    // VISÉ. Il ne lit aucun attribut — c'est ce qui le distingue du précédent,
    // et pourquoi `value_per` y est décoratif (cf. §6.1).
    const camp = sel.camp === 'ennemi' ? monde.unitesEnnemies : monde.unitesAlliees;
    return camp.filter(u => u.isAlive()).length;
  }
  return 1;
}

/**
 * Le delta additif qu'une tâche représente.
 *
 * ⚠️ **La conversion du multiplicateur en additif vit ICI et nulle part
 * ailleurs.** Le schéma garde l'intention (`*`), parce que c'est ce que l'auteur
 * écrit ; le moteur la convertit, parce que lui seul sait que le registre de
 * combat est additif et que `resetCombatStats()` doit savoir le nettoyer. C'est
 * exactement le geste de `BoardEffect.applyEffect` — reproduit, pas réinventé :
 * deux `×2 PV` donnent `×3`, jamais `×4`.
 */
function delta(t: TacheModifier, base: number): number {
  const v = t.valeur;
  switch (t.operateur) {
    case '+': return v;
    case '-': return -v;
    case '*': return Math.round(base * (v - 1));
    case '/': return Math.round(base / (v || 1)) - base;
    case '=': return v - base;
    default: return 0;
  }
}

function appliqueSurUnite(t: TacheModifier, u: Unit, mult: number, trace: Trace): void {
  const champ = t.champ as ChampUnite;
  const nom = CHAMPS_UNITE[champ];

  // ⚠️ La JAUGE de PV, pas la stat : `heal()` plafonne déjà au maximum courant,
  // vétérance et bonus compris. `=` veut dire « au maximum » (le soin total
  // d'une magie), `+` un montant chiffré (le soin d'équipe).
  if (champ === 'pv_courant') {
    const montant = t.operateur === '=' ? u.max_hp : t.valeur * mult;
    u.heal(montant);
    trace.applique.push(`${u.card_id}·pv→${u.current_hp}`);
    return;
  }

  // Le POUVOIR d'une unité : un id et ses trois chiffres, posés ensemble.
  // ⚠️ Un pouvoir donné n'hérite RIEN de l'ancien — ni sa valeur, ni sa durée,
  // ni sa jauge. C'est ce que fait `grant_power`, et l'oublier donnerait à
  // l'unité un pouvoir neuf qui garde les chiffres du précédent.
  if (champ === 'pouvoir') {
    if (!t.pouvoir) { trace.ignore.push(`${u.card_id}·pouvoir (aucun id)`); return; }
    u.power_id = t.pouvoir.id;
    u.power_rate = clampRate(t.pouvoir.rate ?? u.power_rate ?? 0);
    u.power_value = t.pouvoir.valeur ?? null;
    u.power_duration = t.pouvoir.duree ?? null;
    u.power_gauge = 0;
    u.is_power_blocked = false;
    u.power_block_remaining = 0;
    trace.applique.push(`${u.card_id}·pouvoir→${t.pouvoir.id}`);
    return;
  }

  // ⚠️ La vitesse de pouvoir se DIVISE en TICKS puis se retraduit en compteur :
  // sur l'échelle linéaire, un delta de compteur constant ne diviserait pas la
  // période d'autant. On garde le geste, pas la forme (cf. `power_cooldown`).
  if (champ === 'vitesse_pouvoir') {
    if (!u.power_id || u.power_rate == null) { trace.applique.push(`${u.card_id}·(sans pouvoir)`); return; }
    const facteur = t.valeur > 0 ? t.valeur : 2;
    u.power_rate = rateForTicks(Math.max(1, Math.round(u.powerPeriod() / facteur)));
    trace.applique.push(`${u.card_id}·vitesse_pouvoir→${u.power_rate}`);
    return;
  }

  if (champ === 'bouclier') {
    // Le bouclier n'est pas une stat : il n'a ni socle ni recalcul, et
    // `resetCombatStats` l'efface tout seul. Un seul opérateur a du sens.
    const montant = t.valeur * mult;
    u.applyShield(montant);
    trace.applique.push(`${u.card_id}·bouclier+${montant}`);
    return;
  }

  // ⚠️ Le REGISTRE se choisit sur la DURÉE, et c'est tout le propos :
  //   • `combat` → `_stat_bonuses`, balayé par `resetCombatStats()` ;
  //   • `partie` → `_base`, qui voyage dans `round:board_ready` (§5.3).
  // Les trois gestes écrits à la main sur chaque site d'appel deviennent une
  // donnée. Un effet ne peut plus écrire dans le mauvais registre « par
  // habitude » — il n'y a plus de site d'appel où se tromper.
  const socle = (u._base[nom] ?? 0);
  const d = delta(t, socle) * mult;
  if (d === 0) { trace.applique.push(`${u.card_id}·${champ}+0`); return; }

  if (t.duree === 'partie') {
    u._base[nom] = Math.max(1, socle + d);
    u._recomputeStats();
    // ⚠️ Un bonus de PV permanent monte AUSSI la jauge : sans ça l'unité
    // gagnerait un maximum qu'elle ne peut pas atteindre. `applyStatBonus` le
    // fait pour le registre de combat ; le registre permanent doit le faire
    // aussi, et c'est le seul endroit où les deux diffèrent.
    if (champ === 'pv') u.current_hp = Math.min(u.max_hp, u.current_hp + d);
  } else {
    u.applyStatBonus(nom, d);
  }
  trace.applique.push(`${u.card_id}·${champ}${d >= 0 ? '+' : ''}${d}`);
}

/** Les champs de ressource, et comment chacun s'accumule. */
function appliqueSurJoueur(t: TacheModifier, monde: Monde, trace: Trace): void {
  const cible = t.cible.camp === 'ennemi' ? monde.ressourcesEnnemies : monde.ressources;
  if (!cible) { trace.ignore.push(`joueur·${t.champ} (pas de registre pour ce camp)`); return; }

  // ⚠️ L'OPÉRATEUR compte aussi sur une ressource : un contrecoup s'écrit `-`,
  // et le lire comme un `+` rendrait des PV au lieu d'en prélever. L'accumulateur
  // part de zéro, donc `delta(t, 0)` rend exactement le signe voulu.
  const d = delta(t, 0);
  // ⚠️ Skip DÉLIBÉRÉ, et tracé : le camp adverse ne reçoit que la pioche.
  if (monde.ressourcesLimitees && t.champ !== 'pioches' && t.champ !== 'pioches_garanties') {
    trace.applique.push(`(${t.champ} réservé au joueur)`);
    return;
  }
  switch (t.champ) {
    case 'pioches': {
      // ⚠️ Le plafond porte sur le TOTAL accumulé, pas sur la tâche : c'est le
      // geste de `_applyEndForSide` (`Math.min(before + value, max)`). Et le
      // crédit RÉEL est mesuré de part et d'autre — un attribut qui demande +3
      // n'en donne parfois qu'un, et c'est ce qui doit être annoncé.
      const avant = cible.pioches;
      cible.pioches = Math.min(avant + d, t.plafond ?? Infinity);
      const reel = cible.pioches - avant;
      // ⚠️ La provenance suit le crédit RÉEL, jamais la demande, et un crédit
      // entièrement rogné n'inscrit RIEN : l'invariant
      // `sum(sources.value) === extraDraws` en dépend.
      if (reel > 0 && !monde.ressourcesLimitees) {
        cible.sources.push({ kind: t.provenance ?? 'attribut', ref: monde.source ?? '', value: reel });
      }
      trace.applique.push(`joueur·pioches+${reel}`);
      return;
    }
    case 'slots_board':
      cible.slots_board = Math.min(cible.slots_board + d, t.plafond ?? Infinity);
      trace.applique.push(`joueur·slots+${d}`);
      return;
    case 'magies_shop':
      cible.magies_shop = Math.min(cible.magies_shop + d, t.plafond ?? Infinity);
      trace.applique.push(`joueur·shop+${d}`);
      return;
    case 'multiplicateur':
      cible.multiplicateur += d;
      trace.applique.push(`joueur·multiplicateur+${d}`);
      return;
    case 'pv':
      cible.pv += d;
      trace.applique.push(`joueur·pv+${d}`);
      return;
    case 'pioches_garanties':
      if (t.criteres) {
        cible.pioches_garanties.push(t.criteres);
        if (!monde.ressourcesLimitees) {
          cible.sources.push({ kind: t.provenance ?? 'attribut', ref: monde.source ?? '', value: 0, guaranteed: true });
        }
      }
      trace.applique.push('joueur·pioche_garantie');
      return;
    default:
      trace.ignore.push(`joueur·${t.champ} (champ inconnu)`);
  }
}

/**
 * `deplacer` — la seule action qui change de conteneur.
 *
 * ⚠️ Le `revive` d'aujourd'hui fait trois choses d'un coup : il sort du
 * cimetière, il repose des PV, et il purge les statuts. Le schéma les sépare
 * (§4.2) mais le moteur doit les faire ENSEMBLE pour rester d'accord avec
 * l'existant : c'est la même unité, et un corps à moitié réanimé n'a aucun sens.
 */
function appliqueDeplacer(t: TacheDeplacer, monde: Monde, trace: Trace): void {
  const source = t.cible.camp === 'ennemi' ? monde.neutraliseesEnnemies : monde.neutralisees;
  const cible = t.cible.camp === 'ennemi' ? monde.ressourcesEnnemies : monde.ressources;
  if (!source?.length || !cible) { trace.applique.push('(aucun corps à déplacer)'); return; }

  const n = t.cible.combien === 'un' ? 1 : source.length;
  for (let i = 0; i < n && source.length; i++) {
    const u = source[0];
    u.current_hp = Math.floor(u.max_hp * (t.pourcentagePv ?? 50) / 100);
    u.is_neutralized = false;
    u._deathEmitted = false;
    u.dot_effects = [];
    u.paralysis_remaining = 0;
    u.attack_period_modifier = 0;
    source.splice(0, 1);
    cible.reanimees.push(u);
    trace.applique.push(`${u.card_id}·réanimée·${t.pourcentagePv ?? 50}%`);
  }
}

function appliquePoserStatut(t: TachePoserStatut, monde: Monde, trace: Trace): void {
  for (const u of resoudre(t.cible, monde)) {
    if (t.statut === 'immunite') {
      u.is_effect_immune = true;
      trace.applique.push(`${u.card_id}·immunisée`);
    } else {
      trace.ignore.push(`${u.card_id}·statut ${t.statut} (non câblé)`);
    }
  }
}

function appliqueTache(t: Tache, monde: Monde, trace: Trace): void {
  if (t.action === 'deplacer') { appliqueDeplacer(t, monde, trace); return; }
  if (t.action === 'poser_statut') { appliquePoserStatut(t, monde, trace); return; }

  if (t.champ === 'position') { trace.ignore.push('position (aucun porteur livré n\'en pose)'); return; }
  const tache = t as TacheModifier;

  if (tache.cible.conteneur === 'joueur') { appliqueSurJoueur(tache, monde, trace); return; }

  const cibles = resoudre(tache.cible, monde);
  const mult = multiplicateur(tache, tache.cible, monde);
  // ⚠️ Un multiplicateur NUL ne touche personne, et c'est le comportement
  // d'aujourd'hui (`if (bonus === 0) break`). Le reproduire est le point : le
  // mode ombre compare des états, pas des intentions.
  if (mult === 0) { trace.applique.push('(multiplicateur nul)'); return; }
  for (const u of cibles) appliqueSurUnite(tache, u, mult, trace);
}

/**
 * Exécute des effets sur un monde.
 *
 * ⚠️ INVARIANT §5.1 : les effets sont triés par une clé ABSOLUE avant d'être
 * résolus, jamais pris dans l'ordre où ils sont arrivés. Deux clients PvP
 * compilent la même donnée et doivent en tirer le même ordre — l'ordre d'un
 * tableau ne le garantit pas, une clé dérivée du porteur si.
 */
export function executer(effets: readonly Effet[], quand: string, monde: Monde): Trace {
  const trace: Trace = { applique: [], ignore: [] };
  const aJouer = effets
    .filter(e => e.trigger.quand === quand)
    .slice()
    .sort((a, b) => cleDeTri(a).localeCompare(cleDeTri(b)));

  for (const e of aJouer) {
    // ⚠️ Une condition de PV se juge sur les PV D'AVANT l'effet, jamais après :
    // sinon un effet qui rend des PV financerait son propre contrecoup.
    const seuil = e.condition?.pvJoueurSuperieurA;
    if (seuil != null && (monde.pvJoueur ?? 0) <= seuil) {
      trace.applique.push(`${e.porteur}·(inabordable)`);
      continue;
    }
    for (const t of e.taches) appliqueTache(t, { ...monde, source: e.porteur }, trace);
  }
  return trace;
}
