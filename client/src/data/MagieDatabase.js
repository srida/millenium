let _magies = null;

export async function init() {
  if (_magies !== null) return;
  _magies = await fetch('/api/magies').then(r => r.json()).catch(() => []);
  if (!Array.isArray(_magies)) _magies = [];
}

export function getAllMagies() {
  return _magies || [];
}

// ⚠️ `getRandomMagies` a été SUPPRIMÉE : le tirage de la Phase Shopping vit
// désormais dans `logic/MagieOffer.pickMagies` — filtré par pertinence,
// pondéré par rareté, et semé par le `rand` de la partie. La laisser aurait
// maintenu un second chemin de tirage, ni filtré ni semé, portant très
// exactement le nom que la prochaine fonctionnalité aurait repris.
