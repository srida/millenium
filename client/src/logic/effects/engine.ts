// LE MOTEUR — exécute des `Effet[]`.
//
// ⚠️ Il ne connaît AUCUN porteur. Il ne sait pas ce qu'est un terrain, une
// magie ou un attribut : il reçoit des effets compilés et les applique. C'est
// cette ignorance qui fait tout l'intérêt — un porteur de plus n'est qu'un
// compilateur de plus, jamais une branche de plus ici.
//
// ⚠️ Il n'écrit PAS l'état lui-même : il délègue aux primitives d'`Unit` et de
// `GameState` (`applyStatBonus`, `applyShield`, les champs de ressource). Le
// moteur décide QUEL REGISTRE selon la `durée` ; il ne réimplémente pas ce que
// le registre fait. Sans ça on se donnerait une seconde version de
// `_recomputeStats`, et le jour où elles divergeraient, personne ne le verrait.
//
// Cf. `docs/moteur-effets.md` §4 et §5.

import type { Unit } from '../Unit.js';
import type { GameState } from '../GameState.js';
import { CHAMPS_UNITE, CHAMPS_JOUEUR, cleDeTri } from './types.js';
import type { Effet, Tache, TacheModifier, Selecteur, ChampUnite, ChampJoueur } from './types.js';

export interface Monde {
  unitesAlliees: readonly Unit[];
  unitesEnnemies: readonly Unit[];
  gameState: GameState | null;
  /**
   * ⚠️ INVARIANT §5.2 : le hasard est une dépendance INJECTÉE, jamais
   * `Math.random`. Aucune tâche compilée aujourd'hui n'en consomme — le champ
   * existe pour qu'il n'y ait jamais de raison d'aller en chercher ailleurs, et
   * pour que le jour où `combien: 'un'` arrivera, le nombre d'appels soit
   * comptable depuis un seul endroit.
   */
  rand?: () => number;
  /** Nom du porteur, pour les registres de provenance (`player_draw_sources`). */
  source?: string;
}

/** Ce qu'une exécution a réellement fait — le matériau du mode ombre. */
export interface Trace {
  /** Une ligne par tâche appliquée, dans l'ordre de résolution. */
  applique: string[];
  /** Une ligne par tâche qu'aucun registre n'a su écrire. **Jamais silencieux.** */
  ignore: string[];
}

/** Les unités qu'un sélecteur désigne, dans l'ordre du monde. */
function resoudre(sel: Selecteur, monde: Monde): Unit[] {
  if (sel.conteneur !== 'board') return [];
  const pool = sel.camp === 'allie' ? [...monde.unitesAlliees]
    : sel.camp === 'ennemi' ? [...monde.unitesEnnemies]
      : [...monde.unitesAlliees, ...monde.unitesEnnemies];
  const f = sel.filtre;
  if (!f) return pool;
  return pool.filter(u => {
    if (f.attributs?.length && !u.attributes.some(a => f.attributs!.includes(a))) return false;
    if (f.cartes?.length && !f.cartes.includes(u.card_id)) return false;
    if (f.tiers?.length && !f.tiers.includes(u.tier)) return false;
    return true;
  });
}

/** Le multiplicateur d'un `parAttributAdverse` — 1 quand il n'y en a pas. */
function multiplicateur(t: TacheModifier, sel: Selecteur, monde: Monde): number {
  if (!t.parAttributAdverse) return 1;
  // ⚠️ « Adverse » se lit depuis le camp VISÉ, pas depuis le porteur : c'est ce
  // que fait `applyStartOfCombat` (`units === this.playerUnits ? enemy : player`).
  const autre = sel.camp === 'ennemi' ? monde.unitesAlliees : monde.unitesEnnemies;
  return autre.filter(u => u.isAlive() && u.attributes.includes(t.parAttributAdverse!)).length;
}

/**
 * Le delta additif qu'une tâche représente sur une unité donnée.
 *
 * ⚠️ **La conversion du multiplicateur en additif vit ICI et nulle part
 * ailleurs.** Le schéma garde l'intention (`*`), parce que c'est ce que l'auteur
 * écrit ; le moteur la convertit, parce que lui seul sait que le registre de
 * combat est additif et que `resetCombatStats()` doit savoir le nettoyer. C'est
 * exactement le geste de `BoardEffect.applyEffect` d'aujourd'hui — reproduit,
 * pas réinventé : deux `×2 PV` donnent `×3`, jamais `×4`.
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
  } else {
    u.applyStatBonus(nom, d);
  }
  trace.applique.push(`${u.card_id}·${champ}${d >= 0 ? '+' : ''}${d}`);
}

function appliqueSurJoueur(t: TacheModifier, monde: Monde, trace: Trace): void {
  const g = monde.gameState;
  if (!g) { trace.ignore.push(`joueur·${t.champ} (pas de gameState)`); return; }
  const nom = CHAMPS_JOUEUR[t.champ as ChampJoueur];
  if (!nom) { trace.ignore.push(`joueur·${t.champ} (champ inconnu)`); return; }

  // ⚠️ L'indexation passe par un `Record<string, number>` et non par un `any` :
  // `CHAMPS_JOUEUR` est une table FERMÉE dont les valeurs sont toutes des
  // champs numériques de `GameState`. Un `any` ici rendrait muet le jour où
  // l'un d'eux cesserait d'être un nombre — exactement le genre de silence que
  // ce moteur existe pour supprimer.
  const ressources = g as unknown as Record<string, number>;
  const avant = ressources[nom];
  const d = delta(t, avant);
  ressources[nom] = avant + d;

  // ⚠️ Le registre de PROVENANCE part avec le crédit, jamais après : l'invariant
  // `sum(sources.value) === extraDraws` est vérifié par `draw-summary.test.ts`,
  // et un quatrième émetteur qui l'oublierait ferait annoncer au joueur un
  // « +2 » venu de nulle part.
  if (t.champ === 'pioches' && d !== 0) {
    g.player_draw_sources.push({ kind: 'terrain', ref: monde.source ?? '', value: d });
  }
  trace.applique.push(`joueur·${t.champ}${d >= 0 ? '+' : ''}${d}`);
}

function appliqueTache(t: Tache, monde: Monde, trace: Trace): void {
  if (t.champ === 'position') { trace.ignore.push('position (aucun porteur livré n\'en pose)'); return; }
  const tache = t as TacheModifier;

  if (tache.cible.conteneur === 'joueur') { appliqueSurJoueur(tache, monde, trace); return; }

  const cibles = resoudre(tache.cible, monde);
  const mult = multiplicateur(tache, tache.cible, monde);
  // ⚠️ Un multiplicateur NUL ne touche personne, et c'est le comportement
  // d'aujourd'hui (`if (bonus === 0) break`). Le reproduire est le point : le
  // mode ombre compare des états, pas des intentions.
  if (mult === 0) { trace.applique.push(`(multiplicateur nul)`); return; }
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
    for (const t of e.taches) appliqueTache(t, { ...monde, source: e.porteur }, trace);
  }
  return trace;
}
