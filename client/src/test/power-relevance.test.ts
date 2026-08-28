/* eslint-disable @typescript-eslint/no-explicit-any */
// Golden tests de la pertinence d'un pouvoir vis-à-vis de sa CIBLE.
//
// Une jauge pleine ne suffit plus : le pouvoir ne part que s'il a quelque chose
// à faire à la cible que findAttackTarget vient de désigner (CombatManager
// ._isPowerRelevant). Sinon l'unité attaque normalement et GARDE sa jauge —
// c'est ce dernier point qui distingue « en attente » de « gâché », et il ne se
// voit nulle part en jeu : la barre de pouvoir affiche 100 % dans les deux cas.
//
// Chaque cas est éprouvé DANS LES DEUX SENS : le pouvoir se tait quand il ne
// ferait rien, ET part dès que la cible le mérite. Un test qui ne vérifierait
// que le refus passerait aussi sur un pouvoir cassé qui ne part jamais.
import { describe, it, expect } from 'vitest';
import { makeBoard, makeCard, spawn } from './helpers.js';
import { CombatManager } from '../logic/CombatManager.js';

// Le lanceur est au contact de sa cible (portée 3), avec un allié derrière lui
// et un second ennemi — de quoi couvrir les prédicats qui regardent ailleurs
// que la cible (soin sur l'allié le plus bas, confusion sur le camp d'en face).
function arena(power: any, opts: { casterStats?: any; targetPower?: any } = {}) {
  const board = makeBoard();
  const caster = spawn(board, makeCard({
    id: 'P_CASTER', power,
    stats: { atk: 10, hp: 200, attack_speed: 2, initiative: 5, movement_speed: 1, range: 3, ...opts.casterStats },
  }), 'player', { col: 2, row: 3 });
  const ally = spawn(board, makeCard({
    id: 'P_ALLY', stats: { atk: 5, hp: 100, attack_speed: 2, initiative: 4, movement_speed: 1, range: 1 },
  }), 'player', { col: 1, row: 3 });
  const target = spawn(board, makeCard({
    id: 'E_TARGET', power: opts.targetPower ?? null,
    stats: { atk: 5, hp: 500, attack_speed: 2, initiative: 3, movement_speed: 1, range: 1 },
  }), 'enemy', { col: 2, row: 7 });
  const target2 = spawn(board, makeCard({
    id: 'E_TARGET_2', stats: { atk: 5, hp: 500, attack_speed: 2, initiative: 3, movement_speed: 1, range: 1 },
  }), 'enemy', { col: 3, row: 7 });

  const combat = new (CombatManager as any)(board, [caster, ally], [target, target2], null);
  const relevant = (t: any = target) => combat._isPowerRelevant(caster, t);
  return { board, combat, caster, ally, target, target2, relevant };
}

