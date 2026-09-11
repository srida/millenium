/* eslint-disable @typescript-eslint/no-explicit-any */
// ÉTAPE 4 du moteur d'effets — `a_l_invocation`, le premier trigger NEUF.
//
// Le §3.5 l'appelle « le trigger n°1 d'un auto-battler », et son point de
// branchement existait déjà : `GameSession.place()` ne servait qu'aux missions.
// Il ne manquait que le moyen de le DIRE en donnée.
//
// ⚠️ **Ce qui a dû bouger dans le principe, et ce qui n'a pas bougé.** La règle
// qui a tué onze effets était « le `quand` vient du TYPE, jamais du porteur ».
// Elle tient toujours — un `revive` ne partira jamais au début d'un combat —
// mais un type peut désormais en honorer PLUSIEURS, et l'effet choisit
// (`effect.timing`). Un moment hors de la liste de son type ne compile pas :
// c'est un refus nommé, pas un effet mort.
//
// ⚠️ **La conséquence la moins évidente, et elle est ici** : « Tout annuler »
// devait apprendre à rendre ce qu'une invocation a DONNÉ. Rien ne mutait une
// unité en préparation avant ce trigger ; c'est pourquoi le point de retour ne
// copiait que les positions.
import { describe, it, expect } from 'vitest';
import { GameSession } from '../logic/GameSession.js';
import { compileAttribute } from '../logic/effects/compile.js';
import { makeCard } from './helpers.js';

const ARCH = 'ARCH_TEST';

/** Un attribut dont le palier 1 donne +10 ATQ **à l'invocation**. */
const attributAuSummon = (extra: Record<string, unknown> = {}) => ({
  id: ARCH, name: 'Test', categorie: 'Archetype', timing: 'start_of_combat',
  thresholds: [{ count: 1, effects: [{ type: 'stat_bonus', stat: 'atk', value: 10, timing: 'on_summon', ...extra }] }],
});

const carte = (id: string, attrs: string[] = [ARCH]) =>
  makeCard({ id, tier: 1, attributes: attrs, stats: { atk: 5, hp: 30, movement_rate: 100, attack_rate: 100, range: 1 } });

function session(attributs: any[], cartes: any[]) {
  const deck = cartes;
  const s = new GameSession({
    cardsByTier: { 1: deck, 2: [], 3: [], 4: [], 5: [] },
    attributeList: attributs,
    cardDb: { getCard: (id: string) => deck.find((c: any) => c.id === id) ?? null },
    boardDb: { getAllBoards: () => [] },
    getAllMagies: () => [],
    mode: 'ai',
    rand: () => 0.5,
  } as any);
  return s;
}

// ───────────────────────────────────────────────────────────────────────────

