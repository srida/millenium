import { navigate } from '../../main.js';
import * as AuthClient from '../../data/AuthClient.js';
import * as DeckRepository from '../../data/DeckRepository.js';

let mode = 'login';
let gameVersion = null;

async function loadVersion() {
  if (gameVersion) return gameVersion;
  try {
    const res = await fetch('/api/version');
    if (res.ok) { const d = await res.json(); gameVersion = d.version; }
  } catch { /* ignore */ }
  return gameVersion;
}

export async function mount(container, params = {}) {
  if (params.mode === 'register' || params.mode === 'login') mode = params.mode;
  const version = await loadVersion();
  render(container, version);
}

export function unmount() {}

const EYE_OPEN = `<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/></svg>`;
const EYE_OFF  = `<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M17.9 17.9A10.4 10.4 0 0 1 12 19c-6.5 0-10-7-10-7a18 18 0 0 1 5.1-5.9m3.5-1.4A10.4 10.4 0 0 1 12 5c6.5 0 10 7 10 7a18 18 0 0 1-2.3 3.3"/><line x1="2" y1="2" x2="22" y2="22"/></svg>`;
const CHECK    = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`;

/* Positions as % of 660×760 reference (desktop hero) */
const DESKTOP_NODES = [
  { l:'48.8%', t:'38.9%', fs:40, main:true, delay:1.8, color:'var(--gold-100)', shadow:'0 0 18px rgba(203,168,90,.9),0 0 40px rgba(203,168,90,.5)' },
  { l:'29.7%', t:'21.8%', fs:17, delay:.5  },
  { l:'61.8%', t:'17.4%', fs:13, delay:1,   color:'rgba(189,157,240,.9)', shadow:'0 0 8px rgba(157,116,220,.7)' },
  { l:'71.5%', t:'40.3%', fs:15, delay:1.3  },
  { l:'22.7%', t:'48.9%', fs:12, delay:.15, glyph:'★' },
  { l:'64.8%', t:'59.5%', fs:14, delay:1.6, glyph:'★' },
  { l:'37.9%', t:'57.9%', fs:11, delay:1.45, color:'rgba(189,157,240,.9)' },
  { l:'14.5%', t:'29.5%', fs:9,  delay:1.9, tiny:true },
  { l:'77.6%', t:'25.8%', fs:8,  delay:2.1, tiny:true },
  { l:'84.2%', t:'66.8%', fs:8,  delay:2.3, tiny:true },
  { l:'17.9%', t:'74.7%', fs:7,  delay:2.4, tiny:true, color:'rgba(203,168,90,.55)' },
  { l:'9.1%',  t:'10.5%', fs:7,  delay:2.5, tiny:true },
  { l:'39.4%', t:'7.9%',  fs:6,  delay:2.6, tiny:true },
  { l:'90.9%', t:'13.2%', fs:7,  delay:2.7, tiny:true, color:'rgba(203,168,90,.5)' },
  { l:'10.6%', t:'57.9%', fs:6,  delay:2.8, tiny:true },
  { l:'89.4%', t:'73.7%', fs:7,  delay:2.9, tiny:true, color:'rgba(157,116,220,.55)' },
  { l:'45.5%', t:'78.9%', fs:6,  delay:3,   tiny:true },
  { l:'72.7%', t:'7.9%',  fs:6,  delay:3.1, tiny:true },
  { l:'6.1%',  t:'32.9%', fs:6,  delay:3.2, tiny:true, color:'rgba(203,168,90,.45)' },
];

/* Positions as % of 380×308 reference (mobile hero) */
const MOBILE_NODES = [
  { l:'53.7%', t:'44.8%', fs:28, main:true, delay:1.7, color:'var(--gold-100)', shadow:'0 0 14px rgba(203,168,90,.9),0 0 30px rgba(203,168,90,.5)' },
  { l:'31.1%', t:'31.2%', fs:13, delay:.4, color:'rgba(189,157,240,.9)', shadow:'0 0 7px rgba(157,116,220,.7)' },
  { l:'70.5%', t:'27.9%', fs:11, delay:.7  },
  { l:'12.6%', t:'54.5%', fs:11, delay:.1  },
  { l:'88.4%', t:'49.4%', fs:12, delay:1,  color:'rgba(157,116,220,.8)' },
  { l:'64.7%', t:'63.6%', fs:10, delay:1.3, glyph:'★' },
  { l:'37.4%', t:'64.9%', fs:9,  delay:1.9, glyph:'★' },
  { l:'6.3%',  t:'19.5%', fs:6,  delay:2.1, tiny:true },
  { l:'52.6%', t:'14.3%', fs:6,  delay:2.2, tiny:true, color:'rgba(203,168,90,.5)' },
  { l:'93.7%', t:'22.7%', fs:6,  delay:2.3, tiny:true },
  { l:'23.7%', t:'72.7%', fs:6,  delay:2.4, tiny:true, color:'rgba(157,116,220,.5)' },
  { l:'78.9%', t:'71.4%', fs:6,  delay:2.5, tiny:true },
];

function renderNodes(nodes) {
  return nodes.map(n => {
    const color = n.color || '#f2f0e8';
    const shadow = n.shadow || `0 0 ${n.main ? 0 : 7}px rgba(203,168,90,.6)`;
    const extraAnim = n.main
      ? `,sf-v2-star 3.6s ease-in-out ${n.delay + 0.5}s infinite`
      : '';
    const opacity = n.tiny ? 0.7 : 1;
    return `<span class="auth-v2-node" style="left:${n.l};top:${n.t};font-size:${n.fs}px;color:${color};text-shadow:${shadow};opacity:${opacity};animation-delay:${n.delay}s${extraAnim}">${n.glyph ?? '✦'}</span>`;
  }).join('');
}

function heroHTML() {
  return `
  <div class="auth-v2-hero" aria-hidden="true">
    <div class="auth-v2-nebula"></div>
    <div class="auth-v2-stars"></div>
    <div class="auth-v2-scanline"></div>
    <svg class="auth-v2-constellation" viewBox="0 0 660 760" preserveAspectRatio="none">
      <circle cx="322" cy="296" r="188" pathLength="1" fill="none" stroke="rgba(203,168,90,.13)" stroke-width="1" class="auth-v2-orbit" style="animation-delay:0s"></circle>
      <circle cx="322" cy="296" r="224" pathLength="1" fill="none" stroke="rgba(203,168,90,.06)" stroke-width="1" class="auth-v2-orbit" style="animation-delay:.15s"></circle>
      <polyline points="150,372 196,166 322,296 408,132 472,306 428,452" pathLength="1" fill="none" stroke="rgba(203,168,90,.4)" stroke-width="1" class="auth-v2-line" style="animation-delay:.3s;animation-duration:1.8s"></polyline>
      <line x1="322" y1="296" x2="250" y2="440" pathLength="1" stroke="rgba(157,116,220,.28)" stroke-width="1" class="auth-v2-line" style="animation-delay:1.7s"></line>
      <line x1="250" y1="440" x2="428" y2="452" pathLength="1" stroke="rgba(157,116,220,.24)" stroke-width="1" class="auth-v2-line" style="animation-delay:1.8s"></line>
      <line x1="196" y1="166" x2="96" y2="224" pathLength="1" stroke="rgba(157,116,220,.22)" stroke-width="1" class="auth-v2-line" style="animation-delay:1.9s"></line>
      <line x1="408" y1="132" x2="512" y2="196" pathLength="1" stroke="rgba(157,116,220,.2)" stroke-width="1" class="auth-v2-line" style="animation-delay:2s"></line>
    </svg>
    ${renderNodes(DESKTOP_NODES)}
    <div class="auth-v2-wordmark">
      <img src="/game/logo.png" alt="" class="auth-v2-emblem">
      <span class="auth-v2-wordmark-text">Soulforge</span>
    </div>
    <div class="auth-v2-tagline">
      <span class="auth-v2-tagline-eyebrow">La Forge des Âmes</span>
      <span class="auth-v2-tagline-title">Invoque.<br>Compose.<br>Domine l'arène.</span>
    </div>
    <div class="auth-v2-hero-sep"></div>
  </div>`;
}

function mobileHeroHTML() {
  return `
  <div class="auth-v2-mobile-hero" aria-hidden="true">
    <div class="auth-v2-nebula auth-v2-nebula--mob"></div>
    <div class="auth-v2-stars auth-v2-stars--mob"></div>
    <div class="auth-v2-scanline"></div>
    <svg class="auth-v2-constellation auth-v2-constellation--mob" viewBox="0 0 380 308" preserveAspectRatio="none">
      <ellipse cx="190" cy="146" rx="156" ry="78" pathLength="1" fill="none" stroke="rgba(203,168,90,.12)" stroke-width="1" class="auth-v2-orbit" style="animation-delay:0s"></ellipse>
      <polyline points="48,168 118,96 204,138 268,86 336,152 246,196" pathLength="1" fill="none" stroke="rgba(203,168,90,.4)" stroke-width="1" class="auth-v2-line" style="animation-delay:.2s;animation-duration:1.6s"></polyline>
      <line x1="204" y1="138" x2="142" y2="200" pathLength="1" stroke="rgba(157,116,220,.24)" stroke-width="1" class="auth-v2-line" style="animation-delay:1.6s"></line>
    </svg>
    ${renderNodes(MOBILE_NODES)}
    <div class="auth-v2-mobile-brand">
      <img src="/game/logo.png" alt="" class="auth-v2-emblem auth-v2-emblem--sm">
      <span class="auth-v2-wordmark-text auth-v2-wordmark-text--sm">Soulforge</span>
    </div>
    <div class="auth-v2-mobile-eyebrow">Invoque · Compose · Domine</div>
  </div>`;
}

function render(container, version) {
  const isLogin = mode === 'login';

  container.innerHTML = `
  <div class="auth-v2">
    ${heroHTML()}
    <div class="auth-v2-right">
      ${mobileHeroHTML()}
      <div class="auth-v2-panel-scroll">
        <div class="auth-v2-panel">
          <div class="auth-v2-panel-hairline"></div>
          <div class="auth-v2-panel-head">
            <span class="auth-v2-eyebrow">${isLogin ? 'Ta forge t\'attend' : 'Rejoins la forge'}</span>
            <span class="auth-v2-panel-title">${isLogin ? 'Entrer dans la Forge' : 'Forger un héros'}</span>
            <span class="auth-v2-panel-sub">${isLogin ? 'Reprends ta partie là où tu l\'as laissée.' : 'Crée ton compte et commence à jouer.'}</span>
          </div>
          <form class="auth-v2-form" id="auth-form" novalidate>
            ${isLogin ? `
            <div class="auth-v2-field">
              <span class="auth-v2-flabel">Identifiant</span>
              <input class="auth-v2-input" type="text" name="email" autocomplete="email" placeholder="Pseudo ou e-mail" required>
            </div>
            ` : `
            <div class="auth-v2-field">
              <span class="auth-v2-flabel">E-mail</span>
              <input class="auth-v2-input" type="email" name="email" autocomplete="email" placeholder="toi@exemple.com" required>
            </div>
            <div class="auth-v2-field">
              <span class="auth-v2-flabel">Pseudo</span>
              <input class="auth-v2-input" type="text" name="username" autocomplete="username" placeholder="3 à 20 caractères" required>
            </div>
            `}
            <div class="auth-v2-field">
              <div class="auth-v2-label-row">
                <span class="auth-v2-flabel">Mot de passe</span>
              </div>
              <div class="auth-v2-pw-wrap">
                <input class="auth-v2-input" type="password" name="password" id="auth-pw" autocomplete="${isLogin ? 'current-password' : 'new-password'}" placeholder="••••••••" required>
                <button type="button" class="auth-v2-eye" id="auth-eye" aria-label="Afficher le mot de passe">${EYE_OPEN}</button>
              </div>
            </div>
            ${isLogin ? `
            <div class="auth-v2-remember-row">
              <label class="auth-v2-remember">
                <span class="auth-v2-checkbox" id="remember-box" role="checkbox" aria-checked="false" tabindex="0"></span>
                <span class="auth-v2-remember-text">Se souvenir de moi</span>
              </label>
              <a href="#" class="auth-v2-forgot" id="auth-forgot-link">Mot de passe oublié ?</a>
            </div>
            ` : ''}
            <div class="auth-v2-error" id="auth-error" hidden></div>
            <button type="submit" class="auth-v2-cta" id="auth-submit">
              <span class="auth-v2-cta-halo" aria-hidden="true"></span>
              <span class="auth-v2-cta-sheen" aria-hidden="true"></span>
              <span class="auth-v2-cta-label">${isLogin ? 'Se connecter' : 'Forger mon héros'}</span>
            </button>
          </form>
          <div class="auth-v2-divider">
            <span class="auth-v2-divider-line"></span>
            <span class="auth-v2-divider-text">${isLogin ? 'Nouveau ici ?' : 'Déjà de retour ?'}</span>
            <span class="auth-v2-divider-line"></span>
          </div>
          <button type="button" class="auth-v2-ghost" id="switch-mode">${isLogin ? '✦  Forger un héros' : 'Se connecter'}</button>
          <div class="auth-v2-legal">En continuant, tu acceptes les <a href="#" class="auth-v2-legal-link">conditions</a> &amp; la <a href="#" class="auth-v2-legal-link">confidentialité</a>.</div>
        </div>
      </div>
    </div>
  </div>`;

  const form      = container.querySelector('#auth-form');
  const errBox    = container.querySelector('#auth-error');
  const submitBtn = container.querySelector('#auth-submit');
  const submitLbl = container.querySelector('.auth-v2-cta-label');
  const pwInput   = container.querySelector('#auth-pw');
  const eyeBtn    = container.querySelector('#auth-eye');

  // Password visibility toggle
  let showPw = false;
  eyeBtn?.addEventListener('click', () => {
    showPw = !showPw;
    pwInput.type = showPw ? 'text' : 'password';
    eyeBtn.innerHTML = showPw ? EYE_OFF : EYE_OPEN;
  });

  // Remember me checkbox
  let rememberMe = false;
  const rememberBox = container.querySelector('#remember-box');
  if (rememberBox) {
    const toggle = () => {
      rememberMe = !rememberMe;
      rememberBox.setAttribute('aria-checked', String(rememberMe));
      rememberBox.classList.toggle('auth-v2-checkbox--checked', rememberMe);
      rememberBox.innerHTML = rememberMe ? CHECK : '';
    };
    rememberBox.addEventListener('click', toggle);
    rememberBox.addEventListener('keydown', e => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); toggle(); } });
  }

  const goReset = () => navigate('resetpwd');
  container.querySelector('#auth-forgot-link')?.addEventListener('click', e => { e.preventDefault(); goReset(); });

  container.querySelector('#switch-mode')?.addEventListener('click', () => {
    mode = isLogin ? 'register' : 'login';
    render(container, version);
  });

  const showError  = msg => { errBox.textContent = msg; errBox.hidden = false; };
  const clearError = ()  => { errBox.hidden = true; };

  form.addEventListener('submit', async e => {
    e.preventDefault();
    clearError();
    const data = Object.fromEntries(new FormData(form));
    submitBtn.disabled = true;
    submitLbl.textContent = 'Un instant…';
    try {
      if (mode === 'login') {
        await AuthClient.login({ email: data.email, password: data.password, rememberMe });
      } else {
        await AuthClient.register({ email: data.email, username: data.username, password: data.password });
      }
      await DeckRepository.pull();
      navigate('main_menu');
    } catch (err) {
      showError(err.message || 'Une erreur est survenue.');
      const field = err.field && form.querySelector(`[name="${err.field}"]`);
      if (field) field.focus();
      submitBtn.disabled = false;
      submitLbl.textContent = isLogin ? 'Se connecter' : 'Forger mon héros';
    }
  });
}
