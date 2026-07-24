import { navigate } from '../../main.js';
import * as CardDatabase from '../../data/CardDatabase.js';
import * as DeckRepository from '../../data/DeckRepository.js';
import * as PowerDatabase from '../../data/PowerDatabase.js';
import * as AttributeDatabase from '../../data/AttributeDatabase.js';
import * as Tooltip from '../components/Tooltip.js';
import * as AuthClient from '../../data/AuthClient.js';

const DECK_MIN = 20;

const TIER_HEX  = { 1:'#5ad0a0', 2:'#6fb2dc', 3:'#9d74dc', 4:'#cba85a', 5:'#d86a7e' };
const TIER_LINE = {
  1:'rgba(90,208,160,.3)',  2:'rgba(111,178,220,.3)', 3:'rgba(157,116,220,.3)',
  4:'rgba(203,168,90,.3)',  5:'rgba(216,106,126,.3)',
};
const TIER_COLORS = {
  1:{ edge:'#5ad0a0', ink:'#93ecc6', deep:'#06110d', glow:'rgba(90,208,160,.5)',   art:'linear-gradient(160deg,#123528,#06110d)' },
  2:{ edge:'#6fb2dc', ink:'#a9d6f2', deep:'#060f18', glow:'rgba(111,178,220,.5)',  art:'linear-gradient(160deg,#122a3f,#060f18)' },
  3:{ edge:'#9d74dc', ink:'#d6bdf6', deep:'#0c0820', glow:'rgba(157,116,220,.55)', art:'linear-gradient(160deg,#241442,#0c0820)' },
  4:{ edge:'#cba85a', ink:'#ecd7a2', deep:'#140f06', glow:'rgba(203,168,90,.55)',  art:'linear-gradient(160deg,#3a2c12,#140f06)' },
  5:{ edge:'#d86a7e', ink:'#f5b3bf', deep:'#140609', glow:'rgba(216,106,126,.52)', art:'linear-gradient(160deg,#3a1420,#140609)' },
};
const SUMMON_LABELS  = { normal:'Normale', sacrifice:'Sacrifice', fusion:'Fusion', heritage:'Héritage', transformation:'Transfo.' };
const DECK_COLORS    = [
  '#d8564e','#e4c65a','#7cd88a','#2f7d4f','#6fc0e6','#2f5bd8',
  '#e08a3a','#9d74dc','#e58ab8','#d8c9a8','#8a5a34','#8f9aae','#14141c','#f2f0e8',
];

const STATS = { level: 24, xp: 3200, xpMax: 5000, rank: 'Diamant II', pdl: 64, wins: 68, games: 142, lb: '#8.4k', gold: 1240, gems: 80 };
const BACK_SVG = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>`;


export async function mount(container, params = {}) {
  await Promise.all([CardDatabase.init(), PowerDatabase.init(), AttributeDatabase.init()]);

  const publicDeckId = params.publicDeckId || null;
  let   publicDeck   = null;
  const pendingName  = publicDeckId ? null : DeckRepository.consumePendingEdit();
  const editName     = params.deckName || pendingName || null;

  let deckName  = editName || '';
  let deckColor = DeckRepository.getDeckColor?.(editName || '') ?? null; // hex or null
  const deckMin = publicDeckId ? 0 : DECK_MIN;

  let tierFilters   = [];  // [] = all tiers
  let summonFilters = [];  // [] = all types
  let searchQuery   = '';

  const deckData = { 1:[], 2:[], 3:[], 4:[], 5:[] };
  const s = STATS;
  const settingsIconSvg = `<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 0 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.9.3l-.1-.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 0 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 0 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 0 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>`;
  const logoutIconSvg = `<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>`;

  let user = AuthClient.getUser();

  if (publicDeckId) {
    const decks = await fetch('/api/decks').then(r => r.json()).catch(() => []);
    publicDeck  = Array.isArray(decks) && decks.find(d => d.id === publicDeckId);
    if (publicDeck) {
      deckName = publicDeck.name || '';
      for (let t = 1; t <= 5; t++)
        deckData[t] = (publicDeck.deck?.[String(t)] ?? []).map(id => CardDatabase.getCard(id)).filter(Boolean);
    }
  } else if (editName) {
    const saved = DeckRepository.loadDeck(editName);
    if (saved)
      for (let t = 1; t <= 5; t++)
        deckData[t] = (saved[String(t)] ?? []).map(id => CardDatabase.getCard(id)).filter(Boolean);
  }

  const tierMax = {};
  for (let t = 1; t <= 5; t++) tierMax[t] = Math.min(8, CardDatabase.getCardsByTier(t).length);

  // ── Shell ─────────────────────────────────────────────────────────────────
  container.innerHTML = `
