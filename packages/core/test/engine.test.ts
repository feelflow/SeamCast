import { describe, expect, it } from 'vitest';
import { Game, createGame, reduce, type Action, type GameState } from '../src/index.js';

const run = (actions: Action[], start: GameState = createGame()): GameState =>
  actions.reduce(reduce, start);

const times = (count: number, action: Action): Action[] =>
  Array.from({ length: count }, () => action);

describe('Count, Walk und Strikeout', () => {
  it('zählt Balls und Strikes und deckelt nichts künstlich', () => {
    const state = run([{ type: 'ball' }, { type: 'ball' }, { type: 'strike' }]);
    expect(state).toMatchObject({ balls: 2, strikes: 1, outs: 0 });
  });

  it('vier Balls ergeben einen Walk und setzen den Count zurück', () => {
    const state = run(times(4, { type: 'ball' }));
    expect(state.bases).toEqual([true, false, false]);
    expect(state).toMatchObject({ balls: 0, strikes: 0, outs: 0 });
  });

  it('Walk bei voller Basebelegung bringt einen Run für das schlagende Team', () => {
    const loaded = run([{ type: 'setBases', bases: [true, true, true] }]);
    const state = run(times(4, { type: 'ball' }), loaded);
    expect(state.score).toEqual({ away: 1, home: 0 });
    expect(state.bases).toEqual([true, true, true]);
  });

  it('Walk schiebt nur Läufer weiter, die dazu gezwungen sind', () => {
    const runnerOnSecond = run([{ type: 'setBases', bases: [false, true, false] }]);
    const state = run(times(4, { type: 'ball' }), runnerOnSecond);
    expect(state.bases).toEqual([true, true, false]);
    expect(state.score.away).toBe(0);
  });

  it('drei Strikes ergeben einen Strikeout mit einem Out', () => {
    const state = run(times(3, { type: 'strike' }));
    expect(state).toMatchObject({ outs: 1, balls: 0, strikes: 0 });
  });

  it('Foul ist nie der letzte Strike', () => {
    const state = run([...times(2, { type: 'strike' }), ...times(5, { type: 'foul' })]);
    expect(state).toMatchObject({ strikes: 2, outs: 0 });
  });

  it('Foul bei null Strikes zählt als Strike', () => {
    expect(run([{ type: 'foul' }]).strikes).toBe(1);
  });
});

describe('Halbinning-Wechsel', () => {
  it('drei Outs beenden das Top-Inning und räumen Count, Outs und Bases', () => {
    const start = run([
      { type: 'setBases', bases: [true, true, false] },
      { type: 'ball' },
    ]);
    const state = run(times(3, { type: 'out' }), start);
    expect(state).toMatchObject({ half: 'bottom', inning: 1, outs: 0, balls: 0, strikes: 0 });
    expect(state.bases).toEqual([false, false, false]);
  });

  it('nach dem Bottom-Inning beginnt das nächste Inning', () => {
    const state = run([{ type: 'nextHalf' }, { type: 'nextHalf' }]);
    expect(state).toMatchObject({ half: 'top', inning: 2 });
  });

  it('manuell auf drei Outs gestellt, wechselt ebenfalls das Halbinning', () => {
    const state = run([{ type: 'adjustOuts', delta: 3 }]);
    expect(state).toMatchObject({ half: 'bottom', outs: 0 });
  });
});

describe('Treffer mit Läufer-Auswahl', () => {
  it('Läufer auf 2B bleibt bei einem Double auf 3B stehen, wenn der Bediener das wählt', () => {
    const start = run([{ type: 'setBases', bases: [false, true, false] }]);
    const state = run([{ type: 'hit', bases: 2, runners: [0, 1, 0] }], start);
    expect(state.score.away).toBe(0);
    expect(state.bases).toEqual([false, true, true]);
  });

  it('Läufer kann gezielt nach Hause geschickt werden', () => {
    const start = run([{ type: 'setBases', bases: [true, false, false] }]);
    const state = run([{ type: 'hit', bases: 1, runners: [3, 0, 0] }], start);
    expect(state.score.away).toBe(1);
    expect(state.bases).toEqual([true, false, false]);
  });
});

describe('Läufer out', () => {
  it('Läufer-Out nimmt den Läufer von der Base und zählt ein Out, der Count bleibt', () => {
    const start = run([
      { type: 'setBases', bases: [true, true, false] },
      { type: 'ball' },
    ]);
    const state = run([{ type: 'runnerOut', base: 2 }], start);
    expect(state.bases).toEqual([true, false, false]);
    expect(state.outs).toBe(1);
    expect(state.balls).toBe(1);
  });

  it('Läufer-Out auf eine leere Base ändert nichts', () => {
    const start = run([]);
    expect(run([{ type: 'runnerOut', base: 1 }], start)).toBe(start);
  });

  it('drittes Out als Läufer beendet das Halbinning', () => {
    const start = run([
      { type: 'setBases', bases: [false, true, false] },
      { type: 'adjustOuts', delta: 2 },
    ]);
    const state = run([{ type: 'runnerOut', base: 2 }], start);
    expect(state.half).toBe('bottom');
    expect(state.outs).toBe(0);
  });

  it('Treffer mit Läufer-Out: Out gezählt, Schlagmann auf Base', () => {
    const start = run([{ type: 'setBases', bases: [false, true, false] }]);
    const state = run([{ type: 'hit', bases: 1, runners: [0, -1, 0] }], start);
    expect(state.outs).toBe(1);
    expect(state.bases).toEqual([true, false, false]);
    expect(state.score.away).toBe(0);
  });
});

