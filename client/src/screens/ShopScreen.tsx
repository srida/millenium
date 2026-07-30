/* eslint-disable @typescript-eslint/no-explicit-any */
// ShopScreen — boutique de cartes (brief_boutique §3).
//
// Deux blocs, deux fonctions qui ne se recouvrent pas :
//   1. les 3 EMPLACEMENTS du jour — construction de deck. Chacun porte le
//      badge qui dit POURQUOI il est là (« ⚡ Débloque : … ») : c'est le badge
//      qui porte la valeur perçue, pas la carte. Un seul peut être ÉPINGLÉ,
//      pour le retrouver après la rotation du lendemain ;
//   2. les BOOSTERS — du volume sur un set choisi, sans plafond.
//
// Rien n'est calculé ici : prix, tirage et soldes viennent du serveur
// (shop.js). L'écran affiche et déclenche, il n'arbitre pas.
import { useEffect, useState } from 'react';
import * as CardDatabase from '../data/CardDatabase.js';
import * as AttributeDatabase from '../data/AttributeDatabase.js';
import type { Card } from '../logic/types.js';
import { useUiStore } from '../stores/uiStore.js';
import { useAuthStore } from '../stores/authStore.js';
import { useShopStore, markShopSeen, type ShopSlot, type ShopSet } from '../stores/shopStore.js';
import { Button, Panel, Gauge, Modal, Countdown } from '../components/ui/primitives.js';
import { ScreenHeader } from '../components/ui/ScreenHeader.js';
import CardTile, { cardTileProps } from '../components/ui/CardTile.js';

const fmt = new Intl.NumberFormat('fr-FR');

const cardOf = (id: string | null): Card | null => (id ? (CardDatabase as any).getCard(id) ?? null : null);
const attrName = (id: string) => (AttributeDatabase as any).getAttribute(id)?.name ?? id;

export default function ShopScreen() {
  const navigate = useUiStore(s => s.navigate);
  const user = useAuthStore(s => s.user);
  const { snapshot, loading, error, notice, booster, load, dismissNotice, closeBooster } = useShopStore();

  useEffect(() => { void load(true); }, [load]);
  // Efface la pastille de nouveauté du menu principal pour l'offre du jour.
  useEffect(() => { if (user && snapshot) markShopSeen(user.id, snapshot.day); }, [user, snapshot?.day]);

  if (!user) {
    return (
      <main className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-surface p-6 text-center text-white">
        <p className="text-sm text-white/60">
          La boutique suit ta collection et ton deck actif :<br />elle demande un compte.
        </p>
        <Button variant="primary" onPointerDown={() => navigate('auth')}>Se connecter</Button>
        <Button onPointerDown={() => navigate('main_menu')}>◂ Menu</Button>
      </main>
    );
  }

  const complete = snapshot && snapshot.collection.owned >= snapshot.collection.total;

  return (
    <main className="flex min-h-dvh flex-col bg-surface text-white">
      <ScreenHeader
        title="Boutique"
        onBack={() => navigate('main_menu')}
        safeAreaTop
        right={(
          <>
            <Balance />
            {snapshot && <Countdown at={snapshot.next_rotation_at} title="Nouvelle sélection" />}
          </>
        )}
      />

      <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-4 p-4">
        {error && <p className="text-xs text-danger">{error}</p>}
        {loading && !snapshot && <p className="text-sm text-white/40">Chargement…</p>}

        {notice && (
          <button
            onPointerDown={dismissNotice}
            className="rounded-lg border border-gold/50 bg-gold/10 px-3 py-2 text-left text-xs text-gold"
          >
            🏅 {notice}
          </button>
        )}

        {snapshot && (
          <>
            <section className="flex flex-col gap-2">
              <div className="flex items-baseline justify-between px-1">
                <h2 className="text-[10px] tracking-widest text-white/40">
                  EMPLACEMENTS DU JOUR — {snapshot.slots.filter(s => !s.purchased).length}/{snapshot.slots.length}
                </h2>
                <span className="text-[10px] text-white/30">
                  {snapshot.reroll.free_available ? '1 reroll gratuit' : 'reroll utilisé'}
                  {' · '}
                  {snapshot.pinned ? '📌 1 épingle posée' : `📌 ${snapshot.pin_rules.max} épingle`}
                </span>
              </div>

              {/* Collection saturée : la boutique n'a plus rien à vendre — on le
                  dit, plutôt que d'afficher trois cases vides. */}
              {complete ? (
                <Panel className="p-4 text-center text-sm text-success">
                  ✓ Collection complète — {fmt.format(snapshot.collection.total)} cartes. Plus rien à acheter ici.
                </Panel>
              ) : (
                <div className="grid gap-2 sm:grid-cols-3">
                  {snapshot.slots.map(slot => <SlotCard key={slot.slot} slot={slot} />)}
                </div>
              )}
            </section>

            <section className="flex flex-col gap-2">
              <div className="flex items-baseline justify-between px-1">
                <h2 className="text-[10px] tracking-widest text-white/40">BOOSTERS</h2>
                <span className="text-[10px] text-white/30">
                  {snapshot.booster.card_count} cartes · {fmt.format(snapshot.booster.price_golds)} 💰 ou {fmt.format(snapshot.booster.price_gems)} 💎
                </span>
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                {snapshot.sets.map(set => (
                  <BoosterCard key={set.id} set={set} priceGolds={snapshot.booster.price_golds} priceGems={snapshot.booster.price_gems} />
                ))}
              </div>
            </section>

            <p className="px-1 text-[10px] leading-relaxed text-white/30">
              Nouvelle sélection chaque jour à 5 h — sauf l'emplacement épinglé, qui est conservé
              {' '}jusqu'à ce que tu l'achètes ou le détaches. Une carte achetée quitte définitivement
              {' '}la boutique : aucun tirage ne peut proposer une carte déjà possédée, il n'y a donc
              {' '}jamais de doublon.
              {' '}Collection : {fmt.format(snapshot.collection.owned)} / {fmt.format(snapshot.collection.total)} cartes.
            </p>
          </>
        )}
      </div>

      {booster && <BoosterReveal onClose={closeBooster} />}
    </main>
  );
}

