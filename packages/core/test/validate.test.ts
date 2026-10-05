import { describe, expect, it } from 'vitest';
import { createGame, parseAction, parseGameState } from '../src/index.js';

describe('parseAction', () => {
  it('akzeptiert einfache Aktionen und verwirft Zusatzfelder', () => {
    expect(parseAction({ type: 'ball', evil: 'x' })).toEqual({ type: 'ball' });
    expect(parseAction({ type: 'newPitcher' })).toEqual({ type: 'newPitcher' });
  });

  it('prüft Treffer, Bases, Punkte und Teams', () => {
    expect(parseAction({ type: 'hit', bases: 4 })).toEqual({ type: 'hit', bases: 4 });
    expect(parseAction({ type: 'hit', bases: 5 })).toBeNull();
    expect(parseAction({ type: 'setBases', bases: [true, false, true] })).toEqual({
      type: 'setBases',
      bases: [true, false, true],
    });
    expect(parseAction({ type: 'setBases', bases: [true, false] })).toBeNull();
    expect(parseAction({ type: 'adjustScore', side: 'home', delta: 1 })).not.toBeNull();
    expect(parseAction({ type: 'adjustScore', side: 'center', delta: 1 })).toBeNull();
    expect(parseAction({ type: 'adjustScore', side: 'home', delta: 1000 })).toBeNull();
    expect(parseAction({ type: 'adjustScore', side: 'home', delta: 1.5 })).toBeNull();
    expect(parseAction({ type: 'setTeam', side: 'away', name: 'A', short: 'B' })).not.toBeNull();
    expect(parseAction({ type: 'setTeam', side: 'away', name: 1, short: 'B' })).toBeNull();
    expect(parseAction({ type: 'setRules', rulesId: 'softball7' })).not.toBeNull();
    expect(parseAction({ type: 'setRules', rulesId: 'cricket' })).toBeNull();
  });

  it('prüft die Läufer-Auswahl bei Treffern', () => {
    expect(parseAction({ type: 'hit', bases: 2, runners: [0, 1, 2] })).toEqual({
      type: 'hit',
      bases: 2,
      runners: [0, 1, 2],
    });
    expect(parseAction({ type: 'hit', bases: 2, runners: [0, 1] })).toBeNull();
    expect(parseAction({ type: 'hit', bases: 2, runners: [0, 9, 0] })).toBeNull();
    expect(parseAction({ type: 'hit', bases: 2, runners: 'x' })).toBeNull();
  });

  it('weist Unsinn ab', () => {
    expect(parseAction(null)).toBeNull();
    expect(parseAction('ball')).toBeNull();
    expect(parseAction([])).toBeNull();
    expect(parseAction({})).toBeNull();
    expect(parseAction({ type: 'drop table' })).toBeNull();
    expect(parseAction({ type: '__proto__' })).toBeNull();
  });
});

describe('setBatterIndex und alter Spielstand', () => {
  it('prüft Seite und Bereich', () => {
    expect(parseAction({ type: 'setBatterIndex', side: 'away', index: 3 })).toEqual({ type: 'setBatterIndex', side: 'away', index: 3 });
    expect(parseAction({ type: 'setBatterIndex', side: 'x', index: 3 })).toBeNull();
    expect(parseAction({ type: 'setBatterIndex', side: 'home', index: -1 })).toBeNull();
    expect(parseAction({ type: 'setBatterIndex', side: 'home', index: 1.5 })).toBeNull();
  });

  it('liest alte Spielstände ohne batterIndex mit 0, lehnt kaputte ab', () => {
    const { batterIndex: _unused, ...old } = createGame();
    expect(parseGameState(old)?.batterIndex).toEqual({ away: 0, home: 0 });
    expect(parseGameState({ ...old, batterIndex: { away: -1, home: 0 } })).toBeNull();
  });
});

describe('Neue Spielzüge', () => {
  it('nimmt gültige Eingaben an', () => {
    expect(parseAction({ type: 'intentionalWalk' })).toEqual({ type: 'intentionalWalk' });
    expect(parseAction({ type: 'balk' })).toEqual({ type: 'balk' });
    expect(parseAction({ type: 'out' })).toEqual({ type: 'out' });
    expect(parseAction({ type: 'out', runners: [-1, 0, 1] })).toEqual({ type: 'out', runners: [-1, 0, 1] });
    expect(parseAction({ type: 'advance', runners: [1, 0, 0] })).toEqual({ type: 'advance', runners: [1, 0, 0] });
  });

  it('lehnt ungültige Läuferangaben ab', () => {
    expect(parseAction({ type: 'advance' })).toBeNull();
    expect(parseAction({ type: 'advance', runners: [1, 0] })).toBeNull();
    expect(parseAction({ type: 'advance', runners: [9, 0, 0] })).toBeNull();
    expect(parseAction({ type: 'out', runners: 'x' })).toBeNull();
  });
});
