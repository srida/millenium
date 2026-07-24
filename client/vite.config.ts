import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// Le backend Express (port 3742) reste la source des données et du WebSocket
// PvP ; en dev, Vite sert le client et proxifie tout le reste.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      '/api': 'http://localhost:3742',
      '/illustrations': 'http://localhost:3742',
      '/ws': { target: 'ws://localhost:3742', ws: true },
    },
  },
});
