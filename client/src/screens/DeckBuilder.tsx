/* eslint-disable @typescript-eslint/no-explicit-any */
// DeckBuilder — construction/édition d'un deck. Bibliothèque filtrable (tier /
// invocation / recherche) + lanes par tier. Règles : max/tier = min(8, pool),
// total ≥ 20 et nom requis pour enregistrer (validation bloquante continue).
// Mode édition via params.deckName. Source de vérité des decks : DeckRepository.
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import * as CardDatabase from '../data/CardDatabase.js';
import * as AttributeDatabase from '../data/AttributeDatabase.js';
import * as DeckRepository from '../data/DeckRepository.js';
import { illustrationUrl } from '../data/CardArt.js';
import * as PublicDeckDatabase from '../data/PublicDeckDatabase.js';
import { computeDeckTags } from '../data/DeckTags.js';
import { summonCostOf } from '../data/SummonInfo.js';
import type { Card } from '../logic/types.js';
import { primaryTier, tiersOf, hasTier } from '../logic/Tiers.js';
import { useUiStore, type DeckSelectorMode } from '../stores/uiStore.js';
import { useDeckStore } from '../stores/deckStore.js';
import { useCollectionStore } from '../stores/collectionStore.js';
import { useMissionStore } from '../stores/missionStore.js';
import { useCosmeticStore } from '../stores/cosmeticStore.js';
import { Button } from '../components/ui/primitives.js';
import { ScreenHeader } from '../components/ui/ScreenHeader.js';
import CardTile, { cardTileProps } from '../components/ui/CardTile.js';
import IllustrationPicker from '../components/deck/IllustrationPicker.js';
import DeckCoach from '../components/tutorial/DeckCoach.js';
import { updateProgress } from '../data/tutorialProgress.js';

const MIN_DECK = 20;
/** Édition admin d'un deck public : aucun joueur, donc aucune variante. */
const noVariants = () => [];
// Le filtre d'invocation porte sur le COÛT, plus sur une voie : les cinq voies
// sont devenues des attributs, et le `<select>` d'attributs juste au-dessus les
// propose déjà. Ce qu'on ne pouvait PAS demander avant et qu'on peut
// maintenant : « ce que je peux poser sans rien payer », ou « ce qui coûte
// deux matériels », quel que soit l'archétype.
const COST_FILTERS: { key: number; label: string }[] = [
  { key: 0, label: 'Sans coût' },
  { key: 1, label: '1 matériel' },
  { key: 2, label: '2 matériels' },
  { key: 3, label: '3+ matériels' },
];
/** Le seau de coût d'une carte : au-delà de 3, tout tombe dans le dernier. */
const costBucket = (card: Card) => Math.min(3, summonCostOf(card));
const DECK_COLORS = [
  '#d8564e', '#e4c65a', '#7cd88a', '#2f7d4f', '#6fc0e6', '#2f5bd8', '#e08a3a', '#a86ee7', '#e58ab8',
  '#f5f0e6', '#d9c7a3', '#9a9a9a', '#8b5a2b',
];
const TIER_TEXT: Record<number, string> = {
  1: 'text-tier-1', 2: 'text-tier-2', 3: 'text-tier-3', 4: 'text-tier-4', 5: 'text-tier-5',
};

type DeckData = Record<number, Card[]>;
const EMPTY: DeckData = { 1: [], 2: [], 3: [], 4: [], 5: [] };

/** La lane où cette carte est rangée, ou `null`. Une carte multi-tiers peut être
 *  dans n'importe laquelle des siennes — on ne la déduit jamais d'un calcul. */
function laneOf(d: DeckData, id: string): number | null {
  return [1, 2, 3, 4, 5].find(t => d[t].some(x => x.id === id)) ?? null;
}

