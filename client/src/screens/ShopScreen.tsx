/* eslint-disable @typescript-eslint/no-explicit-any */
// ShopScreen — boutique. Deux onglets, deux économies distinctes.
//
// 🃏 CARTES (brief_boutique §3) — ce qui change le jeu, acheté en golds ou en
// gemmes. Deux blocs qui ne se recouvrent pas :
//   1. les 6 EMPLACEMENTS du jour — une vitrine tirée dans tout le catalogue
//      non possédé. Pas de catégorie, pas de badge : les emplacements sont
//      interchangeables et ne se distinguent que par la carte. Un seul peut
//      être ÉPINGLÉ, pour le retrouver après la rotation du lendemain ;
//   2. les BOOSTERS — du volume sur un set choisi, sans plafond.
//
// 🎨 COSMÉTIQUES — ce qui ne change rien au jeu, en gemmes uniquement, à prix
// fixe. 3 avatars + 3 variantes d'illustration par jour. Ni reroll ni épingle :
// les prix sont bas et un cosmétique manqué revient (il ne quitte pas le pool
// à l'achat, contrairement à une carte).
//
// Rien n'est calculé ici : prix, tirage et soldes viennent du serveur
// (shop.js, cosmetics.js). L'écran affiche et déclenche, il n'arbitre pas.
import { useEffect, useState } from 'react';
import * as CardDatabase from '../data/CardDatabase.js';
import type { Card } from '../logic/types.js';
import { useUiStore } from '../stores/uiStore.js';
import { useAuthStore } from '../stores/authStore.js';
import { useShopStore, markShopSeen, type ShopSlot, type ShopSet } from '../stores/shopStore.js';
import { useCosmeticStore, type CosmeticAvatar, type CosmeticVariant } from '../stores/cosmeticStore.js';
import { Button, Panel, Gauge, Modal, Countdown } from '../components/ui/primitives.js';
import { ScreenHeader } from '../components/ui/ScreenHeader.js';
import CardTile, { cardTileProps } from '../components/ui/CardTile.js';

const fmt = new Intl.NumberFormat('fr-FR');

const cardOf = (id: string | null): Card | null => (id ? (CardDatabase as any).getCard(id) ?? null : null);

