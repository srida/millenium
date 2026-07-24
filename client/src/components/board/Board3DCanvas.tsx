// Board3DCanvas — unique pont React → Three. Possède le cycle de vie de la
// Scene3D : la crée au montage avec les callbacks du GameController, la détruit
// au démontage (dispose complet, cf. Phase 2). Aucun état React lié au rendu.
import { useEffect, useRef } from 'react';
import { Scene3D } from '../../three/Scene3D.js';
import type { GameController } from '../../game/GameController.js';

export default function Board3DCanvas({ controller }: { controller: GameController }) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const scene = new Scene3D(container, {
      showEnemySide: false,
      onCellTap: controller.onCellTap,
      onUnitTap: controller.onUnitTap,
      onUnitDrag: controller.onUnitDrag,
      onUnitLongPress: controller.onUnitLongPress,
    });
    controller.attachScene(scene);

    return () => {
      controller.scene = null;
      scene.dispose();
    };
  }, [controller]);

  // z-0 : le canvas WebGL reçoit les pointer events (raycasting). Le conteneur
  // CSS3D (pointer-events:none) et le HUD React (z supérieur) se superposent.
  return <div ref={containerRef} className="absolute inset-0 z-0" />;
}
