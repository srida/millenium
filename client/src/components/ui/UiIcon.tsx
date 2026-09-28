// L'icône d'un élément d'INTERFACE (dock, boutons, badges, en-têtes) — la
// famille « Interface » du set complet dessiné avec Claude Design, distincte
// des icônes d'attribut/pouvoir (celles-là passent par `AttrIcon`/`PowerIcon`
// et l'upload admin, cf. CLAUDE.md « L'icône d'un attribut est une image »).
//
// Ces 50 glyphes ne sont pas data-driven : ils ne décorent aucune fiche du
// catalogue, ils SONT le chrome de l'appli. D'où un asset statique du bundle
// client (`public/icons/ui/`), sans détour par l'admin ni par le serveur.
const BASE = '/icons/ui/';

export type UiIconId =
  | 'UI_MISSIONS' | 'UI_SHOP' | 'UI_GIFTS' | 'UI_CATALOG' | 'UI_GOLD' | 'UI_GEMS'
  | 'UI_XP' | 'UI_OWNED' | 'UI_SOUND' | 'UI_MUSIC' | 'UI_TERRAIN' | 'UI_UNDO'
  | 'UI_MENU' | 'UI_MULLIGAN' | 'UI_REROLL' | 'UI_LOCK' | 'UI_TUTORIAL' | 'UI_TOURNAMENT'
  | 'UI_TRAINING' | 'UI_ARCADE' | 'UI_VICTORY' | 'UI_DEFEAT' | 'UI_DRAW' | 'UI_LINKED'
  | 'UI_VETERAN' | 'UI_PIN' | 'UI_MEDAL' | 'UI_LEVEL_UP' | 'UI_EDIT' | 'UI_DUPLICATE'
  | 'UI_RENAME' | 'UI_DELETE' | 'UI_MIRROR' | 'UI_DUEL' | 'UI_PAINT' | 'UI_AVATAR'
  | 'UI_CARD' | 'UI_GAMEPAD' | 'UI_FOLDER' | 'UI_WARNING' | 'UI_CELEBRATE' | 'UI_HAND'
  | 'UI_STATS' | 'UI_LINK' | 'UI_LANDSCAPE' | 'UI_LOCATION' | 'UI_RECIPES' | 'UI_FORBIDDEN'
  | 'UI_SORT' | 'UI_CLOSE';

/** Un id de la famille Interface commence toujours par `UI_` — ce qui permet
 *  à un appelant qui reçoit un champ « soit un id, soit un emoji brut » (un
 *  chapitre du codex, un token inline dans une prose) de trancher sans table
 *  à tenir à jour. */
export function isUiIconId(v: string): v is UiIconId {
  return v.startsWith('UI_');
}

export default function UiIcon({ id, className = '', alt = '' }: {
  id: UiIconId;
  /** Porte la taille (largeur/hauteur) — même convention que AttrIcon/PowerIcon. */
  className?: string;
  /** Vide par défaut : l'icône est décorative, le libellé voisin porte déjà le sens. */
  alt?: string;
}) {
  return (
    <img
      src={`${BASE}${id}.svg`}
      alt={alt}
      draggable={false}
      className={`inline-block flex-shrink-0 object-contain ${className}`}
    />
  );
}
