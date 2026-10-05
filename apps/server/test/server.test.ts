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

describe('Spielerkarten', () => {
  it('wählt Spieler, liefert Karten im Snapshot und lehnt Unbekanntes ab', async () => {
    const { port } = await start();
    const control = open(port, 'control');
    await control.ready;
    const res = await fetch(`http://127.0.0.1:${port}/api/teams`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: `http://127.0.0.1:${port}` },
      body: JSON.stringify({ name: 'Heideköpfe', short: 'HDH' }),
    });
    const team = (await res.json()) as { id: number };
    const pr = await fetch(`http://127.0.0.1:${port}/api/players`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: `http://127.0.0.1:${port}` },
      body: JSON.stringify({ teamId: team.id, firstName: 'Max', lastName: 'Muster', number: 7 }),
    });
    const player = (await pr.json()) as { id: number };

    type CardSnap = Snap & {
      cards: { batter: { lastName: string } | null; pitcher: { lastName: string } | null };
      graphics: { scoreboard: boolean; batter: boolean; pitcher: boolean };
    };
    const untilC = control.until as unknown as (t: (s: CardSnap) => boolean) => Promise<CardSnap>;

    control.send({ type: 'select', role: 'batter', side: 'away', playerId: player.id });
    const snap = await untilC((s) => s.cards?.batter?.lastName === 'Muster');
    expect(snap.cards.pitcher).toBeNull();

    control.send({ type: 'graphics', id: 'batter', visible: true });
    expect((await untilC((s) => s.graphics.batter === true)).graphics.batter).toBe(true);

    control.send({ type: 'select', role: 'batter', side: 'away', playerId: null });
    await untilC((s) => s.cards?.batter === null);

    const errors: unknown[] = [];
    control.ws.on('message', (d) => {
      const m = JSON.parse(d.toString()) as { type: string };
      if (m.type === 'error') errors.push(m);
    });
    control.send({ type: 'select', role: 'pitcher', side: 'home', playerId: 99999 });
    await new Promise((r) => setTimeout(r, 100));
    expect(errors).toHaveLength(1);
  });
});

describe('Aufstellung', () => {
  it('speichert eine Aufstellung und lehnt Ungültiges ab', async () => {
    const { port } = await start();
    const control = open(port, 'control');
    await control.ready;
    const post = async (url: string, body: unknown) =>
      (await (await fetch(`http://127.0.0.1:${port}${url}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: `http://127.0.0.1:${port}` },
        body: JSON.stringify(body),
      })).json()) as { id: number };
    const team = await post('/api/teams', { name: 'Heideköpfe', short: 'HDH' });
    const a = await post('/api/players', { teamId: team.id, firstName: 'A', lastName: 'Eins', number: 1 });
    const b = await post('/api/players', { teamId: team.id, firstName: 'B', lastName: 'Zwei', number: 2 });

    type LSnap = Snap & { lineups: { home: Array<{ lastName: string; order: number; pos: string }> } };
    const untilL = control.until as unknown as (t: (s: LSnap) => boolean) => Promise<LSnap>;
    control.send({ type: 'lineup', side: 'home', slots: [{ playerId: a.id, pos: 'p' }, { playerId: b.id, pos: 'C' }] });
    const snap = await untilL((s) => s.lineups?.home.length === 2);
    expect(snap.lineups.home[0]).toMatchObject({ lastName: 'Eins', order: 1, pos: 'P' });

    // Die Karte übernimmt die Position aus der Aufstellung; ohne Aufstellung bleibt sie leer
    type PosSnap = Snap & { cards: { batter: { lastName: string; pos: string } | null } };
    const untilP = control.until as unknown as (t: (s: PosSnap) => boolean) => Promise<PosSnap>;
    control.send({ type: 'select', role: 'batter', side: 'away', playerId: b.id });
    expect((await untilP((s) => s.cards?.batter?.lastName === 'Zwei')).cards.batter?.pos).toBe('C');
    control.send({ type: 'lineup', side: 'home', slots: [{ playerId: a.id, pos: 'P' }] });
    expect((await untilP((s) => s.cards?.batter?.lastName === 'Zwei' && s.cards.batter.pos === '')).cards.batter?.pos).toBe('');
    control.send({ type: 'lineup', side: 'home', slots: [{ playerId: a.id, pos: 'p' }, { playerId: b.id, pos: 'C' }] });
    await untilL((s) => s.lineups?.home.length === 2);

    const errors: unknown[] = [];
    control.ws.on('message', (d) => {
      const m = JSON.parse(d.toString()) as { type: string };
      if (m.type === 'error') errors.push(m);
    });
    control.send({ type: 'lineup', side: 'home', slots: [{ playerId: a.id, pos: 'P' }, { playerId: a.id, pos: 'C' }] });
    control.send({ type: 'lineup', side: 'home', slots: [{ playerId: 99999, pos: 'P' }] });
    control.send({ type: 'lineup', side: 'home', slots: [{ playerId: a.id, pos: 'LONG' }] });
    await new Promise((r) => setTimeout(r, 100));
    expect(errors).toHaveLength(3);
  });
});

describe('Design-Wahl', () => {
  it('wechselt das Profil für alle, merkt es sich und lehnt Unbekanntes ab', async () => {
    const { port } = await start();
    const control = open(port, 'control');
    await control.ready;
    type PSnap = Snap & { profile: string; profiles: Array<{ id: string }> };
    const untilP = control.until as unknown as (t: (s: PSnap) => boolean) => Promise<PSnap>;
    const first = await untilP((s) => Array.isArray(s.profiles));
    expect(first.profile).toBe('default');
    expect(first.profiles.map((p) => p.id)).toContain('tafel');

    control.send({ type: 'profile', id: 'tafel' });
    await untilP((s) => s.profile === 'tafel');

    const errors: unknown[] = [];
    control.ws.on('message', (d) => {
      const m = JSON.parse(d.toString()) as { type: string };
      if (m.type === 'error') errors.push(m);
    });
    control.send({ type: 'profile', id: '../geheim' });
    control.send({ type: 'profile', id: 'gibt-es-nicht' });
    await new Promise((r) => setTimeout(r, 100));
    expect(errors).toHaveLength(2);

    await server?.close();
    server = await startServer({ port: 0, dataDir: dir, log: () => {} });
    const again = open(server.port, 'control');
    await again.ready;
    expect((await (again.until as unknown as (t: (s: PSnap) => boolean) => Promise<PSnap>)((s) => Array.isArray(s.profiles))).profile).toBe('tafel');
  });
});

describe('Logo-Dateien', () => {
  it('liefert Bilder aus config/assets und lehnt alles andere ab', async () => {
    const { port } = await start();
    const get = (p: string) => fetch(`http://127.0.0.1:${port}${p}`);
    const ok = await get('/assets/voith.jpg');
    expect(ok.status).toBe(200);
    expect(ok.headers.get('content-type')).toBe('image/jpeg');
    expect(ok.headers.get('content-security-policy')).toContain('sandbox');
    expect((await get('/assets/gibt-es-nicht.png')).status).toBe(404);
    expect((await get('/assets/hdh.json')).status).toBe(404);
    expect((await get('/assets/..%2Fprofiles%2Fhdh.json')).status).toBe(404);
    expect((await get('/assets/%2e%2e%2fpackage.json')).status).toBe(404);
  });
});
