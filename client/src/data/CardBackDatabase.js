// Catalogue des DOS DE CARTE — `data/card_backs.json`, édité depuis le panneau
// d'administration (onglet 🂠 Dos de cartes). Même patron que les autres
// databases : un `init()` async, puis un cache mémoire.
//
// Un dos de carte est un cosmétique pur : il n'a aucun effet de jeu, il ne
// voyage dans aucun payload de round, et deux joueurs aux dos différents jouent
// exactement le même combat. Son art vit dans le dossier d'ILLUSTRATIONS, sous
// l'id du dos — comme les variantes et les icônes d'attributs —, donc
// `/illustrations/<id>` le sert sans nouvelle route.
//
// ⚠️ `init()` ne JETTE PAS sur une réponse en erreur, contrairement aux autres
// databases : un dos de carte n'est pas une donnée de jeu, et un serveur qui ne
// connaîtrait pas encore la route (fenêtre de déploiement) ne doit pas empêcher
// de jouer. Catalogue vide → la popup de pioche retombe sur son dos procédural.
let list = null;

export async function init() {
  if (list) return list;
  try {
    const res = await fetch('/api/card-backs');
    list = res.ok ? await res.json() : [];
  } catch {
    list = [];
  }
  return list;
}

export function getAllCardBacks() {
  return list ?? [];
}

export function getCardBack(id) {
  if (!id) return null;
  return (list ?? []).find(b => b.id === id) ?? null;
}

/**
 * Le dos offert à tout le monde : le premier marqué `default`, à défaut le
 * premier du catalogue. C'est aussi le repli de tout id inconnu.
 */
export function defaultCardBack() {
  const all = list ?? [];
  return all.find(b => b.default) ?? all[0] ?? null;
}

/**
 * Le dos réellement porté, à partir de ce que le profil annonce.
 *
 * ⚠️ Le repli est SYSTÉMATIQUE : un id qui a quitté le catalogue (dos retiré en
 * admin) ne doit pas laisser le joueur sans dos du tout. `null` seulement quand
 * le catalogue lui-même est vide — la popup dessine alors son dos procédural.
 */
export function resolveCardBack(id) {
  return getCardBack(id) ?? defaultCardBack();
}