<div class="dbv2-wrap">
  <!-- ── Mobile top bar ── -->
  <div class="dbv2-topbar">
    <div class="mm-topbar-left">
      <button class="dbv2-back" id="dbv2-back">
        ${BACK_SVG}
      </button>
      <div class="dbv2-hsep"></div>
      <span class="dbv2-htitle">Deck-building</span>
    </div>
    <div class="mm-topbar-right">
      <button class="mm-icon-btn" data-action="settings" aria-label="Réglages">${settingsIconSvg}</button>
      <button class="mm-profile-btn" data-action="profile">
        <div class="mm-avatar-circle">${avatarContent(user.avatar)}</div>
      </button>
    </div>
  </div>


  <div class="dbv2-header">
    <div class="dbv2-header-left">
      <button class="dbv2-back" id="dbv2-back">
        ${BACK_SVG}
      </button>
      <div class="dbv2-hsep"></div>
      <span class="dbv2-htitle">Deck-building</span>
    </div>
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

  <div class="dbv2-body" data-tab="lib">

    <div class="dbv2-tabs" id="dbv2-tabs">
      <button class="ds-tab active" data-tab="lib">Bibliothèque</button>
      <button class="ds-tab" data-tab="deck">Deck · <span id="dbv2-tc">0</span></button>
    </div>

    <div class="dbv2-left">
      <div class="dbv2-filters">
        <div class="dbv2-fgold"></div>
        <div class="dbv2-fhead">
          <span class="dbv2-fengraved">Bibliothèque</span>
          <span class="dbv2-fcount" id="dbv2-fcount"></span>
        </div>
        <div class="dbv2-search-wrap">
          <svg class="dbv2-search-ico" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          <input type="search" class="dbv2-searchinput" id="dbv2-search" placeholder="Rechercher une carte…">
        </div>
        <div class="dbv2-frow" id="dbv2-tier-chips">
          <span class="dbv2-flabel">Tier</span>
          ${[1,2,3,4,5].map(t => `<button class="dbv2-chip dbv2-chip-tier" data-tier="${t}">${_tierIcoHtml(t)}</button>`).join('')}
        </div>
        <div class="dbv2-frow" id="dbv2-summon-chips">
          <span class="dbv2-flabel">Invocation</span>
          ${Object.entries(SUMMON_LABELS).map(([k,v]) => `<button class="dbv2-chip" data-summon="${k}">${_chipSummonSvg(k)}<span class="dbv2-chip-label">${v}</span></button>`).join('')}
        </div>
      </div>
      <div class="dbv2-libscroll">
        <div class="dbv2-libgrid" id="dbv2-lib"></div>
      </div>
      <div class="dbv2-sumbar" id="dbv2-sumbar">
        <span class="dbv2-sumbar-dot" id="dbv2-sumbar-dot"></span>
        <div class="dbv2-sumbar-txt">
          <div class="dbv2-sumbar-name" id="dbv2-sumbar-name"></div>
          <div class="dbv2-sumbar-status" id="dbv2-sumbar-status"></div>
        </div>
        <span class="dbv2-sumbar-total" id="dbv2-sumbar-total"></span>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--gold-200)" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 6 15 12 9 18"/></svg>
      </div>
    </div>

    <div class="dbv2-right">
      <div class="dbv2-dkaccent" id="dbv2-dkaccent"></div>
      <div class="dbv2-dkmeta">
        <div class="dbv2-namerow">
          <span class="dbv2-colordot" id="dbv2-colordot"></span>
          <input class="dbv2-nameinput" id="dbv2-name" type="text" placeholder="Nom du deck" value="${esc(deckName)}" maxlength="32">
        </div>
        <div>
          <div class="dbv2-eyebrow">Couleur du deck</div>
          <div class="dbv2-swatches" id="dbv2-swatches">
            ${DECK_COLORS.map(c => `<button class="dbv2-swatch" data-color="${c}" style="background:${c}"></button>`).join('')}
          </div>
        </div>
        <div>
          <div class="dbv2-eyebrow">Synergies actives · calculées</div>
          <div class="dbv2-tags" id="dbv2-tags"></div>
        </div>
      </div>
      <div class="dbv2-counter">
        <div class="dbv2-cntrow">
          <span class="dbv2-cntlabel">Cartes du deck</span>
          <span class="dbv2-cnttotal" id="dbv2-cnttotal"></span>
        </div>
        <div class="dbv2-progress"><div class="dbv2-pfill" id="dbv2-pfill"></div></div>
        <div class="dbv2-cstatus" id="dbv2-cstatus"></div>
      </div>
      <div class="dbv2-lanes" id="dbv2-lanes"></div>
      <div class="dbv2-footer">
        <button class="dbv2-btnghost" id="dbv2-clear">Vider</button>
        <button class="dbv2-btnprimary" id="dbv2-save">
          <span class="dbv2-btn-halo" aria-hidden="true"></span>
          <span class="dbv2-btn-sheen" aria-hidden="true"></span>
          <span id="dbv2-save-label">▸ Enregistrer le deck</span>
        </button>
      </div>
    </div>

  </div>
