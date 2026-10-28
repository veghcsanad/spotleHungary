import { useCallback, useEffect, useMemo, useState } from 'react';
import type { RankedArtist } from '../../shared/types.ts';
import { AddArtistDialog } from './AddArtistDialog.tsx';
import {
  adminApi,
  ApiError,
  formatListeners,
  GENDER_LABELS,
  getToken,
  setToken,
  toInput,
  type ArtistInput,
  type Meta,
} from './adminApi.ts';
import { ArtistEditor } from './ArtistEditor.tsx';
import { applyRows, diffRows, ReviewCard, type ReviewItem } from './ReviewPanel.tsx';

type SortKey = 'rank' | 'name' | 'debutYear' | 'members' | 'gender' | 'genre' | 'city' | 'region' | 'monthlyListeners' | 'hints';
type Filter = 'all' | 'missing' | 'debut' | 'hints' | 'spotify';

const ATTRS = ['debutYear', 'members', 'gender', 'genre', 'city', 'region'] as const;
const hintCount = (a: RankedArtist) => [a.hint1Type, a.hint2Type, a.hint3Type].filter(Boolean).length;
const isMissing = (a: RankedArtist) => ATTRS.some((k) => a[k] == null);
const AI_CONCURRENCY = 2;
const SPOTIFY_CONCURRENCY = 4;

const FILTERS: Record<Filter, { label: string; test: (a: RankedArtist) => boolean }> = {
  all: { label: 'Mind', test: () => true },
  missing: { label: 'Hiányos adat', test: isMissing },
  debut: { label: 'Nincs debütálás', test: (a) => a.debutYear == null },
  hints: { label: '< 3 tipp', test: (a) => hintCount(a) < 3 },
  spotify: { label: 'Nincs Spotify ID', test: (a) => !a.spotifyId },
};

function Login({ onLogin, error }: { onLogin: (t: string) => void; error: string | null }) {
  const [value, setValue] = useState('');
  return (
    <div className="a-login">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onLogin(value.trim());
        }}
      >
        <h1>Spotle HU · Admin</h1>
        <p className="a-muted">Add meg az ADMIN_TOKEN-t a .env fájlból.</p>
        <input type="password" value={value} onChange={(e) => setValue(e.target.value)} placeholder="Admin token" autoFocus />
        {error && <p className="a-error">{error}</p>}
        <button className="a-btn a-btn--primary">Belépés</button>
      </form>
    </div>
  );
}

