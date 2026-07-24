/* eslint-disable @typescript-eslint/no-explicit-any */
// DeckBuilder — construction/édition d'un deck. Bibliothèque filtrable (tier /
// invocation / recherche) + lanes par tier. Règles : max/tier = min(8, pool),
// total ≥ 20 et nom requis pour enregistrer (validation bloquante continue).
// Mode édition via consumePendingEdit() ou params.deckName. Source de vérité des
// decks : DeckRepository.
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import * as CardDatabase from '../data/CardDatabase.js';
import * as AttributeDatabase from '../data/AttributeDatabase.js';
import * as DeckRepository from '../data/DeckRepository.js';
import type { Card } from '../logic/types.js';
import { useUiStore } from '../stores/uiStore.js';
import { useDeckStore } from '../stores/deckStore.js';
import { Button } from '../components/ui/primitives.js';
import CardTile from '../components/deck/CardTile.js';

const MIN_DECK = 20;
const SUMMON_LABELS: Record<string, string> = {
  normal: 'Normale', sacrifice: 'Sacrifice', fusion: 'Fusion', heritage: 'Héritage', transformation: 'Transfo.',
};
const DECK_COLORS = ['#d8564e', '#e4c65a', '#7cd88a', '#2f7d4f', '#6fc0e6', '#2f5bd8', '#e08a3a', '#a86ee7', '#e58ab8'];
const TIER_TEXT: Record<number, string> = {
  1: 'text-tier-1', 2: 'text-tier-2', 3: 'text-tier-3', 4: 'text-tier-4', 5: 'text-tier-5',
};

type DeckData = Record<number, Card[]>;
const EMPTY: DeckData = { 1: [], 2: [], 3: [], 4: [], 5: [] };

function computeTags(deckData: DeckData): string[] {
  const all = [1, 2, 3, 4, 5].flatMap(t => deckData[t]);
  const n = all.length;
  const attrCounts: Record<string, number> = {};
  for (const card of all) for (const id of (card.attributes ?? [])) attrCounts[id] = (attrCounts[id] || 0) + 1;
  const dominant = Object.entries(attrCounts)
    .filter(([, c]) => c >= 2).sort((a, b) => b[1] - a[1]).slice(0, 2)
    .map(([id]) => (AttributeDatabase as any).getAttribute(id)?.name ?? id);
  const tags = [...dominant];
  if (n > 0) {
    const meleeR = all.filter(c => ((c as any).stats?.range ?? 1) === 1).length / n;
    if (meleeR >= 0.65) tags.push('Mêlée');
    else if (meleeR <= 0.35) tags.push('Distance');
    else {
      const avg = all.reduce((s, c) => s + ((c as any).stats?.atk ?? 0), 0) / n;
      if (all.filter(c => ((c as any).stats?.atk ?? 0) > 28).length >= 2) tags.push('Brutal');
      else if (avg > 22) tags.push('Offensif');
    }
  }
  return tags.slice(0, 3);
}

