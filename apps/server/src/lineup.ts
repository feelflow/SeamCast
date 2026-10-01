import type { Side } from '@seamcast/core';
import type { Repo } from './db.js';

export interface LineupSlot {
  playerId: number;
  /** Feldposition, frei als Kürzel (P, C, 1B … DH), höchstens 3 Zeichen */
  pos: string;
}

export type Lineups = Record<Side, LineupSlot[]>;

export const MAX_SLOTS = 12;

export const emptyLineups = (): Lineups => ({ away: [], home: [] });

/** Prüft die Eingabe; null bei Fehlern (zu lang, doppelte Spieler, ungültige Werte). */
export function parseSlots(value: unknown): LineupSlot[] | null {
  if (!Array.isArray(value) || value.length > MAX_SLOTS) return null;
  const seen = new Set<number>();
  const out: LineupSlot[] = [];
  for (const raw of value) {
    if (typeof raw !== 'object' || raw === null) return null;
    const { playerId, pos } = raw as { playerId?: unknown; pos?: unknown };
    if (typeof playerId !== 'number' || !Number.isInteger(playerId) || playerId <= 0 || seen.has(playerId)) return null;
    if (typeof pos !== 'string' || pos.length > 3) return null;
    seen.add(playerId);
    out.push({ playerId, pos: pos.trim().toUpperCase() });
  }
  return out;
}

export function readLineups(saved: unknown): Lineups {
  const result = emptyLineups();
  const raw = (saved as { lineups?: Record<string, unknown> } | null)?.lineups;
  if (!raw || typeof raw !== 'object') return result;
  for (const side of ['away', 'home'] as const) result[side] = parseSlots(raw[side]) ?? [];
  return result;
}

export interface LineupRow {
  playerId: number;
  order: number;
  pos: string;
  number: number | null;
  firstName: string;
  lastName: string;
}

/** Anzeige-Daten; gelöschte Spieler fallen heraus. */
export function buildLineup(repo: Repo, slots: LineupSlot[]): LineupRow[] {
  const rows: LineupRow[] = [];
  slots.forEach((slot) => {
    const player = repo.getPlayer(slot.playerId);
    if (!player) return;
    rows.push({
      playerId: slot.playerId,
      order: rows.length + 1,
      pos: slot.pos,
      number: player.number,
      firstName: player.firstName,
      lastName: player.lastName,
    });
  });
  return rows;
}
