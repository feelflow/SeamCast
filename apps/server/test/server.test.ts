import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { startServer, type RunningServer } from '../src/server.js';

interface Snap {
  type: string;
  game: { score: { away: number; home: number }; balls: number; strikes: number; outs: number };
  canUndo: boolean;
  graphics: { scoreboard: boolean };
  status: { overlays: number; controls: number };
}

let dir: string;
let server: RunningServer | null = null;
const sockets: WebSocket[] = [];

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'seamcast-'));
});

afterEach(async () => {
  for (const ws of sockets.splice(0)) ws.terminate();
  await server?.close();
  server = null;
  await rm(dir, { recursive: true, force: true });
});

const start = async () => {
  server = await startServer({ port: 0, dataDir: dir, log: () => {} });
  return server;
};

function open(port: number, role: string, headers?: Record<string, string>) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?role=${role}`, { headers });
  sockets.push(ws);
  const queue: Snap[] = [];
  const waiting: Array<(s: Snap) => void> = [];
  ws.on('message', (data) => {
    const msg = JSON.parse(data.toString()) as Snap;
    const next = waiting.shift();
    if (next) next(msg);
    else queue.push(msg);
  });
  const next = (): Promise<Snap> =>
    new Promise((resolve) => {
      const ready = queue.shift();
      if (ready) resolve(ready);
      else waiting.push(resolve);
    });
  /** Wartet auf die nächste Nachricht, die die Bedingung erfüllt. */
  const until = async (test: (s: Snap) => boolean): Promise<Snap> => {
    for (;;) {
      const msg = await next();
      if (test(msg)) return msg;
    }
  };
  const ready = new Promise<void>((resolve, reject) => {
    ws.once('open', () => resolve());
    ws.once('error', reject);
    ws.once('unexpected-response', () => reject(new Error('abgelehnt')));
  });
  return { ws, ready, until, send: (m: unknown) => ws.send(JSON.stringify(m)) };
}

describe('HTTP', () => {
  it('liefert Overlay, Bedienung und Profil', async () => {
    const { port } = await start();
    for (const url of ['/overlay/scoreboard.html', '/control/', '/api/profiles/default', '/api/state']) {
      const res = await fetch(`http://127.0.0.1:${port}${url}`);
      expect(res.status, url).toBe(200);
    }
    const html = await fetch(`http://127.0.0.1:${port}/control/`);
    expect(html.headers.get('content-security-policy')).toContain("default-src 'self'");
  });

  it('schützt vor Pfad-Tricks und unbekannten Profilen', async () => {
    const { port } = await start();
    const raw = (p: string) => fetch(`http://127.0.0.1:${port}${p}`);
    expect((await raw('/%2e%2e/%2e%2e/package.json')).status).toBe(404);
    expect((await raw('/..%2f..%2fpackage.json')).status).toBe(404);
    expect((await raw('/api/profiles/..%2f..%2fpackage')).status).toBe(404);
    expect((await raw('/api/profiles/gibtsnicht')).status).toBe(404);
    expect((await fetch(`http://127.0.0.1:${port}/`, { method: 'POST' })).status).toBe(405);
  });
});

describe('WebSocket', () => {
  it('verarbeitet Aktionen, Undo und blendet Grafiken aus', async () => {
    const { port } = await start();
    const control = open(port, 'control');
    await control.ready;
    await control.until((s) => s.status.controls === 1);

    control.send({ type: 'action', action: { type: 'strike' } });
    expect((await control.until((s) => s.game.strikes === 1)).canUndo).toBe(true);

    control.send({ type: 'action', action: { type: 'adjustScore', side: 'home', delta: 2 } });
    await control.until((s) => s.game.score.home === 2);

    control.send({ type: 'undo' });
    await control.until((s) => s.game.score.home === 0);

    control.send({ type: 'hideAll' });
    expect((await control.until((s) => !s.graphics.scoreboard)).graphics.scoreboard).toBe(false);
  });

  it('lehnt Ungültiges ab und lässt Overlays nichts steuern', async () => {
    const { port } = await start();
    const control = open(port, 'control');
    const overlay = open(port, 'overlay');
    await Promise.all([control.ready, overlay.ready]);

    const errors: unknown[] = [];
    control.ws.on('message', (d) => {
      const m = JSON.parse(d.toString()) as { type: string };
      if (m.type === 'error') errors.push(m);
    });
    control.send({ type: 'action', action: { type: 'adjustScore', side: 'home', delta: 999 } });
    control.ws.send('kein json');
    await new Promise((r) => setTimeout(r, 100));
    expect(errors).toHaveLength(2);

    overlay.send({ type: 'action', action: { type: 'strike' } });
    control.send({ type: 'action', action: { type: 'ball' } });
    const snap = await control.until((s) => s.game?.balls === 1);
    expect(snap.game.strikes).toBe(0);
  });

  it('zählt Overlays, aber nicht die Vorschau', async () => {
    const { port } = await start();
    const control = open(port, 'control');
    await control.ready;
    const preview = open(port, 'preview');
    const overlay = open(port, 'overlay');
    await Promise.all([preview.ready, overlay.ready]);
    const snap = await control.until((s) => s.status.overlays === 1 && s.status.controls === 1);
    expect(snap.status.overlays).toBe(1);
  });

  it('weist fremde Herkunft ab', async () => {
    const { port } = await start();
    const evil = open(port, 'control', { Origin: 'http://evil.example' });
    await expect(evil.ready).rejects.toBeDefined();
    const same = open(port, 'control', { Origin: `http://127.0.0.1:${port}` });
    await expect(same.ready).resolves.toBeUndefined();
  });
});

describe('Speichern', () => {
  it('stellt den Stand nach einem Neustart wieder her', async () => {
    let running = await start();
    const control = open(running.port, 'control');
    await control.ready;
    control.send({ type: 'action', action: { type: 'adjustScore', side: 'away', delta: 3 } });
    await control.until((s) => s.game.score.away === 3);
    control.send({ type: 'hideAll' });
    await control.until((s) => !s.graphics.scoreboard);
    control.ws.terminate();
    await running.close();

    running = server = await startServer({ port: 0, dataDir: dir, log: () => {} });
    const res = await fetch(`http://127.0.0.1:${running.port}/api/state`);
    const state = (await res.json()) as Snap;
    expect(state.game.score.away).toBe(3);
    expect(state.graphics.scoreboard).toBe(false);
    expect(state.canUndo).toBe(true);
  });
});
