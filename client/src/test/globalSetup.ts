/// <reference types="node" />
// Bootstrap du dossier `data/` avant la suite de tests.
//
// `data/` est gitignoré : il n'existe qu'une fois le serveur démarré, qui y
// recopie `initial-data/` (cf. `bootstrap()` dans server.js). Or six fichiers de
// tests serveur (shop, packs, missions, cosmetics, gifts, bots) copient leurs
// catalogues depuis `data/` vers un DATA_DIR temporaire — sur un clone neuf,
// ils échouaient tous en ENOENT avant d'avoir rien prouvé.
//
// On refait donc ici le seul geste du bootstrap qui les concerne : créer le
// dossier et y déposer ce qui manque. Un fichier déjà présent n'est JAMAIS
// écrasé — la copie locale d'un catalogue de prod fait foi, c'est elle que les
// tests doivent confronter (cf. l'en-tête de bots.test.ts).
//
// ⚠️ La liste est celle de `bootstrap()`, recopiée à dessein plutôt que dérivée
// du contenu d'`initial-data/` : `bot_decks.json` y vit aussi, et lui ne doit
// JAMAIS atterrir sur le volume — c'est du code, lu à son emplacement réel.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const DATA = path.join(ROOT, 'data');
const INITIAL = path.join(ROOT, 'initial-data');

export default function setup() {
  if (!fs.existsSync(INITIAL)) return;
  fs.mkdirSync(DATA, { recursive: true });
  const FILES = [
    'cards.json', 'attributes.json', 'powers.json', 'boards.json', 'magies.json',
    'public_decks.json', 'missions.json', 'sets.json', 'variants.json', 'gifts.json',
  ];
  for (const f of FILES) {
    const src = path.join(INITIAL, f);
    const dest = path.join(DATA, f);
    if (!fs.existsSync(dest) && fs.existsSync(src)) fs.copyFileSync(src, dest);
  }
}
