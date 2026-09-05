/* eslint-disable @typescript-eslint/no-explicit-any */
/// <reference types="node" />
// Le langage de requête (`card-query.mjs`, racine) est PARTAGÉ entre
// `admin.html` et le DeckBuilder. Il n'a donc aucun écran à lui, et c'est ce
// fichier qui en tient lieu : la grammaire, l'évaluation, la chirurgie des
// facettes et l'autocomplétion s'y vérifient sans DOM.
//
// ⚠️ La moitié basse le fait tourner sur le CATALOGUE LIVRÉ, décoré comme le
// serveur le décore (`_tiers`). Les cas écrits à la main prouvent la grammaire ;
// seul le vrai catalogue prouve que le schéma des cartes lit les bons champs.
import { describe, it, expect } from 'vitest';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import * as Q from '../../../card-query.mjs';
import { tierIndex, resolveTiers } from '../logic/Tiers.js';
import type { AttributeDef, Card } from '../logic/types.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const INITIAL = path.join(ROOT, 'initial-data');
const load = <T>(f: string): T[] => JSON.parse(fs.readFileSync(path.join(INITIAL, f), 'utf8'));

const ATTR_NAME: Record<string, string> = {};
for (const a of load<AttributeDef>('attributes.json')) ATTR_NAME[a.id] = a.name;

const summonCost = (c: any) => Math.min(...[(c.summon_conditions ?? []).length
  ? (c.summon_conditions as any[]).map(x => Number(x?.materials) || 0)
  : [0]].flat());

const schema = Q.cardQuerySchema({
  summonCost,
  attributeName: (id: string) => ATTR_NAME[id] ?? id,
});

/** Une fiche minimale : seuls les champs que le cas interroge sont posés. */
function card(id: string, over: Record<string, any> = {}): any {
  return {
    id, name: id, _tiers: [1], attributes: [], power: {}, stats: { atk: 10, hp: 100 },
    summon_conditions: [], _has_illustration: false, ...over,
  };
}

const ids = (list: any[], q: string) => {
  const r = Q.filterByQuery(list, q, schema);
  expect(r.error, `requête refusée : ${r.error}`).toBeNull();
  return r.items.map((c: any) => c.id);
};

const SAMPLE = [
  card('CQ_A', { name: 'Magicien sombre', _tiers: [3], stats: { atk: 25, hp: 200 }, attributes: ['ARCH_002'], power: { id: 'POWER_HEAL' }, _has_illustration: true, set: 'CORE', summon_conditions: [{ materials: 2, requires: ['CORE_005'] }] }),
  card('CQ_B', { name: "Épée d'Argent", _tiers: [1, 4], stats: { atk: 70, hp: 100 }, set: 'CORE' }),
  card('CQ_C', { name: 'Dragon Blanc', _tiers: [5], stats: { atk: 90, hp: 300 }, attributes: ['ARCH_002'], _has_illustration: true, set: 'YGX', summon_conditions: [{ materials: 3, requires: ['CORE_001', 'CORE_005'] }] }),
];