describe('a_l_invocation — la donnée le dit, le moteur le fait', () => {
  it('compile quand le type sait honorer ce moment', () => {
    const { effets, refus } = compileAttribute(attributAuSummon() as any, new Set([ARCH]));
    expect(refus).toEqual([]);
    expect(effets[0].trigger.quand).toBe('a_l_invocation');
  });

  // ⚠️ LA règle qui ne bouge pas : un type qui ne sait pas honorer un moment le
  // REFUSE. C'est ce qui rend impossible la panne d'origine — un `revive` posé
  // sous un `start_of_combat` traversait le combat sans jamais être atteint.
  it('REFUSE un moment que le type ne sait pas honorer', () => {
    const attr: any = {
      id: ARCH, timing: 'end_of_combat',
      thresholds: [{ count: 1, effects: [{ type: 'revive', hp_percent: 50, timing: 'on_summon' }] }],
    };
    const { effets, refus } = compileAttribute(attr, new Set([ARCH]));
    expect(effets).toEqual([]);
    expect(refus[0].raison).toBe('moment impossible');
  });

  it('REFUSE un moment qui n’existe pas', () => {
    const { refus } = compileAttribute(attributAuSummon({ timing: 'a_la_pause_cafe' }) as any, new Set([ARCH]));
    expect(refus[0].raison).toBe('moment inconnu');
  });

  // ⚠️ Le `timing` de l'EFFET l'emporte sur celui de son PORTEUR, et c'est tout
  // le découplage du §1.4 : le plus spécifique gagne. Sans cette clause, la
  // cohérence porteur/effet — qui existe pour attraper un effet mort — refuserait
  // exactement ce qu'on vient d'ouvrir.
  it('le moment de l’EFFET l’emporte sur le `timing` de son porteur', () => {
    const attr = { ...attributAuSummon(), timing: 'end_of_combat' };
    const { effets, refus } = compileAttribute(attr as any, new Set([ARCH]));
    expect(refus).toEqual([]);
    expect(effets[0].trigger.quand).toBe('a_l_invocation');
  });

  // ⚠️ Une portée mal écrite ne doit pas compiler. Sans ce refus, `executer` la
  // lirait comme « autre chose qu'`a_chaque_fois` » et refuserait l'effet faute
  // de mémoire : un effet mort par faute de frappe, exactement ce qu'on ferme
  // partout ailleurs.
  it('REFUSE une portée qui n’existe pas', () => {
    const { effets, refus } = compileAttribute(attributAuSummon({ portee: 'une_fois_par_lune' }) as any, new Set([ARCH]));
    expect(effets).toEqual([]);
    expect(refus[0].raison).toBe('portée inconnue');
  });

  it('une portée valide voyage jusqu’au trigger', () => {
    const { effets } = compileAttribute(attributAuSummon({ portee: 'une_fois_par_combat' }) as any, new Set([ARCH]));
    expect(effets[0].trigger.portee).toBe('une_fois_par_combat');
  });

  it('sans `timing` sur l’effet, le type décide — la donnée livrée ne bouge pas', () => {
    const attr: any = {
      id: ARCH, timing: 'start_of_combat',
      thresholds: [{ count: 1, effects: [{ type: 'stat_bonus', stat: 'atk', value: 10 }] }],
    };
    expect(compileAttribute(attr, new Set([ARCH])).effets[0].trigger.quand).toBe('debut_combat');
  });
});

