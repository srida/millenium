// IllustrationPicker — choix de l'illustration d'une carte du deck, parmi
// l'originale et les variantes que le joueur possède pour cette carte.
//
// Le choix est mémorisé PAR DECK (méta de deck, à côté de la couleur et des
// tags) : deux decks peuvent afficher deux illustrations de la même carte.
//
// Les vignettes n'affichent ni tier ni tooltip : on choisit une image, pas une
// carte. L'appui long est donc inerte ici, et le seul geste est le tap.
//
// Le REFLET, le HOLO et les ÉCLATS se règlent ici aussi, par des interrupteurs
// sous les illustrations ; l'ENCRE et le CADRE par une rangée de pastilles
// (un seul de chaque, ou aucun). Ils valent pour la carte quelle que soit
// l'image retenue, se cumulent, et se mémorisent par deck. Chaque contrôle
// n'apparaît que si le joueur possède le cosmétique.
import type { Card } from '../../logic/types.js';
import type { CardFinish, FrameStyle, InkStyle } from '../../data/CardArt.js';
import { hasAnyFinish, visibleFinish, type OwnedFinishes } from '../../data/DeckFinish.js';
import type { OwnedVariant } from '../../stores/cosmeticStore.js';
import { Modal } from '../ui/primitives.js';
import { tiersOf } from '../../logic/Tiers.js';
import Card3D from '../ui/Card3D.js';
import UiIcon from '../ui/UiIcon.js';
import * as Audio from '../../audio/AudioManager.js';

export default function IllustrationPicker({
  card, current, options, onPick, onClose,
  owned, foil = false, onToggleFoil, finish, onFinish,
}: {
  card: Card;
  /** Id d'illustration en vigueur — `card.id` quand c'est l'originale. */
  current: string;
  options: OwnedVariant[];
  /** Appelé avec `card.id` pour revenir à l'illustration d'origine. */
  onPick: (illustrationId: string) => void;
  onClose: () => void;
  /** Ce que le joueur possède pour cette carte : sans cosmétique, pas de contrôle. */
  owned: OwnedFinishes;
  /** Reflet allumé pour cette carte dans ce deck. */
  foil?: boolean;
  onToggleFoil?: () => void;
  /** Holo, éclats, encre, cadre choisis pour cette carte dans ce deck. */
  finish: CardFinish;
  onFinish: (patch: Partial<CardFinish>) => void;
}) {
  const choose = (id: string) => { onPick(id); onClose(); };
  const hasEffects = owned.foil || hasAnyFinish(owned);
  // L'aperçu ne montre que ce qui est possédé ET allumé.
  const fin = visibleFinish(finish, owned);
  const tap = (fn: () => void) => () => { Audio.playSfx('menu_button'); fn(); };

  return (
    <Modal onClose={onClose}>
      <div className="flex flex-col gap-3">
        <div>
          <h2 className="text-sm font-bold">{options.length ? 'Illustration' : 'Effets'} — {card.name}</h2>
          <p className="text-[10px] text-white/40">
            Ce choix ne vaut que pour ce deck. En duel, ton adversaire le voit aussi.
          </p>
        </div>

        {options.length > 0 && (
        <div className="grid grid-cols-3 gap-2">
          <Choice
            illustrationId={card.id}
            tiers={tiersOf(card)}
            label="Origine"
            selected={current === card.id}
            foil={foil}
            finish={fin}
            onTap={() => choose(card.id)}
          />
          {/* Toutes les options habillent la MÊME carte : un libellé nominal
              n'y apprendrait rien. C'est l'image qui distingue, le numéro ne
              sert qu'à pouvoir en parler (et à l'accessibilité). */}
          {options.map((v, i) => (
            <Choice
              key={v.id}
              illustrationId={v.id}
              tiers={tiersOf(card)}
              label={`Variante ${i + 1}`}
              selected={current === v.id}
              foil={foil}
              finish={fin}
              onTap={() => choose(v.id)}
            />
          ))}
        </div>
        )}

        {/* Sans variante, l'aperçu de la carte seule : c'est lui que les
            contrôles allument, il faut le voir changer. */}
        {hasEffects && options.length === 0 && (
          <div className="mx-auto w-28">
            <Card3D illustrationId={current} name={card.name} tiers={tiersOf(card)} showName={false} size="h-auto w-full" foil={foil} finish={fin} />
          </div>
        )}

        {owned.foil && <Switch icon label="Reflet" on={foil} onTap={tap(() => onToggleFoil?.())} />}
        {owned.holo && <Switch label="Holo prismatique" on={!!finish.holo} onTap={tap(() => onFinish({ holo: !finish.holo }))} />}
        {owned.sparkle && <Switch label="Éclats" on={!!finish.sparkle} onTap={tap(() => onFinish({ sparkle: !finish.sparkle }))} />}
        {owned.inks.length > 0 && (
          <Pills<InkStyle>
            label="Encre" none="Aucune" value={finish.ink}
            options={owned.inks.map(v => [v, INK_LABEL[v]])}
            onPick={(v) => tap(() => onFinish({ ink: v }))()}
          />
        )}
        {owned.frames.length > 0 && (
          <Pills<FrameStyle>
            label="Cadre" none="Aucun" value={finish.frame}
            options={owned.frames.map(v => [v, FRAME_LABEL[v]])}
            onPick={(v) => tap(() => onFinish({ frame: v }))()}
          />
        )}
      </div>
    </Modal>
  );
}