describe('grammaire', () => {
  it('une requête vide laisse tout passer', () => {
    expect(ids(SAMPLE, '')).toEqual(['CQ_A', 'CQ_B', 'CQ_C']);
    expect(ids(SAMPLE, '   ')).toEqual(['CQ_A', 'CQ_B', 'CQ_C']);
  });

  it('un mot nu cherche dans le nom et l\'id', () => {
    expect(ids(SAMPLE, 'dragon')).toEqual(['CQ_C']);
    expect(ids(SAMPLE, 'cq_c')).toEqual(['CQ_C']);   // par l'id, sans casse
  });

  // ⚠️ RÉGRESSION. Le pliage sans accent est la moitié de l'affaire ; l'autre
  // est que l'APOSTROPHE reste une lettre. Traitée comme un guillemet (le
  // réflexe quand on écrit un tokeniseur), « Épée d'Argent » se coupait en
  // deux et la recherche ne rendait plus rien sur la moitié du catalogue.
  it('ignore les accents et respecte les apostrophes', () => {
    expect(ids(SAMPLE, 'epee')).toEqual(['CQ_B']);
    expect(ids(SAMPLE, "d'argent")).toEqual(['CQ_B']);
    expect(ids(SAMPLE, "Épée d'Argent")).toEqual(['CQ_B']);
    // ⚠️ Le cas qui DISCRIMINE, et le seul. Une apostrophe traitée comme un
    // guillemet ouvre une chaîne que rien ne referme : tout ce qui suit, espaces
    // compris, est avalé dans une recherche de texte, et le terme d'après cesse
    // d'exister. Les trois cas ci-dessus, eux, passent avec le bug — deux mots
    // cherchés séparément retrouvent la même carte.
    expect(ids(SAMPLE, "d'argent tier:1")).toEqual(['CQ_B']);
    expect(ids(SAMPLE, "d'argent tier:3")).toEqual([]);
  });

  it('l\'ET est implicite, le OU explicite, le NON prend les deux formes', () => {
    expect(ids(SAMPLE, 'tier:3 atk>20')).toEqual(['CQ_A']);
    expect(ids(SAMPLE, 'tier:3 ET atk>20')).toEqual(['CQ_A']);
    expect(ids(SAMPLE, 'tier:4 OU tier:5')).toEqual(['CQ_B', 'CQ_C']);
    expect(ids(SAMPLE, 'NON tier:3')).toEqual(['CQ_B', 'CQ_C']);
    expect(ids(SAMPLE, '-dragon')).toEqual(['CQ_A', 'CQ_B']);
  });

  it('les parenthèses priment sur la précédence ET > OU', () => {
    expect(ids(SAMPLE, '(tier:3 OU tier:5) ET illustration')).toEqual(['CQ_A', 'CQ_C']);
    expect(ids(SAMPLE, 'tier:3 OU tier:5 ET pv>250')).toEqual(['CQ_A', 'CQ_C']);
  });

  it('une liste se lit « l\'un de », y compris niée', () => {
    expect(ids(SAMPLE, 'tier:3,5')).toEqual(['CQ_A', 'CQ_C']);
    // ⚠️ Nier un « ou » donne un « et » : `tier!=3,5` = « ni 3 ni 5 ».
    expect(ids(SAMPLE, 'tier!=3,5')).toEqual(['CQ_B']);
  });

  it('les comparateurs numériques comparent des nombres', () => {
    expect(ids(SAMPLE, 'atk>=70')).toEqual(['CQ_B', 'CQ_C']);
    expect(ids(SAMPLE, 'atk>=70 ET pv<150')).toEqual(['CQ_B']);
    expect(ids(SAMPLE, 'pv<=200')).toEqual(['CQ_A', 'CQ_B']);
  });

  it('un champ multivalué passe dès qu\'UNE valeur satisfait', () => {
    expect(ids(SAMPLE, 'tier:1')).toEqual(['CQ_B']);   // B porte [1, 4]
    expect(ids(SAMPLE, 'tier:4')).toEqual(['CQ_B']);
  });

  it('un enum s\'interroge par l\'id COMME par le nom lisible', () => {
    expect(ids(SAMPLE, 'attribut:ARCH_002')).toEqual(['CQ_A', 'CQ_C']);
    expect(ids(SAMPLE, `attribut:${Q.fold(ATTR_NAME.ARCH_002)}`)).toEqual(['CQ_A', 'CQ_C']);
  });

  it('`vide` interroge l\'absence', () => {
    expect(ids(SAMPLE, 'pouvoir:vide')).toEqual(['CQ_B', 'CQ_C']);
    expect(ids(SAMPLE, 'pouvoir!=vide')).toEqual(['CQ_A']);
  });

  // ⚠️ RÉGRESSION. `-illustration` est la négation la plus évidente du lot, et
  // c'était celle qui ne marchait pas : un mot nu cherchant dans les NOMS, elle
  // demandait « les cartes dont le nom ne contient pas “illustration” », donc
  // tout le catalogue. Un mot nu qui EST un champ booléen se lit comme ce
  // booléen.
  it('un champ booléen s\'écrit en un mot', () => {
    expect(ids(SAMPLE, 'illustration')).toEqual(['CQ_A', 'CQ_C']);
    expect(ids(SAMPLE, '-illustration')).toEqual(['CQ_B']);
    expect(ids(SAMPLE, 'illustration:non')).toEqual(['CQ_B']);
    expect(ids(SAMPLE, 'illustration:oui')).toEqual(['CQ_A', 'CQ_C']);
  });

  it('les guillemets rendent un mot à sa recherche textuelle', () => {
    expect(ids(SAMPLE, 'nom~"dragon blanc"')).toEqual(['CQ_C']);
    // `"tier"` cherche le mot, il ne désigne plus le champ.
    expect(ids(SAMPLE, '"tier"')).toEqual([]);
  });

  it('lit les champs dérivés que personne n\'exposait', () => {
    expect(ids(SAMPLE, 'materiau:CORE_005')).toEqual(['CQ_A', 'CQ_C']);
    expect(ids(SAMPLE, 'pack:YGX')).toEqual(['CQ_C']);
    expect(ids(SAMPLE, 'cout>2')).toEqual(['CQ_C']);
    expect(ids(SAMPLE, 'recettes:0')).toEqual(['CQ_B']);
  });
});

