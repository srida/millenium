import { navigate } from '../../main.js';
import * as PvpConnection from '../../net/PvpConnection.js';

export async function mount(container, params = {}) {
  const { deckName } = params;
  let state = 'connecting'; // 'connecting' | 'searching' | 'found' | 'error'
  let opponent = null;
  let errorMessage = '';

  function render() {
    let body = '';
    if (state === 'connecting' || state === 'searching') {
      body = `
        <div class="lobby-spinner"></div>
        <div class="lobby-status">${state === 'connecting' ? 'Connexion au serveur…' : 'Recherche d’un adversaire…'}</div>
        <button class="btn btn-secondary" id="btn-cancel">Annuler</button>
      `;
    } else if (state === 'found') {
      body = `
        <div class="lobby-found-icon">⚔</div>
        <div class="lobby-status">Adversaire trouvé</div>
        <div class="lobby-opponent-name">${esc(opponent?.username || '???')}${opponent?.tag ? `<span class="lobby-opponent-tag">#${esc(opponent.tag)}</span>` : ''}</div>
        <div class="lobby-status-sub">Préparation du duel…</div>
      `;
    } else {
      body = `
        <div class="lobby-status lobby-error">${esc(errorMessage || 'Une erreur est survenue.')}</div>
        <button class="btn btn-secondary" id="btn-back">Retour</button>
      `;
    }

    container.innerHTML = `
      <div class="topbar">
        <button class="topbar-back" id="btn-topback">‹</button>
        <span class="topbar-title">DUEL EN LIGNE</span>
      </div>
      <div class="lobby-root">${body}</div>
    `;

    container.querySelector('#btn-topback')?.addEventListener('click', leave);
    container.querySelector('#btn-cancel')?.addEventListener('click', leave);
    container.querySelector('#btn-back')?.addEventListener('click', leave);
  }

  function leave() {
    PvpConnection.send('queue:leave');
    PvpConnection.off('match:found', onMatchFound);
    PvpConnection.off('match:start', onMatchStart);
    PvpConnection.off('_socket_closed', onSocketClosed);
    PvpConnection.disconnect();
    navigate('main_menu');
  }

  function onMatchFound(msg) {
    state = 'found';
    opponent = msg.opponent;
    render();
    PvpConnection.send('match:ready');
  }

  function onMatchStart(msg) {
    PvpConnection.off('match:found', onMatchFound);
    PvpConnection.off('match:start', onMatchStart);
    PvpConnection.off('_socket_closed', onSocketClosed);
    navigate('game3d', {
      deckName,
      pvp: {
        matchId: PvpConnection.getMatchId(),
        role: PvpConnection.getRole(),
        opponent: PvpConnection.getOpponent(),
        round: msg.round,
      },
    });
  }

  function onSocketClosed() {
    if (state === 'found') return; // déjà en train de naviguer vers le combat
    state = 'error';
    errorMessage = 'Connexion perdue avec le serveur.';
    render();
  }

  render();

  try {
    await PvpConnection.connect();
    state = 'searching';
    render();
    PvpConnection.on('match:found', onMatchFound);
    PvpConnection.on('match:start', onMatchStart);
    PvpConnection.on('_socket_closed', onSocketClosed);
    PvpConnection.send('queue:join', { deckName });
  } catch (e) {
    state = 'error';
    errorMessage = e.message || 'Connexion impossible.';
    render();
  }
}

export function unmount() {
  PvpConnection.send('queue:leave');
}

function esc(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