describe('a_l_invocation — de bout en bout, dans une vraie session', () => {
  it('poser une unité applique le bonus, sur place', () => {
    const s = session([attributAuSummon()], [carte('C1')]);
    s.startPreparation();
    const u = s.place(carte('C1') as any, { col: 0, row: 0 }, [], 0)!;
    expect(u.atk).toBe(15);
  });

  // ⚠️ APRÈS la pose, jamais avant : l'unité doit compter dans son propre
  // palier. Un seuil qu'on complète sans en profiter serait le genre d'écart
  // qu'on ne remarque qu'au dixième essai.
  it('l’unité posée compte dans SON palier — le trigger part après la pose', () => {
    const attr = { ...attributAuSummon(), thresholds: [{ count: 2, effects: [{ type: 'stat_bonus', stat: 'atk', value: 10, timing: 'on_summon' }] }] };
    const s = session([attr], [carte('C1'), carte('C2')]);
    s.startPreparation();
    const a = s.place(carte('C1') as any, { col: 0, row: 0 }, [], 0)!;
    expect(a.atk).toBe(5); // palier 2 pas encore atteint
    const b = s.place(carte('C2') as any, { col: 1, row: 0 }, [], 0)!;
    // La seconde invocation complète le palier, et les DEUX en profitent.
    expect(a.atk).toBe(15);
    expect(b.atk).toBe(15);
  });

  it('une unité qui ne porte pas l’attribut n’est pas visée', () => {
    const s = session([attributAuSummon()], [carte('C1'), carte('C2', [])]);
    s.startPreparation();
    s.place(carte('C1') as any, { col: 0, row: 0 }, [], 0);
    const autre = s.place(carte('C2', []) as any, { col: 1, row: 0 }, [], 0)!;
    expect(autre.atk).toBe(5);
  });

  // ⚠️ LE cas qui a demandé de toucher au point de retour, et il a fallu DEUX
  // rounds pour l'exhiber. Le témoin ne peut pas être une unité invoquée ce
  // tour-ci : l'annulation la retire du plateau, donc son bonus résiduel ne se
  // voit nulle part. Il faut une SURVIVANTE — présente au point de capture —
  // à qui l'invocation du tour donne quelque chose. Sans la copie des bonus
  // dans `PrepSnapshot`, elle gardait ce cadeau après l'annulation.
  //
  // ⚠️ Première version de ce cas : une unité posée puis annulée, qui gardait
  // bien son +10 — et ça ne prouvait rien, puisqu'elle n'était plus en jeu.
  it('« Tout annuler » reprend ce qu’une invocation a donné à une SURVIVANTE', () => {
    const attr = { ...attributAuSummon(), thresholds: [{ count: 2, effects: [{ type: 'stat_bonus', stat: 'atk', value: 10, timing: 'on_summon' }] }] };
    const s = session([attr], [carte('C1'), carte('C2')]);

    // Round 1 : on pose C1 et on traverse un combat sans adversaire.
    s.startPreparation();
    const a = s.place(carte('C1') as any, { col: 0, row: 0 }, [], 0)!;
    s.startCombat(null);
    s.finishCombat();

    // Round 2 : C1 est sur le plateau AU MOMENT DE LA CAPTURE.
    s.startPreparation();
    expect(a.atk).toBe(5);
    s.place(carte('C2') as any, { col: 1, row: 0 }, [], 0);
    expect(a.atk).toBe(15);

    expect(s.undoPreparation()).toBe(true);
    expect(a.atk).toBe(5);
  });

  // ⚠️ `_stat_bonuses` n'est balayé qu'à `finishCombat` : un bonus posé en
  // préparation traverse donc le combat, ce qu'un joueur attend. `startCombat`
  // ne remet à zéro que les HORLOGES.
  it('le bonus survit au lancement du combat', () => {
    const s = session([attributAuSummon()], [carte('C1')]);
    s.startPreparation();
    const u = s.place(carte('C1') as any, { col: 0, row: 0 }, [], 0)!;
    s.startCombat(null);
    expect(u.atk).toBeGreaterThanOrEqual(15);
  });

  it('`une_fois_par_partie` ne part qu’une fois, même sur dix invocations', () => {
    const attr = { ...attributAuSummon(), thresholds: [{ count: 1, effects: [{ type: 'stat_bonus', stat: 'atk', value: 10, timing: 'on_summon', portee: 'une_fois_par_partie' }] }] };
    const s = session([attr], [carte('C1'), carte('C2')]);
    s.startPreparation();
    const a = s.place(carte('C1') as any, { col: 0, row: 0 }, [], 0)!;
    s.place(carte('C2') as any, { col: 1, row: 0 }, [], 0);
    expect(a.atk).toBe(15);
  });

  // ⚠️ La preuve que le branchement est GRATUIT sur le catalogue d'aujourd'hui :
  // aucun attribut livré ne déclare `on_summon`, donc `place()` ne construit ni
  // ne compile rien. C'est un test de non-régression de PERFORMANCE autant que
  // de comportement.
  it('sans `on_summon` au catalogue, l’invocation ne construit RIEN', () => {
    let lu = 0;
    const attrs: any = [{ id: ARCH, timing: 'start_of_combat', thresholds: [{ count: 1, effects: [{ type: 'stat_bonus', stat: 'atk', value: 10 }] }] }];
    Object.defineProperty(attrs[0].thresholds[0], 'effects', {
      get() { lu += 1; return [{ type: 'stat_bonus', stat: 'atk', value: 10 }]; },
    });
    const s = session(attrs, [carte('C1')]);
    s.startPreparation();
    s.place(carte('C1') as any, { col: 0, row: 0 }, [], 0);
    const apresPremiere = lu;
    s.place(carte('C1') as any, { col: 1, row: 0 }, [], 0);
    // Le test du catalogue est MÉMOÏSÉ : la seconde invocation ne relit rien.
    expect(lu).toBe(apresPremiere);
  });
});
