import * as Tooltip from './Tooltip.js';

const TIER_COLORS = {
  1: { edge:'#5ad0a0', ink:'#93ecc6', deep:'#06110d', glow:'rgba(90,208,160,.5)',   art:'linear-gradient(160deg,#123528,#06110d)' },
  2: { edge:'#6fb2dc', ink:'#a9d6f2', deep:'#060f18', glow:'rgba(111,178,220,.5)',  art:'linear-gradient(160deg,#122a3f,#060f18)' },
  3: { edge:'#9d74dc', ink:'#d6bdf6', deep:'#0c0820', glow:'rgba(157,116,220,.55)', art:'linear-gradient(160deg,#241442,#0c0820)' },
  4: { edge:'#cba85a', ink:'#ecd7a2', deep:'#140f06', glow:'rgba(203,168,90,.55)',  art:'linear-gradient(160deg,#3a2c12,#140f06)' },
  5: { edge:'#d86a7e', ink:'#f5b3bf', deep:'#140609', glow:'rgba(216,106,126,.52)', art:'linear-gradient(160deg,#3a1420,#140609)' },
};

function _lockSvg() {
  return `<svg width="58%" height="58%" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,.52)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>`;
}

function _redrawSvg() {
  return `<svg width="55%" height="55%" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,.45)" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 4v6h6"/><path d="M3.51 15a9 9 0 1 0 .49-4.5L1 10"/></svg>`;
}

function _summonSvg(type, ink) {
  const a = `width="55%" height="55%" viewBox="0 0 24 24" fill="none" stroke="${ink}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"`;
  if (type === 'sacrifice')
    return `<svg ${a}><path d="M12 3c1.6 3 3.6 4.3 3.6 7.6a3.6 3.6 0 0 1-7.2 0c0-1.7.9-2.9 1.7-3.7.2 1.5 1.1 2.1 2 2.3C12.7 8.2 11.4 5.7 12 3z"/></svg>`;
  if (type === 'fusion')
    return `<svg ${a}><circle cx="9.5" cy="12" r="5"/><circle cx="14.5" cy="12" r="5"/></svg>`;
  if (type === 'heritage')
    return `<svg ${a}><path d="M5 18h14"/><path d="M5 18V8.5l3.4 3 3.6-6 3.6 6 3.4-3V18"/></svg>`;
  if (type === 'transformation')
    return `<svg ${a}><path d="M20 12a8 8 0 1 1-2.4-5.7"/><path d="M20 4v4h-4"/></svg>`;
  return '';
}

export class HandUI {
  constructor(container, { onSelect, powerDb = null, attributeDb = null, cardDb = null, isPlayable = null } = {}) {
    this._container = container;
    this._onSelect = onSelect;
    this._powerDb = powerDb;
    this._attributeDb = attributeDb;
    this._cardDb = cardDb;
    this._isPlayable = isPlayable;
    this._hand = [];
    this._selectedIdx = null;
    this._selectedEl  = null; // direct element reference — immune to DOM index shifts after removals
    this._grouped = true; // when true, duplicate card_id entries render as a single card with a ×N badge
    this._sortedByTier = true; // when true, cards are displayed ordered by tier ascending
  }

  setHand(cards) {
    this._hand = cards;
    this._selectedIdx = null;
    this._selectedEl  = null;
    this._render();
  }

  isGrouped() { return this._grouped; }

  setGrouped(grouped) {
    if (this._grouped === grouped) return;
    this._grouped = grouped;
    this._selectedIdx = null;
    this._selectedEl  = null;
    this._onSelect?.(null);
    this._render();
  }

  isSortedByTier() { return this._sortedByTier; }

  setSortedByTier(sorted) {
    if (this._sortedByTier === sorted) return;
    this._sortedByTier = sorted;
    this._selectedIdx = null;
    this._selectedEl  = null;
    this._onSelect?.(null);
    this._render();
  }

  getSelected() {
    return this._selectedIdx !== null ? this._hand[this._selectedIdx] : null;
  }

  getSelectedIdx() { return this._selectedIdx; }

