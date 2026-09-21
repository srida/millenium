// Le volet de passage d'une phase à l'autre : préparation → combat, puis
// récapitulatif → Phase Shopping.
//
// ⚠️ Le Shopping reste MUET : deux bandes qui balaient l'écran, rien d'autre.
// Son titre de modale s'annonce déjà lui-même, et rien n'est superposé dessus
// au même instant — une seconde façon de le dire ne pourrait que le répéter.
//
// ⚠️ Combat, lui, PORTE le mot « COMBAT » (motif « Faille runique » : deux
// sceaux aux couleurs des joueurs qui se rejoignent au centre, la faille qui
// s'ouvre, le mot qui claque). Il se pose EN MÊME TEMPS que `TerrainAlert`
// (`GameController._beginCombatAnimation`) et passe par-dessus elle pendant
// toute sa durée : le mot recouvre alors la carte de terrain. C'est un choix
// assumé — le motif choisi en dc.html demandait le mot — pas un oubli du fait
// qu'une version antérieure de ce volet l'avait justement retiré pour cette
// raison.
//
// ⚠️ Il ne PILOTE rien et ne RETIENT rien — ni son minuteur (il vit dans
// `GameController`, comme ceux de l'annonce de terrain et de l'ouverture de
// tour), ni l'état qu'il découvre : celui-ci est déjà publié quand le volet
// apparaît. C'est la différence de fond avec `TerrainAlert`, qui tient le
// premier coup, et avec la frappe finale, qui tient le récapitulatif.
//
// ⚠️ `pointer-events-none` sur TOUTE la couche : le volet de combat passe
// par-dessus l'annonce de terrain, qui est justement tapable pendant ce
// temps-là. Un volet qui capte les taps rendrait la règle « le tap passe
// l'annonce » fausse pendant toute sa durée.
//
// ⚠️ `z-40` comme les autres couches de partie, pas plus : `TutorialCoach` est
// en `z-50` avec sa bulle tapable.
import { useGameStore } from '../../stores/gameStore.js';
import { COMBAT_INTRO_MS, SHOPPING_INTRO_MS } from '../../game/timings.js';

const WIPE: Record<'combat' | 'shopping', { durationMs: number; className: string }> = {
  combat:   { durationMs: COMBAT_INTRO_MS,   className: 'phase-wipe-combat' },
  shopping: { durationMs: SHOPPING_INTRO_MS, className: 'phase-wipe-shopping' },
};

// Les arcs qui giclent du point de jonction des deux sceaux — angles et
// rayons répartis à la main plutôt qu'au hasard, pour que le motif soit
// identique à chaque combat au lieu de gigoter d'une manche à l'autre.
// Miroir de `ring(12, 22, 44, 3)` du prototype `millenium-phase-transition.js`
// (bundle Claude Design « Faille runique »).
const RIFT_ARC_COUNT = 12;
const RIFT_ARCS = Array.from({ length: RIFT_ARC_COUNT }, (_, i) => {
  const jitter = (((i * 37) % 11) - 5) * (3 / 5);
  const radiusPct = 22 + (((i * 7) % RIFT_ARC_COUNT) / RIFT_ARC_COUNT) * (44 - 22);
  return { angleDeg: i * (360 / RIFT_ARC_COUNT) + jitter, radiusFrac: radiusPct / 100 };
});

export default function PhaseWipe() {
  const wipe = useGameStore(s => s.phaseWipe);
  if (!wipe) return null;
  const { durationMs, className } = WIPE[wipe.kind];

  return (
    <div
      className={`phase-wipe pointer-events-none fixed inset-0 z-40 overflow-hidden ${className}`}
      style={{ ['--phase-wipe-dur' as string]: `${durationMs}ms` }}
      aria-hidden="true"
    >
      {wipe.kind === 'combat' ? <CombatRift /> : <ShoppingBands />}
    </div>
  );
}

/* Deux bandes qui se croisent en sens inverse. L'écran n'est couvert qu'à
   l'instant où elles se rejoignent, et c'est tout l'intérêt : ce qui vient
   ensuite est DÉCOUVERT au lieu d'apparaître d'un coup. Un voile qui s'allume
   et s'éteint sur place donnerait un clignotement, cinq fois par partie. */
function ShoppingBands() {
  return (
    <>
      <div className="phase-wipe-band phase-wipe-band-top" />
      <div className="phase-wipe-band phase-wipe-band-bottom" />
    </>
  );
}

/* Le motif « Faille runique » : un sceau par joueur, aux couleurs déjà lues
   partout ailleurs (`--color-player` / `--color-enemy`), qui glissent l'un
   vers l'autre et se superposent au centre ; la faille s'ouvre à la verticale
   et balaie l'écran ; le mot claque au moment où elle est à son plus large. */
function CombatRift() {
  return (
    <div className="phase-wipe-rift">
      <div className="phase-wipe-rift-veil" />
      <RiftSeal cssVar="--color-player" />
      <div className="phase-wipe-rift-mirror">
        <RiftSeal cssVar="--color-enemy" />
      </div>
      <div className="phase-wipe-rift-crack" />
      {RIFT_ARCS.map((arc, i) => (
        <div
          key={i}
          className="phase-wipe-rift-arc"
          style={{
            ['--phase-wipe-rift-ang' as string]: `${arc.angleDeg.toFixed(1)}deg`,
            ['--phase-wipe-rift-rad' as string]: `calc(var(--phase-wipe-rift-u) * ${arc.radiusFrac.toFixed(4)})`,
          }}
        />
      ))}
      <div className="phase-wipe-rift-flash" />
      <div className="phase-wipe-rift-word">COMBAT</div>
    </div>
  );
}

function RiftSeal({ cssVar }: { cssVar: string }) {
  return (
    <div className="phase-wipe-rift-seal" style={{ ['--phase-wipe-rift-c' as string]: `var(${cssVar})` }}>
      <span className="phase-wipe-rift-seal-ring-a" />
      <span className="phase-wipe-rift-seal-ring-b" />
      <span className="phase-wipe-rift-seal-core" />
    </div>
  );
}
