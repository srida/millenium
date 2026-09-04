/// <reference types="node" />
// Ce que la couche app a le droit de toucher AU CHARGEMENT, quand il n'y a pas
// de navigateur.
//
// La suite tourne en `environment: 'node'`, sans DOM. Les tests qui pilotent un
// `GameController` (`board-alert`, `prep-undo-events`) posent `window` à la
// main, mais un module qui lit un global du navigateur **au niveau module**
// jette avant que le test ait pu poser quoi que ce soit — l'échec tombe à
// l'import, et vitest le rend en « Failed Suite » sans qu'aucun cas n'ait
// tourné.
//
// ⚠️ Le piège tient à la VERSION DE NODE, ce qui le rend invisible en local :
// `globalThis.navigator` n'existe qu'à partir de **Node 21**. Sur Node 22 la
// lecture passe, sur le Node 20 de la CI elle jette. Un test qui se contente de
// tourner sur la machine du développeur ne peut pas attraper ça — d'où ce
// fichier, qui retire le global pour reproduire la CI quel que soit le runtime.
import { describe, it, expect, afterEach } from 'vitest';

const HAD_NAVIGATOR = 'navigator' in globalThis;
const NAVIGATOR = (globalThis as Record<string, unknown>).navigator;

/** Rejoue un runtime sans `navigator` — Node 20, ou n'importe quel worker nu. */
async function sansNavigator<T>(charger: () => Promise<T>): Promise<T> {
  delete (globalThis as Record<string, unknown>).navigator;
  return charger();
}

afterEach(() => {
  if (HAD_NAVIGATOR) (globalThis as Record<string, unknown>).navigator = NAVIGATOR;
});

describe('chargement sans navigateur', () => {
  // `three/constants.ts` est lu par `CombatAnimator3D`, donc par
  // `GameController`, donc par tout test qui pilote une partie. C'est le module
  // le plus profond de la chaîne : s'il jette, rien au-dessus ne démarre.
  // Mutation : rétablir `navigator.hardwareConcurrency` nu → ROUGE.
  it('three/constants se charge et rend un drapeau exploitable', async () => {
    const { LOW_END_DEVICE } = await sansNavigator(() => import('../three/constants.js'));
    expect(typeof LOW_END_DEVICE).toBe('boolean');
  });

  // L'invariant qui compte vraiment pour la suite : la chaîne complète que
  // `board-alert` et `prep-undo-events` empruntent doit s'importer. Sans ce
  // cas, un second module lisant un global du navigateur au chargement referait
  // tomber les deux fichiers, et le test ci-dessus resterait vert.
  //
  // ⚠️ `window` est posé, comme le font les deux fichiers concernés : `uiStore`
  // le lit au chargement pour le deep-link `?screen=`, et c'est une convention
  // ASSUMÉE du projet. Ce qu'on éprouve ici n'est pas « aucun global », c'est
  // « aucun global que la convention ne couvre déjà ».
  it('la chaîne du GameController s\'importe entière', async () => {
    (globalThis as Record<string, unknown>).window = {
      location: { search: '' }, addEventListener() {}, removeEventListener() {},
    };
    const mod = await sansNavigator(() => import('../game/GameController.js'));
    expect(typeof mod.GameController).toBe('function');
  });
});
