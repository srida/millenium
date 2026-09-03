// Script du tutoriel — quelle bulle afficher, et quand passer à la suivante.
//
// Tout est ici en FONCTIONS PURES, et rien n'est ici en React : c'est ce qui
// rend le mode testable. La suite vitest tourne en node sans jsdom (cf.
// `client/vitest.config.ts`), donc un coach dont la décision vivrait dans un
// composant ne serait couvert par rien.
//
// Le coach est un OBSERVATEUR : il ne pilote jamais la partie, il lit l'état
// que `GameController` publie déjà dans `gameStore` et avance tout seul. D'où
// l'absence totale de crochet dans `logic/` et dans le contrôleur.

// ── Modèle commun ───────────────────────────────────────────────────────────

export interface CoachStep {
  id: string;
  title: string;
  text: string;
  /**
   * Vrai = la bulle attend un tap. C'est ce booléen qui GÈLE les chronos de la
   * partie (préparation, shopping, fin de round) — sans quoi le combat se
   * lancerait tout seul au milieu d'une explication.
   */
  blocking: boolean;
}

// ── Partie guidée ───────────────────────────────────────────────────────────

/**
 * Projection minimale de `GameSnapshot`. On ne prend pas le snapshot entier :
 * il transporte des `Unit`, et un script qui en dépendrait ne se testerait plus
 * sans construire une partie complète.
 */
export interface GameCoachState {
  round: number;
  placedCount: number;
  handSelected: boolean;
  synergyCount: number;
  combatActive: boolean;
  hasEndRound: boolean;
  shopping: boolean;
  gameOver: boolean;
  /** L'ouverture de tour est à l'écran (annonce du tour ou popup de pioche). */
  roundOpening: boolean;
}

interface GameStepDef extends CoachStep {
  /** L'étape est franchie. `seen` porte les étapes déjà validées au tap. */
  done: (state: GameCoachState, seen: ReadonlySet<string>) => boolean;
  /** L'étape a quelque chose à dire dans cet état. Sinon : rien à l'écran, et on n'avance pas. */
  visible?: (state: GameCoachState) => boolean;
}

export const GAME_STEPS: GameStepDef[] = [
  {
    id: 'hand',
    title: 'Ta main',
    text: "Voici les 5 cartes que tu viens de piocher. Tape l'une d'elles pour la choisir.",
    blocking: false,
    done: (s) => s.handSelected || s.placedCount >= 1,
  },
  {
    id: 'place',
    title: 'Place ta première unité',
    text: 'Les cases éclairées sont celles où tu peux la poser. Tape-en une.',
    blocking: false,
    done: (s) => s.placedCount >= 1,
  },
  {
    id: 'place_second',
    title: 'Une deuxième unité',
    text: "Pose-en une autre. Moins d'unités, c'est frapper plus fort — mais c'est aussi risquer de perdre le combat.",
    blocking: false,
    done: (s) => s.placedCount >= 2,
  },
  {
    id: 'synergies',
    title: "Tes synergies d'attributs",
    text: "Tes unités partagent des attributs : quand il y en a assez, un palier s'active et distribue son bonus. Le panneau te dit où tu en es.",
    blocking: true,
    // Rien à montrer si le board ne produit aucune synergie ; et si le joueur
    // lance le combat sans lire, on ne le retient pas.
    done: (s, seen) => seen.has('synergies') || s.synergyCount === 0 || s.combatActive,
  },
  {
    id: 'ready',
    title: 'Lance le combat',
    text: "Tape PRÊT ▸ en bas à droite. L'adversaire posera alors son board — tu ne le vois pas avant.",
    blocking: false,
    done: (s) => s.combatActive,
  },
  {
    id: 'combat',
    title: 'Le combat se résout seul',
    text: 'Tu ne contrôles plus rien : tout dépend de tes statistiques et de ton placement. Regarde.',
    blocking: false,
    done: (s) => s.hasEndRound,
  },
  {
    id: 'damage',
    title: 'Les dégâts',
    text: "Ce sont l'ATK de tes survivants et le multiplicateur qui font les dégâts, pas le nombre d'unités tuées.",
    blocking: false,
    // Franchie quand le récapitulatif de round est congédié.
    done: (s) => !s.hasEndRound,
  },
  {
    id: 'shopping',
    title: 'Choisis une magie',
    text: 'Après chaque combat, une magie parmi trois. Les bonus de statistiques sont permanents.',
    blocking: false,
    // Résolue dès que le tour suivant commence — que la magie ait été prise,
    // passée, ou qu'il n'y ait pas eu de Phase Shopping du tout.
    done: (s) => s.round > 1,
    visible: (s) => s.shopping,
  },
  {
    id: 'next_round',
    title: 'Tour 2',
    text: "Tes survivants sont restés en place, avec les PV qu'il leur reste. Les neutralisées sont au cimetière — elles peuvent encore servir de matériaux.",
    blocking: true,
    done: (s, seen) => seen.has('next_round') || s.combatActive,
    visible: (s) => s.round >= 2 && !s.combatActive,
  },
  {
    id: 'done',
    title: 'Tu connais la boucle',
    text: 'Place, lance, encaisse, améliore. Il te manque encore un deck à toi — allons le construire.',
    blocking: true,
    // Terminale : elle ne se franchit pas, elle se quitte.
    done: () => false,
    visible: (s) => s.gameOver,
  },
];

