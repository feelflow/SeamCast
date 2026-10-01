import { describe, expect, it } from 'vitest';
import {
  avg,
  era,
  formatInnings,
  formatRate,
  obp,
  ops,
  parseInnings,
  slg,
  whip,
} from '../src/index.js';

describe('Innings Pitched in Dritteln', () => {
  it('liest die Baseball-Schreibweise mit Komma und Punkt', () => {
    expect(parseInnings('4,2')).toBe(14);
    expect(parseInnings('4.2')).toBe(14);
    expect(parseInnings('0,1')).toBe(1);
    expect(parseInnings('5')).toBe(15);
    expect(parseInnings(2)).toBe(6);
  });

  it('weist ungültige Werte ab', () => {
    expect(parseInnings('4.5')).toBeNull();
    expect(parseInnings('')).toBeNull();
    expect(parseInnings('abc')).toBeNull();
    expect(parseInnings('4.10')).toBeNull();
  });

  it('schreibt Drittel wieder in Baseball-Schreibweise', () => {
    expect(formatInnings(14)).toBe('4.2');
    expect(formatInnings(15)).toBe('5.0');
    expect(formatInnings(1)).toBe('0.1');
  });
});

describe('Kennzahlen', () => {
  it('rechnet die ERA mit echten Dritteln (4⅔ Innings, 2 ER)', () => {
    const thirds = parseInnings('4,2');
    expect(thirds).not.toBeNull();
    // 2 * 9 / (14 / 3) = 3.857...; mit dem Dezimalwert 4,2 käme fälschlich 4,29 heraus
    expect(formatRate(era(2, thirds ?? 0), { digits: 2, leadingZero: true })).toBe('3.86');
  });

  it('rechnet die ERA im Softball auf 7 Innings hoch', () => {
    expect(formatRate(era(1, 21, 7), { digits: 2, leadingZero: true })).toBe('1.00');
  });

  it('rechnet die WHIP aus Walks, Hits und Dritteln', () => {
    // 5 Hits, 0 Walks in 2 Innings
    expect(whip(0, 5, 6)).toBe(2.5);
  });

  it('liefert null statt Division durch null', () => {
    expect(avg(0, 0)).toBeNull();
    expect(obp(0, 0, 0, 0, 0)).toBeNull();
    expect(era(0, 0)).toBeNull();
    expect(whip(1, 1, 0)).toBeNull();
  });

  it('berechnet OBP, SLG und OPS wie in der Access-Vorlage', () => {
    // 2 Hits in 3 At-Bats, 1 Walk
    const onBase = obp(2, 1, 0, 3, 0);
    expect(formatRate(onBase)).toBe('.750');
    const slugging = slg(2, 3);
    expect(formatRate(slugging)).toBe('.667');
    expect(formatRate(ops(onBase, slugging), { digits: 3, leadingZero: true })).toBe('1.417');
  });
});

describe('Darstellung', () => {
  it('lässt die führende Null weg, außer ab 1', () => {
    expect(formatRate(0.25)).toBe('.250');
    expect(formatRate(1)).toBe('1.000');
    expect(formatRate(1.417)).toBe('1.417');
  });

  it('kann Komma, führende Null und Platzhalter umstellen', () => {
    expect(formatRate(0.25, { decimalSeparator: ',', leadingZero: true })).toBe('0,250');
    expect(formatRate(null)).toBe('-');
    expect(formatRate(null, { placeholder: '–' })).toBe('–');
  });
});
