/* eslint-disable @typescript-eslint/no-explicit-any */
// DeckSelector — liste des decks du joueur : sélection du deck actif, jouer,
// éditer (setPendingEdit → DeckBuilder), dupliquer, renommer, supprimer, créer.
// Source de vérité : DeckRepository ; deckStore reprojette après chaque mutation.
import { useEffect, useState } from 'react';
import * as DeckRepository from '../data/DeckRepository.js';
import { useDeckStore, type DeckSummary } from '../stores/deckStore.js';
import { useUiStore } from '../stores/uiStore.js';
import { Button, Modal } from '../components/ui/primitives.js';

const TIER_BG: Record<number, string> = {
  1: 'bg-tier-1', 2: 'bg-tier-2', 3: 'bg-tier-3', 4: 'bg-tier-4', 5: 'bg-tier-5',
};
const MIN_DECK = 20;
const MAX_PER_TIER = 8;

export default function DeckSelector() {
  const navigate = useUiStore(s => s.navigate);
  const hideTooltip = useUiStore(s => s.hideTooltip);
  const decks = useDeckStore(s => s.decks);
  const activeDeck = useDeckStore(s => s.activeDeck);
  const refresh = useDeckStore(s => s.refresh);
  const [selected, setSelected] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);

  useEffect(() => { refresh(); }, [refresh]);
  useEffect(() => { if (!selected && activeDeck) setSelected(activeDeck); }, [activeDeck, selected]);

  function duplicate(name: string) {
    const deck = (DeckRepository as any).loadDeck(name);
    if (!deck) return;
    const base = name.replace(/ \(copie.*?\)$/, '');
    const newName = (DeckRepository as any).findFreeName(`${base} (copie)`);
    (DeckRepository as any).saveDeck(newName, deck);
    const color = (DeckRepository as any).getDeckColor?.(name);
    const tags = (DeckRepository as any).getDeckTags?.(name);
    if (color) (DeckRepository as any).setDeckColor?.(newName, color);
    if (tags?.length) (DeckRepository as any).setDeckTags?.(newName, tags);
    refresh();
  }

  function play() {
    if (!selected) return;
    (DeckRepository as any).setActiveDeck(selected);
    navigate('game', { deckName: selected });
  }

  return (
    <main className="flex min-h-dvh flex-col bg-surface text-white" onPointerDown={hideTooltip}>
      <header className="flex items-center gap-3 border-b border-line px-4 py-3">
        <Button className="px-3" onPointerDown={() => navigate('main_menu')}>◂</Button>
        <h1 className="text-lg font-bold tracking-wide">Choisir un deck</h1>
        <span className="ml-auto text-xs text-white/40">{decks.length} deck{decks.length !== 1 ? 's' : ''}</span>
      </header>

      <div className="flex-1 space-y-3 overflow-y-auto p-4 pb-28">
        {decks.length === 0 && (
          <div className="flex flex-col items-center gap-2 py-16 text-center">
            <div className="text-4xl">🃏</div>
            <div className="text-sm text-white/70">Aucun deck sauvegardé</div>
            <div className="text-xs text-white/40">Crée un deck pour commencer à jouer.</div>
          </div>
        )}

        {decks.map(d => (
          <DeckCard
            key={d.name} deck={d}
            selected={selected === d.name}
            active={activeDeck === d.name}
            onSelect={() => setSelected(d.name)}
            onEdit={() => navigate('deck_builder', { deckName: d.name })}
            onDuplicate={() => duplicate(d.name)}
            onRename={() => setRenaming(d.name)}
            onDelete={() => setDeleting(d.name)}
          />
        ))}

        <button
          onPointerDown={() => navigate('deck_builder')}
          className="flex min-h-tap w-full flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed border-line py-6 text-white/60 active:opacity-80"
        >
          <span className="text-2xl leading-none text-gold">+</span>
          <span className="text-sm font-semibold">Créer un deck</span>
        </button>
      </div>

      <div className="pointer-events-auto fixed inset-x-0 bottom-0 border-t border-line bg-surface/95 p-4">
        <Button variant="primary" disabled={!selected} className="w-full py-3 text-base" onPointerDown={play}>
          ⚔ Jouer avec ce deck
        </Button>
      </div>

      {renaming && (
        <RenameModal
          name={renaming}
          onClose={() => setRenaming(null)}
          onConfirm={(newName) => {
            try { (DeckRepository as any).renameDeck(renaming, newName); }
            catch (e: any) { return e?.message ?? 'Erreur'; }
            if (selected === renaming) setSelected(newName);
            setRenaming(null); refresh();
            return null;
          }}
        />
      )}

      {deleting && (
        <Modal onClose={() => setDeleting(null)}>
          <div className="text-center">
            <div className="mb-2 text-3xl">🗑️</div>
            <div className="text-sm">Supprimer le deck <span className="font-bold text-gold">{deleting}</span> ?</div>
            <div className="mt-4 flex gap-2">
              <Button className="flex-1" onPointerDown={() => setDeleting(null)}>Annuler</Button>
              <Button
                variant="danger" className="flex-1"
                onPointerDown={() => {
                  (DeckRepository as any).deleteDeck(deleting);
                  if (selected === deleting) setSelected(null);
                  setDeleting(null); refresh();
                }}
              >Supprimer</Button>
            </div>
          </div>
        </Modal>
      )}
    </main>
  );
}

