import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { startServer, type RunningServer } from '../src/server.js';

let dir: string;
let server: RunningServer | null = null;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'seamcast-designs-'));
  server = await startServer({ port: 0, dataDir: dir, log: () => {} });
});
afterEach(async () => {
  await server?.close();
  server = null;
  await rm(dir, { recursive: true, force: true });
});

const base = () => `http://127.0.0.1:${server!.port}`;
const post = (url: string, body: unknown, headers: Record<string, string> = {}) =>
  fetch(base() + url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: base(), ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
const state = async () => (await (await fetch(base() + '/api/state')).json()) as { profiles: Array<{ id: string; name: string; custom?: boolean }> };

const design = { name: 'Mein Design', colors: { panel: '#112233' }, scoreboard: { bild: { image: 'gibt-es-nicht.png' } } };

describe('Designs importieren und exportieren', () => {
  it('exportiert ein Design als Datei', async () => {
    const res = await fetch(base() + '/api/profiles/hdh?download=1');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-disposition')).toContain('seamcast-design-hdh.json');
    expect(((await res.json()) as { name: string }).name).toBe('Layout HDH');
  });

  it('ein exportiertes Design lässt sich unter neuem Namen wieder importieren', async () => {
    const exported = (await (await fetch(base() + '/api/profiles/hdh?download=1')).json()) as Record<string, unknown>;
    const res = await post('/api/profiles', { ...exported, name: 'HDH Kopie' });
    expect(res.status).toBe(201);
    expect(((await res.json()) as { missingAssets: string[] }).missingAssets).toEqual([]);
  });

  it('importiert ein Design, meldet fehlende Bilder und bietet es zur Auswahl an', async () => {
    const res = await post('/api/profiles', design);
    expect(res.status).toBe(201);
    const body = (await res.json()) as { id: string; missingAssets: string[]; replaced: boolean };
    expect(body).toMatchObject({ id: 'mein-design', missingAssets: ['gibt-es-nicht.png'], replaced: false });
    const profiles = (await state()).profiles;
    expect(profiles.find((p) => p.id === 'mein-design')).toMatchObject({ name: 'Mein Design', custom: true });
    expect(profiles.find((p) => p.id === 'hdh')?.custom).toBeUndefined();
    expect(await readdir(path.join(dir, 'profiles'))).toEqual(['mein-design.json']);
    const again = (await (await fetch(base() + '/api/profiles/mein-design')).json()) as { colors: { panel: string } };
    expect(again.colors.panel).toBe('#112233');
  });

  it('ersetzt ein vorhandenes eigenes Design nur mit Bestätigung', async () => {
    await post('/api/profiles', design);
    const clash = await post('/api/profiles', design);
    expect(clash.status).toBe(409);
    expect(((await clash.json()) as { exists?: boolean }).exists).toBe(true);
    const replaced = await post('/api/profiles?overwrite=1', { ...design, colors: { panel: '#445566' } });
    expect(replaced.status).toBe(200);
    expect(((await replaced.json()) as { replaced: boolean }).replaced).toBe(true);
  });

  it('lässt mitgelieferte Designs unangetastet', async () => {
    const res = await post('/api/profiles?id=hdh&overwrite=1', design);
    expect(res.status).toBe(409);
    expect((await state()).profiles.find((p) => p.id === 'hdh')?.name).toBe('Layout HDH');
  });

  it('lehnt Ungültiges ab', async () => {
    expect((await post('/api/profiles', 'kein json')).status).toBe(400);
    expect((await post('/api/profiles', { name: 'X', skript: 1 })).status).toBe(400);
    expect((await post('/api/profiles', { name: 'X', colors: { panel: 'url(http://a)' } })).status).toBe(400);
    expect((await post('/api/profiles?id=../x', design)).status).toBe(400);
    expect((await post('/api/profiles', design, { origin: 'http://fremd.example' })).status).toBe(403);
    const wrongType = await fetch(base() + '/api/profiles', { method: 'POST', headers: { 'content-type': 'text/plain', origin: base() }, body: '{}' });
    expect(wrongType.status).toBe(400);
    const huge = await post('/api/profiles', JSON.stringify({ name: 'X', labels: { a: 'x'.repeat(200 * 1024) } }));
    expect(huge.status).toBe(413);
    expect((await state()).profiles.every((p) => !p.custom)).toBe(true);
  });

  it('löscht eigene Designs, aber keine mitgelieferten oder benutzten', async () => {
    await post('/api/profiles', design);
    const del = (id: string, headers: Record<string, string> = {}) =>
      fetch(`${base()}/api/profiles/${id}`, { method: 'DELETE', headers: { origin: base(), ...headers } });
    expect((await del('hdh')).status).toBe(403);
    expect((await del('gibt-es-nicht')).status).toBe(404);
    expect((await del('mein-design', { origin: 'http://fremd.example' })).status).toBe(403);
    expect((await del('mein-design')).status).toBe(200);
    expect((await state()).profiles.some((p) => p.id === 'mein-design')).toBe(false);
    expect(await readdir(path.join(dir, 'profiles'))).toEqual([]);
  });

  it('löscht kein Design, das als Grundprofil gewählt ist', async () => {
    await post('/api/profiles', design);
    const ws = new (await import('ws')).default(`ws://127.0.0.1:${server!.port}/ws?role=control`, { headers: { origin: base() } });
    await new Promise((resolve) => ws.once('open', resolve));
    ws.send(JSON.stringify({ type: 'profile', id: 'mein-design' }));
    await new Promise((r) => setTimeout(r, 150));
    const res = await fetch(`${base()}/api/profiles/mein-design`, { method: 'DELETE', headers: { origin: base() } });
    expect(res.status).toBe(409);
    ws.terminate();
  });
});