  // Remove the currently selected card from hand (after placement).
  // The external `hand` array is already spliced by InvocationManager before this is called.
  removeSelected() {
    if (this._selectedIdx === null) return;
    if (this._selectedEl) {
      if (this._grouped && !this._selectedEl._repCard?._no_group) {
        // The consumed card object is already gone from this._hand (spliced by the caller) —
        // only its id survives on the button. If duplicates remain, shrink the ×N badge and
        // repoint the button at a surviving duplicate instead of removing it.
        const cardId = this._selectedEl._repCard?.id;
        const remaining = this._hand.filter(c => c.id === cardId && !c._no_group);
        if (remaining.length > 0) {
          this._selectedEl._repCard = remaining[0];
          const countEl = this._selectedEl.querySelector('.hand-card-count');
          if (remaining.length > 1) {
            if (countEl) countEl.textContent = `×${remaining.length}`;
            else this._selectedEl.insertAdjacentHTML('beforeend', `<span class="hand-card-count">×${remaining.length}</span>`);
          } else {
            countEl?.remove();
            // Downgrade: remove stacked visual when only 1 copy remains
            this._selectedEl.classList.remove('hand-card--grouped');
            const wrap = this._selectedEl.closest('.hand-card-stack-wrap');
            if (wrap) wrap.replaceWith(this._selectedEl);
          }
        } else {
          (this._selectedEl.closest('.hand-card-stack-wrap') ?? this._selectedEl).remove();
        }
      } else {
        // Remove by stored element reference — DOM indices shift after each removal so
        // elems[this._selectedIdx] would point to the wrong element on 2nd+ plays.
        (this._selectedEl.closest('.hand-card-stack-wrap') ?? this._selectedEl).remove();
      }
    }
    this._selectedIdx = null;
    this._selectedEl  = null;
    this._onSelect?.(null);
    // Refresh only dim/selected classes — no img rebuild
    this._updateSelection();
  }

  deselect() {
    this._selectedIdx = null;
    this._selectedEl  = null;
    this._updateSelection();
    this._onSelect?.(null);
  }

  _updateSelection() {
    const selectedCard = this._selectedIdx !== null ? this._hand[this._selectedIdx] : null;
    this._container.querySelectorAll('.hand-card').forEach(el => {
      el.classList.toggle('selected', el._repCard === selectedCard);
      if (this._isPlayable) {
        const playable = this._isPlayable(el._repCard);
        const wasDim = el.classList.contains('dim');
        el.classList.toggle('dim', !playable);
        if (wasDim !== !playable) _syncPlayabilityEl(el, playable, el._repCard);
      }
    });
  }

  _render() {
    this._container.innerHTML = '';
    if (this._hand.length === 0) {
      this._container.innerHTML = '<p class="hand-empty">Main vide</p>';
      return;
    }

    let groups = this._grouped ? _groupByCardId(this._hand) : this._hand.map(card => [card]);
    if (this._sortedByTier) groups = [...groups].sort((a, b) => a[0].tier - b[0].tier);

    groups.forEach(group => {
      const card = group[0];
      const el = document.createElement('button');
      const playable = this._isPlayable ? this._isPlayable(card) : true;
      const isGrouped = group.length > 1;
      el.className = 'hand-card'
        + (isGrouped ? ' hand-card--grouped' : '')
        + (this._selectedIdx !== null && this._hand[this._selectedIdx] === card ? ' selected' : '')
        + (!playable ? ' dim' : '');
      el._repCard = card; // representative card object — resolved dynamically on click/removal

      const T = TIER_COLORS[card.tier] || TIER_COLORS[2];
      const varHost = isGrouped ? (() => {
        const wrap = document.createElement('div');
        wrap.className = 'hand-card-stack-wrap';
        return wrap;
      })() : el;
      varHost.style.setProperty('--hc-edge', T.edge);
      varHost.style.setProperty('--hc-ink',  T.ink);
      varHost.style.setProperty('--hc-deep', T.deep);
      varHost.style.setProperty('--hc-glow', T.glow);
      varHost.style.setProperty('--hc-art',  T.art);

      const summon = card.summon_type ?? 'normal';
      const isMulti = Array.isArray(card.summon_options) && card.summon_options.length > 0;
      const hasIcon = summon !== 'normal' || isMulti;

      el.innerHTML = `
        <div class="hand-card-frame-border"></div>
        <div class="hand-card-frame-glow"></div>
        <div class="hand-card-art">
          <img class="hand-card-img" src="/illustrations/${card.id}" alt="${esc(card.name)}" loading="lazy">
          ${!playable ? '<div class="hand-card-dim-overlay"></div>' : `
            <div class="hand-card-stardust"></div>
            <div class="hand-card-nebula"></div>
          `}
          <div class="hand-card-top-edge"></div>
          <div class="hand-card-footer"><span class="hand-card-name">${esc(card.name)}</span></div>
          ${!playable
            ? `<div class="hand-card-summon-icons"><div class="hand-card-summon-icon">${_redrawSvg()}</div><div class="hand-card-lock">${_lockSvg()}</div></div>`
            : (hasIcon
              ? `<div class="hand-card-summon-icons">${isMulti
                ? card.summon_options.map(o => `<div class="hand-card-summon-icon">${_summonSvg(o.summon_type, T.ink)}</div>`).join('')
                : `<div class="hand-card-summon-icon">${_summonSvg(summon, T.ink)}</div>`
              }</div>`
              : '')
          }
          ${isGrouped ? `<span class="hand-card-count">×${group.length}</span>` : ''}
        </div>
      `;

      let longPressTimer;
      el.addEventListener('pointerdown', e => {
        e.stopPropagation();
        Tooltip.hide();
        const currentCard = el._repCard;
        const rect = el.getBoundingClientRect();
        longPressTimer = setTimeout(() => {
          Tooltip.showAtRect(Tooltip.cardHtml(currentCard, this._powerDb, this._attributeDb, this._cardDb), rect);
        }, 500);
        // Resolve the real index in `this._hand` from the (possibly updated) representative
        // card object — robust to DOM/array desync after partial group consumption.
        const realIdx = this._hand.indexOf(currentCard);
        if (this._selectedIdx === realIdx) {
          this._selectedIdx = null;
          this._selectedEl  = null;
          this._onSelect?.(null);
        } else {
          this._selectedIdx = realIdx;
          this._selectedEl  = el;
          this._onSelect?.(currentCard);
        }
        // Update classes only — do NOT call _render() which would detach el
        // and prevent pointerup from clearing longPressTimer on the right element
        this._updateSelection();
      });
      el.addEventListener('pointerup',     () => clearTimeout(longPressTimer));
      el.addEventListener('pointercancel', () => clearTimeout(longPressTimer));

      if (isGrouped) {
        varHost.appendChild(el);
        this._container.appendChild(varHost);
      } else {
        this._container.appendChild(el);
      }
    });
  }
}

