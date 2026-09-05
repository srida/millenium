/* eslint-disable @typescript-eslint/no-explicit-any */
/// <reference types="node" />
// Les types Node sont référencés ICI et pas dans `types` du tsconfig : le client
// est du code navigateur, seuls ces tests (qui chargent un module serveur) en ont
// besoin.
//
// L'ORDRE D'OBTENTION de la collection (progression.unlockedCardIdsByDate), le
// tri « par ordre d'obtention » du DeckBuilder. La colonne `unlocked_at`
// existait depuis toujours et n'était lue par personne : ce fichier est le seul
// endroit qui prouve qu'elle l'est désormais, et qu'elle l'est SANS déranger
// l'ensemble que cinq modules de règles lisent par `unlockedCardIds`.
//
// Même harnais que levels.test.ts / gifts.test.ts : le module est chargé via
// createRequire avec un DATA_DIR temporaire, il ouvre sa propre base SQLite et
// ne touche jamais data/soulforge.db.
//
// ⚠️ ILLUS_DIR est un ENFANT d'une racine à nous : asset-dirs.js déduit les
// trois autres familles de son dossier parent (cf. l'en-tête de shop.test.ts).
import { describe, it, expect, beforeAll } from 'vitest';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import crypto from 'node:crypto';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

let progression: any;
let stmt: any;
let TMP: string;

// Deux cartes hors dotation, choisies aux DEUX BOUTS de l'ordre alphabétique :
// c'est ce qui rend le test discriminant, la plus « petite » étant obtenue en
// DERNIER.
let EARLY_ID: string; // premier alphabétiquement
let LATE_ID: string;  // dernier alphabétiquement

let _tagSeq = 0;

/** Compte neuf, doté comme à l'inscription. */
function newUser({ isAdmin = false } = {}) {
  const id = crypto.randomUUID();
  stmt.insertUser.run({
    id, email: `${id}@test.local`, username: 'T', username_lc: 't',
    tag: String(++_tagSeq).padStart(4, '0'), password_hash: 'x', avatar: null, created_at: Date.now(),
  });
  if (isAdmin) stmt.setUserAdmin.run(1, id);
  progression.initUser(id, { isAdmin });
  return id;
}

beforeAll(() => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'millenium-collorder-'));
  TMP = path.join(root, 'data');
  fs.mkdirSync(TMP);
  fs.mkdirSync(path.join(root, 'card_illustrations'));
  // Catalogues lus depuis `initial-data/` — versionné, donc toujours présent,
  // là où `data/` n'est créé qu'au premier démarrage du serveur. `sets.json`
  // porte le vrai pack de départ : c'est la dotation qui ouvre la séquence.
  for (const f of ['cards.json', 'sets.json']) {
    fs.copyFileSync(path.join(ROOT, 'initial-data', f), path.join(TMP, f));
  }
  process.env.DATA_DIR = TMP;
  process.env.ILLUS_DIR = path.join(root, 'card_illustrations');

  ({ stmt } = require(path.join(ROOT, 'db.js')));
  progression = require(path.join(ROOT, 'progression.js'));

  const starters = new Set(progression.starterCardIds());
  const rest = progression.allCardIds().filter((id: string) => !starters.has(id)).sort();
  EARLY_ID = rest[0];
  LATE_ID = rest[rest.length - 1];
  expect(EARLY_ID < LATE_ID).toBe(true);
});

describe('ordre d\'obtention', () => {
  it('la dotation de départ ouvre la séquence, les cartes obtenues ensuite la suivent', () => {
    const id = newUser();
    const starters = progression.starterCardIds();

    // Horodatages POSÉS, pas mesurés : deux `unlockCard` consécutifs tombent
    // dans la même milliseconde, et le test ne prouverait plus rien.
    stmt.unlockCard.run(id, LATE_ID, Date.now() + 1000);
    stmt.unlockCard.run(id, EARLY_ID, Date.now() + 2000);

    const ordered = progression.unlockedCardIdsByDate(stmt.userById.get(id));
    expect(ordered.length).toBe(starters.length + 2);
    // ⚠️ Le cœur du test : LATE_ID est le DERNIER alphabétiquement et vient
    // pourtant AVANT EARLY_ID, qui est le premier. Un `ORDER BY card_id` — ce
    // que faisait la seule lecture existante — inverse cette paire.
    expect(ordered.slice(-2)).toEqual([LATE_ID, EARLY_ID]);
  });

  it('à horodatage égal, l\'ordre est stable — la dotation sort par card_id', () => {
    // Un booster pose ses cinq cartes dans la même milliseconde : sans le
    // départage, la grille sautillerait d'un chargement à l'autre.
    const id = newUser();
    const starters = progression.starterCardIds();
    const head = progression.unlockedCardIdsByDate(stmt.userById.get(id));
    expect(head).toEqual([...starters].sort());
  });

  it('`unlockedCardIds` garde son ordre alphabétique — les deux ne répondent pas à la même question', () => {
    const id = newUser();
    stmt.unlockCard.run(id, LATE_ID, Date.now() + 1000);
    stmt.unlockCard.run(id, EARLY_ID, Date.now() + 2000);
    const user = stmt.userById.get(id);

    const set = progression.unlockedCardIds(user);
    expect(set).toEqual([...set].sort());
    // Même contenu, deux séquences : c'est la preuve qu'ajouter la lecture
    // datée n'a rien changé sous les cinq modules qui lisent l'ensemble.
    expect([...set].sort()).toEqual([...progression.unlockedCardIdsByDate(user)].sort());
  });

  it('un admin retombe sur l\'ordre du catalogue — il n\'a pas d\'historique', () => {
    // Sa collection est CALCULÉE (cf. unlockedCardIds), pas lue en base :
    // dégradation honnête, l'écran trie ce qu'il reçoit sans inventer de date.
    const id = newUser({ isAdmin: true });
    expect(progression.unlockedCardIdsByDate(stmt.userById.get(id)))
      .toEqual(progression.allCardIds());
  });

  it('un invité n\'a rien à trier', () => {
    expect(progression.unlockedCardIdsByDate(null)).toEqual([]);
  });
});