export default function DeckBuilder() {
  const navigate = useUiStore(s => s.navigate);
  const hideTooltip = useUiStore(s => s.hideTooltip);
  const refreshDecks = useDeckStore(s => s.refresh);

  // Nom du deck à éditer : param de navigation en priorité (flux SPA), sinon
  // pendingEdit (sessionStorage — survit à un rechargement). consumePendingEdit
  // n'est appelé qu'en repli, pour ne pas le vider inutilement.
  const [editName] = useState<string | null>(() => {
    const param = useUiStore.getState().params.deckName as string | undefined;
    return param ?? ((DeckRepository as any).consumePendingEdit?.() as string | null) ?? null;
  });

  const allCards = useMemo(() => (CardDatabase as any).getAllCards()
    .slice().sort((a: Card, b: Card) => a.tier !== b.tier ? a.tier - b.tier : a.name.localeCompare(b.name, 'fr')) as Card[], []);
  const tierMax = useMemo(() => {
    const m: Record<number, number> = {};
    for (let t = 1; t <= 5; t++) m[t] = Math.min(8, (CardDatabase as any).getCardsByTier(t).length);
    return m;
  }, []);

  const [deckData, setDeckData] = useState<DeckData>(EMPTY);
  const [name, setName] = useState(editName ?? '');
  const [color, setColor] = useState<string | null>(null);
  const [tab, setTab] = useState<'lib' | 'deck'>('lib');
  const [tierFilters, setTierFilters] = useState<number[]>([]);
  const [summonFilters, setSummonFilters] = useState<string[]>([]);
  const [search, setSearch] = useState('');

  // Préchargement en mode édition
  useEffect(() => {
    if (!editName) return;
    const saved = (DeckRepository as any).loadDeck(editName) as Record<string, string[]> | null;
    if (saved) {
      const d: DeckData = { 1: [], 2: [], 3: [], 4: [], 5: [] };
      for (let t = 1; t <= 5; t++) d[t] = (saved[String(t)] ?? []).map((id: string) => (CardDatabase as any).getCard(id)).filter(Boolean);
      setDeckData(d);
    }
    setColor((DeckRepository as any).getDeckColor?.(editName) ?? null);
  }, [editName]);

  const total = [1, 2, 3, 4, 5].reduce((s, t) => s + deckData[t].length, 0);
  const tierOk = [1, 2, 3, 4, 5].every(t => deckData[t].length <= tierMax[t]);
  const valid = name.trim().length > 0 && total >= MIN_DECK && tierOk;

  const filtered = allCards.filter(c => {
    if (tierFilters.length && !tierFilters.includes(c.tier)) return false;
    if (summonFilters.length && !summonFilters.includes((c as any).summon_type ?? 'normal')) return false;
    if (search.trim() && !c.name.toLowerCase().includes(search.trim().toLowerCase())) return false;
    return true;
  });

  function addCard(c: Card) {
    if (deckData[c.tier].length >= tierMax[c.tier]) return;
    setDeckData(d => ({ ...d, [c.tier]: [...d[c.tier], c] }));
  }
  function removeCard(tier: number, idx: number) {
    setDeckData(d => ({ ...d, [tier]: d[tier].filter((_, i) => i !== idx) }));
  }

  function save() {
    if (!valid) return;
    const finalName = name.trim();
    if ((DeckRepository as any).deckExists(finalName) && finalName !== editName) {
      if (!window.confirm(`Un deck "${finalName}" existe déjà. Écraser ?`)) return;
    }
    if (editName && editName !== finalName && (DeckRepository as any).deckExists(editName)) {
      (DeckRepository as any).deleteDeck(editName);
    }
    const toSave: Record<string, string[]> = {};
    for (let t = 1; t <= 5; t++) toSave[String(t)] = deckData[t].map(c => c.id);
    (DeckRepository as any).saveDeck(finalName, toSave);
    if (color) (DeckRepository as any).setDeckColor?.(finalName, color);
    (DeckRepository as any).setDeckTags?.(finalName, computeTags(deckData));
    refreshDecks();
    navigate('deck_selector');
  }

  const need = Math.max(0, MIN_DECK - total);

  return (
    <main className="flex min-h-dvh flex-col bg-surface text-white" onPointerDown={hideTooltip}>
      <header className="flex items-center gap-3 border-b border-line px-4 py-3">
        <Button className="px-3" onPointerDown={() => navigate('deck_selector')}>◂</Button>
        <h1 className="text-lg font-bold tracking-wide">Deck-building</h1>
        <span className={`ml-auto text-sm font-bold tabular-nums ${valid ? 'text-success' : 'text-gold'}`}>{total}/{MIN_DECK}</span>
      </header>

      <div className="flex border-b border-line">
        {(['lib', 'deck'] as const).map(t => (
          <button
            key={t}
            onPointerDown={() => setTab(t)}
            className={`min-h-tap flex-1 text-sm font-semibold ${tab === t ? 'border-b-2 border-gold text-gold' : 'text-white/50'}`}
          >
            {t === 'lib' ? 'Bibliothèque' : `Deck · ${total}`}
          </button>
        ))}
      </div>

      {tab === 'lib' ? (
        <LibraryPanel
          cards={filtered} total={allCards.length}
          deckData={deckData} tierMax={tierMax}
          search={search} setSearch={setSearch}
          tierFilters={tierFilters} setTierFilters={setTierFilters}
          summonFilters={summonFilters} setSummonFilters={setSummonFilters}
          onAdd={addCard}
        />
      ) : (
        <DeckPanel
          deckData={deckData} tierMax={tierMax} name={name} setName={setName}
          color={color} setColor={setColor} onRemove={removeCard}
          onClear={() => setDeckData(EMPTY)}
        />
      )}

      <div className="border-t border-line bg-surface/95 p-3">
        <div className="mb-2 text-center text-xs">
          {valid
            ? <span className="text-success">✓ Deck valide · prêt à enregistrer</span>
            : need > 0
              ? <span className="text-gold">Encore {need} carte{need > 1 ? 's' : ''} (min. {MIN_DECK})</span>
              : <span className="text-gold">Nomme ton deck pour enregistrer</span>}
        </div>
        <Button variant="primary" disabled={!valid} className="w-full py-3" onPointerDown={save}>
          ▸ Enregistrer le deck
        </Button>
      </div>
    </main>
  );
}

