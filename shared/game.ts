import {
  HINT_SLOTS,
  HINT_TYPES,
  type Artist,
  type AttributeResult,
  type Direction,
  type GuessAttributes,
  type GuessResult,
  type Match,
  type RankedArtist,
  type RevealedHint,
} from './types.ts';

export const MAX_GUESSES = 10;

/** After this many guesses the player may reveal one of the artist's hints. */
export const HINT_UNLOCK_AFTER = 7;

/** "Close" (yellow) thresholds for numeric attributes. */
export const CLOSE_THRESHOLDS = {
  debutYear: 5,
  members: 1,
  popularity: 10,
} as const;

/** Genres in the same family count as "close". Unlisted genres only match exactly. */
export const GENRE_FAMILIES: Record<string, string[]> = {
  pop: ['Pop', 'Dance-pop', 'Táncdal', 'Indie pop', 'Pop-rock', 'Mulatós', 'Diszkó', 'Sanzon'],
  rock: ['Rock', 'Pop-rock', 'Hard rock', 'Alternatív rock', 'Punk', 'Metal', 'Indie', 'Beat'],
  hiphop: ['Hip-hop', 'Rap', 'Trap'],
  electronic: ['Elektronikus', 'Dance', 'House', 'Dance-pop', 'Diszkó'],
  cabaret: ['Sanzon', 'Kabaré', 'Táncdal'],
  folk: ['Népzene', 'Folk', 'World'],
  jazz: ['Jazz', 'Blues', 'Soul', 'R&B'],
};

function direction(guess: number, answer: number): Direction {
  if (answer > guess) return 'higher';
  if (answer < guess) return 'lower';
  return null;
}

function compareNumber(guess: number | null, answer: number | null, closeWithin: number): AttributeResult<number | null> {
  if (guess == null || answer == null) return { value: guess, match: 'unknown', direction: null };
  const diff = Math.abs(guess - answer);
  const match: Match = diff === 0 ? 'correct' : diff <= closeWithin ? 'close' : 'wrong';
  return { value: guess, match, direction: direction(guess, answer) };
}

const norm = (s: string) => s.trim().toLocaleLowerCase('hu');

export function genresRelated(a: string, b: string): boolean {
  const na = norm(a);
  const nb = norm(b);
  return Object.values(GENRE_FAMILIES).some(
    (family) => family.some((g) => norm(g) === na) && family.some((g) => norm(g) === nb),
  );
}

function compareGenre(guess: string | null, answer: string | null): Match {
  if (!guess || !answer) return 'unknown';
  return norm(guess) === norm(answer) ? 'correct' : genresRelated(guess, answer) ? 'close' : 'wrong';
}

function compareOrigin(guess: Artist, answer: Artist): Match {
  if (guess.city && answer.city && norm(guess.city) === norm(answer.city)) return 'correct';
  if (guess.region && answer.region) return guess.region === answer.region ? 'close' : 'wrong';
  return 'unknown';
}

export function compareArtists(guess: RankedArtist, answer: RankedArtist): GuessResult {
  const attributes: GuessAttributes = {
    debutYear: compareNumber(guess.debutYear, answer.debutYear, CLOSE_THRESHOLDS.debutYear),
    members: compareNumber(guess.members, answer.members, CLOSE_THRESHOLDS.members),
    popularity: compareNumber(guess.rank, answer.rank, CLOSE_THRESHOLDS.popularity) as AttributeResult<number>,
    gender: {
      value: guess.gender,
      match: !guess.gender || !answer.gender ? 'unknown' : guess.gender === answer.gender ? 'correct' : 'wrong',
    },
    genre: { value: guess.genre, match: compareGenre(guess.genre, answer.genre) },
    origin: { value: { city: guess.city, region: guess.region }, match: compareOrigin(guess, answer) },
  };

  return {
    artist: { id: guess.id, name: guess.name, imageUrl: guess.imageUrl },
    correct: guess.id === answer.id,
    attributes,
  };
}

/** Accent- and case-insensitive text used for search ("bodi" finds "Bódi"). */
export function searchKey(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0]!.toUpperCase() + '.')
    .join(' ');
}

export function hintLabel(type: string): string {
  return (HINT_TYPES as Record<string, string>)[type] ?? type;
}

/**
 * The artist's configured hints. A slot is available when it has a type and a value;
 * an `initials` hint without a value is derived from the artist's name.
 */
export function artistHints(artist: Artist): RevealedHint[] {
  const out: RevealedHint[] = [];
  for (const slot of HINT_SLOTS) {
    const type = artist[`hint${slot}Type`]?.trim();
    if (!type) continue;
    const value = artist[`hint${slot}`]?.trim() || (type === 'initials' ? initials(artist.name) : '');
    if (value) out.push({ slot, type, label: hintLabel(type), value });
  }
  return out;
}
