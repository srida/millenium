/* eslint-disable @typescript-eslint/no-explicit-any */
// La lecture d'un instantané serveur, écrite une fois.
//
// Cinq stores (boutique, cosmétiques, cadeaux, missions, arcade) suivent le même
// contrat : une route GET rend l'instantané complet du domaine, les mutations
// rendent le MÊME instantané, et l'écran ne fait qu'afficher ce que le serveur
// répond. Leur `load()` était donc recopié cinq fois — trois d'entre eux au
// caractère près, seuls le nom de la méthode `AuthClient` et le message
// d'erreur changeant.
//
// ⚠️ Ce n'était pas qu'une redite : UN SEUL des cinq portait le garde
// anti-course. Le bug est réel et documenté (cf. `arcadeStore`) — le rapport de
// duel (POST) et la relecture d'écran (GET) partent d'endroits différents et se
// croisent ; rien ne garantit l'ordre des RÉPONSES. Un GET parti avant que le
// POST ne soit commis rapporte l'état d'AVANT la mutation et, s'il s'applique
// en dernier, efface ce que le joueur vient de faire. La parade tenait dans un
// compteur, mais elle vivait dans une copie sur cinq : les quatre autres
// n'avaient pas la fenêtre de l'arcade, mais c'était une propriété à
// redémontrer store par store plutôt qu'une garantie de structure.
//
// Ici, le garde vient avec le `load`. Il n'y a plus rien à ne pas oublier.
import { useAuthStore } from './authStore.js';

/** Aucun de ces écrans n'existe hors connexion : lire en invité est un no-op. */
export const isGuest = () => !useAuthStore.getState().user;

/** La part de l'état du store que le chargeur touche. */
interface Loadable<S> {
  snapshot: S | null;
  loading: boolean;
  error: string | null;
}

export interface SnapshotChannel<S> {
  /**
   * À appeler sur CHAQUE réponse de mutation, avant d'écrire l'instantané.
   * Toute lecture partie avant ce point sera jetée à son retour.
   */
  bump(): void;
  /** Le `load` à poser dans le store. */
  load(
    set: (partial: Partial<Loadable<S>>) => void,
    get: () => Loadable<S>,
  ): (force?: boolean) => Promise<void>;
}

export function createSnapshotChannel<S>({
  fetch, pick, errorLabel, applyProgression = true,
}: {
  /** La route de lecture (`AuthClient.getShop`, `getArcade`…). */
  fetch: () => Promise<any>;
  /** Projection de la réponse en instantané de domaine. */
  pick: (data: any) => S;
  /** Ce qu'on dit au joueur quand la route est injoignable. */
  errorLabel: string;
  /**
   * `false` pour les missions : leur route de lecture ne porte pas de bloc
   * `progression` — l'appeler écraserait le solde avec `undefined`.
   */
  applyProgression?: boolean;
}): SnapshotChannel<S> {
  // Hors du store à dessein : c'est une horloge interne, pas un état à rendre —
  // même statut que `levelToastKey` dans `authStore`.
  let revision = 0;

  return {
    bump() { revision++; },

    load(set, get) {
      return async (force = false) => {
        if (isGuest()) { set({ snapshot: null, error: null }); return; }
        if (get().loading || (get().snapshot && !force)) return;
        // Photographie de l'horloge AVANT la requête : si une mutation aboutit
        // pendant qu'elle est en vol, sa réponse est plus fraîche que la nôtre.
        const seen = revision;
        set({ loading: true, error: null });
        try {
          const data = await fetch();
          // Une mutation est passée devant — on jette. Ça ne coûte rien : les
          // deux routes renvoient le même instantané complet.
          if (revision !== seen) return;
          set({ snapshot: pick(data) });
          if (applyProgression) useAuthStore.getState().applyProgression(data.progression);
        } catch (e: any) {
          set({ error: e?.message ?? errorLabel });
        } finally {
          set({ loading: false });
        }
      };
    },
  };
}