function Chip({ active, onTap, children }: { active: boolean; onTap: () => void; children: ReactNode }) {
  return (
    <button
      onPointerDown={onTap}
      className={`min-h-tap rounded-full border px-3 text-xs font-semibold ${active ? 'border-gold bg-gold/20 text-gold' : 'border-line bg-surface-raised text-white/60'}`}
    >{children}</button>
  );
}

function LibraryPanel({
  cards, total, deckData, tierMax, search, setSearch,
  tierFilters, setTierFilters, summonFilters, setSummonFilters, onAdd,
}: any) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="space-y-2 border-b border-line p-3">
        <input
          type="search" placeholder="Rechercher une carte…" value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="min-h-tap w-full rounded-lg border border-line bg-surface-raised px-3 text-sm text-white placeholder:text-white/30"
        />
        <div className="flex flex-wrap gap-1.5">
          {[1, 2, 3, 4, 5].map(t => (
            <Chip key={t} active={tierFilters.includes(t)}
              onTap={() => setTierFilters((f: number[]) => f.includes(t) ? f.filter(x => x !== t) : [...f, t])}>
              <span className={TIER_TEXT[t]}>T{t}</span>
            </Chip>
          ))}
        </div>
        <div className="flex flex-wrap gap-1.5">
          {Object.entries(SUMMON_LABELS).map(([k, label]) => (
            <Chip key={k} active={summonFilters.includes(k)}
              onTap={() => setSummonFilters((f: string[]) => f.includes(k) ? f.filter(x => x !== k) : [...f, k])}>
              {label}
            </Chip>
          ))}
        </div>
        <div className="text-[11px] text-white/40">{total} cartes · {cards.length} affichées</div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {cards.length === 0
          ? <p className="py-10 text-center text-sm text-white/40">Aucune carte trouvée.</p>
          : (
            <div className="grid grid-cols-4 gap-2 sm:grid-cols-6">
              {cards.map((c: Card) => {
                const copies = deckData[c.tier].filter((x: Card) => x.id === c.id).length;
                const full = deckData[c.tier].length >= tierMax[c.tier];
                return (
                  <CardTile
                    key={c.id} card={c} size="h-auto w-full"
                    onTap={() => onAdd(c)} disabled={full} dimmed={full}
                    badge={copies || null}
                  />
                );
              })}
            </div>
          )}
      </div>
    </div>
  );
}

function DeckPanel({ deckData, tierMax, name, setName, color, setColor, onRemove, onClear }: any) {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-3">
      <input
        type="text" placeholder="Nom du deck" value={name} maxLength={32}
        onChange={(e) => setName(e.target.value)}
        className="min-h-tap w-full rounded-lg border border-line bg-surface-raised px-3 text-base font-bold text-white placeholder:text-white/30"
      />

      <div className="mt-3">
        <div className="mb-1 text-[10px] tracking-widest text-white/40">COULEUR DU DECK</div>
        <div className="flex flex-wrap gap-2">
          {DECK_COLORS.map(c => (
            <button
              key={c} onPointerDown={() => setColor(c)}
              className={`h-7 w-7 rounded-full ${color === c ? 'ring-2 ring-gold ring-offset-2 ring-offset-surface' : ''}`}
              style={{ background: c }}
            />
          ))}
        </div>
      </div>

      <div className="mt-4 space-y-3">
        {[1, 2, 3, 4, 5].map(t => {
          const cards: Card[] = deckData[t];
          const full = cards.length >= tierMax[t];
          return (
            <div key={t} className="rounded-lg border border-line bg-surface-raised/50 p-2">
              <div className="mb-1.5 flex items-center gap-2">
                <span className={`text-xs font-bold ${TIER_TEXT[t]}`}>Tier {t}</span>
                <div className="h-px flex-1 bg-line" />
                <span className={`text-xs font-bold tabular-nums ${full ? 'text-danger' : 'text-white/50'}`}>{cards.length}/{tierMax[t]}</span>
              </div>
              {cards.length === 0
                ? <div className="py-2 text-center text-[11px] text-white/30">Aucune carte de tier {t}</div>
                : (
                  <div className="grid grid-cols-5 gap-1.5 sm:grid-cols-8">
                    {cards.map((c, idx) => (
                      <CardTile key={`${c.id}-${idx}`} card={c} size="h-auto w-full" onTap={() => onRemove(t, idx)} />
                    ))}
                  </div>
                )}
            </div>
          );
        })}
      </div>

      <button onPointerDown={onClear} className="mt-4 w-full text-center text-xs text-white/40 underline">
        Vider le deck
      </button>
    </div>
  );
}
