import type { Side } from '@seamcast/core';
import type { Repo } from './db.js';
import { statLines } from './statlines.js';

/** Aktueller Schlagmann und Pitcher je Mannschaft (Spieler-IDs aus der Datenbank). */
export interface Matchup {
  batter: Record<Side, number | null>;
  pitcher: Record<Side, number | null>;
}

export const emptyMatchup = (): Matchup => ({
  batter: { away: null, home: null },
  pitcher: { away: null, home: null },
});

const id = (value: unknown): number | null =>
  typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : null;

export function readMatchup(saved: unknown): Matchup {
  const result = emptyMatchup();
  const raw = (saved as { matchup?: Record<string, Record<string, unknown>> } | null)?.matchup;
  if (!raw || typeof raw !== 'object') return result;
  for (const role of ['batter', 'pitcher'] as const) {
    for (const side of ['away', 'home'] as const) result[role][side] = id(raw[role]?.[side]);
  }
  return result;
}

export interface Card {
  playerId: number;
  name: string;
  firstName: string;
  lastName: string;
  number: number | null;
  teamShort: string;
  /** Logo-Datei der Mannschaft (reiner Dateiname aus dem Kader, liegt in config/assets); leer, wenn keine hinterlegt ist */
  teamLogo: string;
  bats: string;
  throws: string;
  /** Alle verfügbaren Kennzahlen als Text; welche gezeigt werden, bestimmt das Profil */
  stats: Record<string, string>;
}

/** Baut die Anzeige-Daten einer Spielerkarte; null, wenn der Spieler nicht (mehr) existiert. */
export function buildCard(repo: Repo, role: 'batter' | 'pitcher', playerId: number | null): Card | null {
  if (playerId === null) return null;
  const player = repo.getPlayer(playerId);
  if (!player) return null;
  const team = repo.getTeam(player.teamId);
  const lines = statLines(repo.playerStats(playerId));
  const total = role === 'batter' ? lines.battingTotal : lines.pitchingTotal;
  const stats: Record<string, string> = {};
  if (total) {
    for (const [key, value] of Object.entries(total)) {
      if (typeof value === 'number' || typeof value === 'string') stats[key] = String(value);
    }
  }
  return {
    playerId,
    name: `${player.firstName} ${player.lastName}`.trim(),
    firstName: player.firstName,
    lastName: player.lastName,
    number: player.number,
    teamShort: team?.short ?? '',
    teamLogo: team?.logo ?? '',
    bats: player.bats,
    throws: player.throws,
    stats,
  };
}