</div>`;

  const nameInput = container.querySelector('#dbv2-name');
  const btnSave   = container.querySelector('#dbv2-save');
  const btnClear  = container.querySelector('#dbv2-clear');
  const libEl     = container.querySelector('#dbv2-lib');
  const lanesEl   = container.querySelector('#dbv2-lanes');
  const bodyEl    = container.querySelector('.dbv2-body');

  // ── Helpers ───────────────────────────────────────────────────────────────
  function hex2rgb(h) {
    return `${parseInt(h.slice(1,3),16)},${parseInt(h.slice(3,5),16)},${parseInt(h.slice(5,7),16)}`;
  }

  function computeTags() {
    const all = [1,2,3,4,5].flatMap(t => deckData[t]);
    const n   = all.length;
    const attrCounts = {};
    for (const card of all)
      for (const id of (card.attributes ?? []))
        attrCounts[id] = (attrCounts[id] || 0) + 1;
    const dominant = Object.entries(attrCounts)
      .filter(([,c]) => c >= 2).sort((a,b) => b[1]-a[1]).slice(0,2)
      .map(([id]) => AttributeDatabase.getAttribute(id)?.name ?? id);
    const tags = [...dominant];
    if (n > 0) {
      const meleeR = all.filter(c => (c.stats?.range ?? 1) === 1).length / n;
      if (meleeR >= .65) tags.push('Mêlée');
      else if (meleeR <= .35) tags.push('Distance');
      else {
        const avg = all.reduce((s,c) => s + (c.stats?.atk ?? 0), 0) / n;
        if (all.filter(c => (c.stats?.atk ?? 0) > 28).length >= 2) tags.push('Brutal');
        else if (avg > 22) tags.push('Offensif');
        else if (all.filter(c => (c.stats?.movement_speed ?? 0) >= 15).length / n >= .3) tags.push('Mobile');
      }
    }
    return tags.slice(0, 3);
  }

  // ── Render: Deck panel ────────────────────────────────────────────────────
  function renderDeck() {
    const hex = deckColor ?? '#9d74dc';

    container.querySelector('#dbv2-dkaccent').style.background =
      `linear-gradient(90deg,transparent,${hex},transparent)`;

    const dot = container.querySelector('#dbv2-colordot');
    dot.style.background = hex;
    dot.style.boxShadow  = `0 0 10px -1px ${hex}`;

    container.querySelectorAll('.dbv2-swatch').forEach(s => {
      s.style.boxShadow = s.dataset.color === hex
        ? '0 0 0 2px #0a0b16,0 0 0 3.5px var(--gold-300)' : '';
    });

    const tags = computeTags();
    container.querySelector('#dbv2-tags').innerHTML = tags.length
      ? tags.map(t => `<span class="dbv2-tag"><span style="color:var(--gold-300)">✦</span>${esc(t)}</span>`).join('')
      : `<span style="font:500 11px var(--font-body);color:var(--text-faint)">—</span>`;

    lanesEl.innerHTML = [1,2,3,4,5].map(t => {
      const cards  = deckData[t];
      const tHex   = TIER_HEX[t];
      const rgb    = hex2rgb(tHex);
      const full   = cards.length >= tierMax[t];
      const cntColor = full ? 'var(--sf-team-red-hi)' : tHex;

      const miniCards = cards.map((card, idx) => {
        const T      = TIER_COLORS[t];
        const summon = card.summon_type ?? 'normal';
        const isMulti = Array.isArray(card.summon_options) && card.summon_options.length > 0;
        const hasIcon = summon !== 'normal' || isMulti;
        return `<div class="dbv2-deckcard" data-tier="${t}" data-idx="${idx}" title="${esc(card.name)} — retirer"
          style="--hc-edge:${T.edge};--hc-ink:${T.ink};--hc-deep:${T.deep};--hc-glow:${T.glow};--hc-art:${T.art}">
          <div class="hand-card-frame-border"></div>
          <div class="hand-card-frame-glow"></div>
          <div class="hand-card-art">
            <img class="hand-card-img" src="/illustrations/${card.id}" alt="${esc(card.name)}" loading="lazy">
            <div class="hand-card-stardust"></div>
            <div class="hand-card-nebula"></div>
            <div class="hand-card-top-edge"></div>
            <div class="hand-card-footer"><span class="hand-card-name">${esc(card.name)}</span></div>
            <div class="hand-card-summon-icons">
              ${hasIcon 
                ? (isMulti 
                  ? card.summon_options.map(o => `<div class="hand-card-summon-icon">${_summonSvg(o.summon_type, T.ink)}</div>`).join('') 
                  : `<div class="hand-card-summon-icon">${_summonSvg(summon, T.ink)}</div>`
                )
                : ''}
            </div>
          </div>
        </div>`;
      }).join('');

      return `<div class="dbv2-lane">
        <div class="dbv2-lane-hd">
          ${_tierIcoHtml(t)}
          <span class="dbv2-lane-lbl">Tier ${t}</span>
          <div class="dbv2-lane-sep" style="background:repeating-linear-gradient(90deg,${TIER_LINE[t]} 0 3px,transparent 3px 8px)"></div>
          <span style="font:700 12px var(--font-display);color:${cntColor}">${cards.length}<span style="color:var(--text-faint);font-weight:400"> / ${tierMax[t]}</span></span>
        </div>
        ${cards.length === 0
          ? `<div class="dbv2-lane-empty">Aucune carte de tier ${t}</div>`
          : `<div class="dbv2-lane-cards">${miniCards}</div>`}
      </div>`;
    }).join('');

    lanesEl.querySelectorAll('.dbv2-deckcard').forEach(el => {
      el.addEventListener('click', () => {
        deckData[parseInt(el.dataset.tier)].splice(parseInt(el.dataset.idx), 1);
        renderDeck(); renderLibrary(); updateMeta();
      });
    });
  }

  // ── Render: Library ───────────────────────────────────────────────────────
  const ALL_CARDS = CardDatabase.getAllCards()
    .slice().sort((a,b) => a.tier !== b.tier ? a.tier - b.tier : a.name.localeCompare(b.name, 'fr'));

  function renderLibrary() {
    const q = searchQuery.trim().toLowerCase();
    const filtered = ALL_CARDS.filter(c => {
      if (tierFilters.length   && !tierFilters.includes(c.tier)) return false;
      if (summonFilters.length && !summonFilters.includes(c.summon_type ?? 'normal')) return false;
      if (q && !c.name.toLowerCase().includes(q)) return false;
      return true;
    });

    container.querySelector('#dbv2-fcount').textContent =
      `${ALL_CARDS.length} cartes · ${filtered.length} affichées`;

    libEl.innerHTML = '';
    if (!filtered.length) {
      libEl.innerHTML = `<p class="dbv2-empty">Aucune carte trouvée.</p>`;
      return;
    }

    for (const c of filtered) {
      const T       = TIER_COLORS[c.tier];
      const copies  = deckData[c.tier].filter(x => x.id === c.id).length;
      const isFull  = deckData[c.tier].length >= tierMax[c.tier];
      const summon  = c.summon_type ?? 'normal';
      const isMulti = Array.isArray(c.summon_options) && c.summon_options.length > 0;
      const hasIcon = summon !== 'normal' || isMulti;

      const btn = document.createElement('button');
      btn.className = 'dbv2-libcard' + (isFull ? ' tier-full' : '');
      btn.style.cssText = `--hc-edge:${T.edge};--hc-ink:${T.ink};--hc-deep:${T.deep};--hc-glow:${T.glow};--hc-art:${T.art}`;
      btn.dataset.id = c.id;

      btn.innerHTML = `
        <div class="hand-card-frame-border"></div>
        <div class="hand-card-frame-glow"></div>
        <div class="hand-card-art">
          <img class="hand-card-img" src="/illustrations/${c.id}" alt="${esc(c.name)}" loading="lazy">
          <div class="hand-card-stardust"></div>
          <div class="hand-card-nebula"></div>
          <div class="hand-card-top-edge"></div>
          <div class="hand-card-footer"><span class="hand-card-name">${esc(c.name)}</span></div>
          <div class="hand-card-summon-icons">
            ${hasIcon 
                ? (isMulti 
                  ? c.summon_options.map(o => `<div class="hand-card-summon-icon">${_summonSvg(o.summon_type, T.ink)}</div>`).join('') 
                  : `<div class="hand-card-summon-icon">${_summonSvg(summon, T.ink)}</div>`
                )
                : ''}
          </div>
        </div>
        ${copies > 0 ? `<span class="dbv2-checkbadge"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--gold-200)" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg></span>` : ''}
      `;

      let lp;
      btn.addEventListener('pointerdown', () => {
        lp = setTimeout(() => Tooltip.showAtRect(Tooltip.cardHtml(c, PowerDatabase, AttributeDatabase, CardDatabase), btn.getBoundingClientRect()), 500);
      });
      btn.addEventListener('pointerup',     () => clearTimeout(lp));
      btn.addEventListener('pointercancel', () => clearTimeout(lp));
      btn.addEventListener('click', () => {
        clearTimeout(lp); Tooltip.hide();
        if (isFull) return;
        deckData[c.tier].push(c);
        renderDeck(); renderLibrary(); updateMeta();
      });

      libEl.appendChild(btn);
    }
  }

  // ── Meta update ───────────────────────────────────────────────────────────
  function updateMeta() {
    const total   = [1,2,3,4,5].reduce((s,t) => s + deckData[t].length, 0);
    const hasName = nameInput.value.trim().length > 0;
    const tierOk  = [1,2,3,4,5].every(t => deckData[t].length <= tierMax[t]);
    const valid   = hasName && total >= deckMin && tierOk && !publicDeckId;

    btnSave.disabled = !valid;
    container.querySelector('#dbv2-save-label').textContent = valid ? '▸ Enregistrer le deck' : 'Deck incomplet';

    const pct  = Math.min(100, deckMin > 0 ? Math.round(total / deckMin * 100) : 100);
    const good = total >= deckMin;
    container.querySelector('#dbv2-cnttotal').innerHTML =
      `<span style="color:${good ? 'var(--sf-success)' : 'var(--gold-200)'};font:600 22px var(--font-display)">${total}</span>`+
      `<span style="font:500 13px var(--font-body);color:var(--text-faint)"> / ${deckMin} cartes</span>`;
    const fill = container.querySelector('#dbv2-pfill');
    fill.style.width      = pct + '%';
    fill.style.background = good ? 'var(--sf-success)' : 'var(--grad-primary)';
    const statusEl = container.querySelector('#dbv2-cstatus');
    const need     = Math.max(0, deckMin - total);
    statusEl.textContent = good
      ? '✓ Deck valide · prêt à enregistrer'
      : `Encore ${need} carte${need > 1 ? 's' : ''} pour valider (min. ${deckMin})`;
    statusEl.style.color = good ? 'var(--sf-success)' : 'var(--gold-300)';

    container.querySelector('#dbv2-tc').textContent = total;

    const hex = deckColor ?? '#9d74dc';
    container.querySelector('#dbv2-sumbar-dot').style.background  = hex;
    container.querySelector('#dbv2-sumbar-name').textContent       = nameInput.value.trim() || 'Mon deck';
    const sbarStatus = container.querySelector('#dbv2-sumbar-status');
    sbarStatus.textContent = good ? '✓ Deck valide' : `${total}/${deckMin} cartes`;
    sbarStatus.style.color = good ? 'var(--sf-success)' : 'var(--gold-300)';
    const sbarTotal = container.querySelector('#dbv2-sumbar-total');
    sbarTotal.textContent  = `${total}/${deckMin}`;
    sbarTotal.style.color  = good ? 'var(--sf-success)' : 'var(--gold-200)';

    /*const dispName = nameInput.value.trim() || 'Deck';
    container.querySelector('#dbv2-un').textContent = dispName.slice(0, 14) + (dispName.length > 14 ? '…' : '');
    const av = container.querySelector('#dbv2-av');
    av.style.background = `linear-gradient(135deg,${hex},${hex}99)`;
    av.textContent      = dispName.charAt(0).toUpperCase() || '?';*/
  }

  // ── Events ────────────────────────────────────────────────────────────────
  container.querySelector('#dbv2-tabs').addEventListener('click', e => {
    const tab = e.target.closest('.ds-tab');
    if (!tab) return;
    bodyEl.dataset.tab = tab.dataset.tab;
    container.querySelectorAll('.ds-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab.dataset.tab));
  });

  container.querySelector('#dbv2-sumbar').addEventListener('click', () => {
    bodyEl.dataset.tab = 'deck';
    container.querySelectorAll('.ds-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === 'deck'));
  });

  container.querySelector('#dbv2-tier-chips').addEventListener('click', e => {
    const chip = e.target.closest('.dbv2-chip');
    if (!chip) return;
    const t = parseInt(chip.dataset.tier);
    tierFilters = tierFilters.includes(t) ? tierFilters.filter(x => x !== t) : [...tierFilters, t];
    container.querySelectorAll('[data-tier].dbv2-chip').forEach(ch =>
      ch.classList.toggle('active', tierFilters.includes(parseInt(ch.dataset.tier))));
    renderLibrary();
  });

  container.querySelector('#dbv2-summon-chips').addEventListener('click', e => {
    const chip = e.target.closest('.dbv2-chip');
    if (!chip) return;
    const k = chip.dataset.summon;
    summonFilters = summonFilters.includes(k) ? summonFilters.filter(x => x !== k) : [...summonFilters, k];
    container.querySelectorAll('[data-summon].dbv2-chip').forEach(ch =>
      ch.classList.toggle('active', summonFilters.includes(ch.dataset.summon)));
    renderLibrary();
  });

  container.querySelector('#dbv2-search').addEventListener('input', e => {
    searchQuery = e.target.value;
    renderLibrary();
  });

  container.querySelectorAll('#dbv2-back').forEach(btn => btn.addEventListener('click', () => {
    if (publicDeckId && window.parent !== window) {
      window.parent.postMessage({ type: 'soulforge-deckbuilder-close' }, '*');
      return;
    }
    navigate('deck_selector', { mode: 'manage' });
  }));

  nameInput.addEventListener('input', () => { deckName = nameInput.value; updateMeta(); });

  container.querySelector('#dbv2-swatches').addEventListener('click', e => {
    const s = e.target.closest('.dbv2-swatch');
    if (!s) return;
    deckColor = s.dataset.color || null;
    renderDeck(); updateMeta();
  });

  btnClear.addEventListener('click', () => {
    for (let t = 1; t <= 5; t++) deckData[t] = [];
    renderDeck(); renderLibrary(); updateMeta();
  });

  btnSave.addEventListener('click', async () => {
    if (btnSave.disabled) return;
    const name = nameInput.value.trim();
    if (!name) return;
    const toSave = {};
    for (let t = 1; t <= 5; t++) toSave[String(t)] = deckData[t].map(c => c.id);

    if (publicDeckId) {
      const res = await fetch(`/api/decks/${publicDeckId}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: publicDeckId, name, deck: toSave }),
      }).then(r => r.json()).catch(e => ({ error: e.message }));
      if (res.error) { alert(res.error); return; }
      if (window.parent !== window) { window.parent.postMessage({ type: 'soulforge-deckbuilder-saved' }, '*'); return; }
      navigate('deck_selector', { mode: 'manage' });
      return;
    }

    if (DeckRepository.deckExists(name) && name !== editName) {
      if (!confirm(`Un deck "${name}" existe déjà. Écraser ?`)) return;
    }
    if (editName && editName !== name && DeckRepository.deckExists(editName)) DeckRepository.deleteDeck(editName);
    DeckRepository.saveDeck(name, toSave);
    if (deckColor) DeckRepository.setDeckColor?.(name, deckColor);
    DeckRepository.setDeckTags?.(name, computeTags());
    navigate('deck_selector', { mode: 'manage' });
  });

  // ── Init ──────────────────────────────────────────────────────────────────
  renderDeck();
  renderLibrary();
  updateMeta();
}

