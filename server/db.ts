import type { DatabaseSync as DatabaseSyncType } from 'node:sqlite';
import { createRequire } from 'node:module';
import { readFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Artist, RankedArtist } from '../shared/types.ts';

// Loaded via require because Vite/Vitest 5 does not yet recognise `node:sqlite` as a builtin.
const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as typeof import('node:sqlite');
type DatabaseSync = DatabaseSyncType;

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const DEFAULT_DB_PATH = resolve(ROOT, 'data', 'spotle.db');
export const SEED_PATH = resolve(ROOT, 'data', 'artists.json');

/** Bump when the schema changes; older databases are migrated in `migrate()`. */
const SCHEMA_VERSION = 3;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS artist (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  name              TEXT    NOT NULL UNIQUE,
  debut_year        INTEGER,
  members           INTEGER CHECK (members >= 1),
  gender            TEXT    CHECK (gender IN ('male', 'female', 'mixed')),
  genre             TEXT,
  city              TEXT,
  region            TEXT,
  monthly_listeners INTEGER NOT NULL DEFAULT 0,
  image_url         TEXT,
  hint1_type        TEXT,
  hint1             TEXT,
  hint2_type        TEXT,
  hint2             TEXT,
  hint3_type        TEXT,
  hint3             TEXT,
  last_checked      TEXT    NOT NULL DEFAULT (datetime('now'))
);
`;

export type ArtistInput = Omit<Artist, 'id'>;

interface ArtistRow {
  id: number;
  name: string;
  debut_year: number | null;
  members: number | null;
  gender: Artist['gender'];
  genre: string | null;
  city: string | null;
  region: Artist['region'];
  monthly_listeners: number;
  image_url: string | null;
  hint1_type: string | null;
  hint1: string | null;
  hint2_type: string | null;
  hint2: string | null;
  hint3_type: string | null;
  hint3: string | null;
  rank: number;
}

const toArtist = (r: ArtistRow): RankedArtist => ({
  id: r.id,
  name: r.name,
  debutYear: r.debut_year,
  members: r.members,
  gender: r.gender,
  genre: r.genre,
  city: r.city,
  region: r.region,
  monthlyListeners: r.monthly_listeners,
  imageUrl: r.image_url,
  hint1Type: r.hint1_type,
  hint1: r.hint1,
  hint2Type: r.hint2_type,
  hint2: r.hint2,
  hint3Type: r.hint3_type,
  hint3: r.hint3,
  rank: r.rank,
});

const RANKED_SELECT = `
  SELECT *, ROW_NUMBER() OVER (ORDER BY monthly_listeners DESC, name ASC) AS rank
  FROM artist
`;

const COLUMNS =
  'name, debut_year, members, gender, genre, city, region, monthly_listeners, image_url, hint1_type, hint1, hint2_type, hint2, hint3_type, hint3';

const values = (a: ArtistInput) =>
  [
    a.name,
    a.debutYear,
    a.members,
    a.gender,
    a.genre,
    a.city,
    a.region,
    a.monthlyListeners,
    a.imageUrl ?? null,
    a.hint1Type ?? null,
    a.hint1 ?? null,
    a.hint2Type ?? null,
    a.hint2 ?? null,
    a.hint3Type ?? null,
    a.hint3 ?? null,
  ] as const;

export class ArtistRepository {
  constructor(private readonly db: DatabaseSync) {
    this.migrate();
  }

  static open(path = process.env.DB_PATH ?? DEFAULT_DB_PATH): ArtistRepository {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    const repo = new ArtistRepository(new DatabaseSync(path));
    if (repo.count() === 0) repo.seedFromFile();
    return repo;
  }

  private migrate() {
    const { user_version: version } = this.db.prepare('PRAGMA user_version').get() as { user_version: number };
    if (version >= SCHEMA_VERSION) return;
    const hasTable = this.db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'artist'").get();
    if (hasTable && version < 2) {
      // v1 had a single `top_song` column; keep it as the first hint.
      const cols = (this.db.prepare('PRAGMA table_info(artist)').all() as { name: string }[]).map((c) => c.name);
      for (const col of ['hint1_type', 'hint1', 'hint2_type', 'hint2', 'hint3_type', 'hint3']) {
        if (!cols.includes(col)) this.db.exec(`ALTER TABLE artist ADD COLUMN ${col} TEXT`);
      }
      if (cols.includes('top_song')) {
        this.db.exec(`UPDATE artist SET hint1_type = 'song', hint1 = top_song WHERE top_song IS NOT NULL AND hint1 IS NULL;
                      ALTER TABLE artist DROP COLUMN top_song;`);
      }
    }
    if (hasTable && version < 3) {
      // v3 made the guessable attributes nullable (unknown data); SQLite needs a table rebuild for that.
      this.db.exec(`BEGIN;
        ALTER TABLE artist RENAME TO artist_v2;
        ${SCHEMA}
        INSERT INTO artist (id, ${COLUMNS}, last_checked) SELECT id, ${COLUMNS}, last_checked FROM artist_v2;
        DROP TABLE artist_v2;
        COMMIT;`);
    }
    this.db.exec(SCHEMA);
    this.db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
  }

  count(): number {
    return (this.db.prepare('SELECT COUNT(*) AS n FROM artist').get() as { n: number }).n;
  }

  /** All artists with their popularity rank, ordered by id (stable order for puzzle selection). */
  list(): RankedArtist[] {
    const rows = this.db.prepare(`SELECT * FROM (${RANKED_SELECT}) ORDER BY id`).all() as unknown as ArtistRow[];
    return rows.map(toArtist);
  }

  get(id: number): RankedArtist | undefined {
    const row = this.db.prepare(`SELECT * FROM (${RANKED_SELECT}) WHERE id = ?`).get(id) as ArtistRow | undefined;
    return row && toArtist(row);
  }

  create(a: ArtistInput): RankedArtist {
    const res = this.db
      .prepare(`INSERT INTO artist (${COLUMNS}) VALUES (${COLUMNS.split(',').map(() => '?').join(', ')})`)
      .run(...values(a));
    return this.get(Number(res.lastInsertRowid))!;
  }

  update(id: number, a: ArtistInput): RankedArtist | undefined {
    const assignments = COLUMNS.split(',')
      .map((c) => `${c.trim()} = ?`)
      .join(', ');
    const res = this.db
      .prepare(`UPDATE artist SET ${assignments}, last_checked = datetime('now') WHERE id = ?`)
      .run(...values(a), id);
    return res.changes ? this.get(id) : undefined;
  }

  delete(id: number): boolean {
    return this.db.prepare('DELETE FROM artist WHERE id = ?').run(id).changes > 0;
  }

  /** Replaces all artists with the contents of the seed JSON file. */
  seedFromFile(path = SEED_PATH): number {
    const artists = JSON.parse(readFileSync(path, 'utf8')) as ArtistInput[];
    this.db.exec('BEGIN');
    try {
      this.db.exec("DELETE FROM artist; DELETE FROM sqlite_sequence WHERE name = 'artist';");
      for (const a of artists) this.create(a);
      this.db.exec('COMMIT');
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
    return artists.length;
  }
}