export default function ShopScreen() {
  const navigate = useUiStore(s => s.navigate);
  const user = useAuthStore(s => s.user);
  const { snapshot, loading, error, notice, booster, load, dismissNotice, closeBooster } = useShopStore();
  const loadCosmetics = useCosmeticStore(s => s.load);
  const [tab, setTab] = useState<'cards' | 'cosmetics'>('cards');

  useEffect(() => { void load(true); }, [load]);
  useEffect(() => { void loadCosmetics(true); }, [loadCosmetics]);
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

      <div className="flex border-b border-line">
        {([['cards', '🃏 Cartes'], ['cosmetics', '🎨 Cosmétiques']] as const).map(([key, label]) => (
          <button
            key={key}
            onPointerDown={() => setTab(key)}
            className={`min-h-tap flex-1 text-sm font-semibold ${tab === key ? 'border-b-2 border-gold text-gold' : 'text-white/50'}`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'cosmetics' ? <CosmeticsTab /> : (
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
                // Six emplacements : deux colonnes dès le portrait (une seule
                // ferait six écrans de scroll), trois dès qu'il y a la largeur.
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
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
      )}

      {booster && <BoosterReveal onClose={closeBooster} />}
    </main>
  );
}

// ---------------------------------------------------------------------------
//  Onglet cosmétiques
// ---------------------------------------------------------------------------

// Pas de modale de révélation, contrairement au booster : l'achat est unitaire
// et son résultat est déjà à l'écran. Un bandeau suffit — et il dit OÙ aller
// s'en servir, sans quoi le joueur reste avec un objet acheté et invisible.
function CosmeticsTab() {
  const { snapshot, loading, error, notice, dismissNotice } = useCosmeticStore();

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-4 p-4">
      {error && <p className="text-xs text-danger">{error}</p>}
      {loading && !snapshot && <p className="text-sm text-white/40">Chargement…</p>}

      {notice && (
        <button
          onPointerDown={dismissNotice}
          className="rounded-lg border border-gold/50 bg-gold/10 px-3 py-2 text-left text-xs text-gold"
        >
          ✨ {notice}
        </button>
      )}

      {snapshot && (
        <>
          <section className="flex flex-col gap-2">
            <div className="flex items-baseline justify-between px-1">
              <h2 className="text-[10px] tracking-widest text-white/40">AVATARS DU JOUR</h2>
              <span className="text-[10px] text-white/30">{snapshot.prices.avatar.gems} 💎 pièce</span>
            </div>
            {snapshot.avatars.length ? (
              <div className="grid grid-cols-3 gap-2">
                {snapshot.avatars.map(a => <AvatarOffer key={a.id} avatar={a} />)}
              </div>
            ) : (
              <Panel className="p-4 text-center text-xs text-white/40">
                Plus aucun avatar à débloquer — tu les as tous.
              </Panel>
            )}
          </section>

          <section className="flex flex-col gap-2">
            <div className="flex items-baseline justify-between px-1">
              <h2 className="text-[10px] tracking-widest text-white/40">VARIANTES DU JOUR</h2>
              <span className="text-[10px] text-white/30">{snapshot.prices.variant.gems} 💎 pièce</span>
            </div>
            {snapshot.variants.length ? (
              <div className="grid grid-cols-3 gap-2">
                {snapshot.variants.map(v => <VariantOffer key={v.id} variant={v} />)}
              </div>
            ) : (
              // Deux causes, un seul message : aucune variante ne vise une carte
              // possédée, ou le joueur les a toutes. Dire « reviens quand tu
              // auras d'autres cartes » couvre les deux sans mentir.
              <Panel className="p-4 text-center text-xs text-white/40">
                Aucune illustration alternative disponible pour tes cartes aujourd'hui.
              </Panel>
            )}
          </section>

          <p className="px-1 text-[10px] leading-relaxed text-white/30">
            Nouvelle sélection chaque jour à 5 h, en même temps que les cartes. Les cosmétiques ne
            {' '}changent rien au jeu : un avatar se porte depuis ton profil, une illustration se
            {' '}choisit carte par carte dans le DeckBuilder — et l'adversaire la voit aussi. Tu ne
            {' '}peux acheter que les illustrations des cartes que tu possèdes.
          </p>
        </>
      )}
    </div>
  );
}

/** Tuile d'offre — l'image, le nom, le prix, un bouton. Rien de plus. */
function CosmeticOffer({
  illustrationId, title, subtitle, price, purchased, onBuy,
}: {
  illustrationId: string; title: string; subtitle: string;
  price: number; purchased: boolean; onBuy: () => void;
}) {
  const busy = useCosmeticStore(s => s.busy);
  const gems = useAuthStore(s => s.user?.gems ?? 0);
  const affordable = gems >= price;

  return (
    <Panel className="flex flex-col gap-1.5 p-2">
      <img
        src={`/illustrations/${illustrationId}`}
        alt=""
        loading="lazy"
        className="aspect-square w-full rounded-lg border border-line object-cover"
      />
      <div className="min-h-8">
        <div className="truncate text-[11px] font-semibold leading-tight">{title}</div>
        <div className="truncate text-[10px] text-white/40">{subtitle}</div>
      </div>
      {purchased ? (
        <div className="py-1 text-center text-[11px] font-semibold text-success">✓ Débloqué</div>
      ) : (
        <Button
          variant={affordable ? 'primary' : undefined}
          className="w-full px-1 text-[11px]"
          disabled={busy || !affordable}
          onPointerDown={onBuy}
          title={affordable ? undefined : 'Pas assez de gemmes'}
        >
          {price} 💎
        </Button>
      )}
    </Panel>
  );
}

function AvatarOffer({ avatar }: { avatar: CosmeticAvatar }) {
  const buy = useCosmeticStore(s => s.buy);
  const SOURCE_LABEL = { card: 'Carte', board: 'Terrain', magie: 'Magie' } as const;
  return (
    <CosmeticOffer
      illustrationId={avatar.id}
      title={avatar.name}
      subtitle={SOURCE_LABEL[avatar.source] ?? 'Avatar'}
      price={avatar.price_gems}
      purchased={avatar.purchased}
      onBuy={() => { void buy('avatar', avatar.id, avatar.name); }}
    />
  );
}

function VariantOffer({ variant }: { variant: CosmeticVariant }) {
  const buy = useCosmeticStore(s => s.buy);
  return (
    <CosmeticOffer
      // L'illustration montrée est CELLE DE LA VARIANTE, pas celle de la carte :
      // c'est exactement ce qu'on achète. Le nom affiché est en revanche celui
      // de la CARTE — une variante n'a pas de nom propre, et « Magicien
      // sombre » dit tout ce qu'il y a à savoir quand l'image est sous les yeux.
      illustrationId={variant.id}
      title={variant.card_name}
      subtitle="Illustration alternative"
      price={variant.price_gems}
      purchased={variant.purchased}
      onBuy={() => { void buy('variant', variant.id, variant.card_name); }}
    />
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
 * Un emplacement. Disposition VERTICALE (vignette au-dessus, prix empilés) :
 * six tuiles tiennent en deux colonnes dès le portrait, ce qu'une disposition
 * horizontale ne permettait pas. Les deux icônes (📌 épingler, 🎲 rerouler)
 * passent en tête de tuile, sur la ligne du tier — elles ne se disputent plus
 * la largeur avec les boutons d'achat.
 */
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
  // Épingler puis rerouler se contredit : le dé disparaît sur l'emplacement
  // épinglé plutôt que d'échouer au tap.
  const rerollable = !slot.purchased && !slot.pinned && freeReroll;

  const iconBtn = 'flex h-7 w-7 items-center justify-center rounded-md border text-[11px] active:opacity-70 disabled:opacity-30';

  return (
    <Panel className={`flex flex-col gap-1.5 p-2 ${
      slot.purchased ? 'border-success/40 bg-success/5' : slot.pinned ? 'border-tier-5/60 bg-tier-5/5' : ''
    }`}>
      <div className="flex items-center gap-1">
        <span className="flex-1 text-[10px] text-white/40">Tier {slot.tier}</span>
        {!slot.purchased && (
          <>
            {rerollable && (
              <button
                disabled={busy}
                onPointerDown={async () => setErr(await reroll(slot.slot))}
                title="Changer cette proposition (1 gratuit par jour)"
                aria-label="Changer cette proposition"
                className={`${iconBtn} border-line text-white/50`}
              >
                🎲
              </button>
            )}
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
              className={`${iconBtn} ${slot.pinned ? 'border-tier-5 bg-tier-5/15 text-tier-5' : 'border-line text-white/50'}`}
            >
              📌
            </button>
          </>
        )}
      </div>

      <div className="flex justify-center">
        {card
          ? <CardTile {...cardTileProps(card)} size="h-28" tapOn="up" dim={slot.purchased ? 'soft' : 'none'} />
          : <div className="h-28 w-20 rounded-lg border border-line" />}
      </div>

      <p className="truncate text-center text-[11px] font-semibold leading-tight">{card?.name ?? slot.card_id}</p>

      {/* L'épingle ne se lit pas dans l'état du bouton : on dit ce qu'elle
          PROMET (« encore là demain »), pas qu'elle est active. */}
      {slot.pinned && !slot.purchased && (
        <p className="text-center text-[10px] leading-tight text-tier-5">📌 Conservée demain</p>
      )}

      {slot.purchased ? (
        <span className="py-1 text-center text-xs font-semibold text-success">✓ Acheté</span>
      ) : (
        <div className="flex flex-col gap-1">
          <Button
            variant="primary"
            className="w-full px-1 text-[11px]"
            disabled={busy || !affordableGolds}
            title={affordableGolds ? undefined : 'Pas assez de golds'}
            onPointerDown={async () => setErr(await buy(slot, 'golds'))}
          >
            💰 {fmt.format(slot.price_golds)}
          </Button>
          <Button
            className="w-full px-1 text-[11px]"
            disabled={busy || !affordableGems}
            title={affordableGems ? undefined : 'Pas assez de gemmes'}
            onPointerDown={async () => setErr(await buy(slot, 'gems'))}
          >
            💎 {fmt.format(slot.price_gems)}
          </Button>
        </div>
      )}
      {err && <p className="text-[10px] text-danger">{err}</p>}
    </Panel>
  );
}

// --- Boosters ---

/**
 * Affiche du pack — c'est elle qui lui donne un visage à côté de son nom. Sans
 * affiche posée en admin, une tuile neutre : le serveur n'a pas d'image par
 * défaut à servir, et une `<img>` cassée serait pire que rien.
 */
function PackPoster({ set, className }: { set: ShopSet; className: string }) {
  if (!set.has_poster) {
    return (
      <div className={`${className} flex flex-shrink-0 items-center justify-center rounded-lg border border-line bg-white/5 text-white/25`}>
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
    <Panel className={`flex flex-col gap-2 p-3 ${set.complete ? 'border-success/40 bg-success/5' : ''}`}>
      <div className="flex items-start gap-2">
        <PackPoster set={set} className="h-12 w-12" />
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
        <p className="py-1 text-center text-xs font-semibold text-success">✓ Collection complète</p>
      ) : (
        <>
          <div className="flex gap-2">
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
        {set && <PackPoster set={set} className="h-8 w-8" />}
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