// ⚠️ Une requête à moitié tapée est l'état NORMAL d'une barre de recherche.
// Vider l'écran ou faire clignoter un message à chaque frappe serait pire que
// pas de langage du tout.
describe('tolérance à la frappe en cours', () => {
  for (const partial of ['tier:', 'tier:3 ET', 'tier:3 OU', 'atk>', 'NON', '-']) {
    it(`« ${partial} » ne refuse pas la requête`, () => {
      expect(Q.filterByQuery(SAMPLE, partial, schema).error).toBeNull();
    });
  }

  it('un champ:  se lit « ce champ n\'est pas vide »', () => {
    expect(ids(SAMPLE, 'pouvoir:')).toEqual(['CQ_A']);
    expect(ids(SAMPLE, 'attribut:')).toEqual(['CQ_A', 'CQ_C']);
  });

  it('une faute franche laisse la liste ENTIÈRE et se nomme', () => {
    const r = Q.filterByQuery(SAMPLE, 'zorglub:3', schema);
    expect(r.items).toHaveLength(SAMPLE.length);
    expect(r.error).toContain('zorglub');
    expect(r.error).toContain('tier');       // la liste des champs valides
    expect(Q.filterByQuery(SAMPLE, '(tier:3', schema).error).toBeTruthy();
  });
});

// Les chips et les <select> n'ont pas d'état à eux : ils ÉCRIVENT dans la
// requête, qui reste la seule source de vérité. C'est ce qui interdit
// structurellement qu'un chip allumé contredise la barre.
describe('facettes', () => {
  const t = (src: string, v: number) => Q.toggleFacet(src, schema, 'tier', v);

  it('un chip pose, cumule, retire, puis efface son terme', () => {
    const a = t('', 3);
    expect(a).toBe('tier:3');
    const b = t(a, 4);
    expect(b).toBe('tier:3,4');
    expect(Q.hasFacet(b, schema, 'tier', 3)).toBe(true);
    expect(Q.hasFacet(b, schema, 'tier', 2)).toBe(false);
    expect(t(b, 3)).toBe('tier:4');
    expect(t(t(b, 3), 4)).toBe('');
  });

  it('n\'abîme pas le reste de la requête', () => {
    expect(t('dragon atk>50', 3)).toBe('dragon atk>50 tier:3');
    expect(t('dragon atk>50 tier:3', 3)).toBe('dragon atk>50');
    expect(Q.setFacet('tier:3 pack:YGX atk>50', schema, 'pack', '')).toBe('tier:3 atk>50');
  });

  // ⚠️ RÉGRESSION. `a OU b` + un chip donnerait `a OU b ET tier:3`, qui ne
  // filtre QUE la branche droite : le chip aurait l'air posé et la moitié de la
  // liste lui échapperait. Un OU de premier niveau se parenthèse d'abord.
  it('parenthèse une requête à OU avant de lui ajouter un ET', () => {
    expect(t('a OU b', 3)).toBe('(a OU b) tier:3');
    expect(ids(SAMPLE, 'tier:3 OU tier:5')).toEqual(['CQ_A', 'CQ_C']);
    // Sans les parenthèses, `tier:3 OU tier:5 illustration:non` se lit
    // `tier:3 OU (tier:5 ET illustration:non)` : la branche gauche passe
    // entière, et le chip aurait l'air posé sur une liste qu'il ne filtre pas.
    expect(Q.toggleFacet('tier:3 OU tier:5', schema, 'illustration', 'non'))
      .toBe('(tier:3 OU tier:5) illustration:non');
    expect(ids(SAMPLE, 'tier:3 OU tier:5 illustration:non')).toEqual(['CQ_A']);
    expect(ids(SAMPLE, '(tier:3 OU tier:5) illustration:non')).toEqual([]);
  });

  // ⚠️ RÉGRESSION. L'ET étant implicite, `tier:3 atk>50` ne porte aucun
  // connecteur écrit : sans machine à états, le découpage rendait UN terme géant
  // et le chip ne retrouvait plus le sien — il s'allumait sans jamais s'éteindre.
  it('découpe les termes voisins que rien ne sépare', () => {
    expect(Q.topLevelTerms('tier:3 atk>50 (a OU b) dragon').map((x: any) => x.text))
      .toEqual(['tier:3', 'atk>50', '(a OU b)', 'dragon']);
  });
});

