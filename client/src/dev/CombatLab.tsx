/* eslint-disable @typescript-eslint/no-explicit-any */
// Harnais visuel Phase 2 (proto TestBench) : joue un combat scripté dans la
// scène 3D portée, sans HUD ni règles d'invocation. Accès : /?screen=combatlab
import { useEffect, useRef, useState } from 'react';
import { Board } from '../logic/Board.js';
import { Unit } from '../logic/Unit.js';
import { CombatManager } from '../logic/CombatManager.js';
import { Scene3D } from '../three/Scene3D.js';
import { CombatAnimator3D } from '../three/CombatAnimator3D.js';
import { elementsForUnit } from '../three/constants.js';
import type { Position } from '../logic/types.js';

// ── Déclencheur manuel des pouvoirs ──────────────────────────────────────────
// Les 14 recettes de three/PowerVfx.ts ne se rencontrent pas en jouant : une
// carte porte au plus UN pouvoir, et les branches rares (cible immunisée,
// poussée butée) n'arrivent quasiment jamais. On fabrique donc les événements
// à la main et on les fait passer par le VRAI chemin de l'animateur — classes
// CSS, toast, immunité et blink de téléportation compris.
const POWERS: { id: string; label: string }[] = [
  { id: 'POWER_HEAL',         label: 'Soin' },
  { id: 'POWER_SHIELD',       label: 'Bouclier' },
  { id: 'POWER_SUPER_ATTACK', label: 'Super Att.' },
  { id: 'POWER_AOE_ATTACK',   label: 'Att. Zone' },
  { id: 'POWER_POISON',       label: 'Poison' },
  { id: 'POWER_BURN',         label: 'Brûlure' },
  { id: 'POWER_PARALYSIS',    label: 'Paralysie' },
  { id: 'POWER_PUSH',         label: 'Poussée' },
  { id: 'POWER_DEBUFF',       label: 'Débuff' },
  { id: 'POWER_BLOCK',        label: 'Blocage' },
  { id: 'POWER_CONFUSION',    label: 'Confusion' },
  { id: 'POWER_TAUNT',        label: 'Provocation' },
  { id: 'POWER_TELEPORT',     label: 'Téléport.' },
  { id: 'POWER_FREEZE',       label: 'Gel' },
];

// Les sept pouvoirs que `effect_immunity` peut dévier (cf. CombatManager).
const IMMUNE_CAPABLE = new Set([
  'POWER_POISON', 'POWER_PARALYSIS', 'POWER_PUSH', 'POWER_BURN',
  'POWER_FREEZE', 'POWER_BLOCK', 'POWER_CONFUSION',
]);

function extraFor(powerId: string, caster: any, target: any, blocked: boolean): any {
  switch (powerId) {
    case 'POWER_HEAL':         return { amount: Math.round(target.max_hp * 0.4) };
    case 'POWER_SHIELD':       return { amount: caster.atk * 2 };
    case 'POWER_SUPER_ATTACK': return { damage: caster.atk * 3 };
    case 'POWER_AOE_ATTACK':   return { damage: caster.atk };
    case 'POWER_POISON':       return { damage: 3, interval: 3, timer: 0 };
    case 'POWER_BURN':         return { damage: 3 };
    case 'POWER_PUSH':         return { pushed: blocked ? 0 : 2 };
    case 'POWER_PARALYSIS':
    case 'POWER_BLOCK':
    case 'POWER_CONFUSION':
    case 'POWER_TAUNT':        return { ticks: 20 };
    default:                   return {};
  }
}

