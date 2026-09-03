/* eslint-disable @typescript-eslint/no-explicit-any */
// Labo IA — banc d'essai des décisions d'`EnemyAI` (`?screen=ailab`).
//
// Répond à une question que rien dans le jeu ne permettait de poser : POURQUOI
// l'IA a joué ça, et pourquoi pas le reste. On lui donne un deck, on simule sa
// pioche de début de tour (ou on compose sa main à la main), on la fait placer,
// et on lit chacune de ses tentatives avec son motif.
//
// ⚠️ TOUTE la décision vit dans `dev/aiLabRun.ts`, qui est pur : ce fichier ne
// fait que rendre ce qu'il produit et récolter les entrées. C'est ce qui rend
// le sujet testable alors que la suite tourne en node sans jsdom — même partage
// que `data/tutorialScript.ts` et son écran.
//
// ⚠️ Pas de `Scene3D`, donc pas de Three.js : la grille est du DOM. Ce n'est pas
// une économie, c'est ce qui permet d'ANNOTER chaque case (quelle passe l'a
// posée, quels matériaux ont été consommés) — précisément ce qu'un board 3D ne
// sait pas montrer, et qui est l'objet même de l'écran.
//
// ⚠️ Il est en revanche DANS `IMMERSIVE_SCREENS`, et l'oublier l'a rendu vide :
// ce set désigne les écrans qui posent leur propre décor plein cadre — ce que
// fait ce `bg-surface` sur une racine `h-dvh` —, pas ceux qui ont un canvas.
// Cf. « Labo IA » dans CLAUDE.md.
import { useEffect, useMemo, useState } from 'react';
import * as CardDatabase from '../data/CardDatabase.js';
import * as PublicDeckDatabase from '../data/PublicDeckDatabase.js';
import * as AuthClient from '../data/AuthClient.js';
import { initGameData } from '../game/bootstrap.js';
import { useUiStore } from '../stores/uiStore.js';
import CardTile, { cardTileProps } from '../components/ui/CardTile.js';
import { runAiPlacement, reasonLabel, refusalCounts, AI_ROW_MIN, AI_ROW_MAX, AI_COLS } from './aiLabRun.js';
import type { AiLabRound, AiTraceEvent, LabUnitInput } from './aiLabRun.js';

type Card = any;

const SLOT_CHOICES = [5, 6];
const ROUNDS = [1, 2, 3, 4, 5];
const ROWS = Array.from({ length: AI_ROW_MAX - AI_ROW_MIN + 1 }, (_, i) => AI_ROW_MIN + i);
const COLS = Array.from({ length: AI_COLS }, (_, i) => i);

const btn = 'rounded border border-white/15 px-2 py-1 text-xs text-white/80 hover:border-white/40 disabled:opacity-30';
const btnOn = 'rounded border border-gold/70 bg-gold/15 px-2 py-1 text-xs text-gold';
const panel = 'rounded-lg border border-white/10 bg-black/30 p-3';
const label = 'text-[10px] uppercase tracking-wide text-white/40';

/**
 * D'où vient la main d'un round. ⚠️ `carry_draw` est le cas NORMAL dès le
 * round 2 : lire « composée » sur un report + pioche ferait passer le
 * comportement du jeu pour une mise en scène du labo.
 */
const HAND_SOURCE_LABELS: Record<AiLabRound['hand_source'], string> = {
  draw: 'piochée',
  manual: 'imposée',
  carry_draw: 'reportée + piochée',
};

/** Où le sélecteur de cartes envoie ce qu'on choisit. */
type PickTarget = { kind: 'hand' } | { kind: 'graveyard' } | { kind: 'cell'; col: number; row: number };

