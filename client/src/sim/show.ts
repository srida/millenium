// L'émission — le rapport d'équilibrage transformé en chronique parlée.
//
// Pure : une fonction du rapport vers du texte, sans DOM, sans horloge, sans
// hasard. Deux runs identiques rendent le même script, mot pour mot.
//
// ⚠️ **AUCUN CHIFFRE N'EST INVENTÉ ICI.** Tout nombre prononcé sort d'un champ
// mesuré ou d'un décompte de liste. C'est ce qui justifie d'écrire le script par
// gabarits plutôt que de le faire rédiger : une chronique plus vivante qui se
// tromperait d'un point sur un winrate ne vaudrait rien, puisque c'est
// précisément pour ces points-là qu'on la produit. Verrouillé par
// `client/src/test/show.test.ts`, qui relève chaque nombre du script et le
// confronte au rapport.
//
// ⚠️ **Le texte est écrit pour être DIT, pas lu.** Pas de « Δ », pas de « ± »,
// pas de « +35.9pt » : un moteur vocal les rend de façon imprévisible d'une voix
// à l'autre. On écrit « 35,9 points au-dessus de la moyenne ».
import type { Aggregates, FamilyRow } from './aggregate.js';
import type { CardRow } from './metrics.js';
import type { AbResult, DetectorResult } from './protocol.js';
import { summonCostLabel } from './aggregate.js';

export interface ShowCard {
  id: string;
  name: string;
  /** La ligne écrite qui accompagne la citation orale. */
  note: string;
}

export interface ShowSegment {
  id: string;
  /** Titre du chapitre, affiché et annoncé. */
  title: string;
  /** Une phrase = une énonciation. Le découpage sert aussi au surlignage. */
  sentences: string[];
  /** Ce que le segment montre à l'écrit, au-delà des cartes citées à l'oral. */
  cards: ShowCard[];
}

export interface Show {
  title: string;
  segments: ShowSegment[];
  words: number;
  /** Estimation à 150 mots/minute, la cadence d'une lecture posée. */
  estimatedSeconds: number;
}

/** Au plus cinq cartes citées à l'oral : au-delà, on n'écoute plus, on subit. */
const SPOKEN_MAX = 5;
/** Mots par minute d'une lecture posée — sert à annoncer la durée, rien d'autre. */
const WORDS_PER_MINUTE = 150;
/** La liste écrite des cartes bien réglées est plafonnée — le compte annoncé à
 *  l'oral, lui, reste le vrai. La phrase le dit plutôt que de laisser un écart
 *  inexpliqué entre ce qu'on entend et ce qu'on voit. */
const BIEN_GEREES_ECRITES = 40;

// ── Mise en forme parlée ──────────────────────────────────────────────────
// ⚠️ Un seul point de changement si une voix rend mal un symbole : ces
// fonctions. C'est la raison pour laquelle rien n'est formaté en ligne — et
// c'est aussi ce qui rend vérifiable la promesse « aucun chiffre inventé ».
//
// ⚠️ Chaque helper ENREGISTRE ce qu'il produit. Le test relève ensuite tous les
// nombres présents dans le script et exige que chacun soit passé par ici : un
// chiffre écrit en dur dans un gabarit n'y figure pas, et le test tombe.
// La première version comparait à « tous les taux du rapport » — avec 550
// cartes, l'ensemble des pourcentages à une décimale est presque saturé, et le
// test passait sur un « 87,4 % » entièrement inventé. Un test qui passe aussi
// sur la faille ne vaut rien.
//
// L'enregistreur est un module-level remis à zéro au début de `buildShow` :
// la génération est synchrone et mono-thread, il n'y a pas de réentrance.
// ⚠️ L'enregistrement ne couvre QUE le texte prononcé. Les listes écrites
// affichées à côté formatent des centaines de cartes : les enregistrer aussi
// saturait l'ensemble au point qu'un « 87,4 % » inventé s'y trouvait par
// coïncidence, et le test repassait au vert. Éprouvé — c'est la deuxième fois
// que ce test-ci a dû être resserré, et la garantie ne vaut que pour ce qui
// sort des haut-parleurs.
let recorded: string[] = [];
let muted = false;
const record = <T extends string>(s: T): T => { if (!muted) recorded.push(s); return s; };
/** Formate sans enregistrer — pour tout ce qui est affiché et non prononcé. */
function silently<T>(fn: () => T): T {
  muted = true;
  try { return fn(); } finally { muted = false; }
}
/** Les nombres PRONONCÉS par la dernière construction — lu par les tests. */
export function recordedNumbers(): string[] { return [...recorded]; }

