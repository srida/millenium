// Contenu du codex du tutoriel — 11 chapitres, du vocabulaire de base
// (carte, unité, main) jusqu'aux systèmes (attributs, pouvoirs, magies, terrains).
//
// Aucun `id` de carte n'est écrit en dur ici : chaque exemple est un SÉLECTEUR
// pur `(cards) => Card[]` évalué sur le catalogue réel au moment du rendu. Le
// codex suit donc les données — une carte renommée, retirée ou ajoutée depuis
// l'admin ne le fait jamais mentir, et un golden test vérifie que chaque
// sélecteur rend encore quelque chose.
//
// Le module est PUR : aucun import de React, de Zustand ni de la couche data/
// (les databases sont interrogées par les composants). C'est ce qui permet de
// le tester en node, sans jsdom ni serveur.
import type { Card, SummonType } from '../logic/types.js';

// ── Sélecteurs ──────────────────────────────────────────────────────────────

/** Toujours trier avant de couper : un exemple ne doit pas changer d'un rendu à l'autre. */
function byId(cards: Card[]): Card[] {
  return [...cards].sort((a, b) => a.id.localeCompare(b.id));
}

function firstWhere(cards: Card[], pred: (c: Card) => boolean, limit = 1): Card[] {
  return byId(cards.filter(pred)).slice(0, limit);
}

/** Une carte représentative d'un type d'invocation, en préférant les tiers bas (plus lisibles). */
function oneOfSummonType(type: SummonType): CardPick {
  return (cards) => {
    const matching = cards.filter(c => (c.summon_type ?? 'normal') === type);
    const sorted = [...matching].sort((a, b) => (a.tier - b.tier) || a.id.localeCompare(b.id));
    return sorted.slice(0, 1);
  };
}

/** Une carte par tier existant, de 1 à 5. */
const oneCardPerTier: CardPick = (cards) => {
  const out: Card[] = [];
  for (let t = 1; t <= 5; t++) {
    const pick = firstWhere(cards, c => c.tier === t && (c.summon_type ?? 'normal') === 'normal')[0]
      ?? firstWhere(cards, c => c.tier === t)[0];
    if (pick) out.push(pick);
  }
  return out;
};

export type CardPick = (cards: Card[]) => Card[];

// ── Blocs ───────────────────────────────────────────────────────────────────

export type ChapterBlock =
  | { kind: 'text'; text: string }
  | { kind: 'bullets'; items: string[] }
  | { kind: 'table'; head: [string, string]; rows: [string, string][] }
  | { kind: 'note'; text: string }
  | { kind: 'cards'; caption?: string; pick: CardPick }
  /** Exemples tirés des autres catalogues, résolus par le composant. */
  | { kind: 'powers'; caption?: string; limit: number }
  | { kind: 'attributes'; caption?: string; limit: number }
  | { kind: 'magies'; caption?: string; limit: number }
  | { kind: 'boards'; caption?: string; limit: number };

export interface Chapter {
  id: string;
  icon: string;
  title: string;
  /** Une phrase, affichée sur la tuile du sommaire. */
  blurb: string;
  blocks: ChapterBlock[];
}

// ── Les chapitres ───────────────────────────────────────────────────────────