export default function AiLab() {
  const navigate = useUiStore(s => s.navigate);
  const hideTooltip = useUiStore(s => s.hideTooltip);

  const [ready, setReady] = useState(false);
  const [deckId, setDeckId] = useState('');
  const [seed, setSeed] = useState('labo-1');
  const [round, setRound] = useState(1);
  const [slots, setSlots] = useState(5);
  const [bonusAtk, setBonusAtk] = useState(0);
  const [bonusHp, setBonusHp] = useState(0);

  const [survivors, setSurvivors] = useState<LabUnitInput[]>([]);
  const [graveyard, setGraveyard] = useState<string[]>([]);
  // Ce que l'IA TIENT DÉJÀ en entrant dans le round : vide au round 1, le
  // report de `hand_left` ensuite, plus ce qu'on y ajoute à la main.
  const [hand, setHand] = useState<string[]>([]);
  // ⚠️ Et elle pioche PAR-DESSUS, à chaque round, comme en jeu. Les deux ne
  // sont pas exclusifs : l'écran ne savait faire que l'un ou l'autre, si bien
  // qu'un run multi-rounds cessait de piocher dès le round 2 — la rétention de
  // main était invisible sur l'écran fait pour l'observer.
  const [draw, setDraw] = useState(true);

  const [result, setResult] = useState<AiLabRound | null>(null);
  const [history, setHistory] = useState<AiLabRound[]>([]);
  const [pick, setPick] = useState<PickTarget | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [runLabel, setRunLabel] = useState('');
  const [saving, setSaving] = useState(false);

  // Les databases sont partagées avec le jeu : `getAttribute` JETTE tant
  // qu'elles ne sont pas initialisées, et le tooltip d'une carte les lit.
  useEffect(() => {
    let alive = true;
    (async () => {
      await initGameData();
      await (PublicDeckDatabase as any).init();
      if (!alive) return;
      const first = (PublicDeckDatabase as any).getAllDecks()[0];
      if (first) setDeckId(first.id);
      setReady(true);
    })().catch(e => setNote(String(e?.message ?? e)));
    return () => { alive = false; };
  }, []);

  const decks = ready ? (PublicDeckDatabase as any).getAllDecks() : [];
  const deckDef = deckId ? (PublicDeckDatabase as any).getDeck(deckId) : null;
  // Mémoïsé : le repli `?? {}` fabriquerait un objet neuf à chaque rendu, dont
  // `deckIds` dépend.
  const deck: Record<string, string[]> = useMemo(() => deckDef?.deck ?? {}, [deckDef]);
  const deckIds = useMemo(() => Object.values(deck).flat() as string[], [deck]);

  const cardDb = CardDatabase as any;
  const nameOf = (id: string) => cardDb.getCard(id)?.name ?? id;

  function reset() {
    setSurvivors([]); setGraveyard([]); setHand([]); setDraw(true);
    setResult(null); setHistory([]); setRound(1); setNote(null);
  }

  // ── Actions ────────────────────────────────────────────────────────────────

  /**
   * Matérialise la pioche du round DANS la main tenue, et coupe la pioche
   * automatique — pour partir d'un vrai tirage puis le retoucher carte par
   * carte. Sans ce bouton, « la pioche du round 3, mais sans cette fusion » ne
   * serait pas exprimable.
   *
   * On passe par le pilote plutôt que d'appeler `EnemyAI` ici : c'est la même
   * pioche semée que celle du placement, au même round et à la même graine —
   * ce qu'on fige est donc exactement ce qui serait tombé.
   */
  function materialiseDraw() {
    if (!deckId) return;
    const r = runAiPlacement({
      deck, cardDb, round, slots: 99, survivors: [], graveyard: [],
      hand, draw: true, seed, enemyBonus: null,
    });
    setResult(null);
    setHand(r.hand);
    setDraw(false);
    setNote(null);
  }

  function place() {
    if (!deckId) return;
    const r = runAiPlacement({
      deck, cardDb, round, slots,
      survivors, graveyard,
      hand, draw,
      seed,
      enemyBonus: bonusAtk || bonusHp ? { atk: bonusAtk, hp: bonusHp } : null,
    });
    setResult(r);
    setHistory(h => [...h, r]);
    setNote(null);
  }

  /** Reporte le board obtenu en survivants du round suivant — aucun état caché. */
  function nextRound() {
    if (!result) return;
    setSurvivors(result.board_after.map(u => ({ card_id: u.card_id, col: u.col!, row: u.row! })));
    setGraveyard(result.graveyard_left);
    // ⚠️ La main NON POSÉE se reporte, ET l'IA repioche par-dessus : c'est ce
    // que fait `drawHand`, qui AJOUTE au lieu de remplacer. Reporter sans
    // relancer la pioche — ce que faisait l'écran — donnait un round 2 où
    // l'IA ne tirait plus une seule carte, et laissait croire l'inverse exact
    // de ce qui est corrigé.
    setHand(result.hand_left);
    setDraw(true);
    setRound(r => Math.min(5, r + 1));
    setResult(null);
  }

  async function save() {
    if (history.length === 0) return;
    setSaving(true);
    try {
      const res = await (AuthClient as any).postAiLog({
        label: runLabel || `Labo IA — ${deckDef?.name ?? deckId}`,
        deck_id: deckId,
        deck_name: deckDef?.name ?? null,
        rounds: history,
      });
      setNote(`Run enregistré (${res.id}) — visible dans l'onglet 🧠 Logs IA de /admin.`);
    } catch (e: any) {
      // On le DIT plutôt que de l'avaler : la trace reste lisible ici, seul le
      // dépôt a échoué (route admin — un compte sans droits reçoit un 401).
      setNote(`Dépôt refusé : ${e?.message ?? e}. La trace reste lisible ci-dessous.`);
    } finally {
      setSaving(false);
    }
  }

  /**
   * ⚠️ Toute édition d'entrée efface le RÉSULTAT affiché, et ce n'est pas une
   * précaution : la grille rend `result.board_after` dès qu'un placement a eu
   * lieu, donc un survivant ajouté ensuite serait INVISIBLE — et la case qu'on
   * croit vide est déjà prise. Concrètement, deux matériaux ajoutés à la suite
   * atterrissaient sur la même case et le second était silencieusement ignoré
   * (constaté au navigateur). Le plateau à l'écran doit toujours être celui
   * qu'on est en train de composer.
   */
  function editInputs(fn: () => void) {
    setResult(null);
    fn();
  }

  function onPicked(cardId: string) {
    if (!pick) return;
    editInputs(() => {
      if (pick.kind === 'hand') setHand(h => [...h, cardId]);
      else if (pick.kind === 'graveyard') setGraveyard(g => [...g, cardId]);
      else setSurvivors(s => [...s, { card_id: cardId, col: pick.col, row: pick.row }]);
    });
    setPick(null);
  }

  // ── Rendu ──────────────────────────────────────────────────────────────────

  const board = result ? result.board_after : survivors.map(s => ({ ...s, uid: -1 }));
  const unitAt = (col: number, row: number) =>
    (board as any[]).find(u => u.col === col && u.row === row) ?? null;

  return (
    <div className="flex h-dvh flex-col bg-surface text-white" onPointerDown={hideTooltip}>
      {/* `flex-wrap` comme les en-têtes de TestBench et CombatLab : six contrôles
          ne tiennent pas sur une ligne de 390 px, et sans lui les libellés se
          cassent en trois lignes chacun plutôt que de passer à la ligne. */}
      <header className="flex flex-wrap items-center gap-2 border-b border-white/10 px-3 py-2">
        <button className={btn} onPointerDown={() => navigate('main_menu')}>◂ Menu</button>
        <h1 className="whitespace-nowrap text-sm font-semibold">Labo IA</h1>
        {/* Utile sur grand écran, mais elle mangeait la moitié de l'en-tête sur
            un téléphone (quatre lignes pour une mention explicative). */}
        <span className="hidden text-[10px] text-white/35 sm:inline">
          placement seul — aucun combat n'est joué
        </span>
        <div className="ml-auto flex items-center gap-2">
          <button className={btn} onPointerDown={reset}>↺ Réinitialiser</button>
          <button className={btn} disabled={!result} onPointerDown={nextRound}>⏭ Round suivant</button>
          <button
            className="rounded border border-gold/70 bg-gold/20 px-3 py-1 text-xs font-semibold text-gold disabled:opacity-30"
            disabled={!deckId}
            onPointerDown={place}
          >
            ▶ Placer
          </button>
        </div>
      </header>

      {note && (
        <div className="border-b border-white/10 bg-white/5 px-3 py-1.5 text-[11px] text-white/70">{note}</div>
      )}

      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3 lg:flex-row">
        {/* ── Colonne réglages ─────────────────────────────────────────── */}
        <aside className="flex w-full shrink-0 flex-col gap-3 lg:w-72">
          <div className={panel}>
            <div className={label}>Deck de l'IA</div>
            <select
              className="mt-1 w-full rounded bg-black/40 p-1.5 text-xs"
              value={deckId}
              onChange={e => { setDeckId(e.target.value); reset(); }}
            >
              {decks.map((d: any) => (
                <option key={d.id} value={d.id}>
                  {d.name} — {(PublicDeckDatabase as any).difficultyLabel((PublicDeckDatabase as any).difficultyOf(d))}
                </option>
              ))}
            </select>
            <div className="mt-1 text-[10px] text-white/35">{deckIds.length} cartes</div>

            <div className={`${label} mt-3`}>Graine</div>
            <input
              className="mt-1 w-full rounded bg-black/40 p-1.5 text-xs"
              value={seed}
              onChange={e => setSeed(e.target.value)}
            />
            <div className="mt-1 text-[10px] text-white/35">
              Même graine + même round ⇒ même pioche. Un tirage douteux se rejoue.
            </div>

            <div className={`${label} mt-3`}>Handicap (mode Arcade)</div>
            <div className="mt-1 flex gap-2">
              <label className="flex flex-1 items-center gap-1 text-[11px]">
                ATK
                <input type="number" className="w-full rounded bg-black/40 p-1 text-xs"
                  value={bonusAtk} onChange={e => setBonusAtk(Number(e.target.value) || 0)} />
              </label>
              <label className="flex flex-1 items-center gap-1 text-[11px]">
                PV
                <input type="number" className="w-full rounded bg-black/40 p-1 text-xs"
                  value={bonusHp} onChange={e => setBonusHp(Number(e.target.value) || 0)} />
              </label>
            </div>
          </div>

          <div className={panel}>
            <div className={label}>Round</div>
            <div className="mt-1 flex gap-1">
              {ROUNDS.map(r => (
                <button key={r} className={r === round ? btnOn : btn}
                  onPointerDown={() => setRound(r)}>{r}</button>
              ))}
            </div>
            <div className={`${label} mt-3`}>Slots de l'IA</div>
            <div className="mt-1 flex gap-1">
              {SLOT_CHOICES.map(s => (
                <button key={s} className={s === slots ? btnOn : btn}
                  onPointerDown={() => setSlots(s)}>{s}</button>
              ))}
            </div>
          </div>

          <div className={panel}>
            <div className="flex items-center justify-between">
              <span className={label}>Cimetière ({graveyard.length})</span>
              <button className={btn} onPointerDown={() => setPick({ kind: 'graveyard' })}>+ carte</button>
            </div>
            <div className="mt-2 flex flex-wrap gap-1">
              {graveyard.length === 0 && <span className="text-[11px] text-white/30">vide</span>}
              {graveyard.map((id, i) => (
                <button key={`${id}-${i}`} className={btn} title="Retirer"
                  onPointerDown={() => editInputs(() => setGraveyard(g => g.filter((_, j) => j !== i)))}>
                  {nameOf(id)} ✕
                </button>
              ))}
            </div>
            <div className="mt-2 text-[10px] text-white/35">
              Matériaux disponibles pour fusion, héritage, sacrifice et transformation.
            </div>
          </div>
        </aside>

        {/* ── Colonne centrale : main + grille ─────────────────────────── */}
        <section className="flex min-w-0 flex-1 flex-col gap-3">
          <div className={panel}>
            <div className="flex items-center justify-between">
              <span className={label}>
                {draw ? `Déjà en main (${hand.length})` : `Main imposée (${hand.length})`}
              </span>
              <div className="flex flex-wrap items-center gap-1">
                <label className="mr-1 flex cursor-pointer items-center gap-1 text-[11px] text-white/60">
                  <input
                    type="checkbox"
                    checked={draw}
                    onChange={e => editInputs(() => setDraw(e.target.checked))}
                  />
                  🎲 pioche du round {round}
                </label>
                <button className={btn} disabled={!deckId} onPointerDown={materialiseDraw}>
                  Figer la pioche
                </button>
                <button className={btn} onPointerDown={() => setPick({ kind: 'hand' })}>+ carte</button>
                <button className={btn} disabled={!hand.length}
                  onPointerDown={() => editInputs(() => setHand([]))}>Vider</button>
              </div>
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              {hand.length === 0 && (
                <span className="text-[11px] text-white/30">
                  Pioche, ou compose la main carte par carte pour reproduire un cas précis.
                </span>
              )}
              {hand.map((id, i) => {
                const card = cardDb.getCard(id);
                if (!card) return (
                  <span key={`${id}-${i}`} className="text-[11px] text-red-300">{id} (inconnue)</span>
                );
                return (
                  <div key={`${id}-${i}`} className="w-20">
                    <CardTile
                      {...cardTileProps(card as Card)}
                      size="h-24 w-full"
                      tapOn="up"
                      onTap={() => editInputs(() => setHand(h => h.filter((_, j) => j !== i)))}
                    />
                  </div>
                );
              })}
            </div>
            <div className="mt-2 text-[10px] text-white/35">
              Tap une carte pour la retirer. La main de l'IA <strong>s'accumule</strong>, comme
              celle du joueur : ce qu'elle n'a pas posé revient au round suivant, et elle pioche
              par-dessus. Décoche la pioche pour lui imposer exactement ces cartes.
            </div>
          </div>

          <div className={panel}>
            <div className="flex items-center justify-between">
              <span className={label}>
                Zone de l'IA — rangées {AI_ROW_MIN} à {AI_ROW_MAX}
              </span>
              <span className="text-[10px] text-white/35">
                {result ? `${result.board_after.length}/${slots} après placement` : `${survivors.length} survivant(s)`}
              </span>
            </div>
            {/* Les rangées gardent leurs NUMÉROS RÉELS : la grille, la trace et
                un futur log de partie se lisent dans le même repère. */}
            <div className="mt-2 space-y-1">
              {ROWS.map(row => (
                <div key={row} className="flex items-center gap-1">
                  <span className="w-5 shrink-0 text-right text-[10px] text-white/25">{row}</span>
                  <div className="grid flex-1 grid-cols-5 gap-1">
                    {COLS.map(col => {
                      const u = unitAt(col, row);
                      if (!u) {
                        return (
                          <button key={col}
                            className="flex h-16 items-center justify-center rounded border border-dashed border-white/10 text-[10px] text-white/20 hover:border-white/30"
                            onPointerDown={() => setPick({ kind: 'cell', col, row })}
                          >+</button>
                        );
                      }
                      const card = cardDb.getCard(u.card_id);
                      return (
                        <div key={col} className="relative">
                          <CardTile
                            {...(card ? cardTileProps(card as Card) : { illustrationId: u.card_id, name: u.card_id })}
                            size="h-16 w-full"
                            showName={false}
                            tapOn="up"
                            onTap={() => editInputs(
                              () => setSurvivors(s => s.filter(x => !(x.col === col && x.row === row))))}
                          />
                          <span className="pointer-events-none absolute inset-x-0 bottom-0 truncate bg-black/70 px-0.5 text-[9px]">
                            {u.card_id}
                          </span>
                          {!result && (
                            <button
                              className="absolute -right-1 -top-1 rounded bg-black/80 px-1 text-[10px]"
                              title="Envoyer au cimetière"
                              onPointerDown={() => editInputs(() => {
                                setSurvivors(s => s.filter(x => !(x.col === col && x.row === row)));
                                setGraveyard(g => [...g, u.card_id]);
                              })}
                            >☠</button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-2 text-[10px] text-white/35">
              Tap une case vide pour poser un survivant, une unité pour la retirer, ☠ pour l'envoyer
              au cimetière — le seul geste qui reproduit une fin de combat sans en jouer un.
              {result && ' Le plateau affiché est le résultat du placement ; « Round suivant » le reporte en survivants.'}
            </div>
          </div>
        </section>

        {/* ── Colonne trace ────────────────────────────────────────────── */}
        <aside className="flex w-full shrink-0 flex-col gap-3 lg:w-96">
          <Trace result={result} nameOf={nameOf} />
          <div className={panel}>
            <div className={label}>Enregistrer le run ({history.length} round(s))</div>
            <input
              className="mt-1 w-full rounded bg-black/40 p-1.5 text-xs"
              placeholder="Libellé — ex. « fusion pas jouée au round 3 »"
              value={runLabel}
              onChange={e => setRunLabel(e.target.value)}
            />
            <button
              className={`${btn} mt-2 w-full`}
              disabled={history.length === 0 || saving}
              onPointerDown={save}
            >
              {saving ? 'Envoi…' : '⬆ Déposer sur /admin'}
            </button>
            {history.length > 0 && (
              <div className="mt-2 text-[10px] text-white/35">
                Refus cumulés : {Object.entries(refusalCounts(history))
                  .map(([r, n]) => `${r} ×${n}`).join(' · ') || 'aucun'}
              </div>
            )}
          </div>
        </aside>
      </div>

      {pick && (
        <CardPicker
          cards={cardDb.getAllCards()}
          deckIds={deckIds}
          title={pick.kind === 'hand' ? 'Ajouter à la main'
            : pick.kind === 'graveyard' ? 'Ajouter au cimetière'
              : `Poser un survivant en ${pick.col},${pick.row}`}
          onPick={onPicked}
          onClose={() => setPick(null)}
        />
      )}
    </div>
  );
}

// ── La trace ─────────────────────────────────────────────────────────────────

function Trace({ result, nameOf }: { result: AiLabRound | null; nameOf: (id: string) => string }) {
  if (!result) {
    return (
      <div className={panel}>
        <div className={label}>Trace</div>
        <p className="mt-2 text-[11px] text-white/40">
          Tape « ▶ Placer » : chaque carte tentée apparaît ici avec son issue, et chaque refus
          avec son motif.
        </p>
      </div>
    );
  }

  const passes = new Map<number, AiTraceEvent[]>();
  for (const e of result.events) {
    if (e.kind !== 'attempt') continue;
    if (!passes.has(e.pass)) passes.set(e.pass, []);
    passes.get(e.pass)!.push(e);
  }
  const rearrange = result.events.find(e => e.kind === 'rearrange') as any;
  const orders = new Map(
    result.events.filter(e => e.kind === 'pass_start').map((e: any) => [e.pass, e.order]),
  );

  return (
    <div className={`${panel} min-h-0 flex-1 overflow-y-auto`}>
      <div className={label}>Trace — round {result.round}</div>

      <div className="mt-2 text-[11px] text-white/50">
        Main {HAND_SOURCE_LABELS[result.hand_source]} :{' '}
        {result.hand.length ? result.hand.join(', ') : '—'}
        {result.hand_carried.length > 0 && (
          <span className="text-white/35">
            {' '}— dont {result.hand_carried.length} reportée(s) du round précédent
          </span>
        )}
      </div>
      {result.unknown_cards.length > 0 && (
        <div className="mt-1 text-[11px] text-red-300">
          Cartes inconnues du catalogue : {result.unknown_cards.join(', ')}
        </div>
      )}

      {[...passes.entries()].map(([pass, events]) => (
        <div key={pass} className="mt-3">
          <div className="text-[10px] uppercase tracking-wide text-gold/70">
            Passe {pass}
          </div>
          <div className="text-[10px] text-white/30">
            ordre : {(orders.get(pass) ?? []).join(' → ')}
          </div>
          <ul className="mt-1 space-y-1">
            {events.map((e: any, i) => (
              <li key={i} className="rounded border border-white/5 bg-black/20 px-2 py-1 text-[11px]">
                <span className={e.outcome === 'placed' ? 'text-green-300' : 'text-white/45'}>
                  {e.outcome === 'placed' ? '✓' : '✗'}
                </span>{' '}
                <span className="font-medium">{nameOf(e.card_id)}</span>{' '}
                <span className="text-white/30">
                  ({e.summon_type}{e.option_index !== null ? ` · recette ${e.option_index}` : ''})
                </span>
                {e.outcome === 'placed' ? (
                  <div className="text-white/45">
                    posée en {e.cell?.col},{e.cell?.row}
                    {e.consumed.board.length > 0 && (
                      <> — consomme sur le terrain : {e.consumed.board.map((u: any) => nameOf(u.card_id)).join(', ')}</>
                    )}
                    {e.consumed.graveyard.length > 0 && (
                      <> — au cimetière : {e.consumed.graveyard.map((u: any) => nameOf(u.card_id)).join(', ')}</>
                    )}
                  </div>
                ) : (
                  <div className="text-amber-200/70">{reasonLabel(e.reason, e.detail)}</div>
                )}
                {e.reason === 'all_options_failed' && (
                  <ul className="mt-0.5 space-y-0.5 pl-3 text-[10px] text-white/40">
                    {(e.detail?.options ?? []).map((o: any) => (
                      <li key={o.index}>
                        recette {o.index} ({o.summon_type}) : {reasonLabel(o.reason, o.detail)}
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        </div>
      ))}

      {rearrange && (
        <div className="mt-3">
          <div className="text-[10px] uppercase tracking-wide text-gold/70">Rangement</div>
          <div className="text-[11px] text-white/45">
            Mêlée devant, distance derrière ; à portée égale, le plus gros PV le plus avancé.
          </div>
          <ul className="mt-1 space-y-0.5 text-[11px] text-white/60">
            {rearrange.after.map((u: any) => (
              <li key={u.uid}>
                {nameOf(u.card_id)} → {u.col},{u.row}
                <span className="text-white/30"> (portée {u.range}, {u.max_hp} PV)</span>
              </li>
            ))}
          </ul>
          {rearrange.dropped.length > 0 && (
            <div className="mt-1 rounded border border-amber-400/30 bg-amber-400/10 px-2 py-1 text-[11px] text-amber-200">
              ⚠ {rearrange.dropped.length} unité(s) JETÉE(S) au-delà du cap :{' '}
              {rearrange.dropped.map((u: any) => nameOf(u.card_id)).join(', ')} — retirées du
              terrain sans mourir ni passer au cimetière.
            </div>
          )}
        </div>
      )}

      {result.hand_left.length > 0 && (
        <div className="mt-3 text-[11px] text-white/45">
          Restées en main : {result.hand_left.map(nameOf).join(', ')}
        </div>
      )}
    </div>
  );
}

// ── Sélecteur de cartes ──────────────────────────────────────────────────────

function CardPicker({ cards, deckIds, title, onPick, onClose }: {
  cards: Card[];
  deckIds: string[];
  title: string;
  onPick: (id: string) => void;
  onClose: () => void;
}) {
  const [search, setSearch] = useState('');
  const [tier, setTier] = useState<number | null>(null);
  const [deckOnly, setDeckOnly] = useState(true);

  const inDeck = useMemo(() => new Set(deckIds), [deckIds]);
  const list = useMemo(() => {
    const q = search.trim().toLowerCase();
    return cards
      .filter(c => (!deckOnly || inDeck.has(c.id)))
      .filter(c => (tier === null || c.tier === tier))
      .filter(c => (!q || c.name.toLowerCase().includes(q) || c.id.toLowerCase().includes(q)))
      .slice(0, 120);
  }, [cards, inDeck, deckOnly, tier, search]);

  return (
    <div className="fixed inset-0 z-40 flex flex-col bg-black/85 p-3" onPointerDown={e => e.stopPropagation()}>
      <div className="flex items-center gap-2">
        <h2 className="text-sm font-semibold">{title}</h2>
        <button className={`${btn} ml-auto`} onPointerDown={onClose}>Fermer ✕</button>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-1">
        <input
          className="w-48 rounded bg-black/50 p-1.5 text-xs"
          placeholder="Rechercher…"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        <button className={deckOnly ? btnOn : btn} onPointerDown={() => setDeckOnly(v => !v)}>
          Deck seulement
        </button>
        <button className={tier === null ? btnOn : btn} onPointerDown={() => setTier(null)}>Tous</button>
        {[1, 2, 3, 4, 5].map(t => (
          <button key={t} className={tier === t ? btnOn : btn} onPointerDown={() => setTier(t)}>T{t}</button>
        ))}
        <span className="text-[10px] text-white/35">{list.length} carte(s)</span>
      </div>
      <div className="mt-2 grid min-h-0 flex-1 grid-cols-3 gap-2 overflow-y-auto sm:grid-cols-6 lg:grid-cols-10">
        {list.map(c => (
          <CardTile
            key={c.id}
            {...cardTileProps(c)}
            size="h-24 w-full"
            tapOn="up"
            onTap={() => onPick(c.id)}
          />
        ))}
      </div>
    </div>
  );
}
