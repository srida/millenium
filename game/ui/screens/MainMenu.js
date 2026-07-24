import { navigate } from '../../main.js';
import * as AuthClient from '../../data/AuthClient.js';
import * as DeckRepository from '../../data/DeckRepository.js';

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const STATS = { level: 24, xp: 3200, xpMax: 5000, rank: 'Diamant II', pdl: 64, wins: 68, games: 142, lb: '#8.4k', gold: 1240, gems: 80 };
const MISSIONS = [
  { done: true,  label: 'Jouer 1 partie classée', progress: 1, total: 1,  reward: '+50',  gem: false },
  { done: false, label: 'Gagner 3 parties',        progress: 1, total: 3,  reward: '+120', gem: false },
  { done: false, label: 'Invoquer 10 cartes',      progress: 6, total: 10, reward: '◆ 5', gem: true  },
];

const SOLO_MODES = [
  { id: 'solo_classic',   star: '☆', name: 'Duel Libre',  desc: 'Affronte l\'IA en partie simple',      meta: 'Hors ligne · vs IA',   action: 'solo' },
  { id: 'solo_normal',    star: '★', name: 'Campagne',        desc: 'Découvre l\'histoire de Soulforge et débloque des items',   meta: 'Bientôt disponible',   action: 'solo' },
  { id: 'solo_challenge', star: '✦', name: 'Tournoi',          desc: 'Tournoi hors ligne contre 7 IA',          meta: 'Hors ligne · vs IA',   action: 'tournament'   },
];
const ONLINE_MODES = [
  { id: 'online_ranked',     star: '◆', name: 'Classé 1v1',  desc: 'File compétitive, rang & PdL',          meta: 'Bientôt disponible',    action: 'play'       },
  { id: 'online_normal',     star: '●', name: 'Normal',       desc: 'Partie détendue sans enjeu de rang',    meta: 'En ligne',   action: 'play' },
  { id: 'online_tournament', star: '🏆', name: 'Tournoi',     desc: 'Bracket 8 joueurs · élimination',       meta: 'Bientôt disponible',  action: 'tournament' },
];
const ALL_MODES = [...SOLO_MODES, ...ONLINE_MODES];

function avatarContent(avatar, cls = 'mm-avatar-img') {
  if (!avatar) return '';
  if (/^(https?:|data:)/i.test(avatar)) return `<img class="${cls}" src="${esc(avatar)}" alt="">`;
  return `<span class="mm-avatar-text">${esc(avatar)}</span>`;
}

function friendAvatarContent(avatar) {
  if (!avatar) return '';
  if (/^(https?:|data:)/i.test(avatar)) return `<img class="mm-friend-av-img" src="${esc(avatar)}" alt="">`;
  return `<span class="mm-friend-av-text">${esc(avatar)}</span>`;
}

function modeCardHtml(m, selected, compact = false) {
  const selOverlay = selected ? `
    <div class="mm-mc-ring"></div>
    <div class="mm-mc-line"></div>` : '';
  const cls = `mm-mode-card${compact ? ' mm-mode-card-compact' : ''}${selected ? ' selected' : ''}`;
  if (compact) {
    return `
    <div class="${cls}" data-mode="${esc(m.id)}">
      ${selOverlay}
      <div class="mm-mc-top">
        <div class="mm-mc-name">${esc(m.name)}</div>
        <span class="mm-mc-star">${esc(m.star)}</span>
      </div>
      <div class="mm-mc-meta">${esc(m.meta)}</div>
    </div>`;
  }
  return `
    <div class="${cls}" data-mode="${esc(m.id)}">
      ${selOverlay}
      <div class="mm-mc-top">
        <div class="mm-mc-name">${esc(m.name)}</div>
        <span class="mm-mc-star">${esc(m.star)}</span>
      </div>
      <div class="mm-mc-desc">${esc(m.desc)}</div>
      <div class="mm-mc-pill">${esc(m.meta)}</div>
    </div>`;
}

