/* eslint-disable @typescript-eslint/no-explicit-any */
// TestBench (React) — parité avec l'ancien TestBench3D (PLAN §3.7). Placement
// libre des deux camps (aucune règle d'invocation, pas de tours/HP), browser de
// cartes filtrable par summon_type, suppression d'une unité par long-press,
// sélecteur de terrain (cases bloquées + effets au lancement), pause, vitesses,
// et BoardInspector (stats live pendant le combat). Accès : /?screen=testbench
import { useEffect, useRef, useState } from 'react';
import { Board } from '../logic/Board.js';
import { Unit } from '../logic/Unit.js';
import { CombatManager } from '../logic/CombatManager.js';
import { AttributeManager } from '../logic/AttributeManager.js';
import { applyEffect as applyBoardEffect } from '../logic/BoardEffect.js';
import { Scene3D } from '../three/Scene3D.js';
import { CombatAnimator3D } from '../three/CombatAnimator3D.js';
import * as CardDatabase from '../data/CardDatabase.js';
import * as AttributeDatabase from '../data/AttributeDatabase.js';
import * as BoardDatabase from '../data/BoardDatabase.js';
import type { Card, Position, BoardDef } from '../logic/types.js';
import CardTile, { cardTileProps } from '../components/ui/CardTile.js';
import { useUiStore } from '../stores/uiStore.js';
import { Illustration } from '../components/ui/primitives.js';

const SUMMON_TYPES = ['normal', 'sacrifice', 'fusion', 'heritage', 'transformation'];
type Side = 'player' | 'enemy';
type Phase = 'prep' | 'combat' | 'done';

interface InspectorRow { uid: number; name: string; side: Side; hp: number; maxHp: number; atk: number; shield: number; dead: boolean }

