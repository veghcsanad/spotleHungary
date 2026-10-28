import type { Answer, ArtistOption, GuessResult, HintOption, PuzzleInfo, RevealedHint } from '../shared/types.ts';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init?.headers },
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export const api = {
  artists: () => request<ArtistOption[]>('/artists'),
  daily: () => request<PuzzleInfo>('/puzzles/daily'),
  newPractice: () => request<PuzzleInfo>('/puzzles/practice'),
  puzzle: (id: string) => request<PuzzleInfo>(`/puzzles/${encodeURIComponent(id)}`),
  guess: (id: string, artistId: number) =>
    request<GuessResult>(`/puzzles/${encodeURIComponent(id)}/guess`, {
      method: 'POST',
      body: JSON.stringify({ artistId }),
    }),
  hintOptions: (id: string) => request<HintOption[]>(`/puzzles/${encodeURIComponent(id)}/hints`),
  revealHint: (id: string, slot: number, guesses: number) =>
    request<RevealedHint>(`/puzzles/${encodeURIComponent(id)}/hints/${slot}?guesses=${guesses}`),
  answer: (id: string) => request<Answer>(`/puzzles/${encodeURIComponent(id)}/answer`),
};
