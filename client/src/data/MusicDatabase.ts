// Catalogue des MUSIQUES — `data/music.json`, édité depuis le panneau
// d'administration (onglet 🎵 Musiques). Même patron que `SfxDatabase` :
// `init()` qui ne jette jamais, un cache mémoire, et rien de plus — c'est
// `AudioManager` qui décide QUAND changer de thème et comment enchaîner.
//
// Quatre emplacements fixes (`sound-schema.mjs` : `menu` / `game_early` /
// `game_mid` / `game_late`) — plusieurs pistes peuvent partager le même,
// c'est une playlist. Les trois emplacements `game_*` suivent la
// progression du match (tours 1-2 / 3-4 / 5) et se CROISENT chacun avec un
// THÈME DE PARTIE (`game_theme`, id de `data/music_themes.json`, comme
// `card.set` range une carte dans un pack) : `AudioManager` verrouille un
// thème par match et n'en joue que les pistes, en suivant les trois
// emplacements au fil des tours.
import { GAME_MUSIC_SLOTS } from '../../../sound-schema.mjs';

export interface MusicEntry {
  id: string;
  name?: string;
  /** L'emplacement fixe : `menu`, `game_early`, `game_mid` ou `game_late`
   *  (cf. `sound-schema.mjs`). */
  theme: string;
  /** Thème de partie (catalogue `music_themes.json`) — uniquement pour les
   *  entrées d'un emplacement `game_*`. Absent = repli commun (cf.
   *  `tracksForGameTheme`). */
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

/** Les pistes JOUABLES (avec fichier) de cet EMPLACEMENT (`menu` /
 *  `game_early` / `game_mid` / `game_late`) — jamais une entrée sans audio,
 *  qui rendrait l'emplacement silencieux sans le dire. */
export function tracksForTheme(theme: string): MusicEntry[] {
  return (list ?? []).filter(m => m.theme === theme && m._has_audio);
}

/**
 * Les pistes JOUABLES d'un emplacement `game_*` pour un THÈME DE PARTIE
 * donné — `slot` est l'un de `game_early` / `game_mid` / `game_late`.
 *
 * ⚠️ Repli à DEUX niveaux : `gameThemeId` absent (aucun thème verrouillé côté
 * appelant) OU sans aucune piste qui le porte POUR CE MOMENT → toutes les
 * pistes de `slot` sans `game_theme` posé (le pool commun, celui d'avant
 * l'introduction des thèmes) ; et si même celui-là est vide, `AudioManager`
 * retombe plus loin sur la totalité de l'emplacement. Un thème de partie est
 * une PRÉFÉRENCE d'habillage, jamais une condition pour que la partie ait de
 * la musique — et rien n'exige qu'il couvre les trois moments à la fois : un
 * thème qui ne porte que les tours 1-2 laisse 3-4 et 5 au pool commun.
 */
export function tracksForGameTheme(slot: string, gameThemeId: string | null): MusicEntry[] {
  if (gameThemeId) {
    const exact = (list ?? []).filter(m => m.theme === slot && m._has_audio && m.game_theme === gameThemeId);
    if (exact.length) return exact;
  }
  const generic = (list ?? []).filter(m => m.theme === slot && m._has_audio && !m.game_theme);
  return generic.length ? generic : tracksForTheme(slot);
}

/** Les ids de thème de partie qui ont AU MOINS une piste jouable, sur
 *  N'IMPORTE LEQUEL des trois emplacements `game_*` — c'est dans cette
 *  liste, et seulement elle, qu'`AudioManager` tire au sort : un thème créé
 *  en admin mais encore sans fichier ne doit jamais être choisi. Une
 *  couverture partielle (un seul des trois moments) reste éligible : le
 *  repli de `tracksForGameTheme` couvre les moments manquants. */
export function playableGameThemeIds(): string[] {
  const ids = new Set<string>();
  for (const m of list ?? []) {
    if (GAME_MUSIC_SLOTS.includes(m.theme) && m._has_audio && m.game_theme) ids.add(m.game_theme);
  }
  return [...ids];
}
