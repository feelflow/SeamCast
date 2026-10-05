import type { Action } from './engine.js';
import { battingSide, type GameState } from './state.js';

/** Spielereignisse, zu denen eine Animation gezeigt werden kann. */
export const GAME_EVENTS = ['homerun', 'grandslam', 'strikeout'] as const;
export type GameEvent = (typeof GAME_EVENTS)[number];

export const isGameEvent = (value: unknown): value is GameEvent =>
  typeof value === 'string' && (GAME_EVENTS as readonly string[]).includes(value);

/**
 * Erkennt, ob eine Aktion ein Ereignis für eine Einblendung ausgelöst hat.
 * `before` ist der Stand vor, `after` der Stand nach der Aktion.
 * - Strikeout: der Strike, der den letzten nötigen Strike bringt (kein Foul, kein Walk).
 * - Homerun: Treffer über 4 Bases, bei dem mindestens ein Run zählt.
 * - Grand Slam: Homerun bei voll besetzten Bases, bei dem alle vier Runs zählen.
 */
export function detectEvent(before: GameState, action: Action, after: GameState): GameEvent | null {
  if (before === after) return null;
  if (action.type === 'strike') {
    return before.strikes + 1 >= before.rules.strikesForStrikeout ? 'strikeout' : null;
  }
  if (action.type === 'hit' && action.bases === 4) {
    const side = battingSide(before);
    const runs = after.score[side] - before.score[side];
    if (runs <= 0) return null;
    return before.bases.every(Boolean) && runs >= 4 ? 'grandslam' : 'homerun';
  }
  return null;
}
