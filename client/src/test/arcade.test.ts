/* eslint-disable @typescript-eslint/no-explicit-any */
/// <reference types="node" />
// Les types Node sont référencés ICI et pas dans `types` du tsconfig : le client
// est du code navigateur, seul ce test (qui charge un module serveur) en a besoin.
//
// Golden tests du mode ARCADE (arcade.js, côté SERVEUR).
//
// Même harnais que shop.test.ts / cosmetics.test.ts : le module est chargé via
// createRequire avec un DATA_DIR temporaire, il ouvre sa propre base SQLite et
// ne touche jamais data/soulforge.db.
//
// Une différence assumée : le catalogue de decks publics est ÉCRIT ICI plutôt
// que copié de `data/`. C'est lui l'objet du test — il faut des difficultés
// connues, un niveau volontairement vide pour éprouver le repli, et un deck
// trop court pour vérifier qu'il n'est jamais proposé comme adversaire. Les
// autres catalogues viennent de `initial-data/`, versionné et toujours présent
// (précédent : tutorial.test.ts), là où `data/` n'existe qu'après un démarrage
// du serveur.
//
// Ce qui est verrouillé ici, ce sont les règles qui ne doivent jamais dériver :
//   - UNE RUN PAR JOUR : lancer deux fois échoue, la rotation la rouvre ;
//   - la run est REPRENABLE : elle survit à une relecture, au même échelon et
//     contre les mêmes adversaires ;
//   - une DÉFAITE clôt la run, et plus rien ne s'y rapporte ;
//   - le gain de fin de parcours est versé UNE SEULE FOIS, au dernier duel
//     gagné, et jamais sur une run perdue ;
//   - le handicap de l'IA CROÎT strictement d'un échelon à l'autre.
import { describe, it, expect, beforeAll } from 'vitest';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import crypto from 'node:crypto';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

let arcade: any;
let progression: any;
let stmt: any;
let TMP: string;

/** Deck public de test : `size` cartes réparties sur les tiers 1-2. */
function deckOf(id: string, difficulty: number, size = 24) {
  const cards: Record<string, string[]> = { '1': [], '2': [] };
  for (let i = 0; i < size; i++) cards[i % 2 ? '2' : '1'].push(`${id}_C${i}`);
  return { id, name: `Deck ${id}`, difficulty, deck: cards };
}

/**
 * Catalogue de decks publics. Par défaut : trois decks en difficulté 1, 2 et 4,
 * AUCUN en 3 (pour éprouver le repli) et un deck trop court (jamais adversaire).
 */
function writeDecks(decks: any[]) {
  fs.writeFileSync(path.join(TMP, 'public_decks.json'), JSON.stringify(decks));
}

const FULL_CATALOG = [
  deckOf('D1A', 1), deckOf('D1B', 1),
  deckOf('D2A', 2), deckOf('D2B', 2),
  deckOf('D3A', 3), deckOf('D3B', 3),
  deckOf('D4A', 4), deckOf('D4B', 4),
];

beforeAll(() => {
  TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'millenium-arcade-'));
  for (const f of ['cards.json', 'missions.json', 'sets.json']) {
    fs.copyFileSync(path.join(ROOT, 'initial-data', f), path.join(TMP, f));
  }
  writeDecks(FULL_CATALOG);
  process.env.DATA_DIR = TMP;
  ({ stmt } = require(path.join(ROOT, 'db.js')));
  progression = require(path.join(ROOT, 'progression.js'));
  arcade = require(path.join(ROOT, 'arcade.js'));
});

// Tous les comptes de test partagent `username_lc = 't'` : la contrainte
// d'unicité porte donc sur (username_lc, tag), et un compteur supprime la
// collision par construction (même raison que dans shop.test.ts).
let _tagSeq = 0;

function newUser() {
  const id = crypto.randomUUID();
  stmt.insertUser.run({
    id, email: `${id}@test.local`, username: 'T', username_lc: 't',
    tag: String(++_tagSeq).padStart(4, '0'), password_hash: 'x', avatar: null, created_at: Date.now(),
  });
  progression.initUser(id);
  return () => stmt.userById.get(id);
}

