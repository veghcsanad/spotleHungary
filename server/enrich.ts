import { KNOWN_GENRES } from '../shared/game.ts';
import { HINT_TYPES as HINT_LABEL } from '../shared/types.ts';
import type { RankedArtist } from '../shared/types.ts';
import type { AiProvider, AiResult } from './ai.ts';
import type { ArtistInput } from './db.ts';
import type { MusicBrainz } from './musicbrainz.ts';
import type { SpotifyCandidate, SpotifyClient, SpotifyFacts } from './spotify.ts';
import type { Wikipedia, WikiLang, WikiPage } from './wiki.ts';

export type ProposalSource = 'spotify' | 'ai';

/** Suggested values for one artist; nothing is saved until the admin accepts it. */
export interface Proposal {
  artistId: number | null;
  name: string;
  spotify: (SpotifyCandidate & { oldestReleaseYear: number | null }) | null;
  values: Partial<ArtistInput>;
  sources: Partial<Record<keyof ArtistInput, ProposalSource>>;
  ai: Pick<AiResult, 'confidence' | 'notes' | 'sources'> | null;
  aiError: string | null;
  warnings: string[];
}

export interface ProposeOptions {
  artist?: RankedArtist | null;
  name?: string;
  spotifyId?: string;
  useAi?: boolean;
}

const fold = (s: string) =>
  s
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase();

/** True when the hint would reveal the answer (contains the name or a distinctive part of it). */
export function hintRevealsName(hint: string, name: string): boolean {
  const h = fold(hint);
  const n = fold(name).trim();
  if (n && h.includes(n)) return true;
  return n
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 4)
    .some((w) => new RegExp(`\\b${w}`).test(h));
}

const norm = (s: string) => fold(s).replace(/[^a-z0-9]+/g, ' ').trim();

/**
 * Keeps only hints that are backed by the sources the AI actually saw: the evidence quote must occur
 * in them, and titles / names must appear there too (so an invented "trivia" or song is dropped).
 */
