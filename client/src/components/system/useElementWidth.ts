// La largeur RÉELLE d'un élément, suivie par `ResizeObserver`.
//
// La main en éventail ne peut pas se placer sans elle : c'est la largeur qui
// dicte le pas, puis l'échelle (`components/hand/cardFan`). La déduire de
// `window.innerWidth` obligerait à recopier ici les marges et les rembourrages
// de la bande — deux endroits à tenir d'accord pour une valeur que le navigateur
// sait déjà.
//
// ⚠️ Rend 0 avant la première mesure, et `cardFan` rend alors une main vide :
// une largeur devinée ferait sauter l'éventail d'une frame à l'autre.
import { useCallback, useRef, useState } from 'react';

export function useElementWidth<T extends HTMLElement>(): [(el: T | null) => void, number] {
  const [width, setWidth] = useState(0);
  const observer = useRef<ResizeObserver | null>(null);

  // Callback ref plutôt qu'un `useEffect` sur un `useRef` : l'observateur se
  // pose au moment exact où l'élément entre dans le DOM, et se retire quand il
  // en sort — y compris si l'écran change de disposition sous lui.
  const ref = useCallback((el: T | null) => {
    observer.current?.disconnect();
    observer.current = null;
    if (!el) return;
    setWidth(el.getBoundingClientRect().width);
    if (typeof ResizeObserver === 'undefined') return;
    observer.current = new ResizeObserver(entries => {
      for (const e of entries) setWidth(e.contentRect.width);
    });
    observer.current.observe(el);
  }, []);

  return [ref, width];
}
