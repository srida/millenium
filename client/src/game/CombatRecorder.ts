/* eslint-disable @typescript-eslint/no-explicit-any */
// Enregistreur de combat PvP par tick — OUTIL DE DIAGNOSTIC TEMPORAIRE.
//
// Un duel en ligne est simulé EN PARALLÈLE par les deux clients, et le combat
// ne consomme aucun hasard : les deux simulations sont censées être identiques
// au tick près. Quand elles divergent, rien dans le jeu ne permet de le voir.
// Cette classe capture la vue locale de chaque tick ; le serveur recolle les
// deux et nomme la première différence (cf. `pvplog.js`).
//
// ⚠️ Elle vit dans `game/` et PAS dans `logic/`, et ce n'est pas un détail de
// rangement : `logic/` est headless, verrouillé par des golden tests de
// déterminisme, et n'a aucune raison d'apprendre qu'un mode de jeu s'observe.
// L'enregistreur se branche sur le crochet `onStep` que `GameController`
// possédait DÉJÀ — il lit, il ne participe pas.
//
// ⚠️ Aucun import : ni React, ni Zustand, ni Three, ni `logic/`. Il ne reçoit
// que des objets.

/**
 * LA FORME CANONIQUE — c'est ce qui rend les deux vues comparables.
 *
 * Les deux clients ne voient pas le même monde : celui du rôle B est le reflet
 * de celui du rôle A (`row → 10 - row`, cf. `net/PvpOpponentProvider.mirrorRow`).
 * Un diff brut de deux vues locales ne dirait donc rien. On normalise ICI, à la
 * capture, dans le repère du rôle A : le serveur n'a plus qu'à comparer champ à
 * champ, sans savoir de quel côté il regarde.
 *
 * La transformation est une involution — la vue locale reste reconstructible.
 *
 * ⚠️ Elle ne porte PAS que sur les rangées : `'player'` / `'enemy'` sont eux
 * aussi des valeurs du repère local (cf. `winnerCanon`).
 */
// ⚠️ Recopié de `logic/BoardMirror.MIRROR_AXIS` plutôt qu'importé : ce module
// est un outil de diagnostic FAIT POUR DISPARAÎTRE d'un bloc, et son absence
// totale d'imports (ni React, ni Zustand, ni Three, ni `logic/`) est ce qui le
// rend retirable sans rien toucher d'autre.
const MIRROR_AXIS = 10;

/**
 * ⚠️ L'identité d'une unité est `owner:card_id`, JAMAIS `uid`.
 *
 * L'`uid` voyage bien dans `round:board_ready`, mais `reconstructOpponentUnits`
 * le JETTE et laisse `new Unit` en tirer un neuf d'un compteur de module : il
 * n'a aucune valeur commune aux deux clients. La règle du doublon garantit
 * qu'une `card_id` ne peut pas être vivante deux fois du même côté, donc
 * `(owner, card_id)` désigne bien une unité et une seule. C'est déjà le choix
 * de `refUnit` dans `client/src/test/helpers.ts`, et pour la même raison.
 */
export const UNIT_COLUMNS = [
  'key', 'col', 'row', 'hp', 'max_hp', 'shield', 'atk', 'initiative',
  'attack_speed_eff', 'gauge', 'attack_timer', 'move_timer',
  'paralysis', 'block', 'confusion', 'taunt', 'dots', 'burns', 'alive',
] as const;

/**
 * Plafond dur du log d'un combat.
 *
 * ⚠️ Le corps d'une requête `/api` est plafonné à 1 Mo hors routes d'upload
 * (`app.js`) : un log qui casse son POST ne vaut rien. Pire cas théorique —
 * 12 unités × 333 ticks — mesuré autour de 250 Ko, la troncature ne devrait
 * jamais servir ; elle est là pour que le cas où elle servirait se DISE
 * (`truncated: true`) au lieu de rendre un fichier silencieusement amputé.
 */
export const MAX_LOG_BYTES = 700_000;

export interface RecorderInit {
  matchId: string;
  round: number;
  role: 'A' | 'B';
}

interface TickRecord {
  t: number;
  order: string[];
  units: any[][];
  events: any[];
}

