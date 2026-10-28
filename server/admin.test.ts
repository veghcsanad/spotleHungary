import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { afterAll, describe, expect, it } from 'vitest';
import type { AiProvider, AiResult } from './ai.ts';
import { createApp } from './app.ts';
import { ArtistRepository } from './db.ts';
import { Enricher, hintRevealsName, hintsFromAi, verifyHints } from './enrich.ts';
import { MusicBrainz } from './musicbrainz.ts';
import { parseListeners, SpotifyClient, type SpotifyFacts } from './spotify.ts';
import type { Wikipedia } from './wiki.ts';

const auth = { Authorization: 'Bearer secret' };
const SPOTIFY_ID = 'AAAAAAAAAAAAAAAAAAAAAA';

const facts: SpotifyFacts = {
  id: SPOTIFY_ID,
  name: 'Tamás Cseh',
  url: `https://open.spotify.com/artist/${SPOTIFY_ID}`,
  imageUrl: 'https://img/cseh.jpg',
  monthlyListeners: 41000,
  releases: [{ title: 'Levél nővéremnek', date: '1977', year: 1977, type: 'album' }],
  oldestReleaseYear: 1977,
  topTracks: [{ title: 'Csönded vagyok', artists: 'Cseh Tamás' }],
  apiError: null,
};

const fakeSpotify = {
  search: async () => [{ id: SPOTIFY_ID, name: 'Tamás Cseh', imageUrl: null, monthlyListeners: 41000, url: facts.url }],
  bestMatch: async () => ({ id: SPOTIFY_ID, name: 'Tamás Cseh', imageUrl: null, monthlyListeners: 41000, url: facts.url }),
  facts: async () => facts,
} as unknown as SpotifyClient;

const fakeWiki = { search: async () => [], page: async () => null, spotifyIds: async () => [] } as unknown as Wikipedia;

const aiResult: AiResult = {
  name: 'Cseh Tamás',
  debutYear: 1970,
  members: 1,
  gender: 'male',
  genre: 'sanzon',
  city: 'Budapest',
  region: 'Közép-Magyarország',
  hints: [
    { type: 'album', value: 'Levél nővéremnek (1977)', evidence: 'Levél nővéremnek' },
    { type: 'collab', value: 'Bereményi Géza', evidence: 'dalszövegeit Bereményi Géza írta' },
    { type: 'trivia', value: 'Cseh Tamás rajztanár volt', evidence: 'rajztanárként dolgozott' },
    { type: 'award', value: 'Grammy-díj, 1999', evidence: 'Grammy-díjat kapott' },
  ],
  confidence: 'high',
  notes: 'hu.wikipedia',
  sources: ['https://hu.wikipedia.org/wiki/Cseh_Tam%C3%A1s'],
};
const fakeAi: AiProvider = {
  status: async () => ({ available: true, message: 'fake' }),
  // The award is invented: its evidence is not in anything the AI read.
  fill: async () => ({ ...aiResult, consulted: 'Dalszövegeit Bereményi Géza írta. Korábban rajztanárként dolgozott.' }),
};

