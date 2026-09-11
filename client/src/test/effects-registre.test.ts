/* eslint-disable @typescript-eslint/no-explicit-any */
// ÉTAPE 4 du moteur d'effets — le REGISTRE et la PORTÉE.
//
// Deux morceaux de vocabulaire qui étaient déclarés sans être exécutables, et
// c'est le motif que ce chantier existe pour supprimer :
//
// - **`poser_effet`** figurait dans `ACTIONS` (1 sur 7) et aucun compilateur ne
//   l'émettait. Pire qu'inerte : `appliqueTache` ne la dispatchait pas, si bien
//   qu'elle TRAVERSAIT jusqu'à la branche `modifier` et se faisait traiter comme
//   une modification sans champ. Ce n'était pas un refus nommé, c'était une
//   mauvaise exécution — que rien n'aurait signalée le jour où un compilateur
//   aurait commencé à l'émettre.
// - **`portee`** (§3.5) n'existait pas du tout, alors que `verrouille` — son
//   jumeau — avait été implémenté. Sans elle, « quand un allié est détruit » ne
//   sait pas dire « une fois », et la réponse reste écrite en dur.
//
// ⚠️ Le partage qui commande les deux : **le moteur inscrit et demande, il ne
// se souvient de rien.** Le registre et la mémoire des portées appartiennent à
// l'appelant, seul à savoir quand un combat finit et quand un round tourne. Lui
// donner cette mémoire, c'est lui donner un cycle de vie — ce que `logic/` ne
// lui accorde nulle part ailleurs (cf. `Ressources`).
import { describe, it, expect } from 'vitest';
import { executer, ressourcesVides } from '../logic/effects/engine.js';
import type { Monde } from '../logic/effects/engine.js';
import type { Effet, EffetPose, EntreeRegistre, Portee } from '../logic/effects/types.js';
import { PORTEES } from '../logic/effects/types.js';
import { Unit } from '../logic/Unit.js';
import { makeCard } from './helpers.js';

const uneUnite = () => new (Unit as any)(makeCard({ id: 'C1', stats: { atk: 10, hp: 100, movement_rate: 100, attack_rate: 100, range: 1 } }), 'player');

/** Un monde minimal — une unité alliée, de quoi observer une écriture. */
function monde(extra: Partial<Monde> = {}): Monde {
  return {
    unitesAlliees: [uneUnite()],
    unitesEnnemies: [],
    ressources: ressourcesVides(),
    ...extra,
  };
}

const bonusAtk: EffetPose = {
  id: 'POSE#0', porteur: 'SRC',
  trigger: { quand: 'apres_pioche' },
  taches: [{
    action: 'modifier',
    cible: { conteneur: 'board', camp: 'allie', combien: 'tous' },
    champ: 'atk', operateur: '+', valeur: 5, duree: 'combat',
  }],
};

const poseur = (duree: 'combat' | 'round' | 'partie' = 'round'): Effet => ({
  id: 'SRC#0', porteur: 'SRC',
  trigger: { quand: 'fin_combat' },
  taches: [{ action: 'poser_effet', effet: bonusAtk, duree }],
});

// ───────────────────────────────────────────────────────────────────────────

describe('poser_effet — un effet inscrit un effet', () => {
  it('inscrit dans le registre de l’appelant, avec sa durée', () => {
    const registre: EntreeRegistre[] = [];
    const trace = executer([poseur('round')], 'fin_combat', monde({ registre }));

    expect(registre).toHaveLength(1);
    expect(registre[0].duree).toBe('round');
    expect(registre[0].effet.id).toBe('POSE#0');
    expect(trace.applique).toEqual(['pose POSE#0 (round)']);
  });

  // ⚠️ LE point du §3.6 : un effet posé ne part pas dans le lot qui le pose.
  // Sinon l'ordre de résolution cesse d'être prouvable — un effet apparaîtrait
  // au milieu d'une liste déjà triée par `cleDeTri`.
  it('l’effet posé ne part PAS dans le lot qui vient de le poser', () => {
    const registre: EntreeRegistre[] = [];
    const m = monde({ registre });
    const u = m.unitesAlliees[0] as any;

    executer([poseur()], 'fin_combat', m);
    expect(u._stat_bonuses.atk ?? 0).toBe(0);

    // Il part quand l'APPELANT rejoue le registre, sous son propre `quand`.
    executer(registre.map(r => r.effet), 'apres_pioche', m);
    expect(u._stat_bonuses.atk).toBe(5);
  });

  // ⚠️ Sans registre, la tâche est REFUSÉE NOMMÉMENT — elle ne s'applique pas
  // dans le vide. C'est exactement ce qui manquait : avant, elle traversait
  // jusqu'à `modifier` et se faisait traiter comme un champ inconnu.
  it('sans registre, la tâche est refusée et NOMMÉE', () => {
    const trace = executer([poseur()], 'fin_combat', monde());
    expect(trace.applique).toEqual([]);
    expect(trace.ignore).toEqual(['poser_effet POSE#0 (aucun registre)']);
  });

  it('l’effet posé sans porteur hérite de CELUI QUI LE POSE, jamais d’un compteur', () => {
    const registre: EntreeRegistre[] = [];
    const sansPorteur = { ...poseur(), taches: [{ action: 'poser_effet' as const, effet: { ...bonusAtk, porteur: '' }, duree: 'round' as const }] };
    executer([sansPorteur], 'fin_combat', monde({ registre }));
    // La clé de tri (§5.1) en dépend : deux clients doivent en tirer le même ordre.
    expect(registre[0].effet.porteur).toBe('SRC');
  });
});

