// Port de game/ui/components/UnitCard.js — fabrique DOM des cartes unités
// affichées via CSS3DRenderer. Ce module vit dans three/ (présentation de la
// scène), pas dans components/ React : il manipule le DOM impérativement.
import type { Unit } from '../logic/Unit.js';
// `data/CardArt` n'importe rien : la couche de rendu y gagne la résolution des
// variantes sans traîner de dépendance (les garde-fous ESLint n'interdisent à
// three/ que React et Zustand).
import { artFor, illustrationUrl } from '../data/CardArt.js';

const TIER_CFG: Record<number, { edge: string; deep: string; ink: string; glow: string; art: string }> = {
  1: { edge: '#5ad0a0', deep: '#0e2b20', ink: '#93ecc6', glow: 'rgba(90,208,160,.5)',   art: 'linear-gradient(155deg,#123528,#06110d)' },
  2: { edge: '#6fb2dc', deep: '#0d2333', ink: '#a9d6f2', glow: 'rgba(111,178,220,.5)',  art: 'linear-gradient(155deg,#122a3f,#060f18)' },
  3: { edge: '#9d74dc', deep: '#1c1038', ink: '#d6bdf6', glow: 'rgba(157,116,220,.55)', art: 'linear-gradient(155deg,#241442,#0c0820)' },
  4: { edge: '#cba85a', deep: '#2c2109', ink: '#ecd7a2', glow: 'rgba(203,168,90,.55)',  art: 'linear-gradient(155deg,#3a2c12,#140f06)' },
  5: { edge: '#d86a7e', deep: '#2f1119', ink: '#f5b3bf', glow: 'rgba(216,106,126,.52)', art: 'linear-gradient(155deg,#3a1420,#140609)' },
};

const EFFECT_CFG: Record<string, { bg: string; edge: string; glow: string; ink: string }> = {
  shield:      { bg: 'rgba(40,30,8,.72)',  edge: 'rgba(240,196,90,.85)',  glow: 'rgba(232,168,80,.65)',  ink: '#f6da82' },
  burn:        { bg: 'rgba(42,14,6,.72)',  edge: 'rgba(255,110,55,.85)',  glow: 'rgba(255,90,40,.65)',   ink: '#ff8a4a' },
  paralysis:   { bg: 'rgba(38,34,6,.72)',  edge: 'rgba(245,210,40,.85)',  glow: 'rgba(240,200,40,.65)',  ink: '#ffe066' },
  poison:      { bg: 'rgba(10,34,8,.72)',  edge: 'rgba(110,220,80,.85)',  glow: 'rgba(100,210,70,.65)',  ink: '#9de87a' },
  confusion:   { bg: 'rgba(28,10,42,.72)', edge: 'rgba(190,100,250,.85)', glow: 'rgba(180,90,240,.65)', ink: '#d08aff' },
  provocation: { bg: 'rgba(42,12,6,.72)',  edge: 'rgba(255,88,55,.85)',   glow: 'rgba(240,72,42,.65)',   ink: '#ff8068' },
  malus:       { bg: 'rgba(40,12,18,.7)',  edge: 'rgba(232,90,110,.85)',  glow: 'rgba(232,90,110,.6)',   ink: '#ff8a9c' },
};

export function createUnitEl(unit: Unit, { selected = false, materialSelected = false } = {}): HTMLDivElement {
  const tier = unit.tier ?? 2;
  const t = TIER_CFG[tier] ?? TIER_CFG[2];

  const el = document.createElement('div');
  el.className = 'unit-card'
    + ` unit-${unit.side}`
    + (selected ? ' selected' : '')
    + (materialSelected ? ' material-selected' : '')
    + (unit.is_neutralized ? ' neutralized' : '');
  el.dataset.uid = String(unit.uid);

  el.style.setProperty('--uc-edge', t.edge);
  el.style.setProperty('--uc-deep', t.deep);
  el.style.setProperty('--uc-ink',  t.ink);
  el.style.setProperty('--uc-glow', t.glow);
  el.style.setProperty('--uc-art',  t.art);

  el.innerHTML = _inner(unit);
  _updateMedallion(el, unit);
  _updateVet(el, unit);
  _updateMaterialValue(el, unit);
  return el;
}

