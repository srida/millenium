/* eslint-disable @typescript-eslint/no-explicit-any */
/// <reference types="node" />
// Les types Node sont référencés ICI et pas dans `types` du tsconfig : le client
// est du code navigateur, seul ce test (qui charge un module serveur) en a besoin.
//
// Golden tests du moteur de missions (missions.js, côté SERVEUR).
//
// Le module est chargé via createRequire avec un DATA_DIR temporaire : il ouvre
// sa propre base SQLite, les tests ne touchent jamais data/soulforge.db.
//
// Ce qui est verrouillé ici, ce sont les règles qui ne doivent pas dériver :
// le calendrier (journée de 5 h à 5 h), l'anti-concede, la sémantique des
// portées (`single_combat` ≠ cumul), le plafond d'accumulation, et le fait que
// le barème appliqué est TOUJOURS celui du serveur.
import { describe, it, expect, beforeAll } from 'vitest';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import crypto from 'node:crypto';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

let missions: any;
let progression: any;
let stmt: any;

beforeAll(() => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'millenium-missions-'));
  for (const f of ['cards.json', 'missions.json']) {
    fs.copyFileSync(path.join(ROOT, 'data', f), path.join(tmp, f));
  }
  process.env.DATA_DIR = tmp;
  ({ stmt } = require(path.join(ROOT, 'db.js')));
  progression = require(path.join(ROOT, 'progression.js'));
  missions = require(path.join(ROOT, 'missions.js'));
});

// Tous les comptes de test partagent `username_lc = 't'` : la contrainte
// d'unicité porte donc sur (username_lc, tag). Un tag tiré des 4 premiers
// caractères d'un UUID n'offre que 65 536 valeurs — sur quelques dizaines de
// comptes, la collision d'anniversaire finit par tomber et le fichier échoue
// au hasard. Un compteur la supprime par construction.
let _tagSeq = 0;

/** Compte neuf, doté comme à l'inscription (cartes CORE_*). */
function newUser() {
  const id = crypto.randomUUID();
  stmt.insertUser.run({
    id, email: `${id}@test.local`, username: 'T', username_lc: 't',
    tag: String(++_tagSeq).padStart(4, '0'), password_hash: 'x', avatar: null, created_at: Date.now(),
  });
  progression.initUser(id);
  return () => stmt.userById.get(id);
}

/** Lot d'une partie complète, valide au regard des garde-fous. */
function fullMatch(extra: any[] = []) {
  const events: any[] = [];
  for (let r = 0; r < 5; r++) {
    events.push({ type: 'summon_performed', summon_type: 'normal', tier: 2, combat_index: r });
    events.push({ type: 'combat_started', unit_count: 5, attribute_count: 2, max_attribute_units: 3, combat_index: r });
    events.push({ type: 'combat_ended', result: 'win', units_lost: 0, unit_count: 5, combat_index: r });
  }
  events.push(...extra, { type: 'match_completed', result: 'win', rounds_played: 5 });
  return events;
}