describe('portee — combien de fois un effet part', () => {
  /** La mémoire que l'appelant tient. Ici, une par portée. */
  function memoire() {
    const vues: Record<string, Set<string>> = {};
    const consommePortee = (p: Portee, cle: string) => {
      const s = (vues[p] ??= new Set());
      if (s.has(cle)) return false;
      s.add(cle);
      return true;
    };
    return { consommePortee, oublie: (p: Portee) => vues[p]?.clear() };
  }

  const avecPortee = (portee?: Portee): Effet => ({
    id: 'E#0', porteur: 'SRC',
    trigger: { quand: 'allie_detruit', ...(portee ? { portee } : {}) },
    taches: [{
      action: 'modifier',
      cible: { conteneur: 'board', camp: 'allie', combien: 'tous' },
      champ: 'atk', operateur: '+', valeur: 3, duree: 'combat',
    }],
  });

  it('absente, l’effet part à CHAQUE fois — le comportement d’aujourd’hui', () => {
    const m = monde();
    const u = m.unitesAlliees[0] as any;
    executer([avecPortee()], 'allie_detruit', m);
    executer([avecPortee()], 'allie_detruit', m);
    expect(u._stat_bonuses.atk).toBe(6);
  });

  it('`une_fois_par_combat` ne part qu’une fois, puis revient quand l’appelant oublie', () => {
    const { consommePortee, oublie } = memoire();
    const m = monde({ consommePortee });
    const u = m.unitesAlliees[0] as any;

    executer([avecPortee('une_fois_par_combat')], 'allie_detruit', m);
    const trace = executer([avecPortee('une_fois_par_combat')], 'allie_detruit', m);
    expect(u._stat_bonuses.atk).toBe(3);
    expect(trace.neant).toEqual(['E#0·(portée épuisée)']);

    // ⚠️ C'est l'APPELANT qui décide que le combat est fini, pas le moteur.
    oublie('une_fois_par_combat');
    executer([avecPortee('une_fois_par_combat')], 'allie_detruit', m);
    expect(u._stat_bonuses.atk).toBe(6);
  });

  // ⚠️ Le pendant du refus de `poser_effet` : une promesse que personne ne peut
  // tenir ne se tient pas « à peu près ». Un effet qui annonce « une fois par
  // combat » et part à chaque mort ne se voit pas, il se subit.
  it('une portée que l’appelant ne sait pas tenir REFUSE l’effet, elle ne le laisse pas partir', () => {
    const m = monde();
    const u = m.unitesAlliees[0] as any;
    const trace = executer([avecPortee('une_fois_par_partie')], 'allie_detruit', m);
    expect(u._stat_bonuses.atk ?? 0).toBe(0);
    expect(trace.ignore).toEqual(['E#0·une_fois_par_partie (aucune mémoire)']);
  });

  it('`a_chaque_fois` ne consulte AUCUNE mémoire — c’est le défaut, pas un cas', () => {
    let demandes = 0;
    const m = monde({ consommePortee: () => { demandes += 1; return true; } });
    executer([avecPortee('a_chaque_fois')], 'allie_detruit', m);
    executer([avecPortee('a_chaque_fois')], 'allie_detruit', m);
    expect(demandes).toBe(0);
    expect((m.unitesAlliees[0] as any)._stat_bonuses.atk).toBe(6);
  });

  // ⚠️ La mémoire est cloisonnée par PORTÉE, et ce n'est pas cosmétique : c'est
  // l'appelant qui OUBLIE, et il oublie par portée. Un moteur qui passerait une
  // clé de portée constante ferait tout ranger sous un seul cloison — et la fin
  // d'un combat rouvrirait un effet qui promettait « une fois par partie ».
  //
  // ⚠️ Ce cas a d'abord été écrit avec un id différent par portée : il restait
  // VERT sous la mutation, parce que des ids distincts ne se marchent pas dessus
  // de toute façon. La panne n'est visible que si l'appelant OUBLIE.
  it('la mémoire est cloisonnée par PORTÉE : oublier le combat ne rouvre pas la partie', () => {
    const { consommePortee, oublie } = memoire();
    const m = monde({ consommePortee });
    const u = m.unitesAlliees[0] as any;

    const duCombat = { ...avecPortee('une_fois_par_combat'), id: 'E-COMBAT' };
    const deLaPartie = { ...avecPortee('une_fois_par_partie'), id: 'E-PARTIE' };
    executer([duCombat, deLaPartie], 'allie_detruit', m);
    expect(u._stat_bonuses.atk).toBe(6);

    oublie('une_fois_par_combat');
    const trace = executer([duCombat, deLaPartie], 'allie_detruit', m);
    // Le combat repart, la partie reste close.
    expect(u._stat_bonuses.atk).toBe(9);
    expect(trace.neant).toEqual(['E-PARTIE·(portée épuisée)']);
  });

  it('chacune des quatre portées est acceptée par le moteur', () => {
    const { consommePortee } = memoire();
    const m = monde({ consommePortee });
    for (const p of PORTEES) {
      const trace = executer([{ ...avecPortee(p as Portee), id: `E-${p}` }], 'allie_detruit', m);
      expect(trace.ignore, p).toEqual([]);
    }
    expect((m.unitesAlliees[0] as any)._stat_bonuses.atk).toBe(12);
  });
});
