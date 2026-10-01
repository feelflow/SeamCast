import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { Bats, Player, PlayerInput, Team, TeamInput, Throws } from '@seamcast/core';

/**
 * Schemaänderungen kommen immer als neuer Eintrag ans Ende der Liste;
 * `PRAGMA user_version` merkt sich, wie weit die Datei schon ist.
 */
const MIGRATIONS: string[] = [
  `
  CREATE TABLE teams (
    id      INTEGER PRIMARY KEY,
    name    TEXT NOT NULL,
    short   TEXT NOT NULL,
    league  TEXT NOT NULL DEFAULT '',
    logo    TEXT NOT NULL DEFAULT '',
    own     INTEGER NOT NULL DEFAULT 0
  );
  CREATE UNIQUE INDEX teams_name ON teams (name COLLATE NOCASE, league COLLATE NOCASE);

  CREATE TABLE players (
    id          INTEGER PRIMARY KEY,
    team_id     INTEGER NOT NULL REFERENCES teams (id) ON DELETE CASCADE,
    external_id TEXT NOT NULL DEFAULT '',
    last_name   TEXT NOT NULL,
    first_name  TEXT NOT NULL DEFAULT '',
    nationality TEXT NOT NULL DEFAULT '',
    number      INTEGER,
    bats        TEXT NOT NULL DEFAULT '',
    throws      TEXT NOT NULL DEFAULT ''
  );
  CREATE INDEX players_team ON players (team_id);
  CREATE UNIQUE INDEX players_external ON players (external_id) WHERE external_id <> '';
  `,
  // Statistik: nur Rohwerte (Quoten wie AVG oder ERA rechnet SeamCast aus), ein Eintrag je Spieler, Saison und Runde
  `
  CREATE TABLE batting_stats (
    id INTEGER PRIMARY KEY,
    player_id INTEGER NOT NULL REFERENCES players (id) ON DELETE CASCADE,
    season INTEGER NOT NULL, round_id INTEGER NOT NULL, round_name TEXT NOT NULL DEFAULT '', league TEXT NOT NULL DEFAULT '',
    g INTEGER NOT NULL DEFAULT 0, pa INTEGER NOT NULL DEFAULT 0, ab INTEGER NOT NULL DEFAULT 0, r INTEGER NOT NULL DEFAULT 0,
    h INTEGER NOT NULL DEFAULT 0, rbi INTEGER NOT NULL DEFAULT 0, doubles INTEGER NOT NULL DEFAULT 0, triples INTEGER NOT NULL DEFAULT 0,
    hr INTEGER NOT NULL DEFAULT 0, sb INTEGER NOT NULL DEFAULT 0, cs INTEGER NOT NULL DEFAULT 0, pick INTEGER NOT NULL DEFAULT 0,
    bb INTEGER NOT NULL DEFAULT 0, so INTEGER NOT NULL DEFAULT 0, hbp INTEGER NOT NULL DEFAULT 0, sh INTEGER NOT NULL DEFAULT 0,
    sf INTEGER NOT NULL DEFAULT 0, ibb INTEGER NOT NULL DEFAULT 0, gidp INTEGER NOT NULL DEFAULT 0, lob INTEGER NOT NULL DEFAULT 0,
    UNIQUE (player_id, season, round_id)
  );
  CREATE TABLE pitching_stats (
    id INTEGER PRIMARY KEY,
    player_id INTEGER NOT NULL REFERENCES players (id) ON DELETE CASCADE,
    season INTEGER NOT NULL, round_id INTEGER NOT NULL, round_name TEXT NOT NULL DEFAULT '', league TEXT NOT NULL DEFAULT '',
    g INTEGER NOT NULL DEFAULT 0, gs INTEGER NOT NULL DEFAULT 0, cg INTEGER NOT NULL DEFAULT 0, h INTEGER NOT NULL DEFAULT 0,
    r INTEGER NOT NULL DEFAULT 0, er INTEGER NOT NULL DEFAULT 0, bb INTEGER NOT NULL DEFAULT 0, so INTEGER NOT NULL DEFAULT 0,
    hbp INTEGER NOT NULL DEFAULT 0, wp INTEGER NOT NULL DEFAULT 0, bk INTEGER NOT NULL DEFAULT 0, w INTEGER NOT NULL DEFAULT 0,
    l INTEGER NOT NULL DEFAULT 0, sv INTEGER NOT NULL DEFAULT 0, bs INTEGER NOT NULL DEFAULT 0, sv_opp INTEGER NOT NULL DEFAULT 0,
    hold INTEGER NOT NULL DEFAULT 0, bf INTEGER NOT NULL DEFAULT 0, gb INTEGER NOT NULL DEFAULT 0, fb INTEGER NOT NULL DEFAULT 0,
    a1b INTEGER NOT NULL DEFAULT 0, a2b INTEGER NOT NULL DEFAULT 0, a3b INTEGER NOT NULL DEFAULT 0, hr INTEGER NOT NULL DEFAULT 0,
    sh INTEGER NOT NULL DEFAULT 0, ip_thirds INTEGER NOT NULL DEFAULT 0,
    UNIQUE (player_id, season, round_id)
  );
  `,
];