// Surgically updates lock/overlay/stardust/nebula/summon-icon when a card's playability changes mid-turn.
function _syncPlayabilityEl(el, playable, card) {
  const T = TIER_COLORS[card.tier] || TIER_COLORS[2];
  const summon = card.summon_type ?? 'normal';
  const isMulti = Array.isArray(card.summon_options) && card.summon_options.length > 0;
  const hasIcon = summon !== 'normal' || isMulti;

  const art = el.querySelector('.hand-card-art');
  if (!art) return;

  const overlay  = art.querySelector('.hand-card-dim-overlay');
  const stardust = art.querySelector('.hand-card-stardust');
  const nebula   = art.querySelector('.hand-card-nebula');
  if (playable) {
    overlay?.remove();
    if (!stardust) {
      const img = art.querySelector('.hand-card-img');
      const after = img ?? art.firstChild;
      art.insertAdjacentHTML('afterbegin', '<div class="hand-card-stardust"></div><div class="hand-card-nebula"></div>');
    }
  } else {
    stardust?.remove();
    nebula?.remove();
    if (!overlay) {
      const img = art.querySelector('.hand-card-img');
      if (img) img.insertAdjacentHTML('afterend', '<div class="hand-card-dim-overlay"></div>');
      else art.insertAdjacentHTML('afterbegin', '<div class="hand-card-dim-overlay"></div>');
    }
  }

  const lock = art.querySelector('.hand-card-lock');
  if (playable) {
    lock?.remove();
  } else if (!lock) {
    art.insertAdjacentHTML('beforeend', `<div class="hand-card-lock">${_lockSvg()}</div>`);
  }

  let icon = art.querySelector('.hand-card-summon-icon');
  if (playable) {
    if (hasIcon) {
      const html = isMulti ? card.summon_options.map(o => _summonSvg(o.summon_type, T.ink)).join('') : _summonSvg(summon, T.ink);
      if (!icon) art.insertAdjacentHTML('beforeend', `<div class="hand-card-summon-icon">${html}</div>`);
      else icon.innerHTML = html;
    } else {
      icon?.remove();
    }
  } else {
    if (!icon) art.insertAdjacentHTML('beforeend', `<div class="hand-card-summon-icon">${_redrawSvg()}</div>`);
    else icon.innerHTML = _redrawSvg();
  }
}

// Groups hand cards by card_id, preserving first-occurrence order.
// Cards flagged `_no_group` (e.g. instance-specific bonus from a magie effect such as
// "Bourse des âmes" / "Ristourne" reducing this exact card's sacrifice cost) are never
// merged into a group — grouping them would hide the bonus and let the wrong instance be played.
function _groupByCardId(hand) {
  const groups = [];
  const byId = new Map();
  for (const card of hand) {
    if (card._no_group) { groups.push([card]); continue; }
    const group = byId.get(card.id);
    if (group) group.push(card);
    else { const g = [card]; byId.set(card.id, g); groups.push(g); }
  }
  return groups;
}

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
