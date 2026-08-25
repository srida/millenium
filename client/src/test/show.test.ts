// L'émission — ce qui garantit qu'on peut CROIRE ce qu'on entend.
//
// Le script est écrit par gabarits précisément pour qu'aucun chiffre ne puisse
// être inventé. Cette promesse ne vaut que si elle est vérifiée : le premier
// test ci-dessous relève chaque nombre prononcé et le confronte au rapport.
import { describe, it, expect } from 'vitest';
import { loadCatalog } from '../sim/catalog.js';
import { buildAggregates } from '../sim/aggregate.js';
import { runDetector } from '../sim/protocol.js';
import { buildShow, classify, recordedNumbers } from '../sim/show.js';
import type { DetectorResult } from '../sim/protocol.js';

const cat = loadCatalog();

function makeShow(games = 400, seed = 'emission') {
  const detector = runDetector(cat, games, seed);
  const aggregates = buildAggregates(detector.rows, cat.cards, cat.attributes, detector.baseline);
  return {
    detector,
    aggregates,
    show: buildShow({ date: '2026-08-25', detector, aggregates, ab: [], catalogCards: cat.fingerprint.cards }),
  };
}

const phrases = (show: ReturnType<typeof buildShow>) => show.segments.flatMap(s => s.sentences);

/** Tout nombre écrit dans le script, tel quel (les formateurs produisent la
 *  même forme, virgule décimale comprise). */
function nombresDits(show: ReturnType<typeof buildShow>): string[] {
  return phrases(show).join(' ').match(/\d+(?:,\d+)?/g) ?? [];
}

describe('Émission — aucun chiffre inventé', () => {
  it('chaque nombre du script est passé par un formateur, donc par le rapport', () => {
    // ⚠️ Ce test-ci a été REFAIT. La première version comparait chaque nombre du
    // script à « tous les taux du rapport » : avec 550 cartes, l'ensemble des
    // pourcentages à une décimale est presque saturé, si bien qu'un « 87,4 % »
    // entièrement inventé passait au vert. Éprouvé — il ne prouvait rien.
    //
    // La version qui tient s'appuie sur le fait que TOUT nombre légitime sort
    // d'un des formateurs de `show.ts`, qui enregistrent ce qu'ils produisent.
    // Un chiffre écrit en dur dans un gabarit n'y figure pas.
    const { show } = makeShow();
    const produits = new Set(recordedNumbers());
    const inconnus = nombresDits(show).filter(t => !produits.has(t));
    expect(inconnus, `nombres écrits en dur, hors de toute mesure : ${inconnus.join(', ')}`).toEqual([]);
    // Et l'enregistreur n'est pas vide : sans ça le test serait vacant.
    expect(produits.size).toBeGreaterThan(20);
  });

  it('chaque carte citée existe dans le rapport', () => {
    const { detector, show } = makeShow();
    const connus = new Set([
      ...detector.rows.map(r => r.name),
      ...detector.neverPlayed.map(c => c.name),
    ]);
    for (const seg of show.segments) {
      if (seg.id === 'attributs' || seg.id === 'styles') continue; // familles, pas des cartes
      for (const c of seg.cards) {
        expect(connus.has(c.name), `${c.name} n'est pas dans le rapport`).toBe(true);
      }
    }
  });
});

