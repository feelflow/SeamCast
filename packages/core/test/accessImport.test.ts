import { describe, expect, it } from 'vitest';
import { planAccessImport, type AccessTables } from '../src/index.js';

const tables = (extra: Partial<AccessTables> = {}): AccessTables => ({
  teams: [
    { Team: 'Heidenheim Heideköpfe', League: '(1. Baseball-Bundesliga)', Short: 'HDH', 'Logo URL': 'logo.png' },
    { Team: 'Hünstetten Storm', League: '(1. Baseball-Bundesliga)', Short: 'HUN', 'Logo URL': '../böse.png' },
  ],
  players: [
    { TeamShort: 'Heidenheim Heideköpfe', ID: 22013, Lastname: 'Redle', Name: 'Elias', Nationality: 'DE', UniformNr: 21, Bats: 'R', Throws: 'R' },
    { TeamShort: 'Hünstetten STORM', ID: 100, Lastname: 'Fremd', Name: 'Max', Nationality: 'de', UniformNr: null, Bats: 'L', Throws: 'S' },
    { TeamShort: 'Unbekannt', ID: 200, Lastname: 'Verirrt', Name: '', Nationality: '', UniformNr: 1, Bats: 'R', Throws: 'R' },
    { TeamShort: 'Heidenheim Heideköpfe', ID: 22013, Lastname: 'Doppelt', Name: '', Nationality: '', UniformNr: 2, Bats: 'R', Throws: 'R' },
  ],
  offense: [
    { 'Off_ UniqueID': 'x', 'Off_ RoundID': 10106, Off_Year: 2026, Off_RoundName: 'Play-Off', Off_League: 'DBL 2026', Off_PlayerID: 22013, Off_Player: 'Redle', Off_G: 1, Off_PA: 4, Off_AB: 4, Off_H: 2, Off_2B: 1, Off_BA: '.500', F36: null },
    { 'Off_ RoundID': 10106, Off_Year: 2026, Off_PlayerID: 999, Off_Player: 'Niemand' },
  ],
  pitching: [
    { Pit_RoundID: 10106, Pit_Year: 2026, Pit_RoundName: 'Play-Off', Pit_League: 'DBL 2026', Pit_PlayerID: 22013, Pit_Player: 'Redle', Pit_G: 1, Pit_ER: 2, Pit_IP: '4,2' },
    { Pit_RoundID: 10106, Pit_Year: 2026, Pit_PlayerID: 22013, Pit_Player: 'Redle', Pit_IP: '4,7' },
  ],
  ...extra,
});

describe('planAccessImport', () => {
  const plan = planAccessImport(tables());

  it('übernimmt Mannschaften, entfernt Klammern um die Liga und verwirft unsichere Logos', () => {
    expect(plan.teams).toEqual([
      { name: 'Heidenheim Heideköpfe', short: 'HDH', league: '1. Baseball-Bundesliga', logo: 'logo.png' },
      { name: 'Hünstetten Storm', short: 'HUN', league: '1. Baseball-Bundesliga', logo: '' },
    ]);
    expect(plan.warnings.some((w) => w.includes('Logo von „Hünstetten Storm“'))).toBe(true);
  });

  it('ordnet Spieler unabhängig von Groß-/Kleinschreibung zu und räumt Fehler auf', () => {
    expect(plan.players.map((p) => [p.externalId, p.teamName, p.nationality])).toEqual([
      ['22013', 'Heidenheim Heideköpfe', 'DE'],
      ['100', 'Hünstetten Storm', 'DE'],
    ]);
    expect(plan.players[1]).toMatchObject({ number: null, bats: 'L', throws: '' });
    expect(plan.warnings.some((w) => w.includes('Wurfhand „S“'))).toBe(true);
    expect(plan.warnings.some((w) => w.includes('Mannschaft „Unbekannt“'))).toBe(true);
    expect(plan.warnings.some((w) => w.includes('22013') && w.includes('doppelt'))).toBe(true);
  });

  it('liest Schlagstatistik trotz Leerzeichen in Spaltennamen und ignoriert gespeicherte Quoten', () => {
    expect(plan.batting).toHaveLength(1);
    expect(plan.batting[0]).toMatchObject({ externalId: '22013', season: 2026, roundId: 10106, roundName: 'Play-Off', ab: 4, h: 2, doubles: 1, bb: 0 });
    expect(plan.warnings.some((w) => w.includes('Niemand'))).toBe(true);
  });

  it('rechnet Innings Pitched in Drittel und überspringt ungültige', () => {
    expect(plan.pitching).toHaveLength(1);
    expect(plan.pitching[0]).toMatchObject({ er: 2, ipThirds: 14 });
    expect(plan.warnings.some((w) => w.includes('„4,7“'))).toBe(true);
  });

  it('behandelt leere Tabellen', () => {
    const empty = planAccessImport({ teams: [], players: [], offense: [], pitching: [] });
    expect(empty).toEqual({ teams: [], players: [], batting: [], pitching: [], warnings: [] });
  });
});
