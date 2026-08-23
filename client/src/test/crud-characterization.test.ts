/* eslint-disable @typescript-eslint/no-explicit-any */
/// <reference types="node" />
// EMPREINTE du CRUD des catalogues, prise AVANT toute factorisation.
//
// ⚠️ Ce fichier ne dit pas ce que les routes DEVRAIENT faire : il dit ce
// qu'elles FONT. Les instantanés sont à lire comme un constat, bugs compris —
// c'est tout leur intérêt. Les corriger se fait dans un commit dédié, qui met
// l'instantané à jour et le dit ; ce qui est interdit, c'est qu'ils bougent
// tout seuls.
//
// Il existe parce que les dix blocs CRUD d'`app.js` — près de 700 lignes du
// même quintuplet recopié — n'ont jamais eu de test, et que c'est cette
// répétition qui a produit la traversée de répertoire (garde-fou ajouté aux
// copies récentes, pas aux anciennes). On ne factorise pas 700 lignes à
// l'aveugle : on enregistre d'abord ce qu'elles rendent, puis le diff de
// l'instantané doit être VIDE après refonte. C'est le critère de recette, et
// il est mécanique.
//
// Trois divergences connues sont volontairement gelées ici, pas corrigées :
//   - ⚠️ `/api/boards/import` n'a PAS le garde `Array.isArray` des autres, et
//     la conséquence est pire qu'une erreur : une chaîne étant un ITÉRABLE,
//     `{"items":"nope"}` pousse ses CARACTÈRES dans le catalogue comme s'ils
//     étaient des terrains, et répond 200. `boards.json` se retrouve avec une
//     chaîne nue là où `BoardDatabase` attend un objet — l'admin, lui, croit
//     son import passé ;
//   - la réponse de ce même import n'a pas de clé `errors`, contrairement aux
//     huit autres, et il ne saute pas les entrées sans `id` ;
//   - `/api/sets/import` n'aligne PAS le miroir `card.set`, contrairement à
//     son POST et à son PUT.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import fs from 'node:fs';
import path from 'node:path';
import { boot, ADMIN_BASIC, type Harness } from './http-harness';

let h: Harness;
beforeAll(async () => { h = await boot(); }, 30_000);
afterAll(() => { h?.server.close(); });

const ID = 'CHAR_001';

/** Corps minimal accepté par chaque entité (certaines exigent un champ de plus). */
const ENTITIES = [
  { route: 'cards', file: 'cards.json', extra: { name: 'Empreinte', tier: 1 } },
  { route: 'attributes', file: 'attributes.json', extra: { name: 'Empreinte', icon: '🔧' } },
  { route: 'powers', file: 'powers.json', extra: { name: 'Empreinte' } },
  { route: 'boards', file: 'boards.json', extra: { name: 'Empreinte' } },
  { route: 'magies', file: 'magies.json', extra: { name: 'Empreinte', effect: null } },
  { route: 'variants', file: 'variants.json', extra: { card_id: 'CORE_001' } },
  { route: 'missions', file: 'missions.json', extra: { name: 'Empreinte' } },
  { route: 'decks', file: 'public_decks.json', extra: { name: 'Empreinte', deck: {} } },
  { route: 'sets', file: 'sets.json', extra: { name: 'Empreinte', cards: [] } },
];

const admin = (r: any) => r.set('Authorization', ADMIN_BASIC);

/** Les entrées CHAR_* du fichier, seules à nous intéresser. */
function ours(file: string) {
  const raw = JSON.parse(fs.readFileSync(path.join(h.DATA, file), 'utf8'));
  return (Array.isArray(raw) ? raw : []).filter((x: any) => String(x?.id).startsWith('CHAR_'));
}

for (const e of ENTITIES) {
  describe(`/api/${e.route}`, () => {
    it('empreinte du quintuplet', async () => {
      const trace: any[] = [];
      const rec = async (label: string, res: any) => {
        trace.push([label, res.status, res.body]);
      };

      await rec('POST sans id', await admin(request(h.server).post(`/api/${e.route}`)).send({ ...e.extra }));
      await rec('POST ok', await admin(request(h.server).post(`/api/${e.route}`)).send({ id: ID, ...e.extra }));
      await rec('POST doublon', await admin(request(h.server).post(`/api/${e.route}`)).send({ id: ID, ...e.extra }));

      await rec('import non-tableau', await admin(request(h.server).post(`/api/${e.route}/import`)).send({ items: 'nope' }));
      await rec('import sans id', await admin(request(h.server).post(`/api/${e.route}/import`)).send({ items: [{ ...e.extra }] }));
      await rec('import skip', await admin(request(h.server).post(`/api/${e.route}/import`)).send({ items: [{ id: ID, ...e.extra, name: 'Importée' }] }));
      await rec('import replace', await admin(request(h.server).post(`/api/${e.route}/import`)).send({ items: [{ id: ID, ...e.extra, name: 'Remplacée' }], mode: 'replace' }));

      await rec('PUT ok', await admin(request(h.server).put(`/api/${e.route}/${ID}`)).send({ id: ID, ...e.extra, name: 'Modifiée' }));
      await rec('PUT inconnu', await admin(request(h.server).put(`/api/${e.route}/CHAR_404`)).send({ id: 'CHAR_404', ...e.extra }));

      // L'état du FICHIER compte autant que les réponses : un `{ok:true}`
      // identique peut recouvrir une écriture différente (forme de l'objet
      // écrit, position dans le tableau, champs calculés présents ou non).
      trace.push(['fichier après écritures', ours(e.file)]);

      await rec('DELETE ok', await admin(request(h.server).delete(`/api/${e.route}/${ID}`)));
      await rec('DELETE inconnu', await admin(request(h.server).delete(`/api/${e.route}/${ID}`)));

      trace.push(['fichier après suppression', ours(e.file)]);

      expect(trace).toMatchSnapshot();
    });
  });
}