/** Soldes, à la même enseigne qu'ailleurs (mêmes icônes que ProgressionStats). */
function Balance() {
  const user = useAuthStore(s => s.user);
  if (!user) return null;
  return (
    // Masqué en web : le header y affiche déjà le solde (ProgressionPills), le
    // répéter serait redondant. En mobile, le header n'affiche que le profil,
    // donc le solde reste ici — fonctionnel pendant les achats.
    <span className="flex items-center gap-2 text-xs tabular-nums sm:hidden">
      <span className="text-gold" title="Golds">💰 {fmt.format(user.gold ?? 0)}</span>
      <span className="text-tier-4" title="Gemmes">💎 {fmt.format(user.gems ?? 0)}</span>
    </span>
  );
}

// --- Emplacements quotidiens ---

/**
 * Le badge dit pourquoi la carte est là. C'est lui qui porte la valeur : « une
 * carte au hasard à 350 golds » et « la pièce qui manque à ta fusion à 350
 * golds » ne sont pas la même proposition.
 */
function ReasonBadge({ slot }: { slot: ShopSlot }) {
  const ref = cardOf(slot.reason_ref);
  const styles = 'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] leading-tight';

  if (slot.reason === 'material') {
    return (
      <span className={`${styles} min-w-0 border-gold/60 bg-gold/10 text-gold`}>
        ⚡ <span className="truncate">Débloque : {ref?.name ?? slot.reason_ref}</span>
      </span>
    );
  }
  if (slot.reason === 'unlocks') {
    return <span className={`${styles} border-gold/60 bg-gold/10 text-gold`}>⚡ Invocable immédiatement</span>;
  }
  if (slot.reason === 'affinity') {
    return (
      <span className={`${styles} min-w-0 border-player/60 bg-player/10 text-player`}>
        🧬 <span className="truncate">{attrName(slot.reason_ref ?? '')} — ton deck</span>
      </span>
    );
  }
  return <span className={`${styles} border-line text-white/50`}>🎲 Découverte</span>;
}