// Le tri se pose sur les MÊMES champs que le filtre : un second inventaire de
// critères aurait dérivé du premier au premier champ ajouté.
describe('tri', () => {
  const order = (key: string, dir: 'asc' | 'desc' = 'asc') =>
    Q.sortItems(SAMPLE, schema, { key, dir }).map((c: any) => c.id);

  it('classe dans les deux sens', () => {
    expect(order('atk')).toEqual(['CQ_A', 'CQ_B', 'CQ_C']);          // 25 · 70 · 90
    expect(order('atk', 'desc')).toEqual(['CQ_C', 'CQ_B', 'CQ_A']);
    expect(order('nom')).toEqual(['CQ_C', 'CQ_B', 'CQ_A']);          // dragon · épée · magicien
  });

  it('ne réordonne rien sans critère, ni sur un champ inconnu', () => {
    expect(Q.sortItems(SAMPLE, schema, {}).map((c: any) => c.id)).toEqual(['CQ_A', 'CQ_B', 'CQ_C']);
    expect(order('zorglub')).toEqual(['CQ_A', 'CQ_B', 'CQ_C']);
  });

  it('rend une COPIE — la liste d\'entrée n\'est jamais réordonnée sur place', () => {
    const before = SAMPLE.map(c => c.id);
    Q.sortItems(SAMPLE, schema, { key: 'atk', dir: 'desc' });
    expect(SAMPLE.map(c => c.id)).toEqual(before);
  });

  // ⚠️ RÉGRESSION. Un champ multivalué classé sur un extrême FIXE (« le premier
  // de la liste ») met la carte au même rang dans les deux sens — ce qui n'est
  // le bon rang dans aucun. CQ_B porte les tiers 1 et 4 : elle doit ouvrir le
  // classement croissant (par son 1) ET le fermer en décroissant (par son 4).
  it('classe un champ multivalué sur son extrême DANS LE SENS DU TRI', () => {
    expect(order('tier')).toEqual(['CQ_B', 'CQ_A', 'CQ_C']);          // min : 1 · 3 · 5
    expect(order('tier', 'desc')).toEqual(['CQ_C', 'CQ_B', 'CQ_A']);  // max : 5 · 4 · 3
  });

  // ⚠️ Une carte sans pouvoir n'est ni « avant » ni « après » les autres quand
  // on classe par pouvoir : elle est hors sujet. La queue est la seule place
  // qui ne mente pas — en croissant COMME en décroissant.
  it('renvoie les valeurs absentes en queue dans les DEUX sens', () => {
    expect(order('pouvoir')[0]).toBe('CQ_A');                          // la seule qui en a un
    expect(order('pouvoir', 'desc')[0]).toBe('CQ_A');
    expect(order('pouvoir').slice(1).sort()).toEqual(['CQ_B', 'CQ_C']);
  });

  it('refuse les listes ouvertes, qui n\'ont pas d\'ordre à elles', () => {
    const keys = Q.sortableFields(schema).map((f: any) => f.key);
    expect(keys).toContain('tier');
    expect(keys).toContain('atk');
    for (const open of ['attribut', 'materiau', 'lignee']) expect(keys).not.toContain(open);
    // Demandé quand même, il ne réordonne pas plutôt que de trier sur rien.
    expect(order('attribut')).toEqual(['CQ_A', 'CQ_B', 'CQ_C']);
  });

  it('départage par id — deux valeurs égales gardent un ordre stable', () => {
    const tied = [card('Z', { stats: { atk: 5, hp: 1 } }), card('A', { stats: { atk: 5, hp: 1 } })];
    expect(Q.sortItems(tied, schema, { key: 'atk' }).map((c: any) => c.id)).toEqual(['A', 'Z']);
    expect(Q.sortItems(tied, schema, { key: 'atk', dir: 'desc' }).map((c: any) => c.id)).toEqual(['A', 'Z']);
  });
});

