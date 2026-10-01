import { describe, expect, it } from 'vitest';
import { parseAction } from '../src/index.js';

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

  it('weist Unsinn ab', () => {
    expect(parseAction(null)).toBeNull();
    expect(parseAction('ball')).toBeNull();
    expect(parseAction([])).toBeNull();
    expect(parseAction({})).toBeNull();
    expect(parseAction({ type: 'drop table' })).toBeNull();
    expect(parseAction({ type: '__proto__' })).toBeNull();
  });
});
