/// <reference types="node" />
// Golden tests de `data/DeckTags` — les deux attributs dominants d'un deck plus
// un mot sur son profil de combat, affichés sur chaque carte de deck public.
//
// La suite tourne en node pur, sans jsdom : aucun composant n'est testable.
// `computeDeckTags` est justement pur — c'est ce qui permet de l'éprouver ici
// plutôt qu'à l'écran.
//
// Ce qui est verrouillé, et pourquoi :
//   • le DÉTERMINISME. Le tri des attributs dominants se faisait sur le seul
//     effectif : à égalité, l'ordre de parcours des cartes tranchait, donc deux
//     decks de même composition mais d'ordre différent affichaient des tags
//     différents. Un deck public se réordonne en admin — il aurait changé de
//     tags sans changer de contenu.
//   • le PLAFOND de 3 tags : au-delà, la carte de deck ne se lit plus d'un
//     coup d'œil et les tags cessent de distinguer quoi que ce soit.
//
// Les attributs sont lus depuis `initial-data/attributes.json`, versionné et
// toujours présent (`data/` n'est créé qu'au démarrage du serveur).
import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as AttributeDatabase from '../data/AttributeDatabase.js';
import { computeDeckTags } from '../data/DeckTags.js';
import type { Card } from '../logic/types.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const ATTRIBUTES = JSON.parse(
  fs.readFileSync(path.join(ROOT, 'initial-data', 'attributes.json'), 'utf8')
) as { id: string; name: string }[];

// `AttributeDatabase.init()` passe par `fetch` : on le sert depuis le catalogue
// versionné plutôt que de court-circuiter le module — c'est bien lui que
// `computeDeckTags` interroge en production.
beforeAll(async () => {
  (globalThis as unknown as { fetch: unknown }).fetch = async () => ({
    ok: true, status: 200, json: async () => ATTRIBUTES
  });
  await (AttributeDatabase as unknown as { init: () => Promise<unknown> }).init();
});

const nameOf = (id: string) => ATTRIBUTES.find(a => a.id === id)!.name;

/** Carte minimale : seuls `attributes` et `stats` pèsent sur les tags. */
const card = (attributes: string[], atk = 10, range = 1): Card => ({
  id: `C${Math.random()}`, name: 'X', tier: 1, summon_conditions: [], attributes,
  stats: { atk, hp: 100, movement_speed: 1, attack_speed: 1, initiative: 1, range }
} as unknown as Card);

const deckOf = (...cards: Card[]) => cards;

// ── Attributs dominants ─────────────────────────────────────────────────────

describe('attributs dominants', () => {
  const A = ATTRIBUTES[0].id;
  const B = ATTRIBUTES[1].id;
  const C = ATTRIBUTES[2].id;

  it('retient les deux attributs les plus portés, dans l\'ordre décroissant', () => {
    const tags = computeDeckTags(deckOf(
      card([A]), card([A]), card([A]),
      card([B]), card([B]),
      card([C]),   // 1 seule occurrence → sous le seuil
    ));
    expect(tags.slice(0, 2)).toEqual([nameOf(A), nameOf(B)]);
  });

  it('ignore un attribut porté par une seule carte', () => {
    const tags = computeDeckTags(deckOf(card([A]), card([B]), card([B])));
    expect(tags).toContain(nameOf(B));
    expect(tags).not.toContain(nameOf(A));
  });

  it('ne retient jamais plus de deux attributs', () => {
    const tags = computeDeckTags(deckOf(
      card([A]), card([A]), card([B]), card([B]), card([C]), card([C])
    ));
    const attrTags = tags.filter(t => [nameOf(A), nameOf(B), nameOf(C)].includes(t));
    expect(attrTags).toHaveLength(2);
  });

  it('compte une carte dans chacun de ses attributs', () => {
    const tags = computeDeckTags(deckOf(card([A, B]), card([A, B])));
    expect(tags).toContain(nameOf(A));
    expect(tags).toContain(nameOf(B));
  });
});