describe('Neues Spiel', () => {
  it('setzt alles zurück, behält aber Teams und Regeln', () => {
    const start = run([
      { type: 'setTeam', side: 'home', name: 'Heideköpfe', short: 'HEI' },
      { type: 'setRules', rulesId: 'softball7' },
      { type: 'hit', bases: 4 },
      { type: 'nextHalf' },
      { type: 'strike' },
    ]);
    const state = run([{ type: 'newGame' }], start);
    expect(state.score).toEqual({ away: 0, home: 0 });
    expect(state.inning).toBe(1);
    expect(state.half).toBe('top');
    expect(state.pitches).toEqual({ away: 0, home: 0 });
    expect(state.strikes).toBe(0);
    expect(state.teams.home.short).toBe('HEI');
    expect(state.rules.id).toBe('softball7');
  });
});

describe('Treffer', () => {
  it('Single setzt den Schlagmann auf 1B und rückt Läufer eine Base vor', () => {
    const start = run([{ type: 'setBases', bases: [true, false, true] }]);
    const state = run([{ type: 'hit', bases: 1 }], start);
    expect(state.bases).toEqual([true, true, false]);
    expect(state.score.away).toBe(1);
  });

  it('Homerun bei voller Basebelegung ist ein Grand Slam mit vier Runs', () => {
    const start = run([{ type: 'setBases', bases: [true, true, true] }]);
    const state = run([{ type: 'hit', bases: 4 }], start);
    expect(state.score.away).toBe(4);
    expect(state.bases).toEqual([false, false, false]);
  });

  it('Double rückt Läufer von 2B und 3B nach Hause', () => {
    const start = run([{ type: 'setBases', bases: [false, true, true] }]);
    const state = run([{ type: 'hit', bases: 2 }], start);
    expect(state.score.away).toBe(2);
    expect(state.bases).toEqual([false, true, false]);
  });

  it('Runs gehen im Bottom-Inning an das Heimteam', () => {
    const state = run([{ type: 'nextHalf' }, { type: 'hit', bases: 4 }]);
    expect(state.score).toEqual({ away: 0, home: 1 });
  });
});

describe('Pitchcount', () => {
  it('zählt Würfe für das Team, dessen Pitcher gerade wirft', () => {
    const top = run([{ type: 'ball' }, { type: 'strike' }]);
    expect(top.pitches).toEqual({ away: 0, home: 2 });
    const bottom = run([{ type: 'nextHalf' }, { type: 'foul' }], top);
    expect(bottom.pitches).toEqual({ away: 1, home: 2 });
  });

  it('Ball im Spiel (Out oder Treffer) zählt als Wurf', () => {
    const state = run([{ type: 'out' }, { type: 'hit', bases: 1 }]);
    expect(state.pitches.home).toBe(2);
  });

  it('Pitcherwechsel setzt nur den Zähler der Feldmannschaft zurück', () => {
    const state = run([{ type: 'ball' }, { type: 'nextHalf' }, { type: 'ball' }, { type: 'newPitcher' }]);
    expect(state.pitches).toEqual({ away: 0, home: 1 });
  });

  it('fällt nie unter null', () => {
    const state = run([{ type: 'adjustPitches', side: 'home', delta: -5 }]);
    expect(state.pitches.home).toBe(0);
  });
});

describe('Korrekturen und Grenzen', () => {
  it('Punkte fallen nie unter null', () => {
    const state = run([{ type: 'adjustScore', side: 'away', delta: -3 }]);
    expect(state.score.away).toBe(0);
  });

  it('Teamtexte werden bereinigt und gekürzt', () => {
    const state = run([
      { type: 'setTeam', side: 'home', name: `  Heide\u0000köpfe ${'x'.repeat(80)}`, short: 'HDHXYZ12' },
    ]);
    expect(state.teams.home.name.startsWith('Heideköpfe')).toBe(true);
    expect(state.teams.home.name.length).toBeLessThanOrEqual(40);
    expect(state.teams.home.short).toBe('HDHXYZ');
  });

  it('unbekannte Regelprofile ändern nichts', () => {
    const start = createGame();
    expect(reduce(start, { type: 'setRules', rulesId: 'cricket' })).toBe(start);
  });
});

