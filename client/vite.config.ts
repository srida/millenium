import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';

// Le backend Express (port 3742) reste la source des données et du WebSocket
// PvP ; en dev, Vite sert le client et proxifie tout le reste.
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      // ⚠️ `prompt` et non `autoUpdate`, alors que le rechargement EST
      // automatique — la différence est celle du moment.
      //
      // `autoUpdate` pose `skipWaiting` + `clientsClaim` : la nouvelle version
      // prend la main **sous la page en cours** et purge le précache de
      // l'ancienne. Les écrans de jeu étant chargés en `lazy()` (Three.js), un
      // `import()` parti après cette bascule demande un chunk dont le nom a
      // changé : le serveur répond par le fallback SPA, et le navigateur essaie
      // de lire `index.html` comme un module. En pleine partie, le seul recours
      // était le rechargement à la main.
      //
      // `prompt` laisse la nouvelle version **en attente** : la session en cours
      // garde son précache intact, et `app/pwaUpdate.ts` déclenche le
      // basculement quand le rechargement est gratuit (au menu principal).
      registerType: 'prompt',
      // On enregistre le service worker depuis `app/pwaUpdate.ts` : le script
      // injecté par défaut se contente d'un `register()` au chargement, sans
      // rien pour interroger le serveur au réveil de l'appli — ce qui est
      // précisément le trou qu'on bouche.
      injectRegister: null,
      includeAssets: ['favicon.png', 'favicon.ico', 'apple-touch-icon.png', 'icon-192.png', 'icon-512.png', 'icon-512-maskable.png'],
      manifest: {
        name: 'Millenium',
        short_name: 'Millenium',
        description: 'Auto-battler tactique — TFT × Marvel Snap.',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        orientation: 'portrait',
        // Deux couleurs, deux moments — les confondre était l'erreur.
        // `background_color` est l'écran de démarrage : il précède l'écran de
        // chargement de l'app (`bg-surface`), il garde donc sa teinte.
        // `theme_color` peint les BARRES SYSTÈME pendant qu'on joue, à côté du
        // décor spatial : il miroite `--color-space-edge` (styles/space.css),
        // sans quoi la barre de navigation Android pose une bande grise en bas
        // de l'écran — visible en appli installée, jamais en navigateur.
        background_color: '#0f1117',
        theme_color: '#080a13',
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: '/icon-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // App shell précaché ; on n'y met JAMAIS les données ni les illustrations.
        globPatterns: ['**/*.{js,css,html,woff2}'],
        navigateFallback: '/index.html',
        // /api et /ws ne doivent pas être interceptés par la navigation SPA.
        navigateFallbackDenylist: [/^\/api/, /^\/admin/, /^\/illustrations/, /^\/avatars/, /^\/pack-posters/, /^\/board-backgrounds/, /^\/ws/],
        runtimeCaching: [
          {
            // Art des cartes : stale-while-revalidate (affichage instantané, MAJ en fond).
            urlPattern: ({ url }) => url.pathname.startsWith('/illustrations/'),
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'illustrations',
              expiration: { maxEntries: 500, maxAgeSeconds: 60 * 60 * 24 * 30 },
            },
          },
          {
            // Portraits des decks publics — même politique que l'art des cartes.
            urlPattern: ({ url }) => url.pathname.startsWith('/avatars/'),
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'avatars',
              expiration: { maxEntries: 100, maxAgeSeconds: 60 * 60 * 24 * 30 },
            },
          },
          {
            // Fonds de grille des terrains — lourds et à URL stable, donc le
            // cache est ici particulièrement rentable. Peu d'entrées : un fond
            // par terrain.
            urlPattern: ({ url }) => url.pathname.startsWith('/board-backgrounds/'),
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'board-backgrounds',
              expiration: { maxEntries: 60, maxAgeSeconds: 60 * 60 * 24 * 30 },
            },
          },
          {
            // Données de jeu : toujours le réseau (jamais servir un cache périmé).
            urlPattern: ({ url }) => url.pathname.startsWith('/api/'),
            handler: 'NetworkOnly',
          },
        ],
      },
      devOptions: { enabled: false },
    }),
  ],
  // Force une instance unique de React/React-DOM (évite le "Invalid hook call"
  // quand Vite résout deux copies via ses deps optimisées).
  resolve: { dedupe: ['react', 'react-dom'] },
  optimizeDeps: { include: ['react', 'react-dom', 'react/jsx-runtime', 'zustand'] },
  server: {
    proxy: {
      '/api': 'http://localhost:3742',
      '/illustrations': 'http://localhost:3742',
      '/avatars': 'http://localhost:3742',
      '/pack-posters': 'http://localhost:3742',
      '/board-backgrounds': 'http://localhost:3742',
      '/admin': 'http://localhost:3742',
      '/ws': { target: 'ws://localhost:3742', ws: true },
    },
  },
});
