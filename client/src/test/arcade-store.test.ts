/* eslint-disable @typescript-eslint/no-explicit-any */
// Golden tests de `stores/arcadeStore` — la DÉSYNCHRO front/back du mode Arcade.
//
// Le reste de la suite éprouve les règles serveur (`arcade.test.ts`) ; ici c'est
// l'ORDRE D'ARRIVÉE des réponses qui est l'objet du test, et il ne se voit que
// côté client. Le bug qu'ils verrouillent :
//
//   sortir d'un duel gagné rapporte le résultat (POST) puis navigue vers
//   l'écran Arcade, qui recharge l'instantané (GET). Les deux requêtes se
//   croisent ; une lecture partie AVANT le commit du rapport rapporte la run
//   d'avant le duel. Si elle s'applique en dernier, la victoire disparaît de
//   l'écran, le joueur rejoue le duel — et son second rapport est refusé (409),
//   le serveur ayant déjà soldé le premier. C'est le score de la partie
//   PRÉCÉDENTE qui reste au tableau.
//
// Le store tourne en environnement node sans DOM (cf. vitest.config) : c'est
// possible parce qu'il ne touche ni au DOM ni au localStorage — seul `AuthClient`
// est mocké, et l'utilisateur est posé à la main (une lecture en invité est un
// no-op par construction).
import { describe, it, expect, beforeEach, vi } from 'vitest';

// --- Mock du client HTTP ---------------------------------------------------
// Trois appels seulement sortent du store ; le reste du module est stubé parce
// que `authStore` / `DeckRepository` l'importent aussi, jamais au chargement.
const calls = {
  getArcade: vi.fn(),
  startArcade: vi.fn(),
  reportArcadeDuel: vi.fn(),
};

vi.mock('../data/AuthClient.js', () => ({
  ...calls,
  me: vi.fn(), getUser: () => null, isLoggedIn: () => false, isReady: () => true,
  logout: vi.fn(), claimReward: vi.fn(), pullDecks: vi.fn(), pushDecks: vi.fn(),
}));

const { useArcadeStore } = await import('../stores/arcadeStore.js');
const { useAuthStore } = await import('../stores/authStore.js');

// --- Fabriques d'instantanés ----------------------------------------------

function duel(index: number, result: 'win' | 'loss' | null) {
  return {
    index,
    deck_id: `PUBLIC_DECK_00${index + 1}`,
    deck_name: `Adversaire ${index + 1}`,
    difficulty: index + 1,
    bonus: { hp: index * 10, atk: index },
    deck: { 1: ['CORE_001'], 2: [], 3: [], 4: [], 5: [] },
    result,
  };
}

/** Instantané serveur d'une run dont les `won` premiers duels sont gagnés. */
function snapshot(won: number, status: 'in_progress' | 'won' | 'lost' = 'in_progress') {
  return {
    day: '2026-08-18',
    next_rotation_at: Date.now() + 3_600_000,
    plan: [0, 1, 2, 3].map(i => ({ index: i, difficulty: i + 1, bonus: { hp: i * 10, atk: i } })),
    reward: { xp: 50, gold: 200 },
    duel_count: 4,
    run: {
      day: '2026-08-18',
      generated_at: Date.now(),
      deck_name: 'Mon deck',
      current: won,
      status,
      rewarded: status === 'won',
      duels: [0, 1, 2, 3].map(i => duel(i, i < won ? 'win' : null)),
    },
    progression: { level: 3, xp: 40, gold: 500, gems: 20 },
  };
}

/** Promesse dont le test décide du moment de résolution. */
function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: any) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

const flush = () => new Promise(r => setTimeout(r, 0));

const run = () => useArcadeStore.getState().snapshot?.run ?? null;

beforeEach(async () => {
  vi.clearAllMocks();
  useArcadeStore.getState().reset();
  // La lecture est un no-op en invité : l'Arcade a besoin d'un compte.
  useAuthStore.setState({ user: { id: 'u1', username: 'joueur', level: 3, xp: 40, gold: 500, gems: 20 } as any });
  // État de départ commun : run lancée, aucun duel soldé.
  calls.getArcade.mockResolvedValue(snapshot(0));
  await useArcadeStore.getState().load(true);
  expect(run()?.current).toBe(0);
});