/**
 * Avance le plus loin possible dans le script depuis `seen`. Seul l'état de
 * l'étape COURANTE est consulté à chaque itération : c'est cet ordre qui rend
 * le script monotone (une étape franchie ne se rejoue jamais, même quand la
 * condition qui l'a validée redevient fausse).
 */
export function advanceGameSteps(state: GameCoachState, seen: ReadonlySet<string>): Set<string> {
  const next = new Set(seen);
  for (const step of GAME_STEPS) {
    if (next.has(step.id)) continue;
    if (!step.done(state, next)) break;
    next.add(step.id);
  }
  return next;
}

/** Étape courante, ou `null` si le script est fini ou n'a rien à dire ici. */
export function gameCoachStep(state: GameCoachState, seen: ReadonlySet<string>): CoachStep | null {
  // ⚠️ L'ouverture de tour passe DEVANT le coach : la popup de pioche est
  // modale et couvre la main, or la première étape dit « voici les 5 cartes que
  // tu viens de piocher » et demande d'en taper une. Règle globale et non un
  // `visible` par étape : la popup revient à chaque tour, pas seulement au
  // premier. Le menu d'options est traité de même, mais côté composant — il
  // gèle déjà la partie de son côté.
  if (state.roundOpening) return null;
  const step = GAME_STEPS.find(s => !seen.has(s.id));
  if (!step) return null;
  if (step.visible && !step.visible(state)) return null;
  return { id: step.id, title: step.title, text: step.text, blocking: step.blocking };
}

/** Le script est allé jusqu'au bout : la partie d'entraînement compte comme faite. */
export function gameTutorialComplete(seen: ReadonlySet<string>): boolean {
  return seen.has('next_round');
}

// ── DeckBuilder guidé ───────────────────────────────────────────────────────

export interface DeckCoachState {
  total: number;
  /** Nombre de cartes par tier, indexé de 1 à 5. */
  perTier: Record<number, number>;
  /** Plafond par tier — `min(8, taille du pool)`, calculé par le DeckBuilder. */
  tierMax: Record<number, number>;
  name: string;
  tab: 'lib' | 'deck';
  valid: boolean;
  minDeck: number;
}

/**
 * Une seule étape à la fois, dérivée de l'état — pas de compteur interne. Un
 * joueur qui retire des cartes revient donc naturellement au message précédent,
 * ce qu'un index ne saurait pas faire.
 */
export function deckCoachStep(state: DeckCoachState): CoachStep | null {
  const { total, perTier, tierMax, name, tab, valid, minDeck } = state;
  const t1 = perTier[1] ?? 0;
  const t2 = perTier[2] ?? 0;

  if (valid) {
    return {
      id: 'save',
      title: 'Ton deck est prêt',
      text: "Enregistre-le : il deviendra ton deck actif, celui que jouent l'entraînement, le tournoi et le duel en ligne.",
      blocking: false,
    };
  }

  if (total === 0) {
    return {
      id: 'start',
      title: 'Commence par le Tier 1',
      text: "Dans la Bibliothèque, tape une carte pour l'ajouter. Les cartes de tier 1 sont les seules que tu piocheras au tour 1 — c'est par elles qu'on commence.",
      blocking: false,
    };
  }

  if (t1 < Math.min(6, tierMax[1] ?? 8)) {
    return {
      id: 'tier1',
      title: `Tier 1 — ${t1}/${tierMax[1] ?? 8}`,
      text: 'Vise 6 à 8 cartes ici. Tes deux premiers tours en dépendent entièrement.',
      blocking: false,
    };
  }

  if (t2 < Math.min(4, tierMax[2] ?? 8)) {
    return {
      id: 'tier2',
      title: `Tier 2 — ${t2}/${tierMax[2] ?? 8}`,
      text: 'Le tier 2 arrive dès le tour 2. Ajoute-en quelques-unes avant de monter plus haut.',
      blocking: false,
    };
  }

  if (total < minDeck) {
    const need = minDeck - total;
    return {
      id: 'fill',
      title: `Encore ${need} carte${need > 1 ? 's' : ''}`,
      text: `Il faut ${minDeck} cartes au minimum. Complète avec les tiers 3 à 5 : ils arrivent aux tours 3, 4 et 5, quand le multiplicateur rend les gros monstres décisifs.`,
      blocking: false,
    };
  }

  if (tab === 'lib') {
    return {
      id: 'go_deck',
      title: 'Le compte y est',
      text: "Passe à l'onglet Deck pour nommer ta création et l'enregistrer.",
      blocking: false,
    };
  }

  if (!name.trim()) {
    return {
      id: 'name',
      title: 'Nomme ton deck',
      text: "C'est sous ce nom que tu le retrouveras dans « Mes decks ».",
      blocking: false,
    };
  }

  return null;
}
