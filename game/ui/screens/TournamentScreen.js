import { navigate } from '../../main.js';
import * as CardDatabase from '../../data/CardDatabase.js';
import * as AttributeDatabase from '../../data/AttributeDatabase.js';
import * as DeckRepository from '../../data/DeckRepository.js';
import * as Tournament from '../../logic/Tournament.js';

const BACK_SVG = `<svg width="15" height="15" viewBox="0 0 16 16" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" fill="none"><polyline points="10,3 5,8 10,13"/></svg>`;
const PLAY_SVG = `<svg width="16" height="16" viewBox="0 0 18 18" stroke="#fff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" fill="none"><path d="M14 3l-8 8M4 3l10 12M3 14l4-4"/></svg>`;
const CROWN_PATH = `M2 13h20l-1.6-9-5 4.2L12 1 8.6 8.2l-5-4.2L2 13z`;

const GOLD = '#ffd98a';
const HI_STROKE = '#e8b45a';
const BASE_STROKE = 'rgba(139,92,246,.26)';
const PAL = ['#7c5cff','#5f9dff','#46d39a','#e8546e','#e8a94e','#a06bff','#5fd6e8','#d76ea0'];
const ROUND_NAMES = ['Quarts de finale', 'Demi-finales', 'Finale'];

// Survives navigate() calls — bracket state preserved between game rounds.
let _tournament = null;
let _drawNotice = false;

export function unmount() {}

export async function mount(container, params = {}) {
  await Promise.all([CardDatabase.init(), AttributeDatabase.init()]);
  const deps = { attributeList: AttributeDatabase.getAllAttributes(), cardDb: CardDatabase };

  if (params.resumeMatchId) {
    _handleGameResult(Number(params.resumeMatchId), params.gameWinner, deps);
  }

  if (!_tournament) {
    _renderSetup(container);
  } else if (Tournament.isTournamentComplete(_tournament)) {
    _renderEndScreen(container, deps);
  } else {
    _renderBracket(container, deps);
  }
}

function _handleGameResult(matchId, gameWinner, deps) {
  if (!_tournament) return;
  const match = _tournament.rounds.flat().find(m => m.id === matchId);
  if (!match || match.winner) return;

  if (gameWinner === 'draw') { _drawNotice = true; return; }
  _drawNotice = false;

  const playerSlot = match.players.findIndex(p => p.isPlayer);
  const winnerSlot = gameWinner === 'player' ? playerSlot : 1 - playerSlot;
  Tournament.recordGameResult(match, winnerSlot);

  if (match.winner && !Tournament.isTournamentComplete(_tournament)) {
    const nextRound = Tournament.buildNextRound(_tournament);
    Tournament.resolveAiMatches(nextRound, deps);
  }
}

// ─── Setup ────────────────────────────────────────────────────────────────────

function _renderSetup(container) {
  const names = DeckRepository.listDecks();
  let selected = names[0] || null;

  function render() {
    container.innerHTML = `
      <div class="topbar">
        <button class="topbar-back" id="btn-back">${BACK_SVG}</button>
        <span class="topbar-title">MODE TOURNOI</span>
      </div>
      <div class="ds-list" id="ds-list">
        ${names.length === 0 ? `
          <div class="ds-empty">
            <div class="ds-empty-icon">🃏</div>
            <div class="ds-empty-text">Aucun deck sauvegardé</div>
            <div class="ds-empty-sub">Crée un deck avant de lancer un tournoi.</div>
          </div>` : names.map(name => {
            const color = DeckRepository.getDeckColor?.(name);
            const avatarStyle = color
              ? `style="background:linear-gradient(135deg,${color},${color}99)"`
              : 'data-av="0"';
            const tags = DeckRepository.getDeckTags?.(name) ?? [];
            const tagsHtml = tags.length
              ? `<div class="ds-card-meta" style="margin-top:4px;"><span class="ds-deck-tags">${tags.map(t => `<span class="ds-deck-tag">${_esc(t)}</span>`).join('')}</span></div>`
              : '';
            return `
              <div class="ds-card${name === selected ? ' selected' : ''}" data-name="${_esc(name)}">
                <div class="ds-card-sheen"></div>
                <div class="ds-accent-bar"></div>
                <div class="ds-card-inner">
                  <div class="ds-avatar" ${avatarStyle}>${_esc(name[0]?.toUpperCase() || '?')}</div>
                  <div class="ds-card-body">
                    <div class="ds-card-title"><span class="ds-card-name">${_esc(name)}</span></div>
                    ${tagsHtml}
                  </div>
                </div>
              </div>`;
          }).join('')}
      </div>
      <div class="ds-footer">
        <button class="ds-cta" id="btn-start" ${selected ? '' : 'disabled'}>
          <span>⚔ LANCER LE TOURNOI (8 joueurs)</span>
        </button>
      </div>
    `;
    container.querySelector('#btn-back').addEventListener('click', () => navigate('main_menu'));
    container.querySelectorAll('.ds-card').forEach(el => {
      el.addEventListener('click', () => { selected = el.dataset.name; render(); });
    });
    container.querySelector('#btn-start')?.addEventListener('click', async () => {
      _drawNotice = false;
      _tournament = await Tournament.createTournament(selected);
      const deps = { attributeList: AttributeDatabase.getAllAttributes(), cardDb: CardDatabase };
      Tournament.resolveAiMatches(_tournament.rounds[0], deps);
      _renderBracket(container, deps);
    });
  }
  render();
}

