// GiftsScreen — ce que le jeu DONNE, par opposition à ce qu'il vend (Boutique)
// et à ce qu'il fait gagner (Missions, Arcade).
//
// Deux sections, deux natures :
//   - le CADEAU QUOTIDIEN, remis à disposition à chaque rotation de 5 h — la
//     même que la boutique et les missions ;
//   - les CADEAUX PONCTUELS écrits en admin, récupérables une fois par compte.
//
// Aucune confirmation d'achat ici, contrairement à la boutique : rien n'est
// débité, il n'y a pas d'arbitrage à protéger. Un tap, et c'est pris.
//
// Toutes les valeurs viennent du serveur (gifts.js) : barème du quotidien,
// contenu des lots, libellés. Le client n'en calcule aucune.
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useUiStore } from '../stores/uiStore.js';
import { useAuthStore } from '../stores/authStore.js';
import { useGiftStore, type Gift, type GiftLot } from '../stores/giftStore.js';
import { Amount, Button, Panel, Modal, Countdown } from '../components/ui/primitives.js';
import { ScreenHeader } from '../components/ui/ScreenHeader.js';
import CardTile, { cardTileProps } from '../components/ui/CardTile.js';
import * as CardDatabase from '../data/CardDatabase.js';
import { CURRENCY, fmt } from '../components/ui/currency.js';

const LOT_ICONS: Record<GiftLot['type'], string> = {
  gold: CURRENCY.gold.icon, gems: CURRENCY.gems.icon,
  card: '🃏', pack: '🎁', avatar: '🖼️', variant: '🎨',
};

// Pourquoi une ligne n'a rien donné. Un CODE côté serveur, une phrase ici :
// c'est le client qui écrit l'interface.
const REASONS: Record<string, string> = {
  already_owned: 'déjà possédé',
  unknown: 'indisponible',
  empty_pool: 'collection déjà complète',
};

const cardOf = (id: string) => (CardDatabase as unknown as { getCard: (i: string) => unknown }).getCard(id) ?? null;

/** Libellé d'un lot annoncé, avant récupération. */
function lotLabel(lot: GiftLot): string {
  if (lot.type === 'gold') return `${fmt.format(lot.amount ?? 0)} golds`;
  if (lot.type === 'gems') return `${fmt.format(lot.amount ?? 0)} gemmes`;
  if (lot.type === 'pack') return `Booster ${lot.label ?? lot.id} (${lot.card_count ?? 5} cartes)`;
  if (lot.type === 'avatar') return `Avatar — ${lot.label ?? lot.id}`;
  if (lot.type === 'variant') return `Illustration — ${lot.label ?? lot.id}`;
  return lot.label ?? lot.id ?? '';
}

export default function GiftsScreen() {
  const navigate = useUiStore(s => s.navigate);
  const user = useAuthStore(s => s.user);
  const { snapshot, loading, error, reveal, load, closeReveal } = useGiftStore();

  useEffect(() => { void load(true); }, [load]);

  if (!user) {
    return (
      <main className="flex min-h-dvh flex-col items-center justify-center gap-4 relative z-10 p-6 text-center text-white">
        <p className="text-sm text-white/60">
          Les cadeaux se gardent sur ton compte :<br />ils en demandent un.
        </p>
        <Button variant="primary" onPointerDown={() => navigate('auth')}>Se connecter</Button>
        <Button onPointerDown={() => navigate('main_menu')}>◂ Menu</Button>
      </main>
    );
  }

  const pending = snapshot?.gifts.filter(g => !g.claimed) ?? [];
  const claimed = snapshot?.gifts.filter(g => g.claimed) ?? [];

  return (
    <main className="flex min-h-dvh flex-col relative z-10 text-white">
      <ScreenHeader
        title="Cadeaux"
        onBack={() => navigate('main_menu')}
        safeAreaTop
        right={snapshot && <Countdown at={snapshot.next_rotation_at} title="Prochain cadeau quotidien" />}
      />

      <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-5 p-4">
        {error && <p className="text-xs text-danger">{error}</p>}
        {loading && !snapshot && <p className="text-sm text-white/40">Chargement…</p>}

        {snapshot && (
          <>
            <section className="flex flex-col gap-2">
              <h2 className="text-[10px] tracking-widest text-white/40">CHAQUE JOUR</h2>
              <DailyCard />
            </section>

            <section className="flex flex-col gap-2">
              <div className="flex items-baseline justify-between">
                <h2 className="text-[10px] tracking-widest text-white/40">CADEAUX</h2>
                {!!pending.length && (
                  <span className="text-[10px] text-white/30">
                    {pending.length} à récupérer
                  </span>
                )}
              </div>

              {!snapshot.gifts.length ? (
                <p className="px-1 py-6 text-center text-xs leading-relaxed text-white/30">
                  Aucun cadeau pour le moment.<br />
                  Ils arrivent avec les mises à jour — reviens y jeter un œil.
                </p>
              ) : (
                [...pending, ...claimed].map(gift => <GiftCard key={gift.id} gift={gift} />)
              )}
            </section>

            <p className="px-1 text-[10px] leading-relaxed text-white/30">
              Un cadeau ne se récupère qu'une fois, et rien ne se perd : tant qu'il
              est là, il t'attend.
            </p>
          </>
        )}
      </div>

      {reveal && <GiftReveal onClose={closeReveal} />}
    </main>
  );
}

