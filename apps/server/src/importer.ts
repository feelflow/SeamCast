import type { DatabaseSync } from 'node:sqlite';
import MDBReader from 'mdb-reader';
import { planAccessImport, type AccessTables, type ImportPlan, type RawRow } from '@seamcast/core';

export interface ImportReport {
  dryRun: boolean;
  teams: { created: number; updated: number };
  players: { created: number; updated: number };
  batting: { created: number; updated: number };
  pitching: { created: number; updated: number };
  warnings: string[];
}

/** Liest die benötigten Tabellen aus einer Access-Datei (.accdb/.mdb). Wirft bei unlesbaren Dateien. */
export function readAccessTables(buffer: Buffer): AccessTables {
  const reader = new MDBReader(buffer);
  const names = reader.getTableNames();
  const table = (name: string): RawRow[] => {
    if (!names.includes(name)) throw new Error(`Tabelle „${name}“ fehlt`);
    return reader.getTable(name).getData() as RawRow[];
  };
  return {
    teams: table('Teams'),
    players: table('Players'),
    offense: table('Offense_Stats'),
    pitching: table('Pitching_Stats'),
  };
}

const BATTING_COLUMNS = ['g', 'pa', 'ab', 'r', 'h', 'rbi', 'doubles', 'triples', 'hr', 'sb', 'cs', 'pick', 'bb', 'so', 'hbp', 'sh', 'sf', 'ibb', 'gidp', 'lob'] as const;
const PITCHING_COLUMNS = ['g', 'gs', 'cg', 'h', 'r', 'er', 'bb', 'so', 'hbp', 'wp', 'bk', 'w', 'l', 'sv', 'bs', 'svOpp', 'hold', 'bf', 'gb', 'fb', 'a1b', 'a2b', 'a3b', 'hr', 'sh', 'ipThirds'] as const;
const snake = (name: string): string => name.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);

/**
 * Schreibt den Importplan in die Datenbank. Bestehende Einträge werden aktualisiert
 * (Mannschaft nach Name, Spieler nach Liga-ID, Statistik nach Spieler/Saison/Runde),
 * der Import lässt sich also wiederholen. Bei `dryRun` wird alles zurückgerollt.
 */
export function applyImport(db: DatabaseSync, plan: ImportPlan, dryRun: boolean): ImportReport {
  const report: ImportReport = {
    dryRun,
    teams: { created: 0, updated: 0 },
    players: { created: 0, updated: 0 },
    batting: { created: 0, updated: 0 },
    pitching: { created: 0, updated: 0 },
    warnings: [...plan.warnings],
  };

  db.exec('BEGIN');
  try {
    const teamIds = new Map<string, number>();
    for (const team of plan.teams) {
      const lower = team.name.toLocaleLowerCase('de');
      const exact = db
        .prepare('SELECT id FROM teams WHERE name = ? COLLATE NOCASE AND league = ? COLLATE NOCASE')
        .get(team.name, team.league) as { id: number } | undefined;
      const withoutLeague = exact
        ? undefined
        : (db.prepare("SELECT id FROM teams WHERE name = ? COLLATE NOCASE AND league = ''").get(team.name) as { id: number } | undefined);
      const existing = exact ?? withoutLeague;
      if (existing) {
        db.prepare('UPDATE teams SET short = ?, league = ?, logo = CASE WHEN ? <> \'\' THEN ? ELSE logo END WHERE id = ?').run(
          team.short, team.league, team.logo, team.logo, existing.id,
        );
        teamIds.set(lower, existing.id);
        report.teams.updated++;
      } else {
        const result = db
          .prepare('INSERT INTO teams (name, short, league, logo) VALUES (?, ?, ?, ?)')
          .run(team.name, team.short, team.league, team.logo);
        teamIds.set(lower, Number(result.lastInsertRowid));
        report.teams.created++;
      }
    }

    const playerIds = new Map<string, number>();
    for (const player of plan.players) {
      const teamId = teamIds.get(player.teamName.toLocaleLowerCase('de')) as number;
      const existing = db.prepare('SELECT id FROM players WHERE external_id = ?').get(player.externalId) as { id: number } | undefined;
      if (existing) {
        db.prepare(
          'UPDATE players SET team_id = ?, last_name = ?, first_name = ?, nationality = ?, number = ?, bats = ?, throws = ? WHERE id = ?',
        ).run(teamId, player.lastName, player.firstName, player.nationality, player.number, player.bats, player.throws, existing.id);
        playerIds.set(player.externalId, existing.id);
        report.players.updated++;
      } else {
        const result = db
          .prepare(
            'INSERT INTO players (team_id, external_id, last_name, first_name, nationality, number, bats, throws) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
          )
          .run(teamId, player.externalId, player.lastName, player.firstName, player.nationality, player.number, player.bats, player.throws);
        playerIds.set(player.externalId, Number(result.lastInsertRowid));
        report.players.created++;
      }
    }

    const upsert = (table: 'batting_stats' | 'pitching_stats', columns: readonly string[], rows: Array<Record<string, unknown>>, bucket: { created: number; updated: number }) => {
      const sqlColumns = columns.map(snake);
      const all = ['player_id', 'season', 'round_id', 'round_name', 'league', ...sqlColumns];
      const exists = db.prepare(`SELECT id FROM ${table} WHERE player_id = ? AND season = ? AND round_id = ?`);
      const statement = db.prepare(
        `INSERT INTO ${table} (${all.join(', ')}) VALUES (${all.map(() => '?').join(', ')})
         ON CONFLICT (player_id, season, round_id) DO UPDATE SET ${all.slice(3).map((c) => `${c} = excluded.${c}`).join(', ')}`,
      );
      for (const row of rows) {
        const playerId = playerIds.get(String(row.externalId));
        if (playerId === undefined) continue;
        const had = exists.get(playerId, row.season as number, row.roundId as number);
        statement.run(playerId, row.season as number, row.roundId as number, row.roundName as string, row.league as string, ...columns.map((c) => row[c] as number));
        if (had) bucket.updated++;
        else bucket.created++;
      }
    };
    upsert('batting_stats', BATTING_COLUMNS, plan.batting as unknown as Array<Record<string, unknown>>, report.batting);
    upsert('pitching_stats', PITCHING_COLUMNS, plan.pitching as unknown as Array<Record<string, unknown>>, report.pitching);

    db.exec(dryRun ? 'ROLLBACK' : 'COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
  return report;
}

export const importFromAccess = (db: DatabaseSync, buffer: Buffer, dryRun: boolean): ImportReport =>
  applyImport(db, planAccessImport(readAccessTables(buffer)), dryRun);
