import { useCallback, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { Search } from 'lucide-react';
import type { ArtistOption } from '../../shared/types.ts';
import { searchKey } from '../../shared/game.ts';

interface Props {
  artists: ArtistOption[];
  excludeIds: Set<number>;
  disabled: boolean;
  placeholder: string;
  onSelect: (artist: ArtistOption) => void;
}

const MAX_RESULTS = 8;

export function SearchBox({ artists, excludeIds, disabled, placeholder, onSelect }: Props) {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const indexed = useMemo(() => artists.map((a) => ({ ...a, key: searchKey(a.name) })), [artists]);

  const search = useCallback(
    (text: string) => {
      const q = searchKey(text);
      if (!q) return [];
      return indexed
        .filter((a) => !excludeIds.has(a.id) && a.key.includes(q))
        .sort((a, b) => Number(!a.key.startsWith(q)) - Number(!b.key.startsWith(q)))
        .slice(0, MAX_RESULTS);
    },
    [indexed, excludeIds],
  );
  const results = useMemo(() => search(query), [search, query]);

  const choose = (a: ArtistOption) => {
    onSelect(a);
    setQuery('');
    setActive(0);
    setOpen(false);
    inputRef.current?.focus();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      // Use the live input value so a fast Enter right after typing still picks the right artist.
      const live = search(e.currentTarget.value);
      const pick = live[active] ?? live[0];
      if (pick) choose(pick);
      return;
    }
    if (!results.length) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((i) => (i + 1) % results.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => (i - 1 + results.length) % results.length);
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  };

  return (
    <div className="search">
      <Search className="search__icon" size={18} aria-hidden="true" />
      <input
        ref={inputRef}
        className="search__input"
        type="text"
        value={query}
        disabled={disabled}
        placeholder={placeholder}
        autoComplete="off"
        spellCheck={false}
        aria-label="Előadó keresése"
        aria-expanded={open && results.length > 0}
        aria-controls="search-results"
        role="combobox"
        onChange={(e) => {
          setQuery(e.target.value);
          setActive(0);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={onKeyDown}
      />
      {open && query && (
        <ul className="search__results" id="search-results" role="listbox">
          {results.length === 0 && <li className="search__empty">Nincs találat</li>}
          {results.map((a, i) => (
            <li
              key={a.id}
              role="option"
              aria-selected={i === active}
              className={`search__item ${i === active ? 'search__item--active' : ''}`}
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => setActive(i)}
              onClick={() => choose(a)}
            >
              {a.name}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