/** Joue la run jusqu'au bout avec le résultat donné à chaque duel. */
function playRun(user: () => any, results: ('win' | 'loss')[]) {
  const out = [];
  for (const result of results) {
    const run = arcade.getSnapshot(user()).run;
    if (!run || run.status !== 'in_progress') break;
    out.push(arcade.reportDuel(user(), { index: run.current, result }));
  }
  return out;
}

/** Force la ligne du joueur sur un jour antérieur — simule une rotation. */
function rewindDay(userId: string) {
  stmt.upsertArcadeState.run({ user_id: userId, run_day: '1999-01-01', run: null });
}

describe('calendrier', () => {
  it('tourne avec la boutique et les missions (même reset de 5 h)', () => {
    // Un seul rendez-vous quotidien à retenir : l'Arcade ne réinvente pas son
    // calendrier, elle importe celui de shop.js — qui est celui de missions.js.
    const shop = require(path.join(ROOT, 'shop.js'));
    const snap = arcade.getSnapshot(newUser()());
    expect(snap.day).toBe(shop.dayKey());
    expect(snap.next_rotation_at).toBe(shop.nextRotationAt());
  });

  it('l\'instantané annonce le parcours avant toute run', () => {
    // Le joueur doit voir ce qui l'attend AVANT d'engager sa journée.
    const snap = arcade.refresh(newUser()());
    expect(snap.run).toBeNull();
    expect(snap.plan).toHaveLength(arcade.DUEL_COUNT);
    expect(snap.reward).toEqual(arcade.RUN_REWARD);
  });
});

describe('barème du handicap', () => {
  it('le premier duel est à mains nues', () => {
    // C'est l'étalon : le joueur voit d'abord un adversaire non trafiqué.
    expect(arcade.DUELS[0].bonus).toEqual({ hp: 0, atk: 0 });
  });

  it('exactement 0/0, 10/2, 30/3, 50/5', () => {
    expect(arcade.DUELS.map((d: any) => d.bonus)).toEqual([
      { hp: 0, atk: 0 }, { hp: 10, atk: 2 }, { hp: 30, atk: 3 }, { hp: 50, atk: 5 },
    ]);
  });

  it('handicap et difficulté croissent strictement', () => {
    // Une rampe qui s'aplatit ou s'inverse ferait du 4ᵉ duel une formalité.
    for (let i = 1; i < arcade.DUELS.length; i++) {
      const prev = arcade.DUELS[i - 1];
      const cur = arcade.DUELS[i];
      expect(cur.difficulty).toBeGreaterThan(prev.difficulty);
      expect(cur.bonus.hp).toBeGreaterThan(prev.bonus.hp);
      expect(cur.bonus.atk).toBeGreaterThan(prev.bonus.atk);
    }
  });
});

