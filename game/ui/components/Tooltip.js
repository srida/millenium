import { STAT_NAMES } from '../../logic/MagieEffect.js';
import { VETERANCY_THRESHOLD, VETERANCY_ATK_PER_POINT, VETERANCY_HP_PER_POINT } from '../../logic/AttributeManager.js';

let _el = null;

function _ensure() {
  if (_el) return;
  _el = document.createElement('div');
  _el.className = 'tooltip-popup';
  _el.hidden = true;
  document.body.appendChild(_el);
  document.addEventListener('pointerdown', e => {
    if (_el && !_el.hidden && !_el.contains(e.target)) _el.hidden = true;
  }, { capture: true });
}

export function show(html, anchorEl) {
  _ensure();
  _el.innerHTML = html;
  _el.hidden = false;
  _reposition(anchorEl);
}

export function showAtRect(html, rect) {
  _ensure();
  _el.innerHTML = html;
  _el.hidden = false;
  _repositionFromRect(rect);
}

export function hide() {
  if (_el) _el.hidden = true;
}

export function toggle(html, anchorEl) {
  _ensure();
  if (!_el.hidden) { hide(); return; }
  show(html, anchorEl);
}

function _reposition(anchor) {
  if (!anchor) return;
  _repositionFromRect(anchor.getBoundingClientRect());
}

function _repositionFromRect(r) {
  _el.style.width = '';
  const vw = window.innerWidth;
  const W = _el.offsetWidth || 260;
  let left = r.left + r.width / 2 - W / 2;
  left = Math.max(8, Math.min(left, vw - W - 8));
  _el.style.left = left + 'px';
  const h = _el.offsetHeight || 200;
  const top = r.top - h - 8 > 0 ? r.top - h - 8 : r.bottom + 8;
  _el.style.top = top + 'px';
}

// ── Tier config ──────────────────────────────────────────────────────────────
const TIER_CFG = {
  1: { edge:'#46d39a', ink:'#7ef0c0', glow:'rgba(70,211,154,.55)',  art:'linear-gradient(155deg,#1f4a3a,#0e231d)' },
  2: { edge:'#5fb4e8', ink:'#9ad2f6', glow:'rgba(95,180,232,.55)',  art:'linear-gradient(155deg,#1f3a52,#0e1d2c)' },
  3: { edge:'#a78bfa', ink:'#cdbcff', glow:'rgba(167,139,250,.55)', art:'linear-gradient(155deg,#352663,#181230)' },
  4: { edge:'#e8a850', ink:'#f0c48a', glow:'rgba(232,168,80,.55)',  art:'linear-gradient(155deg,#5a3f1c,#2c1d0d)' },
  5: { edge:'#e85a6e', ink:'#f5a0ad', glow:'rgba(232,90,110,.55)',  art:'linear-gradient(155deg,#5a1f2c,#2c0e15)' },
};
const TIER_INKS = { 1:'#7ef0c0', 2:'#9ad2f6', 3:'#cdbcff', 4:'#f0c48a', 5:'#f5a0ad' };
function _t(tier) { return TIER_CFG[tier] || TIER_CFG[3]; }

const SUMMON_LABELS = {
  normal: 'NORMAL', sacrifice: 'SACRIFICE', fusion: 'FUSION',
  heritage: 'HERITAGE', transformation: 'TRANSFO',
};

