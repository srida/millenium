// Le vocabulaire des stats d'unité, en un seul endroit.
//
// Il vivait en privé dans `TooltipHost`, qui s'en sert à trois titres (la
// légende de stats, les bonus de Shopping, la description d'un effet de
// terrain). L'annonce de terrain en a besoin à son tour : recopier la table
// aurait été s'autoriser à appeler « ATQ » d'un côté et « ATK » de l'autre.
export const STAT_LABELS: Record<string, string> = {
  atk: 'ATQ', hp: 'PV', attack_rate: 'VIT', range: 'POR', movement_rate: 'DEP',
};

/**
 * Les stats qui se lisent sur le COMPTEUR 0–100 et non en valeur absolue.
 *
 * ⚠️ Un « +7 ATQ » et un « +7 VIT » ne se lisent pas pareil : le premier est
 * une quantité, le second une position sur une échelle bornée. Les afficher
 * l'un comme l'autre est ce qui rendait l'ancien barème illisible — on écrit
 * donc « 92/100 » là où la borne aide, et « +7 » sur un delta.
 */
export const RATE_STAT_LABELS: Record<string, string> = {
  attack_rate: 'Vitesse d’attaque', movement_rate: 'Vitesse de déplacement',
};

export function isRateStat(stat: string): boolean {
  return stat in RATE_STAT_LABELS;
}

export function statLabel(stat: string): string {
  return STAT_LABELS[stat] ?? stat;
}