function SlotCard({ slot }: { slot: ShopSlot }) {
  const user = useAuthStore(s => s.user);
  const busy = useShopStore(s => s.busy);
  const freeReroll = useShopStore(s => s.snapshot?.reroll.free_available ?? false);
  const pinnedElsewhere = useShopStore(s => !!s.snapshot?.pinned && !slot.pinned);
  const { buy, reroll, pin } = useShopStore();
  const [err, setErr] = useState<string | null>(null);

  const card = cardOf(slot.card_id);
  const affordableGolds = (user?.gold ?? 0) >= slot.price_golds;
  const affordableGems = (user?.gems ?? 0) >= slot.price_gems;
  // Épingler puis rerouler se contredit : le die disparaît sur l'emplacement
  // épinglé plutôt que d'échouer au tap.
  const rerollable = !slot.purchased && !slot.pinned && freeReroll;

  return (
    <Panel className={`flex flex-col gap-2 p-3 ${
      slot.purchased ? 'border-success/40 bg-success/5' : slot.pinned ? 'border-tier-5/60 bg-tier-5/5' : ''
    }`}>
      <ReasonBadge slot={slot} />

      <div className="flex gap-3">
        {card
          ? <CardTile {...cardTileProps(card)} size="h-28" tapOn="up" dim={slot.purchased ? 'soft' : 'none'} />
          : <div className="h-28 w-20 rounded-lg border border-line" />}
        <div className="flex min-w-0 flex-1 flex-col">
          <p className="truncate text-sm font-semibold leading-tight">{card?.name ?? slot.card_id}</p>
          <p className="mt-0.5 text-[10px] text-white/40">Tier {slot.tier}</p>
          {/* L'épingle ne se lit pas dans l'état du bouton : on dit ce qu'elle
              PROMET (« encore là demain »), pas qu'elle est active. */}
          {slot.pinned && !slot.purchased && (
            <p className="mt-0.5 text-[10px] leading-tight text-tier-5">📌 Conservée à la prochaine rotation</p>
          )}
          <span className="mt-auto flex items-center gap-2 text-sm font-bold tabular-nums">
            <span className={affordableGolds ? 'text-gold' : 'text-white/30'}>💰 {fmt.format(slot.price_golds)}</span>
            <span className={affordableGems ? 'text-tier-4' : 'text-white/30'}>💎 {fmt.format(slot.price_gems)}</span>
          </span>
        </div>
      </div>

      <div className="flex items-center gap-2">
        {slot.purchased ? (
          <span className="flex min-h-tap flex-1 items-center justify-center text-sm font-semibold text-success">✓ Acheté</span>
        ) : (
          <>
            <Button
              variant="primary"
              className="flex-1 px-2 text-xs"
              disabled={busy || !affordableGolds}
              title={affordableGolds ? undefined : 'Pas assez de golds'}
              onPointerDown={async () => setErr(await buy(slot, 'golds'))}
            >
              💰 {fmt.format(slot.price_golds)}
            </Button>
            <Button
              className="flex-1 px-2 text-xs"
              disabled={busy || !affordableGems}
              title={affordableGems ? undefined : 'Pas assez de gemmes'}
              onPointerDown={async () => setErr(await buy(slot, 'gems'))}
            >
              💎 {fmt.format(slot.price_gems)}
            </Button>
            <button
              disabled={busy}
              onPointerDown={async () => setErr(await pin(slot.pinned ? null : slot.slot))}
              title={slot.pinned
                ? 'Détacher — cet emplacement sera re-tiré demain'
                : pinnedElsewhere
                  ? 'Conserver celui-ci demain (déplace l\'épingle posée sur un autre emplacement)'
                  : 'Conserver cette carte à la prochaine rotation'}
              aria-label={slot.pinned ? 'Détacher cet emplacement' : 'Épingler cet emplacement'}
              aria-pressed={slot.pinned}
              className={`flex min-h-tap min-w-tap items-center justify-center rounded-lg border px-2 text-xs active:opacity-70 disabled:opacity-30 ${
                slot.pinned ? 'border-tier-5 bg-tier-5/15 text-tier-5' : 'border-line text-white/50'
              }`}
            >
              📌
            </button>
          </>
        )}
        {rerollable && (
          <button
            disabled={busy}
            onPointerDown={async () => setErr(await reroll(slot.slot))}
            title="Changer cette proposition (1 gratuit par jour)"
            aria-label="Changer cette proposition"
            className="flex min-h-tap min-w-tap items-center justify-center rounded-lg border border-line px-2 text-xs text-white/50 active:opacity-70 disabled:opacity-30"
          >
            🎲
          </button>
        )}
      </div>
      {err && <p className="text-[10px] text-danger">{err}</p>}
    </Panel>
  );
}

// --- Boosters ---

/**
 * Affiche du pack — c'est le visage du produit, pas une vignette d'appoint :
 * elle occupe la gauche de la carte, comme l'illustration d'un emplacement.
 * Sans affiche posée en admin, une tuile neutre : le serveur n'a pas d'image
 * par défaut à servir, et une `<img>` cassée serait pire que rien.
 */
function PackPoster({ set, className, fallbackClassName = 'text-2xl' }: {
  set: ShopSet;
  className: string;
  fallbackClassName?: string;
}) {
  if (!set.has_poster) {
    return (
      <div className={`${className} ${fallbackClassName} flex flex-shrink-0 items-center justify-center rounded-lg border border-line bg-white/5 text-white/25`}>
        🎁
      </div>
    );
  }
  return (
    <img
      src={`/pack-posters/${set.id}`}
      alt=""
      loading="lazy"
      className={`${className} flex-shrink-0 rounded-lg border border-line object-cover`}
    />
  );
}

