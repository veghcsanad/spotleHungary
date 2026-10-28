import type { GuessResult, Match } from '../shared/types.ts';
import { MAX_GUESSES } from '../shared/game.ts';

const EMOJI: Record<Match, string> = { correct: '🟩', close: '🟨', wrong: '⬛', unknown: '⬜' };

export function buildShareText(opts: {
  puzzleNumber: number | null;
  guesses: GuessResult[];
  won: boolean;
  url: string;
}): string {
  const title = opts.puzzleNumber ? `Spotle HU #${opts.puzzleNumber}` : 'Spotle HU (gyakorló)';
  const score = opts.won ? `${opts.guesses.length}/${MAX_GUESSES}` : `X/${MAX_GUESSES}`;
  const rows = opts.guesses.map((g) => {
    const a = g.attributes;
    return [a.debutYear, a.members, a.popularity, a.gender, a.genre, a.origin].map((r) => EMOJI[r.match]).join('');
  });
  return [`${title} ${score}`, ...rows, opts.url].join('\n');
}
