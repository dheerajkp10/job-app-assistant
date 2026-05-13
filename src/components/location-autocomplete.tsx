'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { MapPin, Plus } from 'lucide-react';
import { searchTechHubs } from '@/lib/tech-hubs';

interface Props {
  placeholder?: string;
  onSelect: (location: string) => void;
  // Locations already chosen — used to grey-out duplicates in suggestions.
  existing?: string[];
}

/**
 * Typeahead combobox that suggests global tech hubs as the user types.
 * Typing "San" shows "San Francisco, CA" etc. Users can pick a suggestion
 * or press Enter on an unmatched string to add a free-form location.
 */
export function LocationAutocomplete({ placeholder, onSelect, existing = [] }: Props) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [activeIdx, setActiveIdx] = useState(0);
  const wrapperRef = useRef<HTMLDivElement>(null);

  const existingLower = useMemo(
    () => new Set(existing.map((e) => e.toLowerCase())),
    [existing]
  );

  const suggestions = useMemo(() => searchTechHubs(query, 8), [query]);

  // Click-outside to close
  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  function commit(value: string) {
    const trimmed = value.trim();
    if (!trimmed) return;
    onSelect(trimmed);
    setQuery('');
    setOpen(false);
    setActiveIdx(0);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setOpen(true);
      setActiveIdx((i) => Math.min(i + 1, Math.max(0, suggestions.length - 1)));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIdx((i) => Math.max(0, i - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (open && suggestions[activeIdx]) {
        commit(suggestions[activeIdx]);
      } else if (query.trim()) {
        commit(query);
      }
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  }

  return (
    <div className="relative" ref={wrapperRef}>
      <div className="flex gap-2">
        <div className="relative flex-1">
          <MapPin className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="text"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setOpen(true);
              setActiveIdx(0);
            }}
            onFocus={() => query && setOpen(true)}
            onKeyDown={onKeyDown}
            placeholder={placeholder || 'Start typing a city (e.g., "San" → San Francisco, CA)'}
            className="w-full pl-9 pr-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-indigo-200 focus:border-indigo-300 outline-none"
            autoComplete="off"
          />
        </div>
        <button
          type="button"
          onClick={() => query.trim() && commit(query)}
          disabled={!query.trim()}
          className="px-3 py-2 text-sm bg-slate-100 hover:bg-gray-200 disabled:opacity-40 rounded-lg font-medium text-slate-700 inline-flex items-center gap-1"
          title="Add this location"
        >
          <Plus className="w-4 h-4" />
          Add
        </button>
      </div>

      {open && suggestions.length > 0 && (
        <ul
          role="listbox"
          className="absolute z-20 left-0 right-0 mt-1 bg-white border border-slate-200 rounded-lg shadow-lg max-h-64 overflow-y-auto"
        >
          {suggestions.map((hub, i) => {
            const already = existingLower.has(hub.toLowerCase());
            return (
              <li
                key={hub}
                role="option"
                aria-selected={i === activeIdx}
                onMouseEnter={() => setActiveIdx(i)}
                onMouseDown={(e) => {
                  // mousedown so the click fires before the input's blur
                  e.preventDefault();
                  if (!already) commit(hub);
                }}
                className={`px-3 py-2 text-sm cursor-pointer flex items-center gap-2 ${
                  already
                    ? 'text-slate-300 cursor-not-allowed'
                    : i === activeIdx
                      ? 'bg-indigo-50 text-indigo-700'
                      : 'text-slate-700 hover:bg-slate-50'
                }`}
              >
                <MapPin className="w-3.5 h-3.5 shrink-0" />
                <span className="flex-1">{hub}</span>
                {already && <span className="text-xs">added</span>}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