function DeckCard({
  deck, selected, active, onSelect, onEdit, onDuplicate, onRename, onDelete,
}: {
  deck: DeckSummary; selected: boolean; active: boolean;
  onSelect: () => void; onEdit: () => void; onDuplicate: () => void; onRename: () => void; onDelete: () => void;
}) {
  const valid = deck.count >= MIN_DECK;
  const hex = deck.color ?? '#a86ee7';
  return (
    <div
      onPointerDown={onSelect}
      className={`rounded-xl border bg-surface-raised/70 p-3 transition-colors ${selected ? 'border-gold' : 'border-line'}`}
    >
      <div className="flex items-center gap-2">
        <span className="h-3 w-3 flex-shrink-0 rounded-full" style={{ background: hex, boxShadow: `0 0 8px -1px ${hex}` }} />
        <span className="truncate text-sm font-bold">{deck.name}</span>
        {active && <span className="rounded bg-gold/20 px-1.5 text-[9px] font-bold text-gold">ACTIF</span>}
        <span className={`ml-auto text-xs font-semibold tabular-nums ${valid ? 'text-success' : 'text-white/50'}`}>{deck.count} cartes</span>
      </div>

      <div className="mt-2 flex items-end gap-1.5">
        {[1, 2, 3, 4, 5].map(t => {
          const c = deck.dist[t] ?? 0;
          const pct = Math.max(c > 0 ? 14 : 5, Math.round((c / MAX_PER_TIER) * 100));
          return (
            <div key={t} className="flex flex-1 flex-col items-center gap-0.5">
              <div className="flex h-8 w-full items-end rounded-sm bg-black/40">
                <div className={`w-full rounded-sm ${TIER_BG[t]}`} style={{ height: `${pct}%` }} />
              </div>
              <span className="text-[9px] tabular-nums text-white/40">{c}</span>
            </div>
          );
        })}
      </div>

      {deck.tags.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {deck.tags.map(t => (
            <span key={t} className="rounded border border-gold/30 bg-gold/10 px-1.5 py-0.5 text-[10px] text-gold">✦ {t}</span>
          ))}
        </div>
      )}

      <div className="mt-3 flex gap-2" onPointerDown={(e) => e.stopPropagation()}>
        <Button className="flex-1 px-2 text-xs" onPointerDown={onEdit}>Éditer</Button>
        <Button className="flex-1 px-2 text-xs" onPointerDown={onDuplicate}>Dupliquer</Button>
        <Button className="flex-1 px-2 text-xs" onPointerDown={onRename}>Renommer</Button>
        <Button variant="danger" className="px-3 text-xs" onPointerDown={onDelete}>✕</Button>
      </div>
    </div>
  );
}

function RenameModal({ name, onClose, onConfirm }: { name: string; onClose: () => void; onConfirm: (n: string) => string | null }) {
  const [value, setValue] = useState(name);
  const [error, setError] = useState<string | null>(null);
  const trimmed = value.trim();
  return (
    <Modal onClose={onClose}>
      <div className="text-xs tracking-widest text-white/50">RENOMMER LE DECK</div>
      <input
        autoFocus value={value} maxLength={32}
        onChange={(e) => { setValue(e.target.value); setError(null); }}
        className="mt-2 min-h-tap w-full rounded-lg border border-line bg-surface px-3 text-sm text-white"
      />
      {error && <p className="mt-1 text-xs text-danger">{error}</p>}
      <div className="mt-3 flex gap-2">
        <Button className="flex-1" onPointerDown={onClose}>Annuler</Button>
        <Button
          variant="primary" className="flex-1" disabled={!trimmed || trimmed === name}
          onPointerDown={() => { const err = onConfirm(trimmed); if (err) setError(err); }}
        >Renommer</Button>
      </div>
    </Modal>
  );
}
