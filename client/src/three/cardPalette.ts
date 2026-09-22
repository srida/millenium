// La palette de tier d'une CARTE — cadre gravé, encre, lueur, fond d'art.
//
// Elle vivait en privé dans `UnitCardEl.ts`, donc lisible de la seule carte du
// plateau. La carte 3D de la main et du cimetière est le MÊME objet : même
// feuille (`styles/board3d.css`), même cadre, même tier. Deux tables auraient
// fini par ne plus dire la même chose, et l'écart aurait été muet — une carte
// qui change de couleur en passant de la main au plateau ne ressemble pas à une
// panne.
//
// Pur, sans aucun import : `three/` le lit impérativement (`setProperty`),
// React le lit en objet de style. C'est ce qui permet aux deux d'en sortir les
// mêmes variables CSS sans que l'un dépende de l'autre.
//
// ⚠️ CE N'EST PAS la palette `--color-tier-N` du design system
// (`styles/index.css`), et les deux sont DÉCALÉES D'UN RANG : le vert est le
// tier 1 ici et le tier 2 là-bas, le bleu le 2 ici et le 3 là-bas, et ainsi de
// suite jusqu'à l'or (4 ici, 5 là-bas). Le rose du tier 5 n'a pas d'équivalent
// dans le design system, ni le gris du tier 1 du design system ici. Un même
// tier 3 est donc violet sur le plateau et bleu sur la vignette de main, de la
// boutique et du DeckBuilder. Les unifier est un changement VISIBLE sur l'un
// des deux camps ; tant que ce n'est pas tranché, ce module ne parle que du
// cadre de carte et ne prétend rien sur le reste de l'interface.

export interface TierFrame {
  /** Le trait du cadre — la couleur qui NOMME le tier. */
  edge: string;
  /** Le fond profond vers lequel le cadre s'éteint. */
  deep: string;
  /** L'encre claire : le haut du dégradé de cadre, les chiffres. */
  ink: string;
  /** La lueur portée, et la nébuleuse qui respire sous l'illustration. */
  glow: string;
  /** Le fond de la face, visible tant que l'illustration n'est pas chargée. */
  art: string;
}

/** Le tier de repli — celui d'une carte dont le tier est absent ou hors bornes.
 *  ⚠️ 2 et non 1 : un cadre de repli ne doit pas se confondre avec le plus bas
 *  tier réel, qui est une information légitime. */
export const FALLBACK_TIER = 2;

export const TIER_FRAMES: Readonly<Record<number, TierFrame>> = {
  1: { edge: '#5ad0a0', deep: '#0e2b20', ink: '#93ecc6', glow: 'rgba(90,208,160,.5)',   art: 'linear-gradient(155deg,#123528,#06110d)' },
  2: { edge: '#6fb2dc', deep: '#0d2333', ink: '#a9d6f2', glow: 'rgba(111,178,220,.5)',  art: 'linear-gradient(155deg,#122a3f,#060f18)' },
  3: { edge: '#9d74dc', deep: '#1c1038', ink: '#d6bdf6', glow: 'rgba(157,116,220,.55)', art: 'linear-gradient(155deg,#241442,#0c0820)' },
  4: { edge: '#cba85a', deep: '#2c2109', ink: '#ecd7a2', glow: 'rgba(203,168,90,.55)',  art: 'linear-gradient(155deg,#3a2c12,#140f06)' },
  5: { edge: '#d86a7e', deep: '#2f1119', ink: '#f5b3bf', glow: 'rgba(216,106,126,.52)', art: 'linear-gradient(155deg,#3a1420,#140609)' },
};

/**
 * Le cadre d'un tier, avec son repli.
 *
 * ⚠️ Le repli est ici et nulle part ailleurs. `createUnitEl` en portait DEUX sur
 * la même ligne (`unit.tier ?? 2`, puis `TIER_CFG[tier] ?? TIER_CFG[2]`) : une
 * unité sans tier et une unité de tier 9 n'ont aucune raison d'être traitées à
 * deux endroits différents. Et `tiersOf` n'ayant AUCUN repli — une carte sans
 * attribut de tier rend `[]` —, un appelant peut légitimement n'avoir rien à
 * passer.
 */
