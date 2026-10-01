import { describe, expect, it } from 'vitest';
import { parsePlayerInput, parseTeamInput } from '../src/index.js';

describe('parseTeamInput', () => {
  it('nimmt gültige Mannschaften an und putzt Text', () => {
    expect(
      parseTeamInput({ name: '  Heidenheim Heideköpfe ', short: 'HDH', league: '1. Liga', logo: 'club.png', own: true }),
    ).toEqual({ name: 'Heidenheim Heideköpfe', short: 'HDH', league: '1. Liga', logo: 'club.png', own: true });
  });

  it('füllt fehlende Nebenfelder mit Leerwerten', () => {
    expect(parseTeamInput({ name: 'A', short: 'A' })).toEqual({ name: 'A', short: 'A', league: '', logo: '', own: false });
  });

  it('weist Fehler ab: leer, zu lang, Pfade im Logo', () => {
    expect(parseTeamInput({ name: '', short: 'A' })).toBeNull();
    expect(parseTeamInput({ name: 'A', short: 'ABCDEFG' })).toBeNull();
    expect(parseTeamInput({ name: 'A', short: 'A', logo: '../x.png' })).toBeNull();
    expect(parseTeamInput({ name: 'A', short: 'A', logo: 'a/b.png' })).toBeNull();
    expect(parseTeamInput({ name: 'A', short: 'A', own: 'ja' })).toBeNull();
    expect(parseTeamInput(null)).toBeNull();
  });
});

describe('parsePlayerInput', () => {
  const ok = { teamId: 3, lastName: 'Redle', firstName: 'Elias', number: 7, nationality: 'de', bats: 'R', throws: 'L' };

  it('nimmt gültige Spieler an', () => {
    expect(parsePlayerInput(ok)).toEqual({ ...ok, nationality: 'DE', externalId: '' });
  });

  it('erlaubt unbekannte Nummer und leere Händigkeit', () => {
    const player = parsePlayerInput({ teamId: 1, lastName: 'X', number: null, bats: '', throws: '' });
    expect(player).toMatchObject({ number: null, bats: '', throws: '' });
  });

  it('weist Fehler ab', () => {
    expect(parsePlayerInput({ ...ok, lastName: ' ' })).toBeNull();
    expect(parsePlayerInput({ ...ok, teamId: 0 })).toBeNull();
    expect(parsePlayerInput({ ...ok, number: 1000 })).toBeNull();
    expect(parsePlayerInput({ ...ok, number: 1.5 })).toBeNull();
    expect(parsePlayerInput({ ...ok, bats: 'X' })).toBeNull();
    expect(parsePlayerInput({ ...ok, throws: 'S' })).toBeNull();
    expect(parsePlayerInput({ ...ok, nationality: 'DEUT' })).toBeNull();
  });
});
