/**
 * Minimal Spotify client for the admin portal.
 *
 * - Web API (client-credentials) for search, artist images and the discography.
 *   Apps in development mode may only request 10 albums per page and get no follower data.
 * - Monthly listeners are not part of the Web API; they are read from the public artist
 *   page's Open Graph description ("Artist · 1.2M monthly listeners.").
 * - The top tracks come from the public embed player page.
 */

type FetchFn = typeof fetch;

export interface SpotifyCandidate {
  id: string;
  name: string;
  imageUrl: string | null;
  monthlyListeners: number | null;
  url: string;
}

export interface SpotifyRelease {
  title: string;
  year: number | null;
  date: string;
  type: string;
}

export interface SpotifyFacts extends SpotifyCandidate {
  /** Albums and singles, oldest first (compilations / appearances excluded). */
  releases: SpotifyRelease[];
  oldestReleaseYear: number | null;
  topTracks: { title: string; artists: string }[];
  /** Set when the Web API part failed (e.g. rate limit); listeners/name/image may still be present. */
  apiError: string | null;
}

const SPOTIFY_ID = /^[0-9A-Za-z]{22}$/;
const RELEASE_PAGE = 10;
const MAX_RETRY_WAIT_S = 30;
const MIN_PLAUSIBLE_YEAR = 1950;

export const artistUrl = (id: string) => `https://open.spotify.com/artist/${id}`;

/** "1.2M" → 1200000, "45,678" → 45678. */
export function parseListeners(description: string): number | null {
  const m = description.match(/([\d.,]+)\s*([KMB]?)\s*monthly listener/i);
  if (!m) return null;
  const suffix = m[2].toUpperCase();
  const n = suffix ? parseFloat(m[1].replace(/,/g, '')) : Number(m[1].replace(/[.,]/g, ''));
  return Math.round(n * ({ K: 1e3, M: 1e6, B: 1e9 }[suffix] ?? 1));
}

const decodeHtml = (s: string) =>
  s
    .replace(/&amp;/g, '&')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');

export class SpotifyClient {
  private token: { value: string; expires: number } | null = null;

  constructor(
    private readonly clientId: string,
    private readonly clientSecret: string,
    private readonly fetchFn: FetchFn = fetch,
  ) {}

  static fromEnv(env = process.env): SpotifyClient | null {
    const id = env.SPOTIFY_CLIENT_ID;
    const secret = env.SPOTIFY_CLIENT_SECRET;
    return id && secret ? new SpotifyClient(id, secret) : null;
  }

