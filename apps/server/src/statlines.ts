import { avg, era, formatInnings, formatRate, obp, ops, slg, whip } from '@seamcast/core';

type Row = Record<string, number | string>;
const n = (row: Row, key: string): number => Number(row[key] ?? 0);

const BAT_SUM = ['g', 'pa', 'ab', 'r', 'h', 'rbi', 'doubles', 'triples', 'hr', 'sb', 'cs', 'bb', 'so', 'hbp', 'sh', 'sf'];
const PIT_SUM = ['g', 'gs', 'h', 'r', 'er', 'bb', 'so', 'hbp', 'w', 'l', 'sv', 'bf', 'hr', 'ip_thirds'];

const sum = (rows: Row[], keys: string[]): Row => Object.fromEntries(keys.map((k) => [k, rows.reduce((total, r) => total + n(r, k), 0)]));

function batting(row: Row) {
  const tb = n(row, 'h') + n(row, 'doubles') + 2 * n(row, 'triples') + 3 * n(row, 'hr');
  const onBase = obp(n(row, 'h'), n(row, 'bb'), n(row, 'hbp'), n(row, 'ab'), n(row, 'sf'));
  const slug = slg(tb, n(row, 'ab'));
  return {
    ...row,
    avg: formatRate(avg(n(row, 'h'), n(row, 'ab'))),
    obp: formatRate(onBase),
    slg: formatRate(slug),
    ops: formatRate(ops(onBase, slug)),
  };
}

function pitching(row: Row) {
  const thirds = n(row, 'ip_thirds');
  return {
    ...row,
    ip: formatInnings(thirds),
    wl: `${n(row, 'w')}-${n(row, 'l')}`,
    era: formatRate(era(n(row, 'er'), thirds), { digits: 2, leadingZero: true }),
    whip: formatRate(whip(n(row, 'bb'), n(row, 'h'), thirds), { digits: 2, leadingZero: true }),
  };
}

/** Rohwerte der Statistik samt berechneten Quoten (Innings in Dritteln, ERA auf 9 Innings) und Summe über alle Runden. */
export function statLines(data: { batting: Row[]; pitching: Row[] }) {
  return {
    batting: data.batting.map(batting),
    pitching: data.pitching.map(pitching),
    battingTotal: data.batting.length ? batting(sum(data.batting, BAT_SUM)) : null,
    pitchingTotal: data.pitching.length ? pitching(sum(data.pitching, PIT_SUM)) : null,
  };
}
