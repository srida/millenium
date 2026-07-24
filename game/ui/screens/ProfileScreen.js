import { navigate } from '../../main.js';
import * as AuthClient from '../../data/AuthClient.js';
import * as DeckRepository from '../../data/DeckRepository.js';

const BACK_SVG = `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M10 3L5 8l5 5"/></svg>`;
const AVATARS = ['🜁', '🜂', '🜃', '🜄', '⚔️', '🛡️', '🔮', '🐉', '🦅', '💀', '🌙', '⭐'];

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function avatarGlyph(user) {
  return user.avatar || (user.username ? user.username[0].toUpperCase() : '?');
}

export async function mount(container, params = {}) {
  // S'assure d'un user courant frais.
  let user = AuthClient.getUser();
  if (!user) {
    try { user = await AuthClient.me(); } catch { /* offline */ }
  }
  if (!user) { navigate('auth'); return; }

  let selectedAvatar = user.avatar || null;

  function render() {
    container.innerHTML = `
      <div class="topbar">
        <button class="topbar-back" id="btn-back">${BACK_SVG}</button>
        <span class="topbar-title">MON PROFIL</span>
        <span style="width:var(--touch-target)"></span>
      </div>
      <div class="profile-screen">
        <div class="profile-hero">
          <div class="profile-avatar">${esc(avatarGlyph(user))}</div>
          <div class="profile-name">${esc(user.username)}${user.tag ? '<span class="profile-tag">#' + esc(user.tag) + '</span>' : ''}</div>
          <div class="profile-email">${esc(user.email)}</div>
        </div>

        <button class="btn btn-secondary btn-full profile-friends-btn" id="btn-friends">👥 Mes amis</button>

        <form class="profile-edit" id="profile-form">
          <div class="profile-section-title">Modifier mon profil</div>

          <label class="auth-field">
            <span class="auth-label">Pseudo</span>
            <input class="auth-input" type="text" name="username" value="${esc(user.username)}" autocomplete="username">
          </label>

          <div class="auth-field">
            <span class="auth-label">Avatar</span>
            <div class="avatar-picker" id="avatar-picker">
              ${AVATARS.map(a => `<button type="button" class="avatar-option ${a === selectedAvatar ? 'selected' : ''}" data-avatar="${a}">${a}</button>`).join('')}
            </div>
          </div>

          <div class="auth-error" id="profile-error" hidden></div>
          <div class="profile-ok" id="profile-ok" hidden>Profil mis à jour ✓</div>

          <button type="submit" class="btn btn-primary btn-full" id="btn-save">Enregistrer</button>
        </form>

        <button class="btn btn-danger btn-full profile-logout" id="btn-logout">Se déconnecter</button>
      </div>
    `;

    const form = container.querySelector('#profile-form');
    const errBox = container.querySelector('#profile-error');
    const okBox = container.querySelector('#profile-ok');

    container.querySelector('#btn-back').addEventListener('click', () => navigate('main_menu'));
    container.querySelector('#btn-friends').addEventListener('click', () => navigate('friends'));

    container.querySelectorAll('.avatar-option').forEach(opt => {
      opt.addEventListener('click', () => {
        selectedAvatar = opt.dataset.avatar === selectedAvatar ? null : opt.dataset.avatar;
        container.querySelectorAll('.avatar-option').forEach(o =>
          o.classList.toggle('selected', o.dataset.avatar === selectedAvatar));
      });
    });

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      errBox.hidden = true; okBox.hidden = true;
      const username = form.querySelector('[name="username"]').value.trim();
      const saveBtn = container.querySelector('#btn-save');
      saveBtn.disabled = true;
      try {
        user = await AuthClient.updateProfile({ username, avatar: selectedAvatar });
        okBox.hidden = false;
        render();
      } catch (err) {
        errBox.textContent = err.message || 'Impossible de mettre à jour le profil.';
        errBox.hidden = false;
        saveBtn.disabled = false;
      }
    });

    container.querySelector('#btn-logout').addEventListener('click', async () => {
      // Flush avant de couper la session, puis nettoie le cache local.
      try { await DeckRepository.flushSync(); } catch { /* ignore */ }
      try { await AuthClient.logout(); } catch { /* ignore */ }
      DeckRepository.handleLogout();
      navigate('auth'); // connexion obligatoire → retour au login
    });
  }

  render();
}
