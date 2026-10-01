import { RULE_PROFILES, isRuleProfileId } from './rules.js';
import { battingSide, fieldingSide, type Bases, type GameState, type Side } from './state.js';

/**
 * Alle Eingaben des Bedieners. Der Spielstand ändert sich ausschließlich
 * über diese Aktionen und die Funktion `reduce`.
 */
export type Action =
  /** Ball; beim letzten Ball folgt automatisch der Walk */
  | { type: 'ball' }
  /** Strike (verpasst oder gehalten); beim letzten Strike folgt der Strikeout */
  | { type: 'strike' }
  /** Foul: zählt als Strike, aber nie als letzter Strike */
  | { type: 'foul' }
  /** Schlagmann ist nach einem Treffer ins Feld aus (kein Strikeout) */
  | { type: 'out' }
  /**
   * Treffer über 1 bis 4 Bases (4 = Homerun). Ohne `runners` rücken alle Läufer
   * um so viele Bases vor wie der Schlagmann. Mit `runners` bestimmt der Bediener,
   * wie weit der Läufer von 1B, 2B und 3B kommt (0 = bleibt; 4 oder mehr = Run).
   */
  | { type: 'hit'; bases: 1 | 2 | 3 | 4; runners?: readonly [number, number, number] }
  | { type: 'hitByPitch' }
  /** Neuer Schlagmann: Count zurücksetzen */
  | { type: 'newBatter' }
  | { type: 'setBases'; bases: readonly [boolean, boolean, boolean] }
  | { type: 'adjustScore'; side: Side; delta: number }
  /** Outs von Hand korrigieren, etwa nach einem Läufer-Out */
  | { type: 'adjustOuts'; delta: number }
  | { type: 'nextHalf' }
  /** Pitcherwechsel: Pitchcount der Feldmannschaft auf 0 */
  | { type: 'newPitcher' }
  | { type: 'adjustPitches'; side: Side; delta: number }
  | { type: 'setTeam'; side: Side; name: string; short: string }
  | { type: 'setRules'; rulesId: string };

const NAME_MAX = 40;
const SHORT_MAX = 6;

const clampNonNegative = (n: number): number => Math.max(0, Math.trunc(n));

/** Entfernt Steuerzeichen, kürzt und trimmt Texte aus Eingaben. */
export function cleanText(value: string, maxLength: number): string {
  // eslint-disable-next-line no-control-regex
  return value.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, maxLength);
}

function resetCount(state: GameState): GameState {
  return { ...state, balls: 0, strikes: 0 };
}

function addPitch(state: GameState): GameState {
  const side = fieldingSide(state);
  return { ...state, pitches: { ...state.pitches, [side]: state.pitches[side] + 1 } };
}

function addRuns(state: GameState, runs: number): GameState {
  if (runs <= 0) return state;
  const side = battingSide(state);
  return { ...state, score: { ...state.score, [side]: state.score[side] + runs } };
}

function endHalf(state: GameState): GameState {
  const cleared: GameState = {
    ...state,
    outs: 0,
    balls: 0,
    strikes: 0,
    bases: [false, false, false],
  };
  return state.half === 'top'
    ? { ...cleared, half: 'bottom' }
    : { ...cleared, half: 'top', inning: state.inning + 1 };
}

function addOut(state: GameState): GameState {
  const next: GameState = { ...resetCount(state), outs: state.outs + 1 };
  return next.outs >= state.rules.outsPerHalfInning ? endHalf(next) : next;
}

/** Walk und Hit-by-Pitch: Der Schlagmann geht auf 1B, nur zwangsläufig betroffene Läufer rücken vor. */
function walk(state: GameState): GameState {
  const [first, second, third] = state.bases;
  let bases: Bases;
  let runs = 0;
  if (!first) bases = [true, second, third];
  else if (!second) bases = [true, true, third];
  else if (!third) bases = [true, true, true];
  else {
    bases = [true, true, true];
    runs = 1;
  }
  return addRuns(resetCount({ ...state, bases }), runs);
}

/** Treffer: Alle Läufer und der Schlagmann rücken um `advance` Bases vor. */
function hit(
  state: GameState,
  advance: number,
  runners?: readonly [number, number, number],
): GameState {
  const next: [boolean, boolean, boolean] = [false, false, false];
  let runs = 0;
  state.bases.forEach((occupied, index) => {
    if (!occupied) return;
    const target = index + 1 + (runners ? (runners[index] ?? 0) : advance);
    if (target >= 4) runs += 1;
    else next[target - 1] = true;
  });
  if (advance >= 4) runs += 1;
  else next[advance - 1] = true;
  return addRuns(resetCount({ ...state, bases: next }), runs);
}

export function reduce(state: GameState, action: Action): GameState {
  switch (action.type) {
    case 'ball': {
      const next = addPitch({ ...state, balls: state.balls + 1 });
      return next.balls >= state.rules.ballsForWalk ? walk(next) : next;
    }
    case 'strike': {
      const next = addPitch({ ...state, strikes: state.strikes + 1 });
      return next.strikes >= state.rules.strikesForStrikeout ? addOut(next) : next;
    }
    case 'foul': {
      const next = addPitch(state);
      return state.strikes < state.rules.strikesForStrikeout - 1
        ? { ...next, strikes: state.strikes + 1 }
        : next;
    }
    case 'out':
      return addOut(addPitch(state));
    case 'hit':
      return hit(addPitch(state), action.bases, action.runners);
    case 'hitByPitch':
      return walk(addPitch(state));
    case 'newBatter':
      return resetCount(state);
    case 'setBases':
      return { ...state, bases: [action.bases[0], action.bases[1], action.bases[2]] };
    case 'adjustScore':
      return {
        ...state,
        score: {
          ...state.score,
          [action.side]: clampNonNegative(state.score[action.side] + action.delta),
        },
      };
    case 'adjustOuts': {
      const outs = clampNonNegative(state.outs + action.delta);
      const next = { ...state, outs };
      return outs >= state.rules.outsPerHalfInning ? endHalf(next) : next;
    }
    case 'nextHalf':
      return endHalf(state);
    case 'newPitcher': {
      const side = fieldingSide(state);
      return { ...state, pitches: { ...state.pitches, [side]: 0 } };
    }
    case 'adjustPitches':
      return {
        ...state,
        pitches: {
          ...state.pitches,
          [action.side]: clampNonNegative(state.pitches[action.side] + action.delta),
        },
      };
    case 'setTeam':
      return {
        ...state,
        teams: {
          ...state.teams,
          [action.side]: {
            name: cleanText(action.name, NAME_MAX),
            short: cleanText(action.short, SHORT_MAX),
          },
        },
      };
    case 'setRules':
      return isRuleProfileId(action.rulesId)
        ? { ...state, rules: RULE_PROFILES[action.rulesId] }
        : state;
  }
}
