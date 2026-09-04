// Les deux beats d'ouverture d'un tour : l'annonce du changement de tour, puis
// la popup de pioche.
//
// ⚠️ Aucun des deux ne PILOTE quoi que ce soit — ils n'ont pas de minuteur à
// eux. `GameController` possède l'horloge qui les enchaîne (`_openRound`), comme
// il possède celle de l'annonce de terrain : deux horloges pour un même départ
// finiraient par ne plus s'accorder.
//
// ⚠️ La popup RÉVÈLE, elle ne PIOCHE pas. Quand elle apparaît, la main est déjà
// remplie : différer le tirage jusqu'au tap décalerait le flux semé de la
// simulation et du filet de déterminisme PvP, et déplacerait le point de capture
// de « Tout annuler ». Le tap lève un voile, il ne consomme aucun hasard.
import { useEffect, useRef, useState } from 'react';
import { useGameStore } from '../../stores/gameStore.js';
import { useAuthStore } from '../../stores/authStore.js';
import { Illustration, Modal } from '../ui/primitives.js';
import { attributeName } from '../ui/AttrIcon.js';
import * as CardBackDatabase from '../../data/CardBackDatabase.js';
import * as DeckRepository from '../../data/DeckRepository.js';
import * as MagieDatabase from '../../data/MagieDatabase.js';
import * as BoardDatabase from '../../data/BoardDatabase.js';
import { drawBonusRows, drawnLabel, guaranteedDrawLabel } from '../../data/DrawInfo.js';
import { cardName } from '../../data/gameNames.js';
import { ROUND_INTRO_MS } from '../../game/timings.js';
import type { DrawBonusRow } from '../../data/DrawInfo.js';

const MAX_ROUNDS = 5;
/** Durée du vol des dos vers la main, miroir de `--draw-deal-dur` (index.css). */
const DEAL_MS = 520;
/** Au-delà, la volée devient une bouillie : on en montre moins que la main n'en
 *  reçoit, et le chiffre annoncé reste le vrai (`drawnCount`). */
const MAX_FLYING = 8;

/**
 * « TOUR 3 / 5 ». Couche TRANSPARENTE (pas de `Modal`) : il n'y a rien à
 * masquer, et le voile noir ferait clignoter le board entre deux tours.
 *
 * ⚠️ `z-40`, pas plus : `TutorialCoach` est en `z-50` avec sa bulle tapable.
 */
export function RoundIntro() {
  const intro = useGameStore(s => s.roundIntro);
  const controller = useGameStore(s => s.controller);
  if (!intro || !controller) return null;

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center"
      onPointerDown={(e) => { e.stopPropagation(); controller.dismissRoundIntro(); }}
    >
      <div
        className="round-intro flex flex-col items-center gap-1"
        style={{ ['--round-intro-dur' as string]: `${ROUND_INTRO_MS}ms` }}
      >
        <div className="text-[10px] uppercase tracking-[0.4em] text-white/40">Nouveau tour</div>
        <div className="text-6xl font-black tabular-nums text-gold drop-shadow-[0_0_18px_rgba(212,175,97,0.45)]">
          {intro.round}
        </div>
        <div className="text-xs tracking-widest text-white/40">SUR {MAX_ROUNDS}</div>
      </div>
    </div>
  );
}

/**
 * La popup de pioche : le dos de carte du joueur, ce que le tour donne, et le
 * tap qui l'envoie en main.
 *
 * ⚠️ Elle ne montre PAS les cartes : les dos s'envolent, la main les trie
 * derrière. Les révéler ici dupliquerait la lecture que `HandBar` fait déjà, et
 * priverait le dos de carte — le cosmétique que le joueur a choisi — de son seul
 * moment à l'écran.
 *
 * `autoDismissMs` est armé par `GameScreenPvp` UNIQUEMENT : en duel le chrono de
 * préparation ne gèle pas (l'adversaire attend à la barrière réseau), donc une
 * popup oubliée masquerait au joueur sa propre préparation. En solo elle gèle le
 * chrono et peut attendre indéfiniment.
 */
