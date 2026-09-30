/* eslint-disable @typescript-eslint/no-explicit-any */
// EffectCatalogGrid — vignettes illustrées des magies ou des terrains ; l'effet
// s'obtient au tap, par le tooltip global (`uiStore.showTooltip`), comme pour
// une carte. Consultation pure : aucune règle ici, `TooltipHost` met l'effet en
// mots (`effectLabel` / `TerrainEffects`).
import { useRef } from 'react';
import { useUiStore, type TooltipContent } from '../../stores/uiStore.js';
import { Illustration, usePressSquash } from '../ui/primitives.js';
import { useWebLayout } from '../system/useWebLayout.js';

export interface CatalogEntry {
  id: string;
  name: string;
  _has_illustration?: boolean;
}

function Tile({ entry, content }: { entry: CatalogEntry; content: TooltipContent }) {
  const showTooltip = useUiStore(s => s.showTooltip);
  const ref = useRef<HTMLButtonElement>(null);
  // Case lue sur un `ref` : `usePressSquash` diffère l'appel (cf. TerrainChip).
  const { handlers } = usePressSquash<HTMLButtonElement>((e) => {
    e.stopPropagation();
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    showTooltip(content, { left: r.left, top: r.top, bottom: r.bottom, width: r.width, height: r.height });
  }, false, false);
  return (
    <button
      ref={ref}
      type="button"
      className="flex min-w-0 flex-col gap-1 rounded-lg border border-line bg-surface-raised p-1.5 text-left active:opacity-80"
      {...handlers}
    >
      <div className="aspect-square w-full overflow-hidden rounded-md bg-black/40">
        {entry._has_illustration && <Illustration id={entry.id} className="h-full w-full" />}
      </div>
      <span className="truncate text-[11px] font-bold text-white/80">{entry.name}</span>
    </button>
  );
}

export default function EffectCatalogGrid({ entries, toContent, emptyMessage }: {
  entries: CatalogEntry[];
  toContent: (e: any) => TooltipContent;
  emptyMessage: string;
}) {
  const web = useWebLayout();
  return (
    <div className={`min-h-0 flex-1 overflow-y-auto p-3 ${web ? 'px-22' : ''}`}>
      {entries.length === 0
        ? <p className="py-10 text-center text-sm text-white/40">{emptyMessage}</p>
        : (
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-5 lg:grid-cols-8">
            {entries.map(e => <Tile key={e.id} entry={e} content={toContent(e)} />)}
          </div>
        )}
    </div>
  );
}
