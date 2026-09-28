// L'icône d'un TIER (1 à 5) — un tier est un attribut comme un autre
// (`categorie: 'Tiers'`, cf. `logic/Tiers.ts`), donc son icône suit
// exactement le même trajet que celle de n'importe quel attribut : une image
// posée en admin, l'emoji du catalogue en repli (`AttrIcon`). Ce composant ne
// fait que la traduction « quel tier » → « quel id d'attribut », pour les
// endroits qui ne connaissent qu'un chiffre (chips de filtre, tooltip).
import { tierAttributeId } from '../../data/AttributeDatabase.js';
import AttrIcon from './AttrIcon.js';

export default function TierIcon({ tier, className = '' }: { tier: number; className?: string }) {
  const id = tierAttributeId(tier);
  // Faute de database (bancs de dev) ou de tier introuvable au catalogue : le
  // chiffre nu, comme AttrIcon le ferait lui-même sans `_has_illustration`.
  if (!id) return <span className={className}>{tier}</span>;
  return <AttrIcon id={id} fallback={String(tier)} className={className} />;
}
