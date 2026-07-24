import { navigate } from '../../main.js';
import * as DeckRepository from '../../data/DeckRepository.js';
import * as PublicDeckDatabase from '../../data/PublicDeckDatabase.js';
import * as AuthClient from '../../data/AuthClient.js';

// ── Icons ──────────────────────────────────────────────────────────────────
const BACK_SVG = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>`;
const EDIT_SVG = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>`;
const DEL_SVG  = `<svg width="13" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2"/></svg>`;
const DUP_SVG  = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>`;

// ── Constants ──────────────────────────────────────────────────────────────
const TIER_HEX = { 1:'#5ad0a0', 2:'#6fb2dc', 3:'#9d74dc', 4:'#cba85a', 5:'#d86a7e' };
const MAX_PER_TIER = 8;
const MIN_DECK = 20;

const STATS = { level: 24, xp: 3200, xpMax: 5000, rank: 'Diamant II', pdl: 64, wins: 68, games: 142, lb: '#8.4k', gold: 1240, gems: 80 };


// ── Utils ──────────────────────────────────────────────────────────────────
function esc(str) {
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function onTap(el, handler) {
  let sx = 0, sy = 0, moved = false;
  el.addEventListener('pointerdown', e => { sx = e.clientX; sy = e.clientY; moved = false; });
  el.addEventListener('pointermove', e => {
    if (Math.abs(e.clientX - sx) > 10 || Math.abs(e.clientY - sy) > 10) moved = true;
  });
  el.addEventListener('pointerup', e => { if (!moved) handler(e); });
}

function deckDist(deckData) {
  if (!deckData) return { 1:0, 2:0, 3:0, 4:0, 5:0 };
  const d = {};
  for (let t = 1; t <= 5; t++) d[t] = (deckData[String(t)] || []).length;
  return d;
}

function countFromDist(dist) {
  return Object.values(dist).reduce((a, b) => a + b, 0);
}

function duplicateDeck(name) {
  const deck = DeckRepository.loadDeck(name);
  if (!deck) return null;
  const base = name.replace(/ \(copie.*?\)$/, '');
  const newName = DeckRepository.findFreeName(base + ' (copie)');
  DeckRepository.saveDeck(newName, deck);
  const color = DeckRepository.getDeckColor?.(name);
  const tags  = DeckRepository.getDeckTags?.(name);
  if (color) DeckRepository.setDeckColor?.(newName, color);
  if (tags?.length) DeckRepository.setDeckTags?.(newName, tags);
  return newName;
}

function tierChart(dist) {
  const bars = [1,2,3,4,5].map(t => {
    const c = dist[t] || 0;
    const pct = Math.max(c > 0 ? 12 : 4, Math.round(c / MAX_PER_TIER * 100));
    return `<div class="ds2-bar-col">
      <div class="ds2-bar" style="height:${pct}%;background:${TIER_HEX[t]}"></div>
      <span class="ds2-bar-lbl">${c}</span>
    </div>`;
  }).join('');
  return `<div class="ds2-dist">
    <span class="ds2-dist-eyebrow">Répartition par tier</span>
    <div class="ds2-bars">${bars}</div>
  </div>`;
}

function deckCardV2({ name, id, hex, dist, count, tags, isSelected, isActive, editable, selectable, readonly, dataAttr }) {
  const valid = count >= MIN_DECK;
  const allTags = [...(tags || [])];
  const tagsHtml = allTags.map(t =>
    `<span class="ds2-tag"><span style="color:var(--gold-300)">✦</span> ${esc(t)}</span>`
  ).join('');
  const selClass = isSelected ? 'btn-circular-text-bright' : 'btn-circular-text';
  const selLabel = isSelected ? '✓ Sélectionné' : 'Sélectionner';
  const idAttr   = id ? ` data-id="${esc(id)}"` : '';

  let actionsHtml = '';
  if (editable) {
    actionsHtml = `<div class="ds2-actions">
      <button class="btn-circular btn-edit" data-name="${esc(name)}" title="Éditer">${EDIT_SVG}</button>
      <button class="btn-circular btn-dup" data-name="${esc(name)}" title="Dupliquer">${DUP_SVG}</button>
      <button class="btn-circular btn-del" data-name="${esc(name)}" title="Supprimer">${DEL_SVG}</button>
    </div>`;
  } else if (selectable) {
    actionsHtml = `<div class="ds2-actions">
      <button class="${selClass} btn-select" data-name="${esc(name)}"><span class="btn-circular-text-label">${selLabel}</span></button>
    </div>`;
  } else if (readonly) {
    actionsHtml = `<div class="ds2-actions ds2-actions--pub">
      <button class="btn-circular btn-dup-pub" data-name="${esc(name)}"${idAttr} title="Copier dans mes decks">${DUP_SVG}</button>
    </div>`;
  }

  return `<div class="ds2-card${isSelected ? ' selected' : ''}" ${dataAttr}>
    <div class="ds2-accent" style="background:linear-gradient(90deg,transparent,${hex},transparent)"></div>
    <div class="ds2-hdr">
      <span class="ds2-dot" style="background:${hex};box-shadow:0 0 10px -1px ${hex}88"></span>
      <span class="ds2-name">${esc(name)}</span>
      <span class="ds2-count${valid ? ' valid' : ''}">${count} cartes</span>
    </div>
    <div class="ds2-tags">${tagsHtml}</div>
    ${tierChart(dist)}
    ${actionsHtml}
  </div>`;
}

// ── Vieille carte horizontale (step 2 — choix du deck ennemi) ─────────────
function legacyCard(name, isSelected) {
  const dist  = deckDist(DeckRepository.loadDeck(name));
  const count = countFromDist(dist);
  const av    = Math.abs((name || '?').charCodeAt(0)) % 6;
  return `<div class="ds-card${isSelected ? ' selected' : ''}" data-name="${esc(name)}">
    <div class="ds-card-sheen"></div>
    <div class="ds-accent-bar"></div>
    <div class="ds-card-inner">
      <div class="ds-avatar" data-av="${av}">${esc(name[0].toUpperCase())}</div>
      <div class="ds-card-body">
        <div class="ds-card-title"><span class="ds-card-name">${esc(name)}</span></div>
        <div class="ds-card-meta">${count} cartes</div>
      </div>
    </div>
  </div>`;
}

// ── Mount ──────────────────────────────────────────────────────────────────
export async function mount(container, params = {}) {
  const target = params.target || 'game3d';
  const mode   = params.mode   || 'select';
  let selectedPlayer = DeckRepository.getActiveDeck() || null;
  let selectedPublic = null;
  let selectedEnemy  = null;
  let activeTab = 'mine';

  await PublicDeckDatabase.init();

  const s = STATS;
  const settingsIconSvg = `<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 0 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.9.3l-.1-.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 0 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 0 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 0 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>`;
  const logoutIconSvg = `<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>`;

  let user = AuthClient.getUser();

  // ── Builders ─────────────────────────────────────────────────────────────

  function buildMineGrid() {
    const names         = DeckRepository.listDecks();
    const activeDeckName = DeckRepository.getActiveDeck();
    if (names.length === 0) {
      return `<div class="ds-empty">
        <div class="ds-empty-icon">🃏</div>
        <div class="ds-empty-text">Aucun deck sauvegardé</div>
        <div class="ds-empty-sub">Crée un deck pour commencer à jouer.</div>
      </div>`;
    }
    const cards = names.map(name => {
      const dist  = deckDist(DeckRepository.loadDeck(name));
      const count = countFromDist(dist);
      const hex   = DeckRepository.getDeckColor?.(name) || '#9d74dc';
      const tags  = DeckRepository.getDeckTags?.(name) || [];
      return deckCardV2({
        name, hex, dist, count, tags,
        isSelected: name === selectedPlayer,
        isActive:   name === activeDeckName,
        editable:   mode === 'manage',
        selectable: mode === 'select',
        dataAttr: `data-name="${esc(name)}"`,
      });
    }).join('');

    const createTile = `<div class="ds2-create-tile btn-create-tile">
      <div class="ds2-create-plus">+</div>
      <span class="ds2-create-title">Créer un deck</span>
      <span class="ds2-create-sub">Ouvre le deck-builder vierge</span>
    </div>`;

    return cards + createTile;
  }

  function buildPublicGrid() {
    const publicDecks = PublicDeckDatabase.getAllDecks();
    if (publicDecks.length === 0) {
      return `<div class="ds-empty">
        <div class="ds-empty-icon">🌐</div>
        <div class="ds-empty-text">Aucun deck public</div>
        <div class="ds-empty-sub">Les decks publics sont gérés depuis l'admin.</div>
      </div>`;
    }
    return publicDecks.map(d => {
      const dist  = deckDist(d.deck);
      const count = countFromDist(dist);
      const hex   = d.colorHex || '#6fb2dc';
      return deckCardV2({
        name: d.name, id: d.id, hex, dist, count,
        tags: d.tags || [],
        isSelected: selectedPublic?.id === d.id,
        isActive: false,
        readonly: true,
        dataAttr: `data-id="${esc(d.id)}"`,
      });
    }).join('');
  }

  // ── Partial update helpers ─────────────────────────────────────────────

  function updateGrid(gridId, html) {
    const el = container.querySelector(`#${gridId}`);
    if (el) el.innerHTML = html;
  }

  function refreshMineCounters() {
    const n = DeckRepository.listDecks().length;
    const tabMine = container.querySelector('#tab-mine');
    if (tabMine) tabMine.textContent = `Mes decks · ${n}`;
    const meta = container.querySelector('.ds-section-mine .ds-count-meta');
    if (meta) meta.textContent = `${n} deck${n !== 1 ? 's' : ''}`;
  }

  function updatePlayBtn() {
    const btn = container.querySelector('#btn-play');
    if (!btn) return;
    const hasSel = activeTab === 'mine' ? !!selectedPlayer : !!selectedPublic;
    btn.disabled = !hasSel;
  }

  // ── Event binding ──────────────────────────────────────────────────────

  function bindMineEvents() {
    const grid = container.querySelector('#mine-grid');
    if (!grid) return;

    grid.querySelectorAll('.ds2-card').forEach(el => {
      onTap(el, e => {
        if (e.target.closest('.ds2-actions')) return;
        selectedPlayer = el.dataset.name;
        updateGrid('mine-grid', buildMineGrid());
        bindMineEvents();
        updatePlayBtn();
      });
    });

    grid.querySelectorAll('.btn-select').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        selectedPlayer = btn.dataset.name;
        updateGrid('mine-grid', buildMineGrid());
        bindMineEvents();
        updatePlayBtn();
      });
    });

    grid.querySelectorAll('.btn-edit').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        DeckRepository.setPendingEdit(btn.dataset.name);
        navigate('deck_builder');
      });
    });

    grid.querySelectorAll('.btn-dup').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        duplicateDeck(btn.dataset.name);
        updateGrid('mine-grid', buildMineGrid());
        bindMineEvents();
        refreshMineCounters();
      });
    });

    grid.querySelectorAll('.btn-del').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        if (!confirm(`Supprimer le deck "${btn.dataset.name}" ?`)) return;
        if (selectedPlayer === btn.dataset.name) selectedPlayer = null;
        DeckRepository.deleteDeck(btn.dataset.name);
        updateGrid('mine-grid', buildMineGrid());
        bindMineEvents();
        updatePlayBtn();
        refreshMineCounters();
      });
    });

    grid.querySelector('.btn-create-tile')?.addEventListener('click', () => {
      navigate('deck_builder');
    });
  }

  function bindPublicEvents() {
    const publicDecks = PublicDeckDatabase.getAllDecks();
    const grid = container.querySelector('#public-grid');
    if (!grid) return;

    grid.querySelectorAll('.ds2-card').forEach(el => {
      onTap(el, e => {
        if (e.target.closest('.ds2-actions')) return;
        selectedPublic = publicDecks.find(d => d.id === el.dataset.id) || null;
        updateGrid('public-grid', buildPublicGrid());
        bindPublicEvents();
        updatePlayBtn();
      });
    });

    grid.querySelectorAll('.btn-select').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        selectedPublic = publicDecks.find(d => d.id === btn.dataset.id) || null;
        updateGrid('public-grid', buildPublicGrid());
        bindPublicEvents();
        updatePlayBtn();
      });
    });

    grid.querySelectorAll('.btn-dup-pub').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        const deck = publicDecks.find(d => d.name === btn.dataset.name);
        if (!deck) return;
        const newName = DeckRepository.findFreeName(deck.name);
        DeckRepository.saveDeck(newName, deck.deck);
        // Bascule vers l'onglet "Mes decks" et rafraîchit
        activeTab = 'mine';
        container.querySelector('.ds-section-mine')?.classList.add('ds-section--active');
        container.querySelector('.ds-section-public')?.classList.remove('ds-section--active');
        container.querySelector('#tab-mine')?.classList.add('active');
        container.querySelector('#tab-public')?.classList.remove('active');
        const tabMine = container.querySelector('#tab-mine');
        if (tabMine) tabMine.textContent = `Mes decks · ${DeckRepository.listDecks().length}`;
        updateGrid('mine-grid', buildMineGrid());
        bindMineEvents();
        updatePlayBtn();
      });
    });
  }

  // ── Step 1 : choix du deck joueur ─────────────────────────────────────

  function renderStep1() {
    const names       = DeckRepository.listDecks();
    const publicDecks = PublicDeckDatabase.getAllDecks();
    const hasSel      = activeTab === 'mine' ? !!selectedPlayer : !!selectedPublic;

    container.innerHTML = `
      <div class="topbar">
        <button class="topbar-back" id="btn-back">${BACK_SVG}</button>
        <div class="dbv2-hsep"></div>
        <span class="topbar-title"> Choisir un deck</span>
        <div class="mm-desktop-hd-right">
          <div class="mm-currency-group">
            <div class="mm-currency-chip mm-currency-gold">
              <span class="mm-coin"></span>${s.gold.toLocaleString('fr-FR')}
              <button class="mm-currency-add" aria-label="Acheter">+</button>
            </div>
            <div class="mm-currency-chip mm-currency-gem">
              <span class="mm-gem-icon"></span>${s.gems}
              <button class="mm-currency-add mm-currency-add-gem" aria-label="Acheter">+</button>
            </div>
          </div>
          <div class="mm-hd-sep"></div>
          <button class="mm-icon-btn" data-action="settings" title="Réglages">${settingsIconSvg}</button>
          <button class="mm-icon-btn mm-logout-btn" data-action="logout" title="Se déconnecter">${logoutIconSvg}</button>
          <button class="mm-profile-btn" data-action="profile">
            <div class="mm-avatar-circle">${avatarContent(user.avatar)}</div>
            <div>
              <div class="mm-hd-name">${esc(user.username)}</div>
              <div class="mm-hd-rank"><span class="mm-rank-gem"></span>${esc(s.rank)} · ${s.pdl} PdL</div>
            </div>
          </button>
        </div>
      </div>

      <!-- ── Mobile top bar ── -->
      <div class="topbar-mobile">
        <button class="topbar-back" id="btn-back-m">${BACK_SVG}</button>
        <div class="dbv2-hsep"></div>
        <span class="topbar-title">Choisir un deck</span>
        <div class="mm-topbar-right">
          <button class="mm-icon-btn" data-action="settings" aria-label="Réglages">${settingsIconSvg}</button>
          <button class="mm-profile-btn" data-action="profile">
            <div class="mm-avatar-circle">${avatarContent(user.avatar)}</div>
          </button>
        </div>
      </div>
      <div class="ds-tabs ds-tabs-mobile">
        <button class="ds-tab${activeTab === 'mine'   ? ' active' : ''}" id="tab-mine">Mes decks · ${names.length}</button>
        <button class="ds-tab${activeTab === 'public' ? ' active' : ''}" id="tab-public">Publics</button>
      </div>

      <div class="ds-body">
        <section class="ds-section ds-section-mine${activeTab === 'mine' ? ' ds-section--active' : ''}">
          <div class="ds-section-hdr">
            <span class="ds-eyebrow-lbl">Mes decks</span>
            <span class="ds-count-meta">${names.length} deck${names.length !== 1 ? 's' : ''}</span>
            <div class="ds-hdr-line"></div>
          </div>
          <div class="ds2-grid" id="mine-grid">${buildMineGrid()}</div>
        </section>

        <section class="ds-section ds-section-public${activeTab === 'public' ? ' ds-section--active' : ''}">
          <div class="ds-section-hdr">
            <span class="ds-eyebrow-lbl">Decks publics</span>
            <span class="ds-count-meta">lecture seule · communauté</span>
            <div class="ds-hdr-line"></div>
          </div>
          <div class="ds2-grid" id="public-grid">${buildPublicGrid()}</div>
        </section>
      </div>

      ${mode !== 'manage' ? `<div class="ds-footer">
        <button class="dbv2-btnprimary btn-play" id="btn-play" ${hasSel ? '' : 'disabled'}>
          <span class="dbv2-btn-halo" aria-hidden="true"></span>
          <span class="dbv2-btn-sheen" aria-hidden="true"></span>
          <span id="dbv2-save-label">⚔ JOUER AVEC CE DECK</span>
        </button>
      </div>` : ''}
    `;

    bindMineEvents();
    bindPublicEvents();

    container.querySelector('#btn-back').addEventListener('click', () => navigate('main_menu'));
    container.querySelector('#btn-back-m')?.addEventListener('click', () => navigate('main_menu'));

    container.querySelector('#tab-mine').addEventListener('click', () => {
      if (activeTab === 'mine') return;
      activeTab = 'mine';
      container.querySelector('.ds-section-mine')?.classList.add('ds-section--active');
      container.querySelector('.ds-section-public')?.classList.remove('ds-section--active');
      container.querySelector('#tab-mine')?.classList.add('active');
      container.querySelector('#tab-public')?.classList.remove('active');
      updatePlayBtn();
    });

    container.querySelector('#tab-public').addEventListener('click', () => {
      if (activeTab === 'public') return;
      activeTab = 'public';
      container.querySelector('.ds-section-public')?.classList.add('ds-section--active');
      container.querySelector('.ds-section-mine')?.classList.remove('ds-section--active');
      container.querySelector('#tab-public')?.classList.add('active');
      container.querySelector('#tab-mine')?.classList.remove('active');
      updatePlayBtn();
    });

    container.querySelector('#btn-play')?.addEventListener('click', () => {
      if (activeTab === 'mine') {
        if (!selectedPlayer) return;
        DeckRepository.setActiveDeck(selectedPlayer);
      } else {
        if (!selectedPublic) return;
        DeckRepository.saveDeck(selectedPublic.name, selectedPublic.deck);
        DeckRepository.setActiveDeck(selectedPublic.name);
        selectedPlayer = selectedPublic.name;
      }
      if (target === 'online_lobby') {
        navigate(target, { deckName: selectedPlayer });
        return;
      }
      renderStep2();
    });
  }

  // ── Step 2 : choix du deck ennemi ─────────────────────────────────────

  function renderStep2() {
    const names = DeckRepository.listDecks();

    function buildEnemyGrid() {
      const randSel      = selectedEnemy === '__random__';
      const randSelClass = randSel ? 'btn-circular-text-bright' : 'btn-circular-text';
      const randSelLabel = randSel ? '✓ Sélectionné' : 'Sélectionner';
      const randomCard = `<div class="ds2-card${randSel ? ' selected' : ''}" data-name="__random__">
        <div class="ds2-accent" style="background:linear-gradient(90deg,transparent,#9d74dc,transparent)"></div>
        <div class="ds2-hdr">
          <span class="ds2-dot" style="background:#9d74dc;box-shadow:0 0 10px -1px #9d74dc88"></span>
          <span class="ds2-name">Aléatoire</span>
          <span class="ds2-count">Surprise</span>
        </div>
        <div class="ds2-actions">
          <button class="${randSelClass} btn-select" data-name="__random__">
            <span class="btn-circular-text-label">${randSelLabel}</span>
          </button>
        </div>
      </div>`;

      const deckCards = names.map(name => {
        const dist  = deckDist(DeckRepository.loadDeck(name));
        const count = countFromDist(dist);
        const hex   = DeckRepository.getDeckColor?.(name) || '#9d74dc';
        const tags  = DeckRepository.getDeckTags?.(name) || [];
        return deckCardV2({
          name, hex, dist, count, tags,
          isSelected: name === selectedEnemy,
          isActive: false,
          selectable: true,
          dataAttr: `data-name="${esc(name)}"`,
        });
      }).join('');

      return randomCard + deckCards;
    }

    container.innerHTML = `
      <div class="topbar">
        <button class="topbar-back" id="btn-back">${BACK_SVG}</button>
        <div class="dbv2-hsep"></div>
        <span class="topbar-title">Deck ennemi</span>
        <div class="mm-desktop-hd-right">
          <div class="mm-currency-group">
            <div class="mm-currency-chip mm-currency-gold">
              <span class="mm-coin"></span>${s.gold.toLocaleString('fr-FR')}
              <button class="mm-currency-add" aria-label="Acheter">+</button>
            </div>
            <div class="mm-currency-chip mm-currency-gem">
              <span class="mm-gem-icon"></span>${s.gems}
              <button class="mm-currency-add mm-currency-add-gem" aria-label="Acheter">+</button>
            </div>
          </div>
          <div class="mm-hd-sep"></div>
          <button class="mm-icon-btn" data-action="settings" title="Réglages">${settingsIconSvg}</button>
          <button class="mm-icon-btn mm-logout-btn" data-action="logout" title="Se déconnecter">${logoutIconSvg}</button>
          <button class="mm-profile-btn" data-action="profile">
            <div class="mm-avatar-circle">${avatarContent(user.avatar)}</div>
            <div>
              <div class="mm-hd-name">${esc(user.username)}</div>
              <div class="mm-hd-rank"><span class="mm-rank-gem"></span>${esc(s.rank)} · ${s.pdl} PdL</div>
            </div>
          </button>
        </div>
      </div>

      <div class="topbar-mobile">
        <button class="topbar-back" id="btn-back-m">${BACK_SVG}</button>
        <div class="dbv2-hsep"></div>
        <span class="topbar-title">Deck ennemi</span>
        <div class="mm-topbar-right">
          <button class="mm-icon-btn" data-action="settings" aria-label="Réglages">${settingsIconSvg}</button>
          <button class="mm-profile-btn" data-action="profile">
            <div class="mm-avatar-circle">${avatarContent(user.avatar)}</div>
          </button>
        </div>
      </div>

      <div class="ds-body">
        <section class="ds-section ds-section-mine ds-section--active">
          <div class="ds-section-hdr">
            <span class="ds-eyebrow-lbl">Choisir le deck ennemi</span>
            <span class="ds-count-meta">${names.length + 1} options</span>
            <div class="ds-hdr-line"></div>
          </div>
          <div class="ds2-grid" id="enemy-grid">${buildEnemyGrid()}</div>
        </section>
      </div>

      <div class="ds-footer">
        <button class="dbv2-btnprimary btn-play" id="btn-confirm" ${selectedEnemy ? '' : 'disabled'}>
          <span class="dbv2-btn-halo" aria-hidden="true"></span>
          <span class="dbv2-btn-sheen" aria-hidden="true"></span>
          <span>⚔ CONFIRMER</span>
        </button>
      </div>
    `;

    function bindEnemyEvents() {
      const grid = container.querySelector('#enemy-grid');
      if (!grid) return;

      grid.querySelectorAll('.ds2-card').forEach(el => {
        onTap(el, e => {
          if (e.target.closest('.ds2-actions')) return;
          selectedEnemy = el.dataset.name;
          grid.innerHTML = buildEnemyGrid();
          bindEnemyEvents();
          const btn = container.querySelector('#btn-confirm');
          if (btn) btn.disabled = false;
        });
      });

      grid.querySelectorAll('.btn-select').forEach(btn => {
        btn.addEventListener('click', e => {
          e.stopPropagation();
          selectedEnemy = btn.dataset.name;
          grid.innerHTML = buildEnemyGrid();
          bindEnemyEvents();
          const confirmBtn = container.querySelector('#btn-confirm');
          if (confirmBtn) confirmBtn.disabled = false;
        });
      });
    }

    container.querySelector('#btn-back').addEventListener('click', renderStep1);
    container.querySelector('#btn-back-m')?.addEventListener('click', renderStep1);

    container.querySelector('#btn-confirm').addEventListener('click', () => {
      if (!selectedEnemy) return;
      const enemyDeckName = selectedEnemy === '__random__'
        ? names[Math.floor(Math.random() * names.length)]
        : selectedEnemy;
      navigate(target, { deckName: selectedPlayer, enemyDeckName });
    });

    bindEnemyEvents();
  }

  renderStep1();
}

function avatarContent(avatar, cls = 'mm-avatar-img') {
  if (!avatar) return '';
  if (/^(https?:|data:)/i.test(avatar)) return `<img class="${cls}" src="${esc(avatar)}" alt="">`;
  return `<span class="mm-avatar-text">${esc(avatar)}</span>`;
}

async function _logout() {
  try { await DeckRepository.flushSync(); } catch {}
  try { await AuthClient.logout(); } catch {}
  DeckRepository.handleLogout();
  navigate('auth');
}