import artistData from '../data/artists.json';
import { dailyNumber, dateForNumber, parsePuzzleId, pickAnswer, type ParsedPuzzle } from '../server/puzzle.ts';
import { artistHints, compareArtists, HINT_UNLOCK_AFTER, MAX_GUESSES } from '../shared/game.ts';
import type { Answer, Artist, ArtistOption, GuessResult, HintOption, PuzzleInfo, RankedArtist, RevealedHint } from '../shared/types.ts';

/**
 * Serverless implementation of the game API for static hosting (GitHub Pages).
 * Mirrors server/app.ts: ids follow the seed file order (like a fresh `db:seed`) and
 * ranks are ordered by monthly listeners, then name.
 */
const artists: RankedArtist[] = (() => {
  const withIds = (artistData as Omit<Artist, 'id'>[]).map((a, i) => ({ ...a, id: i + 1 }) as Artist);
  const ranked = [...withIds].sort(
    (a, b) => b.monthlyListeners - a.monthlyListeners || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0),
  );
  const rankById = new Map(ranked.map((a, i) => [a.id, i + 1]));
  return withIds.map((a) => ({ ...a, rank: rankById.get(a.id)! }));
})();
const byId = new Map(artists.map((a) => [a.id, a]));

const puzzleInfo = (id: string, p: ParsedPuzzle): PuzzleInfo => ({
  puzzleId: id,
  puzzleNumber: p.kind === 'daily' ? p.number : null,
  date: p.kind === 'daily' ? dateForNumber(p.number) : null,
  maxGuesses: MAX_GUESSES,
  artistCount: artists.length,
});

function resolve(id: string): { parsed: ParsedPuzzle; answer: RankedArtist } {
  const parsed = parsePuzzleId(id);
  if (!parsed || (parsed.kind === 'daily' && parsed.number > dailyNumber(new Date()))) {
    throw new Error('Puzzle not found');
  }
  return { parsed, answer: pickAnswer(parsed, artists) };
}

const ok = <T>(fn: () => T): Promise<T> => {
  try {
    return Promise.resolve(fn());
  } catch (err) {
    return Promise.reject(err);
  }
};

export const staticApi = {
  artists: () =>
    ok<ArtistOption[]>(() =>
      artists.map(({ id, name }) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name, 'hu')),
    ),
  daily: () =>
    ok<PuzzleInfo>(() => {
      const n = Math.max(1, dailyNumber(new Date()));
      return puzzleInfo(`d${n}`, { kind: 'daily', number: n });
    }),
  newPractice: () =>
    ok<PuzzleInfo>(() => {
      const seed = Math.floor(Math.random() * 1e9);
      return puzzleInfo(`p${seed}`, { kind: 'practice', seed });
    }),
  puzzle: (id: string) => ok<PuzzleInfo>(() => puzzleInfo(id, resolve(id).parsed)),
  guess: (id: string, artistId: number) =>
    ok<GuessResult>(() => {
      const { answer } = resolve(id);
      const guess = byId.get(artistId);
      if (!guess) throw new Error('Unknown artist');
      return compareArtists(guess, answer);
    }),
  hintOptions: (id: string) =>
    ok<HintOption[]>(() => artistHints(resolve(id).answer).map(({ slot, type, label }) => ({ slot, type, label }))),
  revealHint: (id: string, slot: number, guesses: number) =>
    ok<RevealedHint>(() => {
      if (guesses < HINT_UNLOCK_AFTER) throw new Error(`Hints unlock after ${HINT_UNLOCK_AFTER} guesses`);
      const hint = artistHints(resolve(id).answer).find((h) => h.slot === slot);
      if (!hint) throw new Error('Hint not found');
      return hint;
    }),
  answer: (id: string) =>
    ok<Answer>(() => {
      const { answer } = resolve(id);
      return {
        id: answer.id,
        name: answer.name,
        imageUrl: answer.imageUrl,
        debutYear: answer.debutYear,
        rank: answer.rank,
        hints: artistHints(answer),
      };
    }),
};
