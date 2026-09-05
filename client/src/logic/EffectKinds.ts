// Le lecteur du registre des primitives d'effet (`effect-kinds.json`).
//
// ⚠️ Module PLAT, au même titre que `MagieOffer` : il n'importe que le registre
// et n'a AUCUNE connaissance de domaine. Il répond à « quels types existent »,
// « ce type lit-il ce champ », « quelle est sa famille de ciblage », « quelle
// est sa règle de pertinence » — jamais à « que fait-il ». Faire l'effet reste
// le travail des trois moteurs, et c'est ce qui empêche ce fichier de devenir
// un quatrième endroit où une règle vit à moitié.
//
// ⚠️ Les RÉSOLVEURS nommés (`{ fn: … }`) ne sont PAS ici : chaque lecteur
// apporte les siens. `MagieEffect` a besoin de `POWER_LABELS` et de
// `duplicateCopies`, `BoardInfo` de `statLabel`, `MagieOffer` du contexte
// d'offre — les rapatrier ici ferait entrer `data/` dans `logic/` par la porte
// de derrière, et donnerait à ce module le vocabulaire français qu'il n'a pas à
// connaître.
//
// ⚠️ Et surtout : les deux familles n'ont pas le même vocabulaire de stats.
// `MagieEffect.STAT_NAMES` dit « ATK », `data/StatLabels` dit « ATQ ». Le
// gabarit ne résout donc pas `{stat}` lui-même — l'appelant lui passe la chaîne
// déjà nommée. Les unifier serait un changement d'affichage, pas une
// factorisation.
import registry from './effect-kinds.json';

export type EffectDomain = 'magie' | 'attribute' | 'board';

/** Ce qu'une magie demande au joueur de DÉSIGNER. `global` = rien à désigner. */
export type TargetFamily = 'unit' | 'graveyard' | 'hand' | 'global';

/**
 * Quand une magie a un effet réel. Les trois formes régulières couvrent 21 des
 * 27 types ; `fn` nomme un prédicat que `MagieOffer` fournit, pour les six qui
 * croisent plusieurs faits (une pioche garantie interroge le deck, un
 * remplacement par tier interroge une cible ET un pool).
 */
export type RelevanceRule = 'always' | { gt0: string } | { flag: string } | { fn: string };

/**
 * Le libellé. `null` = aucun libellé écrit, l'id brut sort — c'est le `default`
 * historique des deux générateurs, conservé tel quel plutôt que masqué : un
 * type sans libellé doit se VOIR à l'écran.
 */
export type LabelRule = string | { fn: string } | null;

export interface EffectDomainSpec {
  target?: TargetFamily;
  relevance?: RelevanceRule;
  /** Les champs que le type LIT réellement. Fait foi pour le formulaire d'admin. */
  params: string[];
  label: LabelRule;
}

export interface EffectKind {
  admin_label: string;
  magie?: EffectDomainSpec;
  attribute?: EffectDomainSpec;
  board?: EffectDomainSpec;
}

// ⚠️ `$comment` porte la documentation du fichier et n'est pas une primitive :
// il est écarté ici, une fois, plutôt que par chaque appelant.
const KINDS: Record<string, EffectKind> = Object.fromEntries(
  Object.entries(registry as Record<string, unknown>)
    .filter(([id]) => !id.startsWith('$')),
) as Record<string, EffectKind>;

/** Tous les types déclarés, tous domaines confondus. */
export function allKinds(): string[] {
  return Object.keys(KINDS);
}

/** Les types disponibles dans un domaine — l'ordre du fichier fait foi. */
export function kindsFor(domain: EffectDomain): string[] {
  return allKinds().filter(id => !!KINDS[id][domain]);
}

export function specOf(type: string | null | undefined, domain: EffectDomain): EffectDomainSpec | null {
  if (!type) return null;
  return KINDS[type]?.[domain] ?? null;
}

/**
 * La première section trouvée parmi les domaines proposés.
 *
 * ⚠️ Sert `BoardInfo.boardEffectLabel`, qui décrit un effet de terrain ET un
 * effet d'attribut sans pouvoir les distinguer : il ne reçoit qu'un objet
 * d'effet, jamais son porteur. Les libellés des deux domaines sont identiques
 * partout où ils coexistent — la préférence n'arbitre donc rien aujourd'hui,
 * elle dit seulement lequel on lirait si un jour ils divergeaient.
 */
export function specIn(type: string | null | undefined, domains: EffectDomain[]): EffectDomainSpec | null {
  for (const d of domains) {
    const spec = specOf(type, d);
    if (spec) return spec;
  }
  return null;
}

/** Le libellé humain de l'onglet d'admin — `undefined` sur un type inconnu. */
export function adminLabel(type: string): string | undefined {
  return KINDS[type]?.admin_label;
}

/**
 * La famille de ciblage d'une magie. `null` sur un type inconnu ou hors magie —
 * c'est ce qui rend les trois `needsXTarget` sûrs par construction : un type que
 * le registre ne connaît pas ne demande aucune cible.
 */
export function targetFamily(type: string | null | undefined): TargetFamily | null {
  return specOf(type, 'magie')?.target ?? null;
}

export function relevanceRule(type: string | null | undefined): RelevanceRule | null {
  return specOf(type, 'magie')?.relevance ?? null;
}

/** Les champs qu'un type lit dans un domaine. `[]` sur un type inconnu. */
export function paramsOf(type: string | null | undefined, domain: EffectDomain): string[] {
  return specOf(type, domain)?.params ?? [];
}

/**
 * Ce type lit-il ce champ ? LA question du formulaire d'admin — et la réponse
 * qui remplace les tables de visibilité recopiées et les deux listes `noValue`.
 */
export function readsParam(type: string | null | undefined, domain: EffectDomain, param: string): boolean {
  return paramsOf(type, domain).includes(param);
}

/**
 * Interpole un gabarit `{param}`.
 *
 * ⚠️ Un placeholder sans valeur rend la chaîne VIDE, jamais `undefined` : le
 * gabarit `{targets}` n'est renseigné que par les effets qui filtrent des
 * unités, et « +5 ATQundefined » serait pire qu'un blanc. Aucune autre syntaxe
 * n'est reconnue — pas de condition, pas de pluriel : dès qu'une phrase se
 * ramifie, elle passe par un `{ fn: … }`, où elle est lisible.
 */
export function renderLabel(template: string, values: Record<string, unknown>): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => {
    const v = values[key];
    return v === undefined || v === null ? '' : String(v);
  });
}