// ── SVG icons ─────────────────────────────────────────────────────────────────
const ATK_ICON = `<svg width="9" height="9" viewBox="0 0 10 10" fill="#e8a850"><polygon points="5,0 6.5,3.5 10,4 7.5,6.5 8,10 5,8 2,10 2.5,6.5 0,4 3.5,3.5"/></svg>`;
const HP_ICON  = `<svg width="9" height="9" viewBox="0 0 12 11"><path d="M6 10.5C6 10.5 1 6.8 1 3.8a3 3 0 015-2.2A3 3 0 0111 3.8c0 3-5 6.7-5 6.7z" fill="#e8546e"/></svg>`;
const VIT_ICON = `<svg width="9" height="9" viewBox="0 0 14 14" fill="none" stroke="#5fd6e8" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M7 1l2 4h4l-3.5 2.5 1.5 4.5L7 9.5 3 12l1.5-4.5L1 5h4z"/></svg>`;
const POR_ICON = `<svg width="10" height="9" viewBox="0 0 14 10" fill="none" stroke="#a78bfa" stroke-width="1.8" stroke-linecap="round"><path d="M2 5h10M1 5l3-3M1 5l3 3M13 5l-3-3M13 5l-3 3"/></svg>`;
const DEP_ICON = `<svg width="9" height="9" viewBox="0 0 12 14" fill="none" stroke="#46d39a" stroke-width="1.8" stroke-linecap="round"><path d="M6 1v10M3 8l3 3 3-3"/><path d="M3 3l3-2 3 2" opacity=".5"/></svg>`;

// ── Low-level builders ────────────────────────────────────────────────────────
function _statCell(label, icon, value, color, last = false) {
  const border = last ? '' : 'border-right:1px solid rgba(255,255,255,.06);';
  return `<div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:2px;padding:7px 4px;${border}">
    <span style="font:600 8px 'Chakra Petch';letter-spacing:.14em;color:#5d5878;">${label}</span>
    <div style="display:flex;align-items:center;gap:3px;">${icon}<span style="font:700 13px 'Chakra Petch';color:${color};">${value}</span></div>
  </div>`;
}

function _statsRow(atq, pv, vit, por, dep) {
  return `<div style="display:flex;align-items:center;gap:0;border-radius:10px;background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.06);overflow:hidden;">
    ${_statCell('ATQ', ATK_ICON, atq, '#f0c87a')}
    ${_statCell('PV',  HP_ICON,  pv,  '#f08296')}
    ${_statCell('VIT', VIT_ICON, vit, '#9de8f0')}
    ${_statCell('POR', POR_ICON, por, '#cdbcff')}
    ${_statCell('DEP', DEP_ICON, dep, '#7fe6b6', true)}
  </div>`;
}

function _keywordsRow(names) {
  if (!names.length) return '';
  return `<div style="display:flex;flex-wrap:wrap;gap:5px;">${names.map(n =>
    `<div style="padding:3px 9px;border-radius:6px;background:rgba(139,92,246,.1);border:1px solid rgba(139,92,246,.25);">
      <span style="font:600 10px 'Chakra Petch';letter-spacing:.04em;color:#b8acda;">${esc(n)}</span>
    </div>`
  ).join('')}</div>`;
}

function _abilityBlock(name, desc, color = '#e8946e', bg = 'rgba(255,140,60,.07)', border = 'rgba(255,140,60,.25)') {
  return `<div style="padding:9px 11px;border-radius:10px;background:${bg};border:1px solid ${border};display:flex;flex-direction:column;gap:4px;">
    <div style="display:flex;align-items:center;gap:6px;">
      <svg width="12" height="12" viewBox="0 0 14 14" fill="none" stroke="${color}" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="7" cy="7" r="5.5"/><line x1="7" y1="5" x2="7" y2="7.5"/><circle cx="7" cy="9.5" r=".8" fill="${color}" stroke="none"/></svg>
      <span style="font:700 11px 'Chakra Petch';letter-spacing:.08em;color:${color};">${esc(name)}</span>
    </div>
    ${desc ? `<span style="font:500 10px 'Manrope';color:#c4a888;line-height:1.45;">${esc(desc)}</span>` : ''}
  </div>`;
}

