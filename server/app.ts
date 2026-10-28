import express, { type NextFunction, type Request, type Response } from 'express';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { artistHints, compareArtists, HINT_UNLOCK_AFTER, KNOWN_GENRES, MAX_GUESSES } from '../shared/game.ts';
import {
  HINT_SLOTS,
  HINT_TYPES,
  REGIONS,
  type Answer,
  type ArtistOption,
  type HintOption,
  type PuzzleInfo,
  type RankedArtist,
} from '../shared/types.ts';
import type { ArtistInput, ArtistRepository } from './db.ts';
import type { Enricher } from './enrich.ts';
import { dailyNumber, dateForNumber, parsePuzzleId, pickAnswer, type ParsedPuzzle } from './puzzle.ts';

export interface AppOptions {
  now?: () => Date;
  adminToken?: string;
  staticDir?: string;
  /** Spotify/Wikipedia/AI lookups for the admin portal (disabled when omitted). */
  enricher?: Enricher | null;
  /** When set, every admin change is also written to this seed JSON file (data/artists.json). */
  exportPath?: string;
}

/** Express 4 does not catch rejected promises from async handlers. */
const asyncHandler =
  (fn: (req: Request, res: Response) => Promise<void>) => (req: Request, res: Response, next: NextFunction) =>
    fn(req, res).catch(next);

class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export function validateArtistInput(body: unknown): ArtistInput {
  const b = (body ?? {}) as Record<string, unknown>;
  const str = (k: string) => {
    if (typeof b[k] !== 'string' || !(b[k] as string).trim()) throw new HttpError(400, `"${k}" must be a non-empty string`);
    return (b[k] as string).trim();
  };
  const optStr = (k: string) => (b[k] == null || b[k] === '' ? null : str(k));
  const int = (k: string, min: number) => {
    if (!Number.isInteger(b[k]) || (b[k] as number) < min) throw new HttpError(400, `"${k}" must be an integer >= ${min}`);
    return b[k] as number;
  };
  const optInt = (k: string, min: number) => (b[k] == null ? null : int(k, min));
  const gender = b.gender ?? null;
  if (gender !== null && gender !== 'male' && gender !== 'female' && gender !== 'mixed') {
    throw new HttpError(400, '"gender" must be one of male, female, mixed (or null)');
  }
  const region = optStr('region');
  if (region !== null && !(REGIONS as readonly string[]).includes(region)) {
    throw new HttpError(400, `"region" must be one of: ${REGIONS.join(', ')} (or null)`);
  }
  const hints = {} as Pick<ArtistInput, 'hint1Type' | 'hint1' | 'hint2Type' | 'hint2' | 'hint3Type' | 'hint3'>;
  for (const slot of HINT_SLOTS) {
    const type = optStr(`hint${slot}Type`);
    const value = optStr(`hint${slot}`);
    if (value && !type) throw new HttpError(400, `"hint${slot}Type" is required when "hint${slot}" is set`);
    if (type && !value && type !== 'initials') {
      throw new HttpError(400, `"hint${slot}" is required when "hint${slot}Type" is set`);
    }
    hints[`hint${slot}Type`] = type;
    hints[`hint${slot}`] = value;
  }
  const spotifyId = optStr('spotifyId');
  if (spotifyId !== null && !/^[0-9A-Za-z]{22}$/.test(spotifyId)) {
    throw new HttpError(400, '"spotifyId" must be a 22-character Spotify artist id (or null)');
  }
  return {
    name: str('name'),
    spotifyId,
    debutYear: optInt('debutYear', 1900),
    members: optInt('members', 1),
    gender,
    genre: optStr('genre'),
    city: optStr('city'),
    region: region as ArtistInput['region'],
    monthlyListeners: int('monthlyListeners', 0),
    imageUrl: optStr('imageUrl'),
    ...hints,
  };
}

