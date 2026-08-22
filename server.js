// Point d'entrée du PROCESSUS — le seul fichier du dépôt qui écoute.
//
// Tout le routage vit dans app.js, qui n'ouvre aucun socket : c'est ce qui rend
// l'application testable (client/src/test/http.test.ts la require directement,
// puis la passe à http.createServer sur un port éphémère). Ce fichier ne garde
// que ce dont un test ne veut pas — le port, le serveur HTTP, et l'attache du
// WebSocket PvP, qui prend un `http.Server` et n'a donc rien à faire dans une
// application Express.
//
// ⚠️ La garde ADMIN_PASS reste en tête d'app.js, pas ici : elle doit s'exécuter
// AVANT le moindre `require` de module racine (db.js crée DATA_DIR et ouvre la
// base au chargement), pour qu'un démarrage refusé ne laisse aucune trace. app.js
// JETTE ; c'est ici qu'on traduit en sortie non nulle, parce qu'un test veut
// l'erreur, pas la fin du processus.
const http = require('http');

let app;
try {
  app = require('./app');
} catch (e) {
  console.error(`[démarrage] ${e.message}`);
  process.exit(1);
}

const { attachPvpWebSocketServer } = require('./ws/pvpServer');

const PORT = process.env.PORT || 3742;
const httpServer = http.createServer(app);
attachPvpWebSocketServer(httpServer);
httpServer.listen(PORT, () => console.log(`Card Manager running at http://localhost:${PORT}`));
