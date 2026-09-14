/* eslint-disable @typescript-eslint/no-explicit-any */
// Le récapitulatif de fin de round DÉTAILLE le bonus de multiplicateur.
//
// Il n'affichait que le facteur final : un board qui passait de ×2 à ×3,5 parce
// qu'un palier de « Rage de Vaincre » (ARCH_017, `damage_multiplier_bonus`)
// venait de s'ouvrir montrait un chiffre sans cause, au seul moment où le joueur
// cherche justement à comprendre les dégâts qu'il vient d'infliger.
//
// ⚠️ Ce que ce filet vérifie n'est PAS « le bonus vaut 1,5 » (`GameState` le
// couvre déjà) mais que le chiffre annoncé est bien une DÉCOMPOSITION du
// multiplicateur appliqué : `base + bonus === multiplicateur`. C'est cette
// égalité que l'écran fait lire, et c'est elle qu'une quatrième source de bonus
// câblée sans passer par ici casserait — le récapitulatif annoncerait alors une
// somme qui ne fait pas son total.
import { describe, it, expect } from 'vitest';
import { GameSession } from '../logic/GameSession.js';
import { makeCard } from './helpers.js';

const RAGE = 'ARCH_RAGE';

/** Le geste exact d'ARCH_017 : +1,5 au multiplicateur, en fin de combat. */
const rageDeVaincre = {
  id: RAGE, name: 'Rage de Vaincre', categorie: 'Archetype', timing: 'end_of_combat',
  thresholds: [{ count: 1, effects: [{ type: 'damage_multiplier_bonus', value: 1.5 }] }],
};

function session(playerAttrs: string[][]): GameSession {
  const playerCards = playerAttrs.map((attributes, i) =>
    makeCard({ id: `P${i}`, tier: 1, summon_conditions: [], attributes }));
  const enemyCards = [makeCard({ id: 'E0', tier: 1, summon_conditions: [], attributes: [] })];
  const byId = new Map([...playerCards, ...enemyCards].map(c => [c.id, c]));
  return new GameSession({
    cardsByTier: { 1: playerCards as any },
    enemyDeck: { 1: enemyCards.map(c => c.id) },
    attributeList: [rageDeVaincre],
    cardDb: { getCard: (id: string) => (byId.get(id) as any) ?? null },
    getAllBoards: () => [],
    getAllMagies: () => [],
    mode: 'ai',
    rand: () => 0.5,
  } as any);
}

/** Un round joué jusqu'à son résultat, sans passer par la boucle de combat :
 *  `finishCombat` retombe alors sur `draw`, où les DEUX camps encaissent — donc
 *  les deux multiplicateurs sont renseignés.
 *
 *  ⚠️ Les unités sont POSÉES : un palier d'attribut compte des porteurs, et une
 *  main pleine sur un plateau vide n'en a aucun. */
function round(attrs: string[][], magieBonus = 0) {
  const s = session(attrs);
  // Le pendant PERMANENT du bonus d'attribut : ce qu'une magie
  // `damage_multiplier_bonus` a laissé sur la partie.
  (s.gameState as any).player_damage_multiplier_bonus = magieBonus;
  s.startPreparation();
  for (let i = 0; i < attrs.length; i++) {
    const idx = s.hand.findIndex((c: any) => c.id === `P${i}`);
    if (idx !== -1) s.place(s.hand[idx], { col: i, row: 0 }, [], idx);
  }
  s.startCombat();
  return s.finishCombat();
}

describe('Récapitulatif de round — le bonus de multiplicateur', () => {
  it('vaut 0 quand rien ne l\'augmente', () => {
    const r = round([[], []]);
    expect(r.playerMultiplierBonus).toBe(0);
    expect(r.enemyMultiplierBonus).toBe(0);
  });

  // ⚠️ Le filet des deux sens : sans le bonus, le camp ennemi reste à 0 — c'est
  // ce qui prouve que la valeur vient bien de l'attribut et non du round.
  it('reprend le bonus de l\'attribut, et le camp qui ne le porte pas reste à 0', () => {
    const r = round([[RAGE], [RAGE]]);
    expect(r.playerMultiplierBonus).toBeCloseTo(1.5, 6);
    expect(r.enemyMultiplierBonus).toBe(0);
  });

  // ⚠️ L'INVARIANT que l'écran fait lire : « base + bonus » doit se relire comme
  // le facteur appliqué, quel que soit le NOMBRE de sources. Le round porte ici
  // les DEUX : l'attribut (ce round) et le bonus permanent d'une magie.
  //
  // Mutation : reprendre le bonus d'une source nommée
  // (`attributeResult.damage_multiplier_bonus`) au lieu de le soustraire au
  // multiplicateur de base → ROUGE, la part de la magie manque au total.
  it('base + bonus est EXACTEMENT le multiplicateur appliqué, TOUTES sources comprises', () => {
    const r = round([[RAGE], [RAGE]], 0.5);
    const base = r.playerMultiplier - r.playerMultiplierBonus;
    expect(r.playerMultiplierBonus).toBeCloseTo(1.5 + 0.5, 6);
    expect(base).toBeGreaterThan(0);
    expect(base + r.playerMultiplierBonus).toBeCloseTo(r.playerMultiplier, 6);
    expect(r.playerDamageDealt).toBe(Math.round(r.playerSurvivorsAtk * r.playerMultiplier));
  });
});
