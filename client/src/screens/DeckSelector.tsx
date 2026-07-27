/* eslint-disable @typescript-eslint/no-explicit-any */
// DeckSelector — écran unique de gestion et de sélection des decks. Source de
// vérité : DeckRepository ; deckStore reprojette après chaque mutation.
//
// Deux modes (params.mode), même liste et même carte de deck :
//
//   'manage' (« Mes decks », depuis le menu) — LE point où l'on choisit son deck :
//     un tap le promeut deck ACTIF, et le deck actif est celui joué partout
//     (partie solo, tournoi, duel en ligne). Porte aussi la gestion : éditer
//     (→ DeckBuilder), dupliquer, renommer, supprimer, créer.
//
//   'play' (« Jouer ») — on ne choisit QUE le deck de l'IA. Le deck du joueur est
//     le deck actif, affiché en récap non modifiable ; sans choix d'adversaire,
//     l'IA joue ce même deck en miroir.
//
// Tournoi et Duel en ligne ne passent plus par ici : ils consomment le deck actif.
import { useEffect, useState } from 'react';
import * as DeckRepository from '../data/DeckRepository.js';
import { useDeckStore, type DeckSummary } from '../stores/deckStore.js';
import { useUiStore, type DeckSelectorMode } from '../stores/uiStore.js';
import { Button, Modal } from '../components/ui/primitives.js';
import SelectedDeck from '../components/deck/SelectedDeck.js';

const TIER_BG: Record<number, string> = {
  1: 'bg-tier-1', 2: 'bg-tier-2', 3: 'bg-tier-3', 4: 'bg-tier-4', 5: 'bg-tier-5',
};
const MIN_DECK = 20;
const MAX_PER_TIER = 8;

const MODES: Record<DeckSelectorMode, { title: string; blurb: string }> = {
  manage: { title: 'Mes decks', blurb: 'Le deck actif est celui que tu joues partout : partie solo, tournoi, duel en ligne.' },
  play: { title: 'Partie solo', blurb: 'Choisis le deck de l\'IA. Sans choix, elle joue le tien en miroir.' },
};