/** Le cadeau quotidien — un bouton, ou le compte à rebours vers le suivant. */
function DailyCard() {
  const snapshot = useGiftStore(s => s.snapshot);
  const claimDaily = useGiftStore(s => s.claimDaily);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  if (!snapshot) return null;
  const { reward, claimed } = snapshot.daily;

  return (
    <Panel className={`flex flex-col gap-3 p-3 ${claimed ? 'border-success/30 bg-success/5' : 'border-success bg-success/10'}`}>
      <div className="flex items-center gap-3">
        <span className="text-3xl" aria-hidden>🎁</span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">Cadeau quotidien</p>
          <p className="text-xs text-white/50">
            <Amount currency="gold" value={reward.gold} /> · <Amount currency="gems" value={reward.gems} />
          </p>
        </div>
      </div>

      {claimed ? (
        <p className="flex items-center justify-center gap-2 text-xs text-white/40">
          ✓ Récupéré — revient dans <Countdown at={snapshot.next_rotation_at} className="text-white/40" />
        </p>
      ) : (
        <Button
          variant="primary"
          disabled={busy}
          onPointerDown={() => void (async () => { setBusy(true); setErr(await claimDaily()); setBusy(false); })()}
          className="w-full justify-center border-success bg-success/20 text-success"
        >
          {busy ? '…' : 'Récupérer'}
        </Button>
      )}

      {err && (
        <p role="alert" className="rounded-lg border border-danger/50 bg-danger/10 px-2 py-1.5 text-xs leading-snug text-danger">
          {err}
        </p>
      )}
    </Panel>
  );
}

/** Un cadeau ponctuel : son contenu annoncé, et un bouton pour le prendre. */
function GiftCard({ gift }: { gift: Gift }) {
  const claim = useGiftStore(s => s.claim);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  return (
    <Panel className={`flex flex-col gap-3 p-3 ${gift.claimed ? 'border-success/30 bg-success/5' : 'border-success bg-success/10'}`}>
      <div>
        <p className="text-sm font-semibold">{gift.name}</p>
        {gift.description && <p className="mt-0.5 text-xs leading-snug text-white/50">{gift.description}</p>}
      </div>

      <ul className="flex flex-col gap-1">
        {gift.contents.map((lot, i) => (
          <li key={i} className="flex items-center gap-2 text-xs text-white/70">
            <span aria-hidden>{LOT_ICONS[lot.type]}</span>
            <span className="min-w-0 truncate">{lotLabel(lot)}</span>
          </li>
        ))}
      </ul>

      {gift.claimed ? (
        <p className="text-center text-xs text-white/40">✓ Récupéré</p>
      ) : (
        <Button
          variant="primary"
          disabled={busy}
          onPointerDown={() => void (async () => { setBusy(true); setErr(await claim(gift.id)); setBusy(false); })()}
          className="w-full justify-center border-success bg-success/20 text-success"
        >
          {busy ? '…' : 'Récupérer'}
        </Button>
      )}

      {err && (
        <p role="alert" className="rounded-lg border border-danger/50 bg-danger/10 px-2 py-1.5 text-xs leading-snug text-danger">
          {err}
        </p>
      )}
    </Panel>
  );
}