describe('autocomplétion', () => {
  it('propose un champ sur un mot nu', () => {
    const s = Q.suggest('tie', 3, schema)!;
    expect(s.kind).toBe('field');
    expect(s.items.map((i: any) => i.value)).toContain('tier:');
    expect(Q.applySuggestion('tie', s, 'tier:')).toEqual({ text: 'tier:', caret: 5 });
  });

  it('propose des valeurs après le deux-points', () => {
    const s = Q.suggest('illustration:', 13, schema)!;
    expect(s.kind).toBe('value');
    expect(s.items.map((i: any) => i.value)).toEqual(['oui', 'non']);
  });

  it('ne complète que le dernier fragment d\'une liste', () => {
    const s = Q.suggest('illustration:oui,n', 18, schema)!;
    expect(s.kind).toBe('value');
    expect(Q.applySuggestion('illustration:oui,n', s, 'non').text).toBe('illustration:oui,non');
  });

  // ⚠️ RÉGRESSION (vue au navigateur, invisible en test de fonction). La liste
  // se pose PAR-DESSUS les chips de tier, à 4 px sous la barre : tant qu'elle
  // reste ouverte sur une valeur déjà complète, les chips sont intapables. Sur
  // un téléphone, la seule commande visible du filtre devenait inatteignable.
  it('se ferme quand la valeur tapée est déjà complète', () => {
    const withOptions = Q.cardQuerySchema({
      summonCost,
      tierOptions: () => [1, 2, 3, 4, 5].map(t => ({ value: String(t), label: String(t) })),
    });
    expect(Q.suggest('tier:', 5, withOptions)!.items).toHaveLength(5);
    expect(Q.suggest('tier:4', 6, withOptions)).toBeNull();
    // Un fragment encore ambigu garde la liste ouverte.
    expect(Q.suggest('tier:', 5, withOptions)!.items.length).toBeGreaterThan(1);
  });

  // ⚠️ Sans les mots-clés, la liste n'enseignait que la moitié du langage : on
  // découvrait `tier:` en tapant, mais rien ne disait qu'un `OU` existait — il
  // fallait avoir ouvert l'aide. Un langage dont la moitié ne se découvre pas
  // là où on l'écrit n'est appris par personne.
  it('propose les connecteurs derrière un terme achevé', () => {
    const labels = (src: string) => (Q.suggest(src, src.length, schema)?.items ?? []).map((i: any) => i.label);
    expect(labels('tier:3 ').slice(0, 3)).toEqual(['ET', 'OU', 'NON']);
    expect(labels('dragon ').slice(0, 3)).toEqual(['ET', 'OU', 'NON']);
    // Filtrés par ce qui est déjà tapé.
    expect(labels('tier:3 O')).toContain('OU');
    expect(labels('tier:3 O')).not.toContain('ET');
  });

  // ⚠️ `ET` / `OU` n'ont de sens que derrière quelque chose à relier. En tête de
  // requête, après une parenthèse ouvrante ou après un connecteur, les offrir
  // produirait une requête que l'analyseur devrait rattraper. `NON` est un
  // préfixe : il a sa place partout où un terme peut commencer.
  it('ne propose PAS de connecteur là où il n\'y a rien à relier', () => {
    const labels = (src: string) => (Q.suggest(src, src.length, schema)?.items ?? []).map((i: any) => i.label);
    for (const src of ['', '(', 'tier:3 ET ', 'tier:3 OU ']) {
      expect(labels(src), `« ${src} »`).not.toContain('ET');
      expect(labels(src), `« ${src} »`).not.toContain('OU');
      expect(labels(src), `« ${src} »`).toContain('NON');
    }
  });

  it('un connecteur choisi s\'insère avec son espace', () => {
    const s = Q.suggest('tier:3 ', 7, schema)!;
    expect(Q.applySuggestion('tier:3 ', s, 'OU ')).toEqual({ text: 'tier:3 OU ', caret: 10 });
    // Et la requête obtenue s'analyse (un connecteur en attente est toléré).
    expect(Q.filterByQuery(SAMPLE, 'tier:3 OU ', schema).error).toBeNull();
  });

  it('propose les valeurs déclarées par le schéma', () => {
    const withOptions = Q.cardQuerySchema({
      summonCost,
      packOptions: () => [{ value: 'CORE', label: 'CORE' }, { value: 'YGX', label: 'YGX' }],
    });
    const s = Q.suggest('pack:Y', 6, withOptions)!;
    expect(s.items.map((i: any) => i.value)).toEqual(['YGX']);
  });
});

