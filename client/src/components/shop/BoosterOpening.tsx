// Ouverture d'un booster — sachet déchiré, cartes étalées face cachée puis
// retournées une à une. Remplace l'ancien `BoosterReveal` (modale statique).
//
// ⚠️ Même doctrine que `Card3D` : AUCUN re-render par frame. Une boucle rAF
// écrit des `transform` / `opacity` sur des refs, la décision vit dans
// `boosterTimeline.frameAt` (pure). React ne rend que trois fois : au montage,
// à l'arrivée de `result`, et à l'apparition du bouton « Continuer ».
//
// ⚠️ Le temps A (voile, montée, tremblement) démarre à la fin de la charge du
// `HoldConfirmButton`, AVANT la réponse du serveur : `result` vaut `null` tant
// qu'elle n'est pas là, et le tremblement boucle. Le sachet ne s'ouvre jamais
// sans cartes.
//
// ⚠️ On ne touche JAMAIS au `transform` de `.card3d` : c'est le wrapper qui
// bouge, écrire sur la carte écraserait la composition de `card3d.css`. L'éclat
// du retournement est un `drop-shadow` sur le wrapper — le `box-shadow` de la
// carte porte déjà `--uc-frame-shadow`.
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import * as CardDatabase from '../../data/CardDatabase.js';
import * as CardBackDatabase from '../../data/CardBackDatabase.js';
import type { Card } from '../../logic/types.js';
import { tiersOf } from '../../logic/Tiers.js';
import { frameVars } from '../../three/cardPalette.js';
import type { BoosterResult, ShopSet } from '../../stores/shopStore.js';
import Card3D, { cardVisualProps } from '../ui/Card3D.js';
import { Button, Illustration } from '../ui/primitives.js';
import { useUiStore } from '../../stores/uiStore.js';
import UiIcon from '../ui/UiIcon.js';
import { PackPoster } from './PackContents.js';
import { SHAKE_MIN, frameAt, type Frame } from './boosterTimeline.js';

const FADE_MS = 200;

interface Refs {
  root: HTMLDivElement | null;
  veil: HTMLDivElement | null;
  glow: HTMLDivElement | null;
  pack: HTMLDivElement | null;
  body: HTMLDivElement | null;
  top: HTMLDivElement | null;
  tear: HTMLDivElement | null;
  flash: HTMLDivElement | null;
  cta: HTMLDivElement | null;
  cards: (HTMLDivElement | null)[];
  inners: (HTMLDivElement | null)[];
}

const px = (v: number) => v.toFixed(1);

function applyFrame(r: Refs, f: Frame, glows: string[]): void {
  if (r.veil) r.veil.style.opacity = String(f.veil);
  if (r.glow) r.glow.style.opacity = String(f.glow);
  if (r.pack) {
    r.pack.style.opacity = String(f.pack.opacity);
    r.pack.style.transform = `translate(${px(f.pack.x)}px,${px(f.pack.y)}px) rotate(${f.pack.rot.toFixed(2)}deg) scale(${f.pack.scale.toFixed(3)})`;
  }
  if (r.tear) {
    r.tear.style.opacity = String(f.tear.opacity);
    r.tear.style.transform = `scaleX(${f.tear.scaleX.toFixed(3)})`;
  }
  if (r.top) {
    r.top.style.opacity = String(f.top.opacity);
    r.top.style.transform = `translate(${px(f.top.x)}px,${px(f.top.y)}px) rotate(${px(f.top.rot)}deg)`;
  }
  if (r.body) {
    r.body.style.opacity = String(f.body.opacity);
    r.body.style.transform = `translateY(${px(f.body.y)}px) rotate(${px(f.body.rot)}deg)`;
  }
  if (r.flash) r.flash.style.opacity = String(f.flash);
  f.cards.forEach((c, i) => {
    const el = r.cards[i], inner = r.inners[i];
    if (!el || !inner) return;
    el.style.opacity = String(c.opacity);
    el.style.zIndex = String(c.z);
    el.style.transform = `translate(${px(c.x)}px,${px(c.y)}px) rotate(${c.rot.toFixed(2)}deg) scale(${c.scale.toFixed(3)})`;
    el.style.filter = c.glow > 0.01 ? `drop-shadow(0 0 ${(4 + 16 * c.glow).toFixed(1)}px ${glows[i] ?? 'rgba(212,175,97,.5)'})` : '';
    inner.style.transform = `rotateY(${c.flip.toFixed(1)}deg)`;
  });
  if (r.cta) {
    r.cta.style.opacity = String(f.cta.opacity);
    r.cta.style.transform = `translateY(${px(f.cta.y)}px)`;
    r.cta.style.pointerEvents = f.cta.interactive ? 'auto' : 'none';
  }
}

