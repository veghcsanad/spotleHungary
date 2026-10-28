import type { RankedArtist } from '../../shared/types.ts';

export type ArtistInput = Omit<RankedArtist, 'id' | 'rank'>;
export type Field = keyof ArtistInput;

export interface Meta {
  regions: string[];
  hintTypes: Record<string, string>;
  genres: string[];
  persistsToFile: boolean;
  spotify: boolean;
  /** Message while the Spotify Web API is rate limited (search / discography unavailable). */
  spotifyLimited: string | null;
  ai: { available: boolean; message: string; models?: string[] };
}

export interface SpotifyCandidate {
  id: string;
  name: string;
  imageUrl: string | null;
  monthlyListeners: number | null;
  url: string;
}

export interface Proposal {
  artistId: number | null;
  name: string;
  spotify: (SpotifyCandidate & { oldestReleaseYear: number | null }) | null;
  values: Partial<ArtistInput>;
  sources: Partial<Record<Field, 'spotify' | 'ai'>>;
  ai: { confidence: 'high' | 'medium' | 'low'; notes: string; sources: string[] } | null;
  aiError: string | null;
  warnings: string[];
}

const TOKEN_KEY = 'spotle-hu-admin-token';
export const getToken = () => localStorage.getItem(TOKEN_KEY) ?? '';
export const setToken = (t: string) => (t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY));

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api/admin${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}`, ...init?.headers },
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new ApiError(res.status, body?.error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export const adminApi = {
  meta: () => request<Meta>('/meta'),
  list: () => request<RankedArtist[]>('/artists'),
  create: (a: ArtistInput) => request<RankedArtist>('/artists', { method: 'POST', body: JSON.stringify(a) }),
  update: (id: number, a: ArtistInput) =>
    request<RankedArtist>(`/artists/${id}`, { method: 'PUT', body: JSON.stringify(a) }),
  remove: (id: number) => request<{ result: string }>(`/artists/${id}`, { method: 'DELETE' }),
  searchSpotify: (q: string) => request<SpotifyCandidate[]>(`/spotify/search?q=${encodeURIComponent(q)}`),
  propose: (body: { artistId?: number; name?: string; spotifyId?: string; ai: boolean }) =>
    request<Proposal>('/propose', { method: 'POST', body: JSON.stringify(body) }),
};

export const EMPTY_ARTIST: ArtistInput = {
  name: '',
  spotifyId: null,
  debutYear: null,
  members: null,
  gender: null,
  genre: null,
  city: null,
  region: null,
  monthlyListeners: 0,
  imageUrl: null,
  hint1Type: null,
  hint1: null,
  hint2Type: null,
  hint2: null,
  hint3Type: null,
  hint3: null,
};

export const FIELDS = Object.keys(EMPTY_ARTIST) as Field[];

export const toInput = (a: Partial<ArtistInput>): ArtistInput => {
  const out = { ...EMPTY_ARTIST } as Record<Field, unknown>;
  for (const k of FIELDS) out[k] = a[k] ?? EMPTY_ARTIST[k];
  return out as unknown as ArtistInput;
};

export const FIELD_LABELS: Record<Field, string> = {
  name: 'Név',
  spotifyId: 'Spotify ID',
  debutYear: 'Debütálás',
  members: 'Tagok',
  gender: 'Nem',
  genre: 'Műfaj',
  city: 'Város',
  region: 'Régió',
  monthlyListeners: 'Havi hallgatók',
  imageUrl: 'Kép URL',
  hint1Type: '1. tipp típusa',
  hint1: '1. tipp',
  hint2Type: '2. tipp típusa',
  hint2: '2. tipp',
  hint3Type: '3. tipp típusa',
  hint3: '3. tipp',
};

export const GENDER_LABELS: Record<string, string> = { male: 'Férfi', female: 'Nő', mixed: 'Vegyes' };

export const formatListeners = (n: number | null | undefined) =>
  n == null ? '–' : n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}K` : String(n);
