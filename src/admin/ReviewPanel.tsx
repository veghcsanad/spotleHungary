import { useState } from 'react';
import type { RankedArtist } from '../../shared/types.ts';
import {
  FIELD_LABELS,
  formatListeners,
  GENDER_LABELS,
  toInput,
  type ArtistInput,
  type Field,
  type Meta,
  type Proposal,
} from './adminApi.ts';

export interface ReviewItem {
  key: string;
  mode: 'ai' | 'spotify';
  label: string;
  request: { artistId?: number; name?: string; spotifyId?: string; ai: boolean };
  status: 'queued' | 'running' | 'done' | 'error';
  proposal?: Proposal;
  error?: string;
}

type RowKey = Exclude<Field, `hint${1 | 2 | 3}Type` | `hint${1 | 2 | 3}`> | 'hint1' | 'hint2' | 'hint3';

interface DiffRow {
  key: RowKey;
  label: string;
  from: string;
  to: string;
  source?: 'spotify' | 'ai';
  defaultOn: boolean;
}

const PLAIN: RowKey[] = ['name', 'spotifyId', 'debutYear', 'members', 'gender', 'genre', 'city', 'region', 'monthlyListeners', 'imageUrl'];
const ALWAYS_REFRESH: RowKey[] = ['spotifyId', 'monthlyListeners', 'imageUrl'];

function show(meta: Meta, key: RowKey, a: Partial<ArtistInput>): string {
  if (key === 'hint1' || key === 'hint2' || key === 'hint3') {
    const type = a[`${key}Type` as Field] as string | null | undefined;
    const value = a[key] as string | null | undefined;
    if (!type) return '–';
    return `${meta.hintTypes[type] ?? type}${value ? `: ${value}` : ''}`;
  }
  const v = a[key];
  if (v == null || v === '') return '–';
  if (key === 'gender') return GENDER_LABELS[v as string] ?? String(v);
  if (key === 'monthlyListeners') return formatListeners(v as number);
  return String(v);
}

export function diffRows(meta: Meta, current: ArtistInput | null, p: Proposal): DiffRow[] {
  const base = current ?? toInput({});
  const isNew = current == null;
  const rows: DiffRow[] = [];
  for (const key of PLAIN) {
    if (!(key in p.values)) continue;
    const to = p.values[key as Field];
    if (to === base[key as Field]) continue;
    rows.push({
      key,
      label: FIELD_LABELS[key as Field],
      from: show(meta, key, base),
      to: show(meta, key, p.values),
      source: p.sources[key as Field],
      defaultOn: isNew || ALWAYS_REFRESH.includes(key) || (key !== 'name' && base[key as Field] == null),
    });
  }
  for (const slot of [1, 2, 3] as const) {
    const key = `hint${slot}` as const;
    if (!(`${key}Type` in p.values)) continue;
    if (p.values[`${key}Type`] === base[`${key}Type`] && p.values[key] === base[key]) continue;
    rows.push({
      key,
      label: `${slot}. tipp`,
      from: show(meta, key, base),
      to: show(meta, key, p.values),
      source: p.sources[key],
      defaultOn: isNew || base[`${key}Type`] == null,
    });
  }
  return rows;
}

export function applyRows(current: ArtistInput | null, p: Proposal, keys: Set<RowKey>): ArtistInput {
  const out = { ...(current ?? toInput({ name: p.name })) } as Record<Field, unknown>;
  for (const key of keys) {
    if (key === 'hint1' || key === 'hint2' || key === 'hint3') {
      out[`${key}Type`] = p.values[`${key}Type`] ?? null;
      out[key] = p.values[key] ?? null;
    } else {
      out[key] = p.values[key];
    }
  }
  return out as unknown as ArtistInput;
}

interface CardProps {
  meta: Meta;
  item: ReviewItem;
  current: RankedArtist | null;
  onAccept: (item: ReviewItem, input: ArtistInput) => Promise<void>;
  onEdit: (item: ReviewItem, input: ArtistInput) => void;
  onDismiss: (item: ReviewItem) => void;
  onRetry: (item: ReviewItem) => void;
}