export default function BoosterOpening({ set, result, aborted = false, onClose }: {
  set: ShopSet;
  /** `null` tant que le serveur n'a pas répondu. */
  result: BoosterResult | null;
  /** L'achat a échoué pendant le temps A : on referme sans rien révéler. */
  aborted?: boolean;
  onClose: () => void;
}) {
  const refs = useRef<Refs>({
    root: null, veil: null, glow: null, pack: null, body: null, top: null, tear: null,
    flash: null, cta: null, cards: [], inners: [],
  });
  const [done, setDone] = useState(false);
  const resultRef = useRef(result);
  const onCloseRef = useRef(onClose);
  const skipRef = useRef(false);
  const glowsRef = useRef<string[]>([]);

  const cards = (result?.cards ?? []).map(c => CardDatabase.getCard(c.card_id) as Card | null);
  const back = CardBackDatabase.defaultCardBack() as { id: string; _has_illustration?: boolean } | null;

  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);

  useEffect(() => {
    resultRef.current = result;
    glowsRef.current = (result?.cards ?? []).map(c => {
      const card = CardDatabase.getCard(c.card_id) as Card | null;
      return card ? frameVars(tiersOf(card))['--uc-glow'] : '';
    });
  }, [result]);

  useEffect(() => {
    const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    const t0 = performance.now();
    let tB: number | null = null;
    let raf = 0;
    const count = () => resultRef.current?.cards.length ?? 0;

    const tick = (now: number) => {
      const t = (now - t0) / 1000;
      if (skipRef.current && tB != null) tB = Math.min(tB, t - 100);
      if (tB == null && resultRef.current && t >= SHAKE_MIN) tB = t;
      const f = frameAt(t, tB, Math.max(count(), 1));
      applyFrame(refs.current, f, glowsRef.current);
      if (f.end) { setDone(true); return; }
      raf = requestAnimationFrame(tick);
    };

    if (reduced) {
      // On retire le mouvement, jamais l'information : on attend les cartes,
      // puis l'état final d'un coup, avec un fondu.
      const root = refs.current.root;
      const wait = () => {
        if (!resultRef.current) { raf = requestAnimationFrame(wait); return; }
        applyFrame(refs.current, frameAt(0, -100, Math.max(count(), 1)), glowsRef.current);
        if (root) { root.style.transition = `opacity ${FADE_MS}ms`; root.style.opacity = '1'; }
        setDone(true);
      };
      if (root) root.style.opacity = '0';
      raf = requestAnimationFrame(wait);
    } else {
      raf = requestAnimationFrame(tick);
    }
    return () => cancelAnimationFrame(raf);
  }, []);

  // Échec d'achat : fondu inverse du voile, puis on rend la main.
  useEffect(() => {
    if (!aborted) return;
    const root = refs.current.root;
    if (root) { root.style.transition = `opacity ${FADE_MS}ms`; root.style.opacity = '0'; }
    const id = setTimeout(() => onCloseRef.current(), FADE_MS);
    return () => clearTimeout(id);
  }, [aborted]);

  // Le bouton prend le focus quand il est posé.
  useEffect(() => {
    if (done) refs.current.cta?.querySelector('button')?.focus();
  }, [done]);

  // `will-change` seulement pendant l'animation, retiré à la fin (flou du texte).
  const moving = done ? '' : 'will-change-transform';

  // Passer l'animation : un tap sur l'overlay pendant le temps B saute à la fin.
  const hideTooltip = useUiStore(s => s.hideTooltip);
  const skip = useCallback(() => { skipRef.current = true; hideTooltip(); }, [hideTooltip]);

  const ctaRef = useCallback((el: HTMLDivElement | null) => { refs.current.cta = el; }, []);

  return createPortal(
    <div
      ref={el => { refs.current.root = el; }}
      className="pointer-events-auto fixed inset-0 z-[60] overflow-hidden"
      onPointerDown={skip}
      role="dialog"
      aria-label={`Ouverture du booster ${set.name}`}
    >
      <div ref={el => { refs.current.veil = el; }} className="bo-veil absolute inset-0 opacity-0" />
      <div ref={el => { refs.current.glow = el; }} className="bo-glow absolute left-1/2 top-[44%] -ml-[210px] -mt-[210px] h-[420px] w-[420px] rounded-full opacity-0" />

      {/* Origine du repère : le centre de la scène, à 44 % de la hauteur. */}
      <div className="absolute left-1/2 top-[44%] h-0 w-0 [perspective:900px]">
        {cards.map((card, i) => (
          <div
            key={result!.cards[i].card_id}
            ref={el => { refs.current.cards[i] = el; }}
            className={`absolute -left-[46px] -top-[64.5px] h-[129px] w-[92px] opacity-0 [perspective:700px] ${moving}`}
          >
            <div ref={el => { refs.current.inners[i] = el; }} className="absolute inset-0 [transform-style:preserve-3d]">
              <div className="bo-face bo-card-back absolute inset-0 overflow-hidden rounded-[13px]">
                {back?._has_illustration
                  ? <Illustration id={back.id} className="h-full w-full" lazy={false} />
                  : <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-surface-raised to-surface text-2xl text-gold/70">✦</div>}
              </div>
              <div className="bo-face absolute inset-0 [transform:rotateY(180deg)]">
                {card
                  ? <Card3D {...cardVisualProps(card)} size="h-full w-full" tapOn="up" />
                  : <div className="flex h-full w-full items-center justify-center rounded-[13px] border border-line bg-surface text-[10px] text-white/50">{result!.cards[i].card_id}</div>}
              </div>
            </div>
          </div>
        ))}

        <div ref={el => { refs.current.pack = el; }} className={`absolute -left-[75px] -top-[115px] z-[2] h-[230px] w-[150px] opacity-0 ${moving}`}>
          <div ref={el => { refs.current.body = el; }} className="bo-pack-body absolute inset-x-0 bottom-0 top-6 overflow-hidden rounded-b-[10px]">
            <div className="bo-crimp absolute inset-x-0 bottom-0 h-3" />
            <div className="absolute left-1/2 top-7 -ml-10 h-20 w-20 overflow-hidden rounded-full border-2 border-gold">
              <PackPoster set={set} className="!h-full !w-full !rounded-none !border-0" />
            </div>
            <div className="absolute inset-x-2 top-[122px] text-center text-[17px] font-extrabold leading-tight text-[#f6e7c8] [text-shadow:0_2px_6px_rgba(0,0,0,.8)]">{set.name}</div>
            <div className="absolute inset-x-0 top-[172px] text-center text-[9px] font-bold tracking-[.24em] text-gold">BOOSTER</div>
          </div>
          <div ref={el => { refs.current.top = el; }} className="bo-pack-top absolute inset-x-0 top-0 h-6 overflow-hidden rounded-t-[10px]">
            <div className="bo-crimp absolute inset-x-0 top-0 h-3" />
          </div>
          <div ref={el => { refs.current.tear = el; }} className="bo-tear absolute -left-1.5 -right-1.5 top-[22px] h-[3px] rounded-[3px] opacity-0 [transform:scaleX(0)]" />
        </div>

        <div ref={el => { refs.current.flash = el; }} className="bo-flash pointer-events-none absolute -left-[220px] -top-[330px] z-[4] h-[440px] w-[440px] rounded-full opacity-0" />
      </div>

      <div ref={ctaRef} className="pointer-events-none absolute inset-x-6 bottom-10 opacity-0">
        {result?.pin_cleared && (
          <p className="mb-3 flex items-center justify-center gap-1 text-center text-[11px] text-gold"><UiIcon id="UI_PIN" className="h-3 w-3" /> Ta carte épinglée est tombée — l'épingle est libérée.</p>
        )}
        {result && (
          <Button variant="primary" className="w-full" onPointerDown={e => { e.stopPropagation(); hideTooltip(); onClose(); }}>
            Continuer
          </Button>
        )}
      </div>
    </div>,
    document.body,
  );
}
