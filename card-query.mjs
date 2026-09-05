// ============================================================================
// LE LANGAGE DE REQUÊTE DU PROJET — et son seul moteur.
// ============================================================================
//
// Il y avait deux familles de filtres, et aucune ne savait faire ce que l'autre
// faisait. L'admin posait une recherche par sous-chaîne sur `name` + `id`, plus
// sept `<select>` qui ne se combinaient qu'en ET implicite ; le DeckBuilder
// posait la même recherche plus des chips de tier et de coût. Aucun des deux ne
// savait dire « ATK ≥ 50 », « Tier 4 OU Tier 5 », « sans illustration et sans
// pouvoir », ni interroger un champ qui n'avait pas son `<select>`.
//
// Ce module remplace les deux par UNE grammaire, à la façon d'un JQL :
//
//     dragon                       texte libre (nom, id)
//     tier:3 atk>=50               ET implicite
//     tier:4 OU tier:5             OU explicite
//     -illustration                NON (`-`, `NON`, `NOT`)
//     attribut:dragon ET (pv>200 OU bouclier)
//     tier:3,4                     liste = « l'un de »
//     nom~"magicien sombre"        sous-chaîne, guillemets pour les espaces
//     pouvoir:vide                 champ vide / absent
//
// ⚠️ FICHIER PARTAGÉ, et c'est sa raison d'être. `admin.html` le charge par un
// `import()` dynamique (`/admin/card-query.js`, servi par app.js) et le client
// l'importe dans son bundle. Écrire le moteur deux fois aurait donné deux
// grammaires qui divergent au premier ajout de champ — exactement ce que
// CLAUDE.md interdit (« une règle recopiée à deux endroits est une règle qu'on
// corrige à un seul »).
//
// ⚠️ PUR, SANS AUCUN IMPORT — ni `data/`, ni DOM, ni catalogue. Il ne sait pas
// ce qu'est une carte : c'est un SCHÉMA (`{ fields, text }`) qui lui dit quels
// champs existent et comment les lire. `admin.html` en décrit onze (un par
// onglet), le client réutilise celui des cartes.
//
// ⚠️ ESM (`.mjs`) et non `.js` : à la racine d'un paquet sans `"type": "module"`,
// un `.js` est du CommonJS pour Node. L'extension explicite évite qu'un
// `require()` futur tombe sur un fichier qui ne peut pas en être un.

// --------------------------------------------------------------------------
// Normalisation
// --------------------------------------------------------------------------

/** Pliage pour comparer du texte : sans casse, sans accent, sans bord.
 *  ⚠️ « Épée » et « epee » doivent se trouver l'un l'autre — c'est un jeu en
 *  français, personne ne tapera les accents dans une barre de recherche. */
