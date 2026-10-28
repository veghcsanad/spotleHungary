/** Read-only Wikipedia (MediaWiki API) helpers used as sources for the AI fill. */

type FetchFn = typeof fetch;

export type WikiLang = 'hu' | 'en';

export interface WikiSearchResult {
  title: string;
  snippet: string;
}

export interface WikiPage {
  lang: WikiLang;
  title: string;
  url: string;
  /** Raw infobox/lead wikitext (attributes like birth place, years active, members). */
  infobox: string;
  /** Plain-text article body, truncated. */
  extract: string;
}

const USER_AGENT = 'SpotleHU-admin/1.0 (https://github.com/veghcsanad/spotleHungary)';
const MAX_EXTRACT = 7000;
const MAX_INFOBOX = 3000;
/** Hungary and neighbours with Hungarian minorities ("Határon túl"): SK, RO, RS, UA. */
const ALLOWED_COUNTRIES = ['Q28', 'Q214', 'Q218', 'Q403', 'Q212'];

export class Wikipedia {
  constructor(private readonly fetchFn: FetchFn = fetch) {}

  private async query<T>(lang: WikiLang, params: Record<string, string>): Promise<T> {
    const url = new URL(`https://${lang}.wikipedia.org/w/api.php`);
    for (const [k, v] of Object.entries({ format: 'json', formatversion: '2', ...params })) url.searchParams.set(k, v);
    const res = await this.fetchFn(url, { headers: { 'User-Agent': USER_AGENT } });
    if (!res.ok) throw new Error(`Wikipedia (${lang}) request failed (${res.status})`);
    return (await res.json()) as T;
  }

  async search(lang: WikiLang, query: string, limit = 5): Promise<WikiSearchResult[]> {
    const body = await this.query<{ query?: { search: { title: string; snippet: string }[] } }>(lang, {
      action: 'query',
      list: 'search',
      srsearch: query,
      srlimit: String(limit),
    });
    return (body.query?.search ?? []).map((r) => ({ title: r.title, snippet: r.snippet.replace(/<[^>]+>/g, '') }));
  }

  async page(lang: WikiLang, title: string): Promise<WikiPage | null> {
    const [extractBody, parseBody] = await Promise.all([
      this.query<{ query?: { pages: { title: string; missing?: boolean; extract?: string }[] } }>(lang, {
        action: 'query',
        prop: 'extracts',
        explaintext: '1',
        redirects: '1',
        titles: title,
      }),
      this.query<{ parse?: { title: string; wikitext: string } }>(lang, {
        action: 'parse',
        page: title,
        prop: 'wikitext',
        redirects: '1',
      }).catch(() => ({ parse: undefined })),
    ]);
    const page = extractBody.query?.pages?.[0];
    if (!page || page.missing) return null;
    const wikitext = parseBody.parse?.wikitext ?? '';
    // The infobox sits before the bold lead sentence ('''Name''').
    const leadStart = wikitext.search(/^'''/m);
    return {
      lang,
      title: page.title,
      url: `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(page.title.replace(/ /g, '_'))}`,
      infobox: wikitext.slice(0, leadStart > 0 ? leadStart : MAX_INFOBOX).slice(0, MAX_INFOBOX).trim(),
      extract: (page.extract ?? '').slice(0, MAX_EXTRACT).trim(),
    };
  }

  /**
   * Spotify artist ids recorded on Wikidata (property P1902) for a Wikipedia article. Entities whose
   * citizenship / country of origin is known but not Hungary are skipped (e.g. "Alvin és a mókusok"
   * is the American Chipmunks, not the Hungarian band).
   */
  async spotifyIds(lang: WikiLang, title: string): Promise<string[]> {
    const url = new URL('https://www.wikidata.org/w/api.php');
    const params = { action: 'wbgetentities', format: 'json', sites: `${lang}wiki`, titles: title, props: 'claims', redirects: 'yes' };
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    const res = await this.fetchFn(url, { headers: { 'User-Agent': USER_AGENT } });
    if (!res.ok) throw new Error(`Wikidata request failed (${res.status})`);
    type Claim = { mainsnak?: { datavalue?: { value?: unknown } } };
    const body = (await res.json()) as { entities?: Record<string, { claims?: Record<string, Claim[]> }> };
    const values = (claims: Record<string, Claim[]>, prop: string) => (claims[prop] ?? []).map((c) => c.mainsnak?.datavalue?.value);
    const ids = Object.values(body.entities ?? {}).flatMap((e) => {
      const claims = e.claims ?? {};
      const countries = ['P27', 'P495'].flatMap((p) => values(claims, p)).map((v) => (v as { id?: string } | undefined)?.id);
      if (countries.length && !countries.some((c) => c && ALLOWED_COUNTRIES.includes(c))) return [];
      return values(claims, 'P1902');
    });
    return [...new Set(ids.filter((v): v is string => typeof v === 'string' && /^[0-9A-Za-z]{22}$/.test(v)))];
  }
}
