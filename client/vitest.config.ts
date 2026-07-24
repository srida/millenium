import { defineConfig } from 'vitest/config';

// La logique de jeu est headless : les tests tournent en environnement node
// pur, sans jsdom — toute dépendance au DOM dans logic/ ferait échouer la suite.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/test/**/*.test.ts'],
  },
});
