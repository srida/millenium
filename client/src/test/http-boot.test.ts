/// <reference types="node" />
// Démarrage FERMÉ — la régression du constat le plus grave de l'audit.
//
// `requireAuth` faisait `if (!ADMIN_PASS) return next()`. Comme
// `requireSiteAdmin` retombe dessus et que le write-guard global couvre tout
// POST/PUT/DELETE sous /api, la variable absente rendait l'API d'écriture
// entière anonyme — promotion admin comprise. Aucun chargeur de `.env`
// n'existait par ailleurs : `npm start` en local tournait TOUJOURS ainsi.
//
// ⚠️ C'est ICI, et nulle part ailleurs, que ce constat est verrouillé.
// `http.test.ts` doit régler ADMIN_PASS pour que l'application se charge du
// tout : il vérifie donc que l'autorisation est correcte QUAND la variable est
// là — ce qui était déjà vrai avant le correctif. Le trou était l'autre
// branche, et elle ne s'observe qu'au chargement.
//
// ⚠️ Fichier SÉPARÉ de http.test.ts, et pas par goût : les modules racine sont
// chargés par `createRequire`, donc mis en cache par Node. `vi.resetModules()`
// ne touche pas ce cache-là — un second `require('app.js')` dans le même
// processus rendrait l'export mémorisé sans réexécuter la garde, et le test
// passerait à vide. Vitest donne un processus par fichier (pool 'forks') :
// c'est la seule isolation qui marche ici.
import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

describe('app.js — démarrage fermé', () => {
  it('refuse de se charger sans ADMIN_PASS, et ne touche pas au disque', () => {
    const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'millenium-boot-data-'));
    const ASSETS = fs.mkdtempSync(path.join(os.tmpdir(), 'millenium-boot-assets-'));
    const ILLUS = path.join(ASSETS, 'card_illustrations');

    process.env.DATA_DIR = DATA;
    process.env.ILLUS_DIR = ILLUS;
    // ⚠️ Effacement EXPLICITE : `.env` porte la variable et le shell du
    // développeur peut l'exporter. Sans ce delete, le test passerait ou
    // échouerait selon la machine — le pire des deux mondes.
    delete process.env.ADMIN_PASS;

    expect(() => require(path.join(ROOT, 'app.js'))).toThrow(/ADMIN_PASS/);

    // La garde est la PREMIÈRE instruction du fichier, avant `require('./auth')`
    // — qui tire db.js, lequel crée DATA_DIR et ouvre la base au chargement — et
    // avant `bootstrap()`. Ces deux assertions sont ce qui l'y épingle : un
    // refus de démarrer qui laisse une base derrière lui est un effet de bord,
    // pas un refus.
    expect(fs.existsSync(path.join(DATA, 'soulforge.db'))).toBe(false);
    expect(fs.existsSync(path.join(DATA, 'cards.json'))).toBe(false);
    expect(fs.existsSync(ILLUS)).toBe(false);
  });
});
