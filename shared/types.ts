export type Gender = 'male' | 'female' | 'mixed';

/** Hungarian statistical regions (+ artists from beyond the borders / abroad). */
export const REGIONS = [
  'Közép-Magyarország',
  'Közép-Dunántúl',
  'Nyugat-Dunántúl',
  'Dél-Dunántúl',
  'Észak-Magyarország',
  'Észak-Alföld',
  'Dél-Alföld',
  'Határon túl',
  'Külföld',
] as const;
export type Region = (typeof REGIONS)[number];

/**
 * Known hint types with their Hungarian labels. Unknown types are still accepted
 * and displayed with their raw type name, so new types can be introduced via data.
 */
export const HINT_TYPES = {
  song: 'Dal',
  album: 'Album',
  collab: 'Közös munka',
  initials: 'Kezdőbetűk',
  member: 'Tag / alapító',
  lyric: 'Dalszöveg-részlet',
  award: 'Díj',
  trivia: 'Érdekesség',
} as const;
export type KnownHintType = keyof typeof HINT_TYPES;

export const HINT_SLOTS = [1, 2, 3] as const;
export type HintSlot = (typeof HINT_SLOTS)[number];

/** Attributes are `null` when the data is unknown; such tiles are shown as "?" and never match. */
export interface Artist {
  id: number;
  name: string;
  /** Spotify artist id (used by the admin portal for lookups). */
  spotifyId: string | null;
  debutYear: number | null;
  /** 1 = solo artist */
  members: number | null;
  gender: Gender | null;
  genre: string | null;
  city: string | null;
  region: Region | null;
  /** Used to compute the popularity rank (1 = most listened). */
  monthlyListeners: number;
  imageUrl: string | null;
  hint1Type: string | null;
  hint1: string | null;
  hint2Type: string | null;
  hint2: string | null;
  hint3Type: string | null;
  hint3: string | null;
}

export interface RankedArtist extends Artist {
  rank: number;
}

/** `unknown`: the guess or the answer has no data for this attribute. */
export type Match = 'correct' | 'close' | 'wrong' | 'unknown';
/** Where the hidden answer lies compared to the guessed value. */
export type Direction = 'higher' | 'lower' | null;

export interface AttributeResult<T> {
  value: T;
  match: Match;
  direction?: Direction;
}

export interface GuessAttributes {
  debutYear: AttributeResult<number | null>;
  members: AttributeResult<number | null>;
  popularity: AttributeResult<number>;
  gender: AttributeResult<Gender | null>;
  genre: AttributeResult<string | null>;
  origin: AttributeResult<{ city: string | null; region: Region | null }>;
}

export interface GuessResult {
  artist: { id: number; name: string; imageUrl: string | null };
  correct: boolean;
  attributes: GuessAttributes;
}

export interface ArtistOption {
  id: number;
  name: string;
}

export interface PuzzleInfo {
  puzzleId: string;
  puzzleNumber: number | null;
  date: string | null;
  maxGuesses: number;
  artistCount: number;
}

/** A hint slot as offered to the player before revealing it (no value). */
export interface HintOption {
  slot: HintSlot;
  type: string;
  label: string;
}

export interface RevealedHint extends HintOption {
  value: string;
}

export interface Answer {
  id: number;
  name: string;
  imageUrl: string | null;
  debutYear: number | null;
  rank: number;
  hints: RevealedHint[];
}