export class CombatRecorder {
  private matchId: string;
  private round: number;
  private role: 'A' | 'B';
  private otherRole: 'A' | 'B';
  private boardId: string | null = null;
  private blockedCells: { col: number; row: number }[] = [];
  private startUnits: any[][] = [];
  private ticks: TickRecord[] = [];
  private winner: string | null = null;
  private bytes = 0;
  private _truncated = false;

  constructor({ matchId, round, role }: RecorderInit) {
    this.matchId = matchId;
    this.round = round;
    this.role = role;
    this.otherRole = role === 'A' ? 'B' : 'A';
  }

  /** Row dans le repère du rôle A. Uniforme : mes unités comme celles d'en face. */
  private row(row: number): number {
    return this.role === 'B' ? MIRROR_AXIS - row : row;
  }

  private cell(c: { col: number; row: number }): { col: number; row: number } {
    return { col: c.col, row: this.row(c.row) };
  }

  private key(u: any): string {
    return `${u?.side === 'player' ? this.role : this.otherRole}:${u?.card_id}`;
  }

  /**
   * ⚠️ `'player'` / `'enemy'` sont des valeurs du REPÈRE LOCAL, exactement comme
   * une rangée — et c'est le seul champ de la forme canonique qui l'était resté.
   * Sans cette traduction, un combat parfaitement identique des deux côtés se
   * clôt sur `winner: 'enemy'` chez le perdant et `winner: 'player'` chez le
   * gagnant : le diff s'arrête là, au dernier tick, et rend « diverged ».
   *
   * Le coût n'était pas cosmétique — TOUT duel sain était rapporté comme
   * divergent, si bien que le verdict du fichier ne distinguait plus rien. Il
   * l'a d'ailleurs masqué sur ses propres logs : le round 1 du duel qui a servi
   * à écrire ceci est identique tick pour tick, et sortait quand même en rouge.
   *
   * `draw` et `timeout` ne désignent personne : ils traversent tels quels.
   */
  private winnerCanon(w: string | null | undefined): string | null {
    if (w === 'player') return this.role;
    if (w === 'enemy') return this.otherRole;
    return w ?? null;
  }

  /** Une seule fois, au lancement du combat. */
  header(combat: any, boardData: any): void {
    this.boardId = boardData?.id ?? null;
    // ⚠️ Les cases bloquées telles que vues LOCALEMENT, normalisées comme le
    // reste. C'est le champ qui tranche à lui seul le suspect n°1 : elles sont
    // appliquées verbatim des deux côtés (`GameSession.startCombat`) alors que
    // le monde du rôle B est le reflet de celui de A — un terrain dont
    // l'ensemble n'est pas invariant par le miroir fait simuler deux plateaux
    // différents, et la ligne de vue diverge dès le premier tick.
    this.blockedCells = (boardData?.blocked_cells ?? []).map((c: any) => this.cell(c));
    this.startUnits = this.snapshotUnits(combat);
  }

  /** À chaque tick, juste après `CombatManager.step()`. */
  capture(combat: any, events: any[]): void {
    if (this._truncated) return;
    const record: TickRecord = {
      t: this.tickOf(combat),
      // L'ordre d'initiative recalculé à l'identique du moteur : c'est lui qui
      // commande tout le reste du tick, et le symptôme le plus lisible d'une
      // divergence de tri ou d'ordre de tableau.
      order: this.initiativeOrder(combat),
      units: this.snapshotUnits(combat),
      // ⚠️ Copie PROFONDE à l'émission : les objets d'événement (`dot`,
      // `extra`) portent des références vivantes que les steps suivants mutent.
      // Le note explicite de `client/src/test/helpers.ts`.
      events: (events ?? []).map((e) => this.serialize(e)),
    };
    if (combat?.winner) this.winner = this.winnerCanon(combat.winner);
    this.push(record);
  }

  private push(record: TickRecord): void {
    const size = JSON.stringify(record).length;
    if (this.bytes + size > MAX_LOG_BYTES) { this._truncated = true; return; }
    this.bytes += size;
    this.ticks.push(record);
  }

  /**
   * Le numéro de tick du moteur lui-même (`CombatManager._stepCount`), et non
   * un compteur local : le log doit rester indexé sur la même horloge que le
   * combat, y compris s'il a été tronqué.
   */
  private tickOf(combat: any): number {
    return combat?._stepCount ?? this.ticks.length + 1;
  }

