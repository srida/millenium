// Le LOCKSTEP des ordres de ciblage en duel en ligne.
//
// Les deux clients simulent le combat chacun de leur côté, à la même cadence
// mais sans horloge commune : ils ne sont jamais exactement au même tick. Un
// ordre donné au tick `s` s'applique donc au tick `s + ORDER_DELAY_TICKS` CHEZ
// LES DEUX, et chaque client s'engage, après chaque tick joué, à ne plus rien
// ordonner avant `s + délai` : c'est sa FRONTIÈRE. Un client ne joue jamais un
// tick que la frontière adverse ne couvre pas — il attend, ce qui est invisible
// tant que les deux avancent ensemble.
//
// ⚠️ Un ordre part AVANT que son émetteur ne joue le tick suivant, et la socket
// préserve l'ordre des messages : l'adversaire le reçoit donc toujours avant
// d'avoir pu atteindre son tick (sa frontière précédente était au plus
// `s + délai − 1`). `CombatManager.addOrder` refuserait sinon un tick passé.
//
// Module pur : ni réseau, ni horloge. `PvpController` le branche.

export interface WireOrder { tick: number; unitRef: number; targetRef: number; seq: number }
export interface OrdersMessage { round: number; upTo: number; orders: WireOrder[] }

interface OrderSink {
  addOrder(order: { tick: number; side: 'player' | 'enemy'; unitRef: number; targetRef: number; seq: number }): boolean;
}

/** Un message de frontière tous les N ticks joués (≈ 0,18 s à la cadence ×2). */
export const ORDERS_SEND_EVERY = 2;

export class OrderLockstep {
  /** Dernier tick que l'adversaire s'est engagé à ne plus modifier. */
  private _frontier = 0;
  /** Un ordre adverse rejeté (tick passé) : la simulation a divergé. */
  rejected = 0;

  constructor(
    readonly round: number,
    private readonly delay: number,
    private readonly sink: OrderSink,
  ) {}

  /** Le message à envoyer pour un ordre local, donné après le tick `current`. */
  localOrder(current: number, order: WireOrder): OrdersMessage {
    return this._message(current, [order]);
  }

  /** Après chaque tick joué : le message de frontière à envoyer, s'il est dû. */
  afterStep(current: number): OrdersMessage | null {
    if (current !== 0 && current % ORDERS_SEND_EVERY !== 0) return null;
    return this._message(current, []);
  }

  /** Un message de l'adversaire : ses ordres passent au moteur (`enemy`). */
  receive(msg: OrdersMessage): void {
    if (msg.round !== this.round) return;
    for (const o of msg.orders ?? []) {
      const ok = this.sink.addOrder({ tick: o.tick, side: 'enemy', unitRef: o.unitRef, targetRef: o.targetRef, seq: o.seq });
      if (!ok) this.rejected++;
    }
    if (Number.isInteger(msg.upTo) && msg.upTo > this._frontier) this._frontier = msg.upTo;
  }

  /** Peut-on jouer le tick `next` ? */
  canStep(next: number): boolean {
    return next <= this._frontier;
  }

  get frontier(): number { return this._frontier; }

  private _message(current: number, orders: WireOrder[]): OrdersMessage {
    const upTo = current + this.delay - 1;
    return { round: this.round, upTo, orders };
  }
}