describe('tirage des adversaires', () => {
  it('le duel N tire un deck de difficulté N', () => {
    const user = newUser();
    arcade.start(user(), 'Mon deck');
    const run = arcade.getSnapshot(user()).run;
    expect(run.duels).toHaveLength(arcade.DUEL_COUNT);
    run.duels.forEach((d: any, i: number) => {
      expect(d.difficulty).toBe(arcade.DUELS[i].difficulty);
      expect(d.bonus).toEqual(arcade.DUELS[i].bonus);
      expect(d.index).toBe(i);
      expect(d.result).toBeNull();
    });
  });

  it('la composition du deck adverse voyage avec la run', () => {
    // Sans elle, un deck public retouché ou supprimé en admin en cours de run
    // casserait la reprise : l'écran de jeu ne pourrait plus le recharger.
    const user = newUser();
    arcade.start(user(), 'Mon deck');
    for (const d of arcade.getSnapshot(user()).run.duels) {
      expect(arcade.deckSize(d.deck)).toBeGreaterThanOrEqual(arcade.MIN_DECK_CARDS);
    }
  });

  it('un deck trop court n\'est jamais proposé comme adversaire', () => {
    writeDecks([...FULL_CATALOG, deckOf('SHORT', 1, 4)]);
    try {
      const user = newUser();
      arcade.start(user(), 'Mon deck');
      const ids = arcade.getSnapshot(user()).run.duels.map((d: any) => d.deck_id);
      expect(ids).not.toContain('SHORT');
    } finally {
      writeDecks(FULL_CATALOG);
    }
  });

  it('le tirage est déterministe à (joueur, jour)', () => {
    // Un tirage douteux se rejoue au lieu de se raconter.
    const user = newUser();
    const a = arcade.buildRun(user().id, 'X', { day: '2026-08-09' });
    const b = arcade.buildRun(user().id, 'X', { day: '2026-08-09' });
    expect(a.duels.map((d: any) => d.deck_id)).toEqual(b.duels.map((d: any) => d.deck_id));
  });

  it('le parcours change d\'un jour à l\'autre', () => {
    // Formulé sur une SÉRIE de jours et non sur une paire : avec deux decks par
    // difficulté, deux jours voisins peuvent légitimement tomber sur le même
    // tirage (1 chance sur 16). Ce qu'on vérifie, c'est que le jour entre bien
    // dans la graine — pas qu'il n'y a jamais de répétition.
    const user = newUser();
    const seen = new Set<string>();
    for (let d = 1; d <= 12; d++) {
      const day = `2026-08-${String(d).padStart(2, '0')}`;
      seen.add(arcade.buildRun(user().id, 'X', { day }).duels.map((x: any) => x.deck_id).join('|'));
    }
    expect(seen.size).toBeGreaterThan(1);
  });

  it('deux joueurs n\'ont pas forcément le même parcours', () => {
    // Même raisonnement : c'est l'identité du joueur qui doit entrer dans la
    // graine, pas l'absence de collision entre deux comptes donnés.
    const day = '2026-08-09';
    const seen = new Set<string>();
    for (let i = 0; i < 12; i++) {
      seen.add(arcade.buildRun(`player-${i}`, 'X', { day }).duels.map((x: any) => x.deck_id).join('|'));
    }
    expect(seen.size).toBeGreaterThan(1);
  });

  it('une difficulté vide se replie sur la plus proche non vide', () => {
    // Sans repli, un seul niveau laissé vide en admin — ou une base antérieure
    // au champ, où tout est lu comme 1 — rendrait la run impossible à lancer.
    writeDecks([deckOf('E1', 1), deckOf('E2', 2), deckOf('E4', 4)]);
    try {
      const run = arcade.buildRun('u-fallback', 'X', { day: '2026-08-09' });
      expect(run.duels.map((d: any) => d.deck_id)).toEqual(['E1', 'E2', 'E4', 'E4']);
      // L'échelon garde SON handicap : c'est le duel qui durcit, pas le deck.
      expect(run.duels[2].bonus).toEqual(arcade.DUELS[2].bonus);
    } finally {
      writeDecks(FULL_CATALOG);
    }
  });

  it('un catalogue sans difficulté reste jouable (tout lu comme 1)', () => {
    // L'état d'une base déjà déployée : le champ est postérieur aux decks livrés.
    writeDecks([{ id: 'OLD_A', name: 'A', deck: deckOf('OLD_A', 1).deck },
      { id: 'OLD_B', name: 'B', deck: deckOf('OLD_B', 1).deck }]);
    try {
      const user = newUser();
      expect(arcade.start(user(), 'X').ok).toBe(true);
      const run = arcade.getSnapshot(user()).run;
      expect(run.duels).toHaveLength(arcade.DUEL_COUNT);
      expect(run.duels.every((d: any) => d.difficulty === 1)).toBe(true);
      // Les handicaps, eux, ne sont pas alignés vers le bas.
      expect(run.duels[3].bonus).toEqual(arcade.DUELS[3].bonus);
    } finally {
      writeDecks(FULL_CATALOG);
    }
  });

  it('sans aucun deck jouable, la run refuse de partir', () => {
    writeDecks([deckOf('TINY', 1, 3)]);
    try {
      const user = newUser();
      const res = arcade.start(user(), 'X');
      expect(res.ok).toBe(false);
      expect(res.stale).toBeFalsy();     // ce n'est pas une offre périmée
      expect(arcade.getSnapshot(user()).run).toBeNull();
    } finally {
      writeDecks(FULL_CATALOG);
    }
  });
});

