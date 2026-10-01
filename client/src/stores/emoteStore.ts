/* eslint-disable @typescript-eslint/no-explicit-any */
// État des messages rapides du Duel en ligne (cf. game/emotes.ts).
//
// Un store et non un état de composant : le panneau, les deux cases, le
// « MUET » du HUD et la réponse du bot en lisent chacun un morceau.
//
// Les minuteurs vivent ici, au niveau du module (même doctrine que
// `missionStore`) : une case programme sa propre disparition et ne l'applique
// que si son `key` n'a pas changé entre-temps — une case plus récente la
// remplace sans file d'attente.
import { create } from 'zustand';
import * as PvpConnection from '../net/PvpConnection.js';
import { EMOTE_IDS, EMOTE_COOLDOWN_MS, EMOTE_DISPLAY_MS } from '../game/emotes.js';

export interface ShownEmote {
  emoteId: string;
  /** Change à chaque affichage : relance l'animation même pour le même message. */
  key: number;
}

export interface EmoteState {
  open: boolean;
  coolingDown: boolean;
  /** Choisi pour tout le match : les messages reçus sont ignorés. */
  opponentMuted: boolean;
  me: ShownEmote | null;
  opponent: ShownEmote | null;
  /** Abonne la réception. Remet tout à zéro : un duel neuf ne hérite de rien. */
  attach: () => void;
  /** Désabonne, annule les minuteurs, remet à zéro (fin de match). */
  detach: () => void;
  toggleOpen: () => void;
  close: () => void;
  toggleMute: () => void;
  /** → `true` si le message est parti (refusé pendant le délai ou id inconnu). */
  send: (emoteId: string) => boolean;
  /** Affiche un message de l'adversaire (réseau, ou réponse locale du bot). */
  receive: (emoteId: string) => void;
}

const INITIAL = { open: false, coolingDown: false, opponentMuted: false, me: null, opponent: null };

let seq = 0;
let cooldownTimer: ReturnType<typeof setTimeout> | null = null;
const hideTimers: Record<'me' | 'opponent', ReturnType<typeof setTimeout> | null> = { me: null, opponent: null };
let netHandler: ((m: { emoteId?: unknown }) => void) | null = null;

function clearTimers(): void {
  if (cooldownTimer) { clearTimeout(cooldownTimer); cooldownTimer = null; }
  for (const side of ['me', 'opponent'] as const) {
    const t = hideTimers[side];
    if (t) { clearTimeout(t); hideTimers[side] = null; }
  }
}

export const useEmoteStore = create<EmoteState>((set, get) => {
  function show(side: 'me' | 'opponent', emoteId: string): void {
    const key = ++seq;
    set({ [side]: { emoteId, key } } as Partial<EmoteState>);
    const prev = hideTimers[side];
    if (prev) clearTimeout(prev);
    hideTimers[side] = setTimeout(() => {
      hideTimers[side] = null;
      if (get()[side]?.key === key) set({ [side]: null } as Partial<EmoteState>);
    }, EMOTE_DISPLAY_MS);
  }

  return {
    ...INITIAL,

    attach() {
      get().detach();
      netHandler = (m) => { if (typeof m?.emoteId === 'string') get().receive(m.emoteId); };
      (PvpConnection as any).on('emote:send', netHandler);
    },

    detach() {
      if (netHandler) { (PvpConnection as any).off('emote:send', netHandler); netHandler = null; }
      clearTimers();
      set({ ...INITIAL });
    },

    toggleOpen: () => set(s => ({ open: !s.open })),
    close: () => set({ open: false }),
    toggleMute: () => set(s => ({ opponentMuted: !s.opponentMuted })),

    send(emoteId) {
      const s = get();
      if (s.coolingDown || !EMOTE_IDS.has(emoteId)) return false;
      (PvpConnection as any).send('emote:send', { emoteId });
      set({ open: false, coolingDown: true });
      show('me', emoteId);
      cooldownTimer = setTimeout(() => { cooldownTimer = null; set({ coolingDown: false }); }, EMOTE_COOLDOWN_MS);
      return true;
    },

    receive(emoteId) {
      if (get().opponentMuted || !EMOTE_IDS.has(emoteId)) return;
      show('opponent', emoteId);
    },
  };
});
