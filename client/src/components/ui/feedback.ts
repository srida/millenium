// Retour haptique + sonore des contrôles du jeu — UN SEUL point d'émission,
// appelé par `usePressSquash` (donc par `Button`, `IconButton` en mode
// `compact`, et tout ce qui s'en sert : cartes de deck du `DeckSelector`,
// tuiles du catalogue, onglets…). Le relief visuel (`SHADOW_SQUASHED`) reste
// la source PRINCIPALE de retour sur iOS, où ni la vibration ni le son ne
// sont garantis (Safari iOS n'implémente pas `navigator.vibrate`, et le son
// exige un premier geste utilisateur pour se débloquer).
//
// ⚠️ Rien n'est lu ici au chargement du module : `navigator`/`window` ne sont
// touchés que dans le corps des fonctions, jamais au niveau module — sinon la
// suite de test (environnement `node`, sans DOM) échouerait à l'import sur
// n'importe quel fichier qui remonte jusqu'à `primitives.tsx`.

let audioCtx: AudioContext | null = null;

function getAudioCtx(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  if (!audioCtx) {
    try { audioCtx = new Ctor(); } catch { return null; }
  }
  return audioCtx;
}

/**
 * Vibration courte — no-op silencieux là où l'API n'existe pas (Safari iOS
 * ne l'implémente pas du tout) ou la refuse (hors geste utilisateur). C'est
 * pour ça que le retour visuel et sonore ne peuvent pas compter sur elle.
 */
export function playHaptic(pattern: number | number[] = 10) {
  try {
    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') navigator.vibrate(pattern);
  } catch { /* API absente ou refusée : aucun effet, jamais d'erreur remontée */ }
}

/**
 * Clic synthétisé au Web Audio — pas de fichier à charger ni à bundler,
 * et donc rien qui puisse manquer à l'appel. Enveloppe courte (< 70 ms) en
 * dents de scie douce, pensée pour ne jamais couvrir un enchaînement rapide
 * de taps (menus, DeckBuilder).
 *
 * ⚠️ L'`AudioContext` naît `suspended` tant qu'aucun geste utilisateur ne
 * l'a débloqué (iOS en particulier) : `resume()` est retenté à CHAQUE appel,
 * pas une seule fois au montage — c'est le `pointerdown` du tap lui-même qui
 * sert de geste déclencheur.
 */
export function playClick() {
  const ctx = getAudioCtx();
  if (!ctx) return;
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});

  const now = ctx.currentTime;
  const duration = 0.05;
  const osc = ctx.createOscillator();
  const env = ctx.createGain();
  osc.type = 'triangle';
  osc.frequency.setValueAtTime(880, now);
  osc.frequency.exponentialRampToValueAtTime(520, now + duration);
  env.gain.setValueAtTime(0, now);
  env.gain.linearRampToValueAtTime(0.06, now + 0.004);
  env.gain.exponentialRampToValueAtTime(0.0001, now + duration);
  osc.connect(env).connect(ctx.destination);
  osc.start(now);
  osc.stop(now + duration + 0.02);
}

/** Le geste complet d'un tap de bouton : vibration + clic, un seul appel. */
export function playButtonFeedback() {
  playHaptic(10);
  playClick();
}

function isIos(): boolean {
  if (typeof navigator === 'undefined') return false;
  if (/iPad|iPhone|iPod/.test(navigator.userAgent)) return true;
  // iPadOS se présente en Mac de bureau depuis iPadOS 13 : le tactile multipoint
  // est ce qui le distingue d'un vrai Mac (`ios-haptics`, tijnjh/ios-haptics).
  return navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
}

/**
 * Le VRAI déclic du Taptic Engine — `navigator.vibrate` n'existe sur AUCUNE
 * version de Safari iOS, c'est la seule brèche connue pour en obtenir un
 * depuis le web (technique de https://github.com/tijnjh/ios-haptics) :
 * Safari 17.4+ donne un déclic Taptic natif à un `<input type="checkbox"
 * switch>` quand un geste utilisateur RÉEL le bascule (`.click()` en JS ne
 * déclenche rien — il faut le vrai tap). On pose donc un switch INVISIBLE,
 * en calque `absolute inset-0` par-dessus l'élément, pour que le tap du
 * joueur l'actionne EN MÊME TEMPS que le bouton lui-même.
 *
 * ⚠️ Un `<input>` (contenu interactif) dans un `<button>` est un nesting que
 * le modèle de contenu HTML interdit — tous les moteurs le rendent quand
 * même (pas de reparenting comme sur une `<table>`), et `aria-hidden` +
 * `tabIndex=-1` le retirent de l'arbre d'accessibilité. C'est un HACK
 * assumé, documenté comme tel : aucune API standard n'offre de vrai retour
 * haptique au web sur iOS.
 *
 * ⚠️ Idempotent (`data-ios-haptic-switch`) : à rappeler sans risque à chaque
 * montage (React StrictMode double l'effet de montage en dev).
 *
 * ⚠️ Une seule intensité, non paramétrable — Safari ne donne qu'un déclic de
 * bascule, pas un choix léger/moyen/fort comme l'API Taptic native iOS.
 */
export function attachIosHapticSwitch(el: HTMLElement | null) {
  if (!el || typeof document === 'undefined' || !isIos()) return;
  if (el.querySelector('[data-ios-haptic-switch]')) return;
  if (typeof window !== 'undefined' && window.getComputedStyle(el).position === 'static') {
    el.style.position = 'relative';
  }
  const sw = document.createElement('input');
  sw.type = 'checkbox';
  sw.setAttribute('switch', '');
  sw.setAttribute('data-ios-haptic-switch', '');
  sw.setAttribute('aria-hidden', 'true');
  sw.tabIndex = -1;
  Object.assign(sw.style, {
    position: 'absolute',
    inset: '0',
    width: '100%',
    height: '100%',
    margin: '0',
    opacity: '0',
    clipPath: 'inset(0 round 999px)',
    touchAction: 'manipulation',
  });
  sw.style.setProperty('-webkit-tap-highlight-color', 'transparent');
  el.appendChild(sw);
}