export function fold(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

/** Les valeurs qui désignent « ce champ est vide ». */
const EMPTY_WORDS = new Set(['vide', 'aucun', 'aucune', 'empty', 'none', 'null']);
/** Les valeurs qui désignent le vrai et le faux d'un champ booléen. */
const TRUE_WORDS = new Set(['oui', 'true', 'yes', 'vrai', '1', 'o', 'y']);
const FALSE_WORDS = new Set(['non', 'false', 'no', 'faux', '0', 'n']);

const AND_WORDS = new Set(['et', 'and', '&&', '&']);
const OR_WORDS = new Set(['ou', 'or', '||', '|']);
const NOT_WORDS = new Set(['non', 'not']);

/** Les opérateurs, du plus long au plus court : `>=` doit être lu avant `>`. */
const OPERATORS = ['>=', '<=', '!=', '!~', ':', '=', '>', '<', '~'];

// --------------------------------------------------------------------------
// Découpage
// --------------------------------------------------------------------------

const WORD_BREAK = new Set([' ', '\t', '\n', '\r', '(', ')']);

/**
 * Découpe la source en morceaux : parenthèses, opérateurs, chaînes entre
 * guillemets, et mots nus. Chaque morceau garde sa position — c'est ce qui
 * permet à l'autocomplétion de savoir sur quoi le curseur se trouve, et à un
 * message d'erreur de pointer le bon endroit.
 */
export function chunk(src) {
  const s = String(src ?? '');
  const out = [];
  let i = 0;
  while (i < s.length) {
    const ch = s[i];
    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') { i++; continue; }
    if (ch === '(' || ch === ')') { out.push({ kind: ch, text: ch, start: i, end: i + 1 }); i++; continue; }

    const op = OPERATORS.find(o => s.startsWith(o, i));
    if (op) { out.push({ kind: 'op', text: op, start: i, end: i + op.length }); i += op.length; continue; }

    // ⚠️ SEUL le guillemet double ouvre une chaîne. L'apostrophe est une lettre
    // dans ce catalogue (« Œil d'Argent », « L'Ordre du Chaos ») : la traiter
    // comme un délimiteur avalait la moitié d'un nom sur deux.
    if (ch === '"') {
      const close = s.indexOf(ch, i + 1);
      const end = close === -1 ? s.length : close + 1;
      out.push({ kind: 'str', text: s.slice(i + 1, close === -1 ? s.length : close), start: i, end, quoted: true });
      i = end;
      continue;
    }

    let j = i;
    while (j < s.length && !WORD_BREAK.has(s[j]) && s[j] !== '"'
           && !OPERATORS.some(o => s.startsWith(o, j))) j++;
    // Un mot vide ne peut pas arriver ici (les cas ci-dessus les ont pris),
    // mais la garde évite une boucle infinie si un jour un cas manque.
    if (j === i) j++;
    out.push({ kind: 'word', text: s.slice(i, j), start: i, end: j });
    i = j;
  }
  return out;
}

// --------------------------------------------------------------------------
// Analyse
// --------------------------------------------------------------------------
//
// Précédence : NON > ET > OU. L'ET est implicite entre deux termes voisins,
// comme dans toutes les barres de recherche — `tier:3 atk>50` se lit sans que
// personne ait à écrire le connecteur.

class ParseError extends Error {
  constructor(message, index) { super(message); this.index = index; }
}

function parseChunks(chunks, schema) {
  let p = 0;
  const peek = () => chunks[p];
  const isWord = (c, set) => c && (c.kind === 'word') && !c.quoted && set.has(fold(c.text));

  // ⚠️ Un connecteur EN FIN de requête (`tier:3 ET`) n'est pas une faute mais
  // l'état de la barre entre deux frappes. Il est ignoré, comme la comparaison
  // sans valeur plus bas — sans quoi un message d'erreur clignoterait sous les
  // doigts à chaque mot tapé.
  function parseOr() {
    let left = parseAnd();
    while (isWord(peek(), OR_WORDS)) {
      p++;
      if (!peek()) break;
      left = { op: 'or', left, right: parseAnd() };
    }
    return left;
  }

  function parseAnd() {
    let left = parseNot();
    for (;;) {
      const c = peek();
      if (!c) break;
      if (c.kind === ')') break;
      if (isWord(c, OR_WORDS)) break;
      if (isWord(c, AND_WORDS)) { p++; if (!peek() || isWord(peek(), OR_WORDS)) break; }
      left = { op: 'and', left, right: parseNot() };
    }
    return left;
  }

  /** Un NON qui n'a rien à nier (`NON` seul, `-` seul) est la frappe en cours :
   *  il ne nie rien plutôt que de refuser la requête. */
  const ALWAYS = { op: 'always' };

  function parseNot() {
    const c = peek();
    if (isWord(c, NOT_WORDS)) { p++; return peek() ? { op: 'not', node: parseNot() } : ALWAYS; }
    if (c && c.kind === 'word' && !c.quoted && c.text === '-') { p++; return ALWAYS; }
    if (c && c.kind === 'word' && !c.quoted && c.text.length > 1 && c.text.startsWith('-')) {
      // `-dragon` : le tiret n'est une négation qu'en TÊTE de terme. Il reste un
      // caractère ordinaire ailleurs — les ids en portent (`MISSION_A`, pas de
      // tiret, mais un nom de pack peut).
      chunks[p] = { ...c, text: c.text.slice(1), start: c.start + 1 };
      return { op: 'not', node: parseNot() };
    }
    return parsePrimary();
  }

  function parsePrimary() {
    const c = peek();
    if (!c) throw new ParseError('Requête incomplète', chunks.length ? chunks[chunks.length - 1].end : 0);
    if (c.kind === '(') {
      p++;
      const inner = parseOr();
      if (peek() && peek().kind === ')') p++;
      else throw new ParseError('Parenthèse fermante manquante', c.start);
      return inner;
    }
    if (c.kind === ')') throw new ParseError('Parenthèse fermante orpheline', c.start);
    if (c.kind === 'op') throw new ParseError(`Opérateur « ${c.text} » sans champ à sa gauche`, c.start);

    p++;
    const next = peek();
    // ⚠️ Un mot QUOTÉ est toujours du texte : `"tier"` cherche le mot, il ne
    // désigne pas le champ. C'est la seule façon de chercher un nom qui
    // ressemble à un champ.
    if (next && next.kind === 'op' && c.kind === 'word') {
      p++;
      const field = resolveField(schema, c.text);
      if (!field) {
        throw new ParseError(
          `Champ inconnu : « ${c.text} ». Champs disponibles : ${fieldNames(schema).join(', ')}.`,
          c.start,
        );
      }
      const valueChunk = peek();
      // ⚠️ Une comparaison sans valeur (`tier:`) n'est PAS une erreur : c'est
      // l'état de la requête à chaque frappe pendant qu'on la tape. Elle se lit
      // « ce champ n'est pas vide », ce qui est utile en soi et ce qui évite de
      // faire clignoter un message d'erreur sous les doigts.
      if (!valueChunk || valueChunk.kind === ')' || valueChunk.kind === 'op'
          || isWord(valueChunk, AND_WORDS) || isWord(valueChunk, OR_WORDS)) {
        return { op: 'cmp', field, cmp: next.text, values: [], anyValue: true, start: c.start, end: next.end };
      }
      p++;
      const raw = valueChunk.text;
      const values = valueChunk.quoted ? [raw] : raw.split(',').filter(v => v !== '');
      return { op: 'cmp', field, cmp: next.text, values, start: c.start, end: valueChunk.end };
    }
    // ⚠️ Un mot nu qui EST le nom d'un champ booléen se lit comme ce booléen :
    // `illustration` = « en a une », `-illustration` = « n'en a pas ». Sans
    // cette lecture, `-illustration` cherchait le mot « illustration » dans les
    // NOMS de cartes et ne rendait jamais rien — la négation la plus évidente
    // du lot était celle qui ne marchait pas. Les guillemets rendent le mot à
    // sa recherche textuelle.
    if (!c.quoted) {
      const boolField = resolveField(schema, c.text);
      if (boolField && boolField.type === 'bool') {
        return { op: 'cmp', field: boolField, cmp: ':', values: ['oui'], start: c.start, end: c.end };
      }
    }
    return { op: 'text', value: c.text, start: c.start, end: c.end };
  }

  const node = parseOr();
  if (p < chunks.length) throw new ParseError('Fin de requête inattendue', chunks[p].start);
  return node;
}

/**
 * → `{ ok: true, node }` ou `{ ok: false, error, index }`.
 * Une requête vide rend `node: null`, que `matches` accepte (tout passe).
 */
export function parseQuery(src, schema) {
  const chunks = chunk(src);
  if (!chunks.length) return { ok: true, node: null };
  try {
    return { ok: true, node: parseChunks(chunks, schema) };
  } catch (e) {
    if (e instanceof ParseError) return { ok: false, error: e.message, index: e.index };
    throw e;
  }
}

// --------------------------------------------------------------------------
// Schéma
// --------------------------------------------------------------------------
//
// Un schéma : `{ fields: [...], text: ['nom', 'id'] }`.
// Un champ    : `{ key, aliases?, label, type, get(item), options?() }`
//   type `text`   — chaîne
//   type `number` — nombre (ou tableau de nombres : « l'un d'eux suffit »)
//   type `bool`   — booléen
//   type `enum`   — une ou plusieurs étiquettes (id ET nom lisible, les deux
//                   sont interrogeables : `attribut:ARCH_002` comme
//                   `attribut:dragon`)

export function fieldNames(schema) {
  return (schema?.fields ?? []).map(f => f.key);
}

export function resolveField(schema, name) {
  const want = fold(name);
  for (const f of schema?.fields ?? []) {
    if (fold(f.key) === want) return f;
    if ((f.aliases ?? []).some(a => fold(a) === want)) return f;
  }
  return null;
}

/** Les valeurs d'un champ, toujours rendues sous forme de tableau : un champ à
 *  valeurs multiples (tiers, attributs) se compare comme un champ simple, et
 *  la comparaison passe dès qu'UNE valeur satisfait — c'est la lecture
 *  naturelle de `tier:3` sur une carte à deux tiers. */
function valuesOf(field, item) {
  const raw = field.get(item);
  if (raw == null) return [];
  if (Array.isArray(raw)) return raw.filter(v => v != null && v !== '');
  if (raw === '') return [];
  return [raw];
}

// --------------------------------------------------------------------------
// Évaluation
// --------------------------------------------------------------------------

function compareOne(field, cmp, needle, actual) {
  if (field.type === 'number') {
    const a = Number(actual);
    const b = Number(needle);
    if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
    switch (cmp) {
      case '>': return a > b;
      case '>=': return a >= b;
      case '<': return a < b;
      case '<=': return a <= b;
      case '!=': return a !== b;
      default: return a === b;
    }
  }
  const a = fold(actual);
  const b = fold(needle);
  switch (cmp) {
    case '=': return a === b;
    case '!=': return a !== b;
    // `:` et `~` disent la même chose sur du texte — le premier est le
    // raccourci qu'on tape, le second celui qu'on écrit quand on veut être
    // explicite. Les séparer donnerait deux règles à retenir pour un geste.
    default: return a.includes(b);
  }
}

function matchesCmp(node, item) {
  const { field, cmp } = node;
  const actual = valuesOf(field, item);

  if (node.anyValue) return actual.length > 0;

  if (field.type === 'bool') {
    const wanted = node.values.every(v => !FALSE_WORDS.has(fold(v)));
    const truthy = actual.some(v => v === true || TRUE_WORDS.has(fold(v)));
    const hit = truthy === wanted;
    return cmp === '!=' ? !hit : hit;
  }

  // « ce champ est-il vide ? » — la seule question qu'on ne peut pas poser en
  // comparant des valeurs, puisqu'il n'y en a précisément aucune.
  if (node.values.length === 1 && EMPTY_WORDS.has(fold(node.values[0])) && field.type !== 'number') {
    const empty = actual.length === 0;
    return cmp === '!=' ? !empty : empty;
  }

  // Une LISTE (`tier:3,4`) se lit « l'un de ». Sur `!=`, elle se lit « aucun
  // d'eux » : nier un « ou » donne un « et », et l'inverse surprendrait.
  if (cmp === '!=') return node.values.every(v => !actual.some(a => compareOne(field, '=', v, a)));
  return node.values.some(v => actual.some(a => compareOne(field, cmp, v, a)));
}

function matchesText(node, item, schema) {
  const needle = fold(node.value);
  if (!needle) return true;
  for (const key of schema.text ?? []) {
    const field = resolveField(schema, key);
    if (!field) continue;
    for (const v of valuesOf(field, item)) if (fold(v).includes(needle)) return true;
  }
  return false;
}

/** L'élément satisfait-il l'arbre ? Un arbre `null` (requête vide) laisse tout passer. */
export function matches(node, item, schema) {
  if (!node) return true;
  switch (node.op) {
    case 'and': return matches(node.left, item, schema) && matches(node.right, item, schema);
    case 'or': return matches(node.left, item, schema) || matches(node.right, item, schema);
    case 'not': return !matches(node.node, item, schema);
    case 'cmp': return matchesCmp(node, item);
    case 'always': return true;
    case 'text': return matchesText(node, item, schema);
    default: return true;
  }
}

/**
 * Le point d'entrée des écrans : texte + schéma + liste → liste filtrée.
 *
 * ⚠️ Une requête FAUTIVE ne vide pas la liste, elle la laisse entière et rend
 * son message. Une requête à moitié tapée est l'état normal d'une barre de
 * recherche : vider l'écran à chaque frappe ferait clignoter tout le contenu.
 */
export function filterByQuery(items, src, schema) {
  const parsed = parseQuery(src, schema);
  if (!parsed.ok) return { items: [...(items ?? [])], error: parsed.error, index: parsed.index };
  if (!parsed.node) return { items: [...(items ?? [])], error: null };
  return { items: (items ?? []).filter(it => matches(parsed.node, it, schema)), error: null };
}

// --------------------------------------------------------------------------
// Facettes — les chips et les <select> écrivent DANS la requête
// --------------------------------------------------------------------------
//
// « Un champ de recherche avec des filtres intégrés » : les filtres visuels ne
// vivent pas à côté de la requête, ils la composent. Un chip de tier ajoute
// `tier:3` dans la barre, et la barre reste la seule source de vérité — il n'y
// a donc jamais deux états de filtrage à tenir d'accord.
//
// ⚠️ La chirurgie se fait sur le TEXTE, pas sur l'arbre : re-sérialiser l'arbre
// reformaterait ce que l'utilisateur a tapé (guillemets, espaces, casse des
// connecteurs) à chaque clic sur un chip.

/**
 * Les termes de premier niveau, parenthèses et guillemets respectés.
 *
 * ⚠️ L'ET étant IMPLICITE, la seule frontière entre deux termes voisins est
 * leur forme : un terme est `mot [opérateur valeur]`, donc `tier:3 atk>50` en
 * fait DEUX. Faute de cette petite machine à états, tout ce qui n'était pas
 * séparé par un connecteur écrit devenait un seul terme géant, et le chip de
 * tier ne retrouvait plus le sien pour l'éteindre.
 */
export function topLevelTerms(src) {
  const text = String(src ?? '');
  const chunks = chunk(text);
  const terms = [];
  let depth = 0;
  let current = null;
  let state = 'empty';   // empty → name → op → done
  let sawTopLevelOr = false;

  const close = () => { if (current) terms.push(current); current = null; state = 'empty'; };
  const open = (c) => { current = { start: c.start, end: c.end }; };

  for (const c of chunks) {
    if (depth > 0) {
      current.end = c.end;
      if (c.kind === '(') depth++;
      else if (c.kind === ')') { depth--; if (depth === 0) { close(); } }
      continue;
    }
    if (c.kind === '(') { close(); open(c); depth = 1; continue; }
    if (c.kind === ')') continue;   // orpheline : l'analyseur la signalera

    if (c.kind === 'word' && !c.quoted) {
      const w = fold(c.text);
      if (OR_WORDS.has(w)) { sawTopLevelOr = true; close(); continue; }
      if (AND_WORDS.has(w)) { close(); continue; }
    }
    if (c.kind === 'op') {
      if (state === 'name') { current.end = c.end; state = 'op'; }
      else { close(); open(c); state = 'done'; }
      continue;
    }
    // mot ou chaîne
    if (state === 'op') { current.end = c.end; state = 'done'; continue; }
    close();
    open(c);
    state = 'name';
  }
  close();
  return terms
    .map(t => ({ ...t, text: text.slice(t.start, t.end), sawTopLevelOr }))
    .filter(t => t.text.trim() !== '');
}

/** → `{ term, values }` du premier terme `champ:…` de premier niveau, ou `null`. */
function findFacet(src, schema, fieldKey) {
  const field = resolveField(schema, fieldKey);
  if (!field) return null;
  for (const term of topLevelTerms(src)) {
    const cs = chunk(term.text);
    if (cs.length >= 2 && cs[0].kind === 'word' && cs[1].kind === 'op' && resolveField(schema, cs[0].text) === field) {
      const v = cs[2];
      const values = !v || v.kind === 'op' ? [] : (v.quoted ? [v.text] : v.text.split(',').filter(Boolean));
      return { term, field, op: cs[1].text, values };
    }
  }
  return null;
}

/** Les valeurs actuellement posées sur ce champ, au premier niveau. */
export function readFacet(src, schema, fieldKey) {
  return findFacet(src ?? '', schema, fieldKey)?.values ?? [];
}

/** Ce chip est-il allumé ? */
export function hasFacet(src, schema, fieldKey, value) {
  const want = fold(value);
  return readFacet(src, schema, fieldKey).some(v => fold(v) === want);
}

function quoteValue(v) {
  const s = String(v);
  return /[\s(),:=<>~"]/.test(s) ? `"${s.replace(/"/g, '')}"` : s;
}

/** Réécrit (ou retire) le terme `champ:…` de premier niveau. */
export function writeFacet(src, schema, fieldKey, values, op = ':') {
  const text = String(src ?? '');
  const field = resolveField(schema, fieldKey);
  if (!field) return text;
  const found = findFacet(text, schema, fieldKey);
  const replacement = values.length ? `${field.key}${op}${values.map(quoteValue).join(',')}` : '';

  if (found) {
    const before = text.slice(0, found.term.start);
    const after = text.slice(found.term.end);
    // Le connecteur explicite qui précédait le terme retiré partirait sinon en
    // orphelin (`tier:3 ET` tout seul ne s'analyse plus).
    const cleaned = replacement
      ? before + replacement + after
      : (before.replace(/(^|\s)(et|and|&&?|ou|or|\|\|?)\s*$/i, '$1') + after);
    return cleaned.replace(/\s{2,}/g, ' ').trim();
  }
  if (!replacement) return text;
  if (!text.trim()) return replacement;
  // ⚠️ Une requête qui porte un OU de premier niveau se PARENTHÈSE avant qu'on
  // lui ajoute un ET : `a OU b` + `tier:3` doit donner `(a OU b) ET tier:3`, et
  // surtout pas `a OU b ET tier:3`, qui ne filtre que la branche droite.
  const needsParens = topLevelTerms(text).some(t => t.sawTopLevelOr);
  return `${needsParens ? `(${text.trim()})` : text.trim()} ${replacement}`;
}

/**
 * Ajoute ou retire une valeur — le geste d'un chip.
 *
 * ⚠️ `op` n'est pas décoratif : un chip « 3 matériels et plus » doit poser
 * `cout>=3`, pas `cout:3`. Écrit en égalité, il manquait les coûts 4 et 5 — un
 * filtre qui a l'air de marcher parce que le cas rare est rare.
 * Un chip posé avec un autre opérateur ne se cumule pas en liste : il
 * REMPLACE, une inégalité ne s'énumérant pas.
 */
export function toggleFacet(src, schema, fieldKey, value, { op = ':' } = {}) {
  const found = findFacet(String(src ?? ''), schema, fieldKey);
  const current = found?.values ?? [];
  const want = fold(value);
  const already = (found?.op ?? ':') === op && current.some(v => fold(v) === want);
  if (already) return writeFacet(src, schema, fieldKey, current.filter(v => fold(v) !== want), op);
  if (op !== ':') return writeFacet(src, schema, fieldKey, [String(value)], op);
  return writeFacet(src, schema, fieldKey, [...(found?.op === ':' ? current : []), String(value)], op);
}

/** Ce chip est-il allumé, pour cet opérateur ? */
export function hasFacetOp(src, schema, fieldKey, value, op = ':') {
  const found = findFacet(String(src ?? ''), schema, fieldKey);
  if (!found || (found.op ?? ':') !== op) return false;
  const want = fold(value);
  return found.values.some(v => fold(v) === want);
}

/** Pose une valeur unique — le geste d'un `<select>` (`''` = retire le terme).
 *  L'opérateur est réglable : un `<select>` « plusieurs recettes » pose
 *  `recettes>=2`, pas une égalité. */
export function setFacet(src, schema, fieldKey, value, op = ':') {
  return writeFacet(src, schema, fieldKey, value === '' || value == null ? [] : [String(value)], op || ':');
}

// --------------------------------------------------------------------------
// Autocomplétion
// --------------------------------------------------------------------------

/**
 * Ce que le curseur peut compléter : un nom de champ, ou une valeur de champ.
 * → `{ kind, start, end, items: [{ value, label, hint }] }` ou `null`.
 *
 * C'est la moitié « filtres intégrés » de la barre : on n'a pas à connaître la
 * grammaire pour s'en servir, il suffit de commencer à taper.
 */
export function suggest(src, caret, schema) {
  const text = String(src ?? '');
  const pos = Math.max(0, Math.min(caret ?? text.length, text.length));
  const chunks = chunk(text);

  // ⚠️ Raisonner par INDICES et non par `find`/`filter` : le morceau « qui
  // précède » doit être celui d'avant le curseur, jamais celui qui le porte. Le
  // confondre faisait chercher un nom de champ là où on tapait une valeur —
  // `pack:Y` proposait « type: ».
  const idx = chunks.findIndex(c => pos > c.start && pos <= c.end);
  const at = idx >= 0 ? chunks[idx] : null;
  const beforeIdx = idx >= 0 ? idx - 1 : chunks.reduce((last, c, i) => (c.end <= pos ? i : last), -1);

  // Sur quel opérateur le curseur travaille-t-il, et complète-t-il une valeur
  // déjà commencée ?
  let opIdx = -1;
  let valueChunk = null;
  if (at && at.kind !== 'op' && chunks[idx - 1]?.kind === 'op') { opIdx = idx - 1; valueChunk = at; }
  else if (at && at.kind === 'op') opIdx = idx;
  else if (beforeIdx >= 0 && chunks[beforeIdx].kind === 'op') opIdx = beforeIdx;

  if (opIdx > 0) {
    const field = resolveField(schema, chunks[opIdx - 1].text);
    if (field && chunks[opIdx - 1].kind === 'word') {
      const typed = valueChunk ? valueChunk.text : '';
      // Sur une liste (`tier:3,`), on ne complète que le dernier fragment.
      const comma = typed.lastIndexOf(',');
      const frag = fold(typed.slice(comma + 1));
      const start = (valueChunk ? valueChunk.start : chunks[opIdx].end) + comma + 1;
      const options = typeof field.options === 'function' ? field.options() : null;
      const base = options ?? defaultValueHints(field);
      const items = base
        .filter(o => !frag || fold(o.label ?? o.value).includes(frag) || fold(o.value).includes(frag))
        .slice(0, 40);
      // ⚠️ Une valeur DÉJÀ COMPLÈTE n'a plus rien à compléter, et la liste doit
      // se fermer : sur un écran de téléphone elle recouvre les chips posés
      // juste dessous, qui deviennent intapables. Une barre de recherche dont
      // le seul filtre visible est inatteignable est pire que pas de liste.
      if (items.length === 1 && fold(items[0].value) === frag) return null;
      return { kind: 'value', field, start, end: valueChunk ? valueChunk.end : pos, items };
    }
  }

  // Sinon → un nom de champ.
  const wordChunk = at && at.kind === 'word' ? at : null;
  const typed = wordChunk ? fold(wordChunk.text) : '';
  const items = (schema?.fields ?? [])
    .filter(f => !typed || fold(f.key).includes(typed) || fold(f.label).includes(typed)
                 || (f.aliases ?? []).some(a => fold(a).includes(typed)))
    .map(f => ({ value: `${f.key}:`, label: `${f.key}:`, hint: f.label }));
  if (!items.length) return null;
  return { kind: 'field', start: wordChunk ? wordChunk.start : pos, end: wordChunk ? wordChunk.end : pos, items };
}

function defaultValueHints(field) {
  if (field.type === 'bool') return [{ value: 'oui', label: 'oui' }, { value: 'non', label: 'non' }];
  if (field.type === 'number') return [];
  return [{ value: 'vide', label: 'vide', hint: 'champ absent' }];
}

/** Remplace `[start, end)` par `value` et rend le texte + la position du curseur. */
export function applySuggestion(src, { start, end }, value) {
  const text = String(src ?? '');
  const next = text.slice(0, start) + value + text.slice(end);
  return { text: next, caret: start + value.length };
}

// --------------------------------------------------------------------------
// Le schéma des CARTES — partagé par l'admin et le DeckBuilder
// --------------------------------------------------------------------------
//
// ⚠️ Les deux écrans posent la même question sur les mêmes objets : une carte
// de `GET /api/cards` porte déjà `_tiers`, `_has_illustration` et `_starter`
// des deux côtés. Seuls deux dérivés diffèrent d'un côté à l'autre — le coût
// d'invocation (`data/SummonInfo` côté client, une fonction d'`admin.html` de
// l'autre) et la mise en mots d'un id — d'où l'injection, sur le modèle de
// `deps.rand` et `deps.enemyBonus`.
//
// @param {object}   deps
// @param {Function} deps.summonCost      (card) => nombre de matériels
// @param {Function} [deps.attributeName] (id) => nom lisible
// @param {Function} [deps.powerName]     (id) => nom lisible
export function cardQuerySchema(deps = {}) {
  const summonCost = deps.summonCost ?? (() => 0);
  const attributeName = deps.attributeName ?? (id => id);
  const powerName = deps.powerName ?? (id => id);
  const stat = key => card => card?.stats?.[key];

  /** Un id ET son nom lisible : on doit pouvoir écrire `attribut:ARCH_002`
   *  comme `attribut:dragon` sans savoir lequel des deux le voisin utilise. */
  const labelled = (ids, name) => (ids ?? []).flatMap(id => [id, name(id)]);

  return {
    text: ['nom', 'id'],
    fields: [
      { key: 'id', label: 'Identifiant', type: 'text', get: c => c.id },
      { key: 'nom', aliases: ['name'], label: 'Nom', type: 'text', get: c => c.name },
      { key: 'tier', aliases: ['t'], label: 'Tier (1–5)', type: 'number', get: c => c._tiers ?? [], options: deps.tierOptions },
      { key: 'atk', aliases: ['attaque'], label: 'Attaque', type: 'number', get: stat('atk') },
      { key: 'pv', aliases: ['hp', 'vie'], label: 'Points de vie', type: 'number', get: stat('hp') },
      { key: 'vitesse', aliases: ['movement_speed', 'deplacement'], label: 'Vitesse de déplacement', type: 'number', get: stat('movement_speed') },
      { key: 'cadence', aliases: ['attack_speed'], label: 'Vitesse d\'attaque', type: 'number', get: stat('attack_speed') },
      { key: 'initiative', aliases: ['init'], label: 'Initiative', type: 'number', get: stat('initiative') },
      { key: 'portee', aliases: ['range'], label: 'Portée', type: 'number', get: stat('range') },
      { key: 'cout', aliases: ['cost', 'materiels'], label: 'Coût en matériels', type: 'number', get: c => summonCost(c) },
      { key: 'recettes', aliases: ['conditions'], label: 'Nombre de recettes', type: 'number', get: c => (c.summon_conditions ?? []).length },
      {
        key: 'attribut', aliases: ['attr', 'attributs'], label: 'Attribut (id ou nom)', type: 'enum',
        get: c => labelled(c.attributes, attributeName),
        options: deps.attributeOptions,
      },
      {
        key: 'pouvoir', aliases: ['power'], label: 'Pouvoir (id ou nom)', type: 'enum',
        get: c => (c.power?.id ? [c.power.id, powerName(c.power.id)] : []),
        options: deps.powerOptions,
      },
      {
        // Les matériaux que ses recettes CONSOMMENT — « qui mange CORE_001 ? »
        // n'avait aucune réponse ailleurs que dans une relecture du JSON.
        key: 'materiau', aliases: ['materiaux', 'requiert'], label: 'Matériau exigé (id de carte ou d\'attribut)', type: 'enum',
        get: c => (c.summon_conditions ?? []).flatMap(cond => cond?.requires ?? []),
      },
      { key: 'lignee', aliases: ['represente', 'represented_ids'], label: 'Lignée représentée', type: 'enum', get: c => c.represented_ids ?? [] },
      { key: 'valeur', aliases: ['material_value'], label: 'Valeur en matériel', type: 'number', get: c => c.material_value ?? 1 },
      { key: 'pack', aliases: ['set'], label: 'Pack commercial', type: 'enum', get: c => c.set, options: deps.packOptions },
      { key: 'type', label: 'Type de fiche', type: 'text', get: c => c.type },
      { key: 'illustration', aliases: ['illus', 'art'], label: 'A une illustration', type: 'bool', get: c => !!c._has_illustration },
      { key: 'depart', aliases: ['starter'], label: 'Carte du pack de départ', type: 'bool', get: c => !!c._starter },
    ],
  };
}

/** Quelques requêtes d'exemple, montrées sous la barre. Elles enseignent la
 *  grammaire mieux qu'une page d'aide, parce qu'elles sont cliquables. */
export const CARD_QUERY_EXAMPLES = [
  { q: 'tier:4,5 -illustration', why: 'hauts tiers sans art' },
  { q: 'atk>=25 ET pv<200', why: 'verre fin' },
  { q: 'pouvoir:vide ET tier:1', why: 'tier 1 sans pouvoir' },
  { q: 'cout:0 ET tier>=3', why: 'gros tiers sans coût' },
  { q: 'attribut:dragon OU attribut:machine', why: 'deux archétypes' },
  { q: 'materiau:CORE_001', why: 'qui consomme cette carte' },
];
