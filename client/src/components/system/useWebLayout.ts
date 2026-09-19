// « Mode web » : écran au moins aussi large que haut — desktop, tablettes, et
// téléphones en paysage (le paysage n'est plus bloqué : il réutilise ce mode).
//
// Le même seuil d'aspect pilote le cadrage caméra (Scene3D._cameraFraming) : les
// deux doivent rester d'accord, sinon les rails latéraux recouvriraient le board.
import { useEffect, useState } from 'react';

const WEB_QUERY = '(min-aspect-ratio: 1/1)';

/**
 * Requête média générique — même patron que `useWebLayout`, pour une requête
 * arbitraire. Sert à distinguer téléphone et tablette À L'INTÉRIEUR d'un même
 * mode (paysage), ce que l'aspect ratio seul ne peut pas trancher (un
 * téléphone en paysage est aussi large que haut qu'une tablette).
 */
export function useMediaQuery(query: string): boolean {
  const [match, setMatch] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const update = () => setMatch(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, [query]);
  return match;
}

export function useWebLayout(): boolean {
  return useMediaQuery(WEB_QUERY);
}

/**
 * Tablette (desktop compris) vs téléphone en paysage — même seuil que
 * `TABLET_BREAKPOINT_PX` (`three/constants.ts`), qui pose la même question
 * côté caméra 3D. Les deux gardent leur propre nombre plutôt qu'un import
 * commun (React ↔ `three/` ne se traversent pas), donc à resynchroniser à la
 * main si l'un change.
 */
const TABLET_QUERY = '(min-width: 700px) and (min-height: 700px)';

export function useTabletLayout(): boolean {
  return useMediaQuery(TABLET_QUERY);
}
