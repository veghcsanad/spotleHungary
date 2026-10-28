import { useEffect, useState, type ReactNode } from 'react';
import { EMPTY_ARTIST, FIELD_LABELS, GENDER_LABELS, type ArtistInput, type Meta } from './adminApi.ts';

export function Dialog({
  title,
  onClose,
  children,
  wide,
}: {
  title: ReactNode;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="a-backdrop" onMouseDown={onClose}>
      <div className={`a-dialog${wide ? ' a-dialog--wide' : ''}`} role="dialog" aria-modal="true" onMouseDown={(e) => e.stopPropagation()}>
        <header className="a-dialog__head">
          <h2>{title}</h2>
          <button className="a-icon" onClick={onClose} aria-label="Bezárás">
            ✕
          </button>
        </header>
        <div className="a-dialog__body">{children}</div>
      </div>
    </div>
  );
}

interface EditorProps {
  meta: Meta;
  title: string;
  initial: ArtistInput;
  onSave: (a: ArtistInput) => Promise<void>;
  onClose: () => void;
}

const numOrNull = (v: string) => (v.trim() === '' ? null : Number(v));
const strOrNull = (v: string) => (v.trim() === '' ? null : v);

export function ArtistEditor({ meta, title, initial, onSave, onClose }: EditorProps) {
  const [a, setA] = useState<ArtistInput>({ ...EMPTY_ARTIST, ...initial });
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const set = <K extends keyof ArtistInput>(k: K, v: ArtistInput[K]) => setA((prev) => ({ ...prev, [k]: v }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const clean = { ...a };
      for (const slot of [1, 2, 3] as const) if (clean[`hint${slot}Type`] === 'initials') clean[`hint${slot}`] = null;
      await onSave(clean);
    } catch (err) {
      setError((err as Error).message);
      setSaving(false);
    }
  };

  const genres = a.genre && !meta.genres.includes(a.genre) ? [a.genre, ...meta.genres] : meta.genres;

  return (
    <Dialog title={title} onClose={onClose} wide>
      <form className="a-form" onSubmit={submit}>
        <div className="a-form__head">
          {a.imageUrl ? <img src={a.imageUrl} alt="" /> : <div className="a-noimg">?</div>}
          <label className="a-field a-field--grow">
            <span>{FIELD_LABELS.name}</span>
            <input value={a.name} onChange={(e) => set('name', e.target.value)} required autoFocus />
          </label>
        </div>
        <div className="a-grid">
          <label className="a-field">
            <span>{FIELD_LABELS.debutYear}</span>
            <input type="number" min={1900} max={2100} value={a.debutYear ?? ''} onChange={(e) => set('debutYear', numOrNull(e.target.value))} />
          </label>
          <label className="a-field">
            <span>{FIELD_LABELS.members} (1 = szóló)</span>
            <input type="number" min={1} value={a.members ?? ''} onChange={(e) => set('members', numOrNull(e.target.value))} />
          </label>
          <label className="a-field">
            <span>{FIELD_LABELS.gender}</span>
            <select value={a.gender ?? ''} onChange={(e) => set('gender', (strOrNull(e.target.value) as ArtistInput['gender']) ?? null)}>
              <option value="">? (ismeretlen)</option>
              {Object.entries(GENDER_LABELS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </label>
          <label className="a-field">
            <span>{FIELD_LABELS.genre}</span>
            <select value={a.genre ?? ''} onChange={(e) => set('genre', strOrNull(e.target.value))}>
              <option value="">? (ismeretlen)</option>
              {genres.map((g) => (
                <option key={g}>{g}</option>
              ))}
            </select>
          </label>
          <label className="a-field">
            <span>{FIELD_LABELS.city}</span>
            <input value={a.city ?? ''} onChange={(e) => set('city', strOrNull(e.target.value))} />
          </label>
          <label className="a-field">
            <span>{FIELD_LABELS.region}</span>
            <select value={a.region ?? ''} onChange={(e) => set('region', strOrNull(e.target.value) as ArtistInput['region'])}>
              <option value="">? (ismeretlen)</option>
              {meta.regions.map((r) => (
                <option key={r}>{r}</option>
              ))}
            </select>
          </label>
          <label className="a-field">
            <span>{FIELD_LABELS.monthlyListeners}</span>
            <input type="number" min={0} value={a.monthlyListeners} onChange={(e) => set('monthlyListeners', Number(e.target.value) || 0)} />
          </label>
          <label className="a-field">
            <span>
              {FIELD_LABELS.spotifyId}
              {a.spotifyId && (
                <a href={`https://open.spotify.com/artist/${a.spotifyId}`} target="_blank" rel="noreferrer">
                  {' '}
                  ↗
                </a>
              )}
            </span>
            <input value={a.spotifyId ?? ''} onChange={(e) => set('spotifyId', strOrNull(e.target.value.trim()))} pattern="[0-9A-Za-z]{22}" />
          </label>
          <label className="a-field a-field--wide">
            <span>{FIELD_LABELS.imageUrl}</span>
            <input value={a.imageUrl ?? ''} onChange={(e) => set('imageUrl', strOrNull(e.target.value))} />
          </label>
        </div>
        <h3>Tippek</h3>
        {([1, 2, 3] as const).map((slot) => {
          const typeKey = `hint${slot}Type` as const;
          const valueKey = `hint${slot}` as const;
          return (
            <div className="a-hint" key={slot}>
              <span className="a-hint__no">{slot}.</span>
              <select value={a[typeKey] ?? ''} onChange={(e) => set(typeKey, strOrNull(e.target.value))}>
                <option value="">– nincs –</option>
                {Object.entries(meta.hintTypes).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
              <input
                value={a[valueKey] ?? ''}
                placeholder={a[typeKey] === 'initials' ? 'automatikus a névből' : 'tipp szövege'}
                disabled={a[typeKey] === 'initials'}
                onChange={(e) => set(valueKey, strOrNull(e.target.value))}
              />
            </div>
          );
        })}
        {error && <p className="a-error">{error}</p>}
        <footer className="a-form__foot">
          <button type="button" className="a-btn a-btn--ghost" onClick={onClose}>
            Mégse
          </button>
          <button type="submit" className="a-btn a-btn--primary" disabled={saving}>
            {saving ? 'Mentés…' : 'Mentés'}
          </button>
        </footer>
      </form>
    </Dialog>
  );
}