const tmp = mkdtempSync(join(tmpdir(), 'spotle-admin-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

function setup(ai: AiProvider | null = fakeAi) {
  const repo = ArtistRepository.open(':memory:');
  const exportPath = join(tmp, `artists-${Math.random().toString(36).slice(2)}.json`);
  const app = createApp(repo, {
    adminToken: 'secret',
    staticDir: '__none__',
    enricher: new Enricher(fakeSpotify, fakeWiki, ai),
    exportPath,
  });
  return { repo, app, exportPath };
}

describe('admin portal helpers', () => {
  it('parses monthly listeners from the Spotify page description', () => {
    expect(parseListeners('Artist · 1.2M monthly listeners.')).toBe(1_200_000);
    expect(parseListeners('Artist · 45,678 monthly listeners.')).toBe(45_678);
    expect(parseListeners('Artist · 980K monthly listeners.')).toBe(980_000);
    expect(parseListeners('Artist')).toBeNull();
  });

  it('drops hints that would reveal the name and fills missing slots with initials', () => {
    expect(hintRevealsName('A Cseh Tamás-dalok', 'Cseh Tamás')).toBe(true);
    expect(hintRevealsName('Bereményi Géza', 'Cseh Tamás')).toBe(false);
    expect(hintsFromAi(aiResult.hints.slice(0, 3), 'Cseh Tamás')).toEqual({
      hint1Type: 'album',
      hint1: 'Levél nővéremnek (1977)',
      hint2Type: 'collab',
      hint2: 'Bereményi Géza',
      hint3Type: 'initials',
      hint3: null,
    });
  });

  it('drops AI hints that the consulted sources do not back up', () => {
    const corpus = 'Cseh Tamás – Levél nővéremnek. Dalszövegeit Bereményi Géza írta, korábban rajztanárként dolgozott.';
    const { kept, dropped } = verifyHints(
      [
        { type: 'album', value: 'Levél nővéremnek (1977)', evidence: '' },
        { type: 'song', value: 'Kitalált dal', evidence: 'Levél nővéremnek' },
        { type: 'collab', value: 'Géza Bereményi', evidence: '' },
        { type: 'trivia', value: 'Rajztanár volt', evidence: 'rajztanárként dolgozott' },
        { type: 'award', value: 'Grammy-díj', evidence: 'Grammy-díjat kapott' },
      ],
      corpus,
    );
    expect(kept.map((h) => h.value)).toEqual(['Levél nővéremnek (1977)', 'Géza Bereményi', 'Rajztanár volt']);
    expect(dropped.map((h) => h.value)).toEqual(['Kitalált dal', 'Grammy-díj']);
  });
});

describe('admin portal API', () => {
  it('reports the configured services', async () => {
    const res = await request(setup().app).get('/api/admin/meta').set(auth).expect(200);
    expect(res.body).toMatchObject({ spotify: true, persistsToFile: true, ai: { available: true } });
    expect(res.body.genres).toContain('Sanzon');
    await request(setup().app).get('/api/admin/meta').expect(401);
  });

  it('proposes a new artist from Spotify + AI without saving it', async () => {
    const { app, repo } = setup();
    const before = repo.count();
    const res = await request(app).post('/api/admin/propose').set(auth).send({ spotifyId: SPOTIFY_ID, ai: true }).expect(200);
    expect(res.body).toMatchObject({
      artistId: null,
      name: 'Tamás Cseh',
      values: {
        name: 'Cseh Tamás',
        spotifyId: SPOTIFY_ID,
        monthlyListeners: 41000,
        debutYear: 1970,
        genre: 'Sanzon',
        region: 'Közép-Magyarország',
        hint1Type: 'album',
        hint2Type: 'collab',
        hint2: 'Bereményi Géza',
        hint3Type: 'initials',
      },
      sources: { debutYear: 'ai', monthlyListeners: 'spotify', name: 'ai' },
      aiError: null,
    });
    expect(res.body.warnings).toContain('Forrással nem igazolt tipp elvetve: Díj: Grammy-díj, 1999');
    expect(repo.count()).toBe(before);
  });

  it('uses the oldest Spotify release for a missing debut year, but never a later one', async () => {
    const { app, repo } = setup(null);
    const missing = repo.create({ ...repo.list()[0], name: 'Nincs év', debutYear: null });
    const known = repo.create({ ...repo.list()[0], name: 'Van év', debutYear: 1965 });
    const a = await request(app).post('/api/admin/propose').set(auth).send({ artistId: missing.id }).expect(200);
    expect(a.body.values.debutYear).toBe(1977);
    expect(a.body.sources.debutYear).toBe('spotify');
    const b = await request(app).post('/api/admin/propose').set(auth).send({ artistId: known.id }).expect(200);
    expect(b.body.values).not.toHaveProperty('debutYear');
    await request(app).post('/api/admin/propose').set(auth).send({ artistId: 99999 }).expect(404);
    await request(app).post('/api/admin/propose').set(auth).send({}).expect(400);
  });

  it('writes every admin change back to the seed JSON file', async () => {
    const { app, repo, exportPath } = setup();
    const first = repo.list()[0];
    await request(app)
      .put(`/api/admin/artists/${first.id}`)
      .set(auth)
      .send({ ...first, debutYear: 1999 })
      .expect(200);
    let saved = JSON.parse(readFileSync(exportPath, 'utf8')) as Record<string, unknown>[];
    expect(saved).toHaveLength(repo.count());
    expect(saved[0]).toMatchObject({ name: first.name, debutYear: 1999, spotifyId: first.spotifyId });
    expect(saved[0]).not.toHaveProperty('id');
    expect(saved[0]).not.toHaveProperty('rank');

    await request(app).delete(`/api/admin/artists/${first.id}`).set(auth).expect(200);
    saved = JSON.parse(readFileSync(exportPath, 'utf8'));
    expect(saved.some((a) => a.name === first.name)).toBe(false);
  });

  it('validates the Spotify id', async () => {
    const { app } = setup();
    const base = { name: 'Új', monthlyListeners: 1, hint1Type: 'initials' };
    await request(app).post('/api/admin/artists').set(auth).send({ ...base, spotifyId: 'nope' }).expect(400);
    const ok = await request(app).post('/api/admin/artists').set(auth).send({ ...base, spotifyId: SPOTIFY_ID }).expect(201);
    expect(ok.body.spotifyId).toBe(SPOTIFY_ID);
  });
});

describe('Spotify client', () => {
  const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });
  const album = (id: string, date: string) => ({ id, name: id, release_date: date, album_type: 'album' });

  function client(api: (url: URL) => Response) {
    const calls: string[] = [];
    const fetchFn = (async (input: string | URL) => {
      const url = new URL(String(input));
      if (url.host === 'accounts.spotify.com') return json({ access_token: 't', expires_in: 3600 });
      if (url.host === 'open.spotify.com') {
        return new Response('<meta property="og:title" content="Page Name" /><meta property="og:description" content="Artist · 12K monthly listeners." />');
      }
      calls.push(url.pathname + url.search);
      return api(url);
    }) as typeof fetch;
    return { spotify: new SpotifyClient('id', 'secret', fetchFn), calls };
  }

  it('reads only the newest and oldest page of each release group', async () => {
    const { spotify, calls } = client((url) => {
      const group = url.searchParams.get('include_groups');
      const offset = Number(url.searchParams.get('offset') ?? 0);
      if (group === 'single') return json({ items: [album('s1', '2020-01-01')], total: 1 });
      return json(offset ? { items: [album('a-old', '1977-05-01')], total: 35 } : { items: [album('a-new', '2001')], total: 35 });
    });
    const releases = await spotify.releases(SPOTIFY_ID);
    expect(releases.map((r) => r.year)).toEqual([1977, 2001, 2020]);
    expect(calls).toHaveLength(3);
    expect(calls.some((c) => c.includes('offset=25'))).toBe(true);
  });

  it('stops calling the API after a long rate limit but still reads the public page', async () => {
    const { spotify, calls } = client(() => json({}, 429, { 'Retry-After': '86000' }));
    const facts = await spotify.facts(SPOTIFY_ID);
    expect(facts).toMatchObject({ name: 'Page Name', monthlyListeners: 12_000, releases: [], oldestReleaseYear: null });
    expect(facts.apiError).toMatch(/óra/);
    expect(spotify.rateLimited).toMatch(/óra/);
    const before = calls.length;
    await expect(spotify.search('x')).rejects.toThrow(/Spotify API/);
    expect(calls.length).toBe(before);
  });

  it('turns Spotify failures into proposal warnings instead of errors', async () => {
    const failing = { bestMatch: async () => Promise.reject(new Error('limit')) } as unknown as SpotifyClient;
    const p = await new Enricher(failing, fakeWiki, null).propose({ name: 'Galaxisok' });
    expect(p.name).toBe('Galaxisok');
    expect(p.warnings).toContain('Spotify: limit');
  });

  it('prefers the Spotify id recorded on Wikidata over a name search', async () => {
    const OTHER = 'BBBBBBBBBBBBBBBBBBBBBB';
    let searched = false;
    const spotify = {
      bestMatch: async () => {
        searched = true;
        return { id: OTHER };
      },
      facts: async (id: string) => ({ ...facts, id }),
    } as unknown as SpotifyClient;
    const wiki = {
      search: async (lang: string) => (lang === 'hu' ? [{ title: 'Cseh Tamás', snippet: '' }] : []),
      page: async () => null,
      spotifyIds: async () => [SPOTIFY_ID],
    } as unknown as Wikipedia;
    const p = await new Enricher(spotify, wiki, null).propose({ name: 'Cseh Tamás' });
    expect(p.values.spotifyId).toBe(SPOTIFY_ID);
    expect(searched).toBe(false);
  });

  it('takes Spotify links only from Hungarian MusicBrainz artists with the same name', async () => {
    const fetchFn = (async (input: string | URL) => {
      const url = String(input);
      if (url.includes('/artist/?query=')) {
        return new Response(
          JSON.stringify({
            artists: [
              { id: 'us', name: 'Dopeman', score: 100, country: 'US' },
              { id: 'hu', name: 'Dopeman', score: 100, country: 'HU' },
              { id: 'hu2', name: 'Dopeman Band', score: 95, country: 'HU' },
            ],
          }),
        );
      }
      const id = url.match(/artist\/(\w+)\?/)?.[1];
      const link = id === 'hu' ? SPOTIFY_ID : 'CCCCCCCCCCCCCCCCCCCCCC';
      return new Response(JSON.stringify({ relations: [{ url: { resource: `https://open.spotify.com/artist/${link}` } }] }));
    }) as typeof fetch;
    expect(await new MusicBrainz(fetchFn, 0).spotifyIds('Dopeman')).toEqual([SPOTIFY_ID]);
  });
});