describe('Émission — les catégories', () => {
  it('trop forte et trop faible s’excluent', () => {
    const { detector } = makeShow();
    const c = classify(detector);
    const fortes = new Set(c.tropFortes.map(r => r.card_id));
    expect(c.tropFaibles.filter(r => fortes.has(r.card_id))).toEqual([]);
  });

  it('sous-estimée et piège s’excluent, et exigent la significativité', () => {
    // ⚠️ C'est LA correction qui compte : sans le filtre de significativité, le
    // segment citait « posée dans 100 % des parties, pour 0,0 % de victoires »
    // sur une carte vue UNE fois — le bruit exact que le module rejette partout
    // ailleurs, dans la seule partie du rapport qu'on écoute.
    const { detector } = makeShow(600);
    const c = classify(detector);
    const sous = new Set(c.sousEstimees.map(r => r.card_id));
    expect(c.pieges.filter(r => sous.has(r.card_id))).toEqual([]);
    for (const r of [...c.sousEstimees, ...c.pieges]) {
      expect(r.significant, `${r.name} est cité sans être significatif`).toBe(true);
      expect(r.played).toBeGreaterThanOrEqual(100);
    }
  });

  it('une bien réglée a un écart plus petit que son incertitude', () => {
    const { detector } = makeShow();
    for (const r of classify(detector).bienGerees) {
      expect(Math.abs(r.delta!)).toBeLessThan(r.ci!);
    }
  });

  it('« injouable » veut dire en deck et jamais posée, pas jamais retenue', () => {
    const { detector } = makeShow();
    for (const c of classify(detector).injouables) expect(c.inDeck).toBeGreaterThan(0);
  });
});

describe('Émission — la forme', () => {
  it('rend une chronique complète et chapitrée', () => {
    const { show } = makeShow();
    expect(show.segments.length).toBeGreaterThanOrEqual(9);
    // ⚠️ Pas de plancher à 900 mots ici : la durée SUIT ce que le run a à dire.
    // Sur 400 parties peu de cartes sont significatives, plusieurs chapitres
    // tombent donc — légitimement — dans leur branche « rien à signaler », et
    // l'émission fait ~520 mots. Sur un run réel de 3 000 parties elle en fait
    // ~930, soit les 6 minutes visées. Le plancher ne garde que l'ossature.
    expect(show.words).toBeGreaterThan(350);
    expect(show.words).toBeLessThan(1400);
    for (const seg of show.segments) {
      expect(seg.title.length).toBeGreaterThan(0);
      expect(seg.sentences.length).toBeGreaterThan(0);
      for (const p of seg.sentences) expect(p.trim().length).toBeGreaterThan(0);
    }
  });

  it('s’allonge quand le run a plus à dire', () => {
    // C'est l'invariant utile, là où une fourchette fixe n'en est pas un : un run
    // qui trouve plus de cartes significatives produit une émission plus longue.
    const petit = makeShow(300, 'petit');
    const grand = makeShow(1500, 'grand');
    expect(grand.detector.rows.filter(r => r.significant).length)
      .toBeGreaterThan(petit.detector.rows.filter(r => r.significant).length);
    expect(grand.show.words).toBeGreaterThan(petit.show.words);
  });

  it('n’emploie aucun symbole que les voix rendent mal', () => {
    // Δ, ±, →, « +12pt » et « A/B » se prononcent de façon imprévisible d'une
    // voix à l'autre. Le script les évite tous par construction.
    const txt = phrases(makeShow().show).join(' ');
    for (const sym of ['Δ', '±', '→', '/']) {
      expect(txt.includes(sym), `le script contient « ${sym} »`).toBe(false);
    }
    expect(/\d(pt|%\S)/.test(txt)).toBe(false);
  });

  it('annonce les segments vides au lieu de les sauter', () => {
    // Rapport dégénéré : aucune carte mesurée, aucun agrégat.
    const vide: DetectorResult = {
      rows: [], games: 0, baseline: 0.5, drawRate: 0,
      timeoutsPerGame: 0, roundsPerGame: 5, neverPlayed: [],
    };
    const show = buildShow({
      date: '2026-01-01', detector: vide,
      aggregates: { attributes: [], summonTypes: [], tiers: [], playstyles: [], caveats: [] },
      ab: [], catalogCards: 0,
    });
    expect(show.segments.length).toBeGreaterThanOrEqual(9);
    for (const seg of show.segments) expect(seg.sentences.length).toBeGreaterThan(0);
  });

  it('dit la date, jamais sa forme ISO', () => {
    const { show } = makeShow();
    expect(show.title).toContain('25 août 2026');
    expect(phrases(show).join(' ')).not.toContain('2026-08-25');
  });
});