function _materialsBlock(label, mats) {
  if (!mats.length) return '';
  const pills = mats.map(m =>
    `<div style="display:flex;align-items:center;gap:5px;padding:3px 8px;border-radius:6px;background:rgba(232,178,90,.08);border:1px solid rgba(232,178,90,.22);">
      <span style="width:6px;height:6px;border-radius:50%;background:${m.color};box-shadow:0 0 5px ${m.color};display:inline-block;flex:none;"></span>
      <span style="font:600 10px 'Manrope';color:#c8a860;">${esc(m.name)}</span>
    </div>`
  ).join('');
  return `<div style="display:flex;flex-direction:column;gap:5px;">
    <div style="display:flex;align-items:center;gap:5px;">
      <svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="#e8b25a" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M6 1l1.5 3.5L11 5l-2.5 2.5.5 3.5L6 9.5 3 11l.5-3.5L1 5l3.5-.5z"/></svg>
      <span style="font:700 9px 'Chakra Petch';letter-spacing:.16em;color:#8b6e3a;">${esc(label)}</span>
    </div>
    <div style="display:flex;flex-wrap:wrap;gap:5px;">${pills}</div>
  </div>`;
}

function _infoRow(text, color = '#8b829f') {
  return `<div style="font:600 10px 'Manrope';color:${color};line-height:1.5;">${text}</div>`;
}

function _tooltipCard(t, artHtml, typeLabel, tierLabel, bodyHtml) {
  return `<div style="position:relative;width:260px;border-radius:16px;background:linear-gradient(160deg,rgba(22,17,36,.97),rgba(12,9,22,.98));border:1px solid ${t.edge};box-shadow:0 0 0 1px rgba(255,255,255,.04),0 24px 48px -12px rgba(0,0,0,.8),0 0 28px -8px ${t.glow};overflow:hidden;backdrop-filter:blur(12px);">
    <div style="position:absolute;top:0;left:0;right:0;height:2px;background:linear-gradient(90deg,transparent 5%,${t.edge} 40%,${t.ink} 50%,${t.edge} 60%,transparent 95%);opacity:.8;"></div>
    <div style="position:relative;height:80px;background:${t.art};overflow:hidden;display:flex;align-items:center;justify-content:center;">
      ${artHtml}
      <div style="position:absolute;left:0;right:0;bottom:0;height:50%;background:linear-gradient(transparent,rgba(12,9,22,.97));"></div>
      <div style="position:absolute;top:8px;right:10px;padding:3px 9px;border-radius:7px;background:rgba(10,8,18,.7);border:1px solid ${t.edge};backdrop-filter:blur(4px);box-shadow:0 0 10px -3px ${t.glow};">
        <span style="font:700 12px 'Chakra Petch';letter-spacing:.04em;color:${t.ink};">${tierLabel}</span>
      </div>
      <div style="position:absolute;bottom:8px;left:10px;padding:2px 8px;border-radius:6px;background:rgba(10,8,18,.6);border:1px solid rgba(255,255,255,.1);">
        <span style="font:600 9px 'Chakra Petch';letter-spacing:.14em;color:#8b829f;">${typeLabel}</span>
      </div>
    </div>
    <div style="padding:12px 14px 14px;display:flex;flex-direction:column;gap:10px;">
      ${bodyHtml}
    </div>
    <div style="height:1px;background:linear-gradient(90deg,transparent,${t.edge},transparent);opacity:.3;"></div>
  </div>`;
}

// Simple dark panel for attribute / board tooltips
function _panelWrap(content, maxWidth = '220px') {
  return `<div style="background:linear-gradient(160deg,rgba(22,17,36,.97),rgba(12,9,22,.98));border:1px solid rgba(139,92,246,.22);border-radius:12px;padding:12px;max-width:${maxWidth};backdrop-filter:blur(12px);">${content}</div>`;
}

function _matColor(id, cardDb) {
  if (id.startsWith('ARCH_')) return '#a78bfa';
  const c = cardDb?.getCard(id);
  return c?.tier ? (TIER_INKS[c.tier] || '#cdbcff') : '#cdbcff';
}

function _resolveMats(cost, cardDb, attributeDb) {
  return (cost?.materials || []).map(id => {
    const name = id.startsWith('ARCH_')
      ? (attributeDb?.getAttribute(id)?.name ?? id)
      : (cardDb?.getCard(id)?.name ?? id);
    return { name, color: _matColor(id, cardDb) };
  });
}

