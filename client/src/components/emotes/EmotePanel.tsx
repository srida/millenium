// Panneau de choix des messages rapides. Ouvert sous l'avatar du joueur ; se
// ferme en touchant ailleurs (calque transparent) ou la croix.
import { EMOTES } from '../../game/emotes.js';
import { useEmoteStore } from '../../stores/emoteStore.js';
import UiIcon from '../ui/UiIcon.js';
import MangaBubble from './MangaBubble.js';

export default function EmotePanel({ opponentName }: { opponentName: string }) {
  const open = useEmoteStore(s => s.open);
  const coolingDown = useEmoteStore(s => s.coolingDown);
  const muted = useEmoteStore(s => s.opponentMuted);
  const close = useEmoteStore(s => s.close);
  const send = useEmoteStore(s => s.send);
  const toggleMute = useEmoteStore(s => s.toggleMute);
  if (!open) return null;

  return (
    <>
      <div className="emote-backdrop" onPointerDown={close} />
      <div className="emote-panel" role="dialog" aria-label="Messages rapides" onPointerDown={e => e.stopPropagation()}>
        <div className="mb-2.5 flex items-center justify-between">
          <span className="text-[10px] tracking-[0.1em] text-white/50">MESSAGES RAPIDES</span>
          <button type="button" aria-label="Fermer" onClick={close} className="-m-1.5 flex h-7 w-7 items-center justify-center">
            <UiIcon id="UI_CLOSE" className="h-3.5 w-3.5 opacity-70" />
          </button>
        </div>
        <div className="emote-grid">
          {EMOTES.map(e => (
            <button
              key={e.id}
              type="button"
              aria-label={e.text.replace('\n', ' ')}
              className={`emote-pick${e.id === 'duel' ? ' emote-pick--wide' : ''}`}
              onClick={() => send(e.id)}
            >
              <MangaBubble text={e.text} shape={e.shape} />
            </button>
          ))}
          {coolingDown && <div className="emote-cooldown">Patiente un instant…</div>}
        </div>
        <button
          type="button"
          onClick={toggleMute}
          aria-pressed={muted}
          className="mt-2.5 flex min-h-[44px] w-full items-center justify-between gap-2 border-t border-line px-1 text-xs text-white/80"
        >
          <span className="truncate">Masquer les bulles de {opponentName}</span>
          <span className="emote-toggle" data-on={muted} />
        </button>
      </div>
    </>
  );
}