describe('calendrier', () => {
  it('la journée court de 5 h à 5 h', () => {
    const at = (iso: string) => missions.dayKey(new Date(iso).getTime());
    // 4 h 59 appartient encore à la veille ; 5 h 00 ouvre la nouvelle journée.
    expect(at('2026-07-27T04:59:00')).toBe('2026-07-26');
    expect(at('2026-07-27T05:00:00')).toBe('2026-07-27');
    expect(at('2026-07-27T23:30:00')).toBe('2026-07-27');
  });

  it('les cycles de 8 h sont ancrés sur 5 h / 13 h / 21 h', () => {
    const at = (iso: string) => missions.cycleKey(new Date(iso).getTime());
    expect(at('2026-07-27T04:59:00')).toBe('2026-07-26#2'); // encore le cycle du soir
    expect(at('2026-07-27T05:00:00')).toBe('2026-07-27#0');
    expect(at('2026-07-27T12:59:00')).toBe('2026-07-27#0');
    expect(at('2026-07-27T13:00:00')).toBe('2026-07-27#1');
    expect(at('2026-07-27T21:00:00')).toBe('2026-07-27#2');
    // Le cycle du soir enjambe minuit sans changer de clé.
    expect(at('2026-07-28T02:00:00')).toBe('2026-07-27#2');
  });

  it('le rang de cycle est monotone, y compris de part et d\'autre de minuit', () => {
    const n = (iso: string) => missions.cycleNumber(missions.cycleKey(new Date(iso).getTime()));
    expect(n('2026-07-27T13:00:00') - n('2026-07-27T06:00:00')).toBe(1);
    expect(n('2026-07-28T06:00:00') - n('2026-07-27T21:30:00')).toBe(1);
    expect(n('2026-07-28T06:00:00') - n('2026-07-27T06:00:00')).toBe(3); // 3 cycles = 24 h
  });

  it('une clé antérieure aux cycles est lue comme le premier créneau du jour', () => {
    // Migration : l'état écrit avant le passage aux cycles ne porte pas de `#`.
    // Le joueur doit recevoir les cycles écoulés depuis, pas zéro.
    expect(missions.cyclesBetween('2026-07-27', '2026-07-27#2')).toBe(2);
  });

  it('la semaine commence le lundi', () => {
    const week = (iso: string) => missions.weekKey(new Date(iso).getTime());
    expect(week('2026-07-27T12:00:00')).toBe('2026-07-27'); // lundi
    expect(week('2026-08-02T12:00:00')).toBe('2026-07-27'); // dimanche → même semaine
    expect(week('2026-08-03T12:00:00')).toBe('2026-08-03'); // lundi suivant
  });

  it('le prochain reset est dans le futur, à moins d\'un cycle', () => {
    const now = Date.now();
    expect(missions.nextResetAt(now)).toBeGreaterThan(now);
    expect(missions.nextResetAt(now) - now).toBeLessThanOrEqual(missions.CYCLE_HOURS * 3600_000);
  });
});

describe('correspondance des événements', () => {
  const obj = (event: string, filters: any, scope = 'cumulative') => ({ event, filters, target: 2, scope });

  it('un filtre absent de l\'événement ne matche jamais', () => {
    // Sinon un `combat_ended` sans `unit_count` validerait « gagner à 2 unités ».
    expect(missions.eventMatches({ type: 'combat_ended', result: 'win' }, obj('combat_ended', { unit_count_max: 2 }))).toBe(false);
    expect(missions.eventMatches({ type: 'combat_ended', result: 'win', unit_count: 2 }, obj('combat_ended', { unit_count_max: 2 }))).toBe(true);
  });

  it('effect_type_in accepte une liste', () => {
    const o = obj('magic_selected', { effect_type_in: ['revive', 'defuse_fusion'] });
    expect(missions.eventMatches({ type: 'magic_selected', effect_type: 'revive' }, o)).toBe(true);
    expect(missions.eventMatches({ type: 'magic_selected', effect_type: 'heal' }, o)).toBe(false);
  });

  it('single_combat prend le maximum par combat, pas le cumul', () => {
    const events = [
      { type: 'power_triggered', combat_index: 0 },
      { type: 'power_triggered', combat_index: 0 },
      { type: 'power_triggered', combat_index: 1 },
    ];
    expect(missions.batchDelta(events, obj('power_triggered', {}, 'single_combat'))).toEqual({ add: 0, atLeast: 2 });
    expect(missions.batchDelta(events, obj('power_triggered', {}, 'cumulative'))).toEqual({ add: 3, atLeast: 0 });
  });
});

