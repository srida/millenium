// Les monnaies du jeu — icône, couleur, libellé, solde — définies UNE FOIS.
//
// Le CLAUDE.md l'affirmait déjà (« Icônes et couleurs sont définies une seule
// fois »), mais la table vivait en privé dans ProgressionStats : personne ne
// pouvait la lire, et les glyphes 💰/💎 étaient réécrits à la main dans une
// vingtaine d'endroits, ShopScreen entretenant même sa propre table parallèle.
//
// ⚠️ Ce que ça coûtait : GiftsScreen peignait les gemmes en `text-tier-5`, or
// `--color-tier-5` et `--color-gold` valent la MÊME valeur (#d4af61). Sur le
// seul écran qui montre les deux montants côte à côte, ils sortaient donc dans
// la même couleur. Partout ailleurs les gemmes sont violettes (`text-tier-4`).
//
// Le module vit dans `components/ui/` et non dans `data/` : `cls` est une classe
// Tailwind, c'est de la présentation, pas de la donnée de jeu.

/** Séparateur de milliers français, partagé (il était redéclaré 4 fois). */
export const fmt = new Intl.NumberFormat('fr-FR');

/** Clé côté CLIENT — celle des champs de `authStore.user`. */
export type CurrencyKey = 'gold' | 'gems';

/**
 * Clé côté SERVEUR, telle qu'elle voyage dans les routes d'achat
 * (`POST /me/shop/buy`, `/booster`, `/cosmetics/buy`). ⚠️ `golds` au pluriel,
 * là où le champ du joueur est `gold` : les deux ne se confondent pas, et c'est
 * la raison d'être de `CURRENCY_BY_WIRE`.
 */
export type WireCurrency = 'golds' | 'gems';

export interface CurrencyDef {
  key: CurrencyKey;
  /** Nom complet, pour `title` / `aria-label`. */
  label: string;
  /** Étiquette affichée dans les tuiles (mise en capitales à l'affichage). */
  short: string;
  /** Nom de l'unité au pluriel et en minuscules, pour une phrase suivie. */
  unit: string;
  /** 💰 plutôt que 🪙 : la pièce n'a pas de glyphe couleur partout et retombe
   *  en disque gris (constaté dans le rendu Chromium du preview). */
  icon: string;
  cls: string;
  balance: (user: { gold?: number; gems?: number } | null | undefined) => number;
}

export const CURRENCY: Record<CurrencyKey, CurrencyDef> = {
  gold: {
    key: 'gold', label: 'Gold', short: 'Gold', unit: 'golds',
    icon: '💰', cls: 'text-gold', balance: u => u?.gold ?? 0,
  },
  gems: {
    key: 'gems', label: 'Gemmes', short: 'Gemmes', unit: 'gemmes',
    icon: '💎', cls: 'text-tier-4', balance: u => u?.gems ?? 0,
  },
};

/** Ordre d'affichage : gold puis gemmes, partout. */
export const CURRENCIES: CurrencyDef[] = [CURRENCY.gold, CURRENCY.gems];

export const CURRENCY_BY_WIRE: Record<WireCurrency, CurrencyDef> = {
  golds: CURRENCY.gold,
  gems: CURRENCY.gems,
};

/**
 * L'XP n'est pas une monnaie — elle n'a pas de solde, elle n'existe qu'au
 * travers de la jauge de niveau. Elle est ici pour son seul glyphe, qui
 * apparaît à côté des deux autres dans les listes de gains.
 */
export const XP_ICON = '✨';
