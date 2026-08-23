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
import { useEffect, useState, type ReactNode } from 'react';
import * as CardDatabase from '../data/CardDatabase.js';
import type { Card } from '../logic/types.js';
import { useUiStore } from '../stores/uiStore.js';
import { useAuthStore } from '../stores/authStore.js';
import { useShopStore, markShopSeen, type ShopSlot, type ShopSet } from '../stores/shopStore.js';
import { useCosmeticStore, type CosmeticAvatar, type CosmeticVariant } from '../stores/cosmeticStore.js';
import { useCollectionStore } from '../stores/collectionStore.js';
import { Amount, Button, IconButton, Panel, Gauge, Modal, Countdown } from '../components/ui/primitives.js';
import { CURRENCY, CURRENCY_BY_WIRE, fmt, type WireCurrency } from '../components/ui/currency.js';
import { ScreenHeader } from '../components/ui/ScreenHeader.js';
import CardTile, { cardTileProps } from '../components/ui/CardTile.js';
import PackContents, { PackPoster } from '../components/shop/PackContents.js';

const cardOf = (id: string | null): Card | null => (id ? (CardDatabase as any).getCard(id) ?? null : null);

export default function ShopScreen() {
  const navigate = useUiStore(s => s.navigate);
  // Tap ailleurs → fermeture du tooltip, comme sur tous les écrans qui rendent
  // des CardTile (DeckBuilder, DeckSelector, GameScreen). Sans ce handler, un
  // appui long sur une carte de la boutique ouvrait un tooltip que plus rien
  // ne refermait — `CardTile` arrête la propagation, la vignette elle-même ne
  // peut donc pas servir de zone de fermeture.
  const hideTooltip = useUiStore(s => s.hideTooltip);
  const user = useAuthStore(s => s.user);
  const { snapshot, loading, error, notice, booster, load, dismissNotice, closeBooster } = useShopStore();
  const loadCosmetics = useCosmeticStore(s => s.load);
  // La vue « contenu d'un pack » distingue les cartes possédées des manquantes,
  // et c'est `collectionStore` qui le sait. Sans `force` : l'appel est
  // idempotent, et `shopStore.absorb` continue d'y verser les cartes achetées.
  const loadCollection = useCollectionStore(s => s.load);
  const [tab, setTab] = useState<'cards' | 'cosmetics'>('cards');

  useEffect(() => { void load(true); }, [load]);
  useEffect(() => { void loadCosmetics(true); }, [loadCosmetics]);
  useEffect(() => { void loadCollection(); }, [loadCollection]);
  // Efface la pastille de nouveauté du menu principal pour l'offre du jour.
  // La dépendance est le CHAMP `day`, pas l'instantané : ce dernier change
  // d'identité à chaque achat, et la pastille ne se rejoue qu'à la rotation.
  // eslint-disable-next-line react-hooks/exhaustive-deps -- cf. ci-dessus
  useEffect(() => { if (user && snapshot) markShopSeen(user.id, snapshot.day); }, [user, snapshot?.day]);

  if (!user) {
    return (
      <main className="flex min-h-dvh flex-col items-center justify-center gap-4 relative z-10 p-6 text-center text-white">
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
    <main className="flex min-h-dvh flex-col relative z-10 text-white" onPointerDown={hideTooltip}>
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
        // Les onglets font partie du bloc épinglé : changer de rayon doit
        // rester possible sans remonter toute la vitrine.
        below={(
          <div className="flex">
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
        )}
      />

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
                  {snapshot.booster.card_count} cartes · {fmt.format(snapshot.booster.price_golds)} {CURRENCY.gold.icon} ou {fmt.format(snapshot.booster.price_gems)} {CURRENCY.gems.icon}
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
              <span className="text-[10px] text-white/30">{snapshot.prices.avatar.gems} {CURRENCY.gems.icon} pièce</span>
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
              <span className="text-[10px] text-white/30">{snapshot.prices.variant.gems} {CURRENCY.gems.icon} pièce</span>
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
  const { ask, dialog } = useBuyConfirm();

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
          onPointerDown={() => ask({
            visual: (
              <img
                src={`/illustrations/${illustrationId}`}
                alt=""
                className="h-28 w-28 rounded-lg border border-line object-cover"
              />
            ),
            title,
            detail: subtitle,
            price,
            currency: 'gems',
            onConfirm: onBuy,
          })}
          title={affordable ? undefined : 'Pas assez de gemmes'}
        >
          {price} {CURRENCY.gems.icon}
        </Button>
      )}
      {dialog}
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

// ---------------------------------------------------------------------------
//  Confirmation d'achat
// ---------------------------------------------------------------------------
//
// TOUT achat de la boutique passe par ici — emplacement, booster, cosmétique.
// Un tap de la boutique est le seul geste du jeu qui débite un solde, et il est
// définitif : il n'y a ni annulation, ni revente, ni conversion de doublon. Les
// deux boutons de prix étant côte à côte, la monnaie se choisit d'un tap et la
// mauvaise se choisit tout aussi vite.
//
// La modale n'est pas qu'un garde-fou, elle DIT ce que le tap ne disait pas :
// ce qu'on achète en grand, et le solde qu'il restera après. C'est cette
// dernière ligne qui a de la valeur — le prix, lui, était déjà sur le bouton.

// La monnaie telle qu'elle voyage vers le serveur (`golds` au pluriel, là où le
// champ du joueur est `gold`). La table qui vivait ici doublait `currency.ts` ;
// `CURRENCY_BY_WIRE` fait le pont, et il n'y a plus qu'un jeu d'icônes.
type Currency = WireCurrency;

type PendingBuy = {
  /** Ce qu'on achète, montré tel qu'il apparaît dans la vitrine. */
  visual: ReactNode;
  title: string;
  detail: string;
  price: number;
  currency: Currency;
  /** L'achat lui-même. Chaque appelant garde SA gestion d'erreur : la modale
   *  ne fait que retarder le geste, elle ne s'interpose pas dans le résultat. */
  onConfirm: () => void | Promise<unknown>;
};

/**
 * `ask(...)` arme la confirmation, `dialog` se rend à côté de la tuile. Un hook
 * plutôt qu'un état remonté à l'écran : chaque tuile reste autonome, et deux
 * confirmations ne peuvent pas se marcher dessus.
 */
function useBuyConfirm() {
  const [pending, setPending] = useState<PendingBuy | null>(null);
  return {
    ask: (p: PendingBuy) => setPending(p),
    dialog: pending ? <ConfirmBuy pending={pending} onClose={() => setPending(null)} /> : null,
  };
}

function ConfirmBuy({ pending, onClose }: { pending: PendingBuy; onClose: () => void }) {
  const user = useAuthStore(s => s.user);
  const [working, setWorking] = useState(false);
  const { icon, unit, balance, key } = CURRENCY_BY_WIRE[pending.currency];
  const after = balance(user) - pending.price;

  // Pendant l'appel, ni fermeture au fond ni second tap : l'achat n'est pas
  // idempotent côté serveur, deux envois débiteraient deux fois. (Le portal qui
  // sortait cette modale de son `Panel` vit désormais dans `Modal` elle-même.)
  return (
    <Modal onClose={working ? undefined : onClose}>
      <div className="text-center text-[10px] tracking-widest text-white/40">CONFIRMER L'ACHAT</div>

      <div className="my-3 flex justify-center">{pending.visual}</div>

      <p className="text-center text-sm font-semibold leading-tight">{pending.title}</p>
      <p className="text-center text-[11px] text-white/40">{pending.detail}</p>

      <div className="mt-3 space-y-1 rounded-lg border border-line bg-white/5 p-2 text-xs">
        <div className="flex justify-between">
          <span className="text-white/50">Prix</span>
          <Amount currency={key} value={pending.price} className="font-semibold" />
        </div>
        <div className="flex justify-between">
          <span className="text-white/50">Il te restera</span>
          <span className={`tabular-nums ${after < 0 ? 'text-danger' : 'text-white/70'}`}>
            {icon} {fmt.format(Math.max(0, after))} {unit}
          </span>
        </div>
      </div>

      <div className="mt-4 flex gap-2">
        <Button className="flex-1" disabled={working} onPointerDown={onClose}>Annuler</Button>
        <Button
          variant="primary"
          className="flex-1"
          disabled={working || after < 0}
          onPointerDown={async () => {
            setWorking(true);
            try { await pending.onConfirm(); } finally { onClose(); }
          }}
        >
          {working ? '…' : 'Acheter'}
        </Button>
      </div>
    </Modal>
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
      <Amount currency="gold" value={user.gold ?? 0} />
      <Amount currency="gems" value={user.gems ?? 0} />
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
  const { ask, dialog } = useBuyConfirm();

  const card = cardOf(slot.card_id);
  const affordableGolds = (user?.gold ?? 0) >= slot.price_golds;
  const affordableGems = (user?.gems ?? 0) >= slot.price_gems;

  // La carte est montrée plus GRANDE qu'en vitrine (h-40 contre h-28) : c'est
  // le dernier moment pour reconnaître ce qu'on achète.
  const confirmSlot = (currency: Currency): PendingBuy => ({
    visual: card
      ? <CardTile {...cardTileProps(card)} size="h-40" tapOn="up" />
      : <div className="h-40 w-28 rounded-lg border border-line" />,
    title: card?.name ?? slot.card_id,
    detail: `Tier ${slot.tier} · emplacement du jour`,
    price: currency === 'gems' ? slot.price_gems : slot.price_golds,
    currency,
    onConfirm: async () => setErr(await buy(slot, currency)),
  });
  // Épingler puis rerouler se contredit : le dé disparaît sur l'emplacement
  // épinglé plutôt que d'échouer au tap.
  const rerollable = !slot.purchased && !slot.pinned && freeReroll;

  return (
    <Panel className={`flex flex-col gap-1.5 p-2 ${
      slot.purchased ? 'border-success/40 bg-success/5' : slot.pinned ? 'border-tier-5/60 bg-tier-5/5' : ''
    }`}>
      <div className="flex items-center gap-1">
        <span className="flex-1 text-[10px] text-white/40">Tier {slot.tier}</span>
        {!slot.purchased && (
          <>
            {rerollable && (
              <IconButton
                compact
                icon="🎲"
                disabled={busy}
                onTap={async () => setErr(await reroll(slot.slot))}
                label="Changer cette proposition (1 gratuit par jour)"
                chipClassName="border-line text-white/50"
              />
            )}
            <IconButton
              compact
              icon="📌"
              disabled={busy}
              onTap={async () => setErr(await pin(slot.pinned ? null : slot.slot))}
              label={slot.pinned
                ? 'Détacher — cet emplacement sera re-tiré demain'
                : pinnedElsewhere
                  ? 'Conserver celui-ci demain (déplace l\'épingle posée sur un autre emplacement)'
                  : 'Conserver cette carte à la prochaine rotation'}
              pressed={slot.pinned}
              chipClassName={slot.pinned ? 'border-tier-5 bg-tier-5/15 text-tier-5' : 'border-line text-white/50'}
            />
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
            onPointerDown={() => ask(confirmSlot('golds'))}
          >
            {CURRENCY.gold.icon} {fmt.format(slot.price_golds)}
          </Button>
          <Button
            className="w-full px-1 text-[11px]"
            disabled={busy || !affordableGems}
            title={affordableGems ? undefined : 'Pas assez de gemmes'}
            onPointerDown={() => ask(confirmSlot('gems'))}
          >
            {CURRENCY.gems.icon} {fmt.format(slot.price_gems)}
          </Button>
        </div>
      )}
      {err && <p className="text-[10px] text-danger">{err}</p>}
      {dialog}
    </Panel>
  );
}

// --- Boosters ---

function BoosterCard({ set, priceGolds, priceGems }: { set: ShopSet; priceGolds: number; priceGems: number }) {
  const user = useAuthStore(s => s.user);
  const busy = useShopStore(s => s.busy);
  const open = useShopStore(s => s.openBooster);
  const cardCount = useShopStore(s => s.snapshot?.booster.card_count ?? 0);
  const [err, setErr] = useState<string | null>(null);
  // Consulter n'est pas acheter : la vue du contenu s'ouvre même sur un pack
  // complet ou dont le booster est éteint.
  const [contents, setContents] = useState(false);
  const { ask, dialog } = useBuyConfirm();

  const missing = set.card_count - set.owned_count;
  const disabled = busy || set.complete || !set.booster_enabled;

  // `card_count` est un plafond : quand il reste moins de cartes que ça dans le
  // pack, le booster rend ce qu'il reste, au plein tarif. La confirmation est
  // le seul endroit où on peut le dire AVANT le débit — l'écran de révélation,
  // lui, arrive trop tard.
  const short = missing < cardCount;
  const confirmBooster = (currency: Currency): PendingBuy => ({
    visual: <PackPoster set={set} className="h-28 w-28" />,
    title: set.name,
    detail: short
      ? `${missing} carte${missing > 1 ? 's' : ''} restante${missing > 1 ? 's' : ''} — le booster n'en rendra pas ${cardCount}`
      : `${cardCount} cartes · ${missing} restantes dans le pack`,
    price: currency === 'gems' ? priceGems : priceGolds,
    currency,
    onConfirm: async () => setErr(await open(set.id, currency)),
  });

  return (
    // ⚠️ `min-w-0` : la tuile est un ITEM DE GRILLE, dont le `min-width` vaut
    // `auto` par défaut — elle refuse donc de descendre sous sa largeur de
    // min-content et déborde l'écran par la droite en portrait (le document
    // gagne une barre de défilement horizontale). Les enfants tronquent déjà
    // ce qu'il faut ; il ne manquait que l'autorisation de rétrécir.
    <Panel className={`flex min-w-0 flex-col gap-2 p-3 ${set.complete ? 'border-success/40 bg-success/5' : ''}`}>
      {/* L'en-tête de la tuile OUVRE le pack : affiche, nom et compteur sont
          justement ce dont on veut le détail. Les boutons d'achat restent ses
          FRÈRES, hors du bouton — un <button> imbriqué serait du HTML invalide,
          et le tap d'achat ne doit pas ouvrir la vue au passage. */}
      <button
        type="button"
        onPointerDown={() => setContents(true)}
        aria-label={`Voir le contenu du pack ${set.name}`}
        className="flex w-full items-start gap-2 text-left"
      >
        <PackPoster set={set} className="h-12 w-12" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold leading-tight">{set.name}</p>
          <p className="truncate text-[10px] text-white/40">{set.archetypes.join(' · ')}</p>
        </div>
        <span className={`flex-shrink-0 text-xs tabular-nums ${set.complete ? 'text-success' : 'text-white/50'}`}>
          {set.owned_count}/{set.card_count}
        </span>
        <span className="flex-shrink-0 text-xs text-white/30" aria-hidden="true">›</span>
      </button>

      <Gauge value={set.card_count ? set.owned_count / set.card_count : 0} className="h-1.5" fillClassName={set.complete ? 'bg-success' : 'bg-gold'} />

      {set.complete ? (
        <p className="py-1 text-center text-xs font-semibold text-success">✓ Collection complète</p>
      ) : (
        <>
          <div className="flex gap-2">
            <Button
              variant="primary" className="flex-1 px-2 text-xs"
              disabled={disabled || (user?.gold ?? 0) < priceGolds}
              onPointerDown={() => ask(confirmBooster('golds'))}
            >
              {CURRENCY.gold.icon} {fmt.format(priceGolds)}
            </Button>
            <Button
              className="flex-1 px-2 text-xs"
              disabled={disabled || (user?.gems ?? 0) < priceGems}
              onPointerDown={() => ask(confirmBooster('gems'))}
            >
              {CURRENCY.gems.icon} {fmt.format(priceGems)}
            </Button>
          </div>
          {/* La valeur d'un booster CROÎT à mesure que le set se vide : c'est la
              propriété la plus vertueuse du système, elle doit se voir. */}
          <p className="text-[10px] text-white/30">
            {missing} carte{missing > 1 ? 's' : ''} restante{missing > 1 ? 's' : ''}
            {set.completion_reward?.gems ? ` · set complet : +${set.completion_reward.gems} ${CURRENCY.gems.icon}` : ''}
          </p>
        </>
      )}
      {err && <p className="text-[10px] text-danger">{err}</p>}
      {dialog}
      {contents && <PackContents set={set} onClose={() => setContents(false)} />}
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
      {/* `flex-wrap` et non une grille : à 5 cartes la rangée ne tient plus en
          portrait (les vignettes sont `flex-shrink-0`), et une dernière ligne
          incomplète doit rester CENTRÉE — ce qu'une grille à colonnes fixes
          collerait à gauche. */}
      <div className="flex flex-wrap justify-center gap-2">
        {booster.cards.map(({ card_id }) => {
          const card = cardOf(card_id);
          return card
            ? <CardTile key={card_id} {...cardTileProps(card)} size="h-32" tapOn="up" />
            : <span key={card_id} className="text-xs text-white/40">{card_id}</span>;
        })}
      </div>
      {booster.pin_cleared && (
        <p className="mt-3 text-center text-[11px] text-tier-5">📌 Ta carte épinglée est tombée — l'épingle est libérée.</p>
      )}
      {booster.sets_completed.map(s => (
        <p key={s.set_id} className="mt-2 text-center text-[11px] text-success">
          🏅 Set complété : {s.name}{s.rewards.gems ? ` — +${s.rewards.gems} ${CURRENCY.gems.icon}` : ''}
        </p>
      ))}
      <Button variant="primary" className="mt-4 w-full" onPointerDown={onClose}>Continuer</Button>
    </Modal>
  );
}
