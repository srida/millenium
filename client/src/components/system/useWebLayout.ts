// « Mode web » : écran au moins aussi large que haut. Les téléphones en paysage
// sont interceptés en amont par LandscapeOverlay (max-width: 900px), donc en
// pratique seuls desktop et tablettes matchent.
//
// Le même seuil d'aspect pilote le cadrage caméra (Scene3D._cameraFraming) : les
// deux doivent rester d'accord, sinon les rails latéraux recouvriraient le board.
import { useEffect, useState } from 'react';

const WEB_QUERY = '(min-aspect-ratio: 1/1)';

export function useWebLayout(): boolean {
  const [web, setWeb] = useState(() => window.matchMedia(WEB_QUERY).matches);
  useEffect(() => {
    const mq = window.matchMedia(WEB_QUERY);
    const update = () => setWeb(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);
  return web;
}