describe('pertinence d\'un pouvoir vis-à-vis de sa cible', () => {
  // ── POWER_BLOCK : l'exemple canonique — bloquer un pouvoir absent ──
  it('POWER_BLOCK se tait sur une cible SANS pouvoir', () => {
    const a = arena({ id: 'POWER_BLOCK', power_speed: 1 });   // E_TARGET n'a pas de pouvoir
    expect(a.relevant()).toBe(false);
  });

  it('POWER_BLOCK part sur une cible qui en a un', () => {
    const a = arena({ id: 'POWER_BLOCK', power_speed: 1 }, { targetPower: { id: 'POWER_HEAL', power_speed: 5 } });
    expect(a.relevant()).toBe(true);
  });

  it('POWER_BLOCK ne se rejoue pas sur une cible DÉJÀ bloquée — power_block_remaining est ASSIGNÉ, le rejeu pourrait raccourcir', () => {
    const a = arena({ id: 'POWER_BLOCK', power_speed: 1 }, { targetPower: { id: 'POWER_HEAL', power_speed: 5 } });
    a.target.is_power_blocked = true;
    a.target.power_block_remaining = 25;
    expect(a.relevant()).toBe(false);

    a.target.is_power_blocked = false;   // le blocage lapse → la charge repart
    expect(a.relevant()).toBe(true);
  });

  // ── POWER_DEBUFF : l'autre exemple — dissiper le vide ──
  it('POWER_DEBUFF se tait sur une cible qui ne porte RIEN', () => {
    const a = arena({ id: 'POWER_DEBUFF', power_speed: 1 });
    expect(a.relevant()).toBe(false);
  });

  it('POWER_DEBUFF part sur un bonus de stat, un statut ou une immunité', () => {
    const cases: ((u: any) => void)[] = [
      u => u.applyStatBonus('atk', 5),
      u => u.dot_effects.push({ damage: 3, interval: 3, timer: 0 }),
      u => u.burn_stacks.push({ damage: 3 }),
      u => { u.paralysis_remaining = 10; u.attack_speed_modifier = 2; },
      u => { u.is_power_blocked = true; },
      u => { u.confusion_remaining = 10; },
      u => { u.taunt_remaining = 10; },
      u => { u.is_effect_immune = true; },
    ];
    for (const apply of cases) {
      const a = arena({ id: 'POWER_DEBUFF', power_speed: 1 });
      expect(a.relevant()).toBe(false);
      apply(a.target);
      expect(a.relevant()).toBe(true);
    }
  });

  it('⚠️ POWER_DEBUFF ignore la JAUGE de la cible : resetCombatStats la remet à zéro, mais ce n\'est pas ce que le pouvoir dissipe', () => {
    // La compter rendrait le pouvoir pertinent contre tout ennemi doté d'un
    // pouvoir — c'est-à-dire annulerait le filtre sur celui qui en avait le
    // plus besoin. Décision assumée, pas un oubli.
    const a = arena({ id: 'POWER_DEBUFF', power_speed: 1 }, { targetPower: { id: 'POWER_HEAL', power_speed: 40 } });
    a.target.power_gauge = 39;
    expect(a.relevant()).toBe(false);
  });

  // ── POWER_HEAL ──
  it('POWER_HEAL se tait quand tout le camp est à PV pleins, part dès qu\'un allié est blessé', () => {
    const a = arena({ id: 'POWER_HEAL', power_speed: 1 });
    expect(a.relevant()).toBe(false);
    a.ally.current_hp = 10;
    expect(a.relevant()).toBe(true);
  });

  it('POWER_HEAL part aussi pour le lanceur lui-même — il est son propre allié', () => {
    const a = arena({ id: 'POWER_HEAL', power_speed: 1 });
    a.caster.current_hp = 10;
    expect(a.relevant()).toBe(true);
  });

  it('POWER_HEAL ignore un allié NEUTRALISÉ : le soin ne relève pas', () => {
    const a = arena({ id: 'POWER_HEAL', power_speed: 1 });
    a.ally.current_hp = 0;
    a.ally.is_neutralized = true;
    expect(a.relevant()).toBe(false);
  });

  // ── POWER_PARALYSIS / POWER_CONFUSION / POWER_TAUNT : statuts ASSIGNÉS ──
  it('POWER_PARALYSIS ne se rejoue pas sur une cible déjà paralysée', () => {
    const a = arena({ id: 'POWER_PARALYSIS', power_speed: 1 });
    expect(a.relevant()).toBe(true);
    a.target.paralysis_remaining = 20;
    expect(a.relevant()).toBe(false);
  });

  it('POWER_CONFUSION se tait sur un ennemi SEUL — il n\'a personne à retourner contre lui', () => {
    const a = arena({ id: 'POWER_CONFUSION', power_speed: 1 });
    expect(a.relevant()).toBe(true);
    a.target2.is_neutralized = true;
    expect(a.relevant()).toBe(false);
  });

  it('POWER_CONFUSION ne se rejoue pas sur une cible déjà confuse', () => {
    const a = arena({ id: 'POWER_CONFUSION', power_speed: 1 });
    a.target.confusion_remaining = 20;
    expect(a.relevant()).toBe(false);
  });

  it('POWER_TAUNT ne se rejoue pas tant que la provocation du lanceur court', () => {
    const a = arena({ id: 'POWER_TAUNT', power_speed: 1 });
    expect(a.relevant()).toBe(true);
    a.caster.taunt_remaining = 20;
    expect(a.relevant()).toBe(false);
  });

  // ── POWER_PUSH / POWER_FREEZE : la retraite doit être possible ──
  it('POWER_PUSH se tait quand la cible est adossée au bord du board', () => {
    const a = arena({ id: 'POWER_PUSH', power_speed: 1 });
    expect(a.relevant()).toBe(true);
    a.board.moveUnit(a.target, { col: 2, row: a.board.rows - 1 });
    expect(a.relevant()).toBe(false);
  });

  it('POWER_PUSH se tait quand une unité occupe la case de retraite', () => {
    const a = arena({ id: 'POWER_PUSH', power_speed: 1 });
    a.board.moveUnit(a.target2, { col: 2, row: 8 });   // juste derrière E_TARGET
    expect(a.relevant()).toBe(false);
  });

  it('POWER_PUSH se tait quand la case de retraite est bloquée par le terrain', () => {
    const a = arena({ id: 'POWER_PUSH', power_speed: 1 });
    a.board.setBlockedCells([{ col: 2, row: 8 }]);
    expect(a.relevant()).toBe(false);
  });

  it('POWER_FREEZE suit la MÊME règle : sans retraite, la case gelée serait celle où la cible se tient encore', () => {
    const a = arena({ id: 'POWER_FREEZE', power_speed: 1 });
    expect(a.relevant()).toBe(true);
    a.board.moveUnit(a.target, { col: 2, row: a.board.rows - 1 });
    expect(a.relevant()).toBe(false);
  });

  // ── POWER_TELEPORT : le saut doit rapprocher ──
  it('POWER_TELEPORT se tait quand le lanceur est DÉJÀ au contact du plus faible', () => {
    const a = arena({ id: 'POWER_TELEPORT', power_speed: 1 });
    a.target.current_hp = 1;                              // le plus faible
    expect(a.relevant()).toBe(true);                      // (2,3) → loin
    a.board.moveUnit(a.caster, { col: 2, row: 6 });        // au contact de (2,7)
    expect(a.relevant()).toBe(false);
  });

  it('POWER_TELEPORT se tait sans aucun ennemi vivant', () => {
    const a = arena({ id: 'POWER_TELEPORT', power_speed: 1 });
    a.target.is_neutralized = true;
    a.target2.is_neutralized = true;
    expect(a.relevant()).toBe(false);
  });

  // ── Ce qui n'est PAS filtré ──
  it('les pouvoirs qui posent toujours quelque chose ne sont jamais retenus', () => {
    for (const id of ['POWER_SUPER_ATTACK', 'POWER_AOE_ATTACK', 'POWER_SHIELD', 'POWER_POISON', 'POWER_BURN']) {
      expect(arena({ id, power_speed: 1 }).relevant()).toBe(true);
    }
  });

  it('poison et brûlure CUMULENT : une cible déjà touchée reste une cible valide', () => {
    const a = arena({ id: 'POWER_POISON', power_speed: 1 });
    a.target.dot_effects.push({ damage: 3, interval: 3, timer: 0 });
    expect(a.relevant()).toBe(true);
  });

  it('⚠️ l\'IMMUNITÉ n\'est pas un motif de retenue — la déflexion est un contre que le joueur a gagné', () => {
    const a = arena({ id: 'POWER_PARALYSIS', power_speed: 1 });
    a.target.is_effect_immune = true;
    expect(a.relevant()).toBe(true);
  });

  it('un pouvoir inconnu part (et retombe sur l\'attaque normale, comme avant)', () => {
    expect(arena({ id: 'POWER_INEXISTANT', power_speed: 1 }).relevant()).toBe(true);
  });
});

