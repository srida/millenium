// La barre de vie d'un camp — la jauge, sa traîne, et ce qu'elle vient
// d'encaisser.
//
// Elle remplace le `Gauge` générique du HUD pour une seule raison : les PV d'un
// joueur ne se contentent pas de valoir quelque chose, ils ENCAISSENT. Une
// jauge qui glisse en 300 ms montre le résultat d'un coup dont il ne reste
// aucune trace ; ici la TRAÎNE reste un instant sur la valeur d'avant, et c'est
// elle qui dit combien vient de partir. C'est ce que la frappe finale de fin de
// combat donne à regarder (cf. `GameController._beginCombatOutro`).
//
// ⚠️ Toute la décision vit dans `hpBar.ts` (pur, éprouvé en node) : ce fichier
// ne fait que la rendre. La suite tourne SANS DOM — aucun test de composant
// n'est possible dans ce projet.
import { useEffect, useRef, useState } from 'react';
import {
  HP_MAX, HP_TWEEN_MS, HP_LAG_HOLD_MS, HP_DELTA_MS,
  hpRatio, hpDeltaLabel, hpTweenValue,
} from './hpBar.js';

export interface HpTransition {
  /** Le chiffre en cours de décompte — c'est LUI que le HUD affiche. */
  shown: number;
  /** La valeur que la traîne porte encore. */
  lag: number;
  /** Ce qui vient d'être encaissé (ou rendu), le temps de l'annoncer. */
  delta: number;
}

/**
 * Le décompte du chiffre et la traîne de la jauge, tenus par une seule mesure
 * du temps.
 *
 * ⚠️ `prefers-reduced-motion` retire le MOUVEMENT, pas l'information : le
 * chiffre saute à sa valeur et la traîne ne traîne plus, mais le montant
 * encaissé reste annoncé — c'est précisément ce que le mouvement servait à
 * dire.
 *
 * ⚠️ Appelé par le HUD, pas par la barre : le chiffre et la jauge sont deux
 * coins opposés de la même ligne (l'un près de l'avatar, l'autre en dessous), et
 * ils doivent compter sur la MÊME horloge. Deux transitions indépendantes
 * finiraient par ne plus dire la même chose.
 */
export function useHpTransition(value: number): HpTransition {
  const [shown, setShown] = useState(value);
  const [lag, setLag] = useState(value);
  const [delta, setDelta] = useState(0);
  const prev = useRef(value);

  useEffect(() => {
    const from = prev.current;
    prev.current = value;
    if (from === value) return;
    setDelta(value - from);

    const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    const hideDelta = setTimeout(() => setDelta(0), HP_DELTA_MS);
    // La traîne tient sur la valeur d'avant, puis rattrape. ⚠️ Elle n'est JAMAIS
    // remise sur `from` : sur deux coups rapprochés elle est encore sur la
    // valeur d'origine et continue de descendre de là — la remettre en place
    // ferait remonter la barre entre deux dégâts.
    const catchUp = setTimeout(() => setLag(value), reduced ? 0 : HP_LAG_HOLD_MS);
    const done = () => { clearTimeout(hideDelta); clearTimeout(catchUp); };

    if (reduced) { setShown(value); return done; }

    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const p = Math.min((now - start) / HP_TWEEN_MS, 1);
      setShown(hpTweenValue(from, value, p));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(raf); done(); };
  }, [value]);

  return { shown, lag, delta };
}

/**
 * La barre d'un camp, façon jeu de combat : biseautée vers le centre, le
 * chiffre DANS la barre, du côté de l'avatar — et c'est de ce côté qu'elle se
 * remplit, donc elle se vide vers l'avatar.
 */
export default function HpBar({ value, shown, lag, side, max = HP_MAX, className = '' }: {
  value: number;
  /** Le chiffre en cours de décompte (`HpTransition.shown`). */
  shown: number;
  lag: number;
  side: 'player' | 'enemy';
  max?: number;
  className?: string;
}) {
  const anchor = side === 'player' ? 'left-0' : 'right-0';
  return (
    <div className={`hp-frame-${side} relative h-6 bg-[#0b0b0d] ${className}`}>
      <div className={`hp-inner-${side} absolute inset-y-[3px] overflow-hidden bg-[#1a1d27] ${side === 'player' ? 'left-0 right-[3px]' : 'left-[3px] right-0'}`}>
        {/* La traîne, DERRIÈRE le remplissage : sur un GAIN elle est plus courte
            que lui et disparaît donc d'elle-même — aucun cas particulier à
            écrire pour distinguer un soin d'un coup. */}
        <div
          className={`hp-lag absolute inset-y-0 ${anchor}`}
          style={{ width: `${hpRatio(lag, max) * 100}%` }}
          aria-hidden="true"
        />
        <div
          className={`hp-fill hp-fill-${side} absolute inset-y-0 ${anchor}`}
          style={{ width: `${hpRatio(value, max) * 100}%` }}
        />
        <div className="absolute inset-x-0 top-0.5 h-[3px] bg-white/20" aria-hidden="true" />
        <span className={`absolute top-1/2 -translate-y-1/2 text-sm font-bold leading-none tabular-nums text-white ${side === 'player' ? 'left-3.5' : 'right-3.5'}`}>
          {shown}
        </span>
      </div>
    </div>
  );
}

/**
 * Le montant encaissé, le temps de le lire — sous la barre, côté centre.
 * Séparé de la barre parce qu'il partage sa ligne avec le joker du camp.
 */
export function HpDelta({ delta }: { delta: number }) {
  const label = hpDeltaLabel(delta);
  if (!label) return null;
  return (
    <span className={`hp-delta pointer-events-none text-xs font-bold leading-[14px] tabular-nums ${delta > 0 ? 'text-success' : 'text-danger'}`}>
      {label}
    </span>
  );
}
