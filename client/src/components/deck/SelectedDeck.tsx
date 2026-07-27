// SelectedDeck — récap EN LECTURE SEULE du deck actif, pour les écrans qui le
// consomment sans le choisir (partie solo, tournoi, duel en ligne). Le deck se
// choisit au menu principal → « Mes decks » (DeckSelector, mode 'manage') ; ici
// on ne fait que rappeler avec quoi on joue.
//
// Seul cas navigable : aucun deck actif — il faut bien un chemin vers le choix,
// sinon l'écran est un cul-de-sac.
import { useEffect } from 'react';
import { useDeckStore } from '../../stores/deckStore.js';
import { useUiStore } from '../../stores/uiStore.js';
import { Button } from '../ui/primitives.js';

const MIN_DECK = 20;

export default function SelectedDeck({
  deckName, label = 'Mon deck', emptyHint = 'Choisis un deck pour jouer.',
}: {
  deckName: string | null;
  label?: string;
  emptyHint?: string;
}) {
  const navigate = useUiStore(s => s.navigate);
  const decks = useDeckStore(s => s.decks);
  const refresh = useDeckStore(s => s.refresh);

  useEffect(() => { refresh(); }, [refresh]);

  const deck = deckName ? decks.find(d => d.name === deckName) ?? null : null;

  if (!deck) {
    return (
      <div className="flex flex-col items-center gap-2 rounded-xl border-2 border-dashed border-line p-4 text-center">
        <div className="text-2xl">🃏</div>
        <p className="text-xs text-white/50">{emptyHint}</p>
        <Button variant="primary" onPointerDown={() => navigate('deck_selector', { mode: 'manage' })}>
          Mes decks
        </Button>
      </div>
    );
  }

  const hex = deck.color ?? '#a86ee7';
  return (
    <div className="flex items-center gap-2 rounded-xl border border-line bg-surface-raised/70 px-3 py-2">
      <span className="h-3 w-3 flex-shrink-0 rounded-full" style={{ background: hex, boxShadow: `0 0 8px -1px ${hex}` }} />
      <div className="min-w-0 flex-1">
        <div className="text-[9px] uppercase tracking-widest text-white/40">{label}</div>
        <div className="truncate text-sm font-bold text-gold">{deck.name}</div>
      </div>
      <span className={`text-xs font-semibold tabular-nums ${deck.count >= MIN_DECK ? 'text-success' : 'text-gold'}`}>
        {deck.count}
      </span>
    </div>
  );
}