describe('conséquence en combat : la jauge est RETENUE, pas dépensée', () => {
  // Un lanceur au contact, dont le pouvoir n'a rien à faire à la cible.
  function duel(power: any, targetPower: any = null) {
    const board = makeBoard();
    const caster = spawn(board, makeCard({
      id: 'P_CASTER', power,
      stats: { atk: 10, hp: 500, attack_speed: 2, initiative: 9, movement_speed: 1, range: 3 },
    }), 'player', { col: 2, row: 5 });
    const target = spawn(board, makeCard({
      id: 'E_TARGET', power: targetPower,
      stats: { atk: 1, hp: 500, attack_speed: 2, initiative: 1, movement_speed: 99, range: 1 },
    }), 'enemy', { col: 2, row: 7 });
    const combat = new (CombatManager as any)(board, [caster], [target], null);
    return { combat, caster, target };
  }

  it('sans cible valable : la jauge reste PLEINE et l\'unité attaque normalement', () => {
    const d = duel({ id: 'POWER_BLOCK', power_speed: 3 });   // la cible n'a pas de pouvoir
    const events: any[] = [];
    for (let i = 0; i < 10; i++) events.push(...d.combat.step());

    expect(events.some(e => e.type === 'power')).toBe(false);
    expect(events.some(e => e.type === 'attack')).toBe(true);
    expect(d.caster.power_gauge).toBeGreaterThanOrEqual(d.caster.power_speed);
  });

  it('la charge retenue part au premier tick où la cible la mérite', () => {
    const d = duel({ id: 'POWER_BLOCK', power_speed: 3 });
    for (let i = 0; i < 10; i++) d.combat.step();
    expect(d.caster.power_gauge).toBeGreaterThanOrEqual(3);

    d.target.power_id = 'POWER_HEAL';   // la cible devient bloquable
    // Deux steps : le lanceur n'agit qu'un tick sur deux (attack_speed = 2).
    const events = [...d.combat.step(), ...d.combat.step()];
    expect(events.some(e => e.type === 'power' && e.power_id === 'POWER_BLOCK')).toBe(true);
    expect(d.caster.power_gauge).toBeLessThan(d.caster.power_speed);
  });

  it('un pouvoir pertinent part comme avant — le filtre n\'est pas un frein général', () => {
    const d = duel({ id: 'POWER_SUPER_ATTACK', power_speed: 3 });
    const events: any[] = [];
    for (let i = 0; i < 10; i++) events.push(...d.combat.step());
    expect(events.filter(e => e.type === 'power').length).toBeGreaterThan(0);
  });
});
