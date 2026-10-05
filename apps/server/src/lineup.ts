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

/**
 * Schlagreihenfolge: die Aufstellung in ihrer Reihenfolge. Gibt es einen DH oder EH,
 * schlägt der Pitcher (Position P) nicht mit und fällt heraus.
 */
export function battingOrder(slots: LineupSlot[]): LineupSlot[] {
  const hasDh = slots.some((x) => x.pos === 'DH' || x.pos === 'EH');
  return hasDh ? slots.filter((x) => x.pos !== 'P') : slots;
}

/** Schlagmann nach Zähler; die Reihenfolge läuft im Kreis. Null bei leerer Aufstellung. */
export function currentBatterId(slots: LineupSlot[], index: number): number | null {
  const order = battingOrder(slots);
  return order.length === 0 ? null : (order[index % order.length]?.playerId ?? null);
}

/** Pitcher = Spieler mit Position P; null, wenn keiner eingetragen ist. */
export function currentPitcherId(slots: LineupSlot[]): number | null {
  return slots.find((x) => x.pos === 'P')?.playerId ?? null;
}

/**
 * Neuer Pitcher in der Aufstellung. Steht der Spieler schon darin, bekommt er die Position P
 * (der bisherige Pitcher verliert sie). Sonst ersetzt er den bisherigen Pitcher an dessen
 * Platz in der Schlagreihenfolge, oder er wird hinten angefügt, wenn es keinen gab.
 * Null, wenn kein Platz mehr frei ist.
 */
export function withPitcher(slots: LineupSlot[], playerId: number): LineupSlot[] | null {
  if (currentPitcherId(slots) === playerId) return slots;
  const without = slots.map((x) => (x.pos === 'P' ? { ...x, pos: '' } : x));
  if (without.some((x) => x.playerId === playerId)) {
    return without.map((x) => (x.playerId === playerId ? { ...x, pos: 'P' } : x));
  }
  const oldIndex = slots.findIndex((x) => x.pos === 'P');
  if (oldIndex >= 0) {
    return slots.map((x, i) => (i === oldIndex ? { playerId, pos: 'P' } : x));
  }
  return slots.length >= MAX_SLOTS ? null : [...slots, { playerId, pos: 'P' }];
}