/** « 51,3 % ». Les voix françaises lisent le signe « pour cent ». */
const pct = (x: number, d = 1) => `${record((100 * x).toFixed(d).replace('.', ','))} %`;

/** « 35,9 points au-dessus » / « 12,1 points en dessous » — jamais un signe. */
function ecart(delta: number, d = 1): string {
  const v = record(Math.abs(100 * delta).toFixed(d).replace('.', ','));
  return `${v} point${Math.abs(100 * delta) >= 2 ? 's' : ''} ${delta >= 0 ? 'au-dessus' : 'en dessous'}`;
}

/** ⚠️ Sans séparateur de milliers : « 60 000 » se lit parfois « soixante, zéro
 *  zéro zéro ». La forme compacte est rendue correctement partout. */
const nb = (n: number) => record(String(Math.round(n)));

/** Un décimal parlé (« 5,0 tours ») — même enregistrement que les autres. */
const dec = (x: number, d = 1) => record(x.toFixed(d).replace('.', ','));

const pluriel = (n: number, singulier: string, pluriel_: string) => (n > 1 ? pluriel_ : singulier);

const MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin',
  'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];

/** « 2026-08-25 » se lit « deux mille vingt-six tiret zéro huit… ». On dit une date. */
function dateParlee(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  const jour = Number(m[3]);
  return `${jour === 1 ? record('1er') : record(String(jour))} ${MOIS[Number(m[2]) - 1]} ${record(m[1])}`;
}

/** Une étiquette de famille commence une phrase : elle prend la majuscule. */
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Énumère à l'oral : « A, B et C ». */
function liste(items: string[]): string {
  if (items.length === 0) return '';
  if (items.length === 1) return items[0];
  return `${items.slice(0, -1).join(', ')} et ${items[items.length - 1]}`;
}

// ── Les six catégories ────────────────────────────────────────────────────

export interface Categories {
  tropFortes: CardRow[];
  tropFaibles: CardRow[];
  injouables: DetectorResult['neverPlayed'];
  sousEstimees: CardRow[];
  pieges: CardRow[];
  bienGerees: CardRow[];
}

/** Seuils calibrés sur un rapport réel — cf. CLAUDE.md pour les effectifs. */
const SOUS_ESTIMEE_POSE = 0.35;
const PIEGE_POSE = 0.60;

