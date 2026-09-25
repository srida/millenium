// Catalogue des MUSIQUES — `data/music.json`, édité depuis le panneau
// d'administration (onglet 🎵 Musiques). Même patron que `SfxDatabase` :
// `init()` qui ne jette jamais, un cache mémoire, et rien de plus — c'est
// `AudioManager` qui décide QUAND changer de thème et comment enchaîner.
//
// Plusieurs pistes peuvent partager un THÈME (menu principal, autres menus,
// tours 1-2 / 3-4 / 5) : c'est une playlist, `AudioManager` en tire une au
// hasard à chaque bascule de thème.
export interface MusicEntry {
  id: string;
  name?: string;
  theme: string;
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

/** Les pistes JOUABLES (avec fichier) de ce thème — jamais une entrée sans
 *  audio, qui rendrait le thème silencieux sans le dire. */
export function tracksForTheme(theme: string): MusicEntry[] {
  return (list ?? []).filter(m => m.theme === theme && m._has_audio);
}
