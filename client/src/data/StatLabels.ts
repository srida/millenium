// Le vocabulaire des stats d'unité, en un seul endroit.
//
// Il vivait en privé dans `TooltipHost`, qui s'en sert à trois titres (la
// légende de stats, les bonus de Shopping, la description d'un effet de
// terrain). L'annonce de terrain en a besoin à son tour : recopier la table
// aurait été s'autoriser à appeler « ATQ » d'un côté et « ATK » de l'autre.
export const STAT_LABELS: Record<string, string> = {
  atk: 'ATQ', hp: 'PV', attack_speed: 'VIT', range: 'POR', movement_speed: 'DEP',
};

export function statLabel(stat: string): string {
  return STAT_LABELS[stat] ?? stat;
}
