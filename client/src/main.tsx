import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './app/App';
import { registerPwaUpdates } from './app/pwaUpdate.js';
import './styles/index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// Après le premier rendu : la mise à jour de l'appli installée n'a aucune
// raison de retarder la peinture (cf. app/pwaUpdate.ts).
registerPwaUpdates();
