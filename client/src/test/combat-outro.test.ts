/* eslint-disable @typescript-eslint/no-explicit-any */
// Les trois passages de phase — le versant qui ne se voit ni dans `logic/` (qui
// les ignore) ni dans un test de composant (la suite tourne en node SANS DOM).
//
// Ce qui est verrouillé ici :
//   · la frappe finale RETIENT le récapitulatif, et le libère une seule fois ;
//   · `combatActive` reste vrai pendant qu'elle dure — sans quoi main, cimetière
//     et synergies réapparaissent une seconde et demie avant la popup ;
//   · le plateau n'est rangé qu'à la SORTIE de l'outro ;
//   · les deux volets de phase, eux, ne retiennent RIEN ;
//   · une partie soldée pendant l'outro n'y gagne pas un récapitulatif de round
//     par-dessus son écran de fin.
//
// Harnais de `board-alert.test.ts` : `window` posé à la main, contrôleur SANS
// scène (tous les appels y sont en `?.`).
//
// ⚠️ Éprouvés dans les deux sens : la mutation attendue est nommée par cas.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { GameSession } from '../logic/GameSession.js';
import type { GameSessionDeps } from '../logic/GameSession.js';
import { makeCard } from './helpers.js';

(globalThis as any).window = { location: { search: '' }, addEventListener() {}, removeEventListener() {} };
(globalThis as any).requestAnimationFrame = () => 0;
(globalThis as any).cancelAnimationFrame = () => {};

vi.mock('../data/AuthClient.js', () => ({
  me: vi.fn(), getUser: () => null, isLoggedIn: () => false, isReady: () => true,
  logout: vi.fn(), claimReward: vi.fn(), pullDecks: vi.fn(), pushDecks: vi.fn(),
  sendMissionEvents: vi.fn(),
}));

const { GameController } = await import('../game/GameController.js');
const { useGameStore } = await import('../stores/gameStore.js');
const { COMBAT_OUTRO_MS, COMBAT_INTRO_MS, SHOPPING_INTRO_MS } = await import('../game/timings.js');

/** Une magie TOUJOURS pertinente (`draw_bonus` n'a aucune condition d'état) :
 *  sans elle, l'offre sort vide et la Phase Shopping est SAUTÉE — il n'y a
 *  alors pas de passage à annoncer. */
const MAGIE = { id: 'MAGIC_TEST', name: 'Pioche', rarity: 1, effect: { type: 'draw_bonus', value: 1 } };

function makeController(opts: { magies?: any[] } = {}) {
  const cards = [0, 1].map(i => makeCard({ id: `P${i}`, summon_conditions: [], attributes: [] }));
  const byId = new Map(cards.map(c => [c.id, c]));
  const deps: GameSessionDeps = {
    cardsByTier: { 1: cards as any },
    enemyDeck: { 1: [] },
    attributeList: [],
    cardDb: { getCard: (id: string) => (byId.get(id) as any) ?? null },
    getAllBoards: () => [],
    getAllMagies: () => (opts.magies ?? []) as any,
  };
  const session = new GameSession(deps);
  const controller = new (GameController as any)(session);
  return { session, controller };
}

/** Pose une unité, lance le combat, puis le clôt — sans jouer un seul tick :
 *  ce qu'on éprouve est ce qui se passe APRÈS le dernier, pas le combat.
 *
 *  ⚠️ L'animateur est ARRÊTÉ avant la clôture : sans ça, il reste des steps en
 *  file et l'avance des minuteurs du test rejouerait un combat déjà soldé —
 *  ces cas parleraient alors de ce qui les retient, pas de la frappe finale. */
function playToEndOfCombat() {
  const { session, controller } = makeController();
  session.startPreparation();
  session.place(session.hand[0], { col: 0, row: 0 }, [], 0);
  controller.startCombat();
  controller.animator?.stop();
  controller._onCombatFinished();
  return { session, controller };
}

beforeEach(() => {
  vi.useRealTimers();
  useGameStore.getState().reset();
});

