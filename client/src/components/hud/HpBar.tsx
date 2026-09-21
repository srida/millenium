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

export default function HpBar({ value, lag, delta, side, max = HP_MAX, className = '' }: {
  value: number;
  lag: number;
  delta: number;
  side: 'player' | 'enemy';
  max?: number;
  className?: string;
}) {
  const label = hpDeltaLabel(delta);

  return (
    <div className={`relative ${className}`}>
      <div className="relative h-2 overflow-hidden rounded-full bg-black/50">
        {/* La traîne, DERRIÈRE le remplissage : sur un GAIN elle est plus courte
            que lui et disparaît donc d'elle-même — aucun cas particulier à
            écrire pour distinguer un soin d'un coup. */}
        <div
          className="hp-lag absolute inset-y-0 left-0"
          style={{ width: `${hpRatio(lag, max) * 100}%` }}
          aria-hidden="true"
        />
        <div
          className={`hp-fill absolute inset-y-0 left-0 rounded-full ${side === 'player' ? 'bg-player' : 'bg-enemy'}`}
          style={{ width: `${hpRatio(value, max) * 100}%` }}
        />
      </div>
      {/* Le montant encaissé, le temps de le lire. Ancré du côté de l'avatar de
          son camp — au milieu, les deux se disputeraient le centre du HUD. */}
      {label && (
        <span
          className={`hp-delta pointer-events-none absolute -top-3.5 text-[10px] font-bold tabular-nums ${
            delta > 0 ? 'text-success' : 'text-danger'
          } ${side === 'player' ? 'left-0' : 'right-0'}`}
        >
          {label}
        </span>
      )}
    </div>
  );
}