// ─── Data helpers ─────────────────────────────────────────────────────────────

function _colorFor(name) {
  let s = 0; for (const c of String(name)) s += c.charCodeAt(0);
  return PAL[s % PAL.length];
}
function _medalColor(r) { return r === 1 ? GOLD : r === 2 ? '#cfd6e6' : r === 3 ? '#e0a878' : '#6f6786'; }
function _initOf(n) { return (n || '?').replace('★', '').trim().charAt(0).toUpperCase(); }

function _buildMatchesData(t) {
  const rounds = t.rounds;

  const quarts = (rounds[0] || []).map((m, i) => {
    const pA = m.players[0], pB = m.players[1];
    const aWin = m.winner === pA, bWin = m.winner === pB;
    const live = !m.winner && m.players.some(p => p.isPlayer);
    return {
      live,
      a: { name: pA.name, you: pA.isPlayer, seed: i * 2 + 1, win: aWin, score: m.wins[0], live },
      b: { name: pB.name, you: pB.isPlayer, seed: i * 2 + 2, win: bWin, score: m.wins[1] }
    };
  });

  const demis = (rounds[1] || []).map((m) => {
    const pA = m.players[0], pB = m.players[1];
    const live = !m.winner && m.players.some(p => p.isPlayer);
    return {
      live,
      a: { name: pA.name, you: pA.isPlayer, win: m.winner === pA, score: m.wins[0] },
      b: { name: pB.name, you: pB.isPlayer, win: m.winner === pB, score: m.wins[1] }
    };
  });
  while (demis.length < 2) demis.push({ a: { name: 'À déterminer', tbd: true }, b: { name: 'À déterminer', tbd: true } });

  let finale = { a: { name: 'À déterminer', tbd: true }, b: { name: 'À déterminer', tbd: true } };
  if (rounds[2]?.[0]) {
    const m = rounds[2][0];
    const pA = m.players[0], pB = m.players[1];
    const live = !m.winner && m.players.some(p => p.isPlayer);
    finale = {
      live,
      a: { name: pA.name, you: pA.isPlayer, win: m.winner === pA, score: m.wins[0] },
      b: { name: pB.name, you: pB.isPlayer, win: m.winner === pB, score: m.wins[1] }
    };
  }

  return { quarts, demis, finale };
}

function _buildRanking(t) {
  const result = [];
  const champion = Tournament.getChampion(t);
  if (champion) result.push({ rank: 1, name: champion.name, you: champion.isPlayer, sub: 'Champion' });

  const reverseLabels = ['Finaliste', 'Demi-finale', 'Quarts'];
  let rank = 2;
  for (let ri = t.rounds.length - 1; ri >= 0; ri--) {
    const sub = reverseLabels[t.rounds.length - 1 - ri] || `Round ${ri + 1}`;
    for (const m of t.rounds[ri]) {
      if (!m.winner) continue;
      const loser = m.players.find(p => p !== m.winner);
      if (loser) { result.push({ rank, name: loser.name, you: loser.isPlayer, sub }); rank++; }
    }
  }
  return result.sort((a, b) => a.rank - b.rank);
}