describe('arcadeStore — rapport de duel et relecture concurrente', () => {
  it('un rapport gagnant fait avancer la run', async () => {
    calls.reportArcadeDuel.mockResolvedValue(snapshot(1));
    expect(await useArcadeStore.getState().reportDuel('win')).toBeNull();
    expect(calls.reportArcadeDuel).toHaveBeenCalledWith({ index: 0, result: 'win' });
    expect(run()?.current).toBe(1);
    expect(run()?.duels[0].result).toBe('win');
  });

  // LE bug. Une lecture partie avant le commit du rapport revient en dernier
  // avec la run d'AVANT le duel : elle ne doit pas écraser la victoire.
  it('une lecture PÉRIMÉE qui revient après le rapport ne l\'écrase pas', async () => {
    const post = deferred<any>();
    const get = deferred<any>();
    calls.reportArcadeDuel.mockReturnValue(post.promise);
    calls.getArcade.mockReturnValue(get.promise);

    const reported = useArcadeStore.getState().reportDuel('win');
    const reloaded = useArcadeStore.getState().load(true);   // le GET de l'écran Arcade

    post.resolve(snapshot(1));      // le serveur a soldé le duel…
    await flush();
    get.resolve(snapshot(0));       // …mais la lecture était partie avant
    await Promise.all([reported, reloaded]);

    expect(run()?.current).toBe(1);
    expect(run()?.duels[0].result).toBe('win');
  });

  it('une lecture qui revient AVANT le rapport ne le masque pas non plus', async () => {
    const post = deferred<any>();
    const get = deferred<any>();
    calls.reportArcadeDuel.mockReturnValue(post.promise);
    calls.getArcade.mockReturnValue(get.promise);

    const reported = useArcadeStore.getState().reportDuel('win');
    const reloaded = useArcadeStore.getState().load(true);

    get.resolve(snapshot(0));
    await flush();
    post.resolve(snapshot(1));
    await Promise.all([reported, reloaded]);

    expect(run()?.current).toBe(1);
  });

  // Le corollaire : une lecture qui n'a AUCUNE mutation devant elle s'applique
  // normalement, sinon l'écran ne se rafraîchirait plus jamais.
  it('une lecture sans mutation concurrente s\'applique', async () => {
    calls.getArcade.mockResolvedValue(snapshot(2));
    await useArcadeStore.getState().load(true);
    expect(run()?.current).toBe(2);
  });

  it('une lecture postérieure à un rapport s\'applique aussi', async () => {
    calls.reportArcadeDuel.mockResolvedValue(snapshot(1));
    await useArcadeStore.getState().reportDuel('win');
    calls.getArcade.mockResolvedValue(snapshot(2));
    await useArcadeStore.getState().load(true);
    expect(run()?.current).toBe(2);
  });
});

describe('arcadeStore — rapport refusé ou perdu', () => {
  // 409 : le serveur a déjà soldé ce duel (rapport rejoué, second onglet). Son
  // état fait foi — on le relit, et ce n'est PAS un rapport perdu.
  it('un 409 relit l\'état serveur sans crier au rapport perdu', async () => {
    const stale: any = new Error('Ce duel n\'est plus celui en cours.');
    stale.status = 409;
    calls.reportArcadeDuel.mockRejectedValue(stale);
    calls.getArcade.mockResolvedValue(snapshot(1));

    const message = await useArcadeStore.getState().reportDuel('win');
    await flush();

    expect(message).toContain('plus celui en cours');
    expect(useArcadeStore.getState().reportError).toBeNull();
    expect(run()?.current).toBe(1);            // l'état serveur a bien été relu
  });

  // Réseau coupé : le duel n'a pas été soldé (ou sa réponse s'est perdue). On le
  // DIT — sans quoi le joueur retrouve son duel « à jouer » sans explication.
  it('une coupure réseau laisse une trace visible', async () => {
    const offline: any = new Error('Serveur injoignable — vérifie ta connexion.');
    offline.network = true;
    calls.reportArcadeDuel.mockRejectedValue(offline);

    const message = await useArcadeStore.getState().reportDuel('win');
    expect(message).toContain('injoignable');
    expect(useArcadeStore.getState().reportError).toContain('injoignable');

    // Une relecture d'écran ne doit pas effacer ce mot (elle remet `error` à
    // zéro, pas `reportError`) : le joueur arrive sur l'écran APRÈS l'échec.
    calls.getArcade.mockResolvedValue(snapshot(0));
    await useArcadeStore.getState().load(true);
    expect(useArcadeStore.getState().reportError).toContain('injoignable');

    // Il s'efface au rapport suivant, et au lancement d'une nouvelle run.
    calls.reportArcadeDuel.mockResolvedValue(snapshot(1));
    await useArcadeStore.getState().reportDuel('win');
    expect(useArcadeStore.getState().reportError).toBeNull();
  });

  it('aucun rapport n\'est envoyé sur une run déjà terminée', async () => {
    calls.getArcade.mockResolvedValue(snapshot(4, 'won'));
    await useArcadeStore.getState().load(true);
    expect(await useArcadeStore.getState().reportDuel('win')).toBeNull();
    expect(calls.reportArcadeDuel).not.toHaveBeenCalled();
  });
});
