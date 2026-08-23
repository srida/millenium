// Lint du BACKEND (racine, routes/, ws/, scripts/). Le client a le sien,
// `client/eslint.config.js`, et les deux ne se recouvrent pas : celui-ci ignore
// `client/` explicitement.
//
// Ce fichier existe pour une raison précise, et ce n'est pas de traquer les
// variables inutilisées : c'est d'ENCODER EN RÈGLES les invariants
// d'architecture que CLAUDE.md énonce en prose et que rien ne vérifiait. Le
// graphe de dépendances du backend est acyclique par construction — feuilles
// (`sets.js`, `variants.js`, `asset-dirs.js`), puits (`levels.js`, `gifts.js`)
// — mais cette propriété ne tenait jusqu'ici qu'à des commentaires d'en-tête et
// à la discipline. Le précédent est posé côté client, où `logic/` et `three/`
// ont leurs garde-fous depuis la refonte ; on applique la même idée ici.
//
// ⚠️ `no-restricted-imports` (cœur d'ESLint) ne voit QUE les `import` ES. Le
// backend est en CommonJS : c'est `n/no-restricted-require` d'eslint-plugin-n
// qu'il faut, et lui seul. Se tromper de règle donne une config qui passe au
// vert sans jamais rien vérifier — le pire des deux mondes.
const js = require('@eslint/js');
const n = require('eslint-plugin-n');
const globals = require('globals');

/** Message d'une feuille du graphe : elle ne requiert que `asset-dirs`. */
const leaf = (name) => ({
  name,
  message:
    `Feuille du graphe de dépendances : ce module est requis PAR ${name}, il ne peut pas ` +
    'le requérir en retour (cycle immédiat). Cf. l\'en-tête du fichier et CLAUDE.md.',
});

/** Message d'un puits : personne ne le requiert. */
const sink = (name, allowed) => ({
  name,
  message:
    `${name} est un PUITS du graphe : il requiert les modules de règles, aucun ne le requiert ` +
    `en retour. Seul ${allowed} y a droit. Cf. l'en-tête du fichier et CLAUDE.md.`,
});

const SINKS = [
  sink('./levels', 'routes/online.js'),
  sink('./gifts', 'routes/online.js et server.js'),
];

module.exports = [
  {
    ignores: [
      'client/**',        // a sa propre config (garde-fous logic/ et three/)
      'node_modules/**',
      'data/**',          // volume, gitignoré
      'resources/**',     // volume, gitignoré
    ],
  },

  js.configs.recommended,

  {
    // Tout le backend est en CommonJS, exécuté par Node.
    files: ['**/*.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'commonjs',
      globals: { ...globals.node },
    },
    plugins: { n },
    rules: {
      // Attrape la dépendance FANTÔME : un module requis mais absent de
      // package.json, qui ne se résout que par la remontée d'un autre paquet.
      // C'est exactement ce qui est arrivé à `cookie`, requis dans le chemin
      // d'authentification et résolu par la seule copie hissée d'express.
      'n/no-extraneous-require': 'error',
      'n/no-unpublished-require': 'off',   // scripts/ et tests ne sont pas publiés
      'n/no-process-exit': 'error',

      // Le style du dépôt : `catch (_) {}` et arguments de middleware inutilisés
      // (`next`) sont volontaires et lisibles.
      'no-unused-vars': ['error', {
        argsIgnorePattern: '^_|^next$|^req$|^res$',
        caughtErrorsIgnorePattern: '^_|^e$',
      }],
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },

  // ⚠️ Les deux blocs qui suivent portent la MÊME règle
  // (`n/no-restricted-require`). En config plate, une règle n'est pas fusionnée
  // mais REMPLACÉE par le bloc suivant qui la mentionne : un fichier couvert
  // par les deux ne garderait que la liste du second. `sets.js` étant à la fois
  // une feuille et un module de règles, sa restriction de feuille était donc
  // silencieusement écrasée par celle des puits — une config verte qui ne
  // vérifiait rien, exactement le piège que ce fichier cherche à éviter.
  // D'où : les puits d'abord, les feuilles ensuite, avec la liste CUMULÉE.

  {
    // --- Puits du graphe ---
    // `levels.js` et `gifts.js` requièrent shop, cosmetics et progression ;
    // aucun module de règles ne doit les requérir en retour. C'est aussi
    // pourquoi la dette de paliers se DÉDUIT à la lecture au lieu d'être
    // versée par `progression.grant` : progression.js n'a jamais à charger les
    // pools du tirage.
    files: ['*.js', 'ws/**/*.js'],
    ignores: ['levels.js', 'gifts.js', 'server.js', 'app.js', 'eslint.config.js'],
    rules: { 'n/no-restricted-require': ['error', SINKS] },
  },

  {
    // --- Feuilles du graphe ---
    // `sets.js` et `variants.js` sont lus par shop.js, progression.js et
    // cosmetics.js. Les requérir en retour ferait le cycle que leur existence
    // même sert à éviter (cf. l'en-tête de sets.js : « ce module existe pour
    // une raison de DÉPENDANCES »). `asset-dirs.js` ne requiert rien du tout,
    // ce qui est ce qui le rend chargeable par n'importe qui.
    //
    // La liste reprend SINKS : une feuille est aussi un module de règles, et le
    // bloc ci-dessus vient d'être remplacé pour ces fichiers-là.
    files: ['sets.js', 'variants.js', 'asset-dirs.js'],
    rules: {
      'n/no-restricted-require': ['error', [
        ...SINKS,
        leaf('./shop'), leaf('./progression'), leaf('./cosmetics'),
        leaf('./db'), leaf('./missions'), leaf('./arcade'),
      ]],
    },
  },

  {
    // Les outils de `scripts/` écrits en ESM (.mjs) : mêmes globals Node, mais
    // `sourceType: module` et le `fetch` global de Node 18+.
    files: ['**/*.mjs'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: { ...globals.node },
    },
    plugins: { n },
    rules: {
      'n/no-extraneous-import': 'error',
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_|^e$' }],
    },
  },

  {
    // Les scripts sont des outils de ligne de commande : ils sortent en code
    // d'erreur, c'est leur contrat.
    files: ['scripts/**'],
    rules: { 'n/no-process-exit': 'off' },
  },

  {
    // `server.js` porte la garde ADMIN_PASS, dont l'échec DOIT terminer le
    // process — c'est tout l'intérêt d'un démarrage qui refuse de servir.
    files: ['server.js', 'app.js'],
    rules: { 'n/no-process-exit': 'off' },
  },
];
