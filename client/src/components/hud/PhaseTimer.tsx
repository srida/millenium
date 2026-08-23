// Les deux chronos de la boucle de jeu, et les bannières qui les accompagnent.
//
// Ils vivaient en DOUBLE, une copie par écran de jeu : `GameScreen` (solo,
// tournoi, arcade, tutoriel) et `GameScreenPvp` (duel réel, duel bot).
// `ShoppingTimer` y était identique au caractère près, `Banners` identique tout
// court, et `PrepTimer` ne différait que par son prédicat d'activité et son
// rappel à zéro. Les commentaires des deux fichiers disaient déjà « même règle
// qu'en PvP » et « cf. GameScreenPvp.tsx » : l'intention de partage était
// écrite, il ne manquait que le partage.
//
// Ce sont des composants SANS RENDU : ils n'existent que pour tenir un
// `setInterval` accroché au cycle de vie de React, et publient leur décompte
// dans `gameStore` — c'est la popup ou la barre de phase qui l'affiche.
import { useEffect, useRef } from 'react';
import { useGameStore, type GameSnapshot } from '../../stores/gameStore.js';
import { Banner } from '../ui/primitives.js';

/**
 * Chrono d'une phase, décompté à la seconde et publié dans l'instantané.
 *
 * - `restartKey` : le chrono repart de zéro à chaque changement de cette clé
 *   (le numéro de round pour la préparation, l'ouverture de la popup pour le
 *   shopping). Une phase qui revient est une phase neuve.
 * - `isActive` : lu à CHAQUE tic sur l'état frais du store, jamais capturé dans
 *   la closure — c'est ce qui permet de geler le décompte (menu d'options
 *   ouvert, bulle du coach en attente d'un tap) sans reconstruire l'intervalle.
 * - `onTimeout` : ce que le zéro déclenche. Appelé UNE fois, l'intervalle étant
 *   coupé juste avant.
 */
export function PhaseTimer({
  durationS, field, restartKey, isActive, onTimeout,
}: {
  durationS: number;
  /** Champ de l'instantané où publier le restant. */
  field: 'prepRemaining' | 'shoppingRemaining';
  restartKey: unknown;
  isActive: (s: GameSnapshot) => boolean;
  onTimeout: () => void;
}) {
  const applySnapshot = useGameStore(s => s.applySnapshot);
  const remaining = useRef(durationS);
  const fired = useRef(false);

  // Les rappels changent d'identité à chaque rendu du parent ; les garder dans
  // une ref évite de reconstruire l'intervalle sous le joueur.
  const activeRef = useRef(isActive);
  const timeoutRef = useRef(onTimeout);
  activeRef.current = isActive;
  timeoutRef.current = onTimeout;

  useEffect(() => {
    remaining.current = durationS;
    fired.current = false;
    applySnapshot({ [field]: durationS } as Partial<GameSnapshot>);

    const t = setInterval(() => {
      if (!activeRef.current(useGameStore.getState())) return;
      remaining.current -= 1;
      if (remaining.current <= 0) {
        clearInterval(t);
        applySnapshot({ [field]: 0 } as Partial<GameSnapshot>);
        if (!fired.current) { fired.current = true; timeoutRef.current(); }
        return;
      }
      applySnapshot({ [field]: remaining.current } as Partial<GameSnapshot>);
    }, 1000);

    return () => clearInterval(t);
  }, [restartKey, durationS, field, applySnapshot]);

  return null;
}

/**
 * Bannières de phase, communes aux deux écrans de jeu.
 *
 * La bannière de CIBLAGE d'une magie n'est pas ici : `ShoppingLayer` la rend
 * elle-même, parce qu'elle porte un bouton « Annuler » et n'est donc pas un
 * simple message.
 */
export function Banners() {
  const errorFlash = useGameStore(s => s.errorFlash);
  const invocationBanner = useGameStore(s => s.invocationBanner);
  const combatActive = useGameStore(s => s.combatActive);
  if (errorFlash) return <Banner text={`⚠ ${errorFlash}`} tone="error" />;
  if (invocationBanner && !combatActive) return <Banner text={invocationBanner} />;
  return null;
}
