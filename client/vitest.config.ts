import { defineConfig } from 'vitest/config';

// La logique de jeu est headless : les tests tournent en environnement node
// pur, sans jsdom — toute dépendance au DOM dans logic/ ferait échouer la suite.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/test/**/*.test.ts'],
    // `data/` n'existe qu'après un premier démarrage du serveur ; les tests
    // serveur y lisent leurs catalogues. On le peuple depuis `initial-data/`
    // pour que la suite tourne sur un clone neuf.
    globalSetup: ['./src/test/globalSetup.ts'],

    // Le défaut de vitest est de 5 s. C'est confortable pour les golden tests
    // de logique (quelques millisecondes chacun), mais juste pour les fichiers
    // d'INTÉGRATION : quatre d'entre eux montent une application Express
    // complète avec sa base SQLite (http, http-boot, pvp-relay,
    // crud-characterization), pendant que shop / gifts / cosmetics déposent
    // 653 PNG et rejouent des tirages, et que bcrypt hache à coût 11.
    // `shop.test.ts` avait déjà un cas à 3,6 s sur une machine au repos — 72 %
    // du budget.
    //
    // 30 s est une marge pour les exécuteurs lents ou chargés, pas un pansement
    // sur un test qui pendouille : un vrai blocage échoue toujours, simplement
    // 25 s plus tard, et ces fichiers-là ne tournent qu'en CI et avant un push.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