export function DrawPopup({ autoDismissMs = 0 }: { autoDismissMs?: number } = {}) {
  const summary = useGameStore(s => s.drawPopup);
  const controller = useGameStore(s => s.controller);
  // ⚠️ Trois rangs, du plus spécifique au plus général : le dos CHOISI POUR CE
  // DECK (DeckBuilder, onglet Deck), puis celui du PROFIL (ProfileScreen), puis
  // le défaut du catalogue. Comme les variantes, jamais comme l'avatar : c'est
  // le deck qu'on joue qui porte son identité visuelle, le profil n'est qu'un
  // repli pour les decks qui n'ont rien choisi.
  //
  // ⚠️ Lu en DIRECT (pas via un store) : c'est le patron déjà suivi par
  // OnlineLobby/ArcadeScreen/TournamentScreen pour `getActiveDeck()`, une
  // lecture localStorage synchrone, aucune raison d'en faire un état à part.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- module JS sans .d.ts, même repli que les autres appelants de DeckRepository
  const repo = DeckRepository as any;
  const deckCardBackId = repo.getDeckCardBack?.(repo.getActiveDeck?.() ?? null) ?? null;
  const profileCardBackId = useAuthStore(s => s.user?.card_back ?? null);
  const cardBackId = deckCardBackId ?? profileCardBackId;
  const [dealing, setDealing] = useState(false);
  // Le tirage est déjà fait : ce verrou n'empêche pas une double pioche, il
  // empêche de relancer l'animation sous elle-même.
  const dealt = useRef(false);

  useEffect(() => { if (!summary) { dealt.current = false; setDealing(false); } }, [summary]);

  useEffect(() => {
    if (!summary || !autoDismissMs) return;
    const t = setTimeout(() => controller?.dismissDrawPopup(), autoDismissMs);
    return () => clearTimeout(t);
  }, [summary, autoDismissMs, controller]);

  if (!summary || !controller) return null;

  const deal = () => {
    if (dealt.current) return;
    dealt.current = true;
    // `prefers-reduced-motion` : on retire le mouvement, pas le geste — la main
    // arrive tout de suite, sans volée.
    const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced) { controller.dismissDrawPopup(); return; }
    setDealing(true);
    setTimeout(() => controller.dismissDrawPopup(), DEAL_MS);
  };

  const back = CardBackDatabase.resolveCardBack(cardBackId);
  const rows = drawBonusRows(summary);
  const flying = Math.min(Math.max(summary.drawnCount, 0), MAX_FLYING);

  return (
    <Modal onClose={deal}>
      <div className="flex flex-col items-center gap-3">
        <div className="text-[9px] uppercase tracking-widest text-white/40">Pioche du tour {summary.round}</div>

        <button
          type="button"
          aria-label="Piocher"
          onPointerDown={(e) => { e.stopPropagation(); deal(); }}
          className="relative flex min-h-tap items-center justify-center"
        >
          <CardBack back={back} dealing={dealing} count={flying} />
        </button>

        <div className="text-2xl font-bold text-gold">{drawnLabel(summary)}</div>

        <TierChips tiers={summary.tiers} />

        {rows.length > 0 && (
          <div className="w-full space-y-1 rounded-lg border border-white/10 bg-white/5 p-2">
            <div className="tracking-widest text-[9px] text-white/40">BONUS DE PIOCHE</div>
            {rows.map(row => <BonusRow key={row.key} row={row} />)}
            {summary.guaranteed.map((g, i) => (
              <div key={`g${i}`} className="flex items-center justify-between text-[11px]">
                <span className="truncate text-white/70">🎯 Pioche garantie</span>
                <span className="text-gold">{guaranteedDrawLabel(g, attributeName, cardName)}</span>
              </div>
            ))}
          </div>
        )}

        <div className="text-[11px] text-white/40">Touche le dos pour piocher</div>
      </div>
    </Modal>
  );
}

