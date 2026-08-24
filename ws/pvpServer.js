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
const botMatch = require('./BotMatch');

const WS_PATH = '/ws/pvp';

/**
 * Plafond par message. Le défaut de `ws` est de **100 Mo**, et le relais
 * transmet des blobs opaques à l'adversaire : sans plafond, un client hostile
 * sature la mémoire du serveur ET celle de son adversaire. 64 Ko est large —
 * le plus gros message du protocole est `round:board_ready`, qui porte au plus
 * six unités avec leurs stats de base.
 */
const MAX_PAYLOAD_BYTES = 64 * 1024;

/**
 * Origines autorisées à ouvrir un WebSocket. Le cookie de session est en
 * `SameSite=Lax`, ce qui couvre déjà l'essentiel sur les navigateurs récents,
 * mais le contrôle d'origine est la défense qui n'en dépend pas — et il coûte
 * trois lignes. `ALLOWED_WS_ORIGINS` (liste séparée par des virgules) permet
 * d'ajouter un domaine sans toucher au code.
 *
 * Une requête SANS en-tête `Origin` est acceptée : ce sont les clients non
 * navigateurs (scripts de test, outils en ligne de commande), et ce ne sont pas
 * eux qui portent le risque — un navigateur envoie toujours l'en-tête.
 */
const ALLOWED_ORIGINS = (process.env.ALLOWED_WS_ORIGINS || '')
  .split(',').map(s => s.trim()).filter(Boolean);

function originAllowed(req) {
  const origin = req.headers.origin;
  if (!origin) return true;                       // client non navigateur
  if (ALLOWED_ORIGINS.includes(origin)) return true;
  try {
    const { hostname } = new URL(origin);
    // Le développement sert le client depuis un autre port (Vite) que l'API.
    if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]') return true;
  } catch { return false; }
  // Même hôte que la requête : le cas de la production, où Express sert le SPA.
  return origin === `https://${req.headers.host}` || origin === `http://${req.headers.host}`;
}

function attachPvpWebSocketServer(httpServer) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_PAYLOAD_BYTES });

  httpServer.on('upgrade', (req, socket, head) => {
    let url;
    try { url = new URL(req.url, 'http://localhost'); } catch { socket.destroy(); return; }
    // ⚠️ `destroy()` et non un simple `return` : le commentaire d'origine
    // laissait la place à d'autres handlers d'upgrade, mais il n'y en a aucun —
    // la socket restait donc ouverte sans propriétaire, et une boucle d'upgrades
    // sur un chemin quelconque les accumulait jusqu'à épuisement.
    if (url.pathname !== WS_PATH) { socket.destroy(); return; }

    if (!originAllowed(req)) {
      socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
      socket.destroy();
      return;
    }

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
      botMatch.handleDisconnect(ws.userId);
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
  // Battement de cœur applicatif du client (cf. net/PvpConnection.KEEPALIVE_MS).
  // ⚠️ Il est reconnu AVANT tout le reste, et surtout avant le `default` qui
  // relaie : un type inconnu relayé à l'adversaire s'empilerait indéfiniment
  // dans son tampon de messages. Il n'y a rien à répondre — la seule chose qui
  // compte est qu'un octet ait traversé le proxy dans le sens client → serveur.
  if (msg.type === 'ping') return;

  // Un duel contre bot parle les MÊMES messages qu'un duel réel — c'est ce qui
  // permet au client de n'avoir qu'un écran. Il n'a en revanche pas de second
  // joueur à qui relayer : tout ce qui n'est pas la fin du match (résultat,
  // abandon) est sans objet et tombe donc dans le vide.
  if (botMatch.isBotMatch(msg.matchId)) {
    switch (msg.type) {
      case 'match:report_result':
        botMatch.handleReportResult(msg.matchId, ws.userId, msg.localWinner);
        break;
      case 'match:forfeit':
        botMatch.handleForfeit(msg.matchId, ws.userId);
        break;
      default:
        break;
    }
    return;
  }

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