/**
 * Où ranger une carte : le PLUS BAS de ses tiers qui a encore de la place, et on
 * monte d'un cran quand il est plein. `null` = plus une seule de ses lanes n'a
 * de place.
 *
 * ⚠️ C'est ce qui donne son sens au multi-tier : la carte COMBLE LES TROUS d'un
 * deck au lieu d'occuper d'office le haut du panier. Et elle ne compte jamais
 * que pour UNE carte, dans une seule lane — d'où l'unicité vérifiée sur tout le
 * deck et jamais sur la seule lane visée.
 */
function laneFor(c: Card, d: DeckData, tierMax: Record<number, number>): number | null {
  return tiersOf(c).find(t => d[t] && d[t].length < tierMax[t]) ?? null;
}


export default function DeckBuilder() {
  const navigate = useUiStore(s => s.navigate);
  const hideTooltip = useUiStore(s => s.hideTooltip);
  const refreshDecks = useDeckStore(s => s.refresh);

  // Nom du deck à éditer, figé au montage. Il vient du param de navigation, et
  // de nulle part ailleurs : le détour par `sessionStorage` (setPendingEdit /
  // consumePendingEdit) était mort — plus personne ne POSAIT la clé, donc le
  // repli rendait toujours null, maintenu en vie par un `?.` défensif.
  const [editName] = useState<string | null>(
    () => (useUiStore.getState().params.deckName as string | undefined) ?? null,
  );

  // Édition d'un deck PUBLIC depuis le panneau admin (iframe, ?publicDeckId=) :
  // ni collection du joueur, ni DeckRepository local — la source et la cible
  // sont l'API /api/decks, et le retour se fait par postMessage au parent
  // plutôt que par navigate() (il n'y a pas de DeckSelector à retrouver).
  const [publicDeckId] = useState<string | null>(() => (useUiStore.getState().params.publicDeckId as string | undefined) ?? null);
  const isAdminEdit = publicDeckId != null;

  // Mode du DeckSelector d'où l'on vient : le retour doit y ramener à
  // l'identique. Figé au montage, comme editName.
  const [backMode] = useState<DeckSelectorMode>(() => useUiStore.getState().params.mode ?? 'manage');

  // Premier deck construit depuis le tutoriel : le guide s'affiche et le retour
  // ramène au tutoriel, pas au sélecteur de decks (d'où l'on ne vient pas).
  // Figé au montage comme `backMode` — l'écran ne doit pas changer de nature en
  // cours de route.
  const [isTutorial] = useState<boolean>(() => useUiStore.getState().params.tutorial === true);

  const back = () => {
    if (isAdminEdit) { window.parent.postMessage({ type: 'soulforge-deckbuilder-close' }, window.location.origin); return; }
    if (isTutorial) { navigate('tutorial'); return; }
    navigate('deck_selector', { mode: backMode });
  };

  const allCards = useMemo(() => (CardDatabase as any).getAllCards()
    .slice().sort((a: Card, b: Card) => primaryTier(a) !== primaryTier(b)
      ? primaryTier(a) - primaryTier(b)
      : a.name.localeCompare(b.name, 'fr')) as Card[], []);
  const tierMax = useMemo(() => {
    const m: Record<number, number> = {};
    for (let t = 1; t <= 5; t++) m[t] = Math.min(8, (CardDatabase as any).getCardsByTier(t).length);
    return m;
  }, []);

  // Collection du joueur : seules ses cartes sont sélectionnables. Rechargée au
  // montage pour refléter un déblocage obtenu depuis la dernière visite.
  // Non pertinent en édition admin d'un deck public : le catalogue entier est
  // disponible (il n'y a pas de « joueur » propriétaire d'un deck public).
  const ownedIds = useCollectionStore(s => s.ownedIds);
  const collectionLoaded = useCollectionStore(s => s.loaded);
  useEffect(() => { if (!isAdminEdit) void useCollectionStore.getState().load(true); }, [isAdminEdit]);
  // Variantes possédées : même raison de recharger au montage que la
  // collection — un achat fait depuis la dernière visite doit être proposé.
  const loadCosmetics = useCosmeticStore(s => s.load);
  const cosmeticSnapshot = useCosmeticStore(s => s.snapshot);
  useEffect(() => { if (!isAdminEdit) void loadCosmetics(true); }, [isAdminEdit, loadCosmetics]);
  const ownedVariantsFor = useMemo(
    () => (cardId: string) => useCosmeticStore.getState().ownedVariantsFor(cardId),
    // `cosmeticSnapshot` n'est pas lu ici : il force la re-création de la
    // fonction après un achat, pour que les badges réapparaissent.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- cf. ci-dessus
    [cosmeticSnapshot],
  );
  // Dos de cartes débloqués (offerts + achetés) — même instantané que les
  // variantes, `loadCosmetics` ci-dessus le couvre déjà.
  // ⚠️ Passe par `useMemo`, jamais par un sélecteur Zustand inline : `?? []`
  // alloue un tableau NEUF à chaque appel tant que `snapshot` est encore nul, et
  // `useSyncExternalStore` y lit un « a changé » à chaque rendu — boucle de
  // rendu (« Maximum update depth exceeded »), constatée à l'écran. Même garde
  // que `ownedVariantsFor` juste au-dessus : la référence n'est recalculée que
  // lorsque `cosmeticSnapshot` change réellement.
  const ownedCardBacks = useMemo(
    () => useCosmeticStore.getState().selectableCardBacks(),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- cf. ownedVariantsFor : cosmeticSnapshot force la re-dérivation après un achat
    [cosmeticSnapshot],
  );
  const owns = useMemo(() => (id: string) => isAdminEdit || ownedIds.has(id), [ownedIds, isAdminEdit]);
  const ownedCount = useMemo(() => isAdminEdit ? allCards.length : allCards.filter(c => ownedIds.has(c.id)).length, [allCards, ownedIds, isAdminEdit]);

  const [deckData, setDeckData] = useState<DeckData>(EMPTY);
  const [name, setName] = useState(editName ?? '');
  const [color, setColor] = useState<string | null>(null);
  // Illustrations choisies pour ce deck : { card_id: id_de_variante }. Le
  // « défaut » est une ABSENCE d'entrée, jamais une entrée qui pointe sur la
  // carte elle-même — le méta reste petit et le filtre serveur trivial.
  const [variants, setVariants] = useState<Record<string, string>>({});
  // Dos de carte choisi pour CE deck — `null` = pas de choix, la popup de
  // pioche retombe sur celui du profil (cf. RoundStart.tsx).
  const [cardBack, setCardBack] = useState<string | null>(null);
  const [skinning, setSkinning] = useState<Card | null>(null);
  const [tab, setTab] = useState<'lib' | 'deck'>('lib');
  const [tierFilters, setTierFilters] = useState<number[]>([]);
  const [costFilters, setCostFilters] = useState<number[]>([]);
  const [attributeFilter, setAttributeFilter] = useState('');
  const [search, setSearch] = useState('');
  const allAttributes = useMemo(() => (AttributeDatabase as any).getAllAttributes()
    .slice().sort((a: any, b: any) => a.name.localeCompare(b.name, 'fr')), []);
  // Les cartes non possédées sont masquées par défaut (la bibliothèque montre ce
  // avec quoi on peut jouer) ; ce chip les révèle, verrouillées et intapables,
  // pour qu'on voie ce qu'il reste à débloquer.
  const [showLocked, setShowLocked] = useState(false);

  // Préchargement en mode édition
  // Decks enregistrés avant la règle d'unicité : on retire les doublons au
  // chargement (sinon les rééditer les conserverait), et on le DIT — le total
  // change sous les yeux du joueur, il ne doit pas avoir à le deviner.
  const [dropped, setDropped] = useState(0);

  useEffect(() => {
    if (!editName) return;
    const saved = (DeckRepository as any).loadDeck(editName) as Record<string, string[]> | null;
    if (saved) {
      const d: DeckData = { 1: [], 2: [], 3: [], 4: [], 5: [] };
      let dupes = 0;
      for (let t = 1; t <= 5; t++) {
        const cards = (saved[String(t)] ?? []).map((id: string) => (CardDatabase as any).getCard(id)).filter(Boolean) as Card[];
        const seen = new Set<string>();
        for (const c of cards) {
          if (seen.has(c.id)) { dupes++; continue; }
          seen.add(c.id);
          d[t].push(c);
        }
      }
      setDeckData(d);
      setDropped(dupes);
    }
    setColor((DeckRepository as any).getDeckColor?.(editName) ?? null);
    setVariants((DeckRepository as any).getDeckVariants?.(editName) ?? {});
    setCardBack((DeckRepository as any).getDeckCardBack?.(editName) ?? null);
  }, [editName]);

  // Préchargement en mode admin (deck public) : source = /api/decks, pas
  // DeckRepository. Pas de dédoublonnage silencieux ici — un deck public mal
  // formé doit se voir tel quel plutôt que de perdre des cartes sans le dire.
  useEffect(() => {
    if (!publicDeckId) return;
    // Le `catch` garde l'écran utilisable (grille vide, éditable) au lieu de
    // laisser filer une promesse rejetée : le catalogue public est injoignable,
    // ce n'est pas une raison pour perdre le DeckBuilder.
    (async () => {
      try {
        await (PublicDeckDatabase as any).init();
      } catch { return; }
      const pd = (PublicDeckDatabase as any).getDeck(publicDeckId) as { name?: string; deck?: Record<string, string[]> } | null;
      if (!pd) return;
      const d: DeckData = { 1: [], 2: [], 3: [], 4: [], 5: [] };
      for (let t = 1; t <= 5; t++) {
        d[t] = (pd.deck?.[String(t)] ?? []).map((id: string) => (CardDatabase as any).getCard(id)).filter(Boolean) as Card[];
      }
      setDeckData(d);
      setName(pd.name ?? '');
    })();
  }, [publicDeckId]);

  const total = [1, 2, 3, 4, 5].reduce((s, t) => s + deckData[t].length, 0);
  const tierOk = [1, 2, 3, 4, 5].every(t => deckData[t].length <= tierMax[t]);
  const valid = name.trim().length > 0 && total >= MIN_DECK && tierOk;

  const filtered = allCards.filter(c => {
    if (!showLocked && !owns(c.id)) return false;
    if (tierFilters.length && !tierFilters.some(t => hasTier(c, t))) return false;
    if (costFilters.length && !costFilters.includes(costBucket(c))) return false;
    if (attributeFilter && !(c.attributes ?? []).includes(attributeFilter)) return false;
    if (search.trim() && !c.name.toLowerCase().includes(search.trim().toLowerCase())) return false;
    return true;
  });

  // Cartes du deck chargé que le joueur ne possède pas (deck bâti avant un
  // changement de collection). Elles sont signalées, PAS supprimées d'office :
  // effacer le travail du joueur sans qu'il l'ait demandé serait pire.
  const lockedInDeck = collectionLoaded
    ? [1, 2, 3, 4, 5].reduce((n, t) => n + deckData[t].filter(c => !owns(c.id)).length, 0)
    : 0;

  // Une carte ne peut figurer qu'UNE fois dans un deck (la règle du doublon
  // interdit de toute façon deux exemplaires vivants de la même card_id sur le
  // board). Vérifié dans l'updater plutôt que sur `deckData` du rendu, pour ne
  // pas dépendre d'un état périmé si deux taps s'enchaînent.
  function addCard(c: Card) {
    // Garde-fou : la vignette verrouillée est déjà intapable, mais l'ajout ne
    // doit dépendre que de la collection, pas de l'état d'affichage.
    if (!owns(c.id)) return;
    setDeckData(d => {
      // ⚠️ Une carte multi-tiers ne compte QUE POUR UNE : l'unicité se vérifie
      // sur tout le deck, jamais sur la seule lane visée.
      if (laneOf(d, c.id) !== null) return d;
      const lane = laneFor(c, d, tierMax);
      if (lane === null) return d;
      return { ...d, [lane]: [...d[lane], c] };
    });
  }
  function removeCard(tier: number, idx: number) {
    setDeckData(d => ({ ...d, [tier]: d[tier].filter((_, i) => i !== idx) }));
  }
  // Retrait depuis la BIBLIOTHÈQUE, où l'on ne connaît pas l'index : la carte y
  // est unique (règle d'unicité), l'id suffit donc à la désigner.
  function removeCardById(c: Card) {
    setDeckData(d => {
      const lane = laneOf(d, c.id);
      return lane === null ? d : { ...d, [lane]: d[lane].filter(x => x.id !== c.id) };
    });
  }

  const [saving, setSaving] = useState(false);

  async function save() {
    if (!valid) return;
    const toSave: Record<string, string[]> = {};
    for (let t = 1; t <= 5; t++) toSave[String(t)] = deckData[t].map(c => c.id);

    if (isAdminEdit) {
      setSaving(true);
      try {
        await fetch(`/api/decks/${encodeURIComponent(publicDeckId!)}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: publicDeckId, name: name.trim(), deck: toSave }),
        });
      } finally {
        setSaving(false);
      }
      window.parent.postMessage({ type: 'soulforge-deckbuilder-saved' }, window.location.origin);
      return;
    }

    const finalName = name.trim();
    if ((DeckRepository as any).deckExists(finalName) && finalName !== editName) {
      if (!window.confirm(`Un deck "${finalName}" existe déjà. Écraser ?`)) return;
    }
    if (editName && editName !== finalName && (DeckRepository as any).deckExists(editName)) {
      (DeckRepository as any).deleteDeck(editName);
    }
    (DeckRepository as any).saveDeck(finalName, toSave);
    if (color) (DeckRepository as any).setDeckColor?.(finalName, color);
    (DeckRepository as any).setDeckTags?.(finalName, computeDeckTags([1, 2, 3, 4, 5].flatMap(t => deckData[t])));
    // Purge à l'ENREGISTREMENT, pas au retrait d'une carte : une carte retirée
    // puis remise dans la même session garde ainsi son illustration.
    const inDeck = new Set(Object.values(deckData).flat().map((c: any) => c.id));
    (DeckRepository as any).setDeckVariants?.(
      finalName,
      Object.fromEntries(Object.entries(variants).filter(([cardId]) => inDeck.has(cardId))),
    );
    (DeckRepository as any).setDeckCardBack?.(finalName, cardBack);
    // Tous les modes de jeu partent du deck actif : sans deck actif valide (1er
    // deck créé, deck actif supprimé), on adopte celui qu'on vient d'enregistrer.
    if (!(DeckRepository as any).hasActiveDeck?.()) (DeckRepository as any).setActiveDeck(finalName);
    // Mission famille « méta » : se valide sans jouer, précieux les jours sans
    // temps. Événement isolé → envoyé tout de suite (pas de lot de partie).
    void useMissionStore.getState().emitMeta('deck_saved', { card_count: total });
    if (isTutorial) updateProgress({ deck: true });
    refreshDecks();
    back();
  }

  const need = Math.max(0, MIN_DECK - total);

  return (
    <main className="flex min-h-dvh flex-col relative z-10 text-white" onPointerDown={hideTooltip}>
      <ScreenHeader
        title={isAdminEdit ? `Deck-building — ${publicDeckId}` : 'Deck-building'}
        onBack={back}
        right={<span className={`text-sm font-bold tabular-nums ${valid ? 'text-success' : 'text-gold'}`}>{total}/{MIN_DECK}</span>}
        below={(
          <div className="flex">
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
        )}
      />

      {dropped > 0 && (
        <p className="border-b border-line bg-gold/10 px-4 py-2 text-xs text-gold">
          ⚠ {dropped} doublon{dropped > 1 ? 's' : ''} retiré{dropped > 1 ? 's' : ''} : une carte ne peut figurer qu'une fois dans un deck.
        </p>
      )}

      {lockedInDeck > 0 && (
        <p className="border-b border-line bg-danger/10 px-4 py-2 text-xs text-danger">
          🔒 {lockedInDeck} carte{lockedInDeck > 1 ? 's' : ''} de ce deck n'{lockedInDeck > 1 ? 'ont' : 'a'} pas été débloquée{lockedInDeck > 1 ? 's' : ''} — retire-la{lockedInDeck > 1 ? 's' : ''} pour n'y garder que ta collection.
        </p>
      )}

      {tab === 'lib' ? (
        <LibraryPanel
          cards={filtered} total={allCards.length} ownedCount={ownedCount}
          deckData={deckData} tierMax={tierMax} owns={owns}
          showLocked={showLocked} setShowLocked={setShowLocked}
          search={search} setSearch={setSearch}
          tierFilters={tierFilters} setTierFilters={setTierFilters}
          costFilters={costFilters} setCostFilters={setCostFilters}
          attributeFilter={attributeFilter} setAttributeFilter={setAttributeFilter} allAttributes={allAttributes}
          onAdd={addCard} onRemove={removeCardById}
        />
      ) : (
        <DeckPanel
          deckData={deckData} tierMax={tierMax} name={name} setName={setName}
          color={color} setColor={setColor} showColor={!isAdminEdit} onRemove={removeCard} owns={owns}
          onClear={() => setDeckData(EMPTY)}
          variants={variants} onSkin={setSkinning}
          // Pas de cosmétique en édition de deck public : il n'y a pas de
          // « joueur » propriétaire, donc personne dont ce soient les variantes
          // ni les dos de carte débloqués.
          ownedVariantsFor={isAdminEdit ? noVariants : ownedVariantsFor}
          cardBack={cardBack} setCardBack={setCardBack}
          ownedCardBacks={isAdminEdit ? [] : ownedCardBacks}
        />
      )}

      {/* Guide du tutoriel : au-dessus du pied de page, EN FLUX — une bulle
          flottante masquerait forcément une partie de la grille de cartes. */}
      {isTutorial && (
        <DeckCoach
          total={total}
          perTier={Object.fromEntries([1, 2, 3, 4, 5].map(t => [t, deckData[t].length]))}
          tierMax={tierMax}
          name={name}
          tab={tab}
          valid={valid}
          minDeck={MIN_DECK}
        />
      )}

      {/* Pied de page COLLANT : « Enregistrer » est l'issue de l'écran, il ne
          doit jamais demander de scroller — pas plus que le retour. Opaque
          (`bg-surface`) parce que la grille de cartes passe dessous. */}
      <div className="sticky bottom-0 z-20 shrink-0 border-t border-line bg-surface p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <div className="mb-2 text-center text-xs">
          {valid
            ? <span className="text-success">✓ Deck valide · prêt à enregistrer</span>
            : need > 0
              ? <span className="text-gold">Encore {need} carte{need > 1 ? 's' : ''} (min. {MIN_DECK})</span>
              : <span className="text-gold">Nomme ton deck pour enregistrer</span>}
        </div>
        <Button variant="primary" disabled={!valid || saving} className="w-full py-3" onPointerDown={() => void save()}>
          {saving ? '…' : '▸ Enregistrer le deck'}
        </Button>
      </div>

      {skinning && (
        <IllustrationPicker
          card={skinning}
          current={variants[skinning.id] ?? skinning.id}
          options={ownedVariantsFor(skinning.id)}
          onPick={(illustrationId) => setVariants(prev => {
            const next = { ...prev };
            // Revenir à l'origine RETIRE l'entrée : le défaut est une absence.
            if (illustrationId === skinning.id) delete next[skinning.id];
            else next[skinning.id] = illustrationId;
            return next;
          })}
          onClose={() => setSkinning(null)}
        />
      )}
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
  cards, total, ownedCount, deckData, tierMax, owns, showLocked, setShowLocked, search, setSearch,
  tierFilters, setTierFilters, costFilters, setCostFilters,
  attributeFilter, setAttributeFilter, allAttributes, onAdd, onRemove,
}: any) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="space-y-2 border-b border-line p-3">
        <input
          type="search" placeholder="Rechercher une carte…" value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="min-h-tap w-full rounded-lg border border-line bg-surface-raised px-3 text-white placeholder:text-white/30"
        />
        <select
          value={attributeFilter} onChange={(e) => setAttributeFilter(e.target.value)}
          className="min-h-tap w-full rounded-lg border border-line bg-surface-raised px-3 text-white"
        >
          <option value="">Tous les attributs</option>
          {allAttributes.map((a: any) => (
            <option key={a.id} value={a.id}>{a.name}</option>
          ))}
        </select>
        <div className="flex flex-wrap gap-1.5">
          {[1, 2, 3, 4, 5].map(t => (
            <Chip key={t} active={tierFilters.includes(t)}
              onTap={() => setTierFilters((f: number[]) => f.includes(t) ? f.filter(x => x !== t) : [...f, t])}>
              <span className={TIER_TEXT[t]}>T{t}</span>
            </Chip>
          ))}
        </div>
        <div className="flex flex-wrap gap-1.5">
          {COST_FILTERS.map(({ key, label }) => (
            <Chip key={key} active={costFilters.includes(key)}
              onTap={() => setCostFilters((f: number[]) => f.includes(key) ? f.filter(x => x !== key) : [...f, key])}>
              {label}
            </Chip>
          ))}
          {ownedCount < total && (
            <Chip active={showLocked} onTap={() => setShowLocked((v: boolean) => !v)}>🔒 Verrouillées</Chip>
          )}
        </div>
        <div className="text-[11px] text-white/40">
          {ownedCount}/{total} cartes débloquées · {cards.length} affichée{cards.length > 1 ? 's' : ''} · 1 exemplaire par deck
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {cards.length === 0
          ? <p className="py-10 text-center text-sm text-white/40">Aucune carte trouvée.</p>
          : (
            <div className="grid grid-cols-4 gap-2 sm:grid-cols-8">
              {cards.map((c: Card) => {
                // Non débloquée : cadenas + grisé franc, intapable — elle n'est
                // là que pour montrer ce qui reste à obtenir.
                // Tier plein : grisé franc, intapable.
                // Déjà dans le deck : liseré or (« tu l'as ») + grisé léger, et
                // le tap la RETIRE — l'aller-retour se fait sans changer
                // d'onglet, la grisaille disant seulement « déjà prise », pas
                // « intapable ». Ce cas prime sur les deux autres : c'est
                // justement sur un tier plein qu'il faut pouvoir faire de la
                // place, et une carte verrouillée héritée d'un ancien deck
                // reste retirable ici comme dans l'onglet Deck.
                const locked = !owns(c.id);
                const inDeck = laneOf(deckData, c.id) !== null;
                // « Plein » veut dire : plus une seule de ses lanes n'a de place.
                const full = laneFor(c, deckData, tierMax) === null;
                return (
                  <CardTile
                    key={c.id} {...cardTileProps(c)} size="h-auto w-full"
                    // Ajout/retrait au relâchement : un appui long ouvre le
                    // tooltip sans toucher au deck au passage.
                    tapOn="up" onTap={() => (inDeck ? onRemove(c) : onAdd(c))}
                    locked={locked}
                    disabled={!inDeck && (locked || full)}
                    dim={locked ? 'strong' : inDeck ? 'soft' : full ? 'strong' : 'none'}
                    highlight={inDeck ? 'selected' : 'none'}
                  />
                );
              })}
            </div>
          )}
      </div>
    </div>
  );
}

function DeckPanel({
  deckData, tierMax, name, setName, color, setColor, showColor = true, onRemove, owns, onClear,
  variants = {}, onSkin, ownedVariantsFor, cardBack = null, setCardBack, ownedCardBacks = [],
}: any) {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-3">
      <input
        type="text" placeholder="Nom du deck" value={name} maxLength={32}
        onChange={(e) => setName(e.target.value)}
        className="min-h-tap w-full rounded-lg border border-line bg-surface-raised px-3 font-bold text-white placeholder:text-white/30"
      />

      {showColor && (
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
      )}

      {/* Dos de carte : ce que la popup de pioche montre à l'ouverture de
          chaque tour, PAR DECK — comme les variantes, jamais comme l'avatar
          (qui reste un choix de profil). `null` = pas de choix pour ce deck,
          on retombe sur celui du profil. La section n'existe que s'il y a un
          choix à faire : un joueur sans aucun dos débloqué n'a rien à voir ici. */}
      {showColor && ownedCardBacks.length > 0 && (
        <div className="mt-3">
          <div className="mb-1 text-[10px] tracking-widest text-white/40">DOS DE CARTE</div>
          <div className="grid grid-cols-5 gap-2 sm:grid-cols-8">
            <button
              type="button"
              onPointerDown={() => setCardBack(null)}
              aria-label="Dos par défaut"
              title="Dos par défaut (celui de ton profil)"
              className={`flex aspect-[3/4] items-center justify-center overflow-hidden rounded-lg border text-lg text-white/40 ${cardBack === null ? 'border-gold' : 'border-line'} bg-surface-raised active:opacity-80`}
            >
              ✦
            </button>
            {ownedCardBacks.map((b: { id: string; name: string }) => (
              <button
                key={b.id}
                type="button"
                onPointerDown={() => setCardBack(b.id)}
                aria-label={`Dos ${b.name}`}
                title={b.name}
                className={`aspect-[3/4] overflow-hidden rounded-lg border ${cardBack === b.id ? 'border-gold' : 'border-line'} bg-surface-raised active:opacity-80`}
              >
                <img
                  src={illustrationUrl(b.id)}
                  alt=""
                  className="h-full w-full object-cover"
                  // Un dos retiré du catalogue depuis l'achat ne doit pas
                  // laisser un cadre cassé — le tap reste possible (il retombe
                  // sur le défaut à l'usage), seule l'image disparaît.
                  onError={(e) => { (e.currentTarget as HTMLImageElement).style.visibility = 'hidden'; }}
                />
              </button>
            ))}
          </div>
        </div>
      )}

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
                    {cards.map((c, idx) => {
                      const skins = ownedVariantsFor?.(c.id) ?? [];
                      const skinned = !!variants[c.id];
                      return (
                        // Une carte du deck non débloquée reste RETIRABLE : c'est
                        // la seule action qui la fait sortir du deck.
                        <div key={`${c.id}-${idx}`} className="relative">
                          <CardTile
                            {...cardTileProps(c)} size="h-auto w-full"
                            // Aperçu immédiat du choix en cours d'édition, sans
                            // toucher à l'état global de CardArt (non enregistré).
                            illustrationId={variants[c.id] ?? c.id}
                            tapOn="up" onTap={() => onRemove(t, idx)}
                            locked={!owns(c.id)} dim={owns(c.id) ? 'none' : 'strong'}
                          />
                          {/* Le tap retire la carte, l'appui long ouvre le tooltip :
                              les deux gestes sont pris. Le badge est donc un FRÈRE
                              de la vignette — un pointerdown qui l'atteint n'arme
                              jamais le retrait (et un <button> imbriqué serait du
                              HTML invalide). */}
                          {skins.length > 0 && (
                            <button
                              type="button"
                              title="Choisir l'illustration"
                              aria-label={`Illustration de ${c.name}`}
                              onPointerDown={(e) => { e.stopPropagation(); onSkin?.(c); }}
                              className={`absolute -bottom-1 -right-1 flex h-6 w-6 items-center justify-center rounded-full border bg-surface/90 text-[11px] ${skinned ? 'border-gold' : 'border-line'}`}
                            >
                              🎨
                            </button>
                          )}
                        </div>
                      );
                    })}
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
