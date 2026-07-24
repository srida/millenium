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