// ─── Bracket ──────────────────────────────────────────────────────────────────

function _renderBracket(container, deps) {
  const roundIdx = _tournament.currentRoundIndex;
  const playerMatch = Tournament.findPlayerMatch(_tournament);
  const complete = Tournament.isTournamentComplete(_tournament);

  if (complete) { _renderEndScreen(container, deps); return; }

  const md = _buildMatchesData(_tournament);
  const isDesktop = window.innerWidth >= 768;
  const roundName = ROUND_NAMES[roundIdx] || `Round ${roundIdx + 1}`;
  const eliminated = Tournament.isPlayerEliminated(_tournament);

  container.innerHTML = `
    <style>
      @keyframes bk-live{0%,100%{opacity:.55;}50%{opacity:1;}}
      @keyframes bk-in{from{opacity:0;}to{opacity:1;}}
    </style>
    <div class="bk-head">
      <button class="topbar-back bk-back" id="btn-back">${BACK_SVG}</button>
      <div class="bk-title-wrap">
        <span class="bk-kick">TOURNOI</span>
        <span class="bk-dash">—</span>
        <span class="bk-round">${_esc(roundName)}</span>
      </div>
      <div class="bk-tag">8 DUELLISTES</div>
    </div>
    ${isDesktop ? _desktopTree(md) : _mobileList(md, roundIdx)}
    <div class="bk-footer">
      ${_drawNotice ? `<div class="bk-draw-notice">Égalité — la manche doit être rejouée</div>` : ''}
      ${playerMatch
        ? `<button class="ds-cta" id="btn-play">${PLAY_SVG}<span>${_drawNotice ? 'REJOUER LA MANCHE' : 'JOUER MON MATCH'}</span></button>`
        : eliminated
          ? `<div class="ds-empty-sub" style="text-align:center;padding:6px 0;">Vous avez été éliminé du tournoi.</div>`
          : ''}
      <button class="ds-cta-secondary" id="btn-quit" style="width:auto;"><span>Quitter le tournoi</span></button>
    </div>
  `;

  container.querySelector('#btn-back').addEventListener('click', () => navigate('main_menu'));
  container.querySelector('#btn-quit').addEventListener('click', () => {
    if (!confirm('Quitter le tournoi en cours ?')) return;
    _tournament = null;
    navigate('main_menu');
  });
  container.querySelector('#btn-play')?.addEventListener('click', () => {
    const pSlot = playerMatch.players.findIndex(p => p.isPlayer);
    navigate('game3d', {
      deckName: _tournament.playerDeckName,
      enemyDeckRaw: playerMatch.players[1 - pSlot].deck,
      tournamentMatch: { id: playerMatch.id },
    });
  });

  // Keep resolving if eliminated but bracket not done
  if (!playerMatch && !complete) {
    const round = _tournament.rounds[roundIdx];
    if (Tournament.isRoundComplete(round) && !Tournament.isTournamentComplete(_tournament)) {
      const nextRound = Tournament.buildNextRound(_tournament);
      Tournament.resolveAiMatches(nextRound, deps);
      _renderBracket(container, deps);
    }
  }
}

// ─── Desktop tree ─────────────────────────────────────────────────────────────