// ── Public: card tooltip (card definition) ────────────────────────────────────
export function cardHtml(card, powerDb = null, attributeDb = null, cardDb = null) {
  const t = _t(card.tier);
  const attributeNames = (card.attributes || []).map(id => attributeDb?.getAttribute(id)?.name ?? id);
  const power = card.power?.id && powerDb ? powerDb.getPower(card.power.id) : null;
  const hasOptions = Array.isArray(card.summon_options) && card.summon_options.length > 0;

  const artHtml = card._has_illustration
    ? `<img src="/illustrations/${card.id}" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;opacity:.7;">`
    : `<div style="color:rgba(255,255,255,.06);font-size:48px;font-family:'Chakra Petch';">✦</div>`;

  const typeLabel = hasOptions ? 'MULTIPLE' : (SUMMON_LABELS[card.summon_type] || card.summon_type.toUpperCase());

  const nameHtml = `<div style="font:700 15px 'Chakra Petch';color:#ece9f5;line-height:1.25;letter-spacing:.01em;">${esc(card.name)}</div>`;
  const divHtml  = `<div style="height:1px;background:linear-gradient(90deg,${t.edge},transparent);opacity:.35;"></div>`;
  const statsHtml = _statsRow(card.stats.atk, card.stats.hp, card.stats.attack_speed, card.stats.range, card.stats.movement_speed);
  const kwHtml = _keywordsRow(attributeNames);
  const abilityHtml = power ? _abilityBlock(power.name || card.power.id, power.description || '') : '';

  let costHtml = '';
  if (!hasOptions) {
    if ((card.summon_type === 'fusion' || card.summon_type === 'heritage') && card.cost?.materials?.length) {
      const label = card.summon_type === 'heritage' ? 'HÉRITAGE' : 'FUSION';
      costHtml = _materialsBlock(label, _resolveMats(card.cost, cardDb, attributeDb));
    } else if (card.summon_type === 'sacrifice' && card.cost?.sacrifice) {
      costHtml = _infoRow(`Sacrifice ×${card.cost.sacrifice}`, '#e8a850');
    } else if (card.summon_type === 'transformation' && card.cost?.materials?.length) {
      costHtml = _materialsBlock('TRANSFORMATION', _resolveMats(card.cost, cardDb, attributeDb));
    }
  } else {
    const lines = card.summon_options.map(opt => {
      const lbl = SUMMON_LABELS[opt.summon_type] || opt.summon_type.toUpperCase();
      const mats = _resolveMats(opt.cost, cardDb, attributeDb).map(m => m.name).join(', ');
      const sac  = opt.cost?.sacrifice ? ` ×${opt.cost.sacrifice}` : '';
      return `<div style="font:500 10px 'Manrope';color:#c4a888;">${lbl}${sac}${mats ? ` — ${mats}` : ''}</div>`;
    }).join('');
    costHtml = `<div style="display:flex;flex-direction:column;gap:3px;">${lines}</div>`;
  }

  const body = [nameHtml, divHtml, statsHtml, kwHtml, abilityHtml, costHtml].filter(Boolean).join('');
  return _tooltipCard(t, artHtml, typeLabel, `T${card.tier}`, body);
}

