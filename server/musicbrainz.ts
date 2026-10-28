/**
 * MusicBrainz lookup for Spotify artist ids. MusicBrainz records the artist's country and links
 * to streaming profiles, so it finds the Hungarian artist even when a foreign one has the same name,
 * and it does not use the (small) Spotify Web API quota.
 */

type FetchFn = typeof fetch;

const USER_AGENT = 'SpotleHU-admin/1.0 ( https://github.com/veghcsanad/spotleHungary )';
const MIN_INTERVAL_MS = 1100; // MusicBrainz allows ~1 request per second.
const MIN_SCORE = 90;
/** Hungary and neighbours with Hungarian minorities ("Határon túl"). */
const ALLOWED_COUNTRIES = ['HU', 'SK', 'RO', 'RS', 'UA'];

interface MbArtist {
  id: string;
  name: string;
  score: number;
  country?: string;
  area?: { name?: string };
}

const fold = (s: string) =>
  s
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

export class MusicBrainz {
  private queue: Promise<unknown> = Promise.resolve();
  private last = 0;

  constructor(
    private readonly fetchFn: FetchFn = fetch,
    private readonly interval = MIN_INTERVAL_MS,
  ) {}

  /** Requests run one at a time, spaced out; 503 (rate limited) is retried with back-off. */
  private get<T>(path: string): Promise<T> {
    const run = async (): Promise<T> => {
      for (let attempt = 0; ; attempt++) {
        const wait = this.last + this.interval * (attempt + 1) - Date.now();
        if (wait > 0) await new Promise((r) => setTimeout(r, wait));
        this.last = Date.now();
        const res = await this.fetchFn(`https://musicbrainz.org/ws/2${path}`, {
          headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
        });
        if (res.status === 503 && attempt < 3) continue;
        if (!res.ok) throw new Error(`MusicBrainz request failed (${res.status})`);
        return (await res.json()) as T;
      }
    };
    const result = this.queue.then(run, run);
    this.queue = result.catch(() => undefined);
    return result;
  }

  /** Spotify ids linked from Hungarian MusicBrainz artists whose name matches. */
  async spotifyIds(name: string): Promise<string[]> {
    const q = encodeURIComponent(`artist:"${name.replace(/"/g, '')}"`);
    const body = await this.get<{ artists?: MbArtist[] }>(`/artist/?query=${q}&fmt=json&limit=5`);
    const target = fold(name);
    const reversed = target.split(' ').reverse().join(' ');
    const matches = (body.artists ?? []).filter(
      (a) =>
        a.score >= MIN_SCORE &&
        (ALLOWED_COUNTRIES.includes(a.country ?? '') || a.area?.name === 'Hungary') &&
        [target, reversed].includes(fold(a.name)),
    );
    const ids: string[] = [];
    for (const a of matches.slice(0, 2)) {
      const detail = await this.get<{ relations?: { url?: { resource?: string } }[] }>(`/artist/${a.id}?inc=url-rels&fmt=json`);
      for (const rel of detail.relations ?? []) {
        const m = rel.url?.resource?.match(/open\.spotify\.com\/artist\/([0-9A-Za-z]{22})/);
        if (m && !ids.includes(m[1])) ids.push(m[1]);
      }
    }
    return ids;
  }
}
