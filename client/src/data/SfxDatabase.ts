// Catalogue des EFFETS SONORES — `data/sfx.json`, édité depuis le panneau
// d'administration (onglet 🔊 Sons). Même patron que `CardBackDatabase` :
// `init()` qui ne JETTE JAMAIS (un son est un habillage, pas une donnée de
// jeu — un serveur en retard de déploiement ne doit pas empêcher de jouer),
// puis un cache mémoire.
//
// Le vocabulaire des déclencheurs vit dans `sound-schema.mjs` (racine) ;
// cette database ne fait que RÉSOUDRE, pour un déclencheur donné, quel
// fichier jouer.
export interface SfxEntry {
  id: string;
  name?: string;
  trigger: string;
  /** Variante par tier (déclencheur `summon`), facultative. */
  tier?: number;
  /** Variante par élément (déclencheur `attack`), id d'attribut, facultative. */
  element?: string;
  _has_audio?: boolean;
}

let list: SfxEntry[] | null = null;

export async function init(): Promise<SfxEntry[]> {
  if (list) return list;
  try {
    const res = await fetch('/api/sfx');
    list = res.ok ? await res.json() : [];
  } catch {
    list = [];
  }
  return list ?? [];
}

export function getAllSfx(): SfxEntry[] {
  return list ?? [];
}

export function sfxUrl(id: string): string {
  return `/audio/${encodeURIComponent(id)}`;
}

export interface SfxVariant {
  tier?: number;
  element?: string;
}

/**
 * Le meilleur candidat pour ce déclencheur : la variante EXACTE d'abord (le
 * tier ou l'élément demandé), le REPLI générique du déclencheur ensuite (une
 * entrée sans variante posée) — jamais un candidat d'une autre variante, qui
 * annoncerait le mauvais tier ou le mauvais élément.
 *
 * ⚠️ Sans fichier audio (`_has_audio` faux), l'entrée n'est pas un candidat :
 * un déclencheur catalogué mais sans son reste silencieux, pas cassé.
 */
export function resolveSfx(trigger: string, variant?: SfxVariant): SfxEntry | null {
  const candidates = (list ?? []).filter(s => s.trigger === trigger && s._has_audio);
  if (!candidates.length) return null;
  if (variant?.tier != null) {
    const exact = candidates.find(s => s.tier === variant.tier);
    if (exact) return exact;
  }
  if (variant?.element) {
    const exact = candidates.find(s => s.element === variant.element);
    if (exact) return exact;
  }
  return candidates.find(s => s.tier == null && s.element == null) ?? candidates[0];
}
