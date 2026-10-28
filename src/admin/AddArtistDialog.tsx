import { useState } from 'react';
import type { RankedArtist } from '../../shared/types.ts';
import { adminApi, formatListeners, type Meta, type SpotifyCandidate } from './adminApi.ts';
import { Dialog } from './ArtistEditor.tsx';

interface Props {
  meta: Meta;
  artists: RankedArtist[];
  onPick: (req: { name?: string; spotifyId?: string; ai: boolean; label: string }) => void;
  onManual: () => void;
  onClose: () => void;
}

export function AddArtistDialog({ meta, artists, onPick, onManual, onClose }: Props) {
  const [tab, setTab] = useState<'search' | 'bulk'>('search');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SpotifyCandidate[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [useAi, setUseAi] = useState(meta.ai.available);
  const [bulk, setBulk] = useState('');

  const existingIds = new Map(artists.filter((a) => a.spotifyId).map((a) => [a.spotifyId!, a.name]));
  const existingNames = new Set(artists.map((a) => a.name.toLocaleLowerCase('hu')));

  const search = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim()) return;
    setLoading(true);
    setError(null);
    try {
      setResults(await adminApi.searchSpotify(query));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const bulkNames = bulk
    .split(/[\n,;]+/)
    .map((s) => s.trim())
    .filter(Boolean);

  return (
    <Dialog title="Új előadó" onClose={onClose} wide>
      <div className="a-tabs">
        <button className={tab === 'search' ? 'is-active' : ''} onClick={() => setTab('search')}>
          Spotify keresés
        </button>
        <button className={tab === 'bulk' ? 'is-active' : ''} onClick={() => setTab('bulk')}>
          Több név egyszerre
        </button>
        <button onClick={onManual}>Kézi felvétel</button>
      </div>
      <label className="a-check">
        <input type="checkbox" checked={useAi} disabled={!meta.ai.available} onChange={(e) => setUseAi(e.target.checked)} />
        Adatok kitöltése AI-val {!meta.ai.available && <small className="a-muted">({meta.ai.message})</small>}
      </label>

      {tab === 'search' ? (
        <>
          <form className="a-searchrow" onSubmit={search}>
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="pl. Cseh Tamás" autoFocus />
            <button className="a-btn a-btn--primary" disabled={loading || !meta.spotify}>
              {loading ? 'Keresés…' : 'Keresés'}
            </button>
          </form>
          {!meta.spotify && <p className="a-warn">A Spotify nincs beállítva (.env: SPOTIFY_CLIENT_ID / SPOTIFY_CLIENT_SECRET).</p>}
          {error && <p className="a-error">{error}</p>}
          {results && (
            <ul className="a-results">
              {results.length === 0 && <li className="a-muted">Nincs találat.</li>}
              {results.map((c) => {
                const existing = existingIds.get(c.id);
                return (
                  <li key={c.id}>
                    {c.imageUrl ? <img src={c.imageUrl} alt="" /> : <div className="a-noimg">?</div>}
                    <div>
                      <strong>{c.name}</strong>
                      <small>
                        {formatListeners(c.monthlyListeners)} havi hallgató ·{' '}
                        <a href={c.url} target="_blank" rel="noreferrer">
                          Spotify ↗
                        </a>
                      </small>
                    </div>
                    {existing ? (
                      <span className="a-muted">már szerepel: {existing}</span>
                    ) : (
                      <button className="a-btn a-btn--primary" onClick={() => onPick({ spotifyId: c.id, ai: useAi, label: c.name })}>
                        Hozzáad
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </>
      ) : (
        <>
          <p className="a-muted">
            Soronként (vagy vesszővel elválasztva) egy név. A Spotify-profilt automatikusan választjuk (pontos névegyezés, legtöbb hallgató) –
            az áttekintésnél ellenőrizd!
          </p>
          <textarea rows={8} value={bulk} onChange={(e) => setBulk(e.target.value)} placeholder={'Cseh Tamás\nGalaxisok\nDopeman'} />
          <footer className="a-form__foot">
            <span className="a-muted">
              {bulkNames.filter((n) => existingNames.has(n.toLocaleLowerCase('hu'))).length
                ? `Már szerepel: ${bulkNames.filter((n) => existingNames.has(n.toLocaleLowerCase('hu'))).join(', ')}`
                : ''}
            </span>
            <button
              className="a-btn a-btn--primary"
              disabled={!bulkNames.length}
              onClick={() => {
                for (const name of bulkNames) {
                  if (!existingNames.has(name.toLocaleLowerCase('hu'))) onPick({ name, ai: useAi, label: name });
                }
                onClose();
              }}
            >
              {bulkNames.length} előadó lekérdezése
            </button>
          </footer>
        </>
      )}
    </Dialog>
  );
}
