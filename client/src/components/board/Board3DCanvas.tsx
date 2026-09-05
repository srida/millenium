// Board3DCanvas — unique pont React → Three. Possède le cycle de vie de la
// Scene3D : la crée au montage avec les callbacks du GameController, la détruit
// au démontage (dispose complet, cf. Phase 2). Aucun état React lié au rendu.
//
// ⚠️ Il porte AUSSI les deux façons dont le rendu 3D peut manquer à l'appel, et
// aucune des deux n'est hypothétique : la création du contexte WebGL peut
// échouer (GPU désactivé, plafond de contextes de l'onglet atteint, processus
// graphique tombé), et un contexte déjà acquis peut se PERDRE en pleine partie.
// Sans garde, le premier cas jetait depuis l'effet de montage — l'exception
// remontait jusqu'au commit React, qui démontait tout l'écran : le jeu se
// figeait sans un mot, l'erreur ne vivant que dans la console. Le second
// laissait un canvas noir et une boucle muette. Un écran de jeu qui ne peut pas
// dessiner doit le DIRE et rendre la sortie possible.
import { useEffect, useRef, useState } from 'react';
import { Scene3D } from '../../three/Scene3D.js';
import { useUiStore } from '../../stores/uiStore.js';
import { Button } from '../ui/primitives.js';
import type { GameController } from '../../game/GameController.js';

export default function Board3DCanvas({ controller }: { controller: GameController }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState<'init' | 'lost' | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let scene: Scene3D;
    try {
      scene = new Scene3D(container, {
        showEnemySide: false,
        onCellTap: controller.onCellTap,
        onUnitTap: controller.onUnitTap,
        onUnitDrag: controller.onUnitDrag,
        onUnitLongPress: controller.onUnitLongPress,
      });
    } catch (e) {
      // On journalise et on rend la main : l'écran affiche son message, le
      // contrôleur reste sans scène (tous ses appels de rendu sont gardés).
      console.error('[board3d] contexte WebGL indisponible', e);
      setFailed('init');
      return;
    }
    controller.attachScene(scene);

    // ⚠️ `destroy()` provoque lui-même un `webglcontextlost` (il force la perte
    // du contexte pour le rendre au navigateur) : l'écouteur part AVANT le
    // dispose, sinon tout démontage normal afficherait l'écran de panne.
    const onContextLost = () => setFailed('lost');
    const canvas = scene.renderer.domElement;
    canvas.addEventListener('webglcontextlost', onContextLost);

    return () => {
      canvas.removeEventListener('webglcontextlost', onContextLost);
      controller.scene = null;
      scene.dispose();
    };
  }, [controller]);

  // z-0 : le canvas WebGL reçoit les pointer events (raycasting). Le conteneur
  // CSS3D (pointer-events:none) et le HUD React (z supérieur) se superposent.
  return (
    <>
      <div ref={containerRef} className="absolute inset-0 z-0" />
      {failed && (
        // z-40 : au-dessus du HUD, sous le TutorialCoach (z-50) — même rang
        // qu'une Modal, ce qu'il est en pratique.
        <div className="absolute inset-0 z-40 flex flex-col items-center justify-center gap-4 bg-surface/95 px-6 text-center">
          <p className="text-lg font-semibold text-white">Le rendu 3D s&apos;est arrêté</p>
          <p className="max-w-md text-sm text-white/70">
            {failed === 'init'
              ? "Le navigateur n'a pas pu créer le contexte graphique. Recharge la page ; si le problème persiste, vérifie que l'accélération matérielle est activée."
              : 'Le contexte graphique a été perdu. Recharge la page pour reprendre.'}
          </p>
          <div className="flex gap-3">
            <Button variant="primary" onPointerDown={() => window.location.reload()}>Recharger</Button>
            <Button onPointerDown={() => useUiStore.getState().navigate('main_menu')}>Menu</Button>
          </div>
        </div>
      )}
    </>
  );
}
