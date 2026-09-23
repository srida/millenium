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

export interface ViewportSample {
  standalone: boolean;
  screenW: number;
  screenH: number;
  innerW: number;
  innerH: number;
}

/** La hauteur à imposer, ou `null` pour laisser `100dvh`. Pur, donc testable. */
export function fullScreenHeight(v: ViewportSample): number | null {
  if (!v.standalone) return null;
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
    });
    const root = document.documentElement.style;
    if (h === null) root.removeProperty('--app-h');
    else root.setProperty('--app-h', `${h}px`);
  };
  apply();
  window.addEventListener('resize', apply);
  window.addEventListener('orientationchange', apply);
}
