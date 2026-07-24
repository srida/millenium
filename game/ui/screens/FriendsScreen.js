import { navigate } from '../../main.js';
import * as AuthClient from '../../data/AuthClient.js';

const BACK_SVG = `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M10 3L5 8l5 5"/></svg>`;

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function avatarGlyph(u) {
  return u.avatar || (u.username ? u.username[0].toUpperCase() : '?');
}
function displayName(u) {
  return u.tag ? `${u.username}#${u.tag}` : u.username;
}
function personRow(u, actionsHtml) {
  return `
    <div class="friend-row">
      <div class="friend-avatar">${esc(avatarGlyph(u))}</div>
      <div class="friend-name">${esc(displayName(u))}</div>
      <div class="friend-actions">${actionsHtml}</div>
    </div>`;
}

export async function mount(container, params = {}) {
  let user = AuthClient.getUser();
  if (!user) { try { user = await AuthClient.me(); } catch { /* offline */ } }
  if (!user) { navigate('auth'); return; }

  container.innerHTML = `
    <div class="topbar">
      <button class="topbar-back" id="btn-back">${BACK_SVG}</button>
      <span class="topbar-title">MES AMIS</span>
      <span style="width:var(--touch-target)"></span>
    </div>
    <div class="friends-screen">
      <div class="friends-search">
        <input class="auth-input" id="friend-search" type="text" placeholder="Ajouter un ami par pseudo…" autocomplete="off">
        <div class="friend-search-results" id="search-results"></div>
      </div>
      <div class="friends-feedback" id="friends-feedback" hidden></div>
      <div id="requests-section"></div>
      <div class="friends-list-section">
        <div class="profile-section-title">Amis</div>
        <div id="friends-list"><div class="friends-empty">Chargement…</div></div>
      </div>
    </div>
  `;

  const screenRoot = container.querySelector('.friends-screen');
  const searchInput = container.querySelector('#friend-search');
  const resultsBox = container.querySelector('#search-results');
  const feedback = container.querySelector('#friends-feedback');
  const requestsSection = container.querySelector('#requests-section');
  const friendsList = container.querySelector('#friends-list');

  function flash(msg, ok = true) {
    feedback.textContent = msg;
    feedback.className = `friends-feedback ${ok ? 'is-ok' : 'is-err'}`;
    feedback.hidden = false;
    setTimeout(() => { feedback.hidden = true; }, 2600);
  }

  async function refresh() {
    const [friends, requests] = await Promise.all([
      AuthClient.getFriends(),
      AuthClient.getRequests(),
    ]);

    const { incoming, outgoing } = requests;
    let reqHtml = '';
    if (incoming.length) {
      reqHtml += `<div class="profile-section-title">Demandes reçues</div>` +
        incoming.map(u => personRow(u, `
          <button class="friend-btn is-accept" data-accept="${u.friendship_id}">Accepter</button>
          <button class="friend-btn is-decline" data-decline="${u.friendship_id}">Refuser</button>`)).join('');
    }
    if (outgoing.length) {
      reqHtml += `<div class="profile-section-title">Demandes envoyées</div>` +
        outgoing.map(u => personRow(u, `
          <button class="friend-btn is-cancel" data-cancel="${u.friendship_id}">Annuler</button>`)).join('');
    }
    requestsSection.innerHTML = reqHtml;

    friendsList.innerHTML = friends.length
      ? friends.map(u => personRow(u, `<button class="friend-btn is-remove" data-remove="${u.friendship_id}">Retirer</button>`)).join('')
      : `<div class="friends-empty">Aucun ami pour l'instant. Cherche un pseudo ci-dessus.</div>`;
  }

  let searchTimer = null;
  searchInput.addEventListener('input', () => {
    clearTimeout(searchTimer);
    const q = searchInput.value.trim();
    if (q.length < 2) { resultsBox.innerHTML = ''; return; }
    searchTimer = setTimeout(async () => {
      try {
        const users = await AuthClient.searchUsers(q);
        resultsBox.innerHTML = users.length
          ? users.map(u => {
              let action;
              if (u.relation === 'friends') action = `<span class="friend-tag">Ami</span>`;
              else if (u.relation === 'outgoing') action = `<span class="friend-tag">Envoyée</span>`;
              else if (u.relation === 'incoming') action = `<button class="friend-btn is-accept" data-add-id="${u.id}">Accepter</button>`;
              else action = `<button class="friend-btn is-add" data-add-id="${u.id}">Ajouter</button>`;
              return personRow(u, action);
            }).join('')
          : `<div class="friends-empty">Aucun joueur trouvé.</div>`;
      } catch (err) { flash(err.message, false); }
    }, 250);
  });

  screenRoot.addEventListener('click', async (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    try {
      if (btn.dataset.addId) {
        await AuthClient.sendRequest(btn.dataset.addId);
        flash('Demande envoyée.');
        searchInput.value = ''; resultsBox.innerHTML = '';
        await refresh();
      } else if (btn.dataset.accept) {
        await AuthClient.acceptRequest(btn.dataset.accept); await refresh();
      } else if (btn.dataset.decline) {
        await AuthClient.declineRequest(btn.dataset.decline); await refresh();
      } else if (btn.dataset.cancel) {
        await AuthClient.removeFriend(btn.dataset.cancel); await refresh();
      } else if (btn.dataset.remove) {
        await AuthClient.removeFriend(btn.dataset.remove); await refresh();
      }
    } catch (err) { flash(err.message, false); }
  });

  container.querySelector('#btn-back').addEventListener('click', () => navigate('main_menu'));

  refresh().catch(err => { friendsList.innerHTML = `<div class="friends-empty">${esc(err.message)}</div>`; });
}