// Symmetric dot patterns for each tier — all symmetric about the vertical axis (x=20).
// Uses the 4 lateral tips of the orbital ellipses + a top-centre anchor (20,6):
//   top-centre(20,6)  top-right(27,7.9)  top-left(13,7.9)
//   bottom-right(27,32.1)  bottom-left(13,32.1)
const _ORBIT_DOTS = {
  1: [[20,   6  ]],
  2: [[6,  20], [34,  20]],
  3: [[20,   6  ], [7,  27], [33,  27]],
  4: [[9,   9], [31,   9], [9,  31], [31,  31]],
  5: [[20,   6  ], [6,   12], [34,   12], [12,  31], [28,  31]],
};

function _tierIcoHtml(t) {
  const tHex = TIER_HEX[t];
  const T    = TIER_COLORS[t];
  const dots = (_ORBIT_DOTS[t] ?? [])
    .map(([cx, cy]) => `<circle cx="${cx}" cy="${cy}" r="1.8" fill="currentColor"/>`)
    .join('');
  return `<span class="dbv2-tier-ico" style="--ti-edge:${tHex};--ti-ink:${T.ink};--ti-glow:${T.glow}">
    <svg class="dbv2-tier-atom" viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
      <ellipse cx="20" cy="20" rx="14" ry="5.5" stroke="currentColor" stroke-width="1.2"/>
      <ellipse cx="20" cy="20" rx="14" ry="5.5" stroke="currentColor" stroke-width="1.2" transform="rotate(60 20 20)"/>
      <ellipse cx="20" cy="20" rx="14" ry="5.5" stroke="currentColor" stroke-width="1.2" transform="rotate(120 20 20)"/>
      ${dots}
    </svg>
    <span class="dbv2-tier-ico-num">${t}</span>
  </span>`;
}

