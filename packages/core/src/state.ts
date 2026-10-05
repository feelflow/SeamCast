import { RULE_PROFILES, type RuleProfile, type RuleProfileId } from './rules.js';

export type Side = 'away' | 'home';
export type Half = 'top' | 'bottom';
/** Belegung von 1B, 2B und 3B */
export type Bases = readonly [boolean, boolean, boolean];

export interface TeamInfo {
  name: string;
  short: string;
}

export interface GameState {
  rules: RuleProfile;
  teams: Record<Side, TeamInfo>;
  score: Record<Side, number>;
  inning: number;
  half: Half;
  balls: number;
  strikes: number;
  outs: number;
  bases: Bases;
  /** Würfe des Pitchers der jeweiligen Mannschaft (also der Feldmannschaft) */
  pitches: Record<Side, number>;
  /** Zählt je Mannschaft die abgeschlossenen Schlag-Auftritte; daraus folgt der Schlagmann in der Aufstellung */
  batterIndex: Record<Side, number>;
}

export function createGame(rulesId: RuleProfileId = 'baseball9'): GameState {
  return {
    rules: RULE_PROFILES[rulesId],
    teams: {
      away: { name: 'Away', short: 'AWY' },
      home: { name: 'Home', short: 'HOM' },
    },
    score: { away: 0, home: 0 },
    inning: 1,
    half: 'top',
    balls: 0,
    strikes: 0,
    outs: 0,
    bases: [false, false, false],
    pitches: { away: 0, home: 0 },
    batterIndex: { away: 0, home: 0 },
  };
}

/** Im Top-Inning schlägt das Gastteam, im Bottom-Inning das Heimteam. */
export function battingSide(state: GameState): Side {
  return state.half === 'top' ? 'away' : 'home';
}

export function fieldingSide(state: GameState): Side {
  return state.half === 'top' ? 'home' : 'away';
}
