// Progression du tutoriel — chapitres lus, étapes pratiques faites, invitation
// congédiée. Persistée en localStorage, comme les pastilles « pas encore vu »
// des Missions et de la Boutique.
//
// ⚠️ La clé ne porte PAS d'`user.id`, contrairement à `hasUnseenShop` /
// `hasUnseenMissions` : le public du tutoriel est justement celui qui n'a pas
// encore de compte. Un invité doit pouvoir lire le codex, jouer la partie
// d'entraînement et retrouver ses ✓ au rechargement.
const KEY = 'millenium_tutorial_v1';

export interface TutorialProgress {
  /** Ids des chapitres déjà ouverts. */
  chapters: string[];
  /** Partie d'entraînement menée jusqu'au bout. */
  game: boolean;
  /** Premier deck enregistré depuis le tutoriel. */
  deck: boolean;
  /** L'invitation du premier lancement a été vue (acceptée ou remise à plus tard). */
  dismissed: boolean;
}

const EMPTY: TutorialProgress = { chapters: [], game: false, deck: false, dismissed: false };

/** `null` = aucune trace : le joueur n'a jamais rencontré le tutoriel. */
export function readProgress(): TutorialProgress | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<TutorialProgress>;
    return {
      chapters: Array.isArray(parsed.chapters) ? parsed.chapters.filter(c => typeof c === 'string') : [],
      game: parsed.game === true,
      deck: parsed.deck === true,
      dismissed: parsed.dismissed === true,
    };
  } catch {
    // localStorage indisponible (mode privé Safari) ou JSON corrompu : le
    // tutoriel reste jouable, il ne se souvient simplement de rien.
    return null;
  }
}

/** Lecture confortable : l'absence de trace vaut « rien de fait ». */
export function getProgress(): TutorialProgress {
  return readProgress() ?? { ...EMPTY };
}

function write(next: TutorialProgress): void {
  try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* rien à faire */ }
}

/** Applique une mise à jour partielle. Crée la trace si elle n'existait pas. */
export function updateProgress(patch: Partial<TutorialProgress>): TutorialProgress {
  const next = { ...getProgress(), ...patch };
  write(next);
  return next;
}

export function markChapterRead(id: string): TutorialProgress {
  const current = getProgress();
  if (current.chapters.includes(id)) return current;
  return updateProgress({ chapters: [...current.chapters, id] });
}

/** Aucune trace du tout → c'est le tout premier lancement, on peut inviter. */
export function shouldInvite(): boolean {
  return readProgress() === null;
}
