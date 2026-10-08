// Indicateur de diagnostic mémoire (admins seulement) : état d'affichage et
// dernier relevé. Sur iOS un onglet trop gourmand est tué puis rechargé sans
// un mot — le dernier relevé est donc écrit dans localStorage à chaque
// échantillon, et relu au démarrage suivant : c'est la seule trace de ce qui
// précédait le rechargement.
import { create } from 'zustand';

export interface MemorySample {
  t: number;
  /** Parties (scènes 3D) montées depuis l'ouverture de l'appli. */
  scenes: number;
  screen: string;
  heapMB: number | null;
  dom: number;
  geometries: number | null;
  textures: number | null;
  programs: number | null;
  sfxCount: number;
  sfxMB: number;
  musicMB: number;
}

const VISIBLE_KEY = 'millenium_show_mem';
const LAST_KEY = 'millenium_mem_last';

function read<T>(key: string): T | null {
  try { const v = localStorage.getItem(key); return v ? JSON.parse(v) as T : null; } catch { return null; }
}
function write(key: string, v: unknown): void {
  try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* indisponible : sans conséquence */ }
}

interface MemoryState {
  visible: boolean;
  /** Dernier relevé de la session PRÉCÉDENTE (celle qui s'est peut-être fait tuer). */
  previous: MemorySample | null;
  toggle: () => void;
  record: (s: MemorySample) => void;
}

export const useMemoryStore = create<MemoryState>((set) => ({
  visible: read<boolean>(VISIBLE_KEY) === true,
  previous: read<MemorySample>(LAST_KEY),
  toggle: () => set((s) => { write(VISIBLE_KEY, !s.visible); return { visible: !s.visible }; }),
  record: (sample) => write(LAST_KEY, sample),
}));

/** Compte les scènes 3D créées — un écran de jeu = une scène. */
let scenesCreated = 0;
export const noteSceneCreated = (): void => { scenesCreated++; };
export const scenesCount = (): number => scenesCreated;