function _desktopTree(md) {
  const { quarts: Q, demis: DE, finale: F } = md;
  const SW = 1160, SH = 600, W = 248, topPad = 34;
  const qx = 8, dx = 320, fx = 632, cx = 922, cw = 210;
  const qy = [30 + topPad, 132 + topPad, 390 + topPad, 492 + topPad];
  const dy = [(qy[0] + qy[1]) / 2, (qy[2] + qy[3]) / 2];
  const fy = (dy[0] + dy[1]) / 2;
  const mid = y => y + 35;

  const cards = [
    [qx, qy[0], W, Q[0]], [qx, qy[1], W, Q[1]], [qx, qy[2], W, Q[2]], [qx, qy[3], W, Q[3]],
    [dx, dy[0], W, DE[0]], [dx, dy[1], W, DE[1]], [fx, fy, W, F]
  ];

  const paths = [
    { d: `M${qx+W} ${mid(qy[0])} H${qx+W+32} V${mid(dy[0])} H${dx}`, hi: true },
    { d: `M${qx+W} ${mid(qy[1])} H${qx+W+32} V${mid(dy[0])} H${dx}`, hi: false },
    { d: `M${qx+W} ${mid(qy[2])} H${qx+W+32} V${mid(dy[1])} H${dx}`, hi: false },
    { d: `M${qx+W} ${mid(qy[3])} H${qx+W+32} V${mid(dy[1])} H${dx}`, hi: false },
    { d: `M${dx+W} ${mid(dy[0])} H${dx+W+32} V${mid(fy)} H${fx}`, hi: true },
    { d: `M${dx+W} ${mid(dy[1])} H${dx+W+32} V${mid(fy)} H${fx}`, hi: false },
    { d: `M${fx+W} ${mid(fy)} H${cx}`, hi: true }
  ];

  const labels = [
    { x: qx, w: W, y: 8, txt: 'QUARTS' }, { x: dx, w: W, y: 8, txt: 'DEMI-FINALES' },
    { x: fx, w: W, y: 8, txt: 'FINALE' }, { x: cx, w: cw, y: 8, txt: 'VAINQUEUR' }
  ];

  const champName = F.a?.win ? F.a.name : (F.b?.win ? F.b.name : '?');

  return `
    <div class="bk-tree-area">
      <div style="position:relative;width:${SW}px;height:${SH}px;flex:none;">
        <svg viewBox="0 0 ${SW} ${SH}" style="position:absolute;inset:0;width:100%;height:100%;overflow:visible;pointer-events:none;">
          ${paths.map(p => `<path d="${p.d}" fill="none" stroke="${p.hi ? HI_STROKE : BASE_STROKE}" stroke-width="${p.hi ? 2.4 : 1.6}"/>`).join('')}
        </svg>
        ${labels.map(l => `
          <div style="position:absolute;left:${l.x}px;top:${l.y}px;width:${l.w}px;text-align:center;
            font:700 10px var(--font-display);letter-spacing:.18em;color:#5d5878;">${l.txt}</div>
        `).join('')}
        ${cards.map(([x, y, w, m]) => _matchCardAbsolute(m, x, y, w)).join('')}
        <div style="position:absolute;left:${cx}px;top:${fy - 15}px;width:${cw}px;height:96px;
          border-radius:14px;z-index:2;display:flex;flex-direction:column;align-items:center;
          justify-content:center;gap:4px;overflow:hidden;
          background:linear-gradient(170deg,rgba(40,31,17,.9),rgba(14,10,20,.9));
          border:1px solid rgba(255,217,138,.4);
          box-shadow:0 14px 40px -18px rgba(255,200,110,.7);">
          <svg viewBox="0 0 24 14" fill="${GOLD}" style="width:22px;height:auto;margin-bottom:2px;filter:drop-shadow(0 2px 4px rgba(0,0,0,.5))">
            <path d="${CROWN_PATH}"/>
          </svg>
          <span style="font:700 22px var(--font-display);color:${GOLD};max-width:${cw - 20}px;
            white-space:nowrap;overflow:hidden;text-overflow:ellipsis;text-align:center;">${_esc(champName)}</span>
          <span style="font:700 9px var(--font-display);letter-spacing:.2em;color:#5d5878;">CHAMPION</span>
        </div>
      </div>
    </div>
  `;
}