/**
 * Le dos porté par le joueur — son illustration si le catalogue en a une, sinon
 * un dos PROCÉDURAL.
 *
 * ⚠️ Le repli n'est pas une politesse : un catalogue vide (installation neuve)
 * ou un dos sans PNG donnerait sinon un `<img>` cassé au moment le plus visible
 * de la partie. Même discipline que le repli emoji d'`AttrIcon`.
 */
function CardBack({ back, dealing, count }: { back: { id: string; _has_illustration?: boolean } | null; dealing: boolean; count: number }) {
  const face = back?._has_illustration
    ? <Illustration id={back.id} className="h-full w-full rounded-lg" lazy={false} />
    : <div className="flex h-full w-full items-center justify-center rounded-lg bg-gradient-to-br from-surface-raised to-surface text-3xl text-gold/70">✦</div>;

  return (
    <div className="relative h-40 w-28">
      <div className={`draw-back h-full w-full overflow-hidden rounded-lg border-2 border-gold/50 shadow-2xl ${dealing ? 'draw-back-dealing' : ''}`}>
        {face}
      </div>
      {/* La volée : des dos identiques qui partent vers la main. Le seul style
          en ligne est l'INDEX de la carte, dont l'animation CSS dérive son
          retard et sa dérive latérale — la mise en forme reste en feuille. */}
      {dealing && Array.from({ length: count }, (_, i) => (
        <div
          key={i}
          className="draw-fly absolute inset-0 overflow-hidden rounded-lg border-2 border-gold/50"
          style={{ ['--i' as string]: String(i) }}
        >
          {face}
        </div>
      ))}
    </div>
  );
}

/** Les tiers piochables ce tour, aux couleurs déjà lues partout ailleurs. */
function TierChips({ tiers }: { tiers: number[] }) {
  return (
    <div className="flex flex-wrap items-center justify-center gap-1">
      <span className="mr-1 text-[10px] tracking-widest text-white/40">TIERS</span>
      {tiers.map(t => (
        <span key={t} className={`rounded border px-2 py-0.5 text-[11px] font-semibold ${TIER_CHIP[t] ?? 'border-line text-white/60'}`}>
          T{t}
        </span>
      ))}
    </div>
  );
}

const TIER_CHIP: Record<number, string> = {
  1: 'border-tier-1/50 text-tier-1',
  2: 'border-tier-2/50 text-tier-2',
  3: 'border-tier-3/50 text-tier-3',
  4: 'border-tier-4/60 text-tier-4',
  5: 'border-tier-5/60 bg-tier-5/10 text-tier-5',
};

function BonusRow({ row }: { row: DrawBonusRow }) {
  return (
    <div className="flex items-center justify-between text-[11px]">
      <span className="truncate text-white/70">{row.icon} {sourceName(row)}</span>
      <span className="font-semibold text-success">+{row.amount}</span>
    </div>
  );
}

/**
 * Le nom derrière l'id du registre.
 *
 * ⚠️ La résolution vit ICI et non dans `logic/`, qui n'importe pas `data/` : le
 * registre ne transporte que des ids (cf. `DrawSourceEntry`). Chaque lecture est
 * gardée — les databases JETTENT tant qu'elles ne sont pas initialisées, et un
 * id disparu du catalogue s'affiche par son id plutôt que de vider la ligne.
 */
function sourceName(row: DrawBonusRow): string {
  try {
    if (row.kind === 'attribut') return attributeName(row.ref);
    if (row.kind === 'terrain') return (BoardDatabase as { getBoard: (id: string) => { name?: string } | null }).getBoard(row.ref)?.name ?? row.ref;
    const magies = (MagieDatabase as { getAllMagies: () => { id: string; name?: string }[] }).getAllMagies();
    return magies.find(m => m.id === row.ref)?.name ?? row.ref;
  } catch {
    return row.ref;
  }
}
