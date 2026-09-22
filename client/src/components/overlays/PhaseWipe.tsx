// Le volet de passage d'une phase à l'autre : préparation → combat, puis
// récapitulatif → Phase Shopping.
//
// ⚠️ Shopping PORTE le mot « SHOPPING » (motif « Lancer de dés » : les deux
// mascottes qui arrivent en cadre, le flash, les deux dés qui roulent et
// s'arrêtent, le mot qui claque). Il recouvre l'écran pendant tout le volet et
// s'efface en révélant la popup de Shopping — publiée seulement à cet
// instant (`GameController._startShopping`, via `onDone`), pas dessous depuis
// le début : les dés ont quelque chose à cacher.
//
// ⚠️ Combat, lui, PORTE le mot « COMBAT » (motif « Faille runique » : deux
// sceaux aux couleurs des joueurs qui se rejoignent au centre, la faille qui
// s'ouvre, le mot qui claque). Une version antérieure de ce volet l'avait
// justement retiré parce qu'il recouvrait `TerrainAlert`, affichée en même
// temps — c'est pour ça que `GameController._beginCombatAnimation` RETARDE
// désormais l'annonce de terrain jusqu'à la fin du volet (`COMBAT_INTRO_MS`)
// au lieu de la publier en même temps : les deux ne se recouvrent plus, le mot
// garde sa place. Le plateau, lui, EST déjà publié quand le volet apparaît —
// rien à y découvrir de neuf, contrairement à Shopping.
//
// ⚠️ Il ne PILOTE rien lui-même et ne RETIENT rien EN PERMANENCE — ni son
// minuteur (il vit dans `GameController`, comme ceux de l'annonce de terrain
// et de l'ouverture de tour), ni l'état qu'il finit par découvrir : Combat le
// publie tout de suite (rien à cacher), Shopping ne le publie qu'à l'échéance
// du volet (`onDone` de `_playPhaseWipe`) — c'est la différence de fond avec
// `TerrainAlert`, qui tient le premier coup, et avec la frappe finale, qui
// tient le récapitulatif : ici c'est le volet LUI-MÊME qui tient la
// révélation, pas un état séparé.
//
// ⚠️ `pointer-events-none` sur TOUTE la couche : même retardée, l'annonce de
// terrain reste tapable pendant qu'elle est affichée. Un volet qui capte les
// taps rendrait la règle « le tap passe l'annonce » fausse.
//
// ⚠️ `z-40` comme les autres couches de partie, pas plus : `TutorialCoach` est
// en `z-50` avec sa bulle tapable.
import { useGameStore } from '../../stores/gameStore.js';
import { COMBAT_INTRO_MS, SHOPPING_INTRO_MS } from '../../game/timings.js';

const WIPE: Record<'combat' | 'shopping', { durationMs: number; className: string }> = {
  combat:   { durationMs: COMBAT_INTRO_MS,   className: 'phase-wipe-combat' },
  shopping: { durationMs: SHOPPING_INTRO_MS, className: 'phase-wipe-shopping-wrap' },
};

// Répartition déterministe d'un anneau de particules — angles et rayons
// répartis à la main plutôt qu'au hasard, pour que le motif soit identique à
// chaque partie au lieu de gigoter d'une manche à l'autre. Miroir exact de la
// fonction `ring(n, rMin, rMax, spread)` des deux prototypes Claude Design
// (`millenium-phase-transition.js` pour la faille, `millenium-shop-transition.js`
// pour les dés) — un seul calcul, deux motifs qui l'appellent.
function ring(n: number, rMin: number, rMax: number, spread: number) {
  return Array.from({ length: n }, (_, i) => {
    const jitter = (((i * 37) % 11) - 5) * (spread / 5);
    const radiusPct = rMin + (((i * 7) % n) / n) * (rMax - rMin);
    return { angleDeg: i * (360 / n) + jitter, radiusFrac: radiusPct / 100 };
  });
}

// Les arcs qui giclent du point de jonction des deux sceaux.
const RIFT_ARCS = ring(12, 22, 44, 3);

