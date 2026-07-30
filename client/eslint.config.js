import js from '@eslint/js';
import tseslint from 'typescript-eslint';

// Garde-fous d'architecture (PLAN_REFONTE §2.1) :
//  - logic/ n'importe jamais react, zustand, three, ni la couche data/
//  - three/ n'importe jamais react ni zustand
export default tseslint.config(
  { ignores: ['dist', 'node_modules'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // Globals navigateur pour les couches client (data/net utilisent fetch,
    // localStorage, WebSocket… ; les futurs composants utilisent le DOM).
    languageOptions: {
      globals: {
        fetch: 'readonly', localStorage: 'readonly', sessionStorage: 'readonly',
        WebSocket: 'readonly', location: 'readonly', window: 'readonly',
        document: 'readonly', navigator: 'readonly', console: 'readonly',
        setTimeout: 'readonly', clearTimeout: 'readonly',
        setInterval: 'readonly', clearInterval: 'readonly',
        requestAnimationFrame: 'readonly', cancelAnimationFrame: 'readonly',
      },
    },
  },
  {
    // Code JS gelé du portage (converti en TS au fil de l'eau) : on ne le
    // modifie pas pour satisfaire le lint.
    files: ['src/**/*.js'],
    rules: {
      '@typescript-eslint/no-unused-vars': 'off',
      'no-unused-vars': 'off',
    },
  },
  {
    files: ['src/logic/**'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [
          { group: ['react', 'react-dom', 'react/*', 'react-dom/*'], message: 'logic/ ne doit pas importer React.' },
          { group: ['zustand', 'zustand/*'], message: 'logic/ ne doit pas importer Zustand.' },
          { group: ['three', 'three/*'], message: 'logic/ ne doit pas importer Three.js.' },
          { group: ['**/data/*'], message: 'logic/ ne doit pas importer la couche data — passer par injection de dépendances.' },
        ],
      }],
    },
  },
  {
    files: ['src/three/**'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [
          { group: ['react', 'react-dom', 'react/*', 'react-dom/*'], message: 'three/ ne doit pas importer React.' },
          { group: ['zustand', 'zustand/*'], message: 'three/ ne doit pas importer Zustand.' },
        ],
      }],
    },
  },
);