export const CHAPTERS: Chapter[] = [
  {
    id: 'cards_units',
    icon: '🃏',
    title: 'Cartes et unités',
    blurb: 'Ce que tu tiens en main, et ce qui se bat sur le terrain.',
    blocks: [
      { kind: 'text', text: "Une **carte** est une définition : un nom, un tier, des statistiques, parfois un pouvoir. Elle vit dans ton deck, puis dans ta main. Tant qu'elle est une carte, elle ne fait rien." },
      { kind: 'text', text: "Quand tu la poses sur le terrain, elle devient une **unité** : un exemplaire vivant, avec ses propres points de vie, son bouclier, sa jauge de pouvoir et sa position. Deux unités issues de la même carte sont deux unités distinctes." },
      { kind: 'cards', caption: 'Une carte, telle qu\'elle apparaît dans ta main', pick: (cards) => firstWhere(cards, c => c.tier === 1 && (c.summon_type ?? 'normal') === 'normal') },
      { kind: 'bullets', items: [
        "L'unité **persiste d'un tour à l'autre** : une survivante est toujours là au tour suivant, avec les PV qu'il lui reste.",
        "Les bonus de combat (attributs, terrain) sont **remis à zéro** après chaque combat, puis recalculés.",
        "Les bonus des **magies** sont permanents : ils s'écrivent dans les statistiques de base de l'unité.",
      ] },
      { kind: 'note', text: "Une unité qui survit à un combat gagne un point de **vétérance**. À partir de 2 points, elle reçoit un bonus d'ATK et de PV à chaque combat." },
    ],
  },
  {
    id: 'hand',
    icon: '✋',
    title: 'La main',
    blurb: '5 cartes par tour, conservées, tirées dans ton deck.',
    blocks: [
      { kind: 'text', text: "Au début de chaque tour, tu **pioches 5 cartes** dans ton deck. Les cartes que tu ne joues pas **restent en main** : elles s'ajoutent à la pioche du tour suivant. La main n'a pas de taille limite." },
      { kind: 'text', text: "Le tier des cartes piochées dépend du tour. Les grosses cartes n'arrivent pas tout de suite — c'est ce qui donne sa courbe à la partie." },
      { kind: 'table', head: ['Tour', 'Tiers piochés'], rows: [
        ['1', 'Tier 1'],
        ['2', 'Tier 1 et 2'],
        ['3', 'Tier 1 à 3'],
        ['4', 'Tier 2 à 4'],
        ['5', 'Tier 3 à 5'],
      ] },
      { kind: 'cards', caption: 'Trois cartes d\'une même main', pick: (cards) => [1, 2, 3].flatMap(t => firstWhere(cards, c => c.tier === t)) },
      { kind: 'note', text: "Les exemplaires identiques sont **empilés** sous une seule vignette, avec un badge ×N. Une carte grisée est injouable pour l'instant : matériaux manquants, terrain plein, ou doublon déjà en jeu." },
    ],
  },
  {
    id: 'board',
    icon: '🗺️',
    title: 'Le terrain, la zone neutre et les neutralisées',
    blurb: '5 colonnes, 11 rangées, et un cimetière qui sert à quelque chose.',
    blocks: [
      { kind: 'text', text: "Le terrain fait **5 colonnes sur 11 rangées**. Il est partagé en trois zones." },
      { kind: 'table', head: ['Zone', 'Rangées'], rows: [
        ['Ton côté', '0 à 3'],
        ['Zone neutre', '4 à 6'],
        ['Côté adverse', '7 à 10'],
      ] },
      { kind: 'text', text: "Tu ne places tes unités que **sur ton côté**. La **zone neutre** est inoccupable en préparation : c'est le terrain qu'on se dispute, la distance que les unités traversent une fois le combat lancé. En préparation, le côté adverse t'est masqué — tu poses ton board sans voir le sien." },
      { kind: 'note', text: "**5 unités maximum** sur le terrain (6 avec certaines synergies d'attributs)." },
      { kind: 'text', text: "Une unité qui tombe au combat est **neutralisée**. Elle ne disparaît pas pour autant : elle reste sur le terrain jusqu'à la fin de la préparation suivante, et rejoint ton **cimetière**." },
      { kind: 'bullets', items: [
        "Les unités neutralisées sont **utilisables comme matériaux** d'invocation (sacrifice, fusion, héritage, transformation) pendant toute la préparation suivante.",
        "Une unité prise au cimetière **ne consomme pas d'emplacement** lors d'une transformation : elle est déjà hors jeu.",
        "Celles que tu n'as pas consommées sont **définitivement retirées** au lancement du combat suivant.",
      ] },
      { kind: 'note', text: "Une défaite n'est donc pas une perte sèche : ce qui tombe au tour 2 peut devenir le matériau de ta grosse invocation du tour 3." },
    ],
  },
  {
    id: 'stats',
    icon: '📊',
    title: 'Les statistiques',
    blurb: 'Six chiffres qui décident de tout, puisque le combat est automatique.',
    blocks: [
      { kind: 'text', text: "Le combat se résout tout seul : tu ne contrôles rien une fois qu'il est lancé. Ce sont ces six valeurs — et ton placement — qui décident du résultat." },
      { kind: 'table', head: ['Statistique', 'Effet'], rows: [
        ['ATK', "Dégâts infligés par attaque. C'est aussi l'ATK des survivants qui fixe les dégâts de fin de combat."],
        ['PV', "Points de vie. À zéro, l'unité est neutralisée."],
        ['Vit. déplacement', "Plus la valeur est basse, plus l'unité avance souvent."],
        ['Vit. attaque', "Plus la valeur est basse, plus l'unité frappe souvent."],
        ['Initiative', "Qui agit en premier dans un même instant. La plus haute passe devant."],
        ['Portée', "Distance d'attaque, en cases, sans diagonale."],
      ] },
      { kind: 'note', text: "La portée se compte **en croix**, jamais en diagonale : une portée de 2 atteint deux cases devant, ou une devant et une sur le côté." },
      { kind: 'cards', caption: 'Une unité et ses statistiques (appui long sur la vignette)', pick: (cards) => firstWhere(cards, c => !!c.power?.id) },
      { kind: 'text', text: "S'y ajoutent en combat le **bouclier** (absorbe les dégâts avant les PV) et la **jauge de pouvoir**, qui se remplit à chaque instant de combat." },
    ],
  },
  {
    id: 'phases',
    icon: '⏱️',
    title: 'Les phases de jeu',
    blurb: 'Cinq tours, et la même boucle à chaque fois.',
    blocks: [
      { kind: 'text', text: "Une partie dure **5 tours**. Chaque joueur commence à **1000 points de vie**. Le premier à zéro perd ; sinon, c'est celui qui a le plus de PV après le tour 5." },
      { kind: 'table', head: ['Phase', 'Ce qui se passe'], rows: [
        ['1. Préparation', "60 secondes pour piocher, invoquer et placer. Tu peux lancer avant la fin avec PRÊT."],
        ['2. Combat', "Automatique. L'adversaire pose son board au lancement, puis tout se résout seul."],
        ['3. Fin de combat', "Les survivants du vainqueur infligent leurs dégâts."],
        ['4. Shopping', "Une magie à choisir parmi 3. Sautée au dernier tour."],
        ['5. Tour suivant', "Nouvelle pioche, les survivants reprennent leur place."],
      ] },
      { kind: 'text', text: "Les dégâts de fin de combat ne dépendent pas du nombre d'unités tuées, mais de **l'ATK totale de tes survivants**, multipliée. Et le multiplicateur récompense les boards dégarnis." },
      { kind: 'table', head: ['Unités sur ton terrain', 'Multiplicateur'], rows: [
        ['5 ou plus', '×1'],
        ['4', '×1,2'],
        ['3', '×1,5'],
        ['2', '×2'],
        ['0 ou 1', '×3'],
      ] },
      { kind: 'note', text: "Ce multiplicateur est ensuite **multiplié par le numéro du tour** : au tour 5, tout fait cinq fois plus mal. Une partie ne se joue pas au tour 1." },
      { kind: 'text', text: "Peu d'unités, c'est donc frapper plus fort — mais c'est aussi risquer de perdre le combat. C'est l'arbitrage central du jeu." },
      { kind: 'note', text: "Un combat qui n'a pas départagé les camps au bout de 60 secondes est **coupé** : les deux joueurs encaissent alors les dégâts des survivants d'en face. Un board purement défensif ne protège de rien." },
    ],
  },
  {
    id: 'tiers',
    icon: '⭐',
    title: 'Les tiers',
    blurb: 'De 1 à 5 : la puissance, et le moment où elle arrive.',
    blocks: [
      { kind: 'text', text: "Chaque carte porte un **tier**, de 1 à 5. Il dit deux choses : sa puissance, et à partir de quel tour tu peux la piocher." },
      { kind: 'cards', caption: 'Un exemple par tier', pick: oneCardPerTier },
      { kind: 'bullets', items: [
        "**Tier 1 et 2** — ton socle. Peu chères, disponibles tôt, souvent invocables normalement.",
        "**Tier 3** — le tournant : c'est là qu'arrivent les fusions et les héritages.",
        "**Tier 4 et 5** — les finisseuses. Elles coûtent des matériaux et n'arrivent qu'aux derniers tours, quand le multiplicateur les rend décisives.",
      ] },
      { kind: 'note', text: "Dans un deck : **8 cartes maximum par tier**, et **un seul exemplaire** de chaque carte. Un deck trop lourd en tier 5 ne pioche rien au tour 1." },
    ],
  },
  {
    id: 'summoning',
    icon: '🔮',
    title: "Les types d'invocation",
    blurb: 'Cinq façons de poser une carte, dont quatre coûtent quelque chose.',
    blocks: [
      { kind: 'text', text: "Poser une carte n'est gratuit que pour les invocations normales. Les autres consomment des unités déjà en jeu — ou au cimetière." },
      { kind: 'cards', caption: 'Normale — on la pose, et c\'est tout', pick: oneOfSummonType('normal') },
      { kind: 'cards', caption: 'Sacrifice — consomme un nombre d\'unités alliées', pick: oneOfSummonType('sacrifice') },
      { kind: 'cards', caption: 'Fusion — exige des cartes précises comme matériaux', pick: oneOfSummonType('fusion') },
      { kind: 'cards', caption: 'Héritage — un matériau précis, plus des sacrifices', pick: oneOfSummonType('heritage') },
      { kind: 'cards', caption: 'Transformation — remplace une unité en jeu, à sa place', pick: oneOfSummonType('transformation') },
      { kind: 'text', text: "Une invocation peut **en enchaîner une autre** dans la même préparation : la nouvelle unité devient aussitôt un matériau possible." },
      { kind: 'note', text: "🧬 **La lignée.** Une unité composite « représente » les cartes qui l'ont produite. Elle peut donc servir de matériau à leur place plus tard — à condition que toute sa lignée soit requise par la nouvelle invocation." },
      { kind: 'note', text: "🚫 **La règle du doublon.** Jamais deux exemplaires vivants de la même carte sur ton terrain. Une invocation spéciale peut passer par-dessus, à condition que le doublon soit **sélectionné comme matériau**." },
      { kind: 'text', text: "Certaines cartes proposent **plusieurs recettes** (🔀). Tapes-en une et un menu te laisse choisir laquelle utiliser." },
    ],
  },
  {
    id: 'attributes',
    icon: '🔗',
    title: 'Les synergies d\'attributs',
    blurb: 'Réunis les bonnes cartes, débloque des paliers.',
    blocks: [
      { kind: 'text', text: "Chaque carte porte un ou plusieurs **attributs** : un type, un archétype, un élément. Quand assez de cartes partagent le même attribut sur ton terrain, un **palier** s'active et distribue son bonus." },
      { kind: 'attributes', caption: 'Quelques attributs et leurs paliers', limit: 3 },
      { kind: 'bullets', items: [
        "Seul le **palier le plus élevé atteint** est actif — les paliers ne se cumulent pas entre eux.",
        "Le décompte porte sur les **cartes distinctes** : deux exemplaires d'une même carte ne comptent que pour un.",
        "Les bonus sont **remis à zéro** en fin de combat, puis recalculés au combat suivant selon les unités présentes.",
      ] },
      { kind: 'text', text: "Les attributs n'agissent pas tous au même moment :" },
      { kind: 'table', head: ['Moment', 'Ce que ça donne'], rows: [
        ['Début de combat', 'Bonus de statistiques, boucliers, immunités aux effets.'],
        ['Pendant le combat', "Réactions : un allié tombe, un ennemi tombe…"],
        ['Fin de combat', 'Pioches garanties, réanimations, emplacement en plus, dégâts majorés, magie supplémentaire.'],
      ] },
      { kind: 'note', text: "Le panneau des synergies, en jeu, te montre en direct où tu en es de chaque palier. C'est lui qu'il faut regarder avant de taper PRÊT." },
    ],
  },
  {
    id: 'powers',
    icon: '⚡',
    title: 'Les pouvoirs',
    blurb: 'Une capacité par unité, qui part toute seule au bon moment.',
    blocks: [
      { kind: 'text', text: "Une unité a **au plus un pouvoir**. Sa jauge se remplit tout au long du combat ; une fois pleine, le pouvoir part **à la place de l'attaque** — et la jauge se vide." },
      { kind: 'note', text: "Le pouvoir a besoin d'une **cible à portée et en ligne de vue**, comme une attaque normale. Sans cible, la jauge reste pleine et attend." },
      { kind: 'powers', caption: 'Quelques-uns des 14 pouvoirs du jeu', limit: 6 },
      { kind: 'bullets', items: [
        "Les pouvoirs ne se déclenchent **jamais en préparation**.",
        "Leurs effets prennent fin **à la fin du combat**.",
        "Certaines unités sont **immunisées aux effets** par leur attribut : poison, paralysie, gel et compagnie n'ont aucune prise sur elles.",
      ] },
    ],
  },
  {
    id: 'magies',
    icon: '✨',
    title: 'Les magies',
    blurb: 'Un choix entre trois, après chaque combat.',
    blocks: [
      { kind: 'text', text: "Après chaque combat — sauf le dernier tour — tu choisis **une magie parmi trois**. C'est le seul endroit du jeu où tu améliores durablement ce que tu as déjà." },
      { kind: 'magies', caption: 'Quelques magies', limit: 4 },
      { kind: 'text', text: "Selon son effet, une magie s'applique de trois façons :" },
      { kind: 'table', head: ['Portée', 'Exemples'], rows: [
        ['Sur une unité du terrain', 'Bonus de statistique, soin, bouclier, destruction.'],
        ['Sur une unité du cimetière', 'Réanimation.'],
        ['Globale', 'Pioche supplémentaire, PV joueur, emplacement de terrain.'],
      ] },
      { kind: 'note', text: "Les bonus de statistiques donnés par une magie sont **permanents** — et ils **suivent l'unité** si tu la consommes plus tard comme matériau. Investir sur une unité n'est jamais perdu." },
    ],
  },
  {
    id: 'boards',
    icon: '🏞️',
    title: 'Les terrains',
    blurb: 'Un décor tiré à chaque combat, avec ses obstacles et son effet.',
    blocks: [
      { kind: 'text', text: "À chaque combat, un **terrain** est tiré au sort. Il n'existe que pendant le combat : en préparation, tu ne sais pas encore lequel tombera." },
      { kind: 'boards', caption: 'Quelques terrains', limit: 3 },
      { kind: 'bullets', items: [
        "**Cases bloquées** — des obstacles, souvent dans la zone neutre. Les unités les contournent.",
        "**Ligne de vue** — un obstacle entre une unité et sa cible l'empêche d'attaquer. Elle continue d'avancer jusqu'à retrouver l'angle.",
        "**Effet de terrain** — un bonus de statistique, parfois réservé à certains attributs, appliqué aux unités concernées des deux camps.",
      ] },
      { kind: 'note', text: "En combat, l'illustration et le nom du terrain s'affichent dans la barre du bas. Tape-les pour voir son effet et les archétypes qu'il renforce." },
    ],
  },
];

export function chapterById(id: string): Chapter | null {
  return CHAPTERS.find(c => c.id === id) ?? null;
}
