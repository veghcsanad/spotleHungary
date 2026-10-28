import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import request from 'supertest';
import { artistHints, GENRE_FAMILIES } from '../shared/game.ts';
import { createApp, validateArtistInput } from './app.ts';
import { ArtistRepository } from './db.ts';
import { dailyNumber, dateForNumber, LAUNCH_DATE, parsePuzzleId, pickAnswer } from './puzzle.ts';

const LAUNCH_NOON = new Date(`${LAUNCH_DATE}T12:00:00+01:00`);

function setup(adminToken?: string) {
  const repo = ArtistRepository.open(':memory:');
  const app = createApp(repo, { now: () => LAUNCH_NOON, adminToken, staticDir: '__none__' });
  return { repo, app };
}

describe('seed data', () => {
  const artists = JSON.parse(readFileSync(new URL('../data/artists.json', import.meta.url), 'utf8')) as unknown[];
  const knownGenres = new Set(Object.values(GENRE_FAMILIES).flat());

  it('is valid, has unique names and only uses known genres', () => {
    const names = new Set<string>();
    for (const raw of artists) {
      const a = validateArtistInput(raw);
      expect(names.has(a.name), `duplicate ${a.name}`).toBe(false);
      names.add(a.name);
      if (a.genre) expect(knownGenres.has(a.genre), `${a.name}: unknown genre ${a.genre}`).toBe(true);
      expect(artistHints({ ...a, id: 0 }).length, `${a.name} has at least 2 hints`).toBeGreaterThanOrEqual(2);
    }
  });
});

describe('puzzle helpers', () => {
  it('numbers days in Budapest time', () => {
    expect(dailyNumber(LAUNCH_NOON)).toBe(1);
    // 23:30 UTC on launch day is already the next day in Budapest (UTC+1 in winter)
    expect(dailyNumber(new Date(`${LAUNCH_DATE}T23:30:00Z`))).toBe(2);
    expect(dateForNumber(1)).toBe(LAUNCH_DATE);
  });

  it('parses puzzle ids', () => {
    expect(parsePuzzleId('d3')).toEqual({ kind: 'daily', number: 3 });
    expect(parsePuzzleId('p42')).toEqual({ kind: 'practice', seed: 42 });
    expect(parsePuzzleId('d0')).toBeNull();
    expect(parsePuzzleId('x1')).toBeNull();
  });

  it('cycles through every artist before repeating a daily answer', () => {
    const artists = ArtistRepository.open(':memory:').list();
    const ids = new Set(artists.map((_, i) => pickAnswer({ kind: 'daily', number: i + 1 }, artists).id));
    expect(ids.size).toBe(artists.length);
  });
});

