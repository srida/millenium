// La réserve d'énergie mise en mots pour le récapitulatif de round : ce que le
// round y a versé, et pourquoi. Pur — l'écran ne fait que rendre ces lignes.
import type { ReserveGainReason } from '../logic/GameState.js';

const GAIN_TEXT: Record<ReserveGainReason, (n: number) => string> = {
  win_streak: () => 'Série de victoires',
  loss: () => 'Défaite',
  loss_streak: () => 'Série de défaites',
};

/**
 * Les lignes du récapitulatif, dans l'ordre où l'énergie est arrivée :
 * l'énergie non posée (au lancement du combat), puis la série (à la fin).
 * ⚠️ Un montant nul ne s'affiche pas : « +0 ⚡ » ne dit rien.
 */
export function reserveLines(r: {
  reserveBanked: number; reserveGain: number; reserveGainReason: ReserveGainReason | null;
}): { text: string; value: number }[] {
  const out: { text: string; value: number }[] = [];
  if (r.reserveBanked > 0) out.push({ text: 'Énergie non posée', value: r.reserveBanked });
  if (r.reserveGain > 0 && r.reserveGainReason) {
    out.push({ text: GAIN_TEXT[r.reserveGainReason](r.reserveGain), value: r.reserveGain });
  }
  return out;
}
