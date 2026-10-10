// La réserve mise en mots pour le récapitulatif de round (`data/ReserveInfo`).
import { describe, it, expect } from 'vitest';
import { reserveLines } from '../data/ReserveInfo.js';

describe('Récapitulatif — réserve', () => {
  it('énergie non posée puis série, dans l\'ordre d\'arrivée', () => {
    expect(reserveLines({ reserveBanked: 2, reserveGain: 3, reserveGainReason: 'win_streak' })).toEqual([
      { text: 'Énergie non posée', value: 2 },
      { text: 'Série de victoires', value: 3 },
    ]);
  });

  it('un montant nul ne s\'affiche pas', () => {
    expect(reserveLines({ reserveBanked: 0, reserveGain: 0, reserveGainReason: null })).toEqual([]);
    expect(reserveLines({ reserveBanked: 0, reserveGain: 1, reserveGainReason: 'loss' })).toEqual([{ text: 'Défaite', value: 1 }]);
  });
});