// ---------------------------------------------------------------------------
//  Les drapeaux calculés à la lecture
// ---------------------------------------------------------------------------
describe('drapeaux calculés', () => {
  it('présents à la lecture, absents du fichier', async () => {
    const shapes: any[] = [];
    for (const e of ENTITIES) {
      const res = await request(h.server).get(`/api/${e.route}`);
      const first = res.body[0] ?? {};
      // On ne retient que les clés `_*`, les seules dérivées à la lecture.
      shapes.push([e.route, Object.keys(first).filter(k => k.startsWith('_')).sort()]);
    }
    expect(shapes).toMatchSnapshot();
  });
});

// ---------------------------------------------------------------------------
//  Les divergences connues, nommées plutôt que subies
// ---------------------------------------------------------------------------
describe('divergences gelées', () => {
  it('/api/boards/import CORROMPT le catalogue sur un corps non-tableau', async () => {
    const cards = await admin(request(h.server).post('/api/cards/import')).send({ items: 'nope' });
    expect(cards.status).toBe(400);
    expect(cards.body).toEqual({ error: 'items doit être un tableau' });

    const fichier = path.join(h.DATA, 'boards.json');
    const lire = () => JSON.parse(fs.readFileSync(fichier, 'utf8'));

    // ⚠️ L'empreinte du quintuplet, plus haut dans ce fichier, a DÉJÀ joué
    // `import non-tableau` sur boards — donc déjà glissé un caractère dans le
    // catalogue. On repart d'un fichier propre pour que l'assertion porte sur
    // ce test-ci et pas sur l'ordre d'exécution.
    const propre = lire().filter((b: any) => b && typeof b === 'object');
    fs.writeFileSync(fichier, JSON.stringify(propre, null, '\t'));

    const avant = propre.length;
    const boards = await admin(request(h.server).post('/api/boards/import')).send({ items: 'nope' });
    const apres = lire();

    // ⚠️ Comportement ACTUEL, et il est PIRE qu'un 500 : faute de garde
    // `Array.isArray`, la chaîne est ITÉRÉE — une chaîne est un itérable — et
    // ses caractères sont poussés dans le catalogue comme s'ils étaient des
    // terrains. La route répond 200, l'admin croit son import passé, et
    // `boards.json` contient désormais une chaîne nue là où `BoardDatabase`
    // attend un objet.
    //
    // Gelé ici, corrigé dans le commit suivant — l'instantané bougera alors
    // délibérément.
    expect(boards.status).toBe(200);
    expect(apres.length).toBe(avant + 1);
    expect(apres[apres.length - 1]).toBe('n');

    // On nettoie derrière nous : les autres tests lisent ce fichier.
    fs.writeFileSync(fichier, JSON.stringify(apres.filter((b: any) => b && typeof b === 'object'), null, '\t'));
  });

  it('/api/boards/import ne rend pas de clé `errors`', async () => {
    const boards = await admin(request(h.server).post('/api/boards/import')).send({ items: [{ name: 'sans id' }] });
    const cards = await admin(request(h.server).post('/api/cards/import')).send({ items: [{ name: 'sans id' }] });

    expect(cards.body).toHaveProperty('errors');
    expect(boards.body).not.toHaveProperty('errors');
  });

  it('/api/sets/import n\'aligne PAS le miroir `card.set`, là où POST le fait', async () => {
    const cible = 'CORE_002';
    const lireSet = () => JSON.parse(fs.readFileSync(path.join(h.DATA, 'cards.json'), 'utf8'))
      .find((c: any) => c.id === cible)?.set;

    await admin(request(h.server).post('/api/sets')).send({ id: 'CHAR_SET_P', name: 'Par POST', cards: [cible] });
    const apresPost = lireSet();

    await admin(request(h.server).delete('/api/sets/CHAR_SET_P'));
    await admin(request(h.server).post('/api/sets/import'))
      .send({ items: [{ id: 'CHAR_SET_I', name: 'Par import', cards: [cible] }] });
    const apresImport = lireSet();

    // ⚠️ Comportement ACTUEL : le POST pose le miroir, l'import non.
    expect(apresPost).toBe('CHAR_SET_P');
    expect(apresImport).not.toBe('CHAR_SET_I');

    await admin(request(h.server).delete('/api/sets/CHAR_SET_I'));
  });
});