export function createApp(repo: ArtistRepository, options: AppOptions = {}) {
  const now = options.now ?? (() => new Date());
  const adminToken = options.adminToken ?? process.env.ADMIN_TOKEN;
  const app = express();
  app.use(express.json());

  const puzzleInfo = (id: string, p: ParsedPuzzle): PuzzleInfo => ({
    puzzleId: id,
    puzzleNumber: p.kind === 'daily' ? p.number : null,
    date: p.kind === 'daily' ? dateForNumber(p.number) : null,
    maxGuesses: MAX_GUESSES,
    artistCount: repo.count(),
  });

  /** Resolves a puzzle id; future daily puzzles are not playable yet. */
  const resolvePuzzle = (id: string): { parsed: ParsedPuzzle; answer: RankedArtist; artists: RankedArtist[] } => {
    const parsed = parsePuzzleId(id);
    if (!parsed || (parsed.kind === 'daily' && parsed.number > dailyNumber(now()))) {
      throw new HttpError(404, 'Puzzle not found');
    }
    const artists = repo.list();
    if (artists.length === 0) throw new HttpError(503, 'The artist database is empty');
    return { parsed, answer: pickAnswer(parsed, artists), artists };
  };

  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', artists: repo.count() });
  });

  app.get('/api/artists', (_req, res) => {
    const options: ArtistOption[] = repo
      .list()
      .map(({ id, name }) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name, 'hu'));
    res.json(options);
  });

  app.get('/api/puzzles/daily', (_req, res) => {
    const n = Math.max(1, dailyNumber(now()));
    res.json(puzzleInfo(`d${n}`, { kind: 'daily', number: n }));
  });

  app.get('/api/puzzles/practice', (_req, res) => {
    const seed = Math.floor(Math.random() * 1e9);
    res.json(puzzleInfo(`p${seed}`, { kind: 'practice', seed }));
  });

  app.get('/api/puzzles/:id', (req, res) => {
    const { parsed } = resolvePuzzle(req.params.id);
    res.json(puzzleInfo(req.params.id, parsed));
  });

  app.post('/api/puzzles/:id/guess', (req, res) => {
    const { answer } = resolvePuzzle(req.params.id);
    const artistId = Number(req.body?.artistId);
    const guess = Number.isInteger(artistId) ? repo.get(artistId) : undefined;
    if (!guess) throw new HttpError(400, 'Unknown artist');
    res.json(compareArtists(guess, answer));
  });

  /** Hint types on offer; values stay hidden until one is revealed. */
  app.get('/api/puzzles/:id/hints', (req, res) => {
    const { answer } = resolvePuzzle(req.params.id);
    const options: HintOption[] = artistHints(answer).map(({ slot, type, label }) => ({ slot, type, label }));
    res.json(options);
  });

  app.get('/api/puzzles/:id/hints/:slot', (req, res) => {
    const { answer } = resolvePuzzle(req.params.id);
    const guesses = Number(req.query.guesses) || 0;
    if (guesses < HINT_UNLOCK_AFTER) {
      throw new HttpError(403, `Hints unlock after ${HINT_UNLOCK_AFTER} guesses`);
    }
    const hint = artistHints(answer).find((h) => h.slot === Number(req.params.slot));
    if (!hint) throw new HttpError(404, 'Hint not found');
    res.json(hint);
  });

  app.get('/api/puzzles/:id/answer', (req, res) => {
    const { answer } = resolvePuzzle(req.params.id);
    const body: Answer = {
      id: answer.id,
      name: answer.name,
      imageUrl: answer.imageUrl,
      debutYear: answer.debutYear,
      rank: answer.rank,
      hints: artistHints(answer),
    };
    res.json(body);
  });

  // --- Admin API (mirrors the CRUD endpoints of the original spotle-backend) ---
  const admin = express.Router();
  admin.use((req, _res, next) => {
    if (!adminToken) throw new HttpError(403, 'Admin API disabled (set ADMIN_TOKEN)');
    if (req.get('authorization') !== `Bearer ${adminToken}`) throw new HttpError(401, 'Unauthorized');
    next();
  });
  const idParam = (req: Request) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) throw new HttpError(400, 'Invalid artist id');
    return id;
  };
  admin.get('/artists', (_req, res) => {
    res.json(repo.list());
  });
  admin.get('/artists/:id', (req, res) => {
    const artist = repo.get(idParam(req));
    if (!artist) throw new HttpError(404, 'Artist not found');
    res.json(artist);
  });
  const persist = () => {
    if (options.exportPath) repo.exportToFile(options.exportPath);
  };
  admin.post('/artists', (req, res) => {
    const artist = repo.create(validateArtistInput(req.body));
    persist();
    res.status(201).json(artist);
  });
  admin.put('/artists/:id', (req, res) => {
    const artist = repo.update(idParam(req), validateArtistInput(req.body));
    if (!artist) throw new HttpError(404, 'Artist not found');
    persist();
    res.json(artist);
  });
  admin.delete('/artists/:id', (req, res) => {
    if (!repo.delete(idParam(req))) throw new HttpError(404, 'Artist not found');
    persist();
    res.json({ result: 'successfully deleted' });
  });
  admin.post('/reseed', (_req, res) => {
    res.json({ seeded: repo.seedFromFile() });
  });

  // --- Admin portal helpers: vocabularies, Spotify search and AI-assisted proposals ---
  const enricher = options.enricher ?? null;
  admin.get(
    '/meta',
    asyncHandler(async (_req, res) => {
      res.json({
        regions: REGIONS,
        hintTypes: HINT_TYPES,
        genres: KNOWN_GENRES,
        persistsToFile: Boolean(options.exportPath),
        spotify: Boolean(enricher?.spotify),
        spotifyLimited: enricher?.spotify?.rateLimited ?? null,
        ai: enricher?.ai ? await enricher.ai.status() : { available: false, message: 'AI nincs beállítva' },
      });
    }),
  );
  admin.get(
    '/spotify/search',
    asyncHandler(async (req, res) => {
      if (!enricher?.spotify) throw new HttpError(503, 'Spotify is not configured');
      try {
        res.json(await enricher.spotify.search(String(req.query.q ?? '')));
      } catch (err) {
        throw new HttpError(502, (err as Error).message);
      }
    }),
  );
  /** Body: `{ artistId?, name?, spotifyId?, ai?: boolean }`. Returns suggestions; nothing is saved. */
  admin.post(
    '/propose',
    asyncHandler(async (req, res) => {
      if (!enricher) throw new HttpError(503, 'Lookups are not configured');
      const body = (req.body ?? {}) as { artistId?: number; name?: string; spotifyId?: string; ai?: boolean };
      const artist = body.artistId != null ? repo.get(Number(body.artistId)) : null;
      if (body.artistId != null && !artist) throw new HttpError(404, 'Artist not found');
      if (!artist && !body.name?.trim() && !body.spotifyId) throw new HttpError(400, 'artistId, name or spotifyId is required');
      if (body.spotifyId && !/^[0-9A-Za-z]{22}$/.test(body.spotifyId)) throw new HttpError(400, 'Invalid spotifyId');
      res.json(await enricher.propose({ artist, name: body.name, spotifyId: body.spotifyId, useAi: Boolean(body.ai) }));
    }),
  );
  app.use('/api/admin', admin);

  app.use('/api', (_req, _res, next) => next(new HttpError(404, 'Not found')));

  const staticDir = options.staticDir ?? resolve(process.cwd(), 'dist');
  if (existsSync(staticDir)) {
    app.use(express.static(staticDir));
    const adminPage = resolve(staticDir, 'admin.html');
    app.get('/admin', (_req, res, next) => (existsSync(adminPage) ? res.sendFile(adminPage) : next()));
    app.get('*', (_req, res) => res.sendFile(resolve(staticDir, 'index.html')));
  }

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof HttpError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    const message = err instanceof Error ? err.message : String(err);
    if (/UNIQUE constraint failed/.test(message)) {
      res.status(409).json({ error: 'An artist with this name already exists' });
      return;
    }
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  });

  return app;
}
