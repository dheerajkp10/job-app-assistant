'use client';

import { useEffect, useMemo, useRef, useState, useId } from 'react';
import { Check, ChevronDown, X, Search } from 'lucide-react';

export interface ComboOption {
  value: string;
  label: string;
  /** Optional secondary text shown muted on the right (e.g. a state's
   *  parent country, or a city's state). */
  hint?: string;
}

/**
 * Searchable multi-select combobox.
 *
 * Replaces flat chip-grids for large option sets (50 states, hundreds
 * of cities). Type to filter; click or Enter to toggle; selected
 * options render as removable chips above the input. Fully keyboard
 * navigable + screen-reader labelled.
 *
 * Controlled: parent owns `selected` (array of option values) and
 * receives the full next array via `onChange`.
 */
export function MultiSelectCombobox({
  label,
  hint,
  placeholder,
  options,
  selected,
  onChange,
  disabled = false,
  emptyText = 'No matches',
}: {
  label: string;
  hint?: string;
  placeholder?: string;
  options: ComboOption[];
  selected: string[];
  onChange: (next: string[]) => void;
  disabled?: boolean;
  emptyText?: string;
}) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [activeIdx, setActiveIdx] = useState(0);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listboxId = useId();

  const selectedSet = useMemo(() => new Set(selected), [selected]);
  const byValue = useMemo(() => {
    const m = new Map<string, ComboOption>();
    for (const o of options) m.set(o.value, o);
    return m;
  }, [options]);

  // Filter options by query (case-insensitive substring on label).
  // Already-selected options stay in the list but render checked, so
  // the user can toggle them off from the dropdown too.
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter(
      (o) =>
        o.label.toLowerCase().includes(q) ||
        (o.hint?.toLowerCase().includes(q) ?? false),
    );
  }, [options, query]);

  // Clamp active index whenever the filtered list shrinks.
  useEffect(() => {
    setActiveIdx((i) => Math.min(i, Math.max(0, filtered.length - 1)));
  }, [filtered.length]);

  // Click-outside closes the dropdown.
  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  function toggle(value: string) {
    const next = new Set(selectedSet);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    onChange([...next]);
  }

  function remove(value: string) {
    onChange(selected.filter((v) => v !== value));
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setOpen(true);
      setActiveIdx((i) => Math.min(i + 1, Math.max(0, filtered.length - 1)));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIdx((i) => Math.max(0, i - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (open && filtered[activeIdx]) toggle(filtered[activeIdx].value);
    } else if (e.key === 'Escape') {
      setOpen(false);
    } else if (e.key === 'Backspace' && query === '' && selected.length > 0) {
      // Backspace on empty input removes the last selected chip —
      // standard token-input affordance.
      remove(selected[selected.length - 1]);
    }
  }

  return (
    <div ref={wrapperRef}>
      <div className="flex items-center gap-1.5 mb-1.5">
        <span className="text-xs font-semibold text-slate-700">{label}</span>
        {selected.length > 0 && (
          <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-indigo-100 text-indigo-700">
            {selected.length}
          </span>
        )}
      </div>
      {hint && <p className="text-[11px] text-slate-500 mb-2">{hint}</p>}

      {/* Selected chips */}
      {selected.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-2">
          {selected.map((v) => {
            const opt = byValue.get(v);
            return (
              <span
                key={v}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium bg-indigo-100 text-indigo-700 border border-indigo-200"
              >
                {opt?.label ?? v}
                <button
                  type="button"
                  onClick={() => remove(v)}
                  aria-label={`Remove ${opt?.label ?? v}`}
                  className="hover:text-indigo-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300 rounded"
                >
                  <X className="w-3 h-3" aria-hidden="true" />
                </button>
              </span>
            );
          })}
        </div>
      )}

      {/* Search input */}
      <div className="relative">
        <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" aria-hidden="true" />
        <input
          ref={inputRef}
          type="text"
          role="combobox"
          aria-expanded={open}
          aria-controls={listboxId}
          aria-label={label}
          autoComplete="off"
          disabled={disabled}
          value={query}
          onChange={(e) => { setQuery(e.target.value); setOpen(true); setActiveIdx(0); }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          placeholder={placeholder}
          className="w-full pl-9 pr-9 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-indigo-200 focus:border-indigo-300 outline-none disabled:bg-slate-50 disabled:text-slate-400"
        />
        <button
          type="button"
          tabIndex={-1}
          aria-hidden="true"
          onClick={() => { if (!disabled) { setOpen((o) => !o); inputRef.current?.focus(); } }}
          className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-600"
        >
          <ChevronDown className={`w-4 h-4 transition-transform ${open ? 'rotate-180' : ''}`} />
        </button>

        {open && !disabled && (
          <ul
            id={listboxId}
            role="listbox"
            aria-multiselectable="true"
            className="absolute z-30 left-0 right-0 mt-1 bg-white border border-slate-200 rounded-lg shadow-lg max-h-64 overflow-y-auto"
          >
            {filtered.length === 0 && (
              <li className="px-3 py-2 text-sm text-slate-400">{emptyText}</li>
            )}
            {filtered.map((o, i) => {
              const on = selectedSet.has(o.value);
              return (
                <li
                  key={o.value}
                  role="option"
                  aria-selected={on}
                  onMouseEnter={() => setActiveIdx(i)}
                  onMouseDown={(e) => { e.preventDefault(); toggle(o.value); }}
                  className={`px-3 py-2 text-sm cursor-pointer flex items-center gap-2 ${
                    i === activeIdx ? 'bg-indigo-50' : ''
                  } ${on ? 'text-indigo-700 font-medium' : 'text-slate-700'}`}
                >
                  <span className={`w-4 h-4 shrink-0 rounded border flex items-center justify-center ${
                    on ? 'bg-indigo-500 border-indigo-500' : 'border-slate-300'
                  }`}>
                    {on && <Check className="w-3 h-3 text-white" aria-hidden="true" />}
                  </span>
                  <span className="flex-1">{o.label}</span>
                  {o.hint && <span className="text-xs text-slate-400">{o.hint}</span>}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
