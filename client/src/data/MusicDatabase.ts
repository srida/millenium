// Catalogue des MUSIQUES — `data/music.json`, édité depuis le panneau
// d'administration (onglet 🎵 Musiques). Même patron que `SfxDatabase` :
// `init()` qui ne jette jamais, un cache mémoire, et rien de plus — c'est
// `AudioManager` qui décide QUAND changer de thème et comment enchaîner.
//
// Deux emplacements fixes (`sound-schema.mjs` : `menu` / `game`) — plusieurs
// pistes peuvent partager le même, c'est une playlist. L'emplacement `game`
// se subdivise en THÈMES DE PARTIE (`game_theme`, id de
// `data/music_themes.json`, comme `card.set` range une carte dans un pack) :
// `AudioManager` en verrouille un par match et n'en joue que les pistes.
export interface MusicEntry {
  id: string;
  name?: string;
  /** L'emplacement fixe : `menu` ou `game` (cf. `sound-schema.mjs`). */
  theme: string;
  /** Thème de partie (catalogue `music_themes.json`) — uniquement pour les
   *  entrées `theme === 'game'`. Absent = repli commun (cf. `tracksForGameTheme`). */
  game_theme?: string;
  _has_audio?: boolean;
}

let list: MusicEntry[] | null = null;

export async function init(): Promise<MusicEntry[]> {
  if (list) return list;
  try {
    const res = await fetch('/api/music');
    list = res.ok ? await res.json() : [];
  } catch {
    list = [];
  }
  return list ?? [];
}

export function getAllMusic(): MusicEntry[] {
  return list ?? [];
}

export function musicUrl(id: string): string {
  return `/audio/${encodeURIComponent(id)}`;
}

/** Les pistes JOUABLES (avec fichier) de cet EMPLACEMENT (`menu` / `game`) —
 *  jamais une entrée sans audio, qui rendrait l'emplacement silencieux sans
 *  le dire. */
export function tracksForTheme(theme: string): MusicEntry[] {
  return (list ?? []).filter(m => m.theme === theme && m._has_audio);
}

/**
 * Les pistes JOUABLES de l'emplacement `game` pour un THÈME DE PARTIE donné.
 *
 * ⚠️ Repli à DEUX niveaux : `gameThemeId` absent (aucun thème configuré côté
 * appelant) OU sans aucune piste qui le porte → toutes les pistes `game`
 * sans `game_theme` posé (le pool commun, celui d'avant l'introduction des
 * thèmes) ; et si même celui-là est vide, `AudioManager` retombe plus loin
 * sur la totalité de l'emplacement `game`. Un thème de partie est une
 * PRÉFÉRENCE d'habillage, jamais une condition pour que la partie ait de la
 * musique.
 */
export function tracksForGameTheme(gameThemeId: string | null): MusicEntry[] {
  if (gameThemeId) {
    const exact = (list ?? []).filter(m => m.theme === 'game' && m._has_audio && m.game_theme === gameThemeId);
    if (exact.length) return exact;
  }
  const generic = (list ?? []).filter(m => m.theme === 'game' && m._has_audio && !m.game_theme);
  return generic.length ? generic : tracksForTheme('game');
}

/** Les ids de thème de partie qui ont AU MOINS une piste jouable — c'est
 *  dans cette liste, et seulement elle, qu'`AudioManager` tire au sort : un
 *  thème créé en admin mais encore sans fichier ne doit jamais être choisi,
 *  la partie tomberait silencieuse. */
export function playableGameThemeIds(): string[] {
  const ids = new Set<string>();
  for (const m of list ?? []) {
    if (m.theme === 'game' && m._has_audio && m.game_theme) ids.add(m.game_theme);
  }
  return [...ids];
}
