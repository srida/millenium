// CardArt — « quelle illustration pour cette carte ? », et rien d'autre.
//
// Une variante est une illustration alternative d'une carte, achetée en
// boutique et choisie DECK PAR DECK. Elle n'a aucune existence dans la
// simulation : deux joueurs dont les variantes diffèrent jouent exactement le
// même combat. C'est pourquoi elle ne descend pas dans `logic/` (qui n'a de
// toute façon pas le droit d'importer `data/`) et ne voyage pas dans le
// payload de déterminisme du PvP.
//
// Deux tables, une par camp : le rendu demande l'id d'illustration sans savoir
// qu'il existe des variantes. Ce module n'importe RIEN — c'est ce qui autorise
// `three/UnitCardEl.ts` à s'en servir sans traîner de dépendance dans la
// couche de rendu.

/**
 * URL de l'art d'un id — carte, terrain, magie, variante ou icône d'attribut :
 * tous partagent l'espace de noms plat du dossier d'illustrations.
 *
 * Elle vivait dans `CardDatabase`, un module à état qu'il fallait `init()`.
 * Personne ne l'importait donc pour construire une chaîne : 12 sites
 * réécrivaient le gabarit à la main, et le helper documenté n'était appelé que
 * 3 fois. Ici, dans un module PUR et sans import, elle est à portée de tout le
 * monde — y compris de `three/UnitCardEl`, à qui le lint interdit `data/`… mais
 * qui importe déjà ce fichier-ci.
 */
export function illustrationUrl(id: string): string {
  return `/illustrations/${id}`;
}

export type VariantMap = Record<string, string>;   // card_id → id d'illustration
export type Side = 'player' | 'enemy';

let _player: VariantMap = {};
let _enemy: VariantMap = {};

/** Variantes du deck joué par le joueur local. */
export function setPlayerVariants(map: VariantMap | null | undefined): void {
  _player = map ?? {};
}

/**
 * Variantes du deck adverse. Alimenté par le PvP uniquement : en solo et en
 * tournoi, l'IA joue un deck public et garde l'art d'origine.
 */
export function setEnemyVariants(map: VariantMap | null | undefined): void {
  _enemy = map ?? {};
}


/**
 * Id d'illustration à rendre pour cette carte. Repli systématique sur
 * `cardId` : une variante supprimée du catalogue entre-temps rend l'art
 * d'origine, jamais un trou.
 */
export function artFor(cardId: string, side: Side = 'player'): string {
  return (side === 'enemy' ? _enemy : _player)[cardId] ?? cardId;
}
