// Ce qu'on DIT de la pioche d'un tour : combien de cartes, quels tiers, et d'où
// viennent les bonus.
//
// Module PUR — aucune database, aucun composant, aucun import hors des types de
// `logic/`. Même raison d'être que `data/BoardInfo.ts` et `data/SummonInfo.ts` :
// la suite vitest tourne en node SANS DOM, aucun test de composant n'est
// possible dans ce projet. La décision vit donc ici, `DrawPopup` ne fait que la
// rendre.
import type { DrawSourceEntry, DrawSummary, GuaranteedDraw } from '../logic/types.js';

/** Le glyphe d'une source de pioche. Les trois sont déjà lus ailleurs dans le
 *  jeu : ✨ le Shopping, 🧬 la lignée d'une unité, 🗺️ le terrain. */
export const DRAW_SOURCE_ICON: Record<DrawSourceEntry['kind'], string> = {
  magie: '✨',
  attribut: '🧬',
  terrain: '🗺️',
};

export interface DrawBonusRow {
  /** Clé stable pour React — une ligne par (source, référence, nature). */
  key: string;
  kind: DrawSourceEntry['kind'];
  icon: string;
  /** Id de la magie / de l'attribut / du terrain. Le NOM se résout côté
   *  composant : `logic/` n'importe pas `data/`, le registre ne porte donc que
   *  des ids (cf. `DrawSourceEntry`). */
  ref: string;
  /** Cartes créditées. 0 sur une pioche garantie, qui prend un slot existant. */
  amount: number;
  guaranteed: boolean;
}

/**
 * Le registre de provenance, prêt à afficher.
 *
 * ⚠️ Les entrées de MÊME source sont FONDUES (`+1` et `+1` du même attribut
 * donnent une ligne `+2`) : deux lignes identiques se liraient comme un doublon
 * d'affichage. Une pioche garantie ne fond jamais avec un bonus de carte — ce
 * ne sont pas les mêmes choses (l'une ajoute une carte, l'autre en oriente une).
 */
export function drawBonusRows(summary: DrawSummary | null | undefined): DrawBonusRow[] {
  const rows = new Map<string, DrawBonusRow>();
  for (const src of summary?.sources ?? []) {
    const guaranteed = !!src.guaranteed;
    const key = `${src.kind}|${src.ref}|${guaranteed ? 'G' : 'B'}`;
    const found = rows.get(key);
    if (found) { found.amount += src.value; continue; }
    rows.set(key, {
      key,
      kind: src.kind,
      icon: DRAW_SOURCE_ICON[src.kind] ?? '•',
      ref: src.ref,
      amount: src.value,
      guaranteed,
    });
  }
  return [...rows.values()];
}

/**
 * Le filtre d'une pioche garantie, en français — « Tier 3 », « Fusion »,
 * « Dragon », ou la combinaison. Les trois champs sont facultatifs et se
 * cumulent (ET), exactement comme `GameSession.startPreparation` les applique.
 *
 * `attributeName` est injecté : ce module ne connaît pas `AttributeDatabase`.
 */
export function guaranteedDrawLabel(
  draw: GuaranteedDraw | null | undefined,
  attributeName: (id: string) => string = (id) => id,
): string {
  if (!draw) return '';
  const parts: string[] = [];
  if (draw.tier) parts.push(`Tier ${draw.tier}`);
  if (draw.attribute) parts.push(attributeName(draw.attribute));
  return parts.length ? parts.join(' · ') : 'Au choix';
}

/**
 * Le gros chiffre de la popup : ce qui est RÉELLEMENT entré en main.
 *
 * ⚠️ C'est `drawnCount` et rien d'autre — jamais `baseCount + extraDraws`. Les
 * pioches garanties occupent un slot de la main normale au lieu d'en ajouter
 * un, et un pool de tiers vide ne rend rien du tout : la somme mentirait dans
 * les deux cas.
 */
export function drawnLabel(summary: DrawSummary | null | undefined): string {
  const n = summary?.drawnCount ?? 0;
  return n === 1 ? '1 carte' : `${n} cartes`;
}

/** Y a-t-il quelque chose à annoncer sous le chiffre ? */
export function hasDrawBonuses(summary: DrawSummary | null | undefined): boolean {
  return (summary?.sources?.length ?? 0) > 0;
}
