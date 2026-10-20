// La hauteur réelle de l'appli installée sur iOS.
//
// ⚠️ En appli installée (`display-mode: standalone`) avec
// `apple-mobile-web-app-status-bar-style: black-translucent`, iOS donne AU
// LANCEMENT un viewport trop court de très exactement `safe-area-inset-top` :
// le contenu est posé à y=0 mais reçoit la hauteur qu'il aurait eue sous la
// barre d'état. `100dvh` (et `innerHeight`) mentent donc, et le footer flottait
// ~60 pt au-dessus du bas réel. Une rotation aller-retour remet tout d'aplomb —
// c'est la signature du bug, pas un réglage à nous.
//
// La hauteur de l'ÉCRAN, elle, ne ment pas : une appli installée occupe tout
// l'écran. On la publie dans `--app-h`, lue par la racine de l'App
// (`h-[var(--app-h,100dvh)]`), et UNIQUEMENT quand le viewport est plus court
// qu'elle — partout ailleurs (navigateur, Android, viewport déjà juste après
// une rotation), la variable est retirée et `100dvh` reprend la main.
//
// ⚠️ Depuis le passage en `default` (index.html, dégradé d'iOS 27), le viewport
// d'une appli installée est LÉGITIMEMENT plus court que l'écran : la barre
// d'état est réservée. Forcer la hauteur de l'écran ferait alors déborder
// l'appli d'autant par le bas. Le correctif ne vaut donc que si le contenu
// passe SOUS la barre d'état (`safe-area-inset-top > 0`), c'est-à-dire pour une
// appli installée avant le changement — la meta est figée à l'installation.

export interface ViewportSample {
  standalone: boolean;
  screenW: number;
  screenH: number;
  innerW: number;
  innerH: number;
  /** `env(safe-area-inset-top)` en px : 0 quand iOS réserve la barre d'état. */
  insetTop: number;
}

/** La hauteur à imposer, ou `null` pour laisser `100dvh`. Pur, donc testable. */
export function fullScreenHeight(v: ViewportSample): number | null {
  if (!v.standalone) return null;
  if (v.insetTop <= 0) return null;  // barre d'état réservée : le viewport est juste
  // iOS ne permute pas `screen.width/height` à la rotation : on raisonne sur
  // le petit et le grand côté, et c'est la largeur qui dit l'orientation.
  const short = Math.min(v.screenW, v.screenH);
  const long = Math.max(v.screenW, v.screenH);
  let expected: number;
  if (v.innerW === short) expected = long;       // portrait
  else if (v.innerW === long) expected = short;  // paysage
  else return null;                              // fenêtre partielle (iPad en Split View) : rien à déduire
  return v.innerH < expected ? expected : null;
}

function isStandalone(): boolean {
  const nav = navigator as Navigator & { standalone?: boolean };
  return nav.standalone === true || (window.matchMedia?.('(display-mode: standalone)').matches ?? false);
}

/** `env(safe-area-inset-top)` résolu, par une sonde posée le temps d'une lecture. */
function safeAreaTop(): number {
  const probe = document.createElement('div');
  probe.style.cssText = 'position:fixed;visibility:hidden;padding-top:env(safe-area-inset-top)';
  document.body.appendChild(probe);
  const px = parseFloat(getComputedStyle(probe).paddingTop) || 0;
  probe.remove();
  return px;
}

/** Pose `--app-h` et le tient à jour (rotation, redimensionnement). */
export function installViewportHeight(): void {
  if (typeof window === 'undefined') return;
  const apply = () => {
    const h = fullScreenHeight({
      standalone: isStandalone(),
      screenW: window.screen.width,
      screenH: window.screen.height,
      innerW: window.innerWidth,
      innerH: window.innerHeight,
      insetTop: safeAreaTop(),
    });
    const root = document.documentElement.style;
    if (h === null) root.removeProperty('--app-h');
    else root.setProperty('--app-h', `${h}px`);
  };
  apply();
  window.addEventListener('resize', apply);
  window.addEventListener('orientationchange', apply);
}
