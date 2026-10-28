import { describe, expect, it } from 'vitest';
import { artistHints, compareArtists, genresRelated, initials, searchKey } from './game.ts';
import type { RankedArtist } from './types.ts';

const base: RankedArtist = {
  id: 1,
  name: 'Answer',
  debutYear: 2000,
  members: 4,
  gender: 'male',
  genre: 'Rock',
  city: 'Pécs',
  region: 'Dél-Dunántúl',
  monthlyListeners: 1000,
  imageUrl: null,
  hint1Type: 'song',
  hint1: 'Első dal',
  hint2Type: 'initials',
  hint2: null,
  hint3Type: null,
  hint3: null,
  rank: 20,
};

describe('compareArtists', () => {
  it('marks an identical artist fully correct', () => {
    const r = compareArtists(base, base);
    expect(r.correct).toBe(true);
    expect(Object.values(r.attributes).every((a) => a.match === 'correct')).toBe(true);
  });

  it('computes close matches and directions', () => {
    const guess: RankedArtist = {
      ...base,
      id: 2,
      debutYear: 1997,
      members: 5,
      rank: 28,
      genre: 'Metal',
      city: 'Kaposvár',
    };
    const { attributes: a, correct } = compareArtists(guess, base);
    expect(correct).toBe(false);
    expect(a.debutYear).toEqual({ value: 1997, match: 'close', direction: 'higher' });
    expect(a.members).toEqual({ value: 5, match: 'close', direction: 'lower' });
    expect(a.popularity).toEqual({ value: 28, match: 'close', direction: 'lower' });
    expect(a.genre.match).toBe('close');
    expect(a.origin.match).toBe('close');
  });

  it('marks distant values wrong', () => {
    const guess: RankedArtist = {
      ...base,
      id: 3,
      debutYear: 1970,
      members: 1,
      rank: 1,
      gender: 'female',
      genre: 'Hip-hop',
      city: 'Budapest',
      region: 'Közép-Magyarország',
    };
    const { attributes: a } = compareArtists(guess, base);
    expect(Object.values(a).every((x) => x.match === 'wrong')).toBe(true);
    expect(a.debutYear.direction).toBe('higher');
    expect(a.popularity.direction).toBe('higher');
  });

  it('marks attributes unknown when either side has no data', () => {
    const guess: RankedArtist = { ...base, id: 4, debutYear: null, gender: null, genre: null, city: null, region: null };
    const { attributes: a } = compareArtists(guess, base);
    expect(a.debutYear).toEqual({ value: null, match: 'unknown', direction: null });
    expect(a.gender.match).toBe('unknown');
    expect(a.genre.match).toBe('unknown');
    expect(a.origin.match).toBe('unknown');
    expect(a.members.match).toBe('correct');

    const answer: RankedArtist = { ...base, city: null };
    expect(compareArtists({ ...base, id: 5, city: 'Kaposvár' }, answer).attributes.origin.match).toBe('close');
    expect(compareArtists({ ...base, id: 6, members: 2 }, { ...base, members: null }).attributes.members.match).toBe('unknown');
  });
});

describe('helpers', () => {
  it('relates genres in the same family only', () => {
    expect(genresRelated('rock', 'Punk')).toBe(true);
    expect(genresRelated('Rock', 'Rap')).toBe(false);
    expect(genresRelated('Unknown', 'Unknown2')).toBe(false);
  });

  it('builds accent-insensitive search keys', () => {
    expect(searchKey('  Rúzsa Magdi ')).toBe('ruzsa magdi');
    expect(searchKey('Edda Művek')).toBe('edda muvek');
  });

  it('computes initials', () => {
    expect(initials('Kispál és a Borz')).toBe('K. É. A. B.');
  });

  it('extracts configured hints, deriving empty initials and skipping empty slots', () => {
    expect(artistHints({ ...base, name: 'Edda Művek' })).toEqual([
      { slot: 1, type: 'song', label: 'Dal', value: 'Első dal' },
      { slot: 2, type: 'initials', label: 'Kezdőbetűk', value: 'E. M.' },
    ]);
    expect(artistHints({ ...base, hint1Type: 'custom', hint1: 'x', hint2Type: null })).toEqual([
      { slot: 1, type: 'custom', label: 'custom', value: 'x' },
    ]);
  });
});
