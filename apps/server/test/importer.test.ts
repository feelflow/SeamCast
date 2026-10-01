import { mkdtemp, rm } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { planAccessImport, type AccessTables } from '@seamcast/core';
import { createRepo, openDatabase } from '../src/db.js';
import { applyImport, importFromAccess } from '../src/importer.js';
import { statLines } from '../src/statlines.js';
import { startServer, type RunningServer } from '../src/server.js';

const tables: AccessTables = {
  teams: [{ Team: 'Heidenheim Heideköpfe', League: '(1. Liga)', Short: 'HDH', 'Logo URL': 'logo.png' }],
  players: [
    { TeamShort: 'Heidenheim Heideköpfe', ID: 22013, Lastname: 'Redle', Name: 'Elias', Nationality: 'DE', UniformNr: 21, Bats: 'R', Throws: 'R' },
  ],
  offense: [
    { 'Off_ RoundID': 1, Off_Year: 2026, Off_RoundName: 'Play-Off', Off_League: 'L', Off_PlayerID: 22013, Off_Player: 'Redle', Off_G: 1, Off_PA: 4, Off_AB: 3, Off_H: 2, Off_BB: 1, Off_R: 1, Off_RBI: 1 },
  ],
  pitching: [
    { Pit_RoundID: 1, Pit_Year: 2026, Pit_RoundName: 'Play-Off', Pit_League: 'L', Pit_PlayerID: 22013, Pit_Player: 'Redle', Pit_G: 1, Pit_ER: 2, Pit_H: 3, Pit_BB: 1, Pit_IP: '4,2' },
  ],
};

describe('applyImport', () => {
  it('legt an, aktualisiert beim zweiten Lauf und rollt bei Probelauf zurück', () => {
    const db = openDatabase(':memory:');
    const plan = planAccessImport(tables);

    const dry = applyImport(db, plan, true);
    expect(dry.teams.created).toBe(1);
    expect(createRepo(db).listTeams()).toHaveLength(0);

    const first = applyImport(db, plan, false);
    expect(first).toMatchObject({ teams: { created: 1 }, players: { created: 1 }, batting: { created: 1 }, pitching: { created: 1 } });
    const second = applyImport(db, plan, false);
    expect(second).toMatchObject({ teams: { updated: 1 }, players: { updated: 1 }, batting: { updated: 1 }, pitching: { updated: 1 } });
    expect(createRepo(db).listPlayers()).toHaveLength(1);
  });

  it('übernimmt eine von Hand angelegte Mannschaft gleichen Namens ohne Liga, statt sie zu verdoppeln', () => {
    const db = openDatabase(':memory:');
    const repo = createRepo(db);
    repo.createTeam({ name: 'heidenheim heideköpfe', short: 'HDH', league: '', logo: '', own: true });
    applyImport(db, planAccessImport(tables), false);
    const teams = repo.listTeams();
    expect(teams).toHaveLength(1);
    expect(teams[0]).toMatchObject({ league: '1. Liga', own: true });
  });

  it('rechnet Quoten aus Rohwerten, Innings in Dritteln', () => {
    const db = openDatabase(':memory:');
    applyImport(db, planAccessImport(tables), false);
    const repo = createRepo(db);
    const player = repo.listPlayers()[0]!;
    const lines = statLines(repo.playerStats(player.id));
    expect(lines.batting[0]).toMatchObject({ avg: '.667', obp: '.750', slg: '.667', ops: '1.417' });
    expect(lines.pitchingTotal).toMatchObject({ ip: '4.2', era: '3.86', whip: '0.86' });
  });

  it('löscht Statistik mit dem Spieler', () => {
    const db = openDatabase(':memory:');
    applyImport(db, planAccessImport(tables), false);
    const repo = createRepo(db);
    repo.deletePlayer(repo.listPlayers()[0]!.id);
    expect((db.prepare('SELECT COUNT(*) AS n FROM batting_stats').get() as { n: number }).n).toBe(0);
  });
});

describe('Import über HTTP', () => {
  let dir: string;
  let server: RunningServer;
  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'seamcast-import-'));
    server = await startServer({ port: 0, dataDir: dir, log: () => {} });
  });
  afterEach(async () => {
    await server.close();
    await rm(dir, { recursive: true, force: true });
  });

  it('meldet eine unlesbare Datei verständlich', async () => {
    const res = await fetch(`http://127.0.0.1:${server.port}/api/import/access`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: Buffer.from('das ist keine access datei'),
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toContain('Access');
  });

  it('lehnt fremde Herkunft ab', async () => {
    const res = await fetch(`http://127.0.0.1:${server.port}/api/import/access`, {
      method: 'POST',
      headers: { Origin: 'http://evil.example' },
      body: Buffer.alloc(10),
    });
    expect(res.status).toBe(403);
  });
});

// Optionaler Test mit einer echten Datei; die Datei gehört nicht ins Repository.
const REAL = process.env.SEAMCAST_TEST_ACCDB;
describe.skipIf(!REAL || !existsSync(REAL))('echte Access-Datei', () => {
  it('lässt sich lesen und importieren', () => {
    const db = openDatabase(':memory:');
    const report = importFromAccess(db, readFileSync(REAL as string), false);
    expect(report.teams.created).toBeGreaterThan(0);
    expect(report.players.created).toBeGreaterThan(0);
  });
});
