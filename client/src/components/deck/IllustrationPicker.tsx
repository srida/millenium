// IllustrationPicker — choix de l'illustration d'une carte du deck, parmi
// l'originale et les variantes que le joueur possède pour cette carte.
//
// Le choix est mémorisé PAR DECK (méta de deck, à côté de la couleur et des
// tags) : deux decks peuvent afficher deux illustrations de la même carte.
//
// Les vignettes n'affichent ni tier ni tooltip : on choisit une image, pas une
// carte. L'appui long est donc inerte ici, et le seul geste est le tap.
//
// Le REFLET se règle ici aussi, par un interrupteur sous les illustrations : il
// vaut pour la carte, quelle que soit l'image retenue, et se mémorise lui aussi
// par deck. Il n'apparaît que si le joueur possède le reflet de cette carte.
import type { Card } from '../../logic/types.js';
import type { OwnedVariant } from '../../stores/cosmeticStore.js';
import { Modal } from '../ui/primitives.js';
import Card3D from '../ui/Card3D.js';

export default function IllustrationPicker({
  card, current, options, onPick, onClose,
  foilOwned = false, foil = false, onToggleFoil,
}: {
  card: Card;
  /** Id d'illustration en vigueur — `card.id` quand c'est l'originale. */
  current: string;
  options: OwnedVariant[];
  /** Appelé avec `card.id` pour revenir à l'illustration d'origine. */
  onPick: (illustrationId: string) => void;
  onClose: () => void;
  /** Le joueur possède-t-il le reflet de cette carte ? Sinon, pas d'interrupteur. */
  foilOwned?: boolean;
  /** Reflet allumé pour cette carte dans ce deck. */
  foil?: boolean;
  onToggleFoil?: () => void;
}) {
  const choose = (id: string) => { onPick(id); onClose(); };

  return (
    <Modal onClose={onClose}>
      <div className="flex flex-col gap-3">
        <div>
          <h2 className="text-sm font-bold">{options.length ? 'Illustration' : 'Reflet'} — {card.name}</h2>
          <p className="text-[10px] text-white/40">
            Ce choix ne vaut que pour ce deck. En duel, ton adversaire le voit aussi.
          </p>
        </div>

        {options.length > 0 && (
        <div className="grid grid-cols-3 gap-2">
          <Choice
            illustrationId={card.id}
            label="Origine"
            selected={current === card.id}
            foil={foil}
            onTap={() => choose(card.id)}
          />
          {/* Toutes les options habillent la MÊME carte : un libellé nominal
              n'y apprendrait rien. C'est l'image qui distingue, le numéro ne
              sert qu'à pouvoir en parler (et à l'accessibilité). */}
          {options.map((v, i) => (
            <Choice
              key={v.id}
              illustrationId={v.id}
              label={`Variante ${i + 1}`}
              selected={current === v.id}
              foil={foil}
              onTap={() => choose(v.id)}
            />
          ))}
        </div>
        )}

        {/* Sans variante, l'aperçu de la carte seule : c'est lui que
            l'interrupteur allume, il faut le voir changer. */}
        {foilOwned && options.length === 0 && (
          <div className="mx-auto w-28">
            <Card3D illustrationId={current} name={card.name} tiers={null} showName={false} size="h-auto w-full" foil={foil} />
          </div>
        )}

        {foilOwned && (
          <button
            type="button"
            role="switch"
            aria-checked={foil}
            onPointerDown={onToggleFoil}
            className={`min-h-tap flex items-center justify-between rounded-lg border px-3 text-sm font-semibold ${foil ? 'border-gold text-gold' : 'border-line text-white/60'}`}
          >
            <span>✨ Reflet</span>
            <span className="text-xs">{foil ? 'Activé' : 'Désactivé'}</span>
          </button>
        )}
      </div>
    </Modal>
  );
}

function Choice({
  illustrationId, label, selected, onTap, foil = false,
}: { illustrationId: string; label: string; selected: boolean; onTap: () => void; foil?: boolean }) {
  return (
    <div className="flex flex-col gap-1">
      <Card3D
        illustrationId={illustrationId}
        name={label}
        tiers={null}
        showName={false}
        size="h-auto w-full"
        tapOn="up"
        highlight={selected ? 'selected' : 'none'}
        foil={foil && selected}
        onTap={onTap}
      />
      <div className={`truncate text-center text-[10px] ${selected ? 'text-gold' : 'text-white/50'}`}>
        {selected ? '✓ ' : ''}{label}
      </div>
    </div>
  );
}
