// Jauge d'énergie du tour : ce que le plateau occupe (cases éteintes), ce qui
// reste à poser (cases dorées) et, après un séparateur, la RÉSERVE (hachurée),
// qui paie mulligan, reroll et boutique. Préparation seulement.
//
// Deux orientations : horizontale sous la manche (paysage, tablette portrait),
// verticale au bord droit (téléphone portrait, où la largeur manque). Ce qu'il
// faut dessiner vient de `gaugeModel`, pur et testé.
import UiIcon from '../ui/UiIcon.js';
import { useGameStore } from '../../stores/gameStore.js';
import { gaugeModel } from './energyGauge.js';

// ⚠️ Classes en CONSTANTES, jamais composées dans un gabarit `${}` : leurs
// valeurs arbitraires portent des virgules, et Tailwind ne les extrait plus
// dès qu'un `${}` apparaît dans le même littéral (cf. `classname_header`).
const CELL_USED = 'rounded-[2px] bg-white/[0.07] shadow-[inset_0_0_0_1px_var(--color-line)]';
const CELL_FREE = 'rounded-[2px] bg-gold shadow-[0_0_6px_rgba(212,175,97,.55)]';
const CELL_RESERVE = 'rounded-[2px] bg-[repeating-linear-gradient(135deg,var(--color-gold)_0_2px,#7a6236_2px_4px)]';

export default function EnergyGauge({ orientation, compact = false, className = '' }: {
  orientation: 'horizontal' | 'vertical';
  /** Sans le mot « RÉSERVE » (téléphone en paysage, 240 px). */
  compact?: boolean;
  className?: string;
}) {
  const energyLeft = useGameStore(s => s.energyLeft);
  const energyBudget = useGameStore(s => s.energyBudget);
  const energyReserve = useGameStore(s => s.energyReserve);
  const combatActive = useGameStore(s => s.combatActive);
  if (combatActive) return null;

  const m = gaugeModel(energyLeft, energyBudget, energyReserve);
  const vertical = orientation === 'vertical';
  const label = `Énergie : ${energyLeft} sur ${energyBudget}, réserve ${energyReserve}. Chaque unité posée occupe son tier ; ce qui reste part en réserve.`;
  const leftColor = m.empty ? 'text-white/40' : 'text-gold';
  const reserveColor = m.reserve > 0 ? 'text-gold/85' : 'text-white/35';

  // Une case : `flex-1` en rangée ; en colonne, 14 px qui rétrécissent quand
  // elles sont nombreuses (manche 5 + grosse réserve). ⚠️ Pas d'espaceur
  // `flex-1` dans la colonne : il écraserait les cases.
  const cell = vertical ? 'min-h-[2px] flex-[0_1_14px] ' : 'flex-1 ';
  const cells = [
    ...Array.from({ length: m.used }, (_, i) => <span key={'u' + i} className={cell + CELL_USED} />),
    ...Array.from({ length: m.free }, (_, i) => <span key={'f' + i} className={cell + CELL_FREE} />),
  ];
  if (m.reserve > 0) {
    cells.push(<span key="sep" className={vertical ? '-mx-1 my-0.5 h-0.5 shrink-0 bg-white/25' : 'h-4 w-0.5 shrink-0 self-center bg-white/25'} />);
    if (m.reserveMerged) {
      cells.push(<span key="rm" className={(vertical ? 'min-h-[14px] shrink basis-[140px] ' : 'flex-[10] ') + CELL_RESERVE} />);
    } else {
      for (let i = 0; i < m.reserveCells; i++) cells.push(<span key={'r' + i} className={cell + CELL_RESERVE} />);
    }
  }

  if (vertical) {
    return (
      <div role="status" aria-label={label} className={'pointer-events-none flex w-10 flex-col items-center gap-1.5 rounded-lg border border-line bg-surface/85 py-1.5 ' + className}>
        <UiIcon id="UI_ENERGY" className="h-3.5 w-3.5" />
        <span className="flex flex-col items-center leading-none">
          <span className={'text-base font-bold tabular-nums ' + leftColor}>{energyLeft}</span>
          <span className="text-[10px] font-normal tabular-nums text-white/50">/{energyBudget}</span>
        </span>
        <span className="flex h-[300px] w-3.5 flex-col-reverse justify-start gap-0.5">{cells}</span>
        <span className="flex flex-col items-center leading-none">
          <span className={'text-xs font-bold tabular-nums ' + reserveColor}>+{m.reserve}</span>
          <span className="mt-0.5 text-[8px] tracking-widest text-white/45">RÉS.</span>
        </span>
      </div>
    );
  }

  return (
    <div role="status" aria-label={label} className={'pointer-events-none flex items-center gap-2 rounded-md border border-line bg-surface/85 px-2 py-1 ' + className}>
      <span className="flex shrink-0 items-center gap-0.5 text-xs tabular-nums">
        <UiIcon id="UI_ENERGY" className="h-3.5 w-3.5" />
        <span className={'font-bold ' + leftColor}>{energyLeft}</span>
        <span className="font-normal text-white/50">/{energyBudget}</span>
      </span>
      <span className="flex h-2.5 min-w-0 flex-1 items-stretch gap-0.5">{cells}</span>
      <span className="flex shrink-0 items-baseline gap-1">
        <span className={'text-xs font-bold tabular-nums ' + reserveColor}>+{m.reserve}</span>
        {!compact && <span className="text-[8px] tracking-widest text-white/45">RÉSERVE</span>}
      </span>
    </div>
  );
}