describe('Frappe finale — ce qu\'elle retient', () => {
  // ⚠️ L'INVARIANT du lot. Mutation : `endRound` publié dans `_onCombatFinished`
  // comme avant → ROUGE (la popup serait là dès le premier instantané).
  it('le récapitulatif n\'arrive QU\'APRÈS la frappe finale', () => {
    vi.useFakeTimers();
    const { controller } = playToEndOfCombat();

    const during = useGameStore.getState();
    expect(during.combatOutro).not.toBeNull();
    expect(during.endRound).toBeNull();

    vi.advanceTimersByTime(COMBAT_OUTRO_MS);
    const after = useGameStore.getState();
    expect(after.combatOutro).toBeNull();
    expect(after.endRound).not.toBeNull();
    controller.dispose();
  });

  // ⚠️ L'outro est la QUEUE du combat, pas une phase de plus : main, cimetière
  // et panneau de synergies se masquent sur `combatActive`.
  // Mutation : `combatActive: false` publié dès `_onCombatFinished` → ROUGE.
  it('le HUD reste en combat tant que la frappe dure', () => {
    vi.useFakeTimers();
    const { controller } = playToEndOfCombat();

    expect(useGameStore.getState().combatActive).toBe(true);
    vi.advanceTimersByTime(COMBAT_OUTRO_MS);
    expect(useGameStore.getState().combatActive).toBe(false);
    controller.dispose();
  });

  // ⚠️ `exitCombatMode` ramène la caméra au cadrage de préparation ET rappelle
  // `refresh()`, qui repose les survivants sur leur `initial_position` : le
  // faire pendant l'outro ferait reculer les unités pendant qu'elles s'élancent.
  // Mutation : rangement remis dans `_onCombatFinished` → ROUGE.
  it('le plateau n\'est rangé qu\'à la SORTIE de la frappe', () => {
    vi.useFakeTimers();
    const { controller } = playToEndOfCombat();
    const scene = { exitCombatMode: vi.fn(), setBlockedCells: vi.fn(), setTerrainBackground: vi.fn() };
    controller.scene = scene;

    expect(scene.exitCombatMode).not.toHaveBeenCalled();
    vi.advanceTimersByTime(COMBAT_OUTRO_MS);
    expect(scene.exitCombatMode).toHaveBeenCalledTimes(1);
    controller.dispose();
  });

  // Mutation : `_pendingEndRound` non remis à `null` → ROUGE (trois popups).
  it('le tap livre le récapitulatif tout de suite, et une seule fois', () => {
    vi.useFakeTimers();
    const { controller } = playToEndOfCombat();
    const scene = { exitCombatMode: vi.fn(), setBlockedCells: vi.fn(), setTerrainBackground: vi.fn() };
    controller.scene = scene;

    controller.skipCombatOutro();
    controller.skipCombatOutro();
    controller.skipCombatOutro();

    expect(useGameStore.getState().endRound).not.toBeNull();
    expect(scene.exitCombatMode).toHaveBeenCalledTimes(1);

    // Le minuteur d'origine ne doit plus rien publier derrière le tap.
    const settled = useGameStore.getState().endRound;
    vi.advanceTimersByTime(COMBAT_OUTRO_MS * 2);
    expect(useGameStore.getState().endRound).toBe(settled);
    controller.dispose();
  });

  // ⚠️ La partie peut se solder PENDANT l'outro : le menu ☰ reste atteignable
  // sous la barre de combat, et en duel c'est le serveur qui tranche.
  // Mutation : garde `gameOver` retirée → ROUGE (un récapitulatif de round
  // s'affiche par-dessus l'écran de fin de partie).
  it('une partie soldée pendant la frappe n\'ouvre AUCUN récapitulatif', () => {
    vi.useFakeTimers();
    const { controller } = playToEndOfCombat();
    useGameStore.getState().applySnapshot({ gameOver: true, winner: 'enemy' });

    vi.advanceTimersByTime(COMBAT_OUTRO_MS);
    const snap = useGameStore.getState();
    expect(snap.endRound).toBeNull();
    expect(snap.combatOutro).toBeNull();
    expect(snap.combatActive).toBe(false);
    controller.dispose();
  });

  // Mutation : `_outroTimer` non annulé dans `dispose()` → ROUGE.
  it('une partie quittée en pleine frappe ne publie plus rien', () => {
    vi.useFakeTimers();
    const { controller } = playToEndOfCombat();

    controller.dispose();
    useGameStore.getState().reset();
    vi.advanceTimersByTime(COMBAT_OUTRO_MS * 2);
    expect(useGameStore.getState().endRound).toBeNull();
  });

  // Les montants sont ceux DÉJÀ appliqués — l'outro donne à voir ce qui fait
  // descendre les barres, il ne l'invente pas.
  it('les dégâts annoncés sont ceux du récapitulatif qui suit', () => {
    vi.useFakeTimers();
    const { controller } = playToEndOfCombat();

    const outro = useGameStore.getState().combatOutro!;
    vi.advanceTimersByTime(COMBAT_OUTRO_MS);
    const result = useGameStore.getState().endRound!;

    expect(outro.playerDamage).toBe(result.playerDamageDealt);
    expect(outro.enemyDamage).toBe(result.enemyDamageDealt);
    expect(outro.winner).toBe(result.winner);
    controller.dispose();
  });
});