describe('Regelprofile', () => {
  it('Softball und Baseball teilen sich die Zählregeln, unterscheiden sich bei Innings und ERA', () => {
    const softball = run([{ type: 'setRules', rulesId: 'softball7' }]);
    expect(softball.rules).toMatchObject({ sport: 'softball', innings: 7, eraInnings: 7 });
    const baseball7 = run([{ type: 'setRules', rulesId: 'baseball7' }]);
    expect(baseball7.rules).toMatchObject({ innings: 7, eraInnings: 9 });
  });
});

describe('Game (Rückgängig und Wiederherstellung)', () => {
  it('macht Eingaben einzeln rückgängig', () => {
    const game = new Game();
    game.dispatch({ type: 'ball' });
    game.dispatch({ type: 'strike' });
    expect(game.undo()).toBe(true);
    expect(game.state).toMatchObject({ balls: 1, strikes: 0 });
    expect(game.undo()).toBe(true);
    expect(game.state).toMatchObject({ balls: 0 });
    expect(game.undo()).toBe(false);
  });

  it('stellt nach einem Walk den Stand davor wieder her', () => {
    const game = new Game();
    for (let i = 0; i < 4; i += 1) game.dispatch({ type: 'ball' });
    game.undo();
    expect(game.state).toMatchObject({ balls: 3 });
    expect(game.state.bases).toEqual([false, false, false]);
  });

  it('ungültige Aktionen erzeugen keinen Verlaufseintrag', () => {
    const game = new Game();
    expect(game.dispatch({ type: 'setRules', rulesId: 'cricket' })).toBe(false);
    expect(game.canUndo).toBe(false);
  });

  it('übersteht Speichern und Laden samt Verlauf', () => {
    const game = new Game();
    game.dispatch({ type: 'hit', bases: 4 });
    game.dispatch({ type: 'ball' });
    const restored = Game.fromSnapshot(JSON.parse(JSON.stringify(game.snapshot())));
    expect(restored).not.toBeNull();
    expect(restored?.state).toEqual(game.state);
    restored?.undo();
    expect(restored?.state.balls).toBe(0);
  });

  it('weist beschädigte Speicherstände ab', () => {
    expect(Game.fromSnapshot({ version: 1, state: { inning: 'x' }, history: [] })).toBeNull();
    expect(Game.fromSnapshot('kaputt')).toBeNull();
    expect(Game.fromSnapshot({ version: 2 })).toBeNull();
  });
});

describe('Schlagreihenfolge (batterIndex)', () => {
  const index = (state: GameState) => state.batterIndex;

  it('beginnt bei 0 für beide Mannschaften', () => {
    expect(index(createGame())).toEqual({ away: 0, home: 0 });
  });

  it('rückt nach Out, Hit, Walk, Strikeout, HBP und „Neuer Batter“ weiter', () => {
    expect(index(run([{ type: 'out' }]))).toEqual({ away: 1, home: 0 });
    expect(index(run([{ type: 'hit', bases: 1 }]))).toEqual({ away: 1, home: 0 });
    expect(index(run(times(4, { type: 'ball' })))).toEqual({ away: 1, home: 0 });
    expect(index(run(times(3, { type: 'strike' })))).toEqual({ away: 1, home: 0 });
    expect(index(run([{ type: 'hitByPitch' }]))).toEqual({ away: 1, home: 0 });
    expect(index(run([{ type: 'newBatter' }]))).toEqual({ away: 1, home: 0 });
  });

  it('bleibt bei Ball, Strike, Foul, Läufer-Out und Korrekturen gleich', () => {
    const state = run([
      { type: 'ball' },
      { type: 'strike' },
      { type: 'foul' },
      { type: 'setBases', bases: [true, false, false] },
      { type: 'runnerOut', base: 1 },
      { type: 'adjustOuts', delta: 1 },
    ]);
    expect(index(state)).toEqual({ away: 0, home: 0 });
  });

  it('zählt für die schlagende Mannschaft, auch beim dritten Out', () => {
    const state = run([...times(3, { type: 'out' }), { type: 'out' }]);
    expect(state.half).toBe('bottom');
    expect(index(state)).toEqual({ away: 3, home: 1 });
  });

  it('Rückgängig stellt den Schlagmann wieder her', () => {
    const game = new Game();
    game.dispatch({ type: 'out' });
    game.undo();
    expect(game.state.batterIndex).toEqual({ away: 0, home: 0 });
  });

  it('Neues Spiel setzt zurück; setBatterIndex setzt von Hand', () => {
    const set = run([{ type: 'setBatterIndex', side: 'home', index: 4 }]);
    expect(index(set)).toEqual({ away: 0, home: 4 });
    expect(reduce(set, { type: 'setBatterIndex', side: 'home', index: 4 })).toBe(set);
    expect(index(run([{ type: 'newGame' }], set))).toEqual({ away: 0, home: 0 });
  });
});
