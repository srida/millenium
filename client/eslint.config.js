import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';

// Garde-fous d'architecture (PLAN_REFONTE §2.1) :
//  - logic/ n'importe jamais react, zustand, three, ni la couche data/
//  - three/ n'importe jamais react ni zustand
//  - les règles des hooks React sont vérifiées (elles ne l'étaient pas)
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
    // Les règles des hooks React. Le lint encodait déjà les frontières
    // d'architecture, mais rien ne vérifiait React lui-même sur une soixantaine
    // de composants — `rules-of-hooks`, celle qui attrape les plantages réels
    // (un hook sous condition, dans une boucle, après un `return`), n'était
    // vérifiée nulle part. Le code la respectait ; rien ne le maintenait.
    //
    // ⚠️ `exhaustive-deps` est en `error`, pas en `warn`. Les six écarts que le
    // projet portait sont tous DÉLIBÉRÉS — montage unique de GameScreen et
    // GameScreenPvp, dépendance sur un champ plutôt que sur l'instantané entier
    // (MissionsScreen, ShopScreen), scène 3D montée une fois (CombatLab), tempo
    // de re-création volontaire (DeckBuilder) — et chacun porte désormais son
    // `eslint-disable-next-line` avec sa raison juste au-dessus.
    //
    // Une fois ces six-là nommés, il ne reste aucun bruit : passer la règle en
    // `error` la rend utile. En `warn` elle aurait rejoint la liste des
    // avertissements qu'on ne lit plus, et le prochain oubli serait passé.
    files: ['src/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'error',
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
