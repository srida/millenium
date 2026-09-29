/* eslint-disable @typescript-eslint/no-explicit-any */
// Modèles 3D de terrain (.glb) : routes d'import, drapeau `_has_model`, service
// du fichier. Un refus ne se prouve jamais par le seul code de statut : chaque
// cas relit le disque et le catalogue.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import fs from 'node:fs';
import path from 'node:path';
import { boot, ADMIN_BASIC, type Harness } from './http-harness';

let h: Harness;
beforeAll(async () => { h = await boot(); });
afterAll(() => { h.server.close(); });

/** GLB minimal : en-tête `glTF`, version 2, longueur totale. */
function glb(extraBytes = 0): Buffer {
  const b = Buffer.alloc(12 + extraBytes);
  b.writeUInt32LE(0x46546C67, 0);
  b.writeUInt32LE(2, 4);
  b.writeUInt32LE(b.length, 8);
  return b;
}
const modelFile = (id: string) => path.join(h.ASSETS, 'board_models', `${id}.glb`);
const anyBoardId = async (): Promise<string> => {
  const res = await request(h.server).get('/api/boards');
  return res.body[0].id;
};

describe('modèle 3D de terrain', () => {
  it('PUT valide : écrit le fichier, lève _has_model, sert le GLB', async () => {
    const id = await anyBoardId();
    expect((await request(h.server).get('/api/boards')).body.find((b: any) => b.id === id)._has_model).toBe(false);

    const res = await request(h.server).put(`/api/boards/${id}/model`)
      .set('Authorization', ADMIN_BASIC).send({ data: glb(64).toString('base64') });
    expect(res.status).toBe(200);
    expect(fs.existsSync(modelFile(id))).toBe(true);

    const list = (await request(h.server).get('/api/boards')).body;
    expect(list.find((b: any) => b._has_model).id).toBe(id);

    const served = await request(h.server).get(`/api/board-models/${id}`);
    expect(served.status).toBe(200);
    expect(served.headers['content-type']).toContain('model/gltf-binary');

    // Le drapeau calculé n'est jamais persisté par une sauvegarde.
    const board = list.find((b: any) => b.id === id);
    await request(h.server).put(`/api/boards/${id}`).set('Authorization', ADMIN_BASIC).send(board);
    const onDisk = JSON.parse(fs.readFileSync(path.join(h.DATA, 'boards.json'), 'utf8'));
    expect(onDisk.find((b: any) => b.id === id)).not.toHaveProperty('_has_model');
  });

  it('refuse un fichier sans en-tête glTF (400) et n\'écrit rien', async () => {
    const id = await anyBoardId();
    fs.rmSync(modelFile(id), { force: true });
    const res = await request(h.server).put(`/api/boards/${id}/model`)
      .set('Authorization', ADMIN_BASIC).send({ data: Buffer.from('PNG pas un glb 12345').toString('base64') });
    expect(res.status).toBe(400);
    expect(fs.existsSync(modelFile(id))).toBe(false);
  });

  it('refuse un modèle de plus de 1,5 Mo (413) et n\'écrit rien', async () => {
    const id = await anyBoardId();
    fs.rmSync(modelFile(id), { force: true });
    const res = await request(h.server).put(`/api/boards/${id}/model`)
      .set('Authorization', ADMIN_BASIC).send({ data: glb(1.6 * 1024 * 1024).toString('base64') });
    expect(res.status).toBe(413);
    expect(fs.existsSync(modelFile(id))).toBe(false);
  });

  it('refuse un anonyme', async () => {
    const id = await anyBoardId();
    fs.rmSync(modelFile(id), { force: true });
    const res = await request(h.server).put(`/api/boards/${id}/model`).send({ data: glb().toString('base64') });
    expect([401, 403]).toContain(res.status);
    expect(fs.existsSync(modelFile(id))).toBe(false);
  });

  it('DELETE retire le fichier ; GET sans modèle : 404 franc', async () => {
    const id = await anyBoardId();
    await request(h.server).put(`/api/boards/${id}/model`).set('Authorization', ADMIN_BASIC).send({ data: glb().toString('base64') });
    const del = await request(h.server).delete(`/api/boards/${id}/model`).set('Authorization', ADMIN_BASIC);
    expect(del.status).toBe(200);
    expect(fs.existsSync(modelFile(id))).toBe(false);
    expect((await request(h.server).get(`/api/board-models/${id}`)).status).toBe(404);
  });

  it('un id à traversée est refusé en 400', async () => {
    const res = await request(h.server).get('/api/board-models/..%2Fcards');
    expect(res.status).toBe(400);
  });

  it('/api/export porte la liste des checksums boardModels', async () => {
    const id = await anyBoardId();
    await request(h.server).put(`/api/boards/${id}/model`).set('Authorization', ADMIN_BASIC).send({ data: glb(8).toString('base64') });
    const res = await request(h.server).get('/api/export').set('Authorization', ADMIN_BASIC);
    expect(res.status).toBe(200);
    expect(res.body.boardModels.map((m: any) => m.id)).toContain(id);
  });
});
