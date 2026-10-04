// MatchFoundReveal — la présentation de l'adversaire, entre la poignée de main
// et le duel. Partagée par le Duel en ligne (`OnlineLobby`) et les duels de
// Draft (`DraftScreen`), qui passent par la même file d'attente.
import { useEffect, useState } from 'react';
import { Avatar } from '../ui/primitives.js';

// Identité annoncée par `match:found` (cf. ws/MatchRelay.playerInfo, et
// ws/BotMatch qui rend le MÊME objet pour un adversaire artificiel — rien ici
// ne doit pouvoir distinguer les deux).
export type MatchOpponent = { username?: string; tag?: number; avatar?: string | null };

// Durée de la présentation de l'adversaire avant le duel. Le serveur n'attend
// aucun « prêt » dans un délai donné (MatchRelay.handleReady n'a pas de
// chrono) : les deux clients peuvent tenir cette pause chacun de leur côté
// sans que le match en souffre.
export const MATCH_REVEAL_MS = 3000;

// Présentation de l'adversaire, entre la poignée de main et le duel. Overlay
// plein écran plutôt qu'une ligne de plus dans la colonne : il couvre le ◂ de
// l'en-tête, et c'est ce qui garde la fenêtre d'abandon aussi étroite qu'avant
// — le match existe déjà côté serveur, quitter ici le laisserait orphelin.
export default function MatchFoundReveal({ opponent }: { opponent: MatchOpponent | null }) {
  const username = opponent?.username ?? 'Adversaire';
  // Le décompte n'ORDONNE rien : le départ est tenu par le setTimeout du lobby,
  // seule source de vérité. Il ne fait que dire au joueur que l'écran n'est pas
  // bloqué — d'où le plancher à 1, qui évite d'afficher un 0 qui traîne.
  const [seconds, setSeconds] = useState(Math.ceil(MATCH_REVEAL_MS / 1000));
  useEffect(() => {
    const t = setInterval(() => setSeconds(n => Math.max(1, n - 1)), 1000);
    return () => clearInterval(t);
  }, []);
  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-4 bg-surface/95 p-6 text-center backdrop-blur">
      <p className="text-xs uppercase tracking-widest text-gold">Adversaire trouvé</p>
      {/* Même surcharge que le portrait du vainqueur (Overlays.GameOverScreen) :
          on ne touche qu'à la taille et à la couleur du liseré, le reste de la
          vignette est celui de la primitive. */}
      <Avatar
        src={opponent?.avatar}
        fallback={username.slice(0, 2).toUpperCase()}
        className="h-24 w-24 border-gold/60 text-2xl"
      />
      <div>
        <div className="text-xl font-semibold">{username}</div>
        {opponent?.tag != null && <div className="text-xs text-white/40">#{opponent.tag}</div>}
      </div>
      <p className="animate-pulse text-sm text-white/60">Le duel commence dans {seconds}…</p>
    </div>
  );
}

