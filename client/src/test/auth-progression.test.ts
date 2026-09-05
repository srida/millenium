// Golden test de `authStore.applyProgression` — l'IDENTITÉ de `user`.
//
// Le bug qu'il verrouille, mesuré sur le menu principal : les quatre boutons
// (Missions, Boutique, Cadeaux, Arcade) rechargent leur instantané au montage
// (`useEffect(..., [userId, load])`), et trois de ces quatre routes portent un
// bloc `progression` que `applyProgression` réapplique. Tant qu'il réécrivait
// `user` avec un OBJET NEUF même sans le moindre changement de valeur, chaque
// réponse relançait les effets qui l'avaient déclenchée : quatre requêtes par
// tour, sans fin, à la seule ouverture de l'accueil.
//
// La règle éprouvée ici est plus générale que ce symptôme : une valeur
// inchangée ne produit pas d'état neuf. C'est ce qui autorise le reste du
// client à dépendre de l'identité de `user`.
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../data/AuthClient.js', () => ({
  me: vi.fn(), getUser: () => null, isLoggedIn: () => false, isReady: () => true,
  logout: vi.fn(), claimReward: vi.fn(), claimLevels: vi.fn(),
  pullDecks: vi.fn(), pushDecks: vi.fn(),
}));

const { useAuthStore } = await import('../stores/authStore.js');

const PROG = { level: 3, xp: 40, gold: 500, gems: 20, pending_levels: 0 };

beforeEach(() => {
  useAuthStore.setState({
    user: { id: 'u1', username: 'Testeur', ...PROG },
    levelToasts: [],
  });
});

describe('applyProgression', () => {
  it('ne réécrit pas `user` sur une progression identique', () => {
    const before = useAuthStore.getState().user;
    useAuthStore.getState().applyProgression({ ...PROG });
    expect(useAuthStore.getState().user).toBe(before);
  });

  it('ne notifie aucun abonné sur une progression identique — la boucle du menu', () => {
    // Reproduction fidèle du cycle : un abonné qui recharge son instantané dès
    // que `user` change, comme le fait l'effet de chaque bouton du menu. Sur le
    // code d'avant, il se rappelait lui-même indéfiniment ; le plafond n'est là
    // que pour que le test finisse.
    let reloads = 0;
    const unsub = useAuthStore.subscribe(() => {
      if (reloads++ < 50) useAuthStore.getState().applyProgression({ ...PROG });
    });
    useAuthStore.getState().applyProgression({ ...PROG });
    unsub();
    expect(reloads).toBe(0);
  });

  it('applique et annonce un vrai changement', () => {
    useAuthStore.getState().applyProgression({ ...PROG, level: 5, xp: 10, gold: 600 });
    const user = useAuthStore.getState().user!;
    expect(user.level).toBe(5);
    expect(user.gold).toBe(600);
    // Deux niveaux franchis (3 → 5) = deux toasts, un par palier.
    expect(useAuthStore.getState().levelToasts.map(t => t.level)).toEqual([4, 5]);
  });

  it('garde `pending_levels` quand le serveur ne le dit pas', () => {
    useAuthStore.setState({ user: { id: 'u1', username: 'Testeur', ...PROG, pending_levels: 2 } });
    const before = useAuthStore.getState().user;
    useAuthStore.getState().applyProgression({ level: 3, xp: 40, gold: 500, gems: 20 });
    // Rien n'a changé : ni valeur, ni objet.
    expect(useAuthStore.getState().user).toBe(before);
    expect(useAuthStore.getState().user!.pending_levels).toBe(2);
  });
});