function BoosterCard({ set, priceGolds, priceGems }: { set: ShopSet; priceGolds: number; priceGems: number }) {
  const user = useAuthStore(s => s.user);
  const busy = useShopStore(s => s.busy);
  const open = useShopStore(s => s.openBooster);
  const [err, setErr] = useState<string | null>(null);

  const missing = set.card_count - set.owned_count;
  const disabled = busy || set.complete || !set.booster_enabled;

  return (
    // L'affiche à gauche, le reste à droite : même anatomie qu'un emplacement du
    // jour (illustration puis texte), pour que la section Boosters se lise au
    // même rythme que celle du dessus.
    <Panel className={`flex gap-3 p-3 ${set.complete ? 'border-success/40 bg-success/5' : ''}`}>
      <PackPoster set={set} className="h-28 w-24" />

      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold leading-tight">{set.name}</p>
            <p className="truncate text-[10px] text-white/40">{set.archetypes.join(' · ')}</p>
          </div>
          <span className={`flex-shrink-0 text-xs tabular-nums ${set.complete ? 'text-success' : 'text-white/50'}`}>
            {set.owned_count}/{set.card_count}
          </span>
        </div>

        <Gauge value={set.card_count ? set.owned_count / set.card_count : 0} className="h-1.5" fillClassName={set.complete ? 'bg-success' : 'bg-gold'} />

        {set.complete ? (
          <p className="my-auto py-1 text-center text-xs font-semibold text-success">✓ Collection complète</p>
        ) : (
          <>
            <div className="mt-auto flex gap-2">
              <Button
                variant="primary" className="flex-1 px-2 text-xs"
                disabled={disabled || (user?.gold ?? 0) < priceGolds}
                onPointerDown={async () => setErr(await open(set.id, 'golds'))}
              >
                💰 {fmt.format(priceGolds)}
              </Button>
              <Button
                className="flex-1 px-2 text-xs"
                disabled={disabled || (user?.gems ?? 0) < priceGems}
                onPointerDown={async () => setErr(await open(set.id, 'gems'))}
              >
                💎 {fmt.format(priceGems)}
              </Button>
            </div>
            {/* La valeur d'un booster CROÎT à mesure que le set se vide : c'est la
                propriété la plus vertueuse du système, elle doit se voir. */}
            <p className="text-[10px] text-white/30">
              {missing} carte{missing > 1 ? 's' : ''} restante{missing > 1 ? 's' : ''}
              {set.completion_reward?.gems ? ` · set complet : +${set.completion_reward.gems} 💎` : ''}
            </p>
          </>
        )}
        {err && <p className="text-[10px] text-danger">{err}</p>}
      </div>
    </Panel>
  );
}

function BoosterReveal({ onClose }: { onClose: () => void }) {
  const booster = useShopStore(s => s.booster);
  // Le pack ouvert, retrouvé dans l'instantané : c'est de là que viennent son
  // nom et son affiche (la réponse d'achat ne porte qu'un `set_id`).
  const set = useShopStore(s => s.snapshot?.sets.find(x => x.id === booster?.set_id) ?? null);
  if (!booster) return null;

  return (
    <Modal onClose={onClose}>
      <div className="mb-3 flex items-center justify-center gap-2">
        {set && <PackPoster set={set} className="h-10 w-10" fallbackClassName="text-lg" />}
        <h2 className="text-sm font-bold tracking-widest text-gold">{set ? set.name.toUpperCase() : 'BOOSTER OUVERT'}</h2>
      </div>
      <div className="flex justify-center gap-2">
        {booster.cards.map(({ card_id }) => {
          const card = cardOf(card_id);
          return card
            ? <CardTile key={card_id} {...cardTileProps(card)} size="h-36" tapOn="up" />
            : <span key={card_id} className="text-xs text-white/40">{card_id}</span>;
        })}
      </div>
      {booster.pin_cleared && (
        <p className="mt-3 text-center text-[11px] text-tier-5">📌 Ta carte épinglée est tombée — l'épingle est libérée.</p>
      )}
      {booster.sets_completed.map(s => (
        <p key={s.set_id} className="mt-2 text-center text-[11px] text-success">
          🏅 Set complété : {s.name}{s.rewards.gems ? ` — +${s.rewards.gems} 💎` : ''}
        </p>
      ))}
      <Button variant="primary" className="mt-4 w-full" onPointerDown={onClose}>Continuer</Button>
    </Modal>
  );
}
