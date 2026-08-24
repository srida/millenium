/* eslint-disable @typescript-eslint/no-explicit-any */
// PvpConnection — cycle de vie de la socket du Duel en ligne.
//
// Ce que ces tests verrouillent ne se voit nulle part quand ça casse : une
// socket morte qui parle au nom de celle qui la remplace, ou un rapport de fin
// de match avalé sans un mot. Les deux se manifestent chez le joueur comme
// « une erreur de connexion pendant un duel qui allait très bien », ou comme un
// écran d'attente dont on ne sort plus.
//
// ⚠️ La suite tourne en node sans DOM : `WebSocket` et `location` sont posés à
// la main, et le module est réimporté à chaque test (il est SINGLETON — son
// état de socket survivrait d'un cas à l'autre).
import { describe, it, expect, beforeEach, vi } from 'vitest';

class FakeSocket {
  static CONNECTING = 0; static OPEN = 1; static CLOSING = 2; static CLOSED = 3;
  readyState = 0;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  constructor() { sockets.push(this); }
  send(data: string) { this.sent.push(data); }
  close() { this.readyState = FakeSocket.CLOSED; this.onclose?.(); }
  open() { this.readyState = FakeSocket.OPEN; this.onopen?.(); }
  /** Coupure subie : `ws` émet toujours `close`, précédé d'`error` si l'ouverture a échoué. */
  die({ errored = false } = {}) {
    this.readyState = FakeSocket.CLOSED;
    if (errored) this.onerror?.();
    this.onclose?.();
  }
  deliver(msg: unknown) { this.onmessage?.({ data: JSON.stringify(msg) }); }
}

let sockets: FakeSocket[] = [];

async function loadModule() {
  sockets = [];
  (globalThis as any).location = { protocol: 'http:', host: 'millenium.test' };
  (globalThis as any).WebSocket = FakeSocket;
  vi.resetModules();
  return import('../net/PvpConnection.js');
}

/** Ouvre une socket saine et rend le module + la socket. */
async function connected() {
  const C: any = await loadModule();
  const p = C.connect();
  sockets[sockets.length - 1].open();
  await p;
  return { C, sock: sockets[sockets.length - 1] };
}

beforeEach(() => { vi.useRealTimers(); });

describe('PvpConnection — coupure et reconnexion', () => {
  // LE bug d'origine : une coupure survenue sans auditeur était mise en tampon
  // et REJOUÉE au premier abonné venu — c'est-à-dire au `begin()` du duel
  // suivant. Le joueur ouvrait un duel parfaitement sain sur « Connexion
  // perdue », bannière que rien n'effaçait ensuite.
  it('ne rejoue pas la coupure d\'une socket morte sur celle qui la remplace', async () => {
    const C: any = await loadModule();

    // 1) La première tentative échoue (serveur qui redémarre, réseau capricieux).
    C.connect().catch(() => {});
    sockets[0].die({ errored: true });

    // 2) « Réessayer » : une socket neuve, qui s'ouvre.
    const p = C.connect();
    expect(sockets).toHaveLength(2);
    sockets[1].open();
    await p;

    // 3) Le duel démarre et s'abonne (BotController.begin / PvpController.begin).
    const seen: string[] = [];
    C.on('_socket_closed', () => seen.push('closed'));

    expect(seen).toEqual([]);
    expect(C.isConnected()).toBe(true);
  });

  it('signale bien la coupure quand elle arrive PENDANT le duel', async () => {
    const { C, sock } = await connected();
    const seen: string[] = [];
    C.on('_socket_closed', () => seen.push('closed'));

    sock.die();

    expect(seen).toEqual(['closed']);
    expect(C.isConnected()).toBe(false);
  });

  it('la fermeture tardive d\'une socket remplacée ne parle pas au nom de la nouvelle', async () => {
    const C: any = await loadModule();
    C.connect().catch(() => {});
    const dead = sockets[0];
    dead.readyState = FakeSocket.CLOSED;

    const p = C.connect();
    sockets[1].open();
    await p;

    const seen: string[] = [];
    C.on('_socket_closed', () => seen.push('closed'));

    // La socket abandonnée livre son `close` en retard.
    dead.onclose?.();

    expect(seen).toEqual([]);
  });

  it('un message livré par une socket abandonnée est ignoré', async () => {
    const C: any = await loadModule();
    C.connect().catch(() => {});
    const dead = sockets[0];
    dead.readyState = FakeSocket.CLOSED;
    const p = C.connect();
    sockets[1].open();
    await p;

    const found: any[] = [];
    C.on('match:found', (m: any) => found.push(m));
    dead.deliver({ type: 'match:found', matchId: 'zombie', youAre: 'A' });

    expect(found).toEqual([]);
    expect(C.getRole()).toBe(null);
  });

  // Le tampon garde sa raison d'être : le serveur peut relayer un message de
  // round avant que le contrôleur n'ait atteint son `on()`.
  it('garde en tampon un message de match reçu avant son abonné', async () => {
    const { C, sock } = await connected();
    sock.deliver({ type: 'round:opponent_board', round: 2 });

    const seen: any[] = [];
    C.on('round:opponent_board', (m: any) => seen.push(m));

    expect(seen).toHaveLength(1);
    expect(seen[0].round).toBe(2);
  });
});

describe('PvpConnection — envoi', () => {
  // Le rapport de fin de match est le SEUL lien entre un duel contre bot et la
  // caisse du serveur. Avalé sans un mot, il laissait le joueur derrière
  // « En attente de l'adversaire… » pour toujours (cf. BotController).
  it('dit quand le message n\'est pas parti', async () => {
    const { C, sock } = await connected();
    sock.deliver({ type: 'match:found', matchId: 'M1', youAre: 'A', opponent: {}, bot: { deck: {} } });

    expect(C.send('match:report_result', { localWinner: 'player' })).toBe(true);
    expect(JSON.parse(sock.sent.at(-1) as string)).toMatchObject({ type: 'match:report_result', matchId: 'M1' });

    sock.die();
    expect(C.send('match:report_result', { localWinner: 'player' })).toBe(false);
  });

  it('bat le cœur côté client tant que la socket vit', async () => {
    vi.useFakeTimers();
    const C: any = await loadModule();
    const p = C.connect();
    sockets[0].open();
    await p;

    // Un duel contre bot n'écrit RIEN de lui-même : sans ce battement, la
    // socket reste muette pendant toute la partie côté client → montant.
    vi.advanceTimersByTime(26_000);
    expect(sockets[0].sent.map(s => JSON.parse(s).type)).toEqual(['ping']);

    sockets[0].die();
    vi.advanceTimersByTime(60_000);
    expect(sockets[0].sent).toHaveLength(1);
    vi.useRealTimers();
  });
});