// ── Public: unit tooltip (live unit) ─────────────────────────────────────────
export function unitHtml(unit, powerDb = null, attributeDb = null, cardDb = null) {
  const t = _t(unit.tier);
  const attributeNames = (unit.attributes || []).map(id => attributeDb?.getAttribute(id)?.name ?? id);
  const power = unit.power_id && powerDb ? powerDb.getPower(unit.power_id) : null;
  const cardData = cardDb?.getCard(unit.card_id);

  const artHtml = cardData?._has_illustration
    ? `<img src="/illustrations/${unit.card_id}" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;opacity:.7;">`
    : `<div style="color:rgba(255,255,255,.06);font-size:48px;font-family:'Chakra Petch';">✦</div>`;

  const typeLabel = SUMMON_LABELS[unit.summon_type] || (unit.summon_type ?? 'NORMAL').toUpperCase();

  const nameHtml  = `<div style="font:700 15px 'Chakra Petch';color:#ece9f5;line-height:1.25;letter-spacing:.01em;">${esc(unit.name)}</div>`;
  const divHtml   = `<div style="height:1px;background:linear-gradient(90deg,${t.edge},transparent);opacity:.35;"></div>`;
  const statsHtml = _statsRow(unit.atk, unit.current_hp, unit.attack_speed, unit.range, unit.movement_speed);
  const kwHtml    = _keywordsRow(attributeNames);

  const abilityHtml = power
    ? _abilityBlock(power.name || unit.power_id, `Jauge : ${unit.power_gauge}/${unit.power_speed}`)
    : '';

  const extras = [];
  if (unit.shield > 0) extras.push(_infoRow(`🛡 Bouclier : ${unit.shield}`, '#f6da82'));
  if (unit.max_hp !== unit.current_hp) extras.push(_infoRow(`PV max : ${unit.max_hp}`, '#8b829f'));
  extras.push(_lineageRow(unit, cardDb));
  extras.push(_shoppingBonusRow(unit));
  extras.push(_veterancyRow(unit));

  const body = [nameHtml, divHtml, statsHtml, kwHtml, abilityHtml, ...extras].filter(Boolean).join('');
  return _tooltipCard(t, artHtml, typeLabel, `T${unit.tier}`, body);
}

function _lineageRow(unit, cardDb) {
  const ids = (unit.represented_ids || []).filter(id => id !== unit.card_id);
  if (!ids.length) return '';
  const names = ids.map(id => cardDb?.getCard(id)?.name ?? id).map(esc).join(', ');
  return _infoRow(`🧬 ${names}`, '#9ad2f6');
}

function _shoppingBonusRow(unit) {
  const bonus = unit._shopping_bonus;
  if (!bonus) return '';
  const parts = Object.entries(bonus)
    .filter(([, v]) => v)
    .map(([stat, v]) => `${v > 0 ? '+' : ''}${v} ${STAT_NAMES[stat] || stat}`);
  if (!parts.length) return '';
  return _infoRow(`🎁 ${parts.join(', ')}`, '#46d39a');
}

function _veterancyRow(unit) {
  const pts = unit.veterancy_points ?? 0;
  if (pts < VETERANCY_THRESHOLD) return '';
  const icon = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#f6da82" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;margin-right:3px;flex-shrink:0"><path d="M5 13l7-6 7 6"/><path d="M5 18l7-6 7 6"/></svg>`;
  return _infoRow(`${icon}Vétéran (${pts}) : +${pts * VETERANCY_ATK_PER_POINT} ATK / +${pts * VETERANCY_HP_PER_POINT} HP`, '#f0c87a');
}

// ── Public: attribute synergy tooltip ─────────────────────────────────────────
export function attributeHtml(attr, count, activeThreshold, cardDb = null) {
  const medalColors = { bronze: '#cd7f32', silver: '#b0b8c8', gold: '#f0c040', platinum: '#e5e4e2' };
  const medalNames  = { bronze: 'Bronze',  silver: 'Argent',  gold: 'Or',      platinum: 'Platine' };
  const rows = (attr.thresholds ?? []).map(t => {
    const isActive = activeThreshold && t.count <= activeThreshold.count;
    const color = isActive ? (medalColors[t.medal] ?? 'var(--accent)') : 'var(--muted)';
    const desc  = _describeEffects(t.effects, cardDb);
    return `<div style="color:${color};font-size:11px;padding:2px 0">${isActive ? '●' : '○'} ${t.count} (${esc(medalNames[t.medal] ?? t.medal)}) — ${esc(desc)}</div>`;
  }).join('');

  const content = `
    <div class="tip-header">
      <span style="font-size:18px;line-height:1">${attr.icon ?? ''}</span>
      <span class="tip-name">${esc(attr.name)}</span>
      <span style="font-size:11px;color:var(--muted)">${count} présent${count > 1 ? 's' : ''}</span>
    </div>
    <div style="margin-top:6px">${rows || '<span style="color:var(--muted);font-size:11px">Aucun palier</span>'}</div>`;
  return _panelWrap(content);
}

