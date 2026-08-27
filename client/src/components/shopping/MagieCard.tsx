/* eslint-disable @typescript-eslint/no-explicit-any */
// Carte de magie présentée pendant la Phase Shopping : vignette + nom + effet
// (effectLabel) + rareté (liseré gauche et chip) + contrecoup éventuel. Layout
// horizontal compact (mobile-first) : les 3 choix tiennent dans le modal sans
// scroll sur un écran portrait. Purement présentationnel — l'action de choix
// est déléguée au parent via onChoose, et l'accessibilité du contrecoup est
// calculée par ShoppingLayer (`MagieEffect.canAffordMagie`).
//
// ⚠️ La rareté ne RÉORDONNE PAS l'offre : `pickMagies` rend les magies dans
// l'ordre où elles sont sorties, et une Légendaire tombe en position 1, 2 ou 3.
// Trier ferait de la position un spoiler, et rendrait le liseré redondant.
import { effectLabel, magieCostHp } from '../../logic/MagieEffect.js';
import { rarityOf, RARITY_LABELS } from '../../logic/MagieOffer.js';
import type { Magie, MagieRarity } from '../../logic/types.js';
import { Illustration } from '../ui/primitives.js';

// ⚠️ Pas d'OR pour la Légendaire : le nom de la magie, le titre « ✦ PHASE
// SHOPPING ✦ » et le décompte sont déjà `text-gold`. Un liseré doré sur un
// panneau accentué en or ne distinguerait rien — il faut CONTRASTER avec
// l'accent, pas le prolonger. Vert et rouge sont écartés pour la raison
// symétrique : ils portent déjà « validé » et « danger » ailleurs dans le jeu.
const RARITY_STYLE: Record<MagieRarity, { edge: string; chip: string }> = {
  1: { edge: 'border-l-tier-1', chip: 'border-tier-1/50 text-tier-1' },
  2: { edge: 'border-l-tier-3', chip: 'border-tier-3/50 text-tier-3' },
  3: { edge: 'border-l-tier-4', chip: 'border-tier-4/60 bg-tier-4/10 text-tier-4' },
};

export default function MagieCard(
  { magie, affordable = true, onChoose }:
  { magie: Magie; affordable?: boolean; onChoose: (m: Magie) => void },
) {
  const rarity = rarityOf(magie);
  const style = RARITY_STYLE[rarity];
  const cost = magieCostHp(magie);
  return (
    <button
      disabled={!affordable}
      onPointerDown={(e) => { e.stopPropagation(); if (affordable) onChoose(magie); }}
      // Le survol passe par l'opacité et non par `hover:border-gold/60`, qui
      // écraserait la couleur de rareté — la seule chose que ce liseré porte.
      // ⚠️ Même raison pour le VERROUILLAGE d'un contrecoup impayable : il
      // s'annonce par l'opacité, la raison écrite et le ✕, jamais par une
      // bordure rouge qui effacerait le liseré de rareté.
      className={`flex w-full items-center gap-3 overflow-hidden rounded-lg border border-l-4 border-line ${style.edge} bg-surface-raised p-2 text-left transition-opacity ${
        affordable ? 'hover:opacity-90 active:opacity-80' : 'cursor-not-allowed opacity-40'
      }`}
    >
      <div className="h-16 w-16 flex-shrink-0 overflow-hidden rounded-md bg-black/40">
        {(magie as any)._has_illustration && (
          <Illustration id={magie.id} className="h-full w-full" />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          {/* `min-w-0` sur le nom : sans lui `truncate` ne tronque pas dans un
              conteneur flex, et les chips sont poussés hors de la carte. */}
          <span className="min-w-0 truncate text-sm font-bold text-gold">{magie.name}</span>
          {/* Le chip est rendu sur les TROIS paliers : le liseré seul porterait
              l'information par la seule couleur, et une magie sans chip
              laisserait le joueur incapable de dire si elle est Commune ou si le
              jeu a oublié de la marquer. */}
          <span className={`flex-shrink-0 rounded-full border px-1.5 py-px text-[9px] font-semibold uppercase tracking-wide ${style.chip}`}>
            {RARITY_LABELS[rarity]}
          </span>
          {/* Le contrecoup se lit AVANT de taper : c'est le seul geste du
              shopping qui retire quelque chose au joueur. */}
          {cost > 0 && (
            <span className="flex-shrink-0 rounded bg-red-500/20 px-1.5 py-px text-[9px] font-bold text-red-300">
              −{cost} PV
            </span>
          )}
        </div>
        <div className="text-[11px] leading-tight text-white/60">{(effectLabel as any)(magie)}</div>
        {!affordable && (
          <div className="mt-0.5 text-[10px] font-semibold leading-tight text-red-400">
            PV insuffisants pour le contrecoup
          </div>
        )}
      </div>
      <span className="flex-shrink-0 pr-1 text-white/30">{affordable ? '▸' : '✕'}</span>
    </button>
  );
}