describe('Volets de phase — ce qu\'ils ne retiennent pas', () => {
  // ⚠️ L'offre n'a rien à révéler avant l'échéance du volet : la popup de
  // Shopping ne doit apparaître qu'une fois les dés posés, jamais dessous
  // pendant qu'ils roulent.
  // Mutation : offre publiée en même temps que le volet → ROUGE (elle
  // apparaîtrait sous les dés dès l'ouverture).
  it('le passage en Shopping ne publie l\'offre qu\'à l\'ÉCHÉANCE du volet', () => {
    vi.useFakeTimers();
    const { session, controller } = makeController({ magies: [MAGIE] });
    session.startPreparation();
    controller._startShopping();

    // Le volet est posé tout de suite, mais l'offre reste tue — rien à
    // découvrir avant la fin.
    const snap = useGameStore.getState();
    expect(snap.phaseWipe).toEqual({ kind: 'shopping' });
    expect(snap.shopping).toBeNull();

    vi.advanceTimersByTime(SHOPPING_INTRO_MS);
    // Le volet se retire et l'offre apparaît dans le MÊME instantané.
    const after = useGameStore.getState();
    expect(after.phaseWipe).toBeNull();
    expect(after.shopping?.magies.length).toBeGreaterThan(0);
    controller.dispose();
  });

  // ⚠️ Une offre VIDE saute la Phase Shopping (`_startShopping` enchaîne sur le
  // tour suivant) : il n'y a alors aucun passage à annoncer.
  // Mutation : volet posé avant la garde de l'offre vide → ROUGE.
  it('une Phase Shopping SAUTÉE n\'annonce rien', () => {
    vi.useFakeTimers();
    const { session, controller } = makeController();   // aucun catalogue de magies
    session.startPreparation();
    controller._startShopping();

    expect(useGameStore.getState().shopping).toBeNull();
    expect(useGameStore.getState().phaseWipe).toBeNull();
    controller.dispose();
  });

  // Mutation : volet posé sans minuteur → ROUGE (il resterait à l'écran).
  it('le passage en combat pose son volet et le retire seul', () => {
    vi.useFakeTimers();
    const { session, controller } = makeController();
    session.startPreparation();
    session.place(session.hand[0], { col: 0, row: 0 }, [], 0);
    controller.startCombat();

    expect(useGameStore.getState().phaseWipe).toEqual({ kind: 'combat' });
    vi.advanceTimersByTime(COMBAT_INTRO_MS);
    expect(useGameStore.getState().phaseWipe).toBeNull();
    controller.dispose();
  });

  // ⚠️ Un volet qui recouvre le plateau pendant que les premiers coups partent
  // les escamote : il rejoint le `holdMs` existant.
  // Mutation : `COMBAT_INTRO_MS` retiré du `Math.max` → ROUGE.
  it('le premier coup attend la fin du volet', () => {
    vi.useFakeTimers();
    const { session, controller } = makeController();
    session.startPreparation();
    session.place(session.hand[0], { col: 0, row: 0 }, [], 0);
    controller.startCombat();

    // Sans terrain ni cascade d'IA, le volet est la SEULE chose qui retienne.
    expect((controller as any).animator._running).toBeFalsy();
    vi.advanceTimersByTime(COMBAT_INTRO_MS);
    expect((controller as any).animator._running).toBe(true);
    controller.dispose();
  });

  // Mutation : `_wipeTimer` non annulé dans `dispose()` → ROUGE.
  it('une partie quittée sous le volet ne republie plus rien', () => {
    vi.useFakeTimers();
    const { session, controller } = makeController();
    session.startPreparation();
    session.place(session.hand[0], { col: 0, row: 0 }, [], 0);
    controller.startCombat();

    controller.dispose();
    useGameStore.getState().reset();
    vi.advanceTimersByTime(COMBAT_INTRO_MS * 2);
    expect(useGameStore.getState().phaseWipe).toBeNull();
  });
});
