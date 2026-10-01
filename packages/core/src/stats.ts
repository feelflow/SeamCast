/**
 * Statistikberechnung aus Rohwerten.
 *
 * Innings Pitched stehen im Baseball in der Schreibweise „4.2“ (oder „4,2“):
 * die Stelle nach dem Trennzeichen zählt Drittel, nicht Zehntel. 4.2 sind also
 * 4⅔ Innings. Intern rechnen wir deshalb in Dritteln.
 */
export type Thirds = number;

/** Liest „4.2“, „4,2“ oder „5“. Ungültige Werte (etwa „4.5“) ergeben null. */
export function parseInnings(input: string | number): Thirds | null {
  const text = String(input).trim().replace(',', '.');
  const match = /^(\d+)(?:\.([0-2]))?$/.exec(text);
  if (!match) return null;
  return Number(match[1]) * 3 + Number(match[2] ?? 0);
}

/** Schreibt Drittel in Baseball-Schreibweise: 14 → „4.2“. */
export function formatInnings(thirds: Thirds): string {
  return `${Math.floor(thirds / 3)}.${thirds % 3}`;
}

const ratio = (numerator: number, denominator: number): number | null =>
  denominator > 0 ? numerator / denominator : null;

/** Schlagdurchschnitt: Hits durch At-Bats */
export const avg = (hits: number, atBats: number): number | null => ratio(hits, atBats);

/** On-Base-Quote: (H + BB + HBP) durch (AB + BB + HBP + SF) */
export const obp = (
  hits: number,
  walks: number,
  hitByPitch: number,
  atBats: number,
  sacrificeFlies: number,
): number | null => ratio(hits + walks + hitByPitch, atBats + walks + hitByPitch + sacrificeFlies);

/** Slugging: Total Bases durch At-Bats */
export const slg = (totalBases: number, atBats: number): number | null =>
  ratio(totalBases, atBats);

export const ops = (onBase: number | null, slugging: number | null): number | null =>
  onBase === null || slugging === null ? null : onBase + slugging;

/** ERA: verdiente Runs, hochgerechnet auf `eraInnings` Innings (Baseball 9, Softball 7). */
export const era = (earnedRuns: number, thirds: Thirds, eraInnings = 9): number | null =>
  thirds > 0 ? (earnedRuns * eraInnings) / (thirds / 3) : null;

/** WHIP: (BB + H) durch Innings Pitched */
export const whip = (walks: number, hits: number, thirds: Thirds): number | null =>
  thirds > 0 ? (walks + hits) / (thirds / 3) : null;

export interface RateFormat {
  /** Nachkommastellen, Standard 3 */
  digits?: number;
  /** „0.250“ statt „.250“, Standard false (US-Schreibweise). Werte ab 1 behalten immer ihre Ziffer. */
  leadingZero?: boolean;
  decimalSeparator?: '.' | ',';
  /** Anzeige bei fehlendem Wert, Standard „-“ */
  placeholder?: string;
}

export function formatRate(value: number | null, format: RateFormat = {}): string {
  const { digits = 3, leadingZero = false, decimalSeparator = '.', placeholder = '-' } = format;
  if (value === null || !Number.isFinite(value)) return placeholder;
  let text = value.toFixed(digits);
  if (!leadingZero && value < 1) text = text.replace(/^0/, '');
  return decimalSeparator === ',' ? text.replace('.', ',') : text;
}