function freeCellNear(board: any, pos: Position): Position | null {
  for (const [dc, dr] of [[0, -1], [1, 0], [-1, 0], [0, 1], [1, -1], [-1, -1]]) {
    const cell = { col: pos.col + dc, row: pos.row + dr };
    if (board.isInBounds(cell) && !board.isOccupied(cell) && !board.isBlocked(cell)) return cell;
  }
  return null;
}

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
  const cmRef = useRef<any>(null);
  const setupRef = useRef<LabSetup | null>(null);

  const [mountKey, setMountKey] = useState(0);
  const [phase, setPhase] = useState<'prep' | 'combat' | 'done'>('prep');
  const [winner, setWinner] = useState<string | null>(null);
  const [speed, setSpeed] = useState(1);
  const [paused, setPaused] = useState(false);
  const [steps, setSteps] = useState(0);
  const [casterIdx, setCasterIdx] = useState(0);
  const [immune, setImmune] = useState(false);
  const [casters, setCasters] = useState<{ label: string }[]>([]);

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

    // Créés dès le montage (le constructeur de CombatManager est inerte) pour que
    // le déclencheur de pouvoirs marche aussi en préparation.
    const cm = new (CombatManager as any)(setup.board, setup.players, setup.enemies, null);
    cmRef.current = cm;
    animatorRef.current = new CombatAnimator3D(cm, scene, {
      onStep: () => setSteps(cm._stepCount),
      onFinished: () => { setPhase('done'); setWinner(cm.winner); },
    });
    animatorRef.current.setSpeed(speed);
    setCasters(setup.players.map((u: any) => ({ label: `${u.card_id ?? u.name} · ${elementsForUnit(u).join('/')}` })));
    setPhase('prep');
    setWinner(null);
    setSteps(0);
    setPaused(false);

    return () => {
      animatorRef.current?.stop();
      animatorRef.current = null;
      cmRef.current = null;
      scene.dispose();
      sceneRef.current = null;
    };
    // `speed` n'est lu qu'à l'initialisation (changeSpeed le pousse ensuite) :
    // le mettre en dépendance ferait reconstruire toute la scène à chaque
    // changement de vitesse.
  }, [mountKey]);

  const startCombat = () => {
    const scene = sceneRef.current;
    const animator = animatorRef.current;
    if (!scene || !animator || phase === 'combat') return;

    scene.enterCombatMode();
    animator.setSpeed(speed);
    setPhase('combat');
    setPaused(false);
    animator.start();
  };

  // Fabrique les événements d'un pouvoir et les passe par le chemin réel de
  // l'animateur (le même `_apply` que `_schedule` appelle à chaque tick).
  const firePower = (powerId: string, blocked = false) => {
    const animator = animatorRef.current;
    const setup = setupRef.current;
    if (!animator || !setup) return;

    const allies = setup.players.filter((u: any) => u.isAlive() && u.position);
    const foes = setup.enemies.filter((u: any) => u.isAlive() && u.position);
    const caster = allies[casterIdx] ?? allies[0];
    if (!caster || !foes.length) return;
    const target = foes[0];

    let targets: any[] = [target];
    if (powerId === 'POWER_SHIELD' || powerId === 'POWER_TAUNT') targets = [caster];
    if (powerId === 'POWER_AOE_ATTACK') targets = foes;
    if (powerId === 'POWER_HEAL') {
      targets = [allies.reduce((a: any, b: any) => (a.current_hp < b.current_hp ? a : b), allies[0])];
    }

    const extra: any = extraFor(powerId, caster, targets[0], blocked);
    const isImmune = immune && IMMUNE_CAPABLE.has(powerId);
    if (isImmune) extra.immune = true;
    // L'orbite de confusion vit tant que le statut dure : sans le poser, elle
    // s'éteindrait à la première frame — et le banc mentirait sur la recette.
    if (powerId === 'POWER_CONFUSION' && !isImmune) target.confusion_remaining = 90;

    const events: any[] = [];
    if (powerId === 'POWER_TELEPORT') {
      const from = { ...caster.position };
      const dest = freeCellNear(setup.board, target.position);
      if (dest) setup.board.moveUnit(caster, dest);
      const to = { ...caster.position };
      events.push({ type: 'power', unit: caster, targets: [target], power_id: powerId, extra: { from, to } });
      events.push({ type: 'move', unit: caster, from, to });
    } else if (powerId === 'POWER_FREEZE' && !isImmune) {
      const cell = { ...target.position };
      const back = { col: cell.col, row: cell.row + 1 };
      if (setup.board.isInBounds(back) && !setup.board.isOccupied(back) && !setup.board.isBlocked(back)) {
        setup.board.moveUnit(target, back);
      }
      extra.cell = cell;
      extra.expiresAtStep = Infinity;
      events.push({ type: 'power', unit: caster, targets: [target], power_id: powerId, extra });
      events.push({ type: 'freeze', cell, expiresAtStep: Infinity });
    } else {
      events.push({ type: 'power', unit: caster, targets, power_id: powerId, extra });
    }

    const teleportUids = new Set<number>(
      events.filter((e) => e.type === 'power' && e.power_id === 'POWER_TELEPORT').map((e) => e.unit.uid),
    );
    for (const evt of events) animator._apply(evt, 180 / speed, new Set<number>(), teleportUids);
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
  const btnSmall = 'rounded border border-line bg-surface-raised px-2 py-1 text-white active:opacity-70';
  const btnSmallActive = 'rounded border border-gold bg-gold/20 px-2 py-1 text-gold';

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
      <div className="flex flex-wrap items-center gap-1 border-t border-line px-2 pb-2 text-xs">
        <span className="mr-1 opacity-70">Lanceur</span>
        {casters.map((c, i) => (
          <button
            key={c.label + i}
            className={i === casterIdx ? btnSmallActive : btnSmall}
            onClick={() => setCasterIdx(i)}
            title="La signature élémentaire du lanceur se superpose à la recette du pouvoir"
          >{c.label}</button>
        ))}
        <label className="ml-2 flex select-none items-center gap-1 opacity-80">
          <input type="checkbox" checked={immune} onChange={(e) => setImmune(e.target.checked)} />
          cible immunisée
        </label>
      </div>
      <div className="flex flex-wrap items-center gap-1 px-2 pb-2 text-xs">
        <span className="mr-1 opacity-70">Pouvoir</span>
        {POWERS.map((p) => (
          <button key={p.id} className={btnSmall} onClick={() => firePower(p.id)}>{p.label}</button>
        ))}
        <button className={btnSmall} onClick={() => firePower('POWER_PUSH', true)}>Poussée butée</button>
      </div>
      <div key={mountKey} ref={containerRef} className="relative min-h-0 flex-1" />
    </div>
  );
}