// ⚠️ Les cas écrits à la main prouvent la grammaire ; seul le catalogue livré
// prouve que le schéma lit les bons champs. Une carte y porte des attributs
// réels, des stats réelles et des recettes réelles.
describe('sur le catalogue livré', () => {
  const INDEX = tierIndex(load<AttributeDef>('attributes.json'));
  const CARDS = load<Card>('cards.json').map(c => ({ ...c, _tiers: resolveTiers(c, INDEX) }));

  it('chaque exemple montré sous la barre s\'analyse et rend un résultat', () => {
    for (const { q } of Q.CARD_QUERY_EXAMPLES) {
      const r = Q.filterByQuery(CARDS, q, schema);
      expect(r.error, `« ${q} » : ${r.error}`).toBeNull();
      expect(r.items.length, `« ${q} » ne rend rien sur le catalogue livré`).toBeGreaterThan(0);
    }
  });

  it('chaque champ du schéma est lisible sur toutes les cartes', () => {
    for (const f of schema.fields) {
      expect(() => CARDS.forEach(c => f.get(c as any)), `champ ${f.key}`).not.toThrow();
      const r = Q.filterByQuery(CARDS, `${f.key}:`, schema);
      expect(r.error, `champ ${f.key} : ${r.error}`).toBeNull();
    }
  });

  it('rend le même verdict que le filtre qu\'il remplace', () => {
    // L'ancienne barre de l'admin : sous-chaîne sur `name` OU `id`.
    const legacy = (q: string) => CARDS.filter(c =>
      c.name.toLowerCase().includes(q) || c.id.toLowerCase().includes(q)).map(c => c.id);
    for (const q of ['dragon', 'core_0', 'magicien', 'zzz']) {
      expect(ids(CARDS, q)).toEqual(legacy(q));
    }
    // L'ancien <select> de tier, et l'ancien filtre d'illustration.
    expect(ids(CARDS, 'tier:3')).toEqual(CARDS.filter(c => c._tiers!.includes(3)).map(c => c.id));
    expect(ids(CARDS, '-illustration'))
      .toEqual(CARDS.filter(c => !(c as any)._has_illustration).map(c => c.id));
  });

  it('un tier isolé ne se confond pas avec un autre', () => {
    const t3 = new Set(ids(CARDS, 'tier:3'));
    const t4 = new Set(ids(CARDS, 'tier:4'));
    const both = ids(CARDS, 'tier:3,4');
    expect(both.length).toBe(new Set([...t3, ...t4]).size);
    expect(both.length).toBeLessThan(CARDS.length);
    expect(ids(CARDS, 'tier:3 ET tier:4')).toEqual([...t3].filter(id => t4.has(id)));
  });
});
