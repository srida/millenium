import { navigate } from '../../main.js';
import * as AuthClient from '../../data/AuthClient.js';
import * as CardDatabase from '../../data/CardDatabase.js';
import * as PowerDatabase from '../../data/PowerDatabase.js';
import * as AttributeDatabase from '../../data/AttributeDatabase.js';
import * as BoardDatabase from '../../data/BoardDatabase.js';
import { Board } from '../../logic/Board.js';
import { Unit } from '../../logic/Unit.js';
import { AttributeManager } from '../../logic/AttributeManager.js';
import { CombatManager } from '../../logic/CombatManager.js';
import { applyEffect as applyBoardEffect } from '../../logic/BoardEffect.js';
import { createBoard3D, CARD_PX } from '../components/Board3D.js';
import { CombatAnimator3D } from '../components/CombatAnimator3D.js';
import * as Tooltip from '../components/Tooltip.js';

// Écran développeur : placement libre, rendu via Board3D + CombatAnimator3D
// (voir GameScreen3D.js pour le même principe appliqué à la boucle de jeu complète).

const _TB_TIER = {
  1: ['#5ad0a0','#93ecc6','#06110d','rgba(90,208,160,.5)','linear-gradient(160deg,#123528,#06110d)'],
  2: ['#6fb2dc','#a9d6f2','#060f18','rgba(111,178,220,.5)','linear-gradient(160deg,#122a3f,#060f18)'],
  3: ['#9d74dc','#d6bdf6','#0c0820','rgba(157,116,220,.55)','linear-gradient(160deg,#241442,#0c0820)'],
  4: ['#cba85a','#ecd7a2','#140f06','rgba(203,168,90,.55)','linear-gradient(160deg,#3a2c12,#140f06)'],
  5: ['#d86a7e','#f5b3bf','#140609','rgba(216,106,126,.52)','linear-gradient(160deg,#3a1420,#140609)'],
};

const TIERS = [1, 2, 3, 4, 5];
const SUMMON_TYPES = ['normal', 'sacrifice', 'fusion', 'heritage', 'transformation'];

let _activeUnmount = null;

export function unmount() {
  if (_activeUnmount) _activeUnmount();
  _activeUnmount = null;
}

