// Catalogue des THÈMES DE PARTIE — `data/music_themes.json`, édité depuis le
// panneau d'administration. Un thème n'est qu'un `{ id, name }` : c'est
// `MusicDatabase.game_theme` qui range chaque piste dans l'un d'eux, comme
// `card.set` range une carte dans un pack — jumeau minimal de
// `CardBackDatabase` (`init()` qui ne jette jamais, un cache mémoire).
export interface MusicThemeEntry {
  id: string;
  name?: string;
}

let list: MusicThemeEntry[] | null = null;

export async function init(): Promise<MusicThemeEntry[]> {
  if (list) return list;
  try {
    const res = await fetch('/api/music-themes');
    list = res.ok ? await res.json() : [];
  } catch {
    list = [];
  }
  return list ?? [];
}

export function getAllMusicThemes(): MusicThemeEntry[] {
  return list ?? [];
}

export function getMusicTheme(id: string): MusicThemeEntry | null {
  return (list ?? []).find(t => t.id === id) ?? null;
}
