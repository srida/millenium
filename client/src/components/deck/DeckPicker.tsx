/* eslint-disable @typescript-eslint/no-explicit-any */
// DeckPicker — sélecteur de deck compact, réutilisable en dehors du DeckSelector
// (Tournoi, Duel en ligne). C'est un CHOIX, pas un gestionnaire : éditer,
// dupliquer, renommer et supprimer restent dans DeckSelector.
//
// Le tap promeut aussi le deck en deck actif (DeckRepository) : les autres écrans
// lisent `getActiveDeck()` par défaut, et il serait déroutant de jouer un tournoi
// avec un deck que le menu continue d'afficher comme inactif.
import { useEffect } from 'react';
import * as DeckRepository from '../../data/DeckRepository.js';
import { useDeckStore } from '../../stores/deckStore.js';
import { useUiStore } from '../../stores/uiStore.js';
import { Button } from '../ui/primitives.js';

const MIN_DECK = 20;

export default function DeckPicker({
  value, onChange, disabled = false, emptyHint = 'Crée un deck pour jouer.',
}: {
  value: string | null;
  onChange: (deckName: string) => void;
  /** Verrouille le choix (partie/file d'attente déjà lancée avec ce deck). */
  disabled?: boolean;
  emptyHint?: string;
}) {
  const navigate = useUiStore(s => s.navigate);
  const decks = useDeckStore(s => s.decks);
  const refresh = useDeckStore(s => s.refresh);

  useEffect(() => { refresh(); }, [refresh]);

  if (decks.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 rounded-xl border-2 border-dashed border-line p-4 text-center">
        <div className="text-2xl">🃏</div>
        <p className="text-xs text-white/50">{emptyHint}</p>
        <Button variant="primary" onPointerDown={() => navigate('deck_selector', { mode: 'manage' })}>
          Créer un deck
        </Button>
      </div>
    );
  }

  return (
    <div className="w-full space-y-1.5">
      <div className="flex items-baseline gap-2">
        <span className="text-[10px] tracking-widest text-white/40">MON DECK</span>
        {disabled && <span className="text-[10px] text-white/30">— verrouillé</span>}
      </div>
      <div className="max-h-56 space-y-1.5 overflow-y-auto">
        {decks.map(d => {
          const on = d.name === value;
          return (
            <button
              key={d.name}
              disabled={disabled}
              onPointerDown={() => {
                if (disabled) return;
                (DeckRepository as any).setActiveDeck(d.name);
                refresh();
                onChange(d.name);
              }}
              className={`flex min-h-tap w-full items-center gap-2 rounded-lg border bg-surface-raised/70 px-3 py-2 text-left active:opacity-80 disabled:opacity-50 ${on ? 'border-gold' : 'border-line'}`}
            >
              <span
                className="h-3 w-3 flex-shrink-0 rounded-full"
                style={{ background: d.color ?? '#a86ee7', boxShadow: `0 0 8px -1px ${d.color ?? '#a86ee7'}` }}
              />
              <span className={`min-w-0 flex-1 truncate text-sm ${on ? 'font-bold text-gold' : 'text-white/80'}`}>{d.name}</span>
              <span className={`text-xs font-semibold tabular-nums ${d.count >= MIN_DECK ? 'text-success' : 'text-white/40'}`}>
                {d.count}
              </span>
              {on && <span className="text-xs text-gold">✓</span>}
            </button>
          );
        })}
      </div>
      <Button className="w-full text-xs" onPointerDown={() => navigate('deck_selector', { mode: 'manage' })}>
        Gérer mes decks
      </Button>
    </div>
  );
}
