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
