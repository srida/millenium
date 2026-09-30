// Joue `timer_low` UNE fois quand un chrono franchit `TIMER_LOW_S` en
// descendant. Un seul endroit pour les quatre chronos (préparation, combat,
// shopping, récapitulatif) : c'est la transition qu'on détecte, jamais la
// valeur — un chrono qui repart de haut (phase neuve) ou qu'on monte déjà
// sous le seuil (remontage) ne sonne pas.
import { useEffect, useRef } from 'react';
import * as Audio from '../../audio/AudioManager.js';
import { TIMER_LOW_S } from './timerLow.js';

export function useTimerLowSound(remaining: number, enabled = true): void {
  const prev = useRef<number | null>(null);
  useEffect(() => {
    const before = prev.current;
    prev.current = enabled ? remaining : null;
    if (enabled && before !== null && before > TIMER_LOW_S && remaining <= TIMER_LOW_S) Audio.playSfx('timer_low');
  }, [remaining, enabled]);
}
