/* eslint-disable @typescript-eslint/no-explicit-any */
// Harnais visuel Phase 2 (proto TestBench) : joue un combat scripté dans la
// scène 3D portée, sans HUD ni règles d'invocation. Accès : /?screen=combatlab
import { useEffect, useRef, useState } from 'react';
import { Board } from '../logic/Board.js';
import { Unit } from '../logic/Unit.js';
import { CombatManager } from '../logic/CombatManager.js';
import { Scene3D } from '../three/Scene3D.js';
import { CombatAnimator3D } from '../three/CombatAnimator3D.js';
import type { Position } from '../logic/types.js';

// Cartes synthétiques : ids réels (CORE_*) pour charger les illustrations via
// le proxy /illustrations, attributs Élément (ARCH_048+) pour les particules.
function card(id: string, over: any = {}) {
  return {
    id, name: id, tier: over.tier ?? 2, summon_type: 'normal',
    attributes: over.attributes ?? [], power: over.power ?? null,
    stats: {
      atk: 6, hp: 40, movement_speed: 1, attack_speed: 2, initiative: 5, range: 1,
      ...(over.stats ?? {}),
    },
  };
}

interface LabSetup {
  board: any;
  players: any[];
  enemies: any[];
}

function buildSetup(): LabSetup {
  const board = new (Board as any)();
  const spawn = (c: any, side: 'player' | 'enemy', pos: Position) => {
    const u = new (Unit as any)(c, side);
    board.placeUnit(u, pos);
    return u;
  };

  const players = [
    spawn(card('CORE_001', { tier: 3, attributes: ['ARCH_048'], stats: { atk: 8, hp: 55, attack_speed: 2 } }), 'player', { col: 1, row: 3 }),
    spawn(card('CORE_002', { tier: 2, attributes: ['ARCH_052'], stats: { atk: 6, hp: 30, range: 3, attack_speed: 3, initiative: 7 } }), 'player', { col: 2, row: 2 }),
    spawn(card('CORE_003', { tier: 4, attributes: ['ARCH_049'], power: { id: 'POWER_HEAL', power_speed: 7 }, stats: { atk: 4, hp: 38, range: 3, attack_speed: 3 } }), 'player', { col: 3, row: 3 }),
    spawn(card('CORE_004', { tier: 5, attributes: ['ARCH_050'], stats: { atk: 9, hp: 48, attack_speed: 2, initiative: 4 } }), 'player', { col: 2, row: 3 }),
  ];
  const enemies = [
    spawn(card('CORE_010', { tier: 3, attributes: ['ARCH_056'], stats: { atk: 7, hp: 50, attack_speed: 2 } }), 'enemy', { col: 2, row: 7 }),
    spawn(card('CORE_011', { tier: 2, attributes: ['ARCH_054'], power: { id: 'POWER_POISON', power_speed: 5 }, stats: { atk: 5, hp: 32, range: 2, attack_speed: 3 } }), 'enemy', { col: 1, row: 7 }),
    spawn(card('CORE_014', { tier: 4, attributes: ['ARCH_051'], power: { id: 'POWER_SUPER_ATTACK', power_speed: 8 }, stats: { atk: 7, hp: 42, attack_speed: 2, initiative: 6 } }), 'enemy', { col: 3, row: 8 }),
    spawn(card('CORE_015', { tier: 5, attributes: ['ARCH_053'], power: { id: 'POWER_FREEZE', power_speed: 6 }, stats: { atk: 6, hp: 36, range: 2, attack_speed: 3 } }), 'enemy', { col: 2, row: 9 }),
  ];
  return { board, players, enemies };
}

export default function CombatLab() {
  const containerRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<Scene3D | null>(null);
  const animatorRef = useRef<CombatAnimator3D | null>(null);
  const setupRef = useRef<LabSetup | null>(null);

  const [mountKey, setMountKey] = useState(0);
  const [phase, setPhase] = useState<'prep' | 'combat' | 'done'>('prep');
  const [winner, setWinner] = useState<string | null>(null);
  const [speed, setSpeed] = useState(1);
  const [paused, setPaused] = useState(false);
  const [steps, setSteps] = useState(0);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const setup = buildSetup();
    setupRef.current = setup;
    const scene = new Scene3D(container, {
      showEnemySide: true,
      onCellTap: () => {},
      onUnitTap: () => {},
      onUnitDrag: (unit: any, _from: Position, to: Position) => {
        // Repositionnement libre en préparation (les deux camps, façon TestBench)
        if (!setup.board.isOccupied(to)) {
          setup.board.moveUnit(unit, to);
          unit.initial_position = { ...to };
        }
        scene.refresh();
      },
    });
    scene.setBoard(setup.board);
    scene.refresh();
    sceneRef.current = scene;
    setPhase('prep');
    setWinner(null);
    setSteps(0);
    setPaused(false);

    return () => {
      animatorRef.current?.stop();
      animatorRef.current = null;
      scene.dispose();
      sceneRef.current = null;
    };
  }, [mountKey]);

  const startCombat = () => {
    const scene = sceneRef.current;
    const setup = setupRef.current;
    if (!scene || !setup || phase === 'combat') return;

    scene.enterCombatMode();
    const cm = new (CombatManager as any)(setup.board, setup.players, setup.enemies, null);
    const animator = new CombatAnimator3D(cm, scene, {
      onStep: () => setSteps(cm._stepCount),
      onFinished: () => {
        setPhase('done');
        setWinner(cm.winner);
      },
    });
    animator.setSpeed(speed);
    animatorRef.current = animator;
    setPhase('combat');
    setPaused(false);
    animator.start();
  };

  const togglePause = () => {
    const animator = animatorRef.current;
    if (!animator) return;
    if (paused) { animator.resume(); setPaused(false); }
    else { animator.pause(); setPaused(true); }
  };

  const changeSpeed = (s: number) => {
    setSpeed(s);
    animatorRef.current?.setSpeed(s);
  };

  const remount = () => {
    setMountKey(k => k + 1); // dispose complet + scène neuve (test de fuite mémoire)
  };

  const btn = 'min-h-tap rounded-lg border border-line bg-surface-raised px-3 text-sm text-white active:opacity-70';
  const btnActive = 'min-h-tap rounded-lg border border-gold bg-gold/20 px-3 text-sm text-gold';

  return (
    <div className="flex h-dvh flex-col bg-surface text-white">
      <header className="flex flex-wrap items-center gap-2 p-2">
        <h1 className="mr-2 font-bold text-gold">CombatLab</h1>
        {phase !== 'combat' && (
          <button className={btnActive} onClick={startCombat}>
            {phase === 'done' ? 'Recommencer (remonter d’abord)' : 'Lancer le combat'}
          </button>
        )}
        {phase === 'combat' && (
          <button className={btn} onClick={togglePause}>{paused ? 'Reprendre' : 'Pause'}</button>
        )}
        {[1, 2, 4].map(s => (
          <button key={s} className={s === speed ? btnActive : btn} onClick={() => changeSpeed(s)}>×{s}</button>
        ))}
        <button className={btn} onClick={remount}>Remonter la scène</button>
        <span className="ml-auto text-xs opacity-70">
          tick {steps}
          {winner ? ` — vainqueur : ${winner}` : ''}
        </span>
      </header>
      <div key={mountKey} ref={containerRef} className="relative min-h-0 flex-1" />
    </div>
  );
}