export default function TestBench() {
  const navigate = useUiStore(s => s.navigate);
  const containerRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<Scene3D | null>(null);
  const animatorRef = useRef<CombatAnimator3D | null>(null);
  const boardRef = useRef<any>(null);

  // Sélection courante lue par les callbacks de la scène (créée une seule fois).
  const sel = useRef<{ card: Card | null; side: Side; phase: Phase; inspector: boolean }>({
    card: null, side: 'player', phase: 'prep', inspector: false,
  });

  const [side, setSide] = useState<Side>('player');
  const [selectedCardId, setSelectedCardId] = useState<string | null>(null);
  const [typeFilter, setTypeFilter] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [phase, setPhase] = useState<Phase>('prep');
  const [speed, setSpeed] = useState(2);
  const [paused, setPaused] = useState(false);
  const [winner, setWinner] = useState<string | null>(null);
  const [boardId, setBoardId] = useState<string>('');
  const [showTerrainInfo, setShowTerrainInfo] = useState(false);
  const [inspector, setInspector] = useState(false);
  const [inspectorRows, setInspectorRows] = useState<InspectorRow[]>([]);
  const [, forceRefresh] = useState(0);

  sel.current.side = side;
  sel.current.phase = phase;
  sel.current.card = selectedCardId ? ((CardDatabase as any).getCard(selectedCardId) as Card) : null;
  sel.current.inspector = inspector;

  // ── Scène (montée une fois) ────────────────────────────────────────────────
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const board = new (Board as any)();
    boardRef.current = board;

    const scene = new Scene3D(container, {
      showEnemySide: true,
      onCellTap: (pos: Position) => {
        if (sel.current.phase !== 'prep') return;
        const card = sel.current.card;
        if (!card) return;
        const s = sel.current.side;
        if (s === 'player' && pos.row > 3) return;
        if (s === 'enemy' && pos.row < 7) return;
        if (board.isOccupied(pos) || board.isBlocked?.(pos)) return;
        const u = new (Unit as any)(card, s);
        u.initial_position = { ...pos };
        board.placeUnit(u, pos);
        scene.refresh();
        forceRefresh(n => n + 1);
      },
      onUnitTap: (unit: any, _pos: Position, rect: any) => {
        useUiStore.getState().showTooltip({ kind: 'unit', unit }, rect);
      },
      onUnitLongPress: (unit: any) => {
        if (sel.current.phase !== 'prep') return;
        board.removeUnit(unit);
        useUiStore.getState().hideTooltip();
        scene.refresh();
        forceRefresh(n => n + 1);
      },
      onUnitDrag: (unit: any, from: Position, to: Position) => {
        if (sel.current.phase !== 'prep') return;
        if (to.col === from.col && to.row === from.row) return;
        if (board.isOccupied(to) || board.isBlocked?.(to)) { scene.refresh(); return; }
        board.moveUnit(unit, to);
        unit.initial_position = { ...to };
        scene.refresh();
      },
    });
    scene.setBoard(board);
    scene.refresh();
    sceneRef.current = scene;

    return () => {
      animatorRef.current?.stop();
      animatorRef.current = null;
      scene.dispose();
      sceneRef.current = null;
    };
  }, []);

  // ── Terrain sélectionné : cases bloquées visibles immédiatement ────────────
  const selectedBoard: BoardDef | null = boardId ? ((BoardDatabase as any).getBoard(boardId) as BoardDef) : null;
  useEffect(() => {
    const scene = sceneRef.current;
    const board = boardRef.current;
    if (!scene || !board) return;
    const cells = selectedBoard?.blocked_cells || [];
    board.setBlockedCells(cells);
    scene.setBlockedCells(cells);
    scene.refresh();
  }, [boardId, selectedBoard]);

  // ── Combat ─────────────────────────────────────────────────────────────────
  function startCombat() {
    const scene = sceneRef.current;
    const board = boardRef.current;
    if (!scene || !board || phase === 'combat') return;
    const players = board.getLivingUnitsOnSide('player');
    const enemies = board.getLivingUnitsOnSide('enemy');
    if (!players.length || !enemies.length) return;

    scene.setTerrainBackground(selectedBoard);
    scene.enterCombatMode();

    const attributeList = (AttributeDatabase as any).getAllAttributes();
    const attributeManager = new (AttributeManager as any)(attributeList, players, enemies);
    attributeManager.applyStartOfCombat();
    if (selectedBoard?.effect) applyBoardEffect(selectedBoard.effect as any, { playerUnits: players, enemyUnits: enemies } as any);

    const cm = new (CombatManager as any)(board, players, enemies, attributeManager);
    const animator = new CombatAnimator3D(cm, scene as any, {
      onStep: () => { if (sel.current.inspector) refreshInspector([...players, ...enemies]); },
      onFinished: () => { setPhase('done'); setWinner(cm.winner); },
    });
    animator.setSpeed(speed);
    animatorRef.current = animator;
    setPhase('combat');
    setPaused(false);
    if (inspector) refreshInspector([...players, ...enemies]);
    animator.start();
  }

  function stopCombat() {
    const scene = sceneRef.current;
    const board = boardRef.current;
    animatorRef.current?.stop();
    animatorRef.current = null;
    // Annule les bonus de combat (attributs + terrain)
    for (const u of board.getAllUnits ? board.getAllUnits() : [...board.getLivingUnitsOnSide('player'), ...board.getLivingUnitsOnSide('enemy')]) {
      u.resetCombatStats?.();
    }
    scene?.exitCombatMode();
    scene?.setTerrainBackground(null);
    scene?.setBlockedCells(selectedBoard?.blocked_cells || []);
    scene?.refresh();
    setPhase('prep');
    setWinner(null);
    setPaused(false);
  }

  function refreshInspector(units: any[]) {
    setInspectorRows(units.map(u => ({
      uid: u.uid, name: u.name, side: u.side,
      hp: Math.max(0, Math.round(u.current_hp)), maxHp: Math.round(u.max_hp),
      atk: u.atk, shield: Math.round(u.shield || 0), dead: !!u.is_neutralized,
    })));
  }

  function togglePause() {
    const a = animatorRef.current;
    if (!a) return;
    if (paused) { a.resume(); setPaused(false); } else { a.pause(); setPaused(true); }
  }
  function changeSpeed(s: number) { setSpeed(s); animatorRef.current?.setSpeed(s); }

  function clearBoard() {
    const board = boardRef.current;
    if (!board) return;
    for (const u of [...board.getLivingUnitsOnSide('player'), ...board.getLivingUnitsOnSide('enemy')]) board.removeUnit(u);
    sceneRef.current?.refresh();
    forceRefresh(n => n + 1);
  }

  // ── Liste de cartes ──────────────────────────────────────────────────────
  const allCards = (CardDatabase as any).getAllCards() as Card[];
  const cards = allCards
    .filter(c => (!typeFilter || (c as any).summon_type === typeFilter) && (!search.trim() || c.name.toLowerCase().includes(search.trim().toLowerCase())))
    .slice(0, 120);

  const pill = 'min-h-tap rounded-lg border px-3 text-sm active:opacity-70';
  const idle = `${pill} border-line bg-surface-raised text-white/70`;
  const active = `${pill} border-gold bg-gold/20 text-gold`;
  const placedP = boardRef.current?.getLivingUnitsOnSide('player').length ?? 0;
  const placedE = boardRef.current?.getLivingUnitsOnSide('enemy').length ?? 0;

  return (
    <div className="flex h-dvh flex-col bg-surface text-white" onPointerDown={() => useUiStore.getState().hideTooltip()}>
      <header className="flex flex-wrap items-center gap-2 border-b border-line p-2">
        <button className={idle} onPointerDown={() => navigate('main_menu')}>◂ Menu</button>
        <h1 className="mr-2 font-bold text-gold">TestBench</h1>
        {phase !== 'combat'
          ? <button className={active} onPointerDown={startCombat} disabled={phase === 'done'}>Lancer le combat</button>
          : <button className={idle} onPointerDown={togglePause}>{paused ? '▶ Reprendre' : '⏸ Pause'}</button>}
        {phase !== 'prep' && <button className={idle} onPointerDown={stopCombat}>⟲ Reset</button>}
        {[1, 2, 4].map(s => <button key={s} className={s === speed ? active : idle} onPointerDown={() => changeSpeed(s)}>×{s}</button>)}
        <button className={inspector ? active : idle} onPointerDown={() => { const v = !inspector; setInspector(v); if (v && phase === 'combat') refreshInspector([...boardRef.current.getLivingUnitsOnSide('player'), ...boardRef.current.getLivingUnitsOnSide('enemy')]); }}>🔍 Inspector</button>
        <span className="ml-auto text-xs text-white/50">
          J {placedP} · E {placedE}{winner ? ` — vainqueur : ${winner}` : ''}
        </span>
      </header>

      <div className="flex min-h-0 flex-1">
        {/* Colonne board */}
        <div className="relative min-h-0 flex-1">
          <div ref={containerRef} className="absolute inset-0" />
          {inspector && phase !== 'prep' && (
            <div className="absolute right-2 top-2 max-h-[70%] w-44 overflow-y-auto rounded-lg border border-line bg-surface/90 p-2 text-[11px]">
              <div className="mb-1 tracking-widest text-white/40">INSPECTOR</div>
              {inspectorRows.map(r => (
                <div key={r.uid} className={`flex justify-between gap-1 ${r.dead ? 'opacity-40 line-through' : ''}`}>
                  <span className={`truncate ${r.side === 'player' ? 'text-player' : 'text-enemy'}`}>{r.name}</span>
                  <span className="tabular-nums text-white/60">{r.hp}/{r.maxHp}{r.shield ? `+${r.shield}` : ''} · {r.atk}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Colonne contrôles (placement) */}
        <aside className="flex w-56 flex-col border-l border-line">
          <div className="space-y-2 border-b border-line p-2">
            <div className="flex gap-1">
              {(['player', 'enemy'] as Side[]).map(s => (
                <button key={s} className={`flex-1 ${s === side ? active : idle}`} onPointerDown={() => setSide(s)}>
                  {s === 'player' ? 'Joueur' : 'Ennemi'}
                </button>
              ))}
            </div>
            <select
              value={boardId} onChange={(e) => setBoardId(e.target.value)}
              className="min-h-tap w-full rounded-lg border border-line bg-surface-raised px-2 text-white"
            >
              <option value="">🗺️ Aucun terrain</option>
              {((BoardDatabase as any).getAllBoards() as BoardDef[]).map(b => (
                <option key={b.id} value={b.id}>{b.name}</option>
              ))}
            </select>
            {selectedBoard && (
              <button className={`w-full ${showTerrainInfo ? active : idle}`} onPointerDown={() => setShowTerrainInfo(v => !v)}>ℹ Terrain</button>
            )}
            {selectedBoard && showTerrainInfo && (
              <div className="flex gap-2 rounded-lg border border-line bg-surface-raised/60 p-2 text-[11px] text-white/70">
                {(selectedBoard as any)._has_illustration && (
                  <Illustration id={selectedBoard.id} className="h-12 w-12 rounded-md" />
                )}
                <div className="min-w-0">
                  <div className="font-bold text-white">{selectedBoard.name}</div>
                  <div>{(selectedBoard as any).blocked_cells?.length ?? 0} cases bloquées</div>
                  <div>{selectedBoard.effect ? `Effet : ${(selectedBoard.effect as any).type}` : 'Aucun effet'}</div>
                </div>
              </div>
            )}
            <input
              type="search" placeholder="Rechercher…" value={search} onChange={(e) => setSearch(e.target.value)}
              className="min-h-tap w-full rounded-lg border border-line bg-surface-raised px-2 text-white placeholder:text-white/30"
            />
            <div className="flex flex-wrap gap-1">
              <button className={!typeFilter ? active : idle} onPointerDown={() => setTypeFilter(null)}>Tous</button>
              {SUMMON_TYPES.map(t => (
                <button key={t} className={`text-xs ${typeFilter === t ? active : idle}`} onPointerDown={() => setTypeFilter(t)}>{t}</button>
              ))}
            </div>
            <button className={`w-full ${idle}`} onPointerDown={clearBoard}>Vider le board</button>
            <p className="text-[10px] text-white/40">Tap carte → sélection · tap case → poser ({side === 'player' ? 'rangées 0–3' : 'rangées 7–10'}) · appui long unité → retirer</p>
          </div>
          <div className="grid min-h-0 flex-1 grid-cols-3 gap-1 overflow-y-auto p-2">
            {cards.map(c => (
              <CardTile
                key={c.id} {...cardTileProps(c)} size="h-auto w-full"
                onTap={() => setSelectedCardId(c.id === selectedCardId ? null : c.id)}
                highlight={c.id === selectedCardId ? 'selected' : 'none'}
              />
            ))}
          </div>
        </aside>
      </div>
    </div>
  );
}
