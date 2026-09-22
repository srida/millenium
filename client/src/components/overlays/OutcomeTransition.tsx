// L'écran de fin de partie (bundle Claude Design `millenium-outcome-transition.js`) :
// un voile qui s'assombrit, l'issue qui claque en lettres géantes, un filet
// d'or sous le mot — puis le menu (fourni par l'appelant) qui se révèle.
//
// Trois grammaires visuelles, une par issue : la VICTOIRE fait gicler rayons,
// anneau de choc et pièces d'or ; la DÉFAITE fait chuter fissures, poussière
// et cendres ; l'ÉGALITÉ reprend la même chute, en gris plutôt qu'en violet.
// Comme `PhaseWipe`, tout est calé sur une seule unité d'échelle (`--u`) qui
// suit la largeur mais est plafonnée par la hauteur — aucune media query de
// mise en page : web, tablette, mobile, portrait et paysage se règlent
// d'eux-mêmes (cf. `styles/outcomeTransition.css`).
//
// ⚠️ Contrairement à `PhaseWipe`, cet écran NE SE REFERME PAS tout seul : il
// s'ouvre en fondu et reste affiché, le temps que le joueur lise son menu de
// fin de partie (rejouer, quitter…) — c'est `GameOverScreen` qui le referme,
// en démontant tout (`gameOver` repasse à `false` au round suivant).
//
// ⚠️ Le fondu d'entrée (`is-playing`, posé une frame après le montage) existe
// pour la même raison que dans le prototype d'origine : sans lui, la classe
// serait déjà là au premier paint et le navigateur n'aurait rien à partir de
// quoi transitionner.
import { useEffect, useState, type ReactNode } from 'react';

export type Outcome = 'win' | 'lose' | 'draw';

const LABELS: Record<Outcome, string> = { win: 'VICTOIRE', lose: 'DÉFAITE', draw: 'ÉGALITÉ' };

// Répartition déterministe d'un anneau de particules — angles et rayons
// répartis à la main plutôt qu'au hasard, pour que le motif soit identique à
// chaque partie au lieu de gigoter d'une manche à l'autre. Même calcul que
// `PhaseWipe.ring` et le prototype d'origine (`ring(n, rMin, rMax, spread)`),
// mais les rayons restent ici des multiples DIRECTS de `--u` (comme dans le
// prototype) : cette unité est déjà une petite fraction de l'écran, pas la
// dimension pleine que `--phase-wipe-*-u` utilise.
function ring(n: number, rMin: number, rMax: number, spread: number) {
  return Array.from({ length: n }, (_, i) => {
    const jitter = (((i * 37) % 11) - 5) * (spread / 5);
    const r = rMin + (((i * 7) % n) / n) * (rMax - rMin);
    return { angleDeg: i * (360 / n) + jitter, radius: r };
  });
}

const COINS = ring(16, 18, 44, 4);
const SPARKS = ring(16, 22, 48, 3);
const DUST = ring(14, 14, 38, 5);
const ASHES = Array.from({ length: 18 }, (_, i) => ({
  leftPct: ((i * 53) % 97) + 2,
  durationMs: 2600 + ((i * 311) % 2200),
  delayMs: (i * 197) % 2400,
}));

function particleStyle(p: { angleDeg: number; radius: number }) {
  return {
    ['--ang' as string]: `${p.angleDeg.toFixed(1)}deg`,
    ['--rad' as string]: `calc(${p.radius.toFixed(1)} * var(--u))`,
  };
}

export default function OutcomeTransition({
  result, duration = 1500, label, children,
}: {
  result: Outcome;
  duration?: number;
  label?: string;
  children: ReactNode;
}) {
  const [playing, setPlaying] = useState(false);
  useEffect(() => {
    const raf = requestAnimationFrame(() => setPlaying(true));
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div
      className={`outcome-fx${playing ? ' is-playing' : ''}`}
      data-result={result}
      style={{ ['--dur' as string]: `${duration}ms` }}
    >
      <div className="outcome-fx-stage">
        <div className="outcome-fx-layer outcome-fx-veil" />
        <div className="outcome-fx-layer outcome-fx-vignette" />
        <div className="outcome-fx-layer outcome-fx-rays" />
        <div className="outcome-fx-layer outcome-fx-flash" />
        <div className="outcome-fx-layer outcome-fx-ring" />
        {COINS.map((p, i) => <div key={`coin${i}`} className="outcome-fx-layer outcome-fx-coin" style={particleStyle(p)} />)}
        {SPARKS.map((p, i) => <div key={`spark${i}`} className="outcome-fx-layer outcome-fx-spark" style={particleStyle(p)} />)}
        <div className="outcome-fx-layer outcome-fx-shard" />
        <div className="outcome-fx-layer outcome-fx-shard outcome-fx-shard-b" />
        {DUST.map((p, i) => <div key={`dust${i}`} className="outcome-fx-layer outcome-fx-dust" style={particleStyle(p)} />)}
        {ASHES.map((a, i) => (
          <div
            key={`ash${i}`}
            className="outcome-fx-layer outcome-fx-ash"
            style={{ left: `${a.leftPct}%`, animationDuration: `${a.durationMs}ms`, animationDelay: `${a.delayMs}ms` }}
          />
        ))}
        <div className="outcome-fx-copy">
          <p className="outcome-fx-word">{label || LABELS[result]}</p>
          <div className="outcome-fx-rule" />
          <div className="outcome-fx-menu">{children}</div>
        </div>
      </div>
    </div>
  );
}
