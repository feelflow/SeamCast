import { describe, expect, it } from 'vitest';
import { createGame, detectEvent, reduce, type Action, type GameState } from '../src/index.js';

const play = (start: GameState, action: Action) => {
  const after = reduce(start, action);
  return { after, event: detectEvent(start, action, after) };
};
const withBases = (bases: [boolean, boolean, boolean]) => reduce(createGame(), { type: 'setBases', bases });

describe('Ereignisse für Einblendungen', () => {
  it('erkennt den Strikeout beim dritten Strike', () => {
    let state = createGame();
    for (let i = 0; i < 2; i += 1) {
      const step = play(state, { type: 'strike' });
      expect(step.event).toBeNull();
      state = step.after;
    }
    expect(play(state, { type: 'strike' }).event).toBe('strikeout');
  });

  it('Foul bei zwei Strikes ist kein Strikeout', () => {
    const twoStrikes = reduce(reduce(createGame(), { type: 'strike' }), { type: 'strike' });
    expect(play(twoStrikes, { type: 'foul' }).event).toBeNull();
  });

  it('Walk, Out und kleinere Treffer lösen nichts aus', () => {
    const state = createGame();
    expect(play(state, { type: 'out' }).event).toBeNull();
    expect(play(state, { type: 'hit', bases: 1 }).event).toBeNull();
    expect(play(state, { type: 'hit', bases: 3 }).event).toBeNull();
    expect(play(state, { type: 'intentionalWalk' }).event).toBeNull();
  });

  it('erkennt den Homerun auch mit Läufern', () => {
    expect(play(createGame(), { type: 'hit', bases: 4 }).event).toBe('homerun');
    expect(play(withBases([true, false, true]), { type: 'hit', bases: 4 }).event).toBe('homerun');
  });

  it('erkennt den Grand Slam bei voll besetzten Bases', () => {
    const result = play(withBases([true, true, true]), { type: 'hit', bases: 4 });
    expect(result.event).toBe('grandslam');
    expect(result.after.score.away).toBe(4);
  });

  it('kein Grand Slam, wenn ein Läufer dabei ausgeht', () => {
    const result = play(withBases([true, true, true]), { type: 'hit', bases: 4, runners: [3, 2, -1] });
    expect(result.event).toBe('homerun');
  });

  it('kein Ereignis, wenn die Aktion nichts ändert', () => {
    const state = createGame();
    expect(detectEvent(state, { type: 'strike' }, state)).toBeNull();
  });

  it('Homerun, der das dritte Out nicht ändert, zählt nur bei Runs', () => {
    const state = reduce(createGame(), { type: 'setBases', bases: [true, false, false] });
    const twoOuts = reduce(reduce(state, { type: 'adjustOuts', delta: 1 }), { type: 'adjustOuts', delta: 1 });
    // Läufer von 1B ist aus => drittes Out, Runs des Spielzugs zählen nicht
    expect(play(twoOuts, { type: 'hit', bases: 4, runners: [-1, 0, 0] }).event).toBeNull();
  });
});
