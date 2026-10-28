import type { RankedArtist } from '../shared/types.ts';

/** Daily puzzle #1 is played on this date (Europe/Budapest). */
export const LAUNCH_DATE = '2026-10-28';
const TIME_ZONE = 'Europe/Budapest';
const SHUFFLE_SEED = 20261028;
const DAY_MS = 86_400_000;

/** Calendar date (YYYY-MM-DD) in Budapest for the given instant. */
export function budapestDate(now: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE }).format(now);
}

const utcDay = (isoDate: string) => Date.parse(`${isoDate}T00:00:00Z`) / DAY_MS;

export function dailyNumber(now: Date): number {
  return utcDay(budapestDate(now)) - utcDay(LAUNCH_DATE) + 1;
}

export function dateForNumber(n: number): string {
  return new Date((utcDay(LAUNCH_DATE) + n - 1) * DAY_MS).toISOString().slice(0, 10);
}

/** mulberry32 – small deterministic PRNG. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffled<T>(items: T[], seed: number): T[] {
  const out = [...items];
  const rand = rng(seed);
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

export type ParsedPuzzle = { kind: 'daily'; number: number } | { kind: 'practice'; seed: number };

/** Puzzle ids: `d<n>` = daily puzzle #n, `p<seed>` = practice puzzle. */
export function parsePuzzleId(id: string): ParsedPuzzle | null {
  const m = /^([dp])(\d{1,10})$/.exec(id);
  if (!m) return null;
  const n = Number(m[2]);
  if (m[1] === 'd') return n >= 1 ? { kind: 'daily', number: n } : null;
  return { kind: 'practice', seed: n };
}

/**
 * Picks the answer for a puzzle. Daily puzzles walk through a fixed shuffled
 * order of the artist pool so no artist repeats until the pool is exhausted.
 */
export function pickAnswer(puzzle: ParsedPuzzle, artists: RankedArtist[]): RankedArtist {
  if (artists.length === 0) throw new Error('No artists in database');
  if (puzzle.kind === 'daily') {
    const order = shuffled(artists, SHUFFLE_SEED);
    return order[(puzzle.number - 1) % order.length]!;
  }
  return artists[Math.floor(rng(puzzle.seed)() * artists.length)]!;
}