describe('API', () => {
  it('migrates a v1 database (top_song) to hint slots', () => {
    const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as typeof import('node:sqlite');
    const db = new DatabaseSync(':memory:');
    db.exec(`CREATE TABLE artist (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE, debut_year INTEGER NOT NULL,
      members INTEGER NOT NULL, gender TEXT NOT NULL, genre TEXT NOT NULL, city TEXT NOT NULL, region TEXT NOT NULL,
      monthly_listeners INTEGER NOT NULL DEFAULT 0, top_song TEXT, image_url TEXT, last_checked TEXT NOT NULL DEFAULT (datetime('now')));
      INSERT INTO artist (name, debut_year, members, gender, genre, city, region, top_song)
      VALUES ('Régi', 2000, 1, 'male', 'Pop', 'Pécs', 'Dél-Dunántúl', 'Régi dal');`);
    const [artist] = new ArtistRepository(db).list();
    expect(artist).toMatchObject({ name: 'Régi', hint1Type: 'song', hint1: 'Régi dal', hint2Type: null });
    expect(artist).not.toHaveProperty('topSong');
  });

  it('migrates to v3 so that attributes can be unknown (null)', () => {
    const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as typeof import('node:sqlite');
    const db = new DatabaseSync(':memory:');
    const repo = new ArtistRepository(db);
    const created = repo.create({
      name: 'Ismeretlen',
      debutYear: null,
      members: null,
      gender: null,
      genre: null,
      city: null,
      region: null,
      monthlyListeners: 5,
      imageUrl: null,
      hint1Type: 'initials',
      hint1: null,
      hint2Type: null,
      hint2: null,
      hint3Type: null,
      hint3: null,
    });
    expect(created).toMatchObject({ debutYear: null, gender: null, region: null });
    expect((db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version).toBe(3);
  });
  it('lists artists without exposing attributes', async () => {
    const { app } = setup();
    const res = await request(app).get('/api/artists').expect(200);
    expect(res.body.length).toBeGreaterThan(10);
    expect(Object.keys(res.body[0])).toEqual(['id', 'name']);
  });

  it('plays the daily puzzle', async () => {
    const { app, repo } = setup();
    const daily = await request(app).get('/api/puzzles/daily').expect(200);
    expect(daily.body).toMatchObject({ puzzleId: 'd1', puzzleNumber: 1, date: LAUNCH_DATE, maxGuesses: 10 });

    const answer = pickAnswer({ kind: 'daily', number: 1 }, repo.list());
    const wrong = repo.list().find((a) => a.id !== answer.id)!;

    const miss = await request(app).post('/api/puzzles/d1/guess').send({ artistId: wrong.id }).expect(200);
    expect(miss.body.correct).toBe(false);
    expect(miss.body.artist.name).toBe(wrong.name);

    const hit = await request(app).post('/api/puzzles/d1/guess').send({ artistId: answer.id }).expect(200);
    expect(hit.body.correct).toBe(true);

    const reveal = await request(app).get('/api/puzzles/d1/answer').expect(200);
    expect(reveal.body.name).toBe(answer.name);
  });

  it('rejects future daily puzzles and unknown artists', async () => {
    const { app } = setup();
    await request(app).get('/api/puzzles/d2').expect(404);
    await request(app).post('/api/puzzles/d1/guess').send({ artistId: 99999 }).expect(400);
  });

  it('offers hint types up front and reveals a chosen hint only after 7 guesses', async () => {
    const { app, repo } = setup();
    const answer = pickAnswer({ kind: 'daily', number: 1 }, repo.list());

    const options = await request(app).get('/api/puzzles/d1/hints').expect(200);
    expect(options.body).toHaveLength(3);
    expect(options.body[0]).toEqual({ slot: 1, type: answer.hint1Type, label: expect.any(String) });
    expect(options.body[0]).not.toHaveProperty('value');

    await request(app).get('/api/puzzles/d1/hints/1?guesses=6').expect(403);
    const hint = await request(app).get('/api/puzzles/d1/hints/1?guesses=7').expect(200);
    expect(hint.body).toMatchObject({ slot: 1, type: answer.hint1Type, value: answer.hint1 });
    await request(app).get('/api/puzzles/d1/hints/9?guesses=7').expect(404);

    const reveal = await request(app).get('/api/puzzles/d1/answer').expect(200);
    expect(reveal.body.hints).toHaveLength(3);
  });

  it('protects the admin CRUD API', async () => {
    await request(setup().app).get('/api/admin/artists').expect(403);
    const { app } = setup('secret');
    await request(app).get('/api/admin/artists').expect(401);

    const auth = { Authorization: 'Bearer secret' };
    const input = {
      name: 'Teszt Előadó',
      debutYear: 2020,
      members: 1,
      gender: 'female',
      genre: 'Pop',
      city: 'Szeged',
      region: 'Dél-Alföld',
      monthlyListeners: 5,
    };
    const created = await request(app).post('/api/admin/artists').set(auth).send(input).expect(201);
    expect(created.body).toMatchObject({ ...input, hint1Type: null, hint1: null });
    await request(app).post('/api/admin/artists').set(auth).send(input).expect(409);
    await request(app).post('/api/admin/artists').set(auth).send({ ...input, region: 'Mars' }).expect(400);
    await request(app).post('/api/admin/artists').set(auth).send({ ...input, name: 'X', hint2: 'no type' }).expect(400);
    await request(app)
      .post('/api/admin/artists')
      .set(auth)
      .send({ ...input, name: 'Y', hint2Type: 'song', hint2: '' })
      .expect(400);

    const updated = await request(app)
      .put(`/api/admin/artists/${created.body.id}`)
      .set(auth)
      .send({ ...input, monthlyListeners: 10, hint1Type: 'album', hint1: 'Első album', hint3Type: 'initials' })
      .expect(200);
    expect(updated.body).toMatchObject({ hint1Type: 'album', hint1: 'Első album', hint3Type: 'initials', hint3: null });
    await request(app).delete(`/api/admin/artists/${created.body.id}`).set(auth).expect(200);
    await request(app).get(`/api/admin/artists/${created.body.id}`).set(auth).expect(404);
  });
});
