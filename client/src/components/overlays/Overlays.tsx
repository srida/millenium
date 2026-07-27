// Overlays de la partie : menu d'options d'invocation, résultat de round,
// fin de partie. La Phase Shopping vit dans components/shopping/.
import { useEffect, useRef, useState } from 'react';
import { useGameStore } from '../../stores/gameStore.js';
import { useUiStore } from '../../stores/uiStore.js';
import { Button, Modal } from '../ui/primitives.js';
import { END_ROUND_DURATION_S } from '../../game/timings.js';
import type { EndRoundResult } from '../../logic/GameSession.js';

export function SummonOptionMenu() {
  const menu = useGameStore(s => s.summonOptions);
  const controller = useGameStore(s => s.controller);
  if (!menu || !controller) return null;
  return (
    <Modal onClose={() => controller.cancelSelection()}>
      <div className="text-xs tracking-widest text-white/50">MODE D'INVOCATION</div>
      <div className="mb-2 text-base font-bold">{menu.card.name}</div>
      <div className="space-y-2">
        {menu.options.map(o => (
          <button
            key={o.index}
            disabled={!o.ok}
            onPointerDown={(e) => { e.stopPropagation(); controller.chooseSummonOption(o.index); }}
            className="flex w-full min-h-tap items-center justify-between rounded-lg border border-line bg-surface-raised px-3 text-sm disabled:opacity-40"
          >
            <span className="font-semibold text-gold">{o.label}</span>
            <span className="text-white/40">▸</span>
          </button>
        ))}
      </div>
      <Button className="mt-3 w-full" onPointerDown={(e) => { e.stopPropagation(); controller.cancelSelection(); }}>Annuler</Button>
    </Modal>
  );
}

export function EndRoundOverlay() {
  const endRound = useGameStore(s => s.endRound);
  const controller = useGameStore(s => s.controller);
  const round = useGameStore(s => s.round);
  const playerHp = useGameStore(s => s.playerHp);
  const enemyHp = useGameStore(s => s.enemyHp);
  const [countdown, setCountdown] = useState(END_ROUND_DURATION_S);
  // Un seul passage automatique par overlay : sans ce verrou, le 0 laissé par le
  // round précédent est encore l'état courant au premier rendu du round suivant
  // et l'effet ci-dessous congédiait l'overlay instantanément.
  const dismissed = useRef(false);

  useEffect(() => {
    if (!endRound) { dismissed.current = false; setCountdown(END_ROUND_DURATION_S); return; }
    setCountdown(END_ROUND_DURATION_S);
    const t = setInterval(() => {
      setCountdown(c => (c <= 1 ? 0 : c - 1));
    }, 1000);
    return () => clearInterval(t);
  }, [endRound]);

  // Déclenche le passage à la suite quand le compte à rebours atteint 0 —
  // hors du render (effet séparé) pour ne pas setState pendant le rendu.
  useEffect(() => {
    if (!endRound || countdown > 0 || dismissed.current) return;
    dismissed.current = true;
    controller?.dismissEndRound();
  }, [countdown, endRound, controller]);

  if (!endRound || !controller) return null;
  const { winner, isGameOver } = endRound;
  const title = winner === 'player' ? 'VICTOIRE DU ROUND' : winner === 'enemy' ? 'DÉFAITE DU ROUND' : 'ÉGALITÉ DU ROUND';
  const icon = winner === 'player' ? '⚡' : winner === 'enemy' ? '💀' : '⚖️';
  const tone = winner === 'player' ? 'text-success' : winner === 'enemy' ? 'text-danger' : 'text-gold';

  return (
    <Modal>
      <div className="flex flex-col items-center gap-1">
        <div className="text-4xl">{icon}</div>
        <div className={`text-lg font-bold ${tone}`}>{title}</div>
        <div className="my-2 flex items-center gap-4 text-sm">
          <span className="font-bold text-player tabular-nums">{playerHp} PV</span>
          <span className="text-white/40">VS</span>
          <span className="font-bold text-enemy tabular-nums">{enemyHp} PV</span>
        </div>
        <DamageBreakdown result={endRound} />
        <div className="mt-1 text-xs text-white/40">{countdown}s</div>
        <Button variant="primary" className="mt-1 w-full" onPointerDown={(e) => { e.stopPropagation(); controller.dismissEndRound(); }}>
          {isGameOver ? 'RÉSULTAT FINAL' : `TOUR ${round + 1} ▸`}
        </Button>
      </div>
    </Modal>
  );
}

function DamageBreakdown({ result }: { result: EndRoundResult }) {
  const survivors = result.winner === 'enemy' ? result.enemySurvivors : result.playerSurvivors;
  if (!survivors.length) return null;
  return (
    <div className="w-full rounded-lg border border-white/10 bg-white/5 p-2 text-[11px]">
      <div className="mb-1 tracking-widest text-white/40">SURVIVANTS</div>
      {survivors.map((u, i) => (
        <div key={i} className="flex justify-between"><span className="truncate text-white/70">{u.name}</span><span className="tabular-nums text-white/50">{u.atk}</span></div>
      ))}
    </div>
  );
}

/**
 * Fin de partie. `onExit` permet à l'appelant de détourner la sortie — le
 * Tournoi renvoie vers son bracket après avoir comptabilisé la manche, au lieu
 * de retomber sur le menu principal.
 */
export function GameOverScreen({ onExit, exitLabel = '◂ MENU PRINCIPAL' }: {
  onExit?: (winner: 'player' | 'enemy' | 'draw' | null) => void;
  exitLabel?: string;
} = {}) {
  const gameOver = useGameStore(s => s.gameOver);
  const winner = useGameStore(s => s.winner);
  const playerHp = useGameStore(s => s.playerHp);
  const enemyHp = useGameStore(s => s.enemyHp);
  const navigate = useUiStore(s => s.navigate);
  if (!gameOver) return null;

  const title = winner === 'player' ? 'VICTOIRE' : winner === 'enemy' ? 'DÉFAITE' : 'ÉGALITÉ';
  const icon = winner === 'player' ? '🏆' : winner === 'enemy' ? '💀' : '⚖️';
  const tone = winner === 'player' ? 'text-success' : winner === 'enemy' ? 'text-danger' : 'text-gold';

  return (
    <Modal>
      <div className="flex flex-col items-center gap-2">
        <div className="text-5xl">{icon}</div>
        <div className={`text-2xl font-bold ${tone}`}>{title}</div>
        <div className="text-xs tracking-widest text-white/40">FIN DE PARTIE</div>
        <div className="my-2 flex items-center gap-4 text-sm">
          <span className="font-bold text-player tabular-nums">{playerHp} PV</span>
          <span className="text-white/40">VS</span>
          <span className="font-bold text-enemy tabular-nums">{enemyHp} PV</span>
        </div>
        <Button
          variant="primary"
          className="w-full"
          onPointerDown={(e) => { e.stopPropagation(); if (onExit) onExit(winner); else navigate('main_menu'); }}
        >
          {exitLabel}
        </Button>
      </div>
    </Modal>
  );
}