export function updateUnitEl(el: HTMLElement, unit: Unit): void {
  el.classList.toggle('neutralized', unit.is_neutralized);

  const hpPct = unit.max_hp > 0 ? Math.round((unit.current_hp / unit.max_hp) * 100) : 0;
  const hpFill = el.querySelector<HTMLElement>('.unit-hp-fill');
  if (hpFill) hpFill.style.width = hpPct + '%';

  const pwrPct = unit.power_id
    ? Math.min(100, Math.round((unit.power_gauge / unit.power_speed) * 100))
    : 0;
  const pwrFill = el.querySelector<HTMLElement>('.unit-pwr-fill');
  if (pwrFill) pwrFill.style.width = pwrPct + '%';

  // ⚠️ La barre est TOUJOURS dans le balisage, et c'est sa visibilité qui suit
  // l'unité — pas sa présence. `_inner` ne s'exécute qu'au spawn : une unité
  // née sans pouvoir n'avait aucun élément à remplir, et la magie `grant_power`
  // lui en posait un que la carte 3D ne pouvait plus montrer (le tooltip, lui,
  // est rendu par React à chaque ouverture, d'où l'asymétrie constatée).
  const pwrBar = el.querySelector<HTMLElement>('.unit-pwr-bar');
  if (pwrBar) pwrBar.style.display = unit.power_id ? '' : 'none';

  _updateMedallion(el, unit);
  _updateVet(el, unit);
  _updateMaterialValue(el, unit);
}

function _inner(unit: Unit): string {
  const hpPct = unit.max_hp > 0 ? Math.round((unit.current_hp / unit.max_hp) * 100) : 0;
  const pwrPct = unit.power_id
    ? Math.min(100, Math.round((unit.power_gauge / unit.power_speed) * 100))
    : 0;

  // Toujours émise, masquée tant que l'unité n'a pas de pouvoir : c'est
  // `updateUnitEl` qui la révèle si une magie lui en donne un en cours de
  // partie. `display: none` plutôt que l'attribut `hidden` — la règle
  // `.unit-pwr-bar` ne pose pas de `display`, mais dépendre de la feuille de
  // l'agent utilisateur pour un élément de jeu ne vaut pas l'économie.
  const pwrBar = `<div class="unit-pwr-bar" style="display:${unit.power_id ? '' : 'none'}"><div class="unit-pwr-fill" style="width:${pwrPct}%"></div></div>`;

  return `
    <div class="unit-face">
      <img class="unit-art" src="${illustrationUrl(artFor(unit.card_id, unit.side))}" alt="${esc(unit.name)}">
      <div class="unit-foil-stars"></div>
      <div class="unit-foil-nebula"></div>
      <div class="unit-top-edge"></div>
      <div class="unit-bottom-scrim"></div>

      <div class="unit-bars">
        <div class="unit-team-hex-wrap">
          <div class="unit-team-hex"><div class="unit-team-hex-inner"></div></div>
        </div>
        <div class="unit-bars-stack">
          ${pwrBar}
          <div class="unit-hp-bar"><div class="unit-hp-fill" style="width:${hpPct}%"></div></div>
        </div>
      </div>
    </div>
    <div class="unit-vet-badge" style="display:none"></div>
    <div class="unit-medallion" style="display:none"></div>
    <div class="unit-mat-badge" style="display:none"></div>
  `.trim();
}

function _primaryBuff(unit: Unit): string | null {
  if ((unit.shield ?? 0) > 0)              return 'shield';
  if (unit.burn_stacks?.length > 0)        return 'burn';
  if (unit.dot_effects?.length > 0)        return 'poison';
  if ((unit.paralysis_remaining ?? 0) > 0) return 'paralysis';
  if ((unit.confusion_remaining ?? 0) > 0) return 'confusion';
  if ((unit.taunt_remaining ?? 0) > 0)     return 'provocation';
  if (unit.is_power_blocked)               return 'malus';
  return null;
}

