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
  },
});
