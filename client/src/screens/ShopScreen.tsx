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
// fixe. 3 avatars + 3 variantes d'illustration + 2 dos + 3 reflets par jour. Ni reroll ni épingle :
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
import { useCosmeticStore, type CosmeticAvatar, type CosmeticVariant, type CosmeticCardBack, type CosmeticFoil } from '../stores/cosmeticStore.js';
import { useCollectionStore } from '../stores/collectionStore.js';
import { Button, Countdown, Gauge, IconButton, Illustration, LoadState, Modal, Panel, usePressSquash } from '../components/ui/primitives.js';
import HoldConfirmButton from '../components/ui/HoldConfirmButton.js';
import { CURRENCY, fmt } from '../components/ui/currency.js';
import Card3D, { cardVisualProps } from '../components/ui/Card3D.js';
import PackContents, { PackPoster } from '../components/shop/PackContents.js';
import { GuestGate } from '../components/ui/GuestGate.js';
import { useWebLayout } from '../components/system/useWebLayout.js';

const cardOf = (id: string | null): Card | null => (id ? (CardDatabase as any).getCard(id) ?? null : null);

export default function ShopScreen() {
  // Tap ailleurs → fermeture du tooltip, comme sur tous les écrans qui rendent
  // des Card3D (DeckBuilder, DeckSelector, GameScreen). Sans ce handler, un
  // appui long sur une carte de la boutique ouvrait un tooltip que plus rien
  // ne refermait — `Card3D` arrête la propagation, la vignette elle-même ne
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

  const web = useWebLayout();
  const classname_title = `flex items-center gap-3 py-3${web ? ' px-22' : ' px-6'}`;

  useEffect(() => { void load(true); }, [load]);
  useEffect(() => { void loadCosmetics(true); }, [loadCosmetics]);
  useEffect(() => { void loadCollection(); }, [loadCollection]);
  // Efface la pastille de nouveauté du menu principal pour l'offre du jour.
  // La dépendance est le CHAMP `day`, pas l'instantané : ce dernier change
  // d'identité à chaque achat, et la pastille ne se rejoue qu'à la rotation.
  // eslint-disable-next-line react-hooks/exhaustive-deps -- cf. ci-dessus
  useEffect(() => { if (user && snapshot) markShopSeen(user.id, snapshot.day); }, [user, snapshot?.day]);

  if (!user) return <GuestGate reason="La boutique suit ta collection et ton deck actif : elle demande un compte." />;

  const complete = snapshot && snapshot.collection.owned >= snapshot.collection.total;

  return (
    <main className="flex min-h-full flex-col relative z-10 text-white" onPointerDown={hideTooltip}>
      <div className="border-b border-line">
        <div className={classname_title}>
          <h1 className="text-lg font-bold tracking-wide">Boutique</h1>
          {/* Le solde n'est plus répété ici : `AppHeader` l'affiche déjà en
              permanence (ProgressionPills), sur toutes les pages. */}
          {snapshot && <Countdown at={snapshot.next_rotation_at} title="Nouvelle sélection" className="ml-auto" />}
        </div>
        {/* Les onglets font partie du bloc épinglé : changer de rayon doit
            rester possible sans remonter toute la vitrine. */}
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
      </div>

      {tab === 'cosmetics' ? <CosmeticsTab /> : (
      <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-4 p-4">
        <LoadState error={error} loading={loading} hasContent={!!snapshot} />

        {notice && (
          <button
            onPointerDown={dismissNotice}
            className="rounded-lg border border-gold bg-[color-mix(in_srgb,var(--color-gold)_16%,var(--color-surface-raised))] px-3 py-2 text-left text-xs text-gold"
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
      <LoadState error={error} loading={loading} hasContent={!!snapshot} />

      {notice && (
        <button
          onPointerDown={dismissNotice}
          className="rounded-lg border border-gold bg-[color-mix(in_srgb,var(--color-gold)_16%,var(--color-surface-raised))] px-3 py-2 text-left text-xs text-gold"
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

          <section className="flex flex-col gap-2">
            <div className="flex items-baseline justify-between px-1">
              <h2 className="text-[10px] tracking-widest text-white/40">DOS DE CARTES DU JOUR</h2>
              {/* ⚠️ Pas de prix en en-tête, contrairement aux deux autres
                  familles : le prix d'un dos est ÉDITORIAL (saisi en admin,
                  différent d'un dos à l'autre). Un « X 💎 pièce » mentirait. */}
              <span className="text-[10px] text-white/30">prix à la pièce</span>
            </div>
            {snapshot.card_backs.length ? (
              <div className="grid grid-cols-3 gap-2">
                {snapshot.card_backs.map(b => <CardBackOffer key={b.id} back={b} />)}
              </div>
            ) : (
              <Panel className="p-4 text-center text-xs text-white/40">
                Aucun dos de carte à débloquer aujourd'hui.
              </Panel>
            )}
          </section>

          <section className="flex flex-col gap-2">
            <div className="flex items-baseline justify-between px-1">
              <h2 className="text-[10px] tracking-widest text-white/40">REFLETS DU JOUR</h2>
              <span className="text-[10px] text-white/30">{snapshot.prices.foil?.gems ?? 20} {CURRENCY.gems.icon} pièce</span>
            </div>
            {snapshot.foils.length ? (
              <div className="grid grid-cols-3 gap-2">
                {snapshot.foils.map(f => <FoilOffer key={f.id} foil={f} />)}
              </div>
            ) : (
              <Panel className="p-4 text-center text-xs text-white/40">
                Tu as déjà le reflet de toutes tes cartes.
              </Panel>
            )}
          </section>

          <p className="px-1 text-[10px] leading-relaxed text-white/30">
            Nouvelle sélection chaque jour à 5 h, en même temps que les cartes. Les cosmétiques ne
            {' '}changent rien au jeu : un avatar se porte depuis ton profil, une illustration se
            {' '}choisit carte par carte dans le DeckBuilder — et l'adversaire la voit aussi. Tu ne
            {' '}peux acheter que les illustrations des cartes que tu possèdes. Un dos de carte se
            {' '}porte lui aussi depuis ton profil : c'est lui qu'on retourne au début de chaque tour. Un
            {' '}reflet fait passer une lame de lumière sur l'illustration d'une de tes cartes, sur le
            {' '}plateau : il s'active carte par carte dans le DeckBuilder, comme une illustration.
          </p>
        </>
      )}
    </div>
  );
}

/** Tuile d'offre — l'image, le nom, le prix, un bouton. Rien de plus. */
function CosmeticOffer({
  illustrationId, title, subtitle, price, purchased, onBuy, foil = false,
}: {
  illustrationId: string; title: string; subtitle: string;
  price: number; purchased: boolean; onBuy: () => void;
  /** Montre le reflet EN MARCHE sur la vignette : c'est lui qu'on achète. */
  foil?: boolean;
}) {
  const busy = useCosmeticStore(s => s.busy);
  const gems = useAuthStore(s => s.user?.gems ?? 0);
  const affordable = gems >= price;

  return (
    <Panel className="flex flex-col gap-1.5 p-2">
      <FoilFrame foil={foil} className="aspect-square w-full">
        <Illustration id={illustrationId} framed className="h-full w-full" />
      </FoilFrame>
      <div className="min-h-8">
        <div className="truncate text-[11px] font-semibold leading-tight">{title}</div>
        <div className="truncate text-[10px] text-white/40">{subtitle}</div>
      </div>
      {purchased ? (
        <div className="py-1 text-center text-[11px] font-semibold text-success">✓ Débloqué</div>
      ) : (
        <HoldConfirmButton
          icon={CURRENCY.gems.icon}
          label={fmt.format(price)}
          actionLabel={`acheter ${title}`}
          cost={price}
          currency="gems"
          fullWidth
          disabled={busy || !affordable}
          title={affordable ? undefined : 'Pas assez de gemmes'}
          onConfirm={onBuy}
          className="px-1 text-[11px]"
        />
      )}
    </Panel>
  );
}

/** Cadre qui rogne la lame du reflet (`styles/foil.css`) — neutre sans reflet. */
function FoilFrame({ foil, className, children }: { foil: boolean; className: string; children: ReactNode }) {
  if (!foil) return <div className={className}>{children}</div>;
  return (
    <div className={`relative overflow-hidden rounded-lg ${className}`}>
      {children}
      <div className="foil-sheen" aria-hidden />
    </div>
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

function CardBackOffer({ back }: { back: CosmeticCardBack }) {
  const buy = useCosmeticStore(s => s.buy);
  return (
    <CosmeticOffer
      // Un dos porte son propre nom, contrairement à une variante : il ne
      // dépend d'aucune carte, c'est un objet en soi.
      illustrationId={back.id}
      title={back.name}
      subtitle="Dos de carte"
      price={back.price_gems}
      purchased={back.purchased}
      onBuy={() => { void buy('card_back', back.id, back.name); }}
    />
  );
}

function FoilOffer({ foil }: { foil: CosmeticFoil }) {
  const buy = useCosmeticStore(s => s.buy);
  return (
    <CosmeticOffer
      // L'illustration d'ORIGINE de la carte, reflet en marche : un reflet vaut
      // pour la carte, quelle que soit l'illustration choisie dans le deck.
      illustrationId={foil.card_id}
      title={foil.card_name}
      subtitle="Reflet"
      price={foil.price_gems}
      purchased={foil.purchased}
      foil
      onBuy={() => { void buy('foil', foil.id, foil.card_name); }}
    />
  );
}

// ---------------------------------------------------------------------------
//  Achat
// ---------------------------------------------------------------------------
//
// TOUT achat de la boutique passe par un `HoldConfirmButton` — emplacement,
// booster, cosmétique. Un tap de la boutique est le seul geste du jeu qui
// débite un solde, et il est définitif : il n'y a ni annulation, ni revente,
// ni conversion de doublon. Plus de popup à traverser : la charge qui remplit
// le bouton (même geste que le mulligan et le reroll de Phase Shopping) EST
// la confirmation, et le prix débité s'affiche en toast au moment où il part.

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

  return (
    // `min-w-0` : item de grille, cf. l'explication sur BoosterCard plus bas.
    <Panel className={`flex min-w-0 flex-col gap-1.5 p-2 ${
      slot.purchased ? 'border-success/40 bg-success/5' : slot.pinned ? 'border-gold/60 bg-gold/5' : ''
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
                chipClassName="border-line bg-surface-raised text-white/50"
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
              chipClassName={slot.pinned ? 'border-gold bg-gold text-black' : 'border-line bg-surface-raised text-white/50'}
            />
          </>
        )}
      </div>

      <div className="flex justify-center">
        {card
          ? <Card3D {...cardVisualProps(card)} size="h-28" tapOn="up" dim={slot.purchased ? 'soft' : 'none'} />
          : <div className="h-28 w-20 rounded-lg border border-line" />}
      </div>

      <p className="truncate text-center text-[11px] font-semibold leading-tight">{card?.name ?? slot.card_id}</p>

      {/* L'épingle ne se lit pas dans l'état du bouton : on dit ce qu'elle
          PROMET (« encore là demain »), pas qu'elle est active. */}
      {slot.pinned && !slot.purchased && (
        <p className="text-center text-[10px] leading-tight text-gold">📌 Conservée demain</p>
      )}

      {slot.purchased ? (
        <span className="py-1 text-center text-xs font-semibold text-success">✓ Acheté</span>
      ) : (
        <div className="flex flex-col gap-1">
          <HoldConfirmButton
            icon={CURRENCY.gold.icon}
            label={fmt.format(slot.price_golds)}
            actionLabel={`acheter ${card?.name ?? slot.card_id}`}
            cost={slot.price_golds}
            currency="gold"
            fullWidth
            disabled={busy || !affordableGolds}
            title={affordableGolds ? undefined : 'Pas assez de golds'}
            onConfirm={async () => setErr(await buy(slot, 'golds'))}
            className="px-1 text-[11px]"
          />
          <HoldConfirmButton
            icon={CURRENCY.gems.icon}
            label={fmt.format(slot.price_gems)}
            actionLabel={`acheter ${card?.name ?? slot.card_id}`}
            cost={slot.price_gems}
            currency="gems"
            fullWidth
            disabled={busy || !affordableGems}
            title={affordableGems ? undefined : 'Pas assez de gemmes'}
            onConfirm={async () => setErr(await buy(slot, 'gems'))}
            className="px-1 text-[11px]"
          />
        </div>
      )}
      {err && <p className="text-[10px] text-danger">{err}</p>}
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

  const missing = set.card_count - set.owned_count;
  const disabled = busy || set.complete || !set.booster_enabled;
  const openContents = usePressSquash<HTMLButtonElement>(() => setContents(true), false);

  // `card_count` est un plafond : quand il reste moins de cartes que ça dans le
  // pack, le booster rend ce qu'il reste, au plein tarif — à dire AVANT le
  // débit, l'écran de révélation arrivant trop tard.
  const short = missing < cardCount;

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
        aria-label={`Voir le contenu du pack ${set.name}`}
        className="flex w-full items-start gap-2 text-left"
        {...openContents.handlers}
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
            <HoldConfirmButton
              icon={CURRENCY.gold.icon}
              label={fmt.format(priceGolds)}
              actionLabel={`acheter le pack ${set.name}`}
              cost={priceGolds}
              currency="gold"
              fullWidth
              disabled={disabled || (user?.gold ?? 0) < priceGolds}
              onConfirm={async () => setErr(await open(set.id, 'golds'))}
              className="px-2 text-xs"
            />
            <HoldConfirmButton
              icon={CURRENCY.gems.icon}
              label={fmt.format(priceGems)}
              actionLabel={`acheter le pack ${set.name}`}
              cost={priceGems}
              currency="gems"
              fullWidth
              disabled={disabled || (user?.gems ?? 0) < priceGems}
              onConfirm={async () => setErr(await open(set.id, 'gems'))}
              className="px-2 text-xs"
            />
          </div>
          {/* La valeur d'un booster CROÎT à mesure que le set se vide : c'est la
              propriété la plus vertueuse du système, elle doit se voir — et
              `short` le dit explicitement, maintenant que la confirmation
              d'achat qui le disait AVANT le débit n'existe plus. */}
          <p className="text-[10px] text-white/30">
            {short
              ? `${missing} carte${missing > 1 ? 's' : ''} restante${missing > 1 ? 's' : ''} — le booster n'en rendra pas ${cardCount}`
              : `${missing} carte${missing > 1 ? 's' : ''} restante${missing > 1 ? 's' : ''}`}
            {set.completion_reward?.gems ? ` · set complet : +${set.completion_reward.gems} ${CURRENCY.gems.icon}` : ''}
          </p>
        </>
      )}
      {err && <p className="text-[10px] text-danger">{err}</p>}
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
            ? <Card3D key={card_id} {...cardVisualProps(card)} size="h-32" tapOn="up" />
            : <span key={card_id} className="text-xs text-white/40">{card_id}</span>;
        })}
      </div>
      {booster.pin_cleared && (
        <p className="mt-3 text-center text-[11px] text-gold">📌 Ta carte épinglée est tombée — l'épingle est libérée.</p>
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