describe('verrou quotidien', () => {
  it('une seule run par jour, même terminée', () => {
    const user = newUser();
    expect(arcade.start(user(), 'X').ok).toBe(true);
    const again = arcade.start(user(), 'X');
    expect(again.ok).toBe(false);
    expect(again.stale).toBe(true);

    // Et le verrou ne se relâche pas une fois la run soldée.
    playRun(user, ['loss']);
    expect(arcade.start(user(), 'X').ok).toBe(false);
  });

  it('la rotation rouvre une run', () => {
    const user = newUser();
    arcade.start(user(), 'X');
    playRun(user, ['loss']);
    rewindDay(user().id);
    arcade.sync(user());
    expect(arcade.getSnapshot(user()).run).toBeNull();
    expect(arcade.start(user(), 'X').ok).toBe(true);
  });

  it('lire ne consomme pas la journée', () => {
    // Ouvrir l'écran Arcade ne doit pas engager la run : seul `start` engage.
    const user = newUser();
    arcade.refresh(user());
    arcade.refresh(user());
    expect(arcade.getSnapshot(user()).run).toBeNull();
    expect(arcade.start(user(), 'X').ok).toBe(true);
  });

  it('l\'instantané ne laisse jamais fuiter la run de la veille', () => {
    const user = newUser();
    arcade.start(user(), 'X');
    stmt.upsertArcadeState.run({
      user_id: user().id, run_day: '1999-01-01',
      run: JSON.stringify(arcade.getSnapshot(user()).run),
    });
    // getSnapshot est une lecture PURE : elle re-vérifie le jour elle-même,
    // sans compter sur un sync préalable.
    expect(arcade.getSnapshot(user()).run).toBeNull();
  });
});

describe('déroulé de la run', () => {
  it('une victoire avance d\'un échelon, la run reste ouverte', () => {
    const user = newUser();
    arcade.start(user(), 'X');
    const res = arcade.reportDuel(user(), { index: 0, result: 'win' });
    expect(res.ok).toBe(true);
    expect(res.granted).toBeNull();
    const run = arcade.getSnapshot(user()).run;
    expect(run.current).toBe(1);
    expect(run.status).toBe('in_progress');
    expect(run.duels[0].result).toBe('win');
  });

  it('la run se REPREND : même échelon, mêmes adversaires', () => {
    // C'est la raison d'être de la persistance serveur — s'arrêter entre deux
    // duels ne coûte rien, quel que soit l'appareil.
    const user = newUser();
    arcade.start(user(), 'X');
    const before = arcade.getSnapshot(user()).run;
    arcade.reportDuel(user(), { index: 0, result: 'win' });

    const resumed = arcade.refresh(user()).run;
    expect(resumed.current).toBe(1);
    expect(resumed.deck_name).toBe('X');
    expect(resumed.duels.map((d: any) => d.deck_id)).toEqual(before.duels.map((d: any) => d.deck_id));
  });

  it('une défaite clôt la run et rien ne s\'y rapporte plus', () => {
    const user = newUser();
    arcade.start(user(), 'X');
    arcade.reportDuel(user(), { index: 0, result: 'win' });
    expect(arcade.reportDuel(user(), { index: 1, result: 'loss' }).status).toBe('lost');

    const run = arcade.getSnapshot(user()).run;
    expect(run.status).toBe('lost');
    expect(run.duels[3].result).toBeNull();

    const late = arcade.reportDuel(user(), { index: 2, result: 'win' });
    expect(late.ok).toBe(false);
    expect(late.stale).toBe(true);
  });

  it('un rapport hors séquence est refusé', () => {
    // Deux réponses en vol ne doivent pas faire avancer la run de deux crans.
    const user = newUser();
    arcade.start(user(), 'X');
    for (const index of [1, 3, -1]) {
      const res = arcade.reportDuel(user(), { index, result: 'win' });
      expect(res.ok).toBe(false);
      expect(res.stale).toBe(true);
    }
    expect(arcade.getSnapshot(user()).run.current).toBe(0);
  });

  it('un résultat inconnu est refusé sans toucher à la run', () => {
    const user = newUser();
    arcade.start(user(), 'X');
    expect(arcade.reportDuel(user(), { index: 0, result: 'draw' }).ok).toBe(false);
    expect(arcade.getSnapshot(user()).run.duels[0].result).toBeNull();
  });

  it('rapporter sans run en cours est refusé', () => {
    const user = newUser();
    arcade.sync(user());
    const res = arcade.reportDuel(user(), { index: 0, result: 'win' });
    expect(res.ok).toBe(false);
    expect(res.stale).toBe(true);
  });
});

