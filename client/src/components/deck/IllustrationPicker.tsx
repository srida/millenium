// IllustrationPicker — choix de l'illustration d'une carte du deck, parmi
// l'originale et les variantes que le joueur possède pour cette carte.
//
// Le choix est mémorisé PAR DECK (méta de deck, à côté de la couleur et des
// tags) : deux decks peuvent afficher deux illustrations de la même carte.
//
// Les vignettes n'affichent ni tier ni tooltip : on choisit une image, pas une
// carte. L'appui long est donc inerte ici, et le seul geste est le tap.
import type { Card } from '../../logic/types.js';
import type { OwnedVariant } from '../../stores/cosmeticStore.js';
import { Modal } from '../ui/primitives.js';
import CardTile from '../ui/CardTile.js';

export default function IllustrationPicker({
  card, current, options, onPick, onClose,
}: {
  card: Card;
  /** Id d'illustration en vigueur — `card.id` quand c'est l'originale. */
  current: string;
  options: OwnedVariant[];
  /** Appelé avec `card.id` pour revenir à l'illustration d'origine. */
  onPick: (illustrationId: string) => void;
  onClose: () => void;
}) {
  const choose = (id: string) => { onPick(id); onClose(); };

  return (
    <Modal onClose={onClose}>
      <div className="flex flex-col gap-3">
        <div>
          <h2 className="text-sm font-bold">Illustration — {card.name}</h2>
          <p className="text-[10px] text-white/40">
            Ce choix ne vaut que pour ce deck. En duel, ton adversaire la voit aussi.
          </p>
        </div>

        <div className="grid grid-cols-3 gap-2">
          <Choice
            illustrationId={card.id}
            label="Origine"
            selected={current === card.id}
            onTap={() => choose(card.id)}
          />
          {options.map(v => (
            <Choice
              key={v.id}
              illustrationId={v.id}
              label={v.name}
              selected={current === v.id}
              onTap={() => choose(v.id)}
            />
          ))}
        </div>
      </div>
    </Modal>
  );
}

function Choice({
  illustrationId, label, selected, onTap,
}: { illustrationId: string; label: string; selected: boolean; onTap: () => void }) {
  return (
    <div className="flex flex-col gap-1">
      <CardTile
        illustrationId={illustrationId}
        name={label}
        tier={null}
        showName={false}
        size="h-auto w-full"
        tapOn="up"
        highlight={selected ? 'selected' : 'none'}
        onTap={onTap}
      />
      <div className={`truncate text-center text-[10px] ${selected ? 'text-gold' : 'text-white/50'}`}>
        {selected ? '✓ ' : ''}{label}
      </div>
    </div>
  );
}
