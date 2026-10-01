import { reduce, type Action } from './engine.js';
import { createGame, type GameState } from './state.js';
import { parseGameState } from './validate.js';

const HISTORY_LIMIT = 500;

export interface GameSnapshot {
  version: 1;
  state: GameState;
  history: GameState[];
}

/**
 * Ein laufendes Spiel: aktueller Stand plus Verlauf für „Rückgängig“.
 * Ändert sich nichts (ungültige Aktion), entsteht auch kein Verlaufseintrag.
 */
export class Game {
  #state: GameState;
  #history: GameState[];

  constructor(state: GameState = createGame(), history: GameState[] = []) {
    this.#state = state;
    this.#history = history.slice(-HISTORY_LIMIT);
  }

  get state(): GameState {
    return this.#state;
  }

  get canUndo(): boolean {
    return this.#history.length > 0;
  }

  /** Gibt true zurück, wenn sich der Spielstand geändert hat. */
  dispatch(action: Action): boolean {
    const next = reduce(this.#state, action);
    if (next === this.#state) return false;
    this.#history.push(this.#state);
    if (this.#history.length > HISTORY_LIMIT) this.#history.shift();
    this.#state = next;
    return true;
  }

  undo(): boolean {
    const previous = this.#history.pop();
    if (!previous) return false;
    this.#state = previous;
    return true;
  }

  snapshot(): GameSnapshot {
    return { version: 1, state: this.#state, history: [...this.#history] };
  }

  /** Stellt ein gespeichertes Spiel wieder her; bei ungültigen Daten null. */
  static fromSnapshot(input: unknown): Game | null {
    if (typeof input !== 'object' || input === null) return null;
    const raw = input as { version?: unknown; state?: unknown; history?: unknown };
    if (raw.version !== 1) return null;
    const state = parseGameState(raw.state);
    if (!state) return null;
    const history: GameState[] = [];
    if (Array.isArray(raw.history)) {
      for (const entry of raw.history) {
        const parsed = parseGameState(entry);
        if (!parsed) {
          history.length = 0;
          break;
        }
        history.push(parsed);
      }
    }
    return new Game(state, history);
  }
}
