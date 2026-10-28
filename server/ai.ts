import { z } from 'zod';
import { KNOWN_GENRES } from '../shared/game.ts';
import { HINT_TYPES, REGIONS } from '../shared/types.ts';
import type { ArtistInput } from './db.ts';
import type { SpotifyFacts } from './spotify.ts';
import type { Wikipedia, WikiLang, WikiPage } from './wiki.ts';

/** Hint types the AI may propose (`initials` is derived from the name, `lyric` is avoided). */
export const AI_HINT_TYPES = ['song', 'album', 'collab', 'member', 'award', 'trivia'] as const;

// Note: the structured-output API rejects min/max constraints, so ranges are checked in enrich.ts.
export const aiResultSchema = z.object({
  name: z.string().describe('Display name: Hungarian name order for persons (Cseh Tamás), stage names as-is'),
  debutYear: z.number().nullable(),
  members: z.number().nullable(),
  gender: z.enum(['male', 'female', 'mixed']).nullable(),
  genre: z.string().nullable(),
  city: z.string().nullable(),
  region: z.enum(REGIONS).nullable(),
  hints: z
    .array(
      z.object({
        type: z.enum(AI_HINT_TYPES),
        value: z.string(),
        evidence: z
          .string()
          .describe('Verbatim quote (5-25 words) from the provided Wikipedia text / tool result, or the exact Spotify title, that proves the hint'),
      }),
    )
    .describe('2-3 hints of distinct types, in Hungarian'),
  confidence: z.enum(['high', 'medium', 'low']),
  notes: z.string().describe('Short Hungarian explanation: what was found where, what is uncertain'),
  sources: z.array(z.string()).describe('URLs used'),
});
export type AiResult = z.infer<typeof aiResultSchema>;

/** The AI answer plus the text of every page it read through tools (used to verify hint evidence). */
export type AiFill = AiResult & { consulted?: string };

export interface AiContext {
  name: string;
  current: ArtistInput | null;
  spotify: SpotifyFacts | null;
  wiki: WikiPage[];
}

export interface AiStatus {
  available: boolean;
  message: string;
  models?: string[];
}

export interface AiProvider {
  status(): Promise<AiStatus>;
  fill(ctx: AiContext): Promise<AiFill>;
}

const REGION_GUIDE = `Regions (by county of the hometown):
- Közép-Magyarország: Budapest, Pest
- Közép-Dunántúl: Fejér, Komárom-Esztergom, Veszprém
- Nyugat-Dunántúl: Győr-Moson-Sopron, Vas, Zala
- Dél-Dunántúl: Baranya, Somogy, Tolna
- Észak-Magyarország: Borsod-Abaúj-Zemplén, Heves, Nógrád
- Észak-Alföld: Hajdú-Bihar, Jász-Nagykun-Szolnok, Szabolcs-Szatmár-Bereg
- Dél-Alföld: Bács-Kiskun, Békés, Csongrád-Csanád
- Határon túl: Hungarian community in a neighbouring country (Erdély, Felvidék, Vajdaság, Kárpátalja, ...)
- Külföld: grew up / formed elsewhere abroad`;

export const SYSTEM_PROMPT = `You fill in the database of "Spotle HU", a daily guessing game about Hungarian music artists.
Players guess an artist and compare: debut year, number of members, gender, genre, hometown (city + region), popularity.
After 7 wrong guesses the player may reveal one of 3 hints.

Field rules:
- debutYear: year the act started publishing music / professional career start (first single/album or founding year of a band).
  Spotify's oldest release can be a later reissue for old artists – prefer Wikipedia when it says earlier.
- members: 1 for solo artists, otherwise the current/classic line-up size of the band. Duos = 2.
- gender: male / female for solo artists; for bands: male or female when all members are, otherwise mixed.
- genre: exactly one of: ${KNOWN_GENRES.join(', ')}. Pick the closest.
- city: hometown of a solo artist (where they grew up, else birthplace) or the city where a band formed. Hungarian city names.
- region: one of the listed values, consistent with the city.
${REGION_GUIDE}
- hints (in Hungarian, 2-3, distinct types from: ${AI_HINT_TYPES.map((t) => `${t} (${HINT_TYPES[t]})`).join(', ')}):
  * NEVER contain the artist's name or obvious parts of it.
  * Do not use the most famous hits (the first ~3 Spotify top tracks or signature songs) – they would give it away instantly.
    Prefer a lesser-known song, an album with its year, e.g. "Álmodj velem (2019)", a collaboration partner, a band member, an award ("Fonogram-díj, 2021") or a short trivia.
  * Only use titles that appear in the provided Spotify data or in a source you read. Never invent facts and never write trivia from memory.
  * For every hint give "evidence": a verbatim quote (5-25 words) copied from the Wikipedia text or tool result that proves it,
    or for songs/albums the exact title as it appears in the Spotify data. Hints whose evidence is not found in the sources are discarded automatically,
    so return fewer hints rather than unsupported ones.
  * Keep hints short. Formats: song = "Title" (optionally "(year)"), album = "Title (year)", collab = only the partner's name (e.g. "Bereményi Géza"),
    member = only the member's name, award = "Award name, year", trivia = one short, specific, non-obvious sentence.
- name: keep the given display name unless it is in Western order for a Hungarian person (then Hungarian order).

Use null for anything you cannot verify – a wrong value is worse than an unknown one.
You can use the wiki_search and wiki_page tools to look up more Hungarian or English Wikipedia articles if the provided ones are missing or are about a different person.`;

