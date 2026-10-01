import type { Action } from './engine.js';
import { RULE_PROFILES, isRuleProfileId } from './rules.js';
import type { GameState, Side } from './state.js';

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isSide = (value: unknown): value is Side => value === 'away' || value === 'home';

const isInt = (value: unknown, min: number, max: number): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max;

const SIMPLE_ACTIONS = [
  'ball',
  'strike',
  'foul',
  'out',
  'hitByPitch',
  'newBatter',
  'nextHalf',
  'newPitcher',
  'newGame',
] as const;
type SimpleAction = (typeof SIMPLE_ACTIONS)[number];

const isSimpleAction = (value: unknown): value is SimpleAction =>
  typeof value === 'string' && (SIMPLE_ACTIONS as readonly string[]).includes(value);

/**
 * Prüft eine ungeprüfte Eingabe (zum Beispiel aus dem WebSocket) und gibt
 * eine gültige Aktion zurück, sonst null. Unbekannte Felder werden verworfen.
 */
export function parseAction(input: unknown): Action | null {
  if (!isObject(input)) return null;
  const type = input.type;

  if (isSimpleAction(type)) return { type };

  switch (type) {
    case 'hit': {
      const bases = input.bases;
      if (bases !== 1 && bases !== 2 && bases !== 3 && bases !== 4) return null;
      if (input.runners === undefined) return { type, bases };
      const r = input.runners;
      if (!Array.isArray(r) || r.length !== 3 || !r.every((n) => isInt(n, -1, 4))) return null;
      const runners: [number, number, number] = [r[0] as number, r[1] as number, r[2] as number];
      return { type, bases, runners };
    }
    case 'runnerOut':
      return input.base === 1 || input.base === 2 || input.base === 3
        ? { type, base: input.base }
        : null;
    case 'setBases': {
      const bases = input.bases;
      if (
        Array.isArray(bases) &&
        bases.length === 3 &&
        bases.every((entry) => typeof entry === 'boolean')
      ) {
        return { type, bases: [bases[0] as boolean, bases[1] as boolean, bases[2] as boolean] };
      }
      return null;
    }
    case 'adjustScore':
      return isSide(input.side) && isInt(input.delta, -20, 20)
        ? { type, side: input.side, delta: input.delta }
        : null;
    case 'adjustOuts':
      return isInt(input.delta, -3, 3) ? { type, delta: input.delta } : null;
    case 'adjustPitches':
      return isSide(input.side) && isInt(input.delta, -200, 200)
        ? { type, side: input.side, delta: input.delta }
        : null;
    case 'setTeam':
      return isSide(input.side) && typeof input.name === 'string' && typeof input.short === 'string'
        ? { type, side: input.side, name: input.name, short: input.short }
        : null;
    case 'setRules':
      return isRuleProfileId(input.rulesId) ? { type, rulesId: input.rulesId } : null;
    default:
      return null;
  }
}

const isTeamInfo = (value: unknown): value is { name: string; short: string } =>
  isObject(value) && typeof value.name === 'string' && typeof value.short === 'string';

/**
 * Prüft einen gespeicherten Spielstand (zum Beispiel aus einer Datei) und baut
 * ihn neu auf. Die Regeln kommen dabei immer aus den hinterlegten Profilen.
 * Ungültige Daten ergeben null.
 */
export function parseGameState(input: unknown): GameState | null {
  if (!isObject(input)) return null;
  const { rules, teams, score, pitches, bases } = input;

  if (!isObject(rules) || !isRuleProfileId(rules.id)) return null;
  if (!isObject(teams) || !isTeamInfo(teams.away) || !isTeamInfo(teams.home)) return null;
  if (!isObject(score) || !isInt(score.away, 0, 999) || !isInt(score.home, 0, 999)) return null;
  if (!isObject(pitches) || !isInt(pitches.away, 0, 999) || !isInt(pitches.home, 0, 999)) {
    return null;
  }
  if (
    !Array.isArray(bases) ||
    bases.length !== 3 ||
    !bases.every((entry) => typeof entry === 'boolean')
  ) {
    return null;
  }
  if (!isInt(input.inning, 1, 99)) return null;
  if (input.half !== 'top' && input.half !== 'bottom') return null;
  if (!isInt(input.balls, 0, 9) || !isInt(input.strikes, 0, 9) || !isInt(input.outs, 0, 9)) {
    return null;
  }

  return {
    rules: RULE_PROFILES[rules.id],
    teams: {
      away: { name: teams.away.name, short: teams.away.short },
      home: { name: teams.home.name, short: teams.home.short },
    },
    score: { away: score.away, home: score.home },
    inning: input.inning,
    half: input.half,
    balls: input.balls,
    strikes: input.strikes,
    outs: input.outs,
    bases: [bases[0] as boolean, bases[1] as boolean, bases[2] as boolean],
    pitches: { away: pitches.away, home: pitches.home },
  };
}