function _matchCardAbsolute(m, x, y, w) {
  if (!m) return '';
  const a = m.a || {}, b = m.b || {};
  const you = a.you || b.you;
  return `
    <div style="position:absolute;left:${x}px;top:${y}px;width:${w}px;
      border-radius:12px;overflow:hidden;z-index:2;
      background:linear-gradient(165deg,rgba(23,17,36,.94),rgba(12,9,20,.94));
      border:1px solid ${you ? GOLD + '88' : 'rgba(139,92,246,.16)'};
      box-shadow:${you ? `0 0 0 1px ${GOLD}33,0 10px 34px -14px ${GOLD}` : '0 8px 22px -14px rgba(0,0,0,.85)'};">
      ${_matchRow(a)}<div style="height:1px;background:rgba(139,92,246,.14);"></div>${_matchRow(b)}
      ${m.live ? `<div style="position:absolute;top:-1px;right:10px;padding:2px 7px;border-radius:0 0 6px 6px;
        font:700 8px var(--font-display);letter-spacing:.1em;color:#0a0812;background:${GOLD};
        animation:bk-live 1.4s ease-in-out infinite;">EN COURS</div>` : ''}
    </div>
  `;
}

// ─── Mobile list ──────────────────────────────────────────────────────────────

function _mobileList(md, activeRoundIdx) {
  const rounds = [
    { label: 'QUARTS DE FINALE', cards: md.quarts, active: activeRoundIdx === 0 },
    { label: 'DEMI-FINALES', cards: md.demis, active: activeRoundIdx === 1 },
    { label: 'FINALE', cards: [md.finale], active: activeRoundIdx === 2 }
  ];

  return `<div class="bk-list-area">
    ${rounds.map(rd => `
      <div class="bk-rd-head">
        <span style="width:7px;height:7px;border-radius:2px;flex:none;background:${HI_STROKE};
          box-shadow:0 0 8px ${HI_STROKE};${rd.active ? '' : 'opacity:.4;'}"></span>
        <span style="font:700 11px var(--font-display);letter-spacing:.18em;color:#8b829f;flex:none;">${rd.label}</span>
        <span style="flex:1;height:1px;background:linear-gradient(90deg,rgba(139,92,246,.25),transparent);"></span>
      </div>
      ${rd.cards.map(m => _matchCardMobile(m)).join('')}
    `).join('')}
  </div>`;
}

function _matchCardMobile(m) {
  if (!m) return '';
  const a = m.a || {}, b = m.b || {};
  const you = a.you || b.you;
  return `
    <div style="position:relative;border-radius:12px;overflow:hidden;margin-bottom:8px;
      background:linear-gradient(165deg,rgba(23,17,36,.9),rgba(12,9,20,.9));
      border:1px solid ${you ? GOLD + '77' : 'rgba(139,92,246,.14)'};
      ${you ? `box-shadow:0 0 0 1px ${GOLD}22;` : ''}">
      ${_matchRow(a)}<div style="height:1px;background:rgba(139,92,246,.12);"></div>${_matchRow(b)}
      ${m.live ? `<div style="position:absolute;top:-1px;right:10px;padding:2px 7px;border-radius:0 0 6px 6px;
        font:700 8px var(--font-display);letter-spacing:.1em;color:#0a0812;background:${GOLD};
        animation:bk-live 1.4s ease-in-out infinite;">EN COURS</div>` : ''}
    </div>
  `;
}

function _matchRow(c) {
  c = c || {};
  const you = !!c.you, win = !!c.win, tbd = !!c.tbd, live = !!c.live;
  const nameColor = tbd ? '#4a4462' : (win ? (you ? GOLD : '#ece9f5') : '#6f6786');
  const scoreColor = tbd ? '#3f3a58' : (live ? '#a78bfa' : (win ? '#7fe6b6' : '#6f6786'));
  const score = tbd ? '—' : (c.score != null ? String(c.score) : '');
  return `
    <div style="display:flex;align-items:center;gap:9px;padding:0 12px;height:34px;
      ${you ? 'background:rgba(124,92,255,.12);' : ''}">
      <span style="font:700 10px var(--font-display);color:#5d5878;width:16px;flex:none;text-align:center;">
        ${c.seed != null ? c.seed : ''}</span>
      <span style="flex:1;min-width:0;font:${win ? 700 : 600} 13px var(--font-body);
        white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:${nameColor};">
        ${_esc((you ? '★ ' : '') + (c.name || '—'))}</span>
      <span style="flex:none;font:700 13px var(--font-display);margin-left:8px;color:${scoreColor};">
        ${score}</span>
    </div>
  `;
}

// ─── End screen ───────────────────────────────────────────────────────────────

function _renderEndScreen(container, deps) {
  const t = _tournament;
  const champion = Tournament.getChampion(t);
  const isWin = !!champion?.isPlayer;
  const ranking = _buildRanking(t);
  const champEntry = ranking[0];
  const finalists = ranking.slice(1, 3);

  const prizeFor = r => r === 1 ? '🏆 Champion' : r === 2 ? '🥈 Finaliste' : r === 3 ? '🥉 Top 3' : '';

  const heroAvHtml = (entry, size) => {
    const col = _colorFor(entry.name);
    const mc = _medalColor(entry.rank);
    return `
      <div style="position:relative;width:${size}px;height:${size}px;border-radius:50%;flex:none;
        display:flex;align-items:center;justify-content:center;
        background:radial-gradient(120% 120% at 30% 25%,${col},rgba(10,7,18,.9));
        border:2px solid ${entry.rank === 1 ? mc : 'rgba(139,92,246,.4)'};
        box-shadow:${entry.rank === 1 ? `0 0 26px -4px ${mc}aa` : '0 6px 18px -8px rgba(0,0,0,.8)'};">
        ${entry.rank === 1 ? `
          <svg viewBox="0 0 24 14" fill="${mc}" style="position:absolute;top:-14px;left:50%;
            transform:translateX(-50%);width:22px;height:auto;filter:drop-shadow(0 2px 5px rgba(0,0,0,.5))">
            <path d="${CROWN_PATH}"/>
          </svg>` : ''}
        <span style="font:700 ${Math.round(size * 0.38)}px var(--font-display);color:#fff;
          text-shadow:0 1px 3px rgba(0,0,0,.6);">${_esc(_initOf(entry.name))}</span>
      </div>`;
  };

  container.innerHTML = `
    <style>
      @keyframes es-rise{from{opacity:0;transform:translateY(14px);}to{opacity:1;transform:none;}}
      @keyframes es-glow{0%,100%{opacity:.5;}50%{opacity:.9;}}
    </style>
    <div class="es-root">
      <div style="position:absolute;top:0;left:0;right:0;height:220px;pointer-events:none;
        animation:es-glow 4s ease-in-out infinite;
        background:${isWin
          ? 'radial-gradient(60% 100% at 50% 0%,rgba(255,200,110,.16),transparent 70%)'
          : 'radial-gradient(60% 100% at 50% 0%,rgba(124,92,255,.12),transparent 70%)'}">
      </div>

      <!-- Header -->
      <div style="position:relative;text-align:center;flex:none;margin-bottom:18px;animation:es-rise .5s ease both;">
        <div style="font:700 11px var(--font-display);letter-spacing:.28em;
          color:${isWin ? 'rgba(255,217,138,.8)' : '#7a7398'};">TOURNOI · TERMINÉ</div>
        <div style="font:700 26px var(--font-display);letter-spacing:.02em;
          color:${isWin ? GOLD : '#dcd6ea'};margin:7px 0 5px;line-height:1.1;
          ${isWin ? 'text-shadow:0 0 30px rgba(255,200,110,.35);' : ''}">
          ${isWin ? 'VOUS REMPORTEZ LE TOURNOI' : _esc((champion?.name || '') + ' remporte le tournoi')}
        </div>
        <div style="font:600 13px var(--font-body);color:#8b829f;">
          ${isWin ? 'Bracket à 8 · vous finissez n°1' : 'Vous êtes éliminé — consultez le classement'}
        </div>
      </div>

      <!-- Hero podium -->
      <div style="display:flex;flex-direction:column;align-items:center;gap:12px;flex:none;margin-bottom:16px;">
        ${champEntry ? `
        <div style="position:relative;width:min(300px,100%);display:flex;flex-direction:column;
          align-items:center;gap:8px;padding:22px 18px 16px;border-radius:20px;overflow:hidden;
          background:linear-gradient(170deg,rgba(40,31,17,.92),rgba(14,10,20,.92));
          border:1px solid ${isWin ? 'rgba(255,217,138,.45)' : 'rgba(167,139,250,.4)'};
          box-shadow:0 20px 60px -22px ${isWin ? 'rgba(255,200,110,.7)' : 'rgba(124,92,255,.6)'};">
          <div style="position:absolute;top:0;left:0;right:0;height:3px;
            background:linear-gradient(90deg,transparent,${GOLD},transparent);"></div>
          ${heroAvHtml(champEntry, 84)}
          <div style="font:700 13px var(--font-display);letter-spacing:.24em;color:${GOLD};">CHAMPION</div>
          <div style="font:700 22px var(--font-display);color:#f4eee0;">${_esc(champEntry.name)}</div>
        </div>` : ''}
        <div style="display:flex;gap:10px;width:min(300px,100%);">
          ${finalists.map(p => {
            const mc = _medalColor(p.rank);
            return `
            <div style="display:flex;align-items:center;gap:9px;flex:1;min-width:0;
              padding:9px 12px;border-radius:13px;
              background:${p.you ? 'rgba(124,92,255,.12)' : 'rgba(20,15,32,.6)'};
              border:1px solid ${p.you ? 'rgba(167,139,250,.4)' : 'rgba(139,92,246,.14)'};">
              ${heroAvHtml(p, 42)}
              <div style="flex:1;min-width:0;display:flex;flex-direction:column;gap:2px;">
                <div style="font:${p.you ? 700 : 600} 13px var(--font-body);
                  color:${p.you ? '#c9b6ff' : '#ece9f5'};white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
                  ${_esc((p.you ? '★ ' : '') + p.name)}</div>
                <div style="font:600 10px var(--font-body);color:#8b829f;">${_esc(p.sub)}</div>
              </div>
              <div style="font:700 14px var(--font-display);color:${mc};flex:none;">#${p.rank}</div>
            </div>`;
          }).join('')}
        </div>
      </div>

      <!-- Ranking -->
      <div style="font:700 10px var(--font-display);letter-spacing:.22em;color:#5d5878;
        margin:2px 0 8px;flex:none;">CLASSEMENT FINAL · 8 DUELLISTES</div>
      <div style="display:flex;flex-direction:column;gap:5px;flex:1;min-height:0;overflow-y:auto;">
        ${ranking.map(r => {
          const col = _colorFor(r.name);
          const mc = _medalColor(r.rank);
          return `
          <div style="display:flex;align-items:center;gap:10px;padding:8px 12px;border-radius:11px;
            background:${r.you ? 'rgba(124,92,255,.13)' : 'rgba(20,15,32,.45)'};
            border:1px solid ${r.you ? 'rgba(167,139,250,.42)' : 'rgba(139,92,246,.1)'};">
            <span style="width:22px;flex:none;text-align:center;font:700 15px var(--font-display);color:${mc};">${r.rank}</span>
            <span style="width:8px;height:8px;border-radius:2px;flex:none;background:${col};box-shadow:0 0 8px -1px ${col};"></span>
            <span style="flex:1;min-width:0;font:${r.you ? 700 : 600} 13px var(--font-body);
              color:${r.you ? '#c9b6ff' : '#ece9f5'};white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
              ${_esc((r.you ? '★ ' : '') + r.name)}</span>
            <span style="font:600 10px var(--font-body);color:#6f6786;flex:none;">${_esc(r.sub)}</span>
            <span style="font:700 11px var(--font-display);color:${r.rank <= 3 ? '#9ec3ff' : '#5d5878'};
              flex:none;min-width:58px;text-align:right;">${prizeFor(r.rank)}</span>
          </div>`;
        }).join('')}
      </div>

      <div style="display:flex;gap:10px;flex:none;margin-top:12px;">
        <button class="ds-cta-secondary" id="btn-replay" style="width:140px;flex:none;"><span>REVANCHE</span></button>
        <button class="ds-cta" id="btn-menu" style="flex:1;"><span>MENU PRINCIPAL</span></button>
      </div>
    </div>
  `;

  container.querySelector('#btn-menu').addEventListener('click', () => {
    _tournament = null;
    navigate('main_menu');
  });
  container.querySelector('#btn-replay').addEventListener('click', async () => {
    const deckName = _tournament.playerDeckName;
    _tournament = null;
    _tournament = await Tournament.createTournament(deckName);
    const d = { attributeList: AttributeDatabase.getAllAttributes(), cardDb: CardDatabase };
    Tournament.resolveAiMatches(_tournament.rounds[0], d);
    _renderBracket(container, d);
  });
}

function _esc(str) {
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