describe('délivrance par cycle', () => {
  it('un compte neuf reçoit un lot de 2, aux difficultés du cycle courant', () => {
    const user = newUser();
    const snap = missions.refresh(user());
    expect(missions.CYCLE_COUNT).toBe(2);
    expect(snap.missions).toHaveLength(missions.CYCLE_COUNT);
    expect(snap.missions.map((m: any) => m.slot_weight).sort())
      .toEqual([...missions.slotsForCycle(missions.cycleNumber(missions.cycleKey()))].sort());
    expect(snap.weekly.points).toBe(0);
    expect(snap.reroll.free_available).toBe(true);
  });

  it('la rotation des difficultés couvre chaque slot deux fois par journée', () => {
    // Trois cycles consécutifs = une journée = le plafond d'accumulation : la
    // paire tourne pour que le rattrapage vaille la présence aux trois créneaux.
    const rank = missions.cycleNumber(missions.cycleKey());
    const day = [0, 1, 2].flatMap(i => missions.slotsForCycle(rank + i));
    expect(day).toHaveLength(missions.CYCLE_COUNT * missions.CYCLES_PER_DAY);
    for (const slot of missions.SLOTS) {
      expect(day.filter((s: number) => s === slot)).toHaveLength(2);
    }
    // Rang négatif (rattrapage d'un cycle antérieur) : jamais d'index hors bornes.
    expect(missions.slotsForCycle(-1)).toEqual(missions.slotsForCycle(2));
  });

  it('relire dans le même cycle ne redélivre rien', () => {
    const user = newUser();
    missions.refresh(user());
    expect(missions.refresh(user()).missions).toHaveLength(missions.CYCLE_COUNT);
  });

  it('un cycle écoulé délivre un lot de plus, sans attendre le lendemain', () => {
    const user = newUser();
    const { db } = require(path.join(ROOT, 'db.js'));
    missions.refresh(user());
    // Recule l'état d'un seul créneau : c'est tout ce qu'il faut désormais.
    const previous = missions.cycleKey(Date.now() - missions.CYCLE_HOURS * 3600_000);
    db.prepare('UPDATE user_mission_state SET last_issued_day = ? WHERE user_id = ?').run(previous, user().id);
    const snap = missions.refresh(user());
    expect(snap.missions.filter((m: any) => m.status === 'active')).toHaveLength(2 * missions.CYCLE_COUNT);
  });

  it('l\'accumulation est plafonnée à 6, même après une longue absence', () => {
    const user = newUser();
    missions.refresh(user());
    const { db } = require(path.join(ROOT, 'db.js'));
    db.prepare("UPDATE user_mission_state SET last_issued_day = '2020-01-01#0' WHERE user_id = ?").run(user().id);
    const snap = missions.refresh(user());
    expect(missions.MAX_ACTIVE).toBe(6);
    expect(snap.missions.filter((m: any) => m.status === 'active')).toHaveLength(missions.MAX_ACTIVE);
  });

  it('ne tire que des missions réalisables avec la collection du joueur', () => {
    // Les cartes de départ (CORE_*) ne couvrent pas tout le catalogue : une
    // mission exigeant ce qu'on ne possède pas ne doit jamais sortir.
    const user = newUser();
    const owned = progression.unlockedCardIds(user());
    for (const def of missions.catalog()) {
      if (!def.requirements) continue;
      const eligible = missions.meetsRequirements(owned, def);
      // Cohérence : le filtre répond la même chose deux fois de suite.
      expect(missions.meetsRequirements(owned, def)).toBe(eligible);
    }
    const snap = missions.refresh(user());
    for (const m of snap.missions) {
      const def = missions.catalog().find((d: any) => d.id === m.mission_id);
      expect(missions.meetsRequirements(owned, def)).toBe(true);
    }
  });
});

describe('garde-fous anti-farm', () => {
  it('une partie abandonnée avant le 2ᵉ combat ne rapporte rien', () => {
    const user = newUser();
    missions.refresh(user());
    const before = progression.getProgression(user());
    const res = missions.applyEvents(user(), {
      matchId: 'concede',
      events: [
        { type: 'combat_started', unit_count: 3, combat_index: 0 },
        { type: 'summon_performed', summon_type: 'normal', tier: 1, combat_index: 0 },
        { type: 'match_completed', result: 'win', rounds_played: 1 },
      ],
    });
    expect(res.countable).toBe(false);
    expect(res.completed).toEqual([]);
    expect(progression.getProgression(user())).toEqual(before);
  });

  it('une partie sans aucune invocation (AFK) ne rapporte rien', () => {
    const user = newUser();
    missions.refresh(user());
    const res = missions.applyEvents(user(), {
      matchId: 'afk',
      events: [
        { type: 'combat_started', unit_count: 0, combat_index: 0 },
        { type: 'combat_started', unit_count: 0, combat_index: 1 },
        { type: 'match_completed', result: 'loss', rounds_played: 5 },
      ],
    });
    expect(res.countable).toBe(false);
  });

  it('hors partie, seuls les événements méta sont retenus', () => {
    const user = newUser();
    missions.refresh(user());
    const res = missions.applyEvents(user(), {
      matchId: null,
      // Un client qui enverrait des invocations sans partie ne doit rien gagner.
      events: [{ type: 'summon_performed', summon_type: 'fusion', tier: 5 }],
    });
    expect(res.completed).toEqual([]);
  });
});

