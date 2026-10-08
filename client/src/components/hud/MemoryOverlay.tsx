// Indicateur de diagnostic mémoire — admins seulement, activé depuis le menu
// d'options (`MemoryToggle`). Il lit, il ne participe à rien : aucun état de
// jeu, `pointer-events-none`.
import { useEffect, useState } from 'react';
import { useAuthStore } from '../../stores/authStore.js';
import { useUiStore } from '../../stores/uiStore.js';
import { useMemoryStore, scenesCount, type MemorySample } from '../../stores/memoryStore.js';
import { audioMemoryStats } from '../../audio/AudioManager.js';
import { Button } from '../ui/primitives.js';

type SceneProbe = () => { geometries: number; textures: number; programs: number };
let sceneProbe: SceneProbe | null = null;
/** Posé par `Board3DCanvas` tant qu'une scène est montée. */
export function setSceneProbe(p: SceneProbe | null): void { sceneProbe = p; }

const MB = 1024 * 1024;

function sample(): MemorySample {
  const a = audioMemoryStats();
  const g = sceneProbe?.() ?? null;
  const perf = performance as unknown as { memory?: { usedJSHeapSize: number } };
  return {
    t: Date.now(),
    scenes: scenesCount(),
    screen: useUiStore.getState().screen,
    heapMB: perf.memory ? +(perf.memory.usedJSHeapSize / MB).toFixed(1) : null,
    dom: document.getElementsByTagName('*').length,
    geometries: g?.geometries ?? null,
    textures: g?.textures ?? null,
    programs: g?.programs ?? null,
    sfxCount: a.sfxCount,
    sfxMB: +(a.sfxBytes / MB).toFixed(1),
    musicMB: +(a.musicBytes / MB).toFixed(1),
  };
}

function lines(s: MemorySample): string[] {
  return [
    `parties ${s.scenes} · écran ${s.screen}`,
    `JS ${s.heapMB ?? 'n/d'} Mo · DOM ${s.dom}`,
    `GPU géom ${s.geometries ?? '–'} · tex ${s.textures ?? '–'} · prog ${s.programs ?? '–'}`,
    `audio sfx ${s.sfxCount} = ${s.sfxMB} Mo · musique ${s.musicMB} Mo`,
  ];
}

export default function MemoryOverlay() {
  const isAdmin = useAuthStore(s => !!s.user?.is_admin);
  const visible = useMemoryStore(s => s.visible);
  const previous = useMemoryStore(s => s.previous);
  const record = useMemoryStore(s => s.record);
  const [cur, setCur] = useState<MemorySample | null>(null);
  const [showPrev, setShowPrev] = useState(true);

  const on = isAdmin && visible;
  useEffect(() => {
    if (!on) return;
    const tick = () => { const s = sample(); setCur(s); record(s); };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [on, record]);

  if (!on || !cur) return null;
  return (
    <div className="pointer-events-none fixed left-1 top-1 z-50 max-w-[22rem] rounded bg-black/70 p-1.5 font-mono text-[10px] leading-tight text-white/90">
      {lines(cur).map((l, i) => <div key={i}>{l}</div>)}
      {previous && showPrev && (
        <div className="mt-1 border-t border-white/20 pt-1 text-amber-300">
          <div>Dernier relevé avant le rechargement ({new Date(previous.t).toLocaleTimeString('fr-FR')}) :</div>
          {lines(previous).map((l, i) => <div key={i}>{l}</div>)}
          <Button className="pointer-events-auto mt-1 !min-h-0 px-2 py-0.5 text-[10px]" onPointerDown={() => setShowPrev(false)}>Masquer</Button>
        </div>
      )}
    </div>
  );
}
