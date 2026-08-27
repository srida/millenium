/**
 * Mise à jour de l'application INSTALLÉE (PWA).
 *
 * Le problème qu'elle règle : en appli installée, reprendre Millenium depuis
 * les tâches de fond n'est **pas** une navigation. Le navigateur n'interroge le
 * serveur pour un nouveau service worker qu'au chargement d'une page ou sur un
 * `registration.update()` explicite — donc jamais dans une session qui ne fait
 * que se réveiller. Le joueur restait sur la version précachée jusqu'à ce qu'il
 * ferme l'appli **de force**, ce qui est très exactement le geste qu'on lui
 * demandait de faire.
 *
 * Deux moitiés, et il fallait les deux :
 *
 * 1. **Demander** — on interroge le serveur à chaque retour au premier plan
 *    (`visibilitychange`), au retour du cache de navigation (`pageshow`), au
 *    retour du réseau, et une fois par heure tant que l'appli reste ouverte.
 * 2. **Appliquer** — `registerType: 'prompt'` (cf. `vite.config.ts`) : la
 *    nouvelle version s'installe et **attend**, c'est nous qui décidons du
 *    moment du rechargement. Ici : au menu principal, et nulle part ailleurs.
 *
 * ⚠️ Le rechargement n'est PAS immédiat, et ce n'est pas une prudence de
 * principe. `navigate()` n'écrit pas dans l'URL : un `location.reload()` ramène
 * toujours au menu principal, quel que soit l'écran affiché. Recharger en
 * pleine partie perdrait le combat en cours ; recharger sur la boutique ou les
 * missions renverrait le joueur au menu sans qu'il ait rien demandé. Au menu,
 * le rechargement ne se voit pas — c'est le seul écran où il est gratuit, et
 * c'est le hub par lequel tout repasse.
 */
import { registerSW } from 'virtual:pwa-register';
import { useUiStore } from '../stores/uiStore.js';
import { useTournamentStore } from '../stores/tournamentStore.js';

/**
 * Délai minimal entre deux interrogations. iOS émet `visibilitychange` à chaque
 * bascule d'application : sans ce plancher, un aller-retour vers une autre
 * appli redemanderait `sw.js` à chaque fois.
 */
const CHECK_THROTTLE_MS = 60_000;

/** Interrogation de fond, pour la session qu'on laisse ouverte des heures. */
const CHECK_INTERVAL_MS = 60 * 60 * 1000;

/** Envoie le `skipWaiting` puis recharge — rendu par `registerSW`. */
let applyUpdate: ((reloadPage?: boolean) => Promise<void>) | null = null;

/** Une version est installée et attend son moment. */
let pending = false;

let lastCheck = 0;

/**
 * ⚠️ Le bracket de tournoi vit en MÉMOIRE (`tournamentStore`) et se perd au
 * rechargement. Un joueur peut revenir au menu entre deux manches : le menu ne
 * suffit donc pas à dire que rien n'est en cours.
 */
function isIdle(): boolean {
  return useUiStore.getState().screen === 'main_menu'
    && useTournamentStore.getState().tournament === null;
}

function applyIfIdle(): void {
  if (!pending || !applyUpdate || !isIdle()) return;
  pending = false;
  void applyUpdate();
}

export function registerPwaUpdates(): void {
  applyUpdate = registerSW({
    immediate: true,

    // `prompt` : appelé quand la nouvelle version est installée et en attente.
    onNeedRefresh() {
      pending = true;
      applyIfIdle();
    },

    onRegisteredSW(_swScriptUrl, registration) {
      if (!registration) return;

      const check = () => {
        if (document.visibilityState !== 'visible') return;
        const now = Date.now();
        if (now - lastCheck < CHECK_THROTTLE_MS) return;
        lastCheck = now;
        // Une interrogation qui échoue (hors ligne, serveur qui redémarre) est
        // sans conséquence : la suivante arrive au prochain réveil.
        registration.update().catch(() => {});
      };

      // `register()` vient d'en faire une : le compteur part chargé, sinon le
      // premier `visibilitychange` la referait pour rien.
      lastCheck = Date.now();

      document.addEventListener('visibilitychange', check);
      window.addEventListener('pageshow', check);
      window.addEventListener('online', check);
      setInterval(check, CHECK_INTERVAL_MS);
    },
  });

  // Le moment d'appliquer n'est pas celui où la version arrive, c'est celui où
  // le joueur revient au menu — d'où l'abonnement plutôt qu'un simple appel.
  useUiStore.subscribe(applyIfIdle);
  applyIfIdle();
}
