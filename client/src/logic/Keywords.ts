// LES MOTS-CLÉS — la lecture « cette unité porte-t-elle telle mécanique ? ».
//
// ⚠️ **Ce fichier ne porte QUE les mots-clés que le moteur d'effets ne peut pas
// exprimer.** Tour, Explosif et Appelant n'y sont pas et n'y seront jamais : ce
// sont des effets, ils vivent dans `effect-schema.mjs` / `compile.ts` avec un
// `quand` et des tâches, comme n'importe quel palier d'archétype. Ce qui passe
// ici est ce qui n'est pas une tâche mais une **durée de vie** — cf. `MOTS_CLES`
// (`effect-schema.mjs`), qui déclare la liste et dit pourquoi elle est étroite.
//
// ⚠️ La liste est IMPORTÉE de la racine, jamais recopiée : c'est ce qui dispense
// d'un jumeau à tenir d'accord (le geste de `speed-scale.mjs` dans `Unit.ts`).
// `admin.html` charge le même fichier, donc le `<select>` de la fiche d'attribut
// et cette lecture ne peuvent pas se contredire.
//
// ⚠️ Pur : aucun import de `data/`, aucun état. La liste d'attributs est
// **passée en argument** — c'est le même partage que `deps.attributeList`, et
// c'est ce qui permet au serveur, aux scripts et aux tests d'appliquer LA MÊME
// règle sur un catalogue quelconque.
import { MOTS_CLES, MOT_CLE_CATEGORY } from '../../../effect-schema.mjs';

export { MOT_CLE_CATEGORY };

export type MotCle = 'cimetiere_permanent';

/** La forme minimale d'un attribut que ce module lit — jamais `data/`. */
export interface AttributMotCle {
  id: string;
  categorie?: string;
  /** La mécanique que cet attribut apporte, si c'en est une. */
  mot_cle?: string;
}

/** Ce qu'un index rend : les ids par mot-clé, et ce qui n'a pas été reconnu. */
export interface IndexMotsCles {
  /** mot-clé → les ids d'attribut qui le portent. */
  parMotCle: Map<MotCle, Set<string>>;
  /**
   * Les `mot_cle` du catalogue que cette table ne connaît pas. **Jamais
   * silencieux** — c'est la discipline de `CompilationResult.refus` : une faute
   * de frappe en admin donnerait sinon un mot-clé qui ne fait rien, et rien à
   * l'écran ne le dirait. `keywords.test.ts` exige que la liste soit vide sur le
   * catalogue livré.
   */
  refus: { attribut: string; mot_cle: string }[];
}

/**
 * Indexe un catalogue d'attributs par mot-clé.
 *
 * ⚠️ La CATÉGORIE n'entre pas dans le verdict, et c'est volontaire : c'est le
 * champ `mot_cle` qui porte la mécanique, la catégorie ne fait que la ranger
 * pour l'affichage. Les faire dépendre l'une de l'autre rendrait un mot-clé muet
 * sur un attribut bien renseigné mais mal classé — une panne invisible, du genre
 * exact que ce projet refuse.
 */
export function indexeMotsCles(attributs: readonly AttributMotCle[] | null | undefined): IndexMotsCles {
  const parMotCle = new Map<MotCle, Set<string>>();
  const refus: IndexMotsCles['refus'] = [];
  for (const a of attributs ?? []) {
    const mot = a?.mot_cle;
    if (!mot) continue;
    if (!(mot in MOTS_CLES)) { refus.push({ attribut: a.id, mot_cle: mot }); continue; }
    const cle = mot as MotCle;
    if (!parMotCle.has(cle)) parMotCle.set(cle, new Set());
    parMotCle.get(cle)!.add(a.id);
  }
  return { parMotCle, refus };
}

/** Cette liste d'attributs porte-t-elle ce mot-clé ? */
export function porteMotCle(
  attributs: readonly string[] | null | undefined,
  motCle: MotCle,
  index: IndexMotsCles,
): boolean {
  const ids = index.parMotCle.get(motCle);
  if (!ids?.size) return false;
  for (const id of attributs ?? []) if (ids.has(id)) return true;
  return false;
}

/**
 * Le catalogue déclare-t-il ce mot-clé quelque part ?
 *
 * ⚠️ Le pendant de `GameSession._porteInvocation` : tant que personne n'écrit ce
 * contenu, l'appelant sort sèchement au lieu de balayer un cimetière à chaque
 * combat pour découvrir qu'il n'y a rien à épargner.
 */
export function catalogueDeclare(motCle: MotCle, index: IndexMotsCles): boolean {
  return (index.parMotCle.get(motCle)?.size ?? 0) > 0;
}
