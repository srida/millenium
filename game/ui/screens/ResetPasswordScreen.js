import { navigate } from '../../main.js';

export async function mount(container, params = {}) {
  const token = params.token || new URLSearchParams(window.location.search).get('token') || '';
  if (token) {
    renderReset(container, token);
  } else {
    renderForgot(container);
  }
}

export function unmount() {}

function renderForgot(container) {
  container.innerHTML = `
    <div class="auth-new">
      <div class="auth-new-scanline" aria-hidden="true"></div>
      <div class="auth-new-brand">
        <img class="auth-new-logo" src="/game/logo.png" alt="Soulforge logo">
        <div class="auth-new-wordmark">SOULFORGE</div>
      </div>
      <div class="auth-new-panel">
        <div class="auth-new-panel-head">
          <div class="auth-new-panel-title">Mot de passe oublié</div>
          <div class="auth-new-panel-sub">Saisis ton e-mail pour recevoir un lien de réinitialisation.</div>
        </div>
        <form class="auth-new-form" id="forgot-form" novalidate>
          <label class="auth-new-field">
            <span class="auth-new-label">E-MAIL</span>
            <input class="auth-new-input" type="email" name="email" autocomplete="email" inputmode="email" placeholder="toi@exemple.com" required>
          </label>
          <div class="auth-new-error" id="forgot-error" hidden></div>
          <div class="auth-new-ok" id="forgot-ok" hidden>E-mail envoyé. Vérifie ta boîte de réception.</div>
          <button type="submit" class="auth-v2-cta" id="forgot-submit">
            <span class="auth-v2-cta-halo" aria-hidden="true"></span>
            <span class="auth-v2-cta-sheen" aria-hidden="true"></span>
            <span class="auth-v2-cta-label">Envoyer le lien</span>
          </button>
        </form>
        <div class="auth-new-footer">
          <button type="button" class="auth-v2-ghost" id="btn-back" style="margin-top:0">Retour à la connexion</button>
        </div>
      </div>
    </div>
  `;

  const form = container.querySelector('#forgot-form');
  const errBox = container.querySelector('#forgot-error');
  const okBox = container.querySelector('#forgot-ok');
  const submitBtn = container.querySelector('#forgot-submit');
  const submitLabel = container.querySelector('.auth-v2-cta-label');

  container.querySelector('#btn-back').addEventListener('click', () => navigate('auth'));

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errBox.hidden = true; okBox.hidden = true;
    const email = form.querySelector('[name="email"]').value.trim();
    submitBtn.disabled = true;
    submitLabel.textContent = 'Envoi…';
    try {
      const res = await fetch('/api/auth/forgot-password', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `Erreur ${res.status}`);
      okBox.hidden = false;
      submitBtn.disabled = true;
      submitLabel.textContent = 'ENVOYÉ';
    } catch (err) {
      errBox.textContent = err.message;
      errBox.hidden = false;
      submitBtn.disabled = false;
      submitLabel.textContent = 'ENVOYER LE LIEN';
    }
  });
}

function renderReset(container, token) {
  container.innerHTML = `
    <div class="auth-new">
      <div class="auth-new-scanline" aria-hidden="true"></div>
      <div class="auth-new-brand">
        <img class="auth-new-logo" src="/game/logo.png" alt="Soulforge logo">
        <div class="auth-new-wordmark">SOULFORGE</div>
      </div>
      <div class="auth-new-panel">
        <div class="auth-new-panel-head">
          <div class="auth-new-panel-title">Nouveau mot de passe</div>
          <div class="auth-new-panel-sub">Choisis un nouveau mot de passe pour ton compte.</div>
        </div>
        <form class="auth-new-form" id="reset-form" novalidate>
          <label class="auth-new-field">
            <span class="auth-new-label">NOUVEAU MOT DE PASSE</span>
            <input class="auth-new-input" type="password" name="password" autocomplete="new-password" placeholder="••••••••" required>
            <span class="auth-new-hint">8 caractères minimum.</span>
          </label>
          <div class="auth-new-error" id="reset-error" hidden></div>
          <button type="submit" class="auth-v2-cta" id="reset-submit">
            <span class="auth-v2-cta-halo" aria-hidden="true"></span>
            <span class="auth-v2-cta-sheen" aria-hidden="true"></span>
            <span class="auth-v2-cta-label">Réinitialiser</span>
          </button>
        </form>
        <div class="auth-new-footer">
          <button type="button" class="auth-v2-ghost" id="btn-back" style="margin-top:0">Retour à la connexion</button>
        </div>
      </div>
    </div>
  `;

  const form = container.querySelector('#reset-form');
  const errBox = container.querySelector('#reset-error');
  const submitBtn = container.querySelector('#reset-submit');
  const submitLabel = container.querySelector('.auth-v2-cta-label');

  container.querySelector('#btn-back').addEventListener('click', () => navigate('auth'));

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errBox.hidden = true;
    const password = form.querySelector('[name="password"]').value;
    submitBtn.disabled = true;
    submitLabel.textContent = 'Un instant…';
    try {
      const res = await fetch('/api/auth/reset-password', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `Erreur ${res.status}`);
      navigate('auth', { mode: 'login' });
    } catch (err) {
      errBox.textContent = err.message;
      errBox.hidden = false;
      submitBtn.disabled = false;
      submitLabel.textContent = 'RÉINITIALISER';
    }
  });
}
