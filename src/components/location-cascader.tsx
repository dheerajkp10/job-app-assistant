'use client';

import { useMemo } from 'react';
import { Check, ChevronRight } from 'lucide-react';
import {
  COUNTRIES, STATES_BY_COUNTRY, CITIES_BY_STATE, STATE_BY_CODE,
  COUNTRY_OF_STATE, cityDisplay,
} from '@/lib/geo-data';

/**
 * Country → State → City cascading multi-select.
 *
 * Each level is an INDEPENDENT multi-select; the cascade is for
 * discovery. A listing matches if it overlaps ANY selected level:
 *   - Pick "United States" alone → open to anywhere in the US.
 *   - Pick "California" → every CA listing (SF, LA, San Jose, …).
 *   - Pick "Seattle, WA" → just that city.
 *
 * State rows only appear for selected countries; city rows only for
 * selected states. Cities are stored as canonical "City, ABBR"
 * strings so the existing location matcher parses them unchanged.
 *
 * Controlled: parent owns the three arrays + onChange.
 */
export function LocationCascader({
  countries,
  states,
  cities,
  onChange,
}: {
  countries: string[];
  states: string[];
  cities: string[];
  onChange: (next: { countries: string[]; states: string[]; cities: string[] }) => void;
}) {
  const countrySet = useMemo(() => new Set(countries), [countries]);
  const stateSet = useMemo(() => new Set(states), [states]);
  const citySet = useMemo(() => new Set(cities), [cities]);

  // States available to pick = union of every selected country's states.
  const availableStates = useMemo(() => {
    const out: { code: string; name: string; country: string }[] = [];
    for (const c of countries) {
      for (const s of STATES_BY_COUNTRY[c] ?? []) {
        out.push({ code: s.code, name: s.name, country: c });
      }
    }
    return out;
  }, [countries]);

  // Cities available = union of every selected state's cities.
  const availableCities = useMemo(() => {
    const out: { display: string; city: string; state: string }[] = [];
    for (const st of states) {
      for (const city of CITIES_BY_STATE[st] ?? []) {
        out.push({ display: cityDisplay(city, st), city, state: st });
      }
    }
    return out;
  }, [states]);

  function toggleCountry(code: string) {
    const next = new Set(countrySet);
    if (next.has(code)) {
      next.delete(code);
      // Cascade cleanup: drop states (and their cities) that belonged
      // only to this now-deselected country.
      const keptStates = states.filter((s) => COUNTRY_OF_STATE[s] !== code);
      const keptStateSet = new Set(keptStates);
      const keptCities = cities.filter((cd) => {
        const st = cityStateOf(cd);
        return st ? keptStateSet.has(st) : true;
      });
      onChange({ countries: [...next], states: keptStates, cities: keptCities });
      return;
    }
    next.add(code);
    onChange({ countries: [...next], states, cities });
  }

  function toggleState(code: string) {
    const next = new Set(stateSet);
    if (next.has(code)) {
      next.delete(code);
      // Drop cities under this state.
      const keptCities = cities.filter((cd) => cityStateOf(cd) !== code);
      onChange({ countries, states: [...next], cities: keptCities });
      return;
    }
    next.add(code);
    onChange({ countries, states: [...next], cities });
  }

  function toggleCity(display: string) {
    const next = new Set(citySet);
    if (next.has(display)) next.delete(display);
    else next.add(display);
    onChange({ countries, states, cities: [...next] });
  }

  return (
    <div className="space-y-4">
      {/* ─── Countries ─── */}
      <Section
        label="Country"
        hint="Pick one or more. Selecting a country alone means you're open to anywhere in it."
        count={countries.length}
      >
        <div className="flex flex-wrap gap-1.5">
          {COUNTRIES.map((c) => (
            <Pill
              key={c.code}
              label={c.name}
              on={countrySet.has(c.code)}
              onClick={() => toggleCountry(c.code)}
            />
          ))}
        </div>
      </Section>

      {/* ─── States ─── */}
      {availableStates.length > 0 && (
        <Section
          label="State / Region"
          hint="Selecting a state matches every city in it."
          count={states.length}
        >
          <div className="flex flex-wrap gap-1.5">
            {availableStates.map((s) => (
              <Pill
                key={s.code}
                label={s.name}
                on={stateSet.has(s.code)}
                onClick={() => toggleState(s.code)}
              />
            ))}
          </div>
        </Section>
      )}

      {/* ─── Cities ─── */}
      {availableCities.length > 0 && (
        <Section
          label="City"
          hint="Optional — narrow to specific cities. Leave empty to keep the whole state."
          count={cities.length}
        >
          <div className="flex flex-wrap gap-1.5">
            {availableCities.map((c) => (
              <Pill
                key={c.display}
                label={c.display}
                on={citySet.has(c.display)}
                onClick={() => toggleCity(c.display)}
              />
            ))}
          </div>
        </Section>
      )}
    </div>
  );
}

// ─── Helpers ───────────────────────────────────────────────────────

/** Recover the state code from a stored "City, ABBR" display string
 *  by matching the trailing abbreviation against the geo table. */
function cityStateOf(display: string): string | null {
  const m = display.match(/,\s*([^,]+)$/);
  if (!m) return null;
  const abbr = m[1].trim();
  for (const code of Object.keys(STATE_BY_CODE)) {
    if (STATE_BY_CODE[code].abbr === abbr) return code;
  }
  return null;
}

function Section({
  label, hint, count, children,
}: {
  label: string; hint: string; count: number; children: React.ReactNode;
}) {
  return (
    <div>
      <div className="flex items-center gap-1.5 mb-1.5">
        <ChevronRight className="w-3.5 h-3.5 text-slate-400" aria-hidden="true" />
        <span className="text-xs font-semibold text-slate-700">{label}</span>
        {count > 0 && (
          <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-indigo-100 text-indigo-700">
            {count}
          </span>
        )}
      </div>
      <p className="text-[11px] text-slate-500 mb-2 ml-5">{hint}</p>
      <div className="ml-5">{children}</div>
    </div>
  );
}

function Pill({
  label, on, onClick,
}: {
  label: string; on: boolean; onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300 ${
        on
          ? 'bg-indigo-100 text-indigo-700 border-indigo-200 hover:bg-indigo-200'
          : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50 hover:border-slate-300'
      }`}
    >
      {on && <Check className="w-3 h-3" aria-hidden="true" />}
      {label}
    </button>
  );
}
