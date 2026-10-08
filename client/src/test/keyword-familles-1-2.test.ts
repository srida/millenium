/* eslint-disable @typescript-eslint/no-explicit-any */
// FAMILLES 1 ET 2 — qui l'unité vise, où elle va.
//
// Six mots-clés, un seul patron (celui d'Insaisissable) : un type d'effet sans
// champ, compilé en `poser_statut`, que le moteur traduit en POLITIQUE sur
// l'unité (`target_policy`, `move_policy`). La traduction est éprouvée par
// `effect-schema.test.ts` ; ce fichier éprouve la donnée livrée, la table de
// priorité et ce que la boucle de combat en fait.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AttributeManager } from '../logic/AttributeManager.js';
import { CombatManager } from '../logic/CombatManager.js';
import { referenceCellRank } from '../logic/PathFinder.js';
import { makeCard, spawn, makeBoard } from './helpers.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const attributs: any[] = JSON.parse(readFileSync(path.join(ROOT, 'initial-data/attributes.json'), 'utf8'));

/** L'attribut livré qui porte ce type d'effet — jamais une copie écrite ici. */
const livre = (type: string) => attributs.find(a => a.thresholds?.some((t: any) => t.effects?.some((e: any) => e.type === type)));

// Les types que porte un RÔLE livré (Archer, Assassin, Lancier, Soutien, Tank).
// Embusqué et Flanc restent des types du moteur, sans attribut livré : leurs
// comportements sont éprouvés plus bas sur une politique posée à la main.
const TYPES = {
  tireur_elite: ['target_policy', 'plus_loin_a_portee'],
  chasseur: ['target_policy', 'pv_bas'],
  briseur: ['target_policy', 'pv_max_haut'],
  garde_du_corps: ['move_policy', 'garde'],
  tank: ['move_policy', 'tank'],
} as const;

/** Un attribut de mot-clé écrit pour le test, quand aucun n'est livré. */
const synthetique = (id: string, type: string) => ({ id, name: id, categorie: 'MotCle', timing: 'start_of_combat', thresholds: [{ count: 1, effects: [{ type }] }] });

/** Une unité lente, molle et sans attaque : seule la règle testée se lit. */
function carte(id: string, stats: any = {}, attrs: string[] = []) {
  return makeCard({ id, attributes: attrs, stats: { atk: 0, hp: 500, range: 1, attack_rate: 0, movement_rate: 0, ...stats } });
}

/** Joue `n` ticks ; rend tous les événements, sérialisés au moment de l'émission. */
function joue(board: any, joueur: any[], ennemi: any[], n: number) {
  const combat = new (CombatManager as any)(board, joueur, ennemi, null);
  const log: any[] = [];
  for (let i = 0; i < n && !combat.isOver; i++) {
    for (const e of combat.step()) {
      if (e.type === 'attack') log.push({ type: 'attack', by: e.attacker.card_id, to: e.target.card_id });
      if (e.type === 'move') log.push({ type: 'move', by: e.unit.card_id, to: { ...e.to } });
    }
  }
  return log;
}

const premiereAttaque = (log: any[], par: string) => log.find(e => e.type === 'attack' && e.by === par)?.to;
const pas = (log: any[], par: string) => log.filter(e => e.type === 'move' && e.by === par).map(e => e.to);

describe('Familles 1 et 2 — la donnée livrée', () => {
  for (const [type, [champ, valeur]] of Object.entries(TYPES)) {
    it(`${type} : un RÔLE à palier 1 qui pose ${champ} = ${valeur}`, () => {
      const attr = livre(type);
      expect(attr, `aucun attribut livré ne porte ${type}`).toBeTruthy();
      expect(attr.categorie).toBe('Role');
      expect(attr.thresholds).toHaveLength(1);
      expect(attr.thresholds[0].count).toBe(1);

      const board = makeBoard();
      const porteur = spawn(board, carte('P', {}, [attr.id]), 'player', { col: 0, row: 0 });
      const autre = spawn(board, carte('A'), 'player', { col: 1, row: 0 });
      const ennemi = spawn(board, carte('E', {}, [attr.id]), 'enemy', { col: 0, row: 10 });
      new (AttributeManager as any)(attributs, [porteur, autre], [ennemi]).applyStartOfCombat();

      expect(porteur[champ]).toBe(valeur);
      expect(ennemi[champ]).toBe(valeur); // les deux camps, sans asymétrie
      expect(autre.target_policy).toBe('plus_proche');
      expect(autre.move_policy).toBe('normal');
    });
  }
});

