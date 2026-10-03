import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './app/App';
import { registerPwaUpdates } from './app/pwaUpdate.js';
import { registerAccountSync } from './app/accountSync.js';
import { installViewportHeight } from './app/viewportHeight.js';
import './styles/index.css';

// Avant le premier rendu : la racine de l'App lit `--app-h` (cf. app/viewportHeight.ts).
installViewportHeight();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// Après le premier rendu : la mise à jour de l'appli installée n'a aucune
// raison de retarder la peinture (cf. app/pwaUpdate.ts).
registerPwaUpdates();

// Decks et tournoi suivent le joueur d'un appareil à l'autre (cf. app/accountSync.ts).
registerAccountSync();