export function classify(detector: DetectorResult): Categories {
  const rows = detector.rows;
  const played = rows.filter(r => r.played > 0);

  // ⚠️ Seuil RELATIF : à 3 000 parties une seule carte franchit 200 poses, à
  // 60 000 il y en a des dizaines. Un seuil en dur viderait ce segment sur les
  // petits runs et le noierait sur les grands.
  const counts = played.map(r => r.played).sort((a, b) => a - b);
  const mediane = counts.length ? counts[Math.floor(counts.length / 2)] : 0;
  const seuilSolide = Math.max(100, mediane);

  const significatives = rows.filter(r => r.significant);

  // ⚠️ « Sous-estimée » et « piège » sont des LENTILLES, pas des cases : elles
  // regardent les mêmes cartes significatives sous l'angle du taux de pose, et
  // une carte peut donc être à la fois trop forte ET sous-estimée — c'est même
  // l'information la plus actionnable qui soit (elle gagne trop, et trop peu de
  // joueurs y ont accès).
  //
  // Elles EXIGENT la significativité, et ce n'est pas une précaution de style :
  // sans elle, le segment citait « posée dans 100 % des parties, pour 0,0 % de
  // victoires » sur une carte vue UNE fois. C'est exactement le bruit que le
  // reste du module existe pour rejeter, et le laisser passer dans la seule
  // partie du rapport qu'on écoute serait le pire endroit de tous.
  return {
    tropFortes: significatives.filter(r => (r.delta ?? 0) > 0),
    tropFaibles: significatives.filter(r => (r.delta ?? 0) < 0),
    // Elle était dans le deck et n'en est jamais sortie : c'est un problème de
    // constructibilité, pas de puissance. « Jamais retenue en deck » est un
    // troisième cas, qui ne concerne pas l'équilibrage.
    injouables: detector.neverPlayed.filter(c => c.inDeck > 0),
    // Elle gagne quand elle sort, et elle sort peu.
    sousEstimees: significatives.filter(r => (r.delta ?? 0) > 0 && (r.playRate ?? 1) < SOUS_ESTIMEE_POSE),
    // Elle sort souvent et fait perdre.
    pieges: significatives.filter(r => (r.delta ?? 0) < 0 && (r.playRate ?? 0) > PIEGE_POSE),
    // Abondamment mesurée, et indiscernable de la ligne de base.
    bienGerees: played.filter(r => r.played >= seuilSolide
      && r.ci !== null && Math.abs(r.delta ?? 0) < r.ci),
  };
}

// ── Construction du script ────────────────────────────────────────────────

const byEffect = (a: CardRow, b: CardRow) => Math.abs(b.delta ?? 0) - Math.abs(a.delta ?? 0);

function citeCarte(r: CardRow): string {
  return `${r.name}, ${pct(r.winrate ?? 0)} de victoires sur ${nb(r.played)} ${pluriel(r.played, 'pose', 'poses')}`;
}

function carteEcrite(r: CardRow, extra = ''): ShowCard {
  return silently(() => ({
    id: r.card_id,
    name: r.name,
    note: `tier ${r.tier} · ${pct(r.winrate ?? 0)} · ${ecart(r.delta ?? 0)} · ${nb(r.played)} poses${extra}`,
  }));
}

/** Segment vide : on le DIT. Un chapitre sauté en silence se lit comme un bug. */
function vide(id: string, title: string, phrase: string): ShowSegment {
  return { id, title, sentences: [phrase], cards: [] };
}

export interface ShowInput {
  date: string;
  detector: DetectorResult;
  aggregates: Aggregates;
  ab: AbResult[];
  catalogCards: number;
}