export function frameForTier(tier: number | null | undefined): TierFrame {
  return (tier != null && TIER_FRAMES[tier]) || TIER_FRAMES[FALLBACK_TIER];
}

/**
 * Les tiers DISTINCTS d'une carte, triés du plus bas au plus haut, avec repli.
 * `tiersOf` peut rendre `[]` (aucun attribut de tier) ou des doublons ne se
 * produisent jamais côté catalogue — mais un appelant de test ou un tableau
 * construit à la main pourrait en porter ; on ne fait pas confiance à l'ordre
 * ni à l'unicité en entrée, `frameBands` en dépend.
 */
function distinctTiers(tiers: number | readonly number[] | null | undefined): number[] {
  const list = Array.isArray(tiers) ? tiers : tiers != null ? [tiers] : [];
  const set = new Set(list.filter((t): t is number => t != null));
  return [...set].sort((a, b) => a - b);
}

/**
 * Le cadre en BANDES — une par tier distinct, la plus basse en haut, la plus
 * haute en bas. Une carte à un seul tier (ou sans tier, via le repli) rend une
 * seule bande : c'est ce qui fait de cette fonction le SEUL chemin, que la
 * carte porte un tier ou cinq — `tierFrameVars`/`splitFrameVars` en étaient
 * deux, un pour chaque cas, une règle recopiée deux fois.
 */
function frameBands(tiers: number | readonly number[] | null | undefined): TierFrame[] {
  const list = distinctTiers(tiers);
  return (list.length ? list : [null]).map(frameForTier);
}

/**
 * Le cadre, écrit dans les variables CSS que `styles/board3d.css` lit.
 *
 * ⚠️ C'EST ICI que vit le contrat entre la palette et la feuille. Le dégradé,
 * le fond d'art et la lueur voyagent en TROIS variables déjà composées
 * (`--uc-frame-bg`, `--uc-frame-art`, `--uc-frame-shadow`) — un empilement de
 * calques CSS, une bande par tier, à la hauteur `100 / N`% et à la position
 * `i / (N-1) * 100`% : pour N = 1 cette formule dégénère en une seule bande
 * pleine hauteur, PIXEL POUR PIXEL le rendu d'avant (une carte à un seul tier
 * ne change donc pas). `--uc-edge`/`--uc-glow` restent scalaires : le liseré
 * du haut et la nébuleuse ne lisent QUE le tier de la bande du HAUT, la plus
 * basse de la carte — deux flourishes ponctuels, pas la bordure elle-même.
 *
 * ⚠️ Les rayons de lueur (`--card-glow-near`/`-far`) et l'ombre supplémentaire
 * de la carte de main (`--card-extra-shadow`) restent des `var()` NON résolus
 * dans la chaîne produite ici : c'est `styles/board3d.css` qui les pose selon
 * le contexte (plateau vs main), et les imbriquer ainsi les laisse intacts.
 *
 * `test/card-palette.test.ts` sonde la feuille et exige que les deux
 * ensembles de noms coïncident, dans les deux sens.
 */
export function frameVars(tiers: number | readonly number[] | null | undefined): Record<string, string> {
  const bands = frameBands(tiers);
  const n = bands.length;
  const pos = (i: number) => (n > 1 ? `${(i / (n - 1)) * 100}%` : '50%');
  const size = `100% ${100 / n}%`;

  const bg = bands
    .map((f, i) => `linear-gradient(155deg, ${f.ink} 0%, ${f.edge} 44%, ${f.deep} 100%) 0% ${pos(i)} / ${size} no-repeat`)
    .join(', ');
  const art = bands
    .map((f, i) => `${f.art} 0% ${pos(i)} / ${size} no-repeat`)
    .join(', ');
  const shadow = bands
    .map(f => `0 0 var(--card-glow-near, 10px) 1px ${f.glow}, 0 0 var(--card-glow-far, 28px) -2px ${f.glow}`)
    .join(', ');

  return {
    '--uc-edge': bands[0].edge,
    '--uc-glow': bands[0].glow,
    '--uc-frame-bg':     bg,
    '--uc-frame-art':    art,
    '--uc-frame-shadow': shadow,
  };
}