describe('gain de fin de run', () => {
  it('versé au dernier duel gagné, et une seule fois', () => {
    const user = newUser();
    const before = progression.getProgression(user());
    arcade.start(user(), 'X');

    const results = playRun(user, ['win', 'win', 'win', 'win']);
    expect(results.slice(0, 3).every(r => r.granted === null)).toBe(true);
    expect(results[3].granted).toEqual(arcade.RUN_REWARD);

    const after = progression.getProgression(user());
    expect(after.gold).toBe(before.gold + arcade.RUN_REWARD.gold);
    expect(arcade.getSnapshot(user()).run.status).toBe('won');
    expect(arcade.getSnapshot(user()).run.rewarded).toBe(true);

    // Un rapport de plus ne repaie rien — la garde est l'état de la run.
    expect(arcade.reportDuel(user(), { index: 3, result: 'win' }).ok).toBe(false);
    expect(progression.getProgression(user()).gold).toBe(after.gold);
  });

  it('l\'XP passe par la courbe de niveau', () => {
    // `grant` absorbe le palier : le gain ne doit pas laisser un xp ≥ 100.
    const user = newUser();
    arcade.start(user(), 'X');
    playRun(user, ['win', 'win', 'win', 'win']);
    const p = progression.getProgression(user());
    expect(p.xp).toBeLessThan(p.xp_per_level);
    expect(p.level).toBeGreaterThanOrEqual(1);
  });

  it('une run perdue ne paie rien', () => {
    const user = newUser();
    const before = progression.getProgression(user());
    arcade.start(user(), 'X');
    playRun(user, ['win', 'win', 'win', 'loss']);

    const after = progression.getProgression(user());
    expect(after.gold).toBe(before.gold);
    expect(after.xp).toBe(before.xp);
    expect(arcade.getSnapshot(user()).run.rewarded).toBe(false);
  });

  it('le barème est en golds ET en XP, jamais en gemmes', () => {
    // Les gemmes restent la monnaie des boutiques : une source quotidienne
    // gratuite les dévaluerait.
    expect(arcade.RUN_REWARD).toEqual({ xp: 50, gold: 200 });
    expect((arcade.RUN_REWARD as any).gems).toBeUndefined();
  });
});

describe('isolation entre joueurs', () => {
  it('la run d\'un joueur n\'est pas celle d\'un autre', () => {
    const a = newUser();
    const b = newUser();
    arcade.start(a(), 'X');
    expect(arcade.getSnapshot(b()).run).toBeNull();

    arcade.start(b(), 'Y');
    arcade.reportDuel(a(), { index: 0, result: 'win' });
    expect(arcade.getSnapshot(b()).run.current).toBe(0);
    expect(arcade.getSnapshot(b()).run.deck_name).toBe('Y');
  });
});
