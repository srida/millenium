// Couche des messages rapides du Duel en ligne : les deux cases (la mienne à
// gauche, celle de l'adversaire en miroir à droite) et le panneau de choix.
//
// Aucune règle ici : l'état vit dans `stores/emoteStore`, le catalogue dans
// `game/emotes`. Les cases sont `pointer-events: none` — elles ne bloquent
// jamais le plateau, et le panneau seul est interactif.
import { useEmoteStore } from '../../stores/emoteStore.js';
import { useAuthStore } from '../../stores/authStore.js';
import { emoteById } from '../../game/emotes.js';
import { useWebLayout } from '../system/useWebLayout.js';
import EmoteCase from './EmoteCase.js';
import EmotePanel from './EmotePanel.js';

export interface EmoteLayerProps {
  opponentName: string;
  opponentAvatar: string | null;
}

export default function EmoteLayer({ opponentName, opponentAvatar }: EmoteLayerProps) {
  const me = useEmoteStore(s => s.me);
  const opponent = useEmoteStore(s => s.opponent);
  const user = useAuthStore(s => s.user);
  const web = useWebLayout();
  const mine = me && emoteById(me.emoteId);
  const theirs = opponent && emoteById(opponent.emoteId);

  return (
    <div className={'emote-layer' + (web ? ' emote-layer--web' : '')}>
      {/* `key` change à chaque affichage : relance l'animation, même pour le même message. */}
      {mine && (
        <EmoteCase
          key={`me-${me.key}`}
          emote={mine}
          side="me"
          name={user?.username ?? 'Toi'}
          avatarSrc={(user as { avatar?: string | null } | null)?.avatar ?? null}
          avatarFallback="★"
        />
      )}
      {theirs && (
        <EmoteCase
          key={`op-${opponent.key}`}
          emote={theirs}
          side="opponent"
          name={opponentName}
          avatarSrc={opponentAvatar}
          avatarFallback={opponentName.slice(0, 2).toUpperCase()}
        />
      )}
      <EmotePanel opponentName={opponentName} />
    </div>
  );
}