describe('Familles 1 et 2 — une politique par famille', () => {
  // ⚠️ Le conflit se tranche par le RANG, jamais par l'ordre des effets : le
  // même porteur donne la même politique quel que soit l'ordre du catalogue.
  it('Briseur l\'emporte sur Chasseur et Tireur d\'élite, dans les deux ordres', () => {
    const ids = [livre('tireur_elite').id, livre('chasseur').id, livre('briseur').id];
    for (const catalogue of [attributs, [...attributs].reverse()]) {
      for (const porte of [ids, [...ids].reverse()]) {
        const board = makeBoard();
        const u = spawn(board, carte('P', {}, porte), 'player', { col: 0, row: 0 });
        new (AttributeManager as any)(catalogue, [u], []).applyStartOfCombat();
        expect(u.target_policy).toBe('pv_max_haut');
      }
    }
  });

  it('Garde du corps l\'emporte sur Embusqué et Flanc, dans les deux ordres', () => {
    const extra = [synthetique('T_FLANC', 'flanc'), synthetique('T_EMB', 'embusque')];
    const ids = ['T_FLANC', 'T_EMB', livre('garde_du_corps').id];
    const tous = [...attributs, ...extra];
    for (const catalogue of [tous, [...tous].reverse()]) {
      for (const porte of [ids, [...ids].reverse()]) {
        const board = makeBoard();
        const u = spawn(board, carte('P', {}, porte), 'player', { col: 0, row: 0 });
        new (AttributeManager as any)(catalogue, [u], []).applyStartOfCombat();
        expect(u.move_policy).toBe('garde');
      }
    }
  });

  // Même cycle de vie que Tour : une dissipation (POWER_DEBUFF) ne retire pas
  // un comportement ; le début du combat suivant, si.
  it('survit à resetCombatStats, tombe à resetKeywordStatuses', () => {
    const u = spawn(makeBoard(), carte('P'), 'player', { col: 0, row: 0 });
    u.target_policy = 'pv_bas'; u.move_policy = 'embusque'; u.ambush_awake = true;
    u.resetCombatStats();
    expect([u.target_policy, u.move_policy, u.ambush_awake]).toEqual(['pv_bas', 'embusque', true]);
    u.resetKeywordStatuses();
    expect([u.target_policy, u.move_policy, u.ambush_awake]).toEqual(['plus_proche', 'normal', false]);
  });

  it('le rang de case de référence est le même pour la même case physique dans les deux repères', () => {
    const a = makeBoard(); const b = makeBoard(); b.mirroredFrame = true;
    for (const [col, row] of [[0, 0], [3, 7], [4, 10], [2, 5]]) {
      expect(referenceCellRank(a, { col, row })).toBe(referenceCellRank(b, { col, row: 10 - row }));
    }
  });
});

describe('Tireur d\'élite — le plus éloigné à portée', () => {
  function scene(policy: string, mur = false) {
    const board = makeBoard();
    if (mur) board.setBlockedCells([{ col: 2, row: 4 }]);
    const tir = spawn(board, carte('TIR', { atk: 1, range: 4, attack_rate: 100 }), 'player', { col: 2, row: 2 });
    tir.target_policy = policy;
    const e = [
      spawn(board, carte('E_1'), 'enemy', { col: 2, row: 3 }),
      spawn(board, carte('E_3'), 'enemy', { col: 2, row: 5 }),
      spawn(board, carte('E_5'), 'enemy', { col: 2, row: 7 }),
    ];
    return premiereAttaque(joue(board, [tir], e, 5), 'TIR');
  }

  it('vise celui à 3 cases plutôt que celui au contact (5 est hors de portée)', () => {
    expect(scene('plus_loin_a_portee')).toBe('E_3');
    expect(scene('plus_proche')).toBe('E_1'); // témoin : la règle par défaut
  });

  it('ne voit pas un ennemi derrière un mur', () => {
    expect(scene('plus_loin_a_portee', true)).toBe('E_1');
  });
});