function Choice({
  illustrationId, label, selected, onTap, foil = false, finish, tiers,
}: { illustrationId: string; label: string; selected: boolean; onTap: () => void; foil?: boolean; finish: CardFinish; tiers: readonly number[] }) {
  return (
    <div className="flex flex-col gap-1">
      <Card3D
        illustrationId={illustrationId}
        name={label}
        tiers={tiers}
        showName={false}
        size="h-auto w-full"
        tapOn="up"
        highlight={selected ? 'selected' : 'none'}
        foil={foil && selected}
        finish={selected ? finish : undefined}
        onTap={onTap}
      />
      <div className={`flex items-center justify-center gap-0.5 truncate text-center text-[10px] ${selected ? 'text-gold' : 'text-white/50'}`}>
        {selected && <UiIcon id="UI_CHECK" className="h-2.5 w-2.5 flex-shrink-0" />}{label}
      </div>
    </div>
  );
}

const INK_LABEL: Record<InkStyle, string> = { tier: 'Tier', sepia: 'Sépia', nb: 'N&B' };
const FRAME_LABEL: Record<FrameStyle, string> = { courant: 'Courant', gravure: 'Gravure', facettes: 'Facettes' };

function Switch({ label, on, onTap, icon = false }: { label: string; on: boolean; onTap: () => void; icon?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onPointerDown={onTap}
      className={`min-h-tap flex items-center justify-between rounded-lg border px-3 text-sm font-semibold ${on ? 'border-gold text-gold' : 'border-line text-white/60'}`}
    >
      <span className="flex items-center gap-1.5">{icon && <UiIcon id="UI_XP" className="h-4 w-4" />} {label}</span>
      <span className="text-xs">{on ? 'Activé' : 'Désactivé'}</span>
    </button>
  );
}

// Une rangée de pastilles à choix unique : « Aucune » plus les styles POSSÉDÉS.
function Pills<T extends string>({ label, none, value, options, onPick }: {
  label: string; none: string; value: T | undefined; options: [T, string][]; onPick: (v: T | undefined) => void;
}) {
  const pill = (active: boolean) =>
    `h-[34px] rounded-full border px-3 text-[11px] font-semibold ${active
      ? 'border-[#d4af61] bg-[color-mix(in_srgb,#d4af61_20%,#1a1d27)] text-[#d4af61]'
      : 'border-[#2a2e3d] bg-[#1a1d27] text-white/60'}`;
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[10px] tracking-widest text-white/40">{label.toUpperCase()}</span>
      <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label={label}>
        <button type="button" role="radio" aria-checked={!value} className={pill(!value)} onPointerDown={() => onPick(undefined)}>{none}</button>
        {options.map(([v, text]) => (
          <button key={v} type="button" role="radio" aria-checked={value === v} className={pill(value === v)} onPointerDown={() => onPick(v)}>{text}</button>
        ))}
      </div>
    </div>
  );
}
