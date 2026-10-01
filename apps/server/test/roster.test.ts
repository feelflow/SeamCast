import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { startServer, type RunningServer } from '../src/server.js';

let dir: string;
let server: RunningServer;
let base: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'seamcast-roster-'));
  server = await startServer({ port: 0, dataDir: dir, log: () => {} });
  base = `http://127.0.0.1:${server.port}`;
});

afterEach(async () => {
  await server.close();
  await rm(dir, { recursive: true, force: true });
});

const api = (method: string, url: string, body?: unknown, headers: Record<string, string> = {}) =>
  fetch(base + url, {
    method,
    headers: body === undefined ? headers : { 'Content-Type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

const newTeam = async (name = 'Heidenheim Heideköpfe', short = 'HDH') => {
  const res = await api('POST', '/api/teams', { name, short, league: '1. Liga', own: true });
  return { status: res.status, team: (await res.json()) as { id: number; name: string } };
};

describe('Mannschaften', () => {
  it('legt an, listet, ändert und löscht', async () => {
    const created = await newTeam();
    expect(created.status).toBe(201);

    const list = (await (await api('GET', '/api/teams')).json()) as Array<{ name: string; own: boolean; playerCount: number }>;
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ name: 'Heidenheim Heideköpfe', own: true, playerCount: 0 });

    const changed = await api('PUT', `/api/teams/${created.team.id}`, { name: 'HDH', short: 'HDH' });
    expect(changed.status).toBe(200);
    expect(((await changed.json()) as { name: string }).name).toBe('HDH');

    expect((await api('DELETE', `/api/teams/${created.team.id}`)).status).toBe(200);
    expect((await api('DELETE', `/api/teams/${created.team.id}`)).status).toBe(404);
  });

  it('meldet Doppelte (auch bei anderer Groß-/Kleinschreibung) als Konflikt', async () => {
    await newTeam('Hamburg Stealers', 'HHS');
    const again = await api('POST', '/api/teams', { name: 'HAMBURG stealers', short: 'HHS', league: '1. Liga' });
    expect(again.status).toBe(409);
  });

  it('weist ungültige Eingaben ab', async () => {
    expect((await api('POST', '/api/teams', { name: '', short: 'X' })).status).toBe(400);
    expect((await api('POST', '/api/teams', { name: 'A', short: 'A', logo: '../x.png' })).status).toBe(400);
    const wrongType = await fetch(`${base}/api/teams`, { method: 'POST', body: '{"name":"A","short":"A"}' });
    expect(wrongType.status).toBe(400);
    const broken = await fetch(`${base}/api/teams`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{kaputt',
    });
    expect(broken.status).toBe(400);
  });

  it('lehnt Schreibzugriffe von fremden Webseiten ab', async () => {
    const res = await api('POST', '/api/teams', { name: 'A', short: 'A' }, { Origin: 'http://evil.example' });
    expect(res.status).toBe(403);
    expect(((await (await api('GET', '/api/teams')).json()) as unknown[]).length).toBe(0);
  });
});

describe('Spieler', () => {
  const player = (teamId: number, extra: Record<string, unknown> = {}) => ({
    teamId,
    lastName: 'Redle',
    firstName: 'Elias',
    number: 7,
    bats: 'R',
    throws: 'R',
    externalId: '22013',
    ...extra,
  });

  it('legt an, filtert nach Mannschaft, ändert und löscht', async () => {
    const a = (await newTeam('A-Team', 'AAA')).team;
    const b = (await newTeam('B-Team', 'BBB')).team;
    const created = await api('POST', '/api/players', player(a.id));
    expect(created.status).toBe(201);
    const { id } = (await created.json()) as { id: number };
    await api('POST', '/api/players', player(b.id, { lastName: 'Anders', externalId: '' }));

    const onlyA = (await (await api('GET', `/api/players?team=${a.id}`)).json()) as Array<{ lastName: string }>;
    expect(onlyA.map((p) => p.lastName)).toEqual(['Redle']);
    expect(((await (await api('GET', '/api/players')).json()) as unknown[]).length).toBe(2);

    const moved = await api('PUT', `/api/players/${id}`, player(b.id, { number: 9 }));
    expect(moved.status).toBe(200);
    expect(await moved.json()).toMatchObject({ teamId: b.id, number: 9 });

    expect((await api('DELETE', `/api/players/${id}`)).status).toBe(200);
  });

  it('verhindert doppelte Liga-IDs und Spieler ohne Mannschaft', async () => {
    const a = (await newTeam()).team;
    expect((await api('POST', '/api/players', player(a.id))).status).toBe(201);
    expect((await api('POST', '/api/players', player(a.id, { lastName: 'Zwilling' }))).status).toBe(409);
    expect((await api('POST', '/api/players', player(9999, { externalId: '1' }))).status).toBe(400);
  });

  it('löscht beim Löschen der Mannschaft auch ihre Spieler', async () => {
    const a = (await newTeam()).team;
    await api('POST', '/api/players', player(a.id));
    await api('DELETE', `/api/teams/${a.id}`);
    expect(((await (await api('GET', '/api/players')).json()) as unknown[]).length).toBe(0);
  });
});

describe('Datenbank', () => {
  it('bleibt nach einem Neustart erhalten', async () => {
    await newTeam();
    await server.close();
    server = await startServer({ port: 0, dataDir: dir, log: () => {} });
    base = `http://127.0.0.1:${server.port}`;
    const list = (await (await api('GET', '/api/teams')).json()) as unknown[];
    expect(list).toHaveLength(1);
  });
});