export function buildShow(input: ShowInput): Show {
  recorded = [];
  const { date, detector, aggregates, ab } = input;
  const cat = classify(detector);
  const segments: ShowSegment[] = [];

  // 1 ─ Générique et état de santé
  const mesurees = detector.rows.filter(r => r.played > 0).length;
  segments.push({
    id: 'sante',
    title: 'État du jeu',
    sentences: [
      `Bulletin d’équilibrage du ${dateParlee(date)}.`,
      `Ce matin, ${nb(detector.games)} parties ont été simulées contre le catalogue de production, qui compte ${nb(input.catalogCards)} cartes.`,
      `${nb(mesurees)} cartes ont effectivement été posées sur le terrain ; ${nb(detector.neverPlayed.length)} ne l’ont jamais été.`,
      `La ligne de base du run s’établit à ${pct(detector.baseline)} de victoires. C’est la référence : une carte n’est forte ou faible que par rapport à elle, jamais par rapport à cinquante pour cent.`,
      `Une partie dure ${dec(detector.roundsPerGame)} tours en moyenne, et ${pct(detector.timeoutsPerGame / Math.max(1, detector.roundsPerGame), 0)} des combats se terminent au chronomètre plutôt que par un camp neutralisé.`,
    ],
    cards: [],
  });

  // 2 ─ Trop fortes
  const fortes = [...cat.tropFortes].sort(byEffect);
  if (fortes.length === 0) {
    segments.push(vide('fortes', 'Les cartes trop fortes',
      'Aucune carte ne ressort significativement au-dessus de la ligne de base ce matin. C’est rare, et c’est une bonne nouvelle.'));
  } else {
    const cites = fortes.slice(0, SPOKEN_MAX);
    const s = [
      `Passons aux cartes trop fortes. ${nb(fortes.length)} ${pluriel(fortes.length, 'carte dépasse', 'cartes dépassent')} la ligne de base d’un écart que leur échantillon soutient.`,
      `En tête : ${liste(cites.map(citeCarte))}.`,
      `${fortes[0].name} domine le classement avec ${ecart(fortes[0].delta ?? 0)} de la moyenne, et survit à ${pct(fortes[0].survivalRate ?? 0, 0)} de ses combats.`,
    ];
    const confirmee = ab.find(a => a.card_id === fortes[0].card_id && a.delta !== null && a.ci !== null && Math.abs(a.delta) > a.ci);
    if (confirmee) {
      s.push(`Le test A B le confirme : à deck témoin figé, sa seule présence vaut ${ecart(confirmee.delta ?? 0)}. L’écart mesuré par le détecteur est plus large parce qu’il inclut le deck qui la porte.`);
    } else {
      s.push('Attention : ces écarts viennent du détecteur, qui mesure la carte avec le deck autour d’elle. Le test A B, lui, isole la carte, et il rend presque toujours un écart plus modeste.');
    }
    segments.push({ id: 'fortes', title: 'Les cartes trop fortes', sentences: s, cards: fortes.map(r => carteEcrite(r)) });
  }

  // 3 ─ Trop faibles
  const faibles = [...cat.tropFaibles].sort(byEffect);
  if (faibles.length === 0) {
    segments.push(vide('faibles', 'Les cartes trop faibles',
      'Aucune carte ne décroche significativement sous la ligne de base. Rien à relever de ce côté.'));
  } else {
    const cites = faibles.slice(0, SPOKEN_MAX);
    segments.push({
      id: 'faibles',
      title: 'Les cartes trop faibles',
      sentences: [
        `À l’autre bout du classement, ${nb(faibles.length)} ${pluriel(faibles.length, 'carte reste', 'cartes restent')} sous la ligne de base.`,
        `On y trouve ${liste(cites.map(citeCarte))}.`,
        `${faibles[0].name} est la plus en retrait, à ${ecart(faibles[0].delta ?? 0)} de la moyenne.`,
      ],
      cards: faibles.map(r => carteEcrite(r)),
    });
  }

  // 4 ─ Sous-estimées
  const sous = [...cat.sousEstimees].sort(byEffect);
  if (sous.length === 0) {
    segments.push(vide('sous-estimees', 'Les sous-estimées',
      'Pas de sous-estimée aujourd’hui : les cartes qui gagnent sont aussi celles qui se posent.'));
  } else {
    segments.push({
      id: 'sous-estimees',
      title: 'Les sous-estimées',
      sentences: [
        `Voici la catégorie la plus intéressante pour un joueur : les sous-estimées. ${nb(sous.length)} ${pluriel(sous.length, 'carte gagne', 'cartes gagnent')} nettement quand elles arrivent sur le terrain, mais elles y arrivent rarement.`,
        `${liste(sous.slice(0, SPOKEN_MAX).map(r => `${r.name}, posée dans seulement ${pct(r.playRate ?? 0, 0)} des parties où elle était en deck, pour ${pct(r.winrate ?? 0)} de victoires`))}.`,
        'Elles ne demandent pas une hausse de statistiques, mais un coût d’invocation plus accessible : ce qui leur manque, c’est d’être jouables plus souvent.',
      ],
      cards: sous.map(r => carteEcrite(r, ` · pose ${pct(r.playRate ?? 0, 0)}`)),
    });
  }

  // 5 ─ Pièges
  const pieges = [...cat.pieges].sort(byEffect);
  if (pieges.length === 0) {
    segments.push(vide('pieges', 'Les pièges',
      'Aucun piège relevé : les cartes qui se posent le plus souvent ne font pas perdre.'));
  } else {
    segments.push({
      id: 'pieges',
      title: 'Les pièges',
      sentences: [
        `Le revers de la médaille, maintenant : les pièges. ${nb(pieges.length)} ${pluriel(pieges.length, 'carte sort', 'cartes sortent')} très souvent et ${pluriel(pieges.length, 'accompagne', 'accompagnent')} pourtant une défaite plus souvent que la moyenne.`,
        `${liste(pieges.slice(0, SPOKEN_MAX).map(r => `${r.name}, posée dans ${pct(r.playRate ?? 0, 0)} des parties, pour ${pct(r.winrate ?? 0)} de victoires`))}.`,
        'Ce sont les plus coûteuses en expérience de jeu : faciles à poser, et rarement le bon choix.',
      ],
      cards: pieges.map(r => carteEcrite(r, ` · pose ${pct(r.playRate ?? 0, 0)}`)),
    });
  }

  // 6 ─ Injouables
  const inj = [...cat.injouables].sort((a, b) => b.inDeck - a.inDeck);
  if (inj.length === 0) {
    segments.push(vide('injouables', 'Les injouables',
      'Toutes les cartes retenues en deck ont fini par être invoquées au moins une fois.'));
  } else {
    const jamaisRetenues = detector.neverPlayed.length - inj.length;
    segments.push({
      id: 'injouables',
      title: 'Les injouables',
      sentences: [
        `Passons aux injouables. ${nb(inj.length)} ${pluriel(inj.length, 'carte est entrée', 'cartes sont entrées')} dans un deck sans jamais quitter la main.`,
        `La plus frappante est ${inj[0].name}, présente dans ${nb(inj[0].inDeck)} decks et invoquée zéro fois.`,
        'Ce n’est pas un problème de puissance mais de constructibilité : leurs matériaux ne se réunissent jamais en jeu, et aucun chiffre d’équilibrage ne les concerne tant que ce n’est pas réglé.',
        `${nb(jamaisRetenues)} autres cartes n’ont même jamais été retenues dans un deck, faute de matériaux couverts.`,
      ],
      cards: inj.map(c => silently(() => ({ id: c.card_id, name: c.name, note: `tier ${c.tier} · ${summonCostLabel(c.summon_cost)} · ${nb(c.inDeck)} fois en deck, jamais invoquée` }))),
    });
  }

  // 7 ─ Bien gérées
  const bien = cat.bienGerees;
  segments.push(bien.length === 0
    ? vide('bien-gerees', 'Les cartes bien réglées',
      'Aucune carte n’a encore assez de poses pour qu’on puisse la déclarer bien réglée. Il faudra un run plus large.')
    : {
      id: 'bien-gerees',
      title: 'Les cartes bien réglées',
      sentences: [
        `Terminons le tour des cartes par une bonne nouvelle : ${nb(bien.length)} ${pluriel(bien.length, 'carte est', 'cartes sont')} abondamment ${pluriel(bien.length, 'mesurée', 'mesurées')} et ${pluriel(bien.length, 'reste', 'restent')} indiscernables de la ligne de base.`,
        'Ce sont celles auxquelles il ne faut surtout pas toucher : leur écart est plus petit que l’incertitude de la mesure, ce qui est exactement la définition d’une carte à sa place.',
        ...(bien.length > BIEN_GEREES_ECRITES ? [`La liste à l’écran en montre les ${nb(BIEN_GEREES_ECRITES)} premières.`] : []),
      ],
      cards: bien.slice(0, BIEN_GEREES_ECRITES).map(r => carteEcrite(r)),
    });

  // 8 ─ Attributs
  const attrs = aggregates.attributes;
  if (attrs.length < 2) {
    segments.push(vide('attributs', 'Les archétypes',
      'Trop peu d’attributs atteignent le seuil de poses pour être comparés ce matin.'));
  } else {
    const haut = attrs.slice(0, 3);
    const bas = attrs.slice(-2).reverse();
    segments.push({
      id: 'attributs',
      title: 'Les archétypes',
      sentences: [
        `Voyons maintenant les archétypes. ${nb(attrs.length)} attributs réunissent assez de poses pour être comparés.`,
        `En tête : ${liste(haut.map(a => `${a.label}, à ${pct(a.winrate)} sur ${nb(a.played)} poses`))}.`,
        `En bas de tableau : ${liste(bas.map(a => `${a.label}, à ${pct(a.winrate)}`))}.`,
        'Deux réserves, et elles comptent. Une carte porte jusqu’à quatre attributs, donc le même résultat est compté dans plusieurs familles.',
        'Et surtout, ces chiffres sont corrélationnels : un archétype remonte parce qu’il contient une carte forte, pas nécessairement parce que son thème est fort.',
      ],
      cards: attrs.map(a => silently(() => ({ id: a.key, name: a.label, note: `${pct(a.winrate)} · ${ecart(a.delta)} · ${nb(a.cards)} cartes · ${nb(a.played)} poses` }))),
    });
  }

  // 9 ─ Façons de jouer
  const styleCards = (rows: FamilyRow[]) => rows.map(r => silently(() => ({ id: r.key, name: r.label, note: `${pct(r.winrate)} · ${ecart(r.delta)} · ${nb(r.played)} poses` })));
  const st = aggregates.playstyles;
  const voies = aggregates.summonTypes;
  const phrases: string[] = ['Un mot, enfin, sur les façons de jouer.'];
  const melee = st.find(s => s.key === 'melee');
  const ranged = st.find(s => s.key === 'ranged');
  if (melee && ranged) {
    const gagnant = melee.winrate >= ranged.winrate ? melee : ranged;
    const perdant = gagnant === melee ? ranged : melee;
    phrases.push(`${cap(gagnant.label)} l’emportent, à ${pct(gagnant.winrate)} contre ${pct(perdant.winrate)}.`);
  }
  const power = st.find(s => s.key === 'power');
  const nopower = st.find(s => s.key === 'nopower');
  if (power && nopower) {
    phrases.push(`Les cartes à pouvoir tournent à ${pct(power.winrate)}, celles qui n’en ont pas à ${pct(nopower.winrate)}.`);
  }
  const atk = st.find(s => s.key === 'atk');
  const tank = st.find(s => s.key === 'tank');
  if (atk && tank) {
    phrases.push(`Entre l’attaque et la résistance, ${atk.winrate >= tank.winrate ? `l’attaque prend l’avantage, ${pct(atk.winrate)} contre ${pct(tank.winrate)}` : `c’est la résistance qui prend l’avantage, ${pct(tank.winrate)} contre ${pct(atk.winrate)}`}.`);
  }
  if (voies.length >= 2) {
    // Le libellé porte déjà le mot « invocation » : « la voie invocation à
    // deux matériels » se dirait mal.
    phrases.push(`Du côté des coûts d’invocation, l’${voies[0].label} mène à ${pct(voies[0].winrate)}, et l’${voies[voies.length - 1].label} ferme la marche à ${pct(voies[voies.length - 1].winrate)}.`);
  }
  segments.push({ id: 'styles', title: 'Les façons de jouer', sentences: phrases, cards: [...styleCards(st), ...styleCards(voies)] });

  // 10 ─ Le mot de la fin
  segments.push({
    id: 'fin',
    title: 'Ce qu’il faut en retenir',
    sentences: [
      'Pour finir, le rappel qui vaut pour tout ce bulletin.',
      'Les écarts annoncés viennent d’une simulation où les deux camps sont pilotés par des automates, sans magies ni Phase Shopping, et où l’adversaire reçoit un handicap fixe pour ramener la ligne de base à parité.',
      'Ils comparent donc les cartes entre elles dans des conditions identiques. Ils ne disent pas ce que vaudrait la carte entre les mains d’un joueur humain.',
      'Une carte n’est à retoucher que si le détecteur la signale et que le test A B le confirme. Bonne journée, et bon équilibrage.',
    ],
    cards: [],
  });

  const words = segments.reduce((s, seg) => s + seg.sentences.join(' ').split(/\s+/).filter(Boolean).length, 0);
  return {
    title: `Bulletin d’équilibrage du ${dateParlee(date)}`,
    segments,
    words,
    estimatedSeconds: Math.round((words / WORDS_PER_MINUTE) * 60),
  };
}
