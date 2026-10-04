/* eslint-disable @typescript-eslint/no-explicit-any */
// `scripts/rebalance-ranges.js` — le coefficient par portée, et la garde qui
// l'empêche de s'appliquer deux fois (un coefficient n'est pas idempotent).
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ticksForRate } from '../../../speed-scale.mjs';

const ROOT = path.resolve(__dirname, '../../..');
const SCRIPT = path.join(ROOT, 'scripts/rebalance-ranges.js');

function card(id: string, range: number, hp = 200, atk = 20) {
  return { id, name: id, stats: { atk, hp, range, attack_rate: 84, movement_rate: 90 } };
}

function workdir(cards: any[]) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rebalance-'));
  fs.writeFileSync(path.join(dir, 'cards.json'), JSON.stringify(cards));
  return dir;
}

/** Le script vise `data/` du projet : on le pointe sur une copie par `--to`
 *  pour mesurer, et on lit la sortie. */
function runTo(cards: any[], extra: string[] = []) {
  const src = workdir(cards);
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'rebalance-out-'));
  // Le script lit sa source dans le projet ; on lui donne une source jetable
  // en se plaçant dans un faux projet qui n'a que `initial-data/`.
  const fake = fs.mkdtempSync(path.join(os.tmpdir(), 'rebalance-proj-'));
  fs.mkdirSync(path.join(fake, 'scripts'));
  fs.copyFileSync(SCRIPT, path.join(fake, 'scripts/rebalance-ranges.js'));
  fs.copyFileSync(path.join(ROOT, 'speed-scale.mjs'), path.join(fake, 'speed-scale.mjs'));
  fs.renameSync(src, path.join(fake, 'initial-data'));
  const r = spawnSync(process.execPath, [path.join(fake, 'scripts/rebalance-ranges.js'), `--to=${out}`, ...extra], { encoding: 'utf8' });
  return { r, fake, out, read: () => JSON.parse(fs.readFileSync(path.join(out, 'cards.json'), 'utf8')) };
}

describe('rebalance-ranges', () => {
  it('la mêlée gagne des PV et de la vitesse, la distance en perd', () => {
    const { r, read } = runTo([card('M', 1), card('R3', 3), card('R5', 5)]);
    expect(r.status).toBe(0);
    const [m, r3, r5] = read();
    expect(m.stats.hp).toBe(240);                       // ×1,20
    expect(r3.stats.hp).toBe(140);                      // ×0,70
    expect(r5.stats.hp).toBe(170);                      // ×0,85 (classe 4+)
    expect(r3.stats.atk).toBe(19);                      // ×0,95
    expect(ticksForRate(m.stats.movement_rate)).toBe(ticksForRate(90) - 2);
    expect(ticksForRate(r3.stats.movement_rate)).toBe(ticksForRate(90) + 2);
    expect(ticksForRate(r3.stats.attack_rate)).toBe(ticksForRate(84) + 1);
  });

  // Mutation : retirer le test `balance_excluded` → ROUGE.
  it('une carte exclue de l\'équilibrage n\'est pas retouchée', () => {
    const { read } = runTo([{ ...card('X', 3), balance_excluded: true }, card('R3', 3)]);
    const [x, r3] = read();
    expect(x.stats.hp).toBe(200);
    expect(r3.stats.hp).toBe(140);
  });

  it('--coeffs surcharge une classe sans toucher aux autres', () => {
    const { read } = runTo([card('M', 1), card('R3', 3)], ['--coeffs={"3":{"hp":0.5}}']);
    const [m, r3] = read();
    expect(r3.stats.hp).toBe(100);
    expect(m.stats.hp).toBe(240);
  });

  // Mutation : retirer la garde du registre → ROUGE (le coefficient s'appliquerait deux fois).
  it('refuse de rejouer un passage déjà inscrit', () => {
    const { fake } = runTo([card('M', 1)]);
    const first = spawnSync(process.execPath, [path.join(fake, 'scripts/rebalance-ranges.js'), '--write'], { encoding: 'utf8' });
    expect(first.status).toBe(0);
    const hp = JSON.parse(fs.readFileSync(path.join(fake, 'initial-data/cards.json'), 'utf8'))[0].stats.hp;
    expect(hp).toBe(240);
    const second = spawnSync(process.execPath, [path.join(fake, 'scripts/rebalance-ranges.js'), '--write'], { encoding: 'utf8' });
    expect(second.status).toBe(1);
    expect(JSON.parse(fs.readFileSync(path.join(fake, 'initial-data/cards.json'), 'utf8'))[0].stats.hp).toBe(240);
  });
});
