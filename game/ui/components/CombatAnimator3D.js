import { updateUnitEl } from './UnitCard.js';
import { ELEMENT_STYLES, elementsForUnit } from './Board3D.js';

const BASE_TICK_MS = 180;

const POWER_NAMES = {
  POWER_HEAL:         'Soin',
  POWER_SHIELD:       'Bouclier',
  POWER_SUPER_ATTACK: 'Super Attaque',
  POWER_AOE_ATTACK:   'Attaque Zone',
  POWER_POISON:       'Poison',
  POWER_PARALYSIS:    'Paralysie',
  POWER_PUSH:         'Poussée',
  POWER_DEBUFF:       'Débuff',
  POWER_BLOCK:        'Blocage',
  POWER_BURN:         'Brûlure',
  POWER_TELEPORT:     'Téléportation',
  POWER_FREEZE:       'Gel',
  POWER_CONFUSION:    'Confusion',
  POWER_TAUNT:        'Provocation',
};

const POWER_COLORS = {
  POWER_HEAL:      0x4caf80,
  POWER_SHIELD:    0x6ab4e8,
  POWER_POISON:    0xc878e0,
  POWER_PARALYSIS: 0xf0c040,
  POWER_PUSH:      0xf0a040,
  POWER_BURN:      0xff6020,
  POWER_FREEZE:    0x8fd6ff,
  POWER_TELEPORT:  0xb070ff,
  POWER_CONFUSION: 0xa040c8,
  POWER_TAUNT:     0xc83020,
};

function _cellKey(pos) { return `${pos.col},${pos.row}`; }

export class CombatAnimator3D {
  constructor(combatManager, board3D, { onFinished, onStep } = {}) {
    this._cm = combatManager;
    this._board = board3D;
    this._onFinished = onFinished;
    this._onStep = onStep;
    this._speed = 1;
    this._timer = null;
    this._running = false;
    this._paused = false;
    this._frozenCells = new Map(); // cellKey → expiresAtStep, for the POWER_FREEZE overlay
  }

  setSpeed(s) { this._speed = s; }

  pause() {
    this._paused = true;
  }

  resume() {
    if (!this._paused) return;
    this._paused = false;
    if (this._running) this._schedule();
  }

  start() {
    this._running = true;
    this._paused = false;
    this._schedule();
  }

  stop() {
    this._running = false;
    this._paused = false;
    if (this._timer) clearTimeout(this._timer);
    this._timer = null;
  }

  _schedule() {
    const interval = BASE_TICK_MS / this._speed;
    this._timer = setTimeout(() => {
      if (!this._running || this._paused) return;
      const events = this._cm.step();
      this._onStep?.(events);
      const dyingUids = new Set(events.filter(e => e.type === 'death').map(e => e.unit.uid));
      for (const evt of events) this._apply(evt, interval, dyingUids);
      this._purgeFrozenCells();
      this._refreshPowerGauges();
      if (this._cm.isOver) {
        this._running = false;
        setTimeout(() => this._onFinished?.(), 500);
        return;
      }
      this._schedule();
    }, interval);
  }

  _refreshPowerGauges() {
    for (const unit of [...this._cm.playerUnits, ...this._cm.enemyUnits]) {
      if (!unit.isAlive()) continue;
      const entry = this._board.getUnitEntry(unit.uid);
      if (entry) updateUnitEl(entry.el, unit);
    }
  }

  _apply(evt, interval, dyingUids = new Set()) {
    switch (evt.type) {
      case 'move':   this._applyMove(evt, interval); break;
      case 'attack': this._applyAttack(evt, dyingUids); break;
      case 'dot':    this._applyDot(evt);     break;
      case 'power':  this._applyPower(evt);   break;
      case 'death':  this._applyDeath(evt);   break;
      case 'freeze': this._applyFreeze(evt);  break;
    }
  }

  _applyFreeze({ cell, expiresAtStep }) {
    // Only one ice block exists at a time — clear any previous frozen cell's
    // overlay before showing the new one (mirrors Board.clearTemporaryBlocks).
    for (const { cell: oldCell } of this._frozenCells.values()) {
      this._board.removeTemporaryBlockedCell(oldCell);
    }
    this._frozenCells.clear();
    this._frozenCells.set(_cellKey(cell), { cell, expiresAtStep });
    this._board.addTemporaryBlockedCell(cell);
  }

  // Frozen cells are purged on the animator's own tick (not by the events
  // array, which only reports new freezes) since the logic-side expiry is
  // silent — CombatManager just stops re-blocking the cell once it lapses.
  _purgeFrozenCells() {
    const currentStep = this._cm._stepCount;
    for (const [cellKey, { cell, expiresAtStep }] of this._frozenCells) {
      if (currentStep >= expiresAtStep) {
        this._board.removeTemporaryBlockedCell(cell);
        this._frozenCells.delete(cellKey);
      }
    }
  }

  _applyMove({ unit, to }) {
    this._board.animateUnitMove(unit.uid, to);
  }