/**
 * Révélation de ce qui vient d'être livré.
 *
 * ⚠️ Rendue dans un `createPortal(…, document.body)`, et ce n'est pas optionnel :
 * elle est déclenchée depuis une tuile, donc sous un `Panel` — qui porte
 * `backdrop-blur`. Un `backdrop-filter` sur un ancêtre crée un bloc conteneur,
 * le `position: fixed` de `Modal` se résoudrait alors sur la tuile et la modale
 * se retrouverait enfermée dans sa colonne, boutons rognés. Le piège vaut pour
 * toute `Modal` rendue sous un `Panel` (cf. `ConfirmBuy` dans ShopScreen).
 */
function GiftReveal({ onClose }: { onClose: () => void }) {
  const reveal = useGiftStore(s => s.reveal);
  if (!reveal) return null;

  // Toutes les cartes livrées, qu'elles viennent d'un lot `card` ou d'un booster.
  const cards: string[] = [];
  for (const line of reveal.lines) {
    if (!line.granted) continue;
    if (line.type === 'card' && line.id) cards.push(line.id);
    if (line.type === 'pack') cards.push(...(line.cards ?? []).map(c => c.card_id));
  }
  const cosmetics = reveal.lines.filter(l => l.granted && (l.type === 'avatar' || l.type === 'variant'));
  // Les lignes sans effet sont dites franchement : le joueur doit comprendre
  // pourquoi un cadeau annonçant six choses n'en a donné que quatre.
  const missed = reveal.lines.filter(l => !l.granted);

  return createPortal(
    <Modal onClose={onClose}>
      <div className="flex flex-col gap-4">
        <div className="text-center">
          <p className="text-[10px] tracking-widest text-white/40">CADEAU REÇU</p>
          <p className="mt-1 text-base font-semibold text-gold">{reveal.title}</p>
        </div>

        {(!!reveal.gold || !!reveal.gems) && (
          <div className="flex justify-center gap-4 text-sm font-semibold">
            {/* ⚠️ Les gemmes étaient ici en `text-tier-5` — la MÊME valeur que
                `--color-gold` (#d4af61) : sur le seul écran qui montre les deux
                montants côte à côte, ils sortaient dans la même couleur.
                `Amount` va chercher la teinte dans `currency.ts`, l'écart ne
                peut plus se reproduire. */}
            {!!reveal.gold && <Amount currency="gold" value={reveal.gold} sign />}
            {!!reveal.gems && <Amount currency="gems" value={reveal.gems} sign />}
          </div>
        )}

        {!!cards.length && (
          <div className="flex flex-wrap justify-center gap-2">
            {cards.map((id, i) => {
              const card = cardOf(id);
              return card
                ? <CardTile key={`${id}-${i}`} {...cardTileProps(card as never)} size="h-32" tapOn="up" />
                : <span key={`${id}-${i}`} className="text-xs text-white/40">{id}</span>;
            })}
          </div>
        )}

        {!!cosmetics.length && (
          <div className="flex flex-wrap justify-center gap-2">
            {cosmetics.map((line, i) => (
              <img
                key={`${line.id}-${i}`}
                src={`/illustrations/${line.id}`}
                alt=""
                className="h-20 w-20 rounded-lg border border-line object-cover"
              />
            ))}
          </div>
        )}

        {!!missed.length && (
          <ul className="flex flex-col gap-0.5 text-center text-[10px] text-white/35">
            {missed.map((line, i) => (
              <li key={i}>
                {LOT_ICONS[line.type]} {line.id ?? ''} — {REASONS[line.reason ?? ''] ?? 'non livré'}
              </li>
            ))}
          </ul>
        )}

        {!!cosmetics.length && (
          <p className="text-center text-[10px] leading-relaxed text-white/30">
            Les avatars se choisissent au Profil, les illustrations dans le DeckBuilder.
          </p>
        )}

        <Button variant="primary" className="w-full justify-center" onPointerDown={onClose}>
          Continuer
        </Button>
      </div>
    </Modal>,
    document.body,
  );
}
