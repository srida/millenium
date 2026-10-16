// LE BARÈME DES CARTES — la note d'une carte, rapportée au budget de son tier.
//
// Chaque carte a un SCORE : ce qu'elle coûte (stats, pouvoir, mots-clés,
// attributs de synergie) moins ce que son invocation lui fait payer (matériaux
// exigés, voie d'invocation). Elle est « dans le budget » quand son score reste
// à ± `tolerance` du budget de son tier. Les valeurs vivent dans la DONNÉE
// (`data/scoring.json`, onglet 📐 Barème de l'admin), ce module n'en porte
// aucune.
//
// ⚠️ PUR et sans aucun import, à la racine — même statut que `card-query.mjs` :
// `admin.html` le charge par `/admin/card-score.js`, les tests l'importent. Une
// seconde formule ailleurs donnerait deux notes pour la même carte.
//
// Les règles qu'il porte, et lui seul :
//   • une carte multi-tier est jugée sur le budget de son tier le PLUS BAS ;
//   • une carte `balance_excluded` a un score, mais aucun budget : elle est
//     « libre » ;
//   • les attributs se SOMMENT, sauf ceux de catégorie `Invocation` : une carte
//     à plusieurs voies ne paie que la plus facile (la moins négative) ;
//   • un attribut sans coût propre vaut `stats.synergy` s'il est de catégorie
//     Archetype, Type ou Élément, zéro sinon ;
//   • le malus d'invocation vaut MATÉRIAUX × COÛT DE LA VOIE, sur la recette
//     la moins chère ; sans voie, chaque matériau coûte `material` ;
//   • la voie retenue paie EN PLUS son supplément par tier
//     (`invocation_tier[voie][tier]`, tier le plus bas) — l'invocation Normale
//     est gratuite en T1 et coûte ensuite ;
//   • la vitesse de pouvoir ne compte qu'au-delà (ou en deçà) de 50, et
//     seulement quand la carte a un pouvoir.

/** Les catégories d'attributs payées au tarif « synergie ». */
export const SYNERGY_CATEGORIES = ['Archetype', 'Type', 'Element'];
/** La catégorie dont une carte ne paie que la voie la plus facile. */
export const INVOCATION_CATEGORY = 'Invocation';
/** La catégorie qui dit les tiers (champ `tier` sur l'attribut). */
export const TIERS_CATEGORY = 'Tiers';

/** Les coûts de stats, dans l'ordre où l'admin les présente. */
export const STAT_COSTS = [
  { key: 'atk', label: 'ATQ', unit: 'par point' },
  { key: 'hp', label: 'PV', unit: 'par point' },
  { key: 'range', label: 'Portée', unit: 'par case au-delà de 1' },
  { key: 'attack_rate', label: "Vitesse d'attaque", unit: 'par point de compteur' },
  { key: 'movement_rate', label: 'Vitesse de déplacement', unit: 'par point de compteur' },
  { key: 'material_value', label: 'Valeur de matériau', unit: 'par slot au-delà de 1' },
  { key: 'synergy', label: 'Attribut de synergie', unit: 'archétype, type ou élément sans coût propre' },
  { key: 'power_rate', label: 'Vitesse de pouvoir', unit: 'par point au-dessus de 50' },
];

/** Les quatre verdicts. `libre` = carte exclue des statistiques. */
export const VERDICTS = {
  dans: 'dans le budget',
  dessus: 'au-dessus',
  dessous: 'en dessous',
  libre: 'score libre',
};

const num = v => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

/** Index id → attribut, à construire une fois par liste d'attributs. */
export function attributeIndex(attributes) {
  const m = new Map();
  for (const a of attributes || []) m.set(a.id, a);
  return m;
}

/** Les tiers d'une carte, croissants, lus sur ses attributs de catégorie Tiers. */
export function cardTiers(card, attrIndex) {
  const out = [];
  for (const id of card.attributes || []) {
    const a = attrIndex.get(id);
    if (a && a.categorie === TIERS_CATEGORY && Number.isFinite(Number(a.tier))) out.push(Number(a.tier));
  }
  return out.sort((x, y) => x - y);
}

/** Le moins de matériaux qu'une recette de la carte exige (0 sans recette). */
export function cheapestMaterials(card) {
  const conds = card.summon_conditions || [];
  if (!conds.length) return 0;
  return Math.min(...conds.map(c => num(c.materials)));
}