  _applyAttack({ attacker, target }, dyingUids) {
    const isFatal = dyingUids.has(target.uid);
    const atkEntry = this._board.getUnitEntry(attacker.uid);
    if (atkEntry) this._flashClass(atkEntry.el, 'anim-shake');
    const projColor = (ELEMENT_STYLES[elementsForUnit(attacker)[0]] || ELEMENT_STYLES.neutral).color;

    if (elementsForUnit(attacker).includes('feu') && attacker.position) {
      const atier = Math.max(1, Math.min(5, attacker.tier ?? 1));
      this._board.spawnFlames(attacker.position, atier, { count: 8 + atier * 3, maxLife: 0.32, spread: 0.16 });
    }
    if (elementsForUnit(attacker).includes('eau') && attacker.position) {
      const atier = Math.max(1, Math.min(5, attacker.tier ?? 1));
      this._board.spawnSplash(attacker.position, atier, { count: 6 + atier * 4, maxLife: 0.3, spread: 0.12 });
    }

    if (attacker.range > 1) {
      if (atkEntry && target.position) {
        this._board.playProjectile(attacker.position, target.position, projColor).then(() => {
          if (!isFatal) this._hitTarget(target, attacker);
        });
      } else if (!isFatal) {
        this._hitTarget(target, attacker);
      }
    } else {
      if (atkEntry && target.position) this._board.playLunge(attacker.uid, target.position);
      if (!isFatal) this._hitTarget(target, attacker);
    }
  }

  _hitTarget(target, attacker) {
    const entry = this._board.getUnitEntry(target.uid);
    if (entry) {
      this._flashClass(entry.el, 'anim-hit');
      updateUnitEl(entry.el, target);
    }
    if (target.position) {
      // Tiers 1-3 partagent le même niveau de particules (cf. demande de mise à niveau).
      const atier = Math.max(3, Math.min(5, attacker?.tier ?? 1));
      const ATK_CFG = [
        { pc:  8, rS: 2 },
        { pc: 20, rS: 3 },
        { pc: 38, rS: 5 },
        { pc: 55, rS: 6 },
        { pc: 70, rS: 8 },
      ][atier - 1];
      const elements = elementsForUnit(attacker);
      const perPc = Math.max(1, Math.round(ATK_CFG.pc / elements.length));
      for (const element of elements) {
        const style = ELEMENT_STYLES[element] || ELEMENT_STYLES.neutral;
        this._board.spawnBurst(target.position, style.color, perPc, {
          size: 0.04 + atier * 0.012,
          speed: [0.4, 0.6 + atier * 0.3],
          lift:  [0.3, 0.5 + atier * 0.2],
          gravity: 8,
          maxLife: 0.20 + atier * 0.04,
        });
        this._board.spawnRing(target.position, style.ringColor, 0.20 + atier * 0.04, ATK_CFG.rS);
        if (element === 'foudre') {
          const arcCount = 5 + atier * 2;
          for (let i = 0; i < arcCount; i++) {
            const angle = Math.random() * Math.PI * 2;
            const dist = 0.4 + Math.random() * 0.4 * (atier / 5);
            const end = {
              col: target.position.col + Math.cos(angle) * dist,
              row: target.position.row + Math.sin(angle) * dist,
            };
            this._board.spawnLightningArc(target.position, end, style.color, { maxLife: 0.14 + atier * 0.015, branches: atier >= 3 ? 2 : 1 });
          }
        }
        if (element === 'feu') this._board.spawnFlames(target.position, atier, { count: 10 + atier * 6 });
        if (element === 'eau') this._board.spawnSplash(target.position, atier, { count: 8 + atier * 5 });
      }
    }
  }

  _applyDot({ unit }) {
    const entry = this._board.getUnitEntry(unit.uid);
    if (entry) {
      this._flashClass(entry.el, 'anim-poison');
      updateUnitEl(entry.el, unit);
    }
  }

  _applyPower({ unit, targets, power_id }) {
    const casterEntry = this._board.getUnitEntry(unit.uid);
    if (casterEntry) {
      this._flashClass(casterEntry.el, 'anim-power-cast');
      updateUnitEl(casterEntry.el, unit);
      if (unit.position) this._showPowerToast(unit.position, power_id);
    }

    const cls = _powerTargetClass(power_id);
    const color = POWER_COLORS[power_id] ?? 0xf04050;

    for (const t of targets) {
      const entry = this._board.getUnitEntry(t.uid);
      if (entry) {
        this._flashClass(entry.el, cls);
        updateUnitEl(entry.el, t);
      }
      if (t.position) {
        this._board.spawnBurst(t.position, color, 50);
        this._board.spawnRing(t.position, color);
      }

      // POWER_PUSH / POWER_FREEZE : la logique a déjà déplacé l'unité via
      // board.moveUnit, mais aucun event 'move' n'est émis — on anime le
      // déplacement ici.
      if ((power_id === 'POWER_PUSH' || power_id === 'POWER_FREEZE') && entry && t.position) {
        this._board.animateUnitMove(t.uid, t.position, 0.2);
      }
    }
  }

  _applyDeath({ unit }) {
    this._board.killUnitObj(unit.uid);
  }

  _showPowerToast(pos, power_id) {
    const label = POWER_NAMES[power_id] ?? power_id.replace('POWER_', '').replace(/_/g, ' ');
    const screen = this._board.worldToScreen(this._board.tilePosition(pos));
    const toast = document.createElement('div');
    toast.className = 'power-cast-label';
    toast.textContent = label;
    toast.style.left = screen.x + 'px';
    toast.style.top  = (screen.y - 50) + 'px';
    document.body.appendChild(toast);
    toast.addEventListener('animationend', () => toast.remove(), { once: true });
  }

  _flashClass(el, cls) {
    el.classList.remove(cls);
    void el.offsetWidth; // force reflow pour redémarrer l'animation
    el.classList.add(cls);
    el.addEventListener('animationend', () => el.classList.remove(cls), { once: true });
  }
}

function _powerTargetClass(power_id) {
  switch (power_id) {
    case 'POWER_HEAL':      return 'anim-heal';
    case 'POWER_SHIELD':    return 'anim-shield';
    case 'POWER_POISON':    return 'anim-poison';
    case 'POWER_PARALYSIS': return 'anim-paralysis';
    default:                return 'anim-hit';
  }
}