const compact = (ctx: AiContext) => ({
  name: ctx.name,
  currentData: ctx.current,
  spotify: ctx.spotify && {
    url: ctx.spotify.url,
    name: ctx.spotify.name,
    monthlyListeners: ctx.spotify.monthlyListeners,
    oldestReleaseYear: ctx.spotify.oldestReleaseYear,
    topTracks: ctx.spotify.topTracks.map((t) => (t.artists ? `${t.title} — ${t.artists}` : t.title)),
    releases: ctx.spotify.releases.slice(0, 80).map((r) => `${r.date.slice(0, 4)} ${r.type}: ${r.title}`),
  },
  wikipedia: ctx.wiki.map((p) => ({ url: p.url, infobox: p.infobox, article: p.extract })),
});

export function buildPrompt(ctx: AiContext): string {
  return `Fill in the data for this artist. Return JSON matching the schema.\n\n${JSON.stringify(compact(ctx), null, 1)}`;
}

/**
 * AI provider backed by the GitHub Copilot SDK. It authenticates with the logged-in Copilot CLI
 * user (or COPILOT_GITHUB_TOKEN / GH_TOKEN / GITHUB_TOKEN) and runs every request in a fresh session
 * that only has read-only Wikipedia tools.
 */
export class CopilotAi implements AiProvider {
  private client: Promise<import('@github/copilot-sdk').CopilotClient> | null = null;

  constructor(
    private readonly wiki: Wikipedia,
    private readonly options: { model?: string; token?: string; timeoutMs?: number } = {},
  ) {}

  static fromEnv(wiki: Wikipedia, env = process.env): CopilotAi {
    return new CopilotAi(wiki, {
      model: env.AI_MODEL || undefined,
      token: env.COPILOT_GITHUB_TOKEN || env.GH_TOKEN || env.GITHUB_TOKEN || undefined,
    });
  }

  private getClient() {
    this.client ??= (async () => {
      const { CopilotClient } = await import('@github/copilot-sdk');
      const client = new CopilotClient(this.options.token ? { gitHubToken: this.options.token } : {});
      await client.start();
      return client;
    })().catch((err) => {
      this.client = null;
      throw err;
    });
    return this.client;
  }

  async status(): Promise<AiStatus> {
    try {
      const client = await this.getClient();
      const auth = await client.getAuthStatus();
      if (!auth.isAuthenticated) {
        return {
          available: false,
          message:
            'A Copilot nincs bejelentkezve. Futtasd egyszer: "npx @github/copilot" majd "/login", vagy állíts be COPILOT_GITHUB_TOKEN-t a .env-ben.',
        };
      }
      const models = (await client.listModels()).map((m) => m.id);
      return {
        available: true,
        message: `GitHub Copilot (${auth.login ?? 'bejelentkezve'}) · modell: ${this.options.model ?? 'alapértelmezett'}`,
        models,
      };
    } catch (err) {
      return { available: false, message: `Copilot SDK hiba: ${(err as Error).message}` };
    }
  }

  async fill(ctx: AiContext): Promise<AiFill> {
    const { approveAll, defineTool } = await import('@github/copilot-sdk');
    const client = await this.getClient();
    const wiki = this.wiki;
    const lang = z.enum(['hu', 'en']);
    const consulted: string[] = [];
    const session = await client.createSession({
      model: this.options.model,
      onPermissionRequest: approveAll,
      systemMessage: { mode: 'replace', content: SYSTEM_PROMPT },
      availableTools: ['wiki_search', 'wiki_page'],
      tools: [
        defineTool('wiki_search', {
          description: 'Search Wikipedia article titles (hu = Hungarian, en = English).',
          parameters: z.object({ lang, query: z.string() }),
          skipPermission: true,
          handler: async ({ lang, query }: { lang: WikiLang; query: string }) => {
            const results = await wiki.search(lang, query);
            consulted.push(...results.map((r) => `${r.title} ${r.snippet}`));
            return results;
          },
        }),
        defineTool('wiki_page', {
          description: 'Read a Wikipedia article (infobox wikitext + plain text) by exact title.',
          parameters: z.object({ lang, title: z.string() }),
          skipPermission: true,
          handler: async ({ lang, title }: { lang: WikiLang; title: string }) => {
            const page = await wiki.page(lang, title);
            if (page) consulted.push(page.infobox, page.extract);
            return page ?? { error: 'Page not found' };
          },
        }),
      ],
    });
    try {
      const result = await session.sendAndWait(
        { prompt: buildPrompt(ctx) },
        aiResultSchema,
        this.options.timeoutMs ?? 240_000,
      );
      return { ...aiResultSchema.parse(result), consulted: consulted.join('\n') };
    } finally {
      await session.disconnect().catch(() => undefined);
    }
  }
}
