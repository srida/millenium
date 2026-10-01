// La bulle de manga d'un message rapide : parole (ellipse), pensée (ellipse
// irrégulière) ou cri (étoile). Le texte garde ses coupures — `white-space: pre`.
// La taille et l'inclinaison viennent du parent (`--mb-size`, `--mb-tilt`).
import type { BubbleShape } from '../../game/emotes.js';

export default function MangaBubble({ text, shape }: { text: string; shape: BubbleShape }) {
  if (shape === 'burst') {
    return (
      <div className="mb mb--burst">
        <div className="mb-burst">
          <div className="mb-burst-edge" />
          <div className="mb-burst-fill" />
          <div className="mb-burst-text">{text}</div>
        </div>
      </div>
    );
  }
  return (
    <div className={`mb mb--${shape}`}>
      <div className="mb-body">{text}</div>
    </div>
  );
}