export function ReviewCard({ meta, item, current, onAccept, onEdit, onDismiss, onRetry }: CardProps) {
  const p = item.proposal;
  const currentInput = current ? toInput(current) : null;
  const rows = p ? diffRows(meta, currentInput, p) : [];
  const [checked, setChecked] = useState<Set<RowKey> | null>(null);
  const on = checked ?? new Set(rows.filter((r) => r.defaultOn).map((r) => r.key));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggle = (k: RowKey) => {
    const next = new Set(on);
    if (next.has(k)) next.delete(k);
    else next.add(k);
    setChecked(next);
  };

  const accept = async () => {
    if (!p) return;
    setBusy(true);
    setError(null);
    try {
      await onAccept(item, applyRows(currentInput, p, on));
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  return (
    <article className={`a-card a-card--${item.status}`}>
      <header className="a-card__head">
        {p?.spotify?.imageUrl ? <img src={p.spotify.imageUrl} alt="" /> : <div className="a-noimg">?</div>}
        <div className="a-card__title">
          <strong>{p?.name ?? item.label}</strong>
          <small>
            {item.mode === 'ai' ? 'AI + Spotify' : 'Spotify'} · {current ? 'meglévő' : 'új előadó'}
            {p?.spotify && (
              <>
                {' · '}
                <a href={p.spotify.url} target="_blank" rel="noreferrer">
                  {p.spotify.name} ({formatListeners(p.spotify.monthlyListeners)})
                </a>
                {p.spotify.oldestReleaseYear && <> · legrégebbi kiadás: {p.spotify.oldestReleaseYear}</>}
              </>
            )}
          </small>
        </div>
        {p?.ai && <span className={`a-badge a-badge--${p.ai.confidence}`}>{p.ai.confidence}</span>}
      </header>

      {(item.status === 'queued' || item.status === 'running') && (
        <p className="a-muted">{item.status === 'queued' ? 'Várakozik…' : item.mode === 'ai' ? 'AI dolgozik (fél-két perc)…' : 'Spotify lekérdezés…'}</p>
      )}
      {item.status === 'error' && (
        <p className="a-error">
          {item.error}{' '}
          <button className="a-link" onClick={() => onRetry(item)}>
            Újra
          </button>
        </p>
      )}

      {p && (
        <>
          {p.aiError && <p className="a-error">AI hiba: {p.aiError}</p>}
          {p.warnings.map((w) => (
            <p key={w} className="a-warn">
              {w}
            </p>
          ))}
          {p.ai?.notes && <p className="a-notes">{p.ai.notes}</p>}
          {rows.length ? (
            <table className="a-diff">
              <tbody>
                {rows.map((r) => (
                  <tr key={r.key} className={on.has(r.key) ? 'is-on' : ''} onClick={() => toggle(r.key)}>
                    <td>
                      <input type="checkbox" checked={on.has(r.key)} onChange={() => toggle(r.key)} onClick={(e) => e.stopPropagation()} />
                    </td>
                    <th>{r.label}</th>
                    <td className="a-diff__from">{r.from}</td>
                    <td className="a-diff__arrow">→</td>
                    <td className="a-diff__to">
                      {r.to}
                      {r.source && <span className={`a-src a-src--${r.source}`}>{r.source === 'ai' ? 'AI' : 'Spotify'}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="a-muted">Nincs változás.</p>
          )}
          {p.ai?.sources?.length ? (
            <p className="a-sources">
              Források:{' '}
              {p.ai.sources.map((s, i) => (
                <a key={i} href={s} target="_blank" rel="noreferrer">
                  [{i + 1}]
                </a>
              ))}
            </p>
          ) : null}
          {error && <p className="a-error">{error}</p>}
          <footer className="a-card__foot">
            <button className="a-btn a-btn--ghost" onClick={() => onDismiss(item)}>
              Elvet
            </button>
            <button className="a-btn" onClick={() => onEdit(item, applyRows(currentInput, p, on))}>
              Szerkesztés…
            </button>
            <button className="a-btn a-btn--primary" disabled={busy || (!on.size && current != null)} onClick={accept}>
              {current ? `Elfogad (${on.size})` : 'Hozzáad'}
            </button>
          </footer>
        </>
      )}
      {!p && item.status !== 'running' && item.status !== 'queued' && (
        <footer className="a-card__foot">
          <button className="a-btn a-btn--ghost" onClick={() => onDismiss(item)}>
            Elvet
          </button>
        </footer>
      )}
    </article>
  );
}
