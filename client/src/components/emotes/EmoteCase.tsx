// La case de manga d'un message rapide, sous l'avatar de celui qui parle.
// Une case par TON de message (cf. `Emote.panel`). Côté adversaire, la même
// case est retournée par le CSS (`.emote-case--opponent`) ; chaque élément qui
// porte du texte ou un visage passe par `.emote-flip` pour rester lisible.
import type { ReactNode } from 'react';
import type { Emote } from '../../game/emotes.js';
import { Avatar } from '../ui/primitives.js';
import MangaBubble from './MangaBubble.js';

export interface EmoteCaseProps {
  emote: Emote;
  side: 'me' | 'opponent';
  name: string;
  avatarSrc?: string | null;
  avatarFallback?: string;
}

export default function EmoteCase({ emote, side, name, avatarSrc = null, avatarFallback = '★' }: EmoteCaseProps) {
  const flip = (children: ReactNode) => <div className="emote-flip">{children}</div>;
  const who = (
    <div className="emote-who">
      {flip(<>
        <Avatar src={avatarSrc} fallback={avatarFallback} className="emote-portrait" />
        <span className="emote-name">{name}</span>
      </>)}
    </div>
  );
  const bubble = <div className="emote-bubble">{flip(<MangaBubble text={emote.text} shape={emote.shape} />)}</div>;
  const sfx = emote.sfx && <div className="emote-sfx">{flip(<span className="emote-sfx-text">{emote.sfx}</span>)}</div>;

  let sheet: ReactNode;
  switch (emote.panel) {
    case '3a':
      sheet = (
        <div className="emote-sheet emote-3a">
          <div className="ly poly edge" />
          <div className="ly poly-in paper" />
          <div className="ly poly-in dots" />
          {who}{bubble}
        </div>
      );
      break;
    case '3b':
      sheet = (
        <div className="emote-sheet emote-3b">
          <div className="ly poly rim" />
          <div className="ly poly night" />
          <div className="ly poly halo" />
          {who}{bubble}{sfx}
        </div>
      );
      break;
    case '3d':
      sheet = (
        <div className="emote-sheet emote-3d">
          {(['a', 'b', 'c'] as const).map(k => (
            <div key={k} className={`shard shard--${k}`}>
              <div className="shard-edge" />
              <div className="shard-fill" />
            </div>
          ))}
          {who}{bubble}{sfx}
        </div>
      );
      break;
    case '3e':
      sheet = (
        <div className="emote-sheet emote-3e">
          <div className="smudge" />
          <div className="memory" />
          {who}{bubble}
        </div>
      );
      break;
  }
  return <div className={`emote-case emote-case--${side}`}>{sheet}</div>;
}
