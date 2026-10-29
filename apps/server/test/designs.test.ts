import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { startServer, type RunningServer } from '../src/server.js';
import { readZip, writeZip } from '../src/zip.js';

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

const png = (extra = 'x') => Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from(extra)]);
const postZip = (entries: Array<{ name: string; data: Buffer }>, query = '') =>
  fetch(`${base()}/api/profiles${query}`, {
    method: 'POST',
    headers: { 'content-type': 'application/zip', origin: base() },
    body: writeZip(entries),
  });
const pkgProfile = { name: 'Paket Design', scoreboard: { bild: { image: 'board.png' } }, cards: { batter: { logo: 'logo.png' } } };
const pkg = (profile: unknown = pkgProfile) => [
  { name: 'design.json', data: Buffer.from(JSON.stringify(profile)) },
  { name: 'assets/board.png', data: png('board') },
  { name: 'assets/logo.png', data: png('logo') },
];
const limits = { maxEntries: 50, maxEntryBytes: 10_000_000, maxTotalBytes: 20_000_000 };

describe('Design-Pakete (ZIP)', () => {
  it('importiert ein Paket: Bilder landen mit Vorsatz im Datenordner und werden ausgeliefert', async () => {
    const res = await postZip(pkg());
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ id: 'paket-design', missingAssets: [], images: 2 });
    expect((await readdir(path.join(dir, 'assets'))).sort()).toEqual(['paket-design--board.png', 'paket-design--logo.png']);
    const profile = (await (await fetch(base() + '/api/profiles/paket-design')).json()) as { scoreboard: { bild: { image: string } } };
    expect(profile.scoreboard.bild.image).toBe('paket-design--board.png');
    const img = await fetch(base() + '/assets/paket-design--board.png');
    expect(img.status).toBe(200);
    expect(img.headers.get('content-type')).toBe('image/png');
    expect((await fetch(base() + '/assets/voith.jpg')).status).toBe(200);
  });

  it('exportiert ein Paket mit Bildern und liest es wieder ein', async () => {
    const res = await fetch(base() + '/api/profiles/hdh?package=1');
    expect(res.headers.get('content-type')).toBe('application/zip');
    const entries = readZip(Buffer.from(await res.arrayBuffer()), limits);
    const names = entries.map((e) => e.name).sort();
    expect(names).toContain('design.json');
    expect(names).toContain('assets/scoreboard-hdh.jpg');
    expect(names).toContain('assets/voith.jpg');
    const again = await postZip(entries);
    expect(again.status).toBe(201);
    expect(await again.json()).toMatchObject({ id: 'layout-hdh', missingAssets: [], images: 4 });
    expect((await postZip(entries)).status).toBe(409);
    expect((await fetch(base() + '/assets/layout-hdh--voith.jpg')).status).toBe(200);
  });

  it('ein exportiertes eigenes Paket enthält die Bilder ohne Vorsatz', async () => {
    await postZip(pkg());
    const res = await fetch(base() + '/api/profiles/paket-design?package=1');
    const entries = readZip(Buffer.from(await res.arrayBuffer()), limits);
    expect(entries.map((e) => e.name).sort()).toEqual(['assets/board.png', 'assets/logo.png', 'design.json']);
    const profile = JSON.parse(entries.find((e) => e.name === 'design.json')!.data.toString()) as { scoreboard: { bild: { image: string } } };
    expect(profile.scoreboard.bild.image).toBe('board.png');
  });

  it('ersetzt beim erneuten Import die alten Bilder und entfernt sie beim Löschen', async () => {
    await postZip(pkg());
    const second = [
      { name: 'design.json', data: Buffer.from(JSON.stringify({ name: 'Paket Design', scoreboard: { bild: { image: 'neu.png' } } })) },
      { name: 'assets/neu.png', data: png('neu') },
    ];
    expect((await postZip(second, '?overwrite=1')).status).toBe(200);
    expect(await readdir(path.join(dir, 'assets'))).toEqual(['paket-design--neu.png']);
    const del = await fetch(`${base()}/api/profiles/paket-design`, { method: 'DELETE', headers: { origin: base() } });
    expect(del.status).toBe(200);
    expect(await readdir(path.join(dir, 'assets'))).toEqual([]);
    expect((await fetch(base() + '/assets/paket-design--neu.png')).status).toBe(404);
  });

  it('meldet Bilder, die weder im Paket noch vorhanden sind', async () => {
    const res = await postZip([
      { name: 'design.json', data: Buffer.from(JSON.stringify({ name: 'Lücke', scoreboard: { bild: { image: 'fehlt.png' } } })) },
    ]);
    expect(await res.json()).toMatchObject({ missingAssets: ['fehlt.png'], images: 0 });
  });

  it('lehnt unsichere Pakete ab und legt nichts ab', async () => {
    const attempts: Array<Array<{ name: string; data: Buffer }>> = [
      [{ name: 'assets/board.png', data: png() }], // design.json fehlt
      [...pkg(), { name: 'run.js', data: Buffer.from('boese()') }], // fremde Datei
      [...pkg(), { name: 'assets/../../evil.png', data: png() }], // Pfad
      [{ name: 'design.json', data: Buffer.from(JSON.stringify(pkgProfile)) }, { name: 'assets/board.png', data: Buffer.from('kein bild') }],
      [{ name: 'design.json', data: Buffer.from(JSON.stringify(pkgProfile)) }, { name: 'assets/board.svg', data: Buffer.from('<svg xmlns="x"><script>alert(1)</script></svg>') }],
      [{ name: 'design.json', data: Buffer.from(JSON.stringify(pkgProfile)) }, { name: `assets/${'a'.repeat(40)}.png`, data: png() }], // Name zu lang
      [{ name: 'design.json', data: Buffer.from('kein json') }],
      [{ name: 'design.json', data: Buffer.from(JSON.stringify({ name: 'X', colors: { panel: 'url(http://a)' } })) }],
    ];
    for (const entries of attempts) expect((await postZip(entries)).status).toBe(400);
    const broken = await fetch(base() + '/api/profiles', { method: 'POST', headers: { 'content-type': 'application/zip', origin: base() }, body: Buffer.from('kein zip') });
    expect(broken.status).toBe(400);
    expect((await state()).profiles.every((p) => !p.custom)).toBe(true);
    expect(await readdir(dir)).not.toContain('assets');
  });
});