export default function AdminApp() {
  const [meta, setMeta] = useState<Meta | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);
  const [needsLogin, setNeedsLogin] = useState(!getToken());
  const [artists, setArtists] = useState<RankedArtist[]>([]);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'rank', dir: 1 });
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [editing, setEditing] = useState<{ id: number | null; initial: ArtistInput; reviewKey?: string } | null>(null);
  const [adding, setAdding] = useState(false);
  const [reviews, setReviews] = useState<ReviewItem[]>([]);
  const [toast, setToast] = useState<string | null>(null);

  const flash = (msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast((t) => (t === msg ? null : t)), 3500);
  };

  const load = useCallback(async () => {
    try {
      const [m, list] = await Promise.all([adminApi.meta(), adminApi.list()]);
      setMeta(m);
      setArtists(list);
      setNeedsLogin(false);
      setAuthError(null);
    } catch (err) {
      if (err instanceof ApiError && (err.status === 401 || err.status === 403)) {
        setNeedsLogin(true);
        setAuthError(err.status === 403 ? 'Az admin API ki van kapcsolva: állítsd be az ADMIN_TOKEN-t a .env-ben.' : 'Hibás token.');
      } else {
        setAuthError((err as Error).message);
      }
    }
  }, []);

  useEffect(() => {
    if (!needsLogin) void load();
  }, [needsLogin, load]);

  // Ranks change whenever listeners change, so refresh the list after every save.
  const refresh = async () => setArtists(await adminApi.list());

  // --- Review queue: run proposals with limited concurrency ---
  useEffect(() => {
    const running = (mode: ReviewItem['mode']) => reviews.filter((r) => r.status === 'running' && r.mode === mode).length;
    const start: ReviewItem[] = [];
    for (const mode of ['ai', 'spotify'] as const) {
      const free = (mode === 'ai' ? AI_CONCURRENCY : SPOTIFY_CONCURRENCY) - running(mode);
      start.push(...reviews.filter((r) => r.status === 'queued' && r.mode === mode).slice(0, Math.max(0, free)));
    }
    if (!start.length) return;
    const keys = new Set(start.map((s) => s.key));
    setReviews((rs) => rs.map((r) => (keys.has(r.key) ? { ...r, status: 'running' } : r)));
    for (const item of start) {
      adminApi.propose(item.request).then(
        (proposal) => setReviews((rs) => rs.map((r) => (r.key === item.key ? { ...r, status: 'done', proposal } : r))),
        (err: Error) => setReviews((rs) => rs.map((r) => (r.key === item.key ? { ...r, status: 'error', error: err.message } : r))),
      );
    }
  }, [reviews]);

  const enqueue = (items: Omit<ReviewItem, 'key' | 'status'>[]) =>
    setReviews((rs) => [
      ...rs,
      ...items.map((i) => ({ ...i, key: `${Date.now()}-${Math.random().toString(36).slice(2)}`, status: 'queued' as const })),
    ]);
  const dismiss = (key: string) => setReviews((rs) => rs.filter((r) => r.key !== key));

  const enqueueSelected = (ai: boolean) => {
    const items = artists
      .filter((a) => selected.has(a.id))
      .map((a) => ({ mode: ai ? ('ai' as const) : ('spotify' as const), label: a.name, request: { artistId: a.id, ai } }));
    enqueue(items);
    setSelected(new Set());
  };

  const byId = useMemo(() => new Map(artists.map((a) => [a.id, a])), [artists]);

  const save = async (id: number | null, input: ArtistInput) => {
    if (id == null) await adminApi.create(input);
    else await adminApi.update(id, input);
    await refresh();
  };

  const acceptReview = async (item: ReviewItem, input: ArtistInput) => {
    await save(item.proposal?.artistId ?? null, input);
    dismiss(item.key);
    flash(`Mentve: ${input.name}`);
  };

  const acceptAll = async () => {
    if (!meta) return;
    let n = 0;
    for (const item of reviews.filter((r) => r.status === 'done' && r.proposal)) {
      const p = item.proposal!;
      const current = p.artistId != null ? byId.get(p.artistId) : null;
      const currentInput = current ? toInput(current) : null;
      const keys = new Set(diffRows(meta, currentInput, p).filter((r) => r.defaultOn).map((r) => r.key));
      try {
        if (keys.size) await save(p.artistId, applyRows(currentInput, p, keys));
        dismiss(item.key);
        n++;
      } catch (err) {
        setReviews((rs) => rs.map((r) => (r.key === item.key ? { ...r, error: (err as Error).message } : r)));
      }
    }
    flash(`${n} javaslat elfogadva`);
  };

  const removeSelected = async () => {
    const names = artists.filter((a) => selected.has(a.id)).map((a) => a.name);
    if (!confirm(`Biztosan törlöd? (${names.length})\n\n${names.join(', ')}`)) return;
    for (const id of selected) await adminApi.remove(id);
    setSelected(new Set());
    await refresh();
    flash(`${names.length} előadó törölve`);
  };

  const visible = useMemo(() => {
    const q = query.trim().toLocaleLowerCase('hu');
    const rows = artists.filter(
      (a) =>
        FILTERS[filter].test(a) &&
        (!q || [a.name, a.city, a.genre, a.region].some((v) => v?.toLocaleLowerCase('hu').includes(q))),
    );
    const value = (a: RankedArtist): string | number | null => (sort.key === 'hints' ? hintCount(a) : (a[sort.key] as string | number | null));
    return rows.sort((x, y) => {
      const a = value(x);
      const b = value(y);
      if (a == null && b == null) return 0;
      if (a == null) return 1;
      if (b == null) return -1;
      return (typeof a === 'number' && typeof b === 'number' ? a - b : String(a).localeCompare(String(b), 'hu')) * sort.dir;
    });
  }, [artists, query, filter, sort]);

  if (needsLogin || !meta) {
    if (!needsLogin && !authError) return <div className="a-login a-muted">Betöltés…</div>;
    return (
      <Login
        error={authError}
        onLogin={(t) => {
          setToken(t);
          setNeedsLogin(false);
          void load();
        }}
      />
    );
  }

  const allVisibleSelected = visible.length > 0 && visible.every((a) => selected.has(a.id));
  const toggleAll = () => setSelected(allVisibleSelected ? new Set() : new Set(visible.map((a) => a.id)));
  const toggle = (id: number) =>
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const th = (key: SortKey, label: string) => (
    <th
      className={`is-sortable${sort.key === key ? ' is-sorted' : ''}`}
      onClick={() => setSort((s) => ({ key, dir: s.key === key ? ((-s.dir) as 1 | -1) : key === 'monthlyListeners' ? -1 : 1 }))}
    >
      {label}
      {sort.key === key ? (sort.dir === 1 ? ' ▲' : ' ▼') : ''}
    </th>
  );
  const cell = (v: string | number | null | undefined) => (v == null || v === '' ? <td className="is-missing">?</td> : <td>{v}</td>);
  const doneCount = reviews.filter((r) => r.status === 'done').length;
  const pending = reviews.filter((r) => r.status === 'queued' || r.status === 'running').length;

  return (
    <div className={`a-app${reviews.length ? ' has-reviews' : ''}`}>
      <header className="a-top">
        <h1>
          Spotle HU <span>admin</span>
        </h1>
        <div className="a-status">
          <span className={!meta.spotify ? 'is-bad' : meta.spotifyLimited ? 'is-warn' : 'is-ok'} title={meta.spotifyLimited ?? undefined}>
            Spotify {!meta.spotify ? '✗' : meta.spotifyLimited ? '⏳' : '✓'}
          </span>
          <span className={meta.ai.available ? 'is-ok' : 'is-bad'} title={meta.ai.message}>
            AI {meta.ai.available ? '✓' : '✗'}
          </span>
          {meta.persistsToFile && <span title="Minden változás a data/artists.json fájlba is kiíródik">→ data/artists.json</span>}
          <button
            className="a-link"
            onClick={() => {
              setToken('');
              setNeedsLogin(true);
              setMeta(null);
            }}
          >
            Kilépés
          </button>
        </div>
      </header>
      {!meta.ai.available && <p className="a-banner">{meta.ai.message}</p>}
      {meta.spotifyLimited && (
        <p className="a-banner">
          {meta.spotifyLimited} Addig a hallgatószám és a kép frissíthető, de a keresés és a diszkográfia (debütálási év) nem.
        </p>
      )}

      <div className="a-toolbar">
        <input className="a-search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Keresés név, város, műfaj…" />
        <div className="a-filters">
          {(Object.keys(FILTERS) as Filter[]).map((f) => (
            <button key={f} className={filter === f ? 'is-active' : ''} onClick={() => setFilter(f)}>
              {FILTERS[f].label} <small>{artists.filter(FILTERS[f].test).length}</small>
            </button>
          ))}
        </div>
        <div className="a-actions">
          <button className="a-btn a-btn--primary" onClick={() => setAdding(true)}>
            + Új előadó
          </button>
        </div>
      </div>

      <div className={`a-selbar${selected.size ? ' is-visible' : ''}`}>
        <span>{selected.size} kijelölve</span>
        <button className="a-btn a-btn--ai" disabled={!meta.ai.available} title={meta.ai.message} onClick={() => enqueueSelected(true)}>
          ✨ AI kitöltés
        </button>
        <button className="a-btn" disabled={!meta.spotify} onClick={() => enqueueSelected(false)} title="Hallgatók, kép, Spotify ID és (ha hiányzik) a legrégebbi kiadás éve">
          Spotify frissítés
        </button>
        <button className="a-btn a-btn--danger" onClick={removeSelected}>
          Törlés
        </button>
        <button className="a-link" onClick={() => setSelected(new Set())}>
          Kijelölés törlése
        </button>
      </div>

      <main className="a-main">
        <div className="a-tablewrap">
          <table className="a-table">
            <thead>
              <tr>
                <th>
                  <input type="checkbox" checked={allVisibleSelected} onChange={toggleAll} aria-label="Mind kijelölése" />
                </th>
                {th('rank', '#')}
                {th('name', 'Előadó')}
                {th('debutYear', 'Debüt')}
                {th('members', 'Tagok')}
                {th('gender', 'Nem')}
                {th('genre', 'Műfaj')}
                {th('city', 'Város')}
                {th('region', 'Régió')}
                {th('monthlyListeners', 'Hallgatók')}
                {th('hints', 'Tippek')}
                <th />
              </tr>
            </thead>
            <tbody>
              {visible.map((a) => (
                <tr key={a.id} className={selected.has(a.id) ? 'is-selected' : ''}>
                  <td>
                    <input type="checkbox" checked={selected.has(a.id)} onChange={() => toggle(a.id)} />
                  </td>
                  <td className="a-num">{a.rank}</td>
                  <td className="a-name" onClick={() => setEditing({ id: a.id, initial: toInput(a) })}>
                    {a.imageUrl ? <img src={a.imageUrl} alt="" loading="lazy" /> : <span className="a-noimg">?</span>}
                    <span>{a.name}</span>
                    {!a.spotifyId && <small className="a-tag">nincs Spotify</small>}
                  </td>
                  {cell(a.debutYear)}
                  {cell(a.members)}
                  {cell(a.gender && GENDER_LABELS[a.gender])}
                  {cell(a.genre)}
                  {cell(a.city)}
                  {cell(a.region)}
                  <td className="a-num">{formatListeners(a.monthlyListeners)}</td>
                  <td
                    className={hintCount(a) < 2 ? 'is-missing' : ''}
                    title={[1, 2, 3]
                      .map((s) => {
                        const t = a[`hint${s}Type` as 'hint1Type'];
                        return t ? `${meta.hintTypes[t] ?? t}: ${a[`hint${s}` as 'hint1'] ?? '(auto)'}` : null;
                      })
                      .filter(Boolean)
                      .join('\n')}
                  >
                    {hintCount(a)}/3
                  </td>
                  <td className="a-rowbtns">
                    <button className="a-icon" title="Szerkesztés" onClick={() => setEditing({ id: a.id, initial: toInput(a) })}>
                      ✎
                    </button>
                    <button
                      className="a-icon"
                      title="AI kitöltés"
                      disabled={!meta.ai.available}
                      onClick={() => enqueue([{ mode: 'ai', label: a.name, request: { artistId: a.id, ai: true } }])}
                    >
                      ✨
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!visible.length && <p className="a-muted a-empty">Nincs találat.</p>}
        </div>

        {reviews.length > 0 && (
          <aside className="a-reviews">
            <header>
              <h2>Javaslatok</h2>
              <span className="a-muted">{pending ? `${pending} folyamatban` : ''}</span>
              <button className="a-btn a-btn--primary" disabled={!doneCount} onClick={acceptAll} title="Az alapértelmezetten bejelölt mezők elfogadása minden kész javaslatnál">
                Mind elfogad ({doneCount})
              </button>
              <button className="a-link" onClick={() => setReviews((rs) => rs.filter((r) => r.status === 'running'))}>
                Ürítés
              </button>
            </header>
            {reviews.map((item) => (
              <ReviewCard
                key={item.key}
                meta={meta}
                item={item}
                current={item.proposal?.artistId != null ? byId.get(item.proposal.artistId) ?? null : item.request.artistId != null ? byId.get(item.request.artistId) ?? null : null}
                onAccept={acceptReview}
                onEdit={(it, input) => setEditing({ id: it.proposal?.artistId ?? null, initial: input, reviewKey: it.key })}
                onDismiss={(it) => dismiss(it.key)}
                onRetry={(it) => setReviews((rs) => rs.map((r) => (r.key === it.key ? { ...r, status: 'queued', error: undefined } : r)))}
              />
            ))}
          </aside>
        )}
      </main>

      {adding && (
        <AddArtistDialog
          meta={meta}
          artists={artists}
          onClose={() => setAdding(false)}
          onManual={() => {
            setAdding(false);
            setEditing({ id: null, initial: toInput({}) });
          }}
          onPick={({ label, ...request }) => {
            enqueue([{ mode: request.ai ? 'ai' : 'spotify', label, request }]);
            setAdding(false);
          }}
        />
      )}
      {editing && (
        <ArtistEditor
          meta={meta}
          title={editing.id == null ? 'Új előadó' : `Szerkesztés: ${editing.initial.name}`}
          initial={editing.initial}
          onClose={() => setEditing(null)}
          onSave={async (input) => {
            await save(editing.id, input);
            if (editing.reviewKey) dismiss(editing.reviewKey);
            setEditing(null);
            flash(`Mentve: ${input.name}`);
          }}
        />
      )}
      {toast && <div className="a-toast">{toast}</div>}
    </div>
  );
}