// Les pièces et les traits de lumière qui giclent à l'impact des dés.
const DICE_COINS = ring(14, 18, 42, 4);
const DICE_SPARKS = ring(16, 22, 46, 3);

// Les points des deux dés — position dans la grille 3×3, mêmes faces que le
// prototype (dé gauche : 5, dé droit : 6).
const DICE_PIPS_L = ['1/1', '1/3', '2/2', '3/1', '3/3'];
const DICE_PIPS_R = ['1/1', '1/3', '2/1', '2/3', '3/1', '3/3'];

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
      {wipe.kind === 'combat' ? <CombatRift /> : <ShoppingDice />}
    </div>
  );
}

/* Le motif « Lancer de dés » (bundle Claude Design `millenium-shop-transition.js`) :
   les deux mascottes arrivent en cadre, un flash claque au centre, pièces et
   traits de lumière giclent, les deux dés tombent et roulent jusqu'à l'arrêt,
   le mot « SHOPPING » claque à leur creux — puis tout s'efface et découvre la
   modale déjà publiée dessous, exactement comme `CombatRift` découvre le
   plateau.
   ⚠️ `.phase-wipe-dice-group` centre le mot ET la scène des dés EN BLOC, comme
   un seul objet — jamais chacun sur sa propre percentage de viewport. Sur un
   téléphone en portrait, `--phase-wipe-dice-u` (la plus petite dimension) vaut
   la LARGEUR, très inférieure à la hauteur : un `top:47%` posé sur la scène
   pointait alors vers un point bien au-DESSUS du milieu réel de l'écran,
   laissant tout le bas vide et le mot collé en haut — visible aux captures,
   invisible à la lecture du CSS. La scène (`.phase-wipe-dice-scene`) est un
   bloc de taille FIXE en `u` : les `top`/`left` en pourcentage de ses enfants
   (chars, dés, particules) restent inchangés, seule leur référence change. */
function ShoppingDice() {
  return (
    <div className="phase-wipe-dice">
      <div className="phase-wipe-dice-veil" />
      <div className="phase-wipe-dice-group">
        <div className="phase-wipe-dice-copy">
          <p className="phase-wipe-dice-word">SHOPPING</p>
          <div className="phase-wipe-dice-rule" />
        </div>
        <div className="phase-wipe-dice-scene">
          <div className="phase-wipe-dice-char phase-wipe-dice-char-l" />
          <div className="phase-wipe-dice-char phase-wipe-dice-char-r" />
          <div className="phase-wipe-dice-flash" />
          <div className="phase-wipe-dice-ring" />
          {DICE_COINS.map((p, i) => (
            <div
              key={i}
              className="phase-wipe-dice-coin"
              style={{
                ['--phase-wipe-dice-ang' as string]: `${p.angleDeg.toFixed(1)}deg`,
                ['--phase-wipe-dice-rad' as string]: `calc(var(--phase-wipe-dice-u) * ${p.radiusFrac.toFixed(4)})`,
              }}
            />
          ))}
          {DICE_SPARKS.map((p, i) => (
            <div
              key={i}
              className="phase-wipe-dice-spark"
              style={{
                ['--phase-wipe-dice-ang' as string]: `${p.angleDeg.toFixed(1)}deg`,
                ['--phase-wipe-dice-rad' as string]: `calc(var(--phase-wipe-dice-u) * ${p.radiusFrac.toFixed(4)})`,
              }}
            />
          ))}
          <div className="phase-wipe-dice-shadow phase-wipe-dice-shadow-l" />
          <div className="phase-wipe-dice-shadow phase-wipe-dice-shadow-r" />
          <DiceFace side="l" pips={DICE_PIPS_L} />
          <DiceFace side="r" pips={DICE_PIPS_R} />
        </div>
      </div>
    </div>
  );
}

function DiceFace({ side, pips }: { side: 'l' | 'r'; pips: string[] }) {
  return (
    <div className={`phase-wipe-dice-die phase-wipe-dice-die-${side}`}>
      {pips.map((area, i) => (
        <span key={i} className="phase-wipe-dice-pip" style={{ gridArea: area }} />
      ))}
    </div>
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