function _chipSummonSvg(type) {
  if (type === 'normal') return `<span style="font-size:12px;line-height:1">✦</span>`;
  const a = `width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"`;
  if (type === 'sacrifice')      return `<svg ${a}><path d="M12 3c1.6 3 3.6 4.3 3.6 7.6a3.6 3.6 0 0 1-7.2 0c0-1.7.9-2.9 1.7-3.7.2 1.5 1.1 2.1 2 2.3C12.7 8.2 11.4 5.7 12 3z"/></svg>`;
  if (type === 'fusion')         return `<svg ${a}><circle cx="9.5" cy="12" r="5"/><circle cx="14.5" cy="12" r="5"/></svg>`;
  if (type === 'heritage')       return `<svg ${a}><path d="M5 18h14"/><path d="M5 18V8.5l3.4 3 3.6-6 3.6 6 3.4-3V18"/></svg>`;
  if (type === 'transformation') return `<svg ${a}><path d="M20 12a8 8 0 1 1-2.4-5.7"/><path d="M20 4v4h-4"/></svg>`;
  return '';
}

function _summonSvg(type, ink) {
  const a = `width="55%" height="55%" viewBox="0 0 24 24" fill="none" stroke="${ink}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"`;
  if (type === 'sacrifice')     return `<svg ${a}><path d="M12 3c1.6 3 3.6 4.3 3.6 7.6a3.6 3.6 0 0 1-7.2 0c0-1.7.9-2.9 1.7-3.7.2 1.5 1.1 2.1 2 2.3C12.7 8.2 11.4 5.7 12 3z"/></svg>`;
  if (type === 'fusion')        return `<svg ${a}><circle cx="9.5" cy="12" r="5"/><circle cx="14.5" cy="12" r="5"/></svg>`;
  if (type === 'heritage')      return `<svg ${a}><path d="M5 18h14"/><path d="M5 18V8.5l3.4 3 3.6-6 3.6 6 3.4-3V18"/></svg>`;
  if (type === 'transformation') return `<svg ${a}><path d="M20 12a8 8 0 1 1-2.4-5.7"/><path d="M20 4v4h-4"/></svg>`;
  return '';
}

function esc(str) {
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
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