describe('Chasseur — les PV les plus bas, où qu\'ils soient', () => {
  it('rejoint l\'ennemi le plus blessé malgré un ennemi plus proche', () => {
    const board = makeBoard();
    const ch = spawn(board, carte('CH', { atk: 1, movement_rate: 100, attack_rate: 100 }), 'player', { col: 2, row: 0 });
    ch.target_policy = 'pv_bas';
    const pres = spawn(board, carte('PRES'), 'enemy', { col: 2, row: 7 });
    const proie = spawn(board, carte('PROIE'), 'enemy', { col: 0, row: 10 });
    proie.current_hp = 20;
    expect(premiereAttaque(joue(board, [ch], [pres, proie], 60), 'CH')).toBe('PROIE');
  });

  it('entre deux ennemis à sa portée, frappe le plus blessé, pas le plus proche', () => {
    const board = makeBoard();
    const ch = spawn(board, carte('CH', { atk: 1, range: 9, attack_rate: 100 }), 'player', { col: 2, row: 3 });
    ch.target_policy = 'pv_bas';
    const pres = spawn(board, carte('PRES'), 'enemy', { col: 2, row: 7 });
    const proie = spawn(board, carte('PROIE'), 'enemy', { col: 0, row: 10 });
    proie.current_hp = 20;
    expect(premiereAttaque(joue(board, [ch], [pres, proie], 5), 'CH')).toBe('PROIE');
  });

  it('frappe ce qui est à sa portée quand sa proie est hors d\'atteinte', () => {
    const board = makeBoard();
    const ch = spawn(board, carte('CH', { atk: 1, attack_rate: 100 }), 'player', { col: 2, row: 6 });
    ch.target_policy = 'pv_bas';
    const pres = spawn(board, carte('PRES'), 'enemy', { col: 2, row: 7 });
    const proie = spawn(board, carte('PROIE'), 'enemy', { col: 0, row: 10 });
    proie.current_hp = 20;
    expect(premiereAttaque(joue(board, [ch], [pres, proie], 5), 'CH')).toBe('PRES');
  });

  it('à PV égaux, la plus proche ; à égalité complète, la case de référence', () => {
    const board = makeBoard();
    const ch = spawn(board, carte('CH', { atk: 1, range: 9, attack_rate: 100 }), 'player', { col: 2, row: 2 });
    ch.target_policy = 'pv_bas';
    // Deux exemplaires de la MÊME carte, à la même distance : seul le dernier
    // critère (colonne d'abord) les départage.
    const g = spawn(board, carte('JUMELLE'), 'enemy', { col: 1, row: 7 });
    const d = spawn(board, carte('JUMELLE'), 'enemy', { col: 3, row: 7 });
    const combat = new (CombatManager as any)(board, [ch], [d, g], null);
    combat.step(); combat.step();
    expect(g.current_hp).toBe(499);
    expect(d.current_hp).toBe(500);
  });
});

describe('Briseur — les PV max les plus hauts', () => {
  it('entre deux ennemis à sa portée, frappe celui aux PV max les plus hauts', () => {
    const board = makeBoard();
    const br = spawn(board, carte('BR', { atk: 1, range: 9, attack_rate: 100 }), 'player', { col: 2, row: 3 });
    br.target_policy = 'pv_max_haut';
    const pres = spawn(board, carte('PRES', { hp: 100 }), 'enemy', { col: 2, row: 7 });
    const tank = spawn(board, carte('TANK', { hp: 900 }), 'enemy', { col: 4, row: 10 });
    expect(premiereAttaque(joue(board, [br], [pres, tank], 5), 'BR')).toBe('TANK');
  });

  it('va au tank du fond malgré un ennemi plus proche', () => {
    const board = makeBoard();
    const br = spawn(board, carte('BR', { atk: 1, movement_rate: 100, attack_rate: 100 }), 'player', { col: 2, row: 0 });
    br.target_policy = 'pv_max_haut';
    const pres = spawn(board, carte('PRES', { hp: 100 }), 'enemy', { col: 2, row: 7 });
    const tank = spawn(board, carte('TANK', { hp: 900 }), 'enemy', { col: 4, row: 10 });
    expect(premiereAttaque(joue(board, [br], [pres, tank], 60), 'BR')).toBe('TANK');
  });
});