export async function mount(container) {
  let user = AuthClient.getUser();
  if (!user) { try { user = await AuthClient.me(); } catch { /* offline */ } }
  if (!user) { navigate('auth'); return; }

  let friends = [];
  let requests = { incoming: [], outgoing: [] };
  try {
    [friends, requests] = await Promise.all([
      AuthClient.getFriends().catch(() => []),
      AuthClient.getRequests().catch(() => ({ incoming: [], outgoing: [] })),
    ]);
  } catch { /* offline */ }

  const s = STATS;
  const isAdmin = user.is_admin;
  const xpPct  = Math.round(s.xp / s.xpMax * 100);
  const pendingCount = requests.incoming.length;
  const onlineCount  = friends.filter(f => f.is_online).length;

  const incomingRows = requests.incoming.map(r => `
    <div class="mm-friend">
      <div class="mm-friend-av">${friendAvatarContent(r.avatar)}<span class="mm-friend-dot" style="background:var(--sf-team-red)"></span></div>
      <div class="mm-friend-info">
        <div class="mm-friend-name">${esc(r.username)}<span class="mm-friend-tag"> #${esc(String(r.tag))}</span></div>
        <div class="mm-friend-sub">Demande d'ami</div>
      </div>
      <div class="mm-req-btns">
        <button class="mm-req-accept" data-req-accept="${esc(r.friendship_id)}">✓</button>
        <button class="mm-req-decline" data-req-decline="${esc(r.friendship_id)}">✕</button>
      </div>
    </div>`).join('');

  const friendRows = friends.length
    ? friends.map(f => `
      <div class="mm-friend">
        <div class="mm-friend-av">${friendAvatarContent(f.avatar)}<span class="mm-friend-dot"></span></div>
        <div class="mm-friend-info">
          <div class="mm-friend-name">${esc(f.username)}<span class="mm-friend-tag"> #${esc(String(f.tag))}</span></div>
          <div class="mm-friend-sub">Ami</div>
        </div>
      </div>`).join('')
    : '<div class="mm-no-friends">Aucun ami pour le moment.</div>';

  const friendsSep = (incomingRows && friends.length) ? '<div class="mm-req-sep"></div>' : '';

  const missionRows = MISSIONS.map(m => {
    const pct = Math.round(m.progress / m.total * 100);
    return `
      <div class="mm-mission">
        <span class="mm-mission-check${m.done ? ' done' : ''}">${m.done ? '✓' : ''}</span>
        <div class="mm-mission-info">
          <div class="mm-mission-label">${esc(m.label)}</div>
          <div class="mm-mission-bar"><div class="mm-mission-fill${m.done ? ' done' : ''}" style="width:${pct}%"></div></div>
        </div>
        <span class="mm-mission-reward ${m.gem ? 'gem' : 'gold'}">${esc(m.reward)}</span>
      </div>`;
  }).join('');

  const devBarMobile = isAdmin ? `
    <div class="mm-dev-bar">
      <span class="mm-dev-tag">DEV</span>
      <div class="mm-dev-btns">
        <button class="mm-dev-btn" data-action="testbench3d">TestBench 3D</button>
        <button class="mm-dev-btn" data-action="admin">Administration</button>
      </div>
    </div>` : '';

  const onlineBadge = onlineCount > 0
    ? `<span class="mm-online-badge"><span class="mm-online-dot"></span>${onlineCount} en ligne</span>`
    : '';

  const settingsIconSvg = `<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 0 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.9.3l-.1-.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 0 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 0 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 0 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>`;
  const logoutIconSvg = `<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>`;

  container.innerHTML = `
    <div class="mm-root">

      <!-- ── Mobile top bar ── -->
      <div class="mm-topbar">
        <div class="mm-topbar-left">
          <img src="/game/logo.png" class="mm-emblem" alt="">
          <span class="engraved mm-wordmark">Soulforge</span>
        </div>
        <div class="mm-topbar-right">
          <div class="mm-currency-group">
            <div class="mm-currency-chip mm-currency-gold"><span class="mm-coin"></span>${s.gold.toLocaleString('fr-FR')}</div>
            <div class="mm-currency-chip mm-currency-gem"><span class="mm-gem-icon"></span>${s.gems}</div>
          </div>
          <button class="mm-profile-btn" data-action="profile">
            <div class="mm-avatar-circle">${avatarContent(user.avatar)}</div>
          </button>
          <button class="mm-icon-btn" data-action="settings" aria-label="Réglages">${settingsIconSvg}</button>
        </div>
      </div>

      <!-- ── Desktop header ── -->
      <header class="mm-desktop-header">
        <div class="mm-desktop-hd-left">
          <img src="/game/logo.png" class="mm-logo-img" alt="">
          <span class="engraved mm-desktop-title">Soulforge</span>
          <div class="mm-desktop-subtitle">Auto-Battler × Tactiques × Deck-building</div>
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
      </header>

      <!-- ── Main grid ── -->
      <div class="mm-grid">

        <!-- LEFT: profile + nav (desktop) -->
        <aside class="mm-col-left">
          <div class="mm-profile-card">
            <div class="mm-profile-banner">
              <div class="mm-profile-avatar-wrap">
                <div class="mm-avatar-circle mm-avatar-lg">
                  ${avatarContent(user.avatar)}
                  <div class="mm-avatar-level">${s.level}</div>
                </div>
              </div>
            </div>
            <div class="mm-profile-body">
              <div class="mm-profile-name">${esc(user.username)}</div>
              <div class="mm-profile-rank-row">
                <span class="mm-rank-gem-lg"></span>
                <span class="mm-profile-rank-name">${esc(s.rank)}</span>
                <span class="mm-profile-pdl">· ${s.pdl} PdL</span>
              </div>
              <div class="mm-xp-label"><span>Niveau ${s.level}</span><span>${s.xp.toLocaleString('fr-FR')} / ${s.xpMax.toLocaleString('fr-FR')} XP</span></div>
              <div class="mm-bar-track"><div class="mm-bar-fill" style="width:${xpPct}%"></div></div>
              <div class="mm-profile-stats">
                <div><div class="mm-stat-val">${s.wins}%</div><div class="mm-stat-lbl">Victoires</div></div>
                <div><div class="mm-stat-val">${s.games}</div><div class="mm-stat-lbl">Parties</div></div>
                <div><div class="mm-stat-val mm-stat-gold">${s.lb}</div><div class="mm-stat-lbl">Classt.</div></div>
              </div>
            </div>
          </div>

          <nav class="mm-nav">
            <button class="mm-nav-item" data-action="boutique">
              <span class="mm-nav-icon"><svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/><path d="M16 10a4 4 0 0 1-8 0"/></svg></span>
              <div class="mm-nav-body"><div class="mm-nav-title">Boutique</div><div class="mm-nav-sub">Offres du jour · coffres</div></div>
              <span class="mm-nav-arrow">›</span>
            </button>
            <button class="mm-nav-item" data-action="forge">
              <span class="mm-nav-icon"><svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.4-.5-2-1-3-1.1-2-1-4 .6-5.4C11 6 13 7 14 9c1 2 1.4 3.1 1.4 4a5.4 5.4 0 1 1-10.8 0c0-1 .3-2 1-3 .4 1.2 1 1.9 2.9 1.5z"/></svg></span>
              <div class="mm-nav-body"><div class="mm-nav-title">Forge de cartes</div><div class="mm-nav-sub">Fusionne & grave tes âmes</div></div>
              <span class="mm-nav-arrow">›</span>
            </button>
            <button class="mm-nav-item" data-action="decks">
              <span class="mm-nav-icon"><svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/></svg></span>
              <div class="mm-nav-body"><div class="mm-nav-title">Deck-building</div><div class="mm-nav-sub">7 decks · composer & invoquer</div></div>
              <span class="mm-nav-arrow">›</span>
            </button>
          </nav>
        </aside>

        <!-- CENTER: modes + play -->
        <main class="mm-col-center">

          <!-- Desktop: section heading -->
          <div class="mm-center-head">
            <div class="eyebrow">Choisis ton champ de bataille</div>
          </div>

          <!-- Mobile: profile strip -->
          <button class="mm-profile-strip" data-action="profile">
            <div class="mm-avatar-circle">
              ${avatarContent(user.avatar)}
              <div class="mm-avatar-level">${s.level}</div>
            </div>
            <div class="mm-strip-body">
              <div class="mm-strip-name">${esc(user.username)}</div>
              <div class="mm-strip-bar"><div class="mm-strip-bar-fill" style="width:${xpPct}%"></div></div>
            </div>
            <div class="mm-strip-right">
              <div class="mm-strip-rank">${esc(s.rank)}</div>
              <div class="mm-strip-pdl">${s.pdl} PdL</div>
            </div>
          </button>

          <!-- Mobile: segmented mode toggle -->
          <div class="mm-mobile-toggle" id="mm-mobile-toggle">
            <button class="mm-toggle-btn active" data-tab="solo">Solo</button>
            <button class="mm-toggle-btn" data-tab="online">En ligne</button>
          </div>

          <!-- Mobile: featured mode card -->
          <div class="mm-mobile-featured" id="mm-mobile-featured">
            ${modeCardHtml(SOLO_MODES[0], true)}
          </div>

          <!-- Mobile: other modes (compact) -->
          <div class="mm-mobile-others" id="mm-mobile-others">
            ${SOLO_MODES.slice(1).map(m => modeCardHtml(m, false, true)).join('')}
          </div>

          <!-- Desktop: Solo group -->
          <div class="mm-mode-group" id="mm-solo-group">
            <div class="mm-mode-group-lbl">
              <span class="mm-mg-name"><span class="mm-mg-star gold">✦</span>Solo</span>
              <div class="mm-mg-divider"></div>
              <span class="mm-mg-meta">Hors ligne · vs IA</span>
            </div>
            <div class="mm-mode-cards" id="mm-solo-cards">
              ${SOLO_MODES.map((m, i) => modeCardHtml(m, i === 0)).join('')}
            </div>
          </div>

          <!-- Desktop: Online group -->
          <div class="mm-mode-group" id="mm-online-group">
            <div class="mm-mode-group-lbl">
              <span class="mm-mg-name mm-mg-online"><span class="mm-mg-star violet">✦</span>En ligne</span>
              <div class="mm-mg-divider mm-mg-divider-violet"></div>
              <span class="mm-mg-meta">Multijoueur · classé & tournoi</span>
            </div>
            <div class="mm-mode-cards" id="mm-online-cards">
              ${ONLINE_MODES.map((m, i) => modeCardHtml(m, i === 0)).join('')}
            </div>
          </div>

          <!-- Play button -->
          <div class="mm-play-wrap">
            <button class="mm-play-btn" id="mm-play">
              <div class="mm-play-sheen"></div>
              <div class="mm-play-content">▶&nbsp;&nbsp;<span id="mm-play-label">JOUER EN LIGNE</span></div>
            </button>
          </div>

          <!-- Mobile: missions compact -->
          <div class="mm-mobile-missions">
            <div class="mm-mob-miss-head">
              <span class="engraved mm-miss-title-sm">Mission du jour</span>
              <span class="mm-missions-timer"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15 14"/></svg>06:12:44</span>
            </div>
            <div class="mm-missions">${missionRows}</div>
          </div>

          ${devBarMobile}
        </main>

        <!-- RIGHT: missions + friends (desktop) -->
        <aside class="mm-col-right">
          <div class="mm-panel mm-missions-panel">
            <div class="mm-panel-top-line"></div>
            <div class="mm-panel-head">
              <span class="engraved mm-panel-title">Mission du jour</span>
              <span class="mm-missions-timer"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15 14"/></svg>06:12:44</span>
            </div>
            <div class="mm-missions">${missionRows}</div>
          </div>

          <div class="mm-panel mm-friends-panel">
            <div class="mm-panel-top-line"></div>
            <div class="mm-panel-head">
              <div class="mm-friends-hd-left">
                <span class="engraved mm-panel-title">Amis</span>
                ${onlineBadge}
              </div>
              <button class="mm-invite-btn" data-action="friends">+ Ajouter</button>
            </div>
            <div class="mm-friends">
              ${incomingRows}${friendsSep}${friendRows}
            </div>
          </div>
        </aside>

      </div>

      <!-- ── Mobile bottom nav ── -->
      <nav class="mm-bottom-nav">
        <button class="mm-bottom-tab active" data-action="home">
          <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/></svg>
          <span>Accueil</span>
        </button>
        <button class="mm-bottom-tab" data-action="boutique">
          <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/><path d="M16 10a4 4 0 0 1-8 0"/></svg>
          <span>Boutique</span>
        </button>
        <button class="mm-bottom-tab" data-action="forge">
          <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.4-.5-2-1-3-1.1-2-1-4 .6-5.4C11 6 13 7 14 9c1 2 1.4 3.1 1.4 4a5.4 5.4 0 1 1-10.8 0c0-1 .3-2 1-3 .4 1.2 1 1.9 2.9 1.5z"/></svg>
          <span>Forge</span>
        </button>
        <button class="mm-bottom-tab" data-action="decks">
          <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/></svg>
          <span>Deck</span>
        </button>
        <button class="mm-bottom-tab" data-action="friends" style="position:relative">
          <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M16 19v-1a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v1"/><circle cx="9" cy="7" r="3.2"/><path d="M22 19v-1a4 4 0 0 0-3-3.8"/><path d="M16 3.2A4 4 0 0 1 16 11"/></svg>
          ${pendingCount ? `<span class="mm-notif-badge">${pendingCount}</span>` : ''}
          <span>Amis${pendingCount ? ` · ${pendingCount}` : ''}</span>
        </button>
      </nav>

      <!-- ── Mobile floating play button ── -->
      <div class="mm-play-float">
        <button class="mm-play-btn" id="mm-play-mobile">
          <div class="mm-play-sheen"></div>
          <div class="mm-play-content">▶&nbsp;&nbsp;<span id="mm-play-label-m">JOUER</span></div>
        </button>
      </div>

      <!-- Fullscreen (desktop) -->
      <button class="mm-fs-btn" id="btn-fullscreen" title="Plein écran">⛶</button>
    </div>
  `;

  // ── Mode state ──
  let selectedModeId = 'online_ranked';
  let mobileTab = 'solo';

  function updatePlayButton() {
    const mode = ALL_MODES.find(m => m.id === selectedModeId);
    const labelEl  = container.querySelector('#mm-play-label');
    const subEl    = container.querySelector('#mm-play-sub');
    const labelMEl = container.querySelector('#mm-play-label-m');
    if (!mode) return;
    let label, sub;
    if (mode.id.startsWith('solo')) {
      label = 'JOUER SOLO'; sub = 'Partie solo · vs IA';
    } else if (mode.id === 'online_ranked') {
      label = 'JOUER EN LIGNE'; sub = 'File classée · ~12 s · 1 v 1';
    } else if (mode.id === 'online_normal') {
      label = 'JOUER EN LIGNE'; sub = 'Partie normale · 1 v 1';
    } else if (mode.id === 'online_tournament') {
      label = 'TOURNOI'; sub = 'Bracket 8 joueurs · bientôt disponible';
    } else {
      label = 'JOUER'; sub = mode.meta;
    }
    if (labelEl)  labelEl.textContent  = label;
    if (subEl)    subEl.textContent    = sub;
    if (labelMEl) labelMEl.textContent = label;
  }

  function selectMode(modeId) {
    selectedModeId = modeId;
    container.querySelectorAll('.mm-mode-card').forEach(card => {
      const sel = card.dataset.mode === modeId;
      card.classList.toggle('selected', sel);
      card.querySelector('.mm-mc-ring')?.remove();
      card.querySelector('.mm-mc-line')?.remove();
      if (sel) {
        const ring = document.createElement('div'); ring.className = 'mm-mc-ring'; card.prepend(ring);
        const line = document.createElement('div'); line.className = 'mm-mc-line'; card.prepend(line);
      }
    });
    updatePlayButton();
  }

  function updateMobileContent(tab) {
    mobileTab = tab;
    const modes = tab === 'solo' ? SOLO_MODES : ONLINE_MODES;
    const featuredEl = container.querySelector('#mm-mobile-featured');
    const othersEl   = container.querySelector('#mm-mobile-others');
    if (featuredEl) featuredEl.innerHTML = modeCardHtml(modes[0], true);
    if (othersEl)   othersEl.innerHTML   = modes.slice(1).map(m => modeCardHtml(m, false, true)).join('');
    selectedModeId = modes[0].id;
    updatePlayButton();
  }

  // init
  selectMode('online_ranked');

  // ── Event delegation ──
  container.addEventListener('click', async e => {
    // Mode card
    const card = e.target.closest('.mm-mode-card');
    if (card?.dataset.mode) { selectMode(card.dataset.mode); return; }

    // Mobile tab toggle
    const toggleBtn = e.target.closest('.mm-toggle-btn');
    if (toggleBtn) {
      const tab = toggleBtn.dataset.tab;
      container.querySelectorAll('.mm-toggle-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
      updateMobileContent(tab);
      return;
    }

    // Friend request actions
    const acceptBtn  = e.target.closest('[data-req-accept]');
    const declineBtn = e.target.closest('[data-req-decline]');
    if (acceptBtn)  { try { await AuthClient.acceptRequest(acceptBtn.dataset.reqAccept); } catch {} mount(container); return; }
    if (declineBtn) { try { await AuthClient.declineRequest(declineBtn.dataset.reqDecline); } catch {} mount(container); return; }

    // Named actions
    const el = e.target.closest('[data-action]');
    if (!el) return;
    switch (el.dataset.action) {
      case 'home':       break;
      case 'decks':      navigate('deck_selector', { mode: 'manage' }); break;
      case 'tournament': navigate('tournament'); break;
      case 'profile':    navigate('profile'); break;
      case 'friends':    navigate('friends'); break;
      case 'testbench3d': navigate('testbench3d'); break;
      case 'admin':      window.location.href = '/admin'; break;
      case 'boutique':   break;
      case 'forge':      break;
      case 'settings':   break;
      case 'logout':     _logout(); break;
    }
  });

  // Play buttons
  const playSelected = () => {
    const mode = ALL_MODES.find(m => m.id === selectedModeId);
    if (!mode?.action) return;
    switch (mode.action) {
      case 'play':        navigate('deck_selector', { target: 'online_lobby', mode: 'select' }); break;
      case 'play_normal': navigate('deck_selector', { target: 'online_lobby', mode: 'select' }); break;
      case 'solo':        navigate('deck_selector', { target: 'game3d', mode: 'select' }); break;
      case 'tournament':  navigate('tournament'); break;
    }
  };
  container.querySelector('#mm-play')?.addEventListener('click', playSelected);
  container.querySelector('#mm-play-mobile')?.addEventListener('click', playSelected);

  async function _logout() {
    try { await DeckRepository.flushSync(); } catch {}
    try { await AuthClient.logout(); } catch {}
    DeckRepository.handleLogout();
    navigate('auth');
  }

  // ── Fullscreen ──
  const fsBtn = container.querySelector('#btn-fullscreen');
  if (document.documentElement.requestFullscreen && fsBtn) {
    const updateFsIcon = () => {
      fsBtn.textContent = document.fullscreenElement ? '✕' : '⛶';
      fsBtn.title = document.fullscreenElement ? 'Quitter le plein écran' : 'Plein écran';
    };
    fsBtn.addEventListener('click', () => {
      document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen().catch(() => {});
    });
    document.addEventListener('fullscreenchange', updateFsIcon);
    updateFsIcon();
  } else if (fsBtn) {
    fsBtn.style.display = 'none';
  }
}