  private async accessToken(): Promise<string> {
    if (this.token && this.token.expires > Date.now() + 30_000) return this.token.value;
    const res = await this.fetchFn('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${this.clientId}:${this.clientSecret}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: 'grant_type=client_credentials',
    });
    if (!res.ok) throw new Error(`Spotify token request failed (${res.status})`);
    const body = (await res.json()) as { access_token: string; expires_in: number };
    this.token = { value: body.access_token, expires: Date.now() + body.expires_in * 1000 };
    return this.token.value;
  }

  /** Set when Spotify answers 429 with a long Retry-After (dev-mode apps can be locked out for ~a day). */
  private blockedUntil = 0;

  /** Human-readable rate-limit status, or null when the Web API is usable. */
  get rateLimited(): string | null {
    const ms = this.blockedUntil - Date.now();
    if (ms <= 0) return null;
    const minutes = Math.ceil(ms / 60_000);
    const time = minutes >= 90 ? `~${Math.round(minutes / 60)} óra` : `~${minutes} perc`;
    return `A Spotify API ideiglenesen letiltotta a kéréseket (túl sok kérés). Újra ${time} múlva.`;
  }

  private async api<T>(path: string): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      const limited = this.rateLimited;
      if (limited) throw new Error(limited);
      const res = await this.fetchFn(`https://api.spotify.com/v1${path}`, {
        headers: { Authorization: `Bearer ${await this.accessToken()}` },
      });
      if (res.status === 429) {
        const retryAfter = Number(res.headers.get('retry-after') ?? 2) || 2;
        if (retryAfter <= MAX_RETRY_WAIT_S && attempt < 3) {
          await new Promise((r) => setTimeout(r, retryAfter * 1000));
          continue;
        }
        this.blockedUntil = Date.now() + retryAfter * 1000;
        throw new Error(this.rateLimited ?? 'Spotify rate limit');
      }
      if (!res.ok) throw new Error(`Spotify API ${path.split('?')[0]} failed (${res.status})`);
      return (await res.json()) as T;
    }
  }

  /** Public artist page: monthly listeners, name and image. */
  async page(id: string): Promise<{ name: string | null; monthlyListeners: number | null; imageUrl: string | null }> {
    const res = await this.fetchFn(artistUrl(id), { headers: { 'User-Agent': 'facebookexternalhit/1.1' } });
    if (!res.ok) return { name: null, monthlyListeners: null, imageUrl: null };
    const html = await res.text();
    const meta = (prop: string) => {
      const m = html.match(new RegExp(`property="${prop}" content="([^"]*)"`)) ?? html.match(new RegExp(`content="([^"]*)" property="${prop}"`));
      return m ? decodeHtml(m[1]) : null;
    };
    const description = meta('og:description') ?? '';
    return { name: meta('og:title'), monthlyListeners: parseListeners(description), imageUrl: meta('og:image') };
  }

  async search(query: string, limit = 6): Promise<SpotifyCandidate[]> {
    const q = encodeURIComponent(query.trim());
    if (!q) return [];
    const body = await this.api<{ artists: { items: { id: string; name: string; images?: { url: string }[] }[] } }>(
      `/search?type=artist&limit=${Math.min(limit, 10)}&q=${q}`,
    );
    return Promise.all(
      body.artists.items.slice(0, limit).map(async (a) => {
        const page = await this.page(a.id).catch(() => null);
        return {
          id: a.id,
          name: a.name,
          imageUrl: a.images?.[0]?.url ?? page?.imageUrl ?? null,
          monthlyListeners: page?.monthlyListeners ?? null,
          url: artistUrl(a.id),
        };
      }),
    );
  }

  /**
   * Picks the most likely profile for a name: exact (accent/case-insensitive) name matches
   * first — including Western name order ("Tamás Cseh") — then the most monthly listeners.
   */
  async bestMatch(name: string): Promise<SpotifyCandidate | null> {
    const candidates = await this.search(name);
    const key = (s: string) =>
      s
        .normalize('NFD')
        .replace(/\p{M}/gu, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();
    const target = key(name);
    const reversed = target.split(' ').reverse().join(' ');
    const exact = candidates.filter((c) => key(c.name) === target || key(c.name) === reversed);
    const pool = exact.length ? exact : candidates.slice(0, 1);
    return pool.sort((a, b) => (b.monthlyListeners ?? 0) - (a.monthlyListeners ?? 0))[0] ?? null;
  }

  /**
   * Newest and oldest albums and singles. Spotify lists each group newest first, so the first
   * page plus the last page cover both ends with at most 4 requests (instead of paging through
   * a whole discography, which quickly exhausts a development-mode app's quota).
   */
  async releases(id: string): Promise<SpotifyRelease[]> {
    type Page = { items: { id: string; name: string; release_date: string; album_type: string }[]; total: number };
    const base = `/artists/${id}/albums?limit=${RELEASE_PAGE}&market=HU&include_groups=`;
    const byId = new Map<string, SpotifyRelease>();
    for (const group of ['album', 'single']) {
      const first: Page = await this.api(`${base}${group}`);
      const pages = [first];
      if (first.total > RELEASE_PAGE) pages.push(await this.api<Page>(`${base}${group}&offset=${first.total - RELEASE_PAGE}`));
      for (const a of pages.flatMap((p) => p.items)) {
        const year = Number(a.release_date?.slice(0, 4));
        byId.set(a.id, { title: a.name, date: a.release_date, year: Number.isFinite(year) && year > 0 ? year : null, type: a.album_type });
      }
    }
    return [...byId.values()].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  }

  async topTracks(id: string): Promise<{ title: string; artists: string }[]> {
    const res = await this.fetchFn(`https://open.spotify.com/embed/artist/${id}`, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (!res.ok) return [];
    const m = (await res.text()).match(/<script id="__NEXT_DATA__"[^>]*>(.*?)<\/script>/s);
    try {
      const list = JSON.parse(m?.[1] ?? 'null')?.props?.pageProps?.state?.data?.entity?.trackList ?? [];
      return (list as { title: string; subtitle: string }[]).map((t) => ({ title: t.title, artists: t.subtitle }));
    } catch {
      return [];
    }
  }

  /**
   * Everything known about one profile. The public page (listeners, name, image) does not use the
   * Web API quota, so it still works while the API is rate limited; `apiError` then explains what is missing.
   */
  async facts(id: string): Promise<SpotifyFacts> {
    if (!SPOTIFY_ID.test(id)) throw new Error('Invalid Spotify artist id');
    let apiError: string | null = null;
    const viaApi = <T,>(p: Promise<T>, fallback: T) =>
      p.catch((err: Error) => {
        apiError ??= err.message;
        return fallback;
      });
    const [artist, page, releases, topTracks] = await Promise.all([
      viaApi(this.api<{ name: string; images?: { url: string }[] }>(`/artists/${id}`), null),
      this.page(id),
      viaApi(this.releases(id), [] as SpotifyRelease[]),
      this.topTracks(id).catch(() => []),
    ]);
    const name = artist?.name ?? page.name;
    if (!name) throw new Error(apiError ?? 'Spotify artist not found');
    // Some catalogues carry placeholder dates (e.g. 1900 or 1939 for digitised recordings); ignore those.
    const years = releases.map((r) => r.year).filter((y): y is number => y != null && y >= MIN_PLAUSIBLE_YEAR);
    return {
      id,
      name,
      url: artistUrl(id),
      imageUrl: artist?.images?.[0]?.url ?? page.imageUrl,
      monthlyListeners: page.monthlyListeners,
      releases,
      oldestReleaseYear: years.length ? Math.min(...years) : null,
      topTracks,
      apiError,
    };
  }
}
