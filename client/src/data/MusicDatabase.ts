// Catalogue des MUSIQUES — `data/music.json`, édité depuis le panneau
// d'administration (onglet 🎵 Musiques). Même patron que `SfxDatabase` :
// `init()` qui ne jette jamais, un cache mémoire, et rien de plus — c'est
// `AudioManager` qui décide QUAND changer de thème et comment enchaîner.
//
// Deux emplacements (`sound-schema.mjs` : `menu` / `game`) — plusieurs
// pistes peuvent partager le même, c'est une playlist. Une piste de partie
// porte la liste des TOURS qu'elle accompagne (`rounds`) et se CROISE avec
// un THÈME DE PARTIE (`game_theme`, id de `data/music_themes.json`, comme
// `card.set` range une carte dans un pack) : `AudioManager` verrouille un
// thème par match et n'en joue que les pistes, tour par tour.
//
// ⚠️ Les anciennes pistes `game_early` / `game_mid` / `game_late` sont
// converties AU CHARGEMENT (`normalizeMusic`) : rien en aval ne connaît plus
// les trois emplacements.
import { GAME_MUSIC_THEME, normalizeMusic } from '../../../sound-schema.mjs';

export interface MusicEntry {
  id: string;
  name?: string;
  /** L'emplacement : `menu` ou `game` (cf. `sound-schema.mjs`). */
  theme: string;
  /** Les tours (1 à 5) qu'accompagne une piste `game` — normalisés au
   *  chargement (triés, sans doublon). */
  rounds?: number[];
  /** Thème de partie (catalogue `music_themes.json`) — uniquement pour les
   *  pistes `game`. Absent = repli commun (cf. `tracksForGameRound`). */
  game_theme?: string;
  _has_audio?: boolean;
}

let list: MusicEntry[] | null = null;

export async function init(): Promise<MusicEntry[]> {
  if (list) return list;
  try {
    const res = await fetch('/api/music');
    list = res.ok ? ((await res.json()) as MusicEntry[]).map(m => normalizeMusic(m) as MusicEntry) : [];
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

/** Les pistes JOUABLES (avec fichier) de cet EMPLACEMENT (`menu` / `game`)
 *  — jamais une entrée sans audio, qui rendrait l'emplacement silencieux
 *  sans le dire. */
export function tracksForTheme(theme: string): MusicEntry[] {
  return (list ?? []).filter(m => m.theme === theme && m._has_audio);
}

/** Les pistes de partie JOUABLES qui accompagnent ce tour. */
function playableForRound(round: number): MusicEntry[] {
  return (list ?? []).filter(m => m.theme === GAME_MUSIC_THEME && m._has_audio && (m.rounds ?? []).includes(round));
}

/**
 * Les pistes JOUABLES d'un TOUR (1 à 5) pour un THÈME DE PARTIE donné.
 *
 * ⚠️ Repli à DEUX niveaux : `gameThemeId` absent (aucun thème verrouillé côté
 * appelant) OU sans aucune piste qui couvre CE tour → les pistes de ce tour
 * sans `game_theme` posé (le pool commun) ; et si même celui-là est vide,
 * toutes les pistes qui couvrent ce tour. Un thème de partie est une
 * PRÉFÉRENCE d'habillage, jamais une condition pour que la partie ait de la
 * musique — et rien n'exige qu'il couvre tous les tours : un thème qui ne
 * porte que les tours 1 et 2 laisse les autres au pool commun.
 *
 * Plusieurs pistes peuvent couvrir le même tour (« 1-2-3 » et « 3-4 ») :
 * elles sont toutes rendues, c'est `AudioManager` qui tranche.
 */
export function tracksForGameRound(round: number, gameThemeId: string | null): MusicEntry[] {
  const pool = playableForRound(round);
  if (gameThemeId) {
    const exact = pool.filter(m => m.game_theme === gameThemeId);
    if (exact.length) return exact;
  }
  const generic = pool.filter(m => !m.game_theme);
  return generic.length ? generic : pool;
}

/** Les ids de thème de partie qui ont AU MOINS une piste jouable, sur
 *  N'IMPORTE QUEL tour — c'est dans cette liste, et seulement elle,
 *  qu'`AudioManager` tire au sort : un thème créé en admin mais encore sans
 *  fichier ne doit jamais être choisi. Une couverture partielle reste
 *  éligible : le repli de `tracksForGameRound` couvre les tours manquants. */
export function playableGameThemeIds(): string[] {
  const ids = new Set<string>();
  for (const m of list ?? []) {
    if (m.theme === GAME_MUSIC_THEME && m._has_audio && m.game_theme && (m.rounds ?? []).length) ids.add(m.game_theme);
  }
  return [...ids];
}