export function openDatabase(file: string): DatabaseSync {
  if (file !== ':memory:') mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;');
  const row = db.prepare('PRAGMA user_version').get() as { user_version: number };
  for (let version = row.user_version; version < MIGRATIONS.length; version++) {
    db.exec('BEGIN');
    try {
      db.exec(MIGRATIONS[version] as string);
      db.exec(`PRAGMA user_version = ${version + 1}`);
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }
  return db;
}

type Row = Record<string, unknown>;

const toTeam = (r: Row): Team & { playerCount: number } => ({
  id: Number(r.id),
  name: String(r.name),
  short: String(r.short),
  league: String(r.league),
  logo: String(r.logo),
  own: r.own === 1,
  playerCount: Number(r.player_count ?? 0),
});

const toPlayer = (r: Row): Player => ({
  id: Number(r.id),
  teamId: Number(r.team_id),
  externalId: String(r.external_id),
  lastName: String(r.last_name),
  firstName: String(r.first_name),
  nationality: String(r.nationality),
  number: r.number === null ? null : Number(r.number),
  bats: String(r.bats) as Bats,
  throws: String(r.throws) as Throws,
});

/** Ergebnis einer Schreibaktion: Erfolg, nicht gefunden oder Konflikt (doppelter Eintrag). */
export type Outcome<T> = { ok: true; value: T } | { ok: false; reason: 'notFound' | 'conflict' | 'badTeam' };

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Error && /UNIQUE constraint failed/i.test(error.message);
}

function isForeignKeyViolation(error: unknown): boolean {
  return error instanceof Error && /FOREIGN KEY constraint failed/i.test(error.message);
}

export function createRepo(db: DatabaseSync) {
  const teamSelect = `SELECT t.*, (SELECT COUNT(*) FROM players p WHERE p.team_id = t.id) AS player_count FROM teams t`;

  function team(id: number): (Team & { playerCount: number }) | null {
    const row = db.prepare(`${teamSelect} WHERE t.id = ?`).get(id);
    return row ? toTeam(row) : null;
  }

  function player(id: number): Player | null {
    const row = db.prepare('SELECT * FROM players WHERE id = ?').get(id);
    return row ? toPlayer(row) : null;
  }

  function guarded<T>(action: () => T): Outcome<T> {
    try {
      return { ok: true, value: action() };
    } catch (error) {
      if (isUniqueViolation(error)) return { ok: false, reason: 'conflict' };
      if (isForeignKeyViolation(error)) return { ok: false, reason: 'badTeam' };
      throw error;
    }
  }

  return {
    listTeams: () =>
      db
        .prepare(`${teamSelect} ORDER BY t.own DESC, t.name COLLATE NOCASE`)
        .all()
        .map(toTeam),

    createTeam: (input: TeamInput) =>
      guarded(() => {
        const result = db
          .prepare('INSERT INTO teams (name, short, league, logo, own) VALUES (?, ?, ?, ?, ?)')
          .run(input.name, input.short, input.league, input.logo, input.own ? 1 : 0);
        return team(Number(result.lastInsertRowid)) as Team & { playerCount: number };
      }),

    updateTeam: (id: number, input: TeamInput): Outcome<Team & { playerCount: number }> => {
      const result = guarded(() =>
        db
          .prepare('UPDATE teams SET name = ?, short = ?, league = ?, logo = ?, own = ? WHERE id = ?')
          .run(input.name, input.short, input.league, input.logo, input.own ? 1 : 0, id),
      );
      if (!result.ok) return result;
      const updated = team(id);
      return updated ? { ok: true, value: updated } : { ok: false, reason: 'notFound' };
    },

    deleteTeam: (id: number): boolean => Number(db.prepare('DELETE FROM teams WHERE id = ?').run(id).changes) > 0,

    listPlayers: (teamId?: number): Player[] =>
      (teamId === undefined
        ? db.prepare('SELECT * FROM players ORDER BY team_id, number, last_name COLLATE NOCASE').all()
        : db
            .prepare('SELECT * FROM players WHERE team_id = ? ORDER BY number IS NULL, number, last_name COLLATE NOCASE')
            .all(teamId)
      ).map(toPlayer),

    createPlayer: (input: PlayerInput) =>
      guarded(() => {
        const result = db
          .prepare(
            'INSERT INTO players (team_id, external_id, last_name, first_name, nationality, number, bats, throws) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
          )
          .run(input.teamId, input.externalId, input.lastName, input.firstName, input.nationality, input.number, input.bats, input.throws);
        return player(Number(result.lastInsertRowid)) as Player;
      }),

    updatePlayer: (id: number, input: PlayerInput): Outcome<Player> => {
      const result = guarded(() =>
        db
          .prepare(
            'UPDATE players SET team_id = ?, external_id = ?, last_name = ?, first_name = ?, nationality = ?, number = ?, bats = ?, throws = ? WHERE id = ?',
          )
          .run(input.teamId, input.externalId, input.lastName, input.firstName, input.nationality, input.number, input.bats, input.throws, id),
      );
      if (!result.ok) return result;
      const updated = player(id);
      return updated ? { ok: true, value: updated } : { ok: false, reason: 'notFound' };
    },

    playerStats: (playerId: number) => ({
      batting: db
        .prepare('SELECT * FROM batting_stats WHERE player_id = ? ORDER BY season DESC, round_id')
        .all(playerId) as Array<Record<string, number | string>>,
      pitching: db
        .prepare('SELECT * FROM pitching_stats WHERE player_id = ? ORDER BY season DESC, round_id')
        .all(playerId) as Array<Record<string, number | string>>,
    }),

    deletePlayer: (id: number): boolean => Number(db.prepare('DELETE FROM players WHERE id = ?').run(id).changes) > 0,
  };
}

export type Repo = ReturnType<typeof createRepo>;