describe('complétion et barème', () => {
  it('le serveur applique SON barème, jamais un montant du client', () => {
    const user = newUser();
    // On force une mission connue plutôt que de dépendre du tirage aléatoire.
    const { db } = require(path.join(ROOT, 'db.js'));
    missions.refresh(user());
    db.prepare('DELETE FROM user_missions WHERE user_id = ?').run(user().id);
    stmt.insertMission.run({
      id: 'fixed-1', user_id: user().id, mission_id: 'MISSION_A_006',
      slot_weight: 2, target: 1, issued_day: missions.cycleKey(), issued_at: Date.now(),
    });

    const before = progression.getProgression(user());
    const res = missions.applyEvents(user(), {
      matchId: 'm1',
      // Le client prétend valoir 99 999 golds : le champ est ignoré.
      events: fullMatch([{ type: 'match_completed', result: 'win', rounds_played: 5, gold: 99_999 }]),
    });

    expect(res.countable).toBe(true);
    expect(res.completed.map((c: any) => c.mission_id)).toEqual(['MISSION_A_006']);
    // Terminer NE CRÉDITE PLUS RIEN : ni gain, ni point de semaine.
    expect(res.granted).toBeUndefined();
    expect(progression.getProgression(user()).gold).toBe(before.gold);
    expect(missions.getSnapshot(user()).weekly.points).toBe(0);

    // …et c'est bien le barème du serveur (slot 2) qui tombe au `claim`.
    const claimed = missions.claim(user(), 'fixed-1');
    expect(claimed.ok).toBe(true);
    expect(claimed.granted).toEqual({ xp: 10, gold: 100, gems: 0 });
    expect(progression.getProgression(user()).gold).toBe(before.gold + 100);
  });

  it('un gain ne se récupère qu\'une fois, et seulement une fois terminé', () => {
    const user = newUser();
    const { db } = require(path.join(ROOT, 'db.js'));
    missions.refresh(user());
    db.prepare('DELETE FROM user_missions WHERE user_id = ?').run(user().id);
    stmt.insertMission.run({
      id: 'fixed-claim', user_id: user().id, mission_id: 'MISSION_A_001',
      slot_weight: 1, target: 1, issued_day: missions.cycleKey(), issued_at: Date.now(),
    });

    // Encore active : rien à récupérer.
    expect(missions.claim(user(), 'fixed-claim')).toMatchObject({ ok: false });
    const before = progression.getProgression(user());

    missions.applyEvents(user(), { matchId: 'm1', events: fullMatch() });
    expect(missions.claim(user(), 'fixed-claim').ok).toBe(true);
    const afterClaim = progression.getProgression(user());
    expect(afterClaim.gold).toBe(before.gold + missions.SLOT_REWARDS[1].gold);

    // Deuxième tap (double-clic, second onglet) : refusé, et rien de crédité.
    expect(missions.claim(user(), 'fixed-claim')).toMatchObject({ ok: false });
    expect(progression.getProgression(user()).gold).toBe(afterClaim.gold);

    // La mission d'un autre joueur n'est pas récupérable, même en connaissant l'id.
    const thief = newUser();
    expect(missions.claim(thief(), 'fixed-claim')).toMatchObject({ ok: false });
  });

  it('un gain terminé mais non récupéré survit au reset quotidien', () => {
    // C'est la contrepartie de la récupération manuelle : si la purge emportait
    // les gains en attente, oublier de taper reviendrait à les perdre.
    const user = newUser();
    const { db } = require(path.join(ROOT, 'db.js'));
    missions.refresh(user());
    db.prepare('DELETE FROM user_missions WHERE user_id = ?').run(user().id);
    stmt.insertMission.run({
      id: 'fixed-stale', user_id: user().id, mission_id: 'MISSION_A_001',
      slot_weight: 1, target: 1, issued_day: '2020-01-01#0', issued_at: Date.now(),
    });
    missions.applyEvents(user(), { matchId: 'm1', events: fullMatch() });

    // Un cycle (et bien plus) a passé : la délivrance tourne, la purge aussi.
    db.prepare("UPDATE user_mission_state SET last_issued_day = '2020-01-01#0' WHERE user_id = ?").run(user().id);
    const snap = missions.refresh(user());
    const kept = snap.missions.find((m: any) => m.id === 'fixed-stale');
    expect(kept).toBeTruthy();
    expect(kept.status).toBe('completed');
    expect(missions.claim(user(), 'fixed-stale').ok).toBe(true);

    // Une fois récupérée, elle s'efface au reset suivant comme avant.
    missions.refresh(user());
    expect(missions.getSnapshot(user()).missions.find((m: any) => m.id === 'fixed-stale')).toBeUndefined();
  });

  it('une mission terminée ne se re-termine jamais', () => {
    const user = newUser();
    const { db } = require(path.join(ROOT, 'db.js'));
    missions.refresh(user());
    db.prepare('DELETE FROM user_missions WHERE user_id = ?').run(user().id);
    stmt.insertMission.run({
      id: 'fixed-2', user_id: user().id, mission_id: 'MISSION_A_001',
      slot_weight: 1, target: 1, issued_day: missions.cycleKey(), issued_at: Date.now(),
    });
    missions.applyEvents(user(), { matchId: 'm1', events: fullMatch() });
    const afterFirst = progression.getProgression(user());
    const again = missions.applyEvents(user(), { matchId: 'm2', events: fullMatch() });
    expect(again.completed).toEqual([]);
    expect(progression.getProgression(user()).gold).toBe(afterFirst.gold);
  });

  it('la jauge hebdomadaire n\'avance qu\'à la RÉCUPÉRATION, jamais à la complétion', () => {
    // C'est ce décalage qui permet à la barre de bouger sous les yeux du joueur
    // au moment de son tap, au lieu d'être déjà remplie à l'ouverture de l'écran.
    const user = newUser();
    const { db } = require(path.join(ROOT, 'db.js'));
    missions.refresh(user());
    db.prepare('DELETE FROM user_missions WHERE user_id = ?').run(user().id);
    stmt.insertMission.run({
      id: 'fixed-gauge', user_id: user().id, mission_id: 'MISSION_A_001',
      slot_weight: 1, target: 1, issued_day: missions.cycleKey(), issued_at: Date.now(),
    });

    missions.applyEvents(user(), { matchId: 'm1', events: fullMatch() });
    expect(missions.getSnapshot(user()).weekly.points).toBe(0);

    missions.claim(user(), 'fixed-gauge');
    expect(missions.getSnapshot(user()).weekly.points).toBe(1);
  });

  it('la jauge hebdomadaire verse ses paliers au passage, une seule fois', () => {
    const user = newUser();
    const { db } = require(path.join(ROOT, 'db.js'));
    missions.refresh(user());
    db.prepare('DELETE FROM user_missions WHERE user_id = ?').run(user().id);
    // 4 points déjà acquis : la 5ᵉ mission récupérée franchit le 1er palier.
    const first = missions.WEEKLY_MILESTONES[0].points;
    db.prepare('UPDATE user_mission_state SET weekly_points = ? WHERE user_id = ?').run(first - 1, user().id);
    stmt.insertMission.run({
      id: 'fixed-3', user_id: user().id, mission_id: 'MISSION_A_001',
      slot_weight: 1, target: 1, issued_day: missions.cycleKey(), issued_at: Date.now(),
    });

    const res = missions.applyEvents(user(), { matchId: 'm1', events: fullMatch() });
    expect(res.completed).toHaveLength(1);
    expect(res.milestones).toBeUndefined();     // rien n'est versé à la complétion

    const claimed = missions.claim(user(), 'fixed-3');
    expect(claimed.milestones.map((m: any) => m.points)).toEqual([first]);
    // Un seul crédit : mission facile (6 XP / 50 golds) + 1er palier
    // (3 XP / 100 golds / 5 gemmes), le palier tombant d'office.
    expect(claimed.granted).toEqual({ xp: 9, gold: 150, gems: 5 });

    const snap = missions.getSnapshot(user());
    expect(snap.weekly.points).toBe(first);
    expect(snap.weekly.milestones.find((m: any) => m.points === first).claimed).toBe(true);
  });

  it('la jauge est bornée : récupérer au-delà du plafond ne reverse rien', () => {
    const user = newUser();
    const { db } = require(path.join(ROOT, 'db.js'));
    missions.refresh(user());
    db.prepare('DELETE FROM user_missions WHERE user_id = ?').run(user().id);
    db.prepare('UPDATE user_mission_state SET weekly_points = ? WHERE user_id = ?')
      .run(missions.WEEKLY_MAX, user().id);
    stmt.insertMission.run({
      id: 'fixed-cap', user_id: user().id, mission_id: 'MISSION_A_001',
      slot_weight: 1, target: 1, issued_day: missions.cycleKey(), issued_at: Date.now(),
    });
    missions.applyEvents(user(), { matchId: 'm1', events: fullMatch() });

    const claimed = missions.claim(user(), 'fixed-cap');
    // Le gain de la mission tombe toujours — c'est la SEMAINE qui est pleine.
    expect(claimed.granted).toEqual({ xp: 6, gold: 50, gems: 0 });
    expect(claimed.milestones).toEqual([]);
    expect(missions.getSnapshot(user()).weekly.points).toBe(missions.WEEKLY_MAX);
  });

  it('la jauge hebdomadaire tient en 5 paliers réguliers, croissants et bornés', () => {
    const ms = missions.WEEKLY_MILESTONES;
    expect(ms.map((m: any) => m.points)).toEqual([5, 10, 15, 20, 25]);
    expect(missions.WEEKLY_MAX).toBe(25);
    // Un palier ne doit jamais valoir moins que le précédent : la jauge se
    // parcourt en montant, une marche qui redescend n'a aucune raison d'être.
    for (const k of ['xp', 'gold', 'gems']) {
      const seq = ms.map((m: any) => m.rewards[k]);
      expect(seq).toEqual([...seq].sort((a: number, b: number) => a - b));
    }
    // Dotation totale de la semaine, inchangée par la refonte des paliers.
    const total = ms.reduce((acc: any, m: any) => ({
      xp: acc.xp + m.rewards.xp, gold: acc.gold + m.rewards.gold, gems: acc.gems + m.rewards.gems,
    }), { xp: 0, gold: 0, gems: 0 });
    expect(total).toEqual({ xp: 35, gold: 900, gems: 85 });
  });

  it('la jauge est plafonnée et repart à zéro la semaine suivante', () => {
    const user = newUser();
    const { db } = require(path.join(ROOT, 'db.js'));
    missions.refresh(user());
    db.prepare('UPDATE user_mission_state SET weekly_points = ?, week_key = ? WHERE user_id = ?')
      .run(missions.WEEKLY_MAX, '2000-01-03', user().id);
    const snap = missions.refresh(user());
    expect(snap.weekly.points).toBe(0);
    expect(snap.weekly.milestones.every((m: any) => !m.claimed)).toBe(true);
  });
});