export default function DeckSelector() {
  const navigate = useUiStore(s => s.navigate);
  const hideTooltip = useUiStore(s => s.hideTooltip);
  const mode = useUiStore(s => (s.params.mode as DeckSelectorMode | undefined) ?? 'manage');
  const manage = mode === 'manage';
  const decks = useDeckStore(s => s.decks);
  const activeDeck = useDeckStore(s => s.activeDeck);
  const refresh = useDeckStore(s => s.refresh);
  // Deck confié à l'EnemyAI (mode 'play'). null = miroir du deck actif.
  const [enemy, setEnemy] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);

  useEffect(() => { refresh(); }, [refresh]);

  const active = decks.find(d => d.name === activeDeck) ?? null;
  const canPlay = !!active && active.count >= MIN_DECK;

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

  // En gestion, taper un deck = le rendre actif (c'est la sélection). En partie
  // solo, taper = désigner l'adversaire ; re-taper le même le remet en miroir.
  function pick(name: string) {
    if (manage) { (DeckRepository as any).setActiveDeck(name); refresh(); return; }
    setEnemy(cur => (cur === name ? null : name));
  }

  // Tirage de l'adversaire au hasard, parmi les decks jouables seulement (un deck
  // incomplet ferait un match sans intérêt). Le résultat est affiché comme un
  // choix normal : on voit sur quoi on tombe, et re-taper relance le tirage.
  // Préférences dégressives : ni son propre deck (ce serait un miroir) ni le
  // tirage précédent, puis on relâche ces contraintes s'il ne reste rien.
  const drawable = decks.filter(d => d.count >= MIN_DECK);
  function randomEnemy() {
    const pool = [
      drawable.filter(d => d.name !== activeDeck && d.name !== enemy),
      drawable.filter(d => d.name !== enemy),
      drawable,
    ].find(p => p.length > 0);
    if (!pool) return;
    setEnemy(pool[Math.floor(Math.random() * pool.length)].name);
  }

  function play() {
    if (!canPlay || !active) return;
    navigate('game', { deckName: active.name, ...(enemy ? { enemyDeckName: enemy } : {}) });
  }

  // Le mode est propagé au builder pour que son retour revienne ici à l'identique.
  function openBuilder(deckName?: string) {
    navigate('deck_builder', { ...(deckName ? { deckName } : {}), mode });
  }

  return (
    <main className="flex min-h-dvh flex-col bg-surface text-white" onPointerDown={hideTooltip}>
      <header className="border-b border-line px-4 py-3">
        <div className="flex items-center gap-3">
          <Button className="px-3" onPointerDown={() => navigate('main_menu')}>◂</Button>
          <h1 className="text-lg font-bold tracking-wide">{MODES[mode].title}</h1>
          <span className="ml-auto text-xs text-white/40">{decks.length} deck{decks.length !== 1 ? 's' : ''}</span>
        </div>
        <p className="mt-1.5 text-xs text-white/50">{MODES[mode].blurb}</p>
      </header>

      <div className={`flex-1 space-y-3 overflow-y-auto p-4 ${manage ? 'pb-28' : 'pb-36'}`}>
        {decks.length === 0 && (
          <div className="flex flex-col items-center gap-2 py-16 text-center">
            <div className="text-4xl">🃏</div>
            <div className="text-sm text-white/70">Aucun deck sauvegardé</div>
            <div className="text-xs text-white/40">Crée un deck pour commencer à jouer.</div>
          </div>
        )}

        {/* Partie solo : rappel de son propre deck (non modifiable ici), puis la
            liste sert uniquement à désigner l'adversaire. */}
        {!manage && decks.length > 0 && (
          <>
            <SelectedDeck deckName={activeDeck} emptyHint="Choisis ton deck dans « Mes decks » pour jouer." />
            <div className="flex items-center gap-2 pt-1">
              <span className="text-[10px] tracking-widest text-white/40">DECK DE L'IA</span>
              <div className="h-px flex-1 bg-line" />
            </div>
            <div className="flex gap-2">
              <button
                onPointerDown={() => setEnemy(null)}
                className={`min-h-tap flex-1 rounded-xl border px-3 py-2 text-left active:opacity-80 ${enemy === null ? 'border-enemy bg-enemy/10' : 'border-line bg-surface-raised/70'}`}
              >
                <span className="block text-sm font-semibold">🪞 Miroir</span>
                <span className="block text-[10px] text-white/50">l'IA joue ton deck</span>
              </button>
              {drawable.length > 0 && (
                <button
                  onPointerDown={randomEnemy}
                  className="min-h-tap flex-1 rounded-xl border border-line bg-surface-raised/70 px-3 py-2 text-left active:opacity-80"
                >
                  <span className="block text-sm font-semibold">🎲 Aléatoire</span>
                  <span className="block text-[10px] text-white/50">tire un deck au hasard</span>
                </button>
              )}
            </div>
          </>
        )}

        {/* Une colonne en portrait (mobile), jusqu'à trois dès qu'il y a la largeur
            pour les tenir — la carte de deck reste lisible en dessous de ~340 px. */}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {decks.map(d => (
            <DeckCard
              key={d.name} deck={d}
              active={activeDeck === d.name}
              foe={!manage && enemy === d.name}
              showActions={manage}
              onSelect={() => pick(d.name)}
              onEdit={() => openBuilder(d.name)}
              onDuplicate={() => duplicate(d.name)}
              onRename={() => setRenaming(d.name)}
              onDelete={() => setDeleting(d.name)}
            />
          ))}
        </div>
      </div>

      <div className="pointer-events-auto fixed inset-x-0 bottom-0 space-y-2 border-t border-line bg-surface/95 p-4">
        {manage ? (
          <Button variant="primary" className="w-full py-3 text-base" onPointerDown={() => openBuilder()}>
            ＋ Créer un nouveau deck
          </Button>
        ) : (
          <>
            <Button variant="primary" disabled={!canPlay} className="w-full py-3 text-base" onPointerDown={play}>
              ⚔ Jouer{enemy ? ` contre ${enemy}` : ''}
            </Button>
            {!canPlay && (
              <p className="text-center text-xs text-gold">
                {active
                  ? `Ton deck est incomplet (${active.count}/${MIN_DECK} cartes).`
                  : 'Choisis ton deck dans « Mes decks » avant de jouer.'}
              </p>
            )}
          </>
        )}
      </div>

      {renaming && (
        <RenameModal
          name={renaming}
          onClose={() => setRenaming(null)}
          onConfirm={(newName) => {
            try { (DeckRepository as any).renameDeck(renaming, newName); }
            catch (e: any) { return e?.message ?? 'Erreur'; }
            if (enemy === renaming) setEnemy(newName);
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
                  if (enemy === deleting) setEnemy(null);
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
  deck, active, foe, showActions, onSelect, onEdit, onDuplicate, onRename, onDelete,
}: {
  deck: DeckSummary; active: boolean; foe: boolean; showActions: boolean;
  onSelect: () => void; onEdit: () => void; onDuplicate: () => void; onRename: () => void; onDelete: () => void;
}) {
  const valid = deck.count >= MIN_DECK;
  const hex = deck.color ?? '#a86ee7';
  const border = foe ? 'border-enemy' : active && showActions ? 'border-gold' : 'border-line';
  return (
    <div
      onPointerDown={onSelect}
      className={`rounded-xl border bg-surface-raised/70 p-3 transition-colors ${border}`}
    >
      <div className="flex items-center gap-2">
        <span className="h-3 w-3 flex-shrink-0 rounded-full" style={{ background: hex, boxShadow: `0 0 8px -1px ${hex}` }} />
        <span className="truncate text-sm font-bold">{deck.name}</span>
        {foe && <span className="rounded bg-enemy/20 px-1.5 text-[9px] font-bold text-enemy">ADVERSAIRE</span>}
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

      {/* La gestion n'apparaît qu'en mode 'manage' : en partie solo, la carte ne
          sert qu'à désigner l'adversaire. Emoji plutôt que glyphes typographiques
          (✎/⧉ rendent mal et illisibles à cette taille), comme partout ailleurs
          dans l'UI ; `title`/`aria-label` portent le sens. */}
      {showActions && (
        <div className="mt-3 flex gap-2" onPointerDown={(e) => e.stopPropagation()}>
          <IconButton label="Éditer le deck" icon="✏️" onTap={onEdit} />
          <IconButton label="Dupliquer" icon="📋" onTap={onDuplicate} />
          <IconButton label="Renommer" icon="🏷️" onTap={onRename} />
          <IconButton label="Supprimer" icon="🗑️" tone="danger" onTap={onDelete} />
        </div>
      )}
    </div>
  );
}

// Action de gestion réduite à une icône : le libellé passe en tooltip natif
// (survol web) et en nom accessible (lecteurs d'écran, où l'icône ne dit rien).
function IconButton({
  label, icon, tone = 'ghost', onTap,
}: { label: string; icon: string; tone?: 'ghost' | 'danger'; onTap: () => void }) {
  return (
    <Button
      variant={tone} className="flex-1 px-2 text-base leading-none"
      title={label} aria-label={label} onPointerDown={onTap}
    >{icon}</Button>
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