  /**
   * ⚠️ Recopie EXACTEMENT le tri de `CombatManager.step()` — initiative
   * décroissante, vitesse d'attaque effective décroissante, `card_id`
   * croissante. Le but n'est pas de le vérifier mais de le photographier : si
   * le tri lui-même rend deux ordres différents sur les deux clients, c'est
   * précisément ce qu'on veut voir apparaître dans le fichier.
   */
  private initiativeOrder(combat: any): string[] {
    const all = [...(combat?.playerUnits ?? []), ...(combat?.enemyUnits ?? [])];
    return all
      .filter((u: any) => u?.isAlive?.())
      .sort((a: any, b: any) => (
        b.initiative - a.initiative
        || b.effectiveAttackSpeed() - a.effectiveAttackSpeed()
        || String(a.card_id).localeCompare(String(b.card_id))
      ))
      .map((u: any) => this.key(u));
  }

  /**
   * Les unités des DEUX camps, mortes comprises (`alive`) — une unité qui
   * disparaît d'un côté et pas de l'autre est exactement le genre d'écart
   * qu'on cherche. Triées par clé pour que l'ordre du tableau ne porte aucune
   * information : l'ordre, c'est `order` qui le dit.
   */
  private snapshotUnits(combat: any): any[][] {
    const all = [...(combat?.playerUnits ?? []), ...(combat?.enemyUnits ?? [])];
    return all
      .map((u: any) => this.unitRow(u))
      .sort((a, b) => String(a[0]).localeCompare(String(b[0])));
  }

  private unitRow(u: any): any[] {
    return [
      this.key(u),
      u.position?.col ?? null,
      u.position ? this.row(u.position.row) : null,
      u.current_hp,
      u.max_hp,
      u.shield ?? 0,
      u.atk,
      u.initiative,
      u.effectiveAttackSpeed?.() ?? u.attack_speed,
      u.power_gauge ?? 0,
      u.attack_timer ?? 0,
      u.move_timer ?? 0,
      u.paralysis_remaining ?? 0,
      u.power_block_remaining ?? 0,
      u.confusion_remaining ?? 0,
      u.taunt_remaining ?? 0,
      (u.dot_effects ?? []).length,
      (u.burn_stacks ?? []).length,
      u.isAlive?.() ? 1 : 0,
    ];
  }

  private isUnitLike(v: any): boolean {
    return v !== null && typeof v === 'object' && 'card_id' in v && 'side' in v && 'current_hp' in v;
  }

  private isCellLike(v: any): boolean {
    return v !== null && typeof v === 'object'
      && typeof v.col === 'number' && typeof v.row === 'number'
      && Object.keys(v).length === 2;
  }

  private serialize(v: any): any {
    if (this.isUnitLike(v)) return this.key(v);
    // Le vainqueur d'un `combat_end` est nommé dans le repère local : il se
    // traduit comme une rangée (cf. `winnerCanon`).
    if (v !== null && typeof v === 'object' && v.type === 'combat_end') {
      return { ...v, winner: this.winnerCanon(v.winner) };
    }
    // Une position dans un événement (`move.from/to`, `freeze.cell`) doit être
    // normalisée comme le reste, sinon elle diverge par construction entre les
    // deux clients et noierait toutes les autres différences.
    if (this.isCellLike(v)) return this.cell(v);
    if (Array.isArray(v)) return v.map((x) => this.serialize(x));
    if (v !== null && typeof v === 'object') {
      return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, this.serialize(x)]));
    }
    return v;
  }

  get isEmpty(): boolean { return this.ticks.length === 0; }

  /** L'objet à poster sur `/api/me/pvp-log`. */
  payload(): any {
    return {
      match_id: this.matchId,
      round: this.round,
      role: this.role,
      truncated: this._truncated,
      payload: {
        match_id: this.matchId,
        round: this.round,
        role: this.role,
        board_id: this.boardId,
        blocked_cells: this.blockedCells,
        columns: [...UNIT_COLUMNS],
        start_units: this.startUnits,
        winner: this.winner,
        tick_count: this.ticks.length,
        truncated: this._truncated,
        ticks: this.ticks,
      },
    };
  }
}