describe('reroll', () => {
  it('le premier de la journée est gratuit, les suivants coûtent des golds', () => {
    const user = newUser();
    progression.grant(user().id, { gold: 500 });
    const snap = missions.refresh(user());
    const target = snap.missions[0];

    const first = missions.reroll(user(), target.id);
    expect(first).toMatchObject({ ok: true, free: true, cost: 0 });

    const goldBefore = progression.getProgression(user()).gold;
    const second = missions.reroll(user(), missions.getSnapshot(user()).missions[0].id);
    expect(second).toMatchObject({ ok: true, free: false, cost: missions.REROLL_COST });
    expect(progression.getProgression(user()).gold).toBe(goldBefore - missions.REROLL_COST);
  });

  it('refuse sans golds une fois le gratuit consommé', () => {
    const user = newUser();
    missions.refresh(user());
    missions.reroll(user(), missions.getSnapshot(user()).missions[0].id); // gratuit
    const res = missions.reroll(user(), missions.getSnapshot(user()).missions[0].id);
    expect(res.ok).toBe(false);
  });

  it('refuse la mission d\'un autre joueur', () => {
    const a = newUser();
    const b = newUser();
    missions.refresh(a());
    missions.refresh(b());
    const res = missions.reroll(b(), missions.getSnapshot(a()).missions[0].id);
    expect(res.ok).toBe(false);
  });
});