export function verifyHints(hints: AiResult['hints'], corpus: string): { kept: AiResult['hints']; dropped: AiResult['hints'] } {
  const text = ` ${norm(corpus)} `;
  const has = (s: string) => {
    const n = norm(s);
    return n.length >= 3 && text.includes(` ${n} `);
  };
  const kept: AiResult['hints'] = [];
  const dropped: AiResult['hints'] = [];
  for (const h of hints) {
    const core = h.value.replace(/\(\s*\d{4}\s*\)\s*$/, '').replace(/^["„”']+|["„”']+$/g, '').trim();
    const reversed = core.split(/\s+/).reverse().join(' ');
    let ok = has(h.evidence ?? '');
    if (h.type === 'song' || h.type === 'album') ok = has(core);
    if (h.type === 'collab' || h.type === 'member') ok = has(core) || has(reversed);
    (ok ? kept : dropped).push(h);
  }
  return { kept, dropped };
}

export function hintsFromAi(hints: AiResult['hints'], name: string): Partial<ArtistInput> {
  const seen = new Set<string>();
  const usable = hints.filter((h) => {
    const value = h.value.trim();
    if (!value || seen.has(h.type) || hintRevealsName(value, name)) return false;
    seen.add(h.type);
    return true;
  });
  const out: Partial<ArtistInput> = {};
  for (let i = 0; i < 3; i++) {
    const slot = (i + 1) as 1 | 2 | 3;
    const h = usable[i];
    out[`hint${slot}Type`] = h ? h.type : 'initials';
    out[`hint${slot}`] = h ? h.value.trim() : null;
  }
  // Only one initials slot is useful.
  if (usable.length < 2) {
    out.hint3Type = null;
    out.hint3 = null;
  }
  return out;
}

export class Enricher {
  constructor(
    readonly spotify: SpotifyClient | null,
    readonly wiki: Wikipedia,
    readonly ai: AiProvider | null,
    readonly musicBrainz: MusicBrainz | null = null,
  ) {}

  /** Wikipedia articles whose title contains every name token (any order: "Tamás Cseh" ↔ "Cseh Tamás"). */
  private async findWikiTitles(name: string): Promise<{ lang: WikiLang; title: string }[]> {
    const tokens = fold(name)
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length >= 3);
    const reversed = name.split(/\s+/).reverse().join(' ');
    const pick = async (lang: WikiLang, queries: string[]) => {
      for (const query of queries) {
        const results = await this.wiki.search(lang, query, 3).catch(() => []);
        const hit = results.find((r) => tokens.every((t) => fold(r.title).includes(t)));
        if (hit) return { lang, title: hit.title };
      }
      return null;
    };
    const huQueries = reversed !== name ? [name, reversed] : [name];
    const found = await Promise.all([pick('hu', huQueries), pick('en', [`${name} Hungarian`, name])]);
    return found.filter((t): t is { lang: WikiLang; title: string } => t != null);
  }

  /**
   * Spotify id from Wikidata (P1902) or MusicBrainz. Unlike a Spotify name search these do not use
   * the Spotify quota and are not fooled by foreign artists with the same name.
   */
  private async spotifyIdFromCatalogues(name: string, titles: { lang: WikiLang; title: string }[]): Promise<string | null> {
    const pickMostListened = async (ids: string[]) => {
      if (ids.length <= 1 || !this.spotify) return ids[0] ?? null;
      // Several profiles (e.g. old and new): take the one with the most listeners.
      const pages = await Promise.all(ids.map((id) => this.spotify!.page(id).catch(() => null)));
      return ids[pages.reduce((best, p, i) => ((p?.monthlyListeners ?? -1) > (pages[best]?.monthlyListeners ?? -1) ? i : best), 0)];
    };
    for (const t of titles) {
      const ids = await this.wiki.spotifyIds(t.lang, t.title).catch(() => []);
      if (ids.length) return pickMostListened(ids);
    }
    if (this.musicBrainz) return pickMostListened(await this.musicBrainz.spotifyIds(name).catch(() => []));
    return null;
  }

  async propose(opts: ProposeOptions): Promise<Proposal> {
    const artist = opts.artist ?? null;
    let name = (artist?.name ?? opts.name ?? '').trim();
    const proposal: Proposal = {
      artistId: artist?.id ?? null,
      name,
      spotify: null,
      values: {},
      sources: {},
      ai: null,
      aiError: null,
      warnings: [],
    };
    const set = <K extends keyof ArtistInput>(key: K, value: ArtistInput[K], source: ProposalSource) => {
      proposal.values[key] = value;
      proposal.sources[key] = source;
    };

    let facts: SpotifyFacts | null = null;
    let wikiTitles: Promise<{ lang: WikiLang; title: string }[]> | null = null;
    const titles = () => (wikiTitles ??= name ? this.findWikiTitles(name) : Promise.resolve([]));
    if (this.spotify) {
      try {
        let spotifyId = opts.spotifyId ?? artist?.spotifyId ?? null;
        if (!spotifyId && name) {
          spotifyId = await this.spotifyIdFromCatalogues(name, await titles());
          if (spotifyId) proposal.warnings.push('A Spotify-profil a Wikidatából / MusicBrainzből származik – ellenőrizd a linket.');
        }
        if (!spotifyId && name) spotifyId = (await this.spotify.bestMatch(name))?.id ?? null;
        if (spotifyId) {
          facts = await this.spotify.facts(spotifyId);
          const { releases: _releases, topTracks: _topTracks, apiError, ...summary } = facts;
          proposal.spotify = summary;
          if (apiError) proposal.warnings.push(`Spotify: ${apiError}`);
          if (!name) name = facts.name;
          set('spotifyId', facts.id, 'spotify');
          if (facts.monthlyListeners != null) set('monthlyListeners', facts.monthlyListeners, 'spotify');
          if (facts.imageUrl) set('imageUrl', facts.imageUrl, 'spotify');
          if (facts.oldestReleaseYear != null) set('debutYear', facts.oldestReleaseYear, 'spotify');
        } else {
          proposal.warnings.push('Nem található Spotify-profil.');
        }
      } catch (err) {
        proposal.warnings.push(`Spotify: ${(err as Error).message}`);
      }
    } else {
      proposal.warnings.push('Spotify nincs beállítva (SPOTIFY_CLIENT_ID / SPOTIFY_CLIENT_SECRET).');
    }
    if (!name) throw new Error('Name or Spotify id is required');
    proposal.name = name;
    if (!artist) set('name', name, 'spotify');

    if (opts.useAi) {
      if (!this.ai) {
        proposal.aiError = 'AI nincs beállítva.';
      } else {
        try {
          const pages = (await Promise.all((await titles()).map((t) => this.wiki.page(t.lang, t.title).catch(() => null)))).filter(
            (p): p is WikiPage => p != null,
          );
          const { id: _id, rank: _rank, ...current } = artist ?? ({} as RankedArtist);
          const result = await this.ai.fill({ name, current: artist ? current : null, spotify: facts, wiki: pages });
          proposal.ai = { confidence: result.confidence, notes: result.notes, sources: result.sources };
          if (result.name && result.name !== name) set('name', result.name.trim(), 'ai');
          const year = result.debutYear == null ? null : Math.round(result.debutYear);
          if (year != null && year >= 1900 && year <= new Date().getFullYear()) set('debutYear', year, 'ai');
          const members = result.members == null ? null : Math.round(result.members);
          if (members != null && members >= 1 && members <= 50) set('members', members, 'ai');
          if (result.gender != null) set('gender', result.gender, 'ai');
          if (result.genre != null) {
            const genre = KNOWN_GENRES.find((g) => fold(g) === fold(result.genre!));
            if (genre) set('genre', genre, 'ai');
            else proposal.warnings.push(`Ismeretlen műfaj javaslat: ${result.genre}`);
          }
          if (result.city != null) set('city', result.city, 'ai');
          if (result.region != null) set('region', result.region, 'ai');
          if (result.hints.length) {
            const corpus = [
              ...pages.flatMap((p) => [p.title, p.infobox, p.extract]),
              ...(facts?.topTracks ?? []).map((t) => `${t.title} | ${t.artists}`),
              ...(facts?.releases ?? []).map((r) => r.title),
              result.consulted ?? '',
            ].join('\n');
            const { kept, dropped } = verifyHints(result.hints, corpus);
            for (const h of dropped) proposal.warnings.push(`Forrással nem igazolt tipp elvetve: ${HINT_LABEL[h.type] ?? h.type}: ${h.value}`);
            for (const [k, v] of Object.entries(hintsFromAi(kept, result.name || name))) {
              set(k as keyof ArtistInput, v as never, 'ai');
            }
          }
        } catch (err) {
          proposal.aiError = (err as Error).message;
        }
      }
    }
    if (
      proposal.sources.debutYear === 'spotify' &&
      artist?.debutYear != null &&
      facts?.oldestReleaseYear != null &&
      facts.oldestReleaseYear > artist.debutYear
    ) {
      // Reissues make Spotify's oldest release later than the real debut; keep the known value.
      delete proposal.values.debutYear;
      delete proposal.sources.debutYear;
    }
    return proposal;
  }
}
