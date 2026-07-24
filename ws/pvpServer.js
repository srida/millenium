// Point d'entrée WebSocket pour le mode Duel en ligne (PvP 1v1).
//
// Le serveur ne fait que matchmaking + relais de messages entre les 2 clients
// d'un même match — aucune logique de jeu (CombatManager, GameState, ...)
// n'est portée ici. Chaque client simule son propre combat localement à
// partir d'un état initial synchronisé (mêmes unités, même terrain), ce qui
// est possible car CombatManager est 100% déterministe (aucun RNG interne).
const { WebSocketServer } = require('ws');
const auth = require('../auth');
const queue = require('./MatchmakingQueue');
const relay = require('./MatchRelay');

const WS_PATH = '/ws/pvp';

function attachPvpWebSocketServer(httpServer) {
  const wss = new WebSocketServer({ noServer: true });

  httpServer.on('upgrade', (req, socket, head) => {
    let url;
    try { url = new URL(req.url, 'http://localhost'); } catch { socket.destroy(); return; }
    if (url.pathname !== WS_PATH) return; // laisse d'autres upgrade handlers (s'il y en a) traiter

    const user = auth.attachUser({ headers: req.headers });
    if (!user) { socket.destroy(); return; }

    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, req, user);
    });
  });

  wss.on('connection', (ws, req, user) => {
    ws.userId = user.id;
    ws.username = user.username;
    ws.tag = user.tag;
    ws.avatar = user.avatar;
    ws.isAlive = true;

    ws.on('pong', () => { ws.isAlive = true; });

    ws.on('message', (raw) => {
      let msg;
      try { msg = JSON.parse(raw); } catch { return; }
      if (!msg || typeof msg.type !== 'string') return;
      handleMessage(ws, msg);
    });

    ws.on('close', () => {
      queue.handleDisconnectWhileWaiting(ws.userId);
      relay.handleDisconnect(ws.userId);
    });
  });

  // Heartbeat : ferme les sockets zombies (utile derrière les proxys Railway).
  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      if (ws.isAlive === false) { ws.terminate(); continue; }
      ws.isAlive = false;
      ws.ping();
    }
  }, 30_000);
  wss.on('close', () => clearInterval(heartbeat));

  return wss;
}

function handleMessage(ws, msg) {
  switch (msg.type) {
    case 'queue:join':
      queue.joinQueue(ws, ws.userId, msg.deckName);
      break;
    case 'queue:leave':
      queue.leaveQueue(ws.userId);
      break;
    case 'match:ready':
      relay.handleReady(msg.matchId, ws.userId);
      break;
    case 'match:rejoin':
      relay.handleRejoin(ws, msg.matchId, ws.userId);
      break;
    case 'match:forfeit':
      relay.handleForfeit(msg.matchId, ws.userId);
      break;
    case 'match:report_result':
      relay.handleReportResult(msg.matchId, ws.userId, msg.localWinner);
      break;
    // Tous les autres messages (round:board_ready, round:terrain_pick,
    // round:combat_start_ack, round:combat_result, round:next_ready) sont de
    // simples relais entre les 2 joueurs du match — aucune interprétation
    // côté serveur au-delà de vérifier l'appartenance au match.
    default:
      relay.relayMessage(msg.matchId, ws.userId, msg);
      break;
  }
}

module.exports = { attachPvpWebSocketServer };
