// Générateur pseudo-aléatoire SEMÉ — la seule source de hasard reproductible
// de la couche logique.
//
// Il existe pour la simulation d'équilibrage : un tirage douteux doit se
// REJOUER au lieu de se raconter. `Math.random` ne le permet pas, et son flux
// n'est même pas garanti stable d'une version de Node à l'autre.
//
// ⚠️ Pur à dessein : aucun import, pas même `node:crypto` (que `shop.js`
// utilise côté serveur pour semer le même xorshift32). `logic/` tourne aussi
// dans le navigateur, et ce fichier doit rester importable des deux côtés.
// C'est l'appelant qui fabrique sa graine — d'où `hashSeed` pour partir d'une
// chaîne lisible plutôt que d'un nombre écrit à la main.

/**
 * xorshift32 — suffisant pour un tirage de cartes, et stable dans le temps.
 * @param seed graine ; 0 est remplacé par 1 (l'état 0 est un point fixe qui
 *   rendrait éternellement la même valeur).
 * @returns une fonction compatible `Math.random` (flottant dans [0, 1[).
 */
export function makeRandom(seed: number): () => number {
  let s = (seed >>> 0) || 1;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5;  s >>>= 0;
    return s / 4294967296;
  };
}

/** FNV-1a 32 bits — transforme une graine lisible ("2026-08-24#12") en entier. */
export function hashSeed(...parts: (string | number)[]): number {
  let h = 2166136261;
  const text = parts.join('|');
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Raccourci : un générateur semé depuis une graine lisible. */
export function seededRandom(...parts: (string | number)[]): () => number {
  return makeRandom(hashSeed(...parts));
}