export async function mount(container) {
  // Réservé aux comptes admin (accès direct via ?screen=testbench3d sinon).
  let user = AuthClient.getUser();
  if (!user) { try { user = await AuthClient.me(); } catch { /* ignore */ } }
  if (!user?.is_admin) { navigate('main_menu'); return; }

  await Promise.all([CardDatabase.init(), PowerDatabase.init(), AttributeDatabase.init(), BoardDatabase.init()]);

  const board = new Board();
  let selectedCard = null;         // card from browser
  let placingSide = 'player';      // 'player' | 'enemy'
  let tierFilter = '';             // '' = all
  let typeFilter = '';
  let searchQuery = '';
  let phase = 'prep';              // 'prep' | 'combat'
  let inspector = false;
  let _selectedBrowserBtn = null;  // currently selected browser card button
  let selectedBoard = null;        // BoardDatabase entry | null

  // ── Shell ─────────────────────────────────────────────────────────────────

  container.innerHTML = `
    <div class="topbar">
      <button class="topbar-back" id="tb-back">←</button>
      <span class="topbar-title">TestBench 3D</span>
      <div style="display:flex;gap:6px;align-items:center">
        <button class="btn btn-secondary" id="tb-clear" style="min-height:36px;padding:0 12px;font-size:12px">Vider</button>
        <button class="btn btn-primary"   id="tb-combat" style="min-height:36px;padding:0 12px;font-size:12px">▶ Combat</button>
      </div>
    </div>
    <div class="tb-layout">
      <div class="tb-board-col">
        <div class="tb-side-toggle">
          <button class="tb-side-btn active" data-side="player">Joueur</button>
          <button class="tb-side-btn"        data-side="enemy">Ennemi</button>
        </div>
        <div class="tb-terrain-row">
          <span style="font-size:15px;flex-shrink:0">🗺️</span>
          <select id="tb-board-select" class="tb-terrain-select">
            <option value="">Aucun terrain</option>
          </select>
          <button id="tb-terrain-info" class="tb-terrain-info" style="display:none">ℹ</button>
        </div>
        <div class="attribute-panel" id="tb-attribute-panel"></div>
        <div class="game3d-wrap" id="tb-board-area">
          <div class="game3d-3d" id="tb-board3d-mount"></div>
        </div>
        <div id="tb-speed-controls" class="combat-speed-controls" style="display:none;padding:6px 12px;border-top:1px solid var(--border)">
          <span class="speed-label">Vitesse</span>
          <button class="btn btn-secondary speed-btn active" data-speed="1">×1</button>
          <button class="btn btn-secondary speed-btn"        data-speed="2">×2</button>
          <button class="btn btn-secondary speed-btn"        data-speed="4">×4</button>
          <div style="flex:1"></div>
          <button class="btn btn-secondary speed-btn" id="tb-pause">⏸</button>
        </div>
        <div id="tb-inspector" style="display:none"></div>
      </div>
      <div class="tb-browser-col">
        <div class="tb-filters">
          <div class="summon-filter-bar" id="tb-tier-filters">
            <button class="filter-pill active" data-tier="">Tous</button>
            ${TIERS.map(t => `<button class="filter-pill" data-tier="${t}">T${t}</button>`).join('')}
          </div>
          <div class="summon-filter-bar" id="tb-type-filters">
            <button class="filter-pill active" data-type="">Tous</button>
            ${SUMMON_TYPES.map(t => `<button class="filter-pill" data-type="${t}">${_cap(t)}</button>`).join('')}
          </div>
          <input class="search-input" id="tb-search" type="search" placeholder="Rechercher…">
        </div>
        <div class="card-grid" id="tb-card-grid" style="overflow-y:auto;flex:1;min-height:0;padding:4px 6px"></div>
      </div>
    </div>
  `;

  // ── Grid (3D) ─────────────────────────────────────────────────────────────

  const board3D = await createBoard3D(container.querySelector('#tb-board3d-mount'), {
    onCellTap: handleCellTap,
    onUnitTap: handleUnitTap,
    onUnitDrag: handleUnitDrag,
    onUnitLongPress: (unit, pos, rect) => {
      if (phase !== 'prep') {
        Tooltip.showAtRect(Tooltip.unitHtml(unit, PowerDatabase, AttributeDatabase, CardDatabase), rect);
        return;
      }
      board.removeUnit(unit);
      board3D.refresh();
      _refreshAttributePanel();
    },
    showEnemySide: true,
    powerDb: PowerDatabase,
    attributeDb: AttributeDatabase,
  });
  board3D.setBoard(board);
  board3D.refresh();

  // ── Terrain selector ──────────────────────────────────────────────────────

  const boardSelect = container.querySelector('#tb-board-select');
  const terrainInfo = container.querySelector('#tb-terrain-info');

  for (const b of BoardDatabase.getAllBoards()) {
    const opt = document.createElement('option');
    opt.value = b.id;
    opt.textContent = b.name;
    boardSelect.appendChild(opt);
  }

  boardSelect.addEventListener('change', () => {
    const id = boardSelect.value;
    selectedBoard = id ? BoardDatabase.getBoard(id) : null;
    const cells = selectedBoard?.blocked_cells || [];
    board.setBlockedCells(cells);
    board3D.setBlockedCells(cells);
    terrainInfo.style.display = selectedBoard ? '' : 'none';
  });

  terrainInfo.addEventListener('pointerdown', e => {
    e.stopPropagation();
    if (selectedBoard) Tooltip.toggle(Tooltip.boardHtml(selectedBoard, AttributeDatabase), terrainInfo);
  });

  // ── Interaction ───────────────────────────────────────────────────────────

  function handleCellTap(pos) {
    Tooltip.hide();
    if (phase !== 'prep' || !selectedCard) return;
    const isPlayerCell = pos.row <= 3;
    // Enforce side tab: Joueur → player half only, Ennemi → enemy half only
    if (placingSide === 'player' && !isPlayerCell) return;
    if (placingSide === 'enemy'  &&  isPlayerCell) return;
    if (board.isOccupied(pos)) return;
    const side = isPlayerCell ? 'player' : 'enemy';
    const unit = new Unit(selectedCard, side);
    board.placeUnit(unit, pos);
    board3D.refresh();
    _refreshAttributePanel();
  }

  function handleUnitTap(unit, pos) {
    const screen = board3D.worldToScreen(board3D.tilePosition(pos));
    const top = screen.y - CARD_PX / 2;
    const rect = { left: screen.x - CARD_PX / 2, top, bottom: top + CARD_PX, width: CARD_PX, height: CARD_PX };
    Tooltip.showAtRect(Tooltip.unitHtml(unit, PowerDatabase, AttributeDatabase, CardDatabase), rect);
  }

  function handleUnitDrag(unit, fromPos, toPos) {
    if (phase !== 'prep') return;
    if (toPos.col === fromPos.col && toPos.row === fromPos.row) return;
    if (board.isOccupied(toPos)) {
      const other = board.getUnit(toPos);
      if (other) {
        board.removeUnit(unit);
        board.removeUnit(other);
        board.placeUnit(other, fromPos);
        board.placeUnit(unit, toPos);
      }
    } else {
      board.moveUnit(unit, toPos);
    }
    unit.initial_position = { ...toPos };
    board3D.refresh();
  }

  // ── Side toggle ───────────────────────────────────────────────────────────

  container.querySelectorAll('.tb-side-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      placingSide = btn.dataset.side;
      container.querySelectorAll('.tb-side-btn').forEach(b =>
        b.classList.toggle('active', b === btn));
      _refreshAttributePanel();
    });
  });

  // ── Filters ───────────────────────────────────────────────────────────────

  container.querySelector('#tb-tier-filters').addEventListener('click', e => {
    const pill = e.target.closest('.filter-pill');
    if (!pill) return;
    tierFilter = pill.dataset.tier;
    container.querySelectorAll('#tb-tier-filters .filter-pill').forEach(p =>
      p.classList.toggle('active', p.dataset.tier === tierFilter));
    renderBrowser();
  });

  container.querySelector('#tb-type-filters').addEventListener('click', e => {
    const pill = e.target.closest('.filter-pill');
    if (!pill) return;
    typeFilter = pill.dataset.type;
    container.querySelectorAll('#tb-type-filters .filter-pill').forEach(p =>
      p.classList.toggle('active', p.dataset.type === typeFilter));
    renderBrowser();
  });

  container.querySelector('#tb-search').addEventListener('input', e => {
    searchQuery = e.target.value;
    renderBrowser();
  });

  // ── Card browser ──────────────────────────────────────────────────────────

  function renderBrowser() {
    const grid_el = container.querySelector('#tb-card-grid');
    const query = searchQuery.toLowerCase().trim();
    const all = CardDatabase.getAllCards();
    const filtered = all.filter(c => {
      if (tierFilter && String(c.tier) !== tierFilter) return false;
      if (typeFilter && c.summon_type !== typeFilter) return false;
      if (query && !c.name.toLowerCase().includes(query)) return false;
      return true;
    });

    grid_el.innerHTML = '';
    _selectedBrowserBtn = null;
    for (const c of filtered) {
      const btn = document.createElement('button');
      const costHint = _costHint(c);
      const isSelected = selectedCard?.id === c.id;
      btn.className = 'card-item tb-browser-card' + (isSelected ? ' selected' : '');
      btn.dataset.id = c.id;
      const [te, ti, td, tg, ta] = _TB_TIER[c.tier] || _TB_TIER[4];
      btn.style.setProperty('--hc-edge', te);
      btn.style.setProperty('--hc-ink',  ti);
      btn.style.setProperty('--hc-deep', td);
      btn.style.setProperty('--hc-glow', tg);
      btn.style.setProperty('--hc-art',  ta);
      btn.innerHTML = `
        <div class="hand-card-frame-border"></div>
        <div class="hand-card-frame-glow"></div>
        <div class="hand-card-art">
          <img class="hand-card-img" src="/illustrations/${c.id}" alt="${_esc(c.name)}" loading="lazy" draggable="false">
          <div class="hand-card-nebula"></div>
          <div class="hand-card-top-edge"></div>
          <div class="hand-card-footer"><span class="hand-card-name">${_esc(c.name)}</span></div>
          ${costHint ? `<div class="hand-card-summon-icon">${costHint}</div>` : ''}
        </div>
      `;
      if (isSelected) _selectedBrowserBtn = btn;

      let longPressTimer;
      btn.addEventListener('pointerdown', () => {
        longPressTimer = setTimeout(() => {
          Tooltip.showAtRect(Tooltip.cardHtml(c, PowerDatabase, AttributeDatabase, CardDatabase), btn.getBoundingClientRect());
        }, 500);
      });
      btn.addEventListener('pointerup',     () => clearTimeout(longPressTimer));
      btn.addEventListener('pointercancel', () => clearTimeout(longPressTimer));
      btn.addEventListener('click', () => {
        clearTimeout(longPressTimer);
        Tooltip.hide();
        const wasSelected = selectedCard?.id === c.id;
        selectedCard = wasSelected ? null : c;
        // Toggle CSS only — no full re-render (avoids img reload)
        if (_selectedBrowserBtn) _selectedBrowserBtn.classList.remove('selected');
        _selectedBrowserBtn = wasSelected ? null : btn;
        if (_selectedBrowserBtn) _selectedBrowserBtn.classList.add('selected');
      });

      grid_el.appendChild(btn);
    }
  }

  function _applyBoardEffect(effect, playerUnits, enemyUnits) {
    applyBoardEffect(effect, { playerUnits, enemyUnits });
  }

  function _refreshAttributePanel() {
    const panel = container.querySelector('#tb-attribute-panel');
    if (!panel) return;
    const sideUnits = board.getLivingUnitsOnSide(placingSide);
    if (sideUnits.length === 0) { panel.innerHTML = ''; return; }
    const attributeList = AttributeDatabase.getAllAttributes();
    const mgr = new AttributeManager(attributeList,
      placingSide === 'player' ? sideUnits : [],
      placingSide === 'enemy'  ? sideUnits : []);
    const synergies = mgr.getActiveSynergies(sideUnits);
    panel.innerHTML = synergies.map(({ attr, count, activeThreshold, nextThreshold }) => {
      const isActive = !!activeThreshold;
      const label = nextThreshold ? `${count}/${nextThreshold.count}` : `${count}`;
      return `<button class="attribute-chip${isActive ? ' attr-active' : ''}" data-attr-id="${attr.id}" title="${attr.name}">`
        + `<span class="attribute-chip-icon">${attr.icon ?? '?'}</span>`
        + `<span class="attribute-chip-count">${label}</span>`
        + `</button>`;
    }).join('');
    panel.querySelectorAll('.attribute-chip').forEach(chip => {
      chip.addEventListener('pointerdown', e => {
        e.stopPropagation();
        const attrId = chip.dataset.attrId;
        const s = synergies.find(x => x.attr.id === attrId);
        if (!s) return;
        Tooltip.toggle(Tooltip.attributeHtml(s.attr, s.count, s.activeThreshold, CardDatabase), chip);
      });
    });
  }

  // ── Combat ────────────────────────────────────────────────────────────────

  let animator = null;

  container.querySelector('#tb-combat').addEventListener('pointerdown', e => {
    e.stopPropagation();
    if (phase === 'prep') startCombat();
    else stopCombat();
  });

  container.querySelector('#tb-clear').addEventListener('click', () => {
    if (phase === 'combat') stopCombat();
    board.grid = board._emptyGrid();
    // Keep blocked cells from selected terrain
    board3D.setBlockedCells(selectedBoard?.blocked_cells || []);
    board3D.refresh();
  });

  function startCombat() {
    const playerUnits = board.getLivingUnitsOnSide('player');
    const enemyUnits  = board.getLivingUnitsOnSide('enemy');
    if (playerUnits.length === 0 || enemyUnits.length === 0) return;

    phase = 'combat';
    container.querySelector('#tb-combat').textContent = '■ Stop';
    container.querySelector('#tb-clear').disabled = true;

    const attributeList = AttributeDatabase.getAllAttributes();
    const attributeManager = new AttributeManager(attributeList, playerUnits, enemyUnits);
    attributeManager.applyStartOfCombat();

    if (selectedBoard?.effect) _applyBoardEffect(selectedBoard.effect, playerUnits, enemyUnits);

    const combat = new CombatManager(board, playerUnits, enemyUnits, attributeManager);

    board3D.enterCombatMode();

    const speedControls = container.querySelector('#tb-speed-controls');
    speedControls.style.display = '';

    speedControls.querySelectorAll('.speed-btn[data-speed]').forEach(btn => {
      btn.addEventListener('click', () => {
        animator?.setSpeed(+btn.dataset.speed);
        speedControls.querySelectorAll('.speed-btn[data-speed]')
          .forEach(b => b.classList.toggle('active', b === btn));
      });
    });

    const btnPause = container.querySelector('#tb-pause');
    let isPaused = false;
    btnPause.onclick = () => {
      isPaused = !isPaused;
      if (isPaused) { animator?.pause(); btnPause.textContent = '▶'; btnPause.classList.add('active'); }
      else          { animator?.resume(); btnPause.textContent = '⏸'; btnPause.classList.remove('active'); }
    };

    animator = new CombatAnimator3D(combat, board3D, {
      onStep: () => inspector && renderInspector([...playerUnits, ...enemyUnits]),
      onFinished: () => {
        const result = document.createElement('div');
        result.style.cssText = 'text-align:center;padding:8px;font-weight:700;color:var(--accent)';
        result.textContent = combat.winner === 'player' ? '🏆 Joueur gagne'
          : combat.winner === 'enemy' ? '💀 Ennemi gagne'
          : combat.winner === 'timeout' ? '⏱ Temps écoulé' : '⚖ Égalité';
        container.querySelector('#tb-inspector').prepend(result);
        setTimeout(() => result.remove(), 3000);
        stopCombat(true);
      },
    });
    animator.start();

    container.querySelector('#tb-inspector').style.display = inspector ? '' : 'none';
  }

  function stopCombat(fromFinish = false) {
    animator?.stop();
    animator = null;
    phase = 'prep';
    container.querySelector('#tb-combat').textContent = '▶ Combat';
    container.querySelector('#tb-clear').disabled = false;
    container.querySelector('#tb-speed-controls').style.display = 'none';

    // Reset combat stat bonuses on survivors
    [...board.getLivingUnitsOnSide('player'), ...board.getLivingUnitsOnSide('enemy')]
      .forEach(u => u.resetCombatStats());

    board3D.exitCombatMode();
    // Restore terrain blocked cells (exitCombatMode rebuilds tile colors but _blockedCells persists)
    board3D.setBlockedCells(selectedBoard?.blocked_cells || []);
  }

  function renderInspector(units) {
    const el = container.querySelector('#tb-inspector');
    el.innerHTML = `<div style="font-size:10px;padding:4px 8px;max-height:120px;overflow-y:auto;border-top:1px solid var(--border)">` +
      units.filter(u => u.isAlive()).map(u =>
        `<div style="color:${u.side==='player'?'#3b9eff':'var(--red)'}">
          ${_esc(u.name)} ♥${u.current_hp}/${u.max_hp} ⚔${u.atk}${u.shield?` 🛡${u.shield}`:''}
        </div>`
      ).join('') +
      `</div>`;
  }

  // ── Inspector toggle ──────────────────────────────────────────────────────

  const btnInspector = document.createElement('button');
  btnInspector.className = 'filter-pill';
  btnInspector.textContent = '🔍 Inspector';
  btnInspector.style.marginLeft = 'auto';
  btnInspector.addEventListener('click', () => {
    inspector = !inspector;
    btnInspector.classList.toggle('active', inspector);
    container.querySelector('#tb-inspector').style.display = inspector ? '' : 'none';
  });
  container.querySelector('#tb-tier-filters').appendChild(btnInspector);

  // ── Back ──────────────────────────────────────────────────────────────────

  container.querySelector('#tb-back').addEventListener('click', () => {
    navigate('main_menu');
  });

  _activeUnmount = () => {
    if (phase === 'combat') stopCombat();
    board3D.destroy();
  };

  // ── Init ──────────────────────────────────────────────────────────────────

  renderBrowser();
}

const _costHint = CardDatabase.costHint;

function _esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function _cap(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