describe('Embusqué — reste en place jusqu\'au réveil', () => {
  it('ne bouge pas tant qu\'aucun ennemi n\'est à sa portée, et son horloge n\'avance pas', () => {
    const board = makeBoard();
    const emb = spawn(board, carte('EMB', { range: 2, movement_rate: 100 }), 'player', { col: 2, row: 3 });
    emb.move_policy = 'embusque';
    const e = spawn(board, carte('E'), 'enemy', { col: 2, row: 7 });
    expect(pas(joue(board, [emb], [e], 30), 'EMB')).toEqual([]);
    expect(emb.move_timer).toBe(0);
    expect(emb.ambush_awake).toBe(false);
  });

  // ⚠️ Le réveil est DÉFINITIF : sans cette mémoire, l'Embusqué se refigerait
  // dès que sa première cible meurt.
  it('une fois réveillé, marche vers la suivante après la mort de sa cible', () => {
    const board = makeBoard();
    const emb = spawn(board, carte('EMB', { atk: 100, range: 1, movement_rate: 100, attack_rate: 100 }), 'player', { col: 2, row: 3 });
    emb.move_policy = 'embusque';
    const proche = spawn(board, carte('PROCHE', { hp: 10, movement_rate: 100 }), 'enemy', { col: 2, row: 6 });
    const loin = spawn(board, carte('LOIN'), 'enemy', { col: 0, row: 10 });
    const log = joue(board, [emb], [proche, loin], 40);
    expect(proche.isAlive()).toBe(false);
    expect(pas(log, 'EMB').length).toBeGreaterThan(0);
  });

  it('se réveille quand un tireur plus long le frappe', () => {
    const board = makeBoard();
    const emb = spawn(board, carte('EMB', { range: 1, movement_rate: 100 }), 'player', { col: 2, row: 3 });
    emb.move_policy = 'embusque';
    const tireur = spawn(board, carte('TIREUR', { atk: 1, range: 6, attack_rate: 100 }), 'enemy', { col: 2, row: 9 });
    const log = joue(board, [emb], [tireur], 20);
    expect(emb.ambush_awake).toBe(true);
    expect(pas(log, 'EMB').length).toBeGreaterThan(0);
  });
});

describe('Garde du corps — au contact de l\'allié le plus blessé', () => {
  it('quitte un ennemi à sa portée pour rejoindre son protégé, et s\'y arrête', () => {
    const board = makeBoard();
    const garde = spawn(board, carte('GARDE', { movement_rate: 100 }), 'player', { col: 4, row: 1 });
    garde.move_policy = 'garde';
    const faible = spawn(board, carte('FAIBLE'), 'player', { col: 0, row: 1 });
    faible.current_hp = 10;
    spawn(board, carte('SOLIDE'), 'player', { col: 4, row: 0 });
    const e = spawn(board, carte('E'), 'enemy', { col: 4, row: 2 });
    const log = joue(board, [garde, faible, board.getUnit({ col: 4, row: 0 })], [e], 30);
    expect(pas(log, 'GARDE').length).toBeGreaterThan(0);
    expect(Math.abs(garde.position.col - 0) + Math.abs(garde.position.row - 1)).toBe(1);
  });

  it('sans allié à garder, avance comme une unité normale', () => {
    const board = makeBoard();
    const garde = spawn(board, carte('GARDE', { movement_rate: 100 }), 'player', { col: 2, row: 0 });
    garde.move_policy = 'garde';
    const e = spawn(board, carte('E'), 'enemy', { col: 2, row: 10 });
    expect(pas(joue(board, [garde], [e], 10), 'GARDE').length).toBeGreaterThan(0);
  });
});

describe('Flanc — par la colonne de bord', () => {
  function trajet(policy: string, depart: { col: number; row: number }, cible: { col: number; row: number }) {
    const board = makeBoard();
    const f = spawn(board, carte('F', { movement_rate: 100 }), 'player', depart);
    f.move_policy = policy;
    const e = spawn(board, carte('E'), 'enemy', cible);
    return pas(joue(board, [f], [e], 30), 'F');
  }

  it('parti de la colonne 1, rejoint la colonne 0 et la longe jusqu\'à la rangée de la cible', () => {
    const t = trajet('flanc', { col: 1, row: 0 }, { col: 2, row: 10 });
    expect(t[0]).toEqual({ col: 0, row: 0 });
    for (const p of t.filter(p => p.row < 10)) expect(p.col).toBe(0);
    expect(trajet('normal', { col: 1, row: 0 }, { col: 2, row: 10 })[0]).not.toEqual({ col: 0, row: 0 }); // témoin
  });

  it('parti de la colonne 2, prend le bord du côté de sa cible', () => {
    expect(trajet('flanc', { col: 2, row: 0 }, { col: 4, row: 10 })[0]).toEqual({ col: 3, row: 0 });
    expect(trajet('flanc', { col: 2, row: 0 }, { col: 0, row: 10 })[0]).toEqual({ col: 1, row: 0 });
  });
});