/**
 * La note d'une carte.
 *
 * @returns {{ score:number, budget:number|null, ecart:number|null,
 *             verdict:'dans'|'dessus'|'dessous'|'libre', tier:number|null,
 *             tiers:number[], parts:{label:string,value:number}[] }}
 */
export function scoreCard(card, attrIndex, bareme, names = {}) {
  const s = bareme?.stats || {};
  const st = card.stats || {};
  const parts = [];
  const add = (label, value) => { if (value) parts.push({ label, value }); };

  add('ATQ', num(st.atk) * num(s.atk));
  add('PV', num(st.hp) * num(s.hp));
  add('Portée', Math.max(0, num(st.range) - 1) * num(s.range));
  add("Vitesse d'attaque", num(st.attack_rate) * num(s.attack_rate));
  add('Vitesse de déplacement', num(st.movement_rate) * num(s.movement_rate));
  const mv = num(card.material_value) || 1;
  if (mv > 1) add('Valeur de matériau', (mv - 1) * num(s.material_value));

  const power = card.power || {};
  if (power.id) {
    const rate = num(power.power_rate);
    add(names.power?.(power.id) ?? power.id, num(bareme?.powers?.[power.id]) + (rate - 50) * num(s.power_rate));
  }

  const costs = bareme?.attributes || {};
  let synergies = 0, invocation = null;
  for (const id of card.attributes || []) {
    const a = attrIndex.get(id);
    if (!a) continue;
    const own = costs[id];
    if (a.categorie === INVOCATION_CATEGORY) {
      const v = num(own);
      if (!invocation || v > invocation.value) invocation = { label: a.name, value: v, ids: [id] };
      else if (v === invocation.value) { invocation.label += ` / ${a.name}`; invocation.ids.push(id); }
      continue;
    }
    if (typeof own === 'number') add(a.name, own);
    else if (SYNERGY_CATEGORIES.includes(a.categorie)) synergies++;
  }
  if (synergies) add(`Synergies ×${synergies}`, synergies * num(s.synergy));

  // Le malus d'invocation = matériaux × coût de la voie. Sans voie, le tarif
  // par défaut `material` ; sans matériau, rien (une voie seule ne coûte rien).
  const mat = cheapestMaterials(card);
  if (mat) {
    const per = invocation ? invocation.value : num(bareme?.material);
    const label = invocation ? invocation.label : `matériau${mat > 1 ? 'x' : ''}`;
    add(`${mat} × ${label}`, mat * per);
  }

  const tiers = cardTiers(card, attrIndex);
  const tier = tiers.length ? tiers[0] : null;
  // Supplément de la voie selon le tier (le plus bas). Plusieurs voies à
  // égalité : la moins chère, comme pour le coût de la voie.
  if (invocation && tier !== null) {
    const byTier = invocation.ids.map(id => num(bareme?.invocation_tier?.[id]?.[tier] ?? bareme?.invocation_tier?.[id]?.[String(tier)]));
    add(`${invocation.label} T${tier}`, Math.max(...byTier));
  }

  // ⚠️ Arrondi au DIXIÈME, la précision affichée : un 65,04 s'affiche « 65 »
  // et doit être jugé comme tel (±tolérance incluse), sinon il sort rouge.
  const score = round1(parts.reduce((t, p) => t + p.value, 0));
  if (card.balance_excluded || tier === null) {
    return { score, budget: null, ecart: null, verdict: 'libre', tier, tiers, parts };
  }
  const budget = num(bareme?.budget?.[tier] ?? bareme?.budget?.[String(tier)]);
  const ecart = round1(score - budget);
  const tol = num(bareme?.tolerance);
  const verdict = ecart > tol ? 'dessus' : ecart < -tol ? 'dessous' : 'dans';
  return { score, budget, ecart, verdict, tier, tiers, parts };
}

/**
 * Les notes de tout un catalogue, indexées par id de carte.
 * `names.power(id)` sert à nommer un pouvoir dans le détail du score.
 */
function round1(v) { return Math.round(v * 10) / 10; }

export function scoreCatalog(cards, attributes, bareme, names = {}) {
  const idx = attributeIndex(attributes);
  const out = new Map();
  for (const c of cards || []) out.set(c.id, scoreCard(c, idx, bareme, names));
  return out;
}
