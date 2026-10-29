import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import WebSocket from 'ws';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { startServer, type RunningServer } from '../src/server.js';

let dir: string;
let server: RunningServer | null = null;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'seamcast-logos-'));
  server = await startServer({ port: 0, dataDir: dir, log: () => {} });
});
afterEach(async () => {
  await server?.close();
  server = null;
  await rm(dir, { recursive: true, force: true });
});

const base = () => `http://127.0.0.1:${server!.port}`;
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32)]);
const upload = (name: string, body: Buffer, headers: Record<string, string> = {}) =>
  fetch(`${base()}/api/logos?name=${encodeURIComponent(name)}`, {
    method: 'POST',
    headers: { 'content-type': 'application/octet-stream', origin: base(), ...headers },
    body,
  });
const api = (method: string, url: string, body?: unknown) =>
  fetch(base() + url, {
    method,
    headers: { 'content-type': 'application/json', origin: base() },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

describe('Logo hochladen', () => {
  it('speichert ein Logo und liefert es unter /assets aus', async () => {
    const res = await upload('verein.png', PNG);
    expect(res.status).toBe(201);
    expect(((await res.json()) as { name: string }).name).toBe('verein.png');
    expect((await readFile(path.join(dir, 'assets', 'verein.png'))).length).toBe(PNG.length);
    const got = await fetch(`${base()}/assets/verein.png`);
    expect(got.status).toBe(200);
  });

  it('lehnt Fehlerfälle ab', async () => {
    expect((await upload('../x.png', PNG)).status).toBe(400);
    expect((await upload('a--b.png', PNG)).status).toBe(400);
    expect((await upload('text.png', Buffer.from('kein bild'))).status).toBe(400);
    expect((await upload('film.mp4', PNG)).status).toBe(400);
    expect((await upload('gross.png', Buffer.concat([PNG, Buffer.alloc(1024 * 1024)]))).status).toBe(413);
    expect((await upload('fremd.png', PNG, { origin: 'http://evil.example' })).status).toBe(403);
    expect((await upload('json.png', PNG, { 'content-type': 'application/json' })).status).toBe(415);
    expect((await upload('scoreboard-hdh.jpg', Buffer.from([0xff, 0xd8, 0xff, 0x00]))).status).toBe(409);
    expect((await fetch(`${base()}/api/logos?name=a.png`)).status).toBe(405);
  });
});

describe('Team-Logos im Spielstand', () => {
  it('nimmt das Logo der Mannschaft mit gleichem Kürzel', async () => {
    await api('POST', '/api/teams', { name: 'Heidenheim Heideköpfe', short: 'HDH', league: '', logo: 'verein.png' });
    const ws = new WebSocket(`ws://127.0.0.1:${server!.port}/ws?role=control`);
    const seen: Array<{ teamLogos?: Record<string, string> }> = [];
    let waiter: (() => void) | null = null;
    ws.on('message', (data) => {
      seen.push(JSON.parse(data.toString()));
      waiter?.();
    });
    const until = async (test: (l: Record<string, string>) => boolean) => {
      for (let i = 0; i < 200; i += 1) {
        const hit = seen.find((m) => m.teamLogos && test(m.teamLogos));
        if (hit) return hit.teamLogos;
        await new Promise<void>((r) => {
          waiter = r;
          setTimeout(r, 50);
        });
      }
      throw new Error('kein passender Spielstand');
    };
    try {
      await until((l) => l.home === '' && l.away === '');
      ws.send(JSON.stringify({ type: 'action', action: { type: 'setTeam', side: 'home', name: 'Heide', short: 'hdh' } }));
      expect(await until((l) => l.home === 'verein.png')).toEqual({ away: '', home: 'verein.png' });
      // Logo ändern: Spielstand wird sofort neu gesendet
      const list = (await (await fetch(base() + '/api/teams')).json()) as Array<{ id: number }>;
      await api('PUT', `/api/teams/${list[0]!.id}`, { name: 'Heidenheim Heideköpfe', short: 'HDH', league: '', logo: 'neu.png' });
      expect(await until((l) => l.home === 'neu.png')).toBeTruthy();
    } finally {
      ws.close();
    }
  });
});
