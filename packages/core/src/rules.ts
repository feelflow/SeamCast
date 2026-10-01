/**
 * Regelprofile. Alles, was sich zwischen Baseball und Softball oder zwischen
 * Ligen unterscheidet, steht hier und nicht verstreut im Code.
 */
export interface RuleProfile {
  id: string;
  sport: 'baseball' | 'softball';
  /** Reguläre Innings eines Spiels */
  innings: number;
  ballsForWalk: number;
  strikesForStrikeout: number;
  outsPerHalfInning: number;
  /**
   * Auf wie viele Innings die ERA hochgerechnet wird.
   * Baseball rechnet immer auf 9 (auch bei Spielen über 7 Innings),
   * Softball üblicherweise auf 7.
   */
  eraInnings: number;
}

export const RULE_PROFILES = {
  baseball9: {
    id: 'baseball9',
    sport: 'baseball',
    innings: 9,
    ballsForWalk: 4,
    strikesForStrikeout: 3,
    outsPerHalfInning: 3,
    eraInnings: 9,
  },
  baseball7: {
    id: 'baseball7',
    sport: 'baseball',
    innings: 7,
    ballsForWalk: 4,
    strikesForStrikeout: 3,
    outsPerHalfInning: 3,
    eraInnings: 9,
  },
  softball7: {
    id: 'softball7',
    sport: 'softball',
    innings: 7,
    ballsForWalk: 4,
    strikesForStrikeout: 3,
    outsPerHalfInning: 3,
    eraInnings: 7,
  },
} as const satisfies Record<string, RuleProfile>;

export type RuleProfileId = keyof typeof RULE_PROFILES;

export function isRuleProfileId(value: unknown): value is RuleProfileId {
  return typeof value === 'string' && Object.hasOwn(RULE_PROFILES, value);
}
