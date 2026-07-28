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
      registerType: 'autoUpdate',
      includeAssets: ['favicon.png', 'favicon.ico', 'apple-touch-icon.png', 'icon-192.png', 'icon-512.png', 'icon-512-maskable.png'],
      manifest: {
        name: 'Millenium',
        short_name: 'Millenium',
        description: 'Auto-battler tactique — TFT × Marvel Snap.',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#0f1117',
        theme_color: '#0f1117',
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
        // /api, /admin et /ws ne doivent pas être interceptés par la navigation SPA.
        navigateFallbackDenylist: [/^\/api/, /^\/admin/, /^\/illustrations/, /^\/avatars/, /^\/ws/],
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
      '/admin': 'http://localhost:3742',
      '/ws': { target: 'ws://localhost:3742', ws: true },
    },
  },
});