function _effectIconSvg(effect: string, ink: string): string {
  const base = `width="62%" height="62%" viewBox="0 0 24 24" fill="none" stroke="${ink}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"`;
  switch (effect) {
    case 'shield':
      return `<svg ${base}><path d="M12 3L4 6.5v5.5c0 5 3.5 8.5 8 10 4.5-1.5 8-5 8-10V6.5L12 3z"/></svg>`;
    case 'burn':
      return `<svg ${base}><path d="M12 2c0 4-4 5.5-4 9.5a4 4 0 008 0C16 7.5 12 2 12 2z"/><path d="M10.5 15c.8-1.5 1.5-2.5 1.5-4.5" stroke-width="1.5"/></svg>`;
    case 'paralysis':
      return `<svg ${base}><path d="M13 2L5 13h6l-2 9 10-11h-6L13 2z"/></svg>`;
    case 'poison':
      return `<svg ${base}><path d="M12 3C12 3 6 10 6 15a6 6 0 0012 0C18 10 12 3 12 3z"/><circle cx="9.5" cy="15.5" r="1.2" fill="${ink}" stroke="none"/><circle cx="14.5" cy="15.5" r="1.2" fill="${ink}" stroke="none"/></svg>`;
    case 'confusion':
      return `<svg ${base}><path d="M9.5 9a2.5 2.5 0 015 0c0 2-2.5 3-2.5 5"/><circle cx="12" cy="18" r="1.3" fill="${ink}" stroke="none"/></svg>`;
    case 'provocation':
      return `<svg ${base}><circle cx="12" cy="12" r="8"/><line x1="12" y1="8" x2="12" y2="13"/><circle cx="12" cy="16.5" r="1.3" fill="${ink}" stroke="none"/></svg>`;
    default:
      return `<svg ${base}><path d="M5 11.5l7 6 7-6"/><path d="M5 6l7 6 7-6"/></svg>`;
  }
}

function _updateMedallion(el: HTMLElement, unit: Unit): void {
  const medallion = el.querySelector<HTMLElement>('.unit-medallion');
  if (!medallion) return;

  const buff = _primaryBuff(unit);
  if (!buff) { medallion.style.display = 'none'; return; }

  const spec = EFFECT_CFG[buff] ?? EFFECT_CFG.malus;
  const shieldVal = buff === 'shield' ? (unit.shield ?? 0) : 0;
  const valHtml = (buff === 'shield' && shieldVal > 0)
    ? `<span class="unit-medallion-val">${Math.round(shieldVal)}</span>`
    : '';

  medallion.style.cssText = [
    `display:flex`,
    `background:${spec.bg}`,
    `border-color:${spec.edge}`,
    `box-shadow:0 0 10px -2px ${spec.glow}`,
  ].join(';');
  medallion.innerHTML = `<div class="unit-medallion-inner">${_effectIconSvg(buff, spec.ink)}${valHtml}</div>`;
}

/**
 * Ce que l'unité VAUT comme matériau, en un chiffre.
 *
 * ⚠️ Rien quand elle vaut 1 : c'est le défaut de toute carte, et une pastille
 * sur chaque unité du plateau ne distinguerait plus rien. Le joueur ne pouvait
 * pas savoir ce qu'une unité valait avant de TENTER l'invocation — c'est
 * précisément ce que ce chiffre répond.
 *
 * ⚠️ Le glyphe est celui du COÛT en main (`CardTile`) : c'est la même monnaie —
 * là un prix, ici une valeur. Le tooltip lève l'ambiguïté en toutes lettres.
 */
function _updateMaterialValue(el: HTMLElement, unit: Unit): void {
  const badge = el.querySelector<HTMLElement>('.unit-mat-badge');
  if (!badge) return;
  const value = unit.material_value ?? 1;
  if (value <= 1) { badge.style.display = 'none'; return; }
  badge.style.display = 'flex';
  badge.textContent = `◈${Math.round(value)}`;
}

function _updateVet(el: HTMLElement, unit: Unit): void {
  const vet = el.querySelector<HTMLElement>('.unit-vet-badge');
  if (!vet) return;
  const pts = unit.veterancy_points ?? 0;
  if (pts >= 2) {
    vet.style.display = 'flex';
    vet.innerHTML = `<svg width="52%" height="52%" viewBox="0 0 24 24" fill="none" stroke="#ddc178" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l2.4 5.6 6.1.5-4.6 4 1.4 6-5.3-3.3-5.3 3.3 1.4-6-4.6-4 6.1-.5L12 3z"/></svg><span class="unit-vet-count">${Math.round(pts)}</span>`;
  } else {
    vet.style.display = 'none';
  }
}

function esc(s: unknown): string {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
