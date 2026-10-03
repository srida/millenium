/* eslint-disable @typescript-eslint/no-explicit-any */
// Synchro du compte entre appareils : decks et bracket de tournoi.
//
// Le serveur est la source de vérité, mais un appareil resté ouvert ne le sait
// pas : sans rappel, il garderait ses decks de l'ouverture et les repousserait
// plus tard. On se resynchronise donc au retour au premier plan et quand le
// réseau revient, et on pousse ce qui est en attente quand l'appli passe en
// arrière-plan (le debounce de 500 ms ne survivrait pas à une mise en veille).
//
// ⚠️ Jamais PENDANT une partie : un refresh de decks repose les illustrations du
// deck actif (`deckStore.refresh` → CardArt) par-dessus celles du deck engagé.
import * as DeckRepository from '../data/DeckRepository.js';
import { useUiStore } from '../stores/uiStore.js';
import { useDeckStore } from '../stores/deckStore.js';
import { useTournamentStore } from '../stores/tournamentStore.js';

const IN_GAME = new Set(['game', 'game_pvp']);

async function resync(): Promise<void> {
  if (IN_GAME.has(useUiStore.getState().screen as string)) return;
  try {
    const changed = await (DeckRepository as any).refresh();
    if (changed) useDeckStore.getState().refresh();
  } catch { /* hors-ligne */ }
  void useTournamentStore.getState().hydrate();
}

export function registerAccountSync(): void {
  const onShow = () => { if (document.visibilityState === 'visible') void resync(); };
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') void (DeckRepository as any).flushIfPending();
    else onShow();
  });
  window.addEventListener('pageshow', onShow);
  window.addEventListener('online', onShow);
}