// ── Déterminisme : le cœur du correctif ─────────────────────────────────────

describe('déterminisme', () => {
  const A = ATTRIBUTES[0].id;
  const B = ATTRIBUTES[1].id;

  it('rend le MÊME résultat quel que soit l\'ordre des cartes', () => {
    // A et B sont à égalité parfaite (2 chacun) : sans départage absolu, c'est
    // l'ordre d'insertion qui décide, et les deux lectures divergent.
    const deck = deckOf(card([A]), card([A]), card([B]), card([B]));
    const reversed = [...deck].reverse();
    expect(computeDeckTags(reversed)).toEqual(computeDeckTags(deck));
  });

  it('départage les ex æquo par id d\'attribut, pas par ordre de rencontre', () => {
    const [lo, hi] = [ATTRIBUTES[0].id, ATTRIBUTES[1].id].sort((a, b) => a.localeCompare(b));
    // Le deck présente `hi` en premier ; c'est `lo` qui doit malgré tout sortir
    // en tête, parce que le départage est une valeur absolue.
    const tags = computeDeckTags(deckOf(card([hi]), card([hi]), card([lo]), card([lo])));
    expect(tags[0]).toBe(nameOf(lo));
  });

  it('est stable sur plusieurs appels', () => {
    const deck = deckOf(card([A]), card([A]), card([B]), card([B]));
    expect(computeDeckTags(deck)).toEqual(computeDeckTags(deck));
  });
});

// ── Mot de profil ───────────────────────────────────────────────────────────

describe('profil de combat', () => {
  it('dit « Mêlée » quand au moins 65 % des cartes sont au contact', () => {
    const deck = deckOf(card([], 5, 1), card([], 5, 1), card([], 5, 1), card([], 5, 3));
    expect(computeDeckTags(deck)).toContain('Mêlée');
  });

  it('dit « Distance » quand au plus 35 % le sont', () => {
    const deck = deckOf(card([], 5, 3), card([], 5, 3), card([], 5, 3), card([], 5, 1));
    expect(computeDeckTags(deck)).toContain('Distance');
  });

  it('dit « Brutal » sur un profil mixte portant au moins 2 grosses attaques', () => {
    const deck = deckOf(card([], 40, 1), card([], 40, 1), card([], 5, 3), card([], 5, 3));
    expect(computeDeckTags(deck)).toContain('Brutal');
  });

  it('dit « Offensif » sur un profil mixte à forte ATK moyenne sans deux pointes', () => {
    const deck = deckOf(card([], 25, 1), card([], 25, 1), card([], 25, 3), card([], 25, 3));
    const tags = computeDeckTags(deck);
    expect(tags).toContain('Offensif');
    expect(tags).not.toContain('Brutal');
  });

  it('n\'invente aucun mot de profil sur un deck vide', () => {
    expect(computeDeckTags([])).toEqual([]);
  });
});

// ── Plafond ─────────────────────────────────────────────────────────────────

describe('plafond', () => {
  it('ne rend jamais plus de 3 tags, deux attributs + un profil', () => {
    const A = ATTRIBUTES[0].id, B = ATTRIBUTES[1].id, C = ATTRIBUTES[2].id;
    const deck = deckOf(
      card([A, B, C], 40, 1), card([A, B, C], 40, 1),
      card([A, B, C], 40, 1), card([A, B, C], 40, 1)
    );
    expect(computeDeckTags(deck).length).toBeLessThanOrEqual(3);
  });
});

// ── Robustesse ──────────────────────────────────────────────────────────────

describe('robustesse', () => {
  it('retombe sur l\'id quand l\'attribut est inconnu du catalogue', () => {
    const tags = computeDeckTags(deckOf(card(['ARCH_INEXISTANT']), card(['ARCH_INEXISTANT'])));
    expect(tags).toContain('ARCH_INEXISTANT');
  });

  it('tolère une carte sans attributs', () => {
    expect(() => computeDeckTags(deckOf({ id: 'x', name: 'x', tier: 1 } as unknown as Card))).not.toThrow();
  });
});