// ── Public: board terrain tooltip ─────────────────────────────────────────────
export function boardHtml(board, attributeDb = null) {
  const e = board.effect;
  const STAT_LBL = { atk: 'ATK', hp: 'HP', movement_speed: 'Déplacement', attack_speed: "Vit. attaque", initiative: 'Initiative', range: 'Portée' };
  const TYPE_LBL = { stat_bonus: 'Bonus de stat', stat_modifier: 'Modificateur', shield: 'Bouclier', draw_bonus: 'Pioche +' };

  let effectHtml = `<div style="color:var(--muted);font-size:11px">Aucun effet</div>`;
  if (e) {
    const typeLbl = TYPE_LBL[e.type] || e.type;
    const valStr  = e.type === 'stat_modifier' ? `×${e.value}` : (e.value >= 0 ? `+${e.value}` : `${e.value}`);
    const statLine = e.stat
      ? `<span style="color:var(--accent)">${STAT_LBL[e.stat] || e.stat}</span> ${valStr}`
      : valStr;
    let tgtLine;
    if (!e.target_attributes?.length) {
      tgtLine = 'Toutes les unités (les 2 joueurs)';
    } else if (attributeDb) {
      tgtLine = e.target_attributes
        .map(id => { const a = attributeDb.getAttribute(id); return a ? `${a.icon ?? ''} ${a.name}` : id; })
        .join(', ');
    } else {
      tgtLine = `${e.target_attributes.length} attribut${e.target_attributes.length > 1 ? 's' : ''} ciblé${e.target_attributes.length > 1 ? 's' : ''}`;
    }
    effectHtml = `
      <div style="font-size:11px;font-weight:600">${esc(typeLbl)}</div>
      <div style="font-size:13px;margin-top:2px">${statLine}</div>
      <div style="font-size:10px;color:var(--muted);margin-top:3px">${esc(tgtLine)}</div>`;
  }

  const thumb = board._has_illustration
    ? `<img src="/illustrations/${board.id}" style="width:100%;border-radius:4px;margin-bottom:8px;max-height:90px;object-fit:cover;display:block">`
    : '';

  const content = `
    <div style="display:flex;flex-direction:column;gap:2px;max-width:200px">
      ${thumb}
      <div style="font-weight:700;font-size:13px;margin-bottom:6px">🗺️ ${esc(board.name)}</div>
      <div style="background:rgba(255,255,255,.05);border-radius:6px;padding:8px">${effectHtml}</div>
    </div>`;
  return _panelWrap(content, '232px');
}

// ── Private helpers ───────────────────────────────────────────────────────────
function _describeEffects(effects, cardDb) {
  return (effects ?? []).map(e => {
    switch (e.type) {
      case 'stat_bonus':       return `+${e.value} ${_statLabel(e.stat)} à toutes les unités`;
      case 'stat_modifier':    return `+${e.value} ${_statLabel(e.stat)} par neutralisation`;
      case 'draw_bonus':       return `+${e.value} carte${e.value > 1 ? 's' : ''} par tour`;
      case 'guaranteed_draw':  return `Pioche garantie${e.category ? ` : 1 carte ${e.category}` : ''}`;
      case 'revive':           return `Réanime une unité (${Math.round((e.hp_ratio ?? .5) * 100)}% PV)`;
      case 'shield':           return `Bouclier +${e.value} PV`;
      case 'board_slot_bonus': return `+${e.value} emplacement${e.value > 1 ? 's' : ''}`;
      default:                 return e.type;
    }
  }).join(', ');
}

function _statLabel(stat) {
  return ({ atk: 'ATK', hp: 'HP', attack_speed: "vitesse d'attaque", movement_speed: 'vitesse' })[stat] ?? stat;
}

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
