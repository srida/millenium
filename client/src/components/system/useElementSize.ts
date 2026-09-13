// Les dimensions RÉELLES d'un élément, suivies par `ResizeObserver`.
//
// La main en éventail et les piles des rails ne peuvent pas se placer sans
// elles : c'est la largeur qui dicte le pas de l'éventail, et la HAUTEUR
// disponible qui dicte celui d'un rail (`components/hand/cardFan`). Les déduire
// de `window.innerWidth` obligerait à recopier ici les marges, les rembourrages
// et la hauteur d'en-tête de chaque bande — autant d'endroits à tenir d'accord
// pour des valeurs que le navigateur sait déjà.
//
// ⚠️ Rend `0 × 0` avant la première mesure, et `cardFan` rend alors une main
// vide : une taille devinée ferait sauter l'éventail d'une frame à l'autre.
import { useCallback, useRef, useState } from 'react';

export interface ElementSize { width: number; height: number }

const ZERO: ElementSize = { width: 0, height: 0 };

export function useElementSize<T extends HTMLElement>(): [(el: T | null) => void, ElementSize] {
  const [size, setSize] = useState<ElementSize>(ZERO);
  const observer = useRef<ResizeObserver | null>(null);

  // Callback ref plutôt qu'un `useEffect` sur un `useRef` : l'observateur se
  // pose au moment exact où l'élément entre dans le DOM, et se retire quand il
  // en sort — y compris si l'écran change de disposition sous lui (c'est
  // précisément ce qui arrive en tournant le téléphone, où la main passe de la
  // bande au rail).
  const ref = useCallback((el: T | null) => {
    observer.current?.disconnect();
    observer.current = null;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setSize({ width: r.width, height: r.height });
    if (typeof ResizeObserver === 'undefined') return;
    observer.current = new ResizeObserver(entries => {
      for (const e of entries) setSize({ width: e.contentRect.width, height: e.contentRect.height });
    });
    observer.current.observe(el);
  }, []);

  return [ref, size];
}
