import type { Answer, GuessResult, HintOption, RevealedHint } from '../shared/types.ts';
import { MAX_GUESSES } from '../shared/game.ts';

export type GameStatus = 'playing' | 'won' | 'lost';
export type Mode = 'daily' | 'practice';

export interface GameState {
  puzzleId: string;
  guesses: GuessResult[];
  status: GameStatus;
  /** Hint types offered for this puzzle (loaded once hints unlock). */
  hintOptions: HintOption[];
  /** The single hint the player chose to reveal. */
  chosenHint: RevealedHint | null;
  answer: Answer | null;
}

export interface Stats {
  played: number;
  wins: number;
  currentStreak: number;
  maxStreak: number;
  /** distribution[i] = wins with i + 1 guesses */
  distribution: number[];
  lastPlayedNumber: number | null;
  lastWonNumber: number | null;
}

const PREFIX = 'spotle-hu:';

function read<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function write(key: string, value: unknown) {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    // storage full / disabled – the game still works for this session
  }
}

export const emptyGame = (puzzleId: string): GameState => ({
  puzzleId,
  guesses: [],
  status: 'playing',
  hintOptions: [],
  chosenHint: null,
  answer: null,
});

// Merging with an empty game keeps games saved by older versions loadable.
export const loadGame = (puzzleId: string): GameState => ({ ...emptyGame(puzzleId), ...read<GameState>(`game:${puzzleId}`) });
export const saveGame = (game: GameState) => write(`game:${game.puzzleId}`, game);

export const loadPracticeId = () => read<string>('practice');
export const savePracticeId = (id: string) => write('practice', id);

export const hasSeenHelp = () => read<boolean>('seen-help') === true;
export const markHelpSeen = () => write('seen-help', true);

export const emptyStats = (): Stats => ({
  played: 0,
  wins: 0,
  currentStreak: 0,
  maxStreak: 0,
  distribution: Array<number>(MAX_GUESSES).fill(0),
  lastPlayedNumber: null,
  lastWonNumber: null,
});

export const loadStats = (): Stats => ({ ...emptyStats(), ...read<Stats>('stats') });

/** Records a finished daily game (idempotent per puzzle number). */
export function recordDailyResult(puzzleNumber: number, won: boolean, guessCount: number): Stats {
  const s = loadStats();
  if (s.lastPlayedNumber !== null && puzzleNumber <= s.lastPlayedNumber) return s;
  s.played += 1;
  s.lastPlayedNumber = puzzleNumber;
  if (won) {
    s.wins += 1;
    s.currentStreak = s.lastWonNumber === puzzleNumber - 1 ? s.currentStreak + 1 : 1;
    s.maxStreak = Math.max(s.maxStreak, s.currentStreak);
    s.lastWonNumber = puzzleNumber;
    s.distribution[guessCount - 1] = (s.distribution[guessCount - 1] ?? 0) + 1;
  } else {
    s.currentStreak = 0;
  }
  write('stats', s);
  return s;
}
