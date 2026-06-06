'use client';

import { useMemo } from 'react';
import {
  COUNTRIES, STATES_BY_COUNTRY, CITIES_BY_STATE, STATE_BY_CODE,
  COUNTRY_OF_STATE, cityDisplay,
} from '@/lib/geo-data';
import { MultiSelectCombobox, type ComboOption } from './multi-select-combobox';

/**
 * Country → State → City cascading multi-select, rendered as three
 * searchable comboboxes (search box + dropdown + multi-select chips)
 * rather than flat pill grids — far more usable for 50 states and
 * hundreds of cities.
 *
 * Each level is an INDEPENDENT filter; the cascade scopes which
 * options are offered:
 *   - Pick "United States" → the State box offers US states.
 *   - Pick "California" → every CA listing (SF, LA, San Jose, …);
 *     the City box offers CA cities for optional narrowing.
 *   - Pick "Seattle, WA" → just that city.
 *
 * Cities are stored as canonical "City, ABBR" strings so the location
 * matcher parses them unchanged.
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
  // ─── Options per level ───────────────────────────────────────────
  const countryOptions: ComboOption[] = useMemo(
    () => COUNTRIES.map((c) => ({ value: c.code, label: c.name })),
    [],
  );

  // States offered = union of every selected country's states, each
  // tagged with its country for clarity when multiple are selected.
  const stateOptions: ComboOption[] = useMemo(() => {
    const out: ComboOption[] = [];
    for (const c of countries) {
      const countryName = COUNTRIES.find((x) => x.code === c)?.name;
      for (const s of STATES_BY_COUNTRY[c] ?? []) {
        out.push({
          value: s.code,
          label: s.name,
          hint: countries.length > 1 ? countryName : undefined,
        });
      }
    }
    return out;
  }, [countries]);

  // Cities offered = union of every selected state's cities, tagged
  // with their state code when multiple states are selected.
  const cityOptions: ComboOption[] = useMemo(() => {
    const out: ComboOption[] = [];
    for (const st of states) {
      const abbr = STATE_BY_CODE[st]?.abbr;
      for (const city of CITIES_BY_STATE[st] ?? []) {
        out.push({
          value: cityDisplay(city, st),
          label: cityDisplay(city, st),
          hint: states.length > 1 ? abbr : undefined,
        });
      }
    }
    return out;
  }, [states]);

  // ─── Cascade cleanup on deselect ─────────────────────────────────
  function setCountries(nextCountries: string[]) {
    const keptCountrySet = new Set(nextCountries);
    // Drop states whose country is no longer selected, then drop
    // cities whose state was dropped.
    const keptStates = states.filter((s) => keptCountrySet.has(COUNTRY_OF_STATE[s]));
    const keptStateSet = new Set(keptStates);
    const keptCities = cities.filter((cd) => {
      const st = cityStateOf(cd);
      return st ? keptStateSet.has(st) : true;
    });
    onChange({ countries: nextCountries, states: keptStates, cities: keptCities });
  }

  function setStates(nextStates: string[]) {
    const keptStateSet = new Set(nextStates);
    const keptCities = cities.filter((cd) => {
      const st = cityStateOf(cd);
      return st ? keptStateSet.has(st) : true;
    });
    onChange({ countries, states: nextStates, cities: keptCities });
  }

  function setCities(nextCities: string[]) {
    onChange({ countries, states, cities: nextCities });
  }

  return (
    <div className="space-y-4">
      <MultiSelectCombobox
        label="Country"
        hint="Pick one or more. A country alone means you're open to anywhere in it."
        placeholder="Search countries…"
        options={countryOptions}
        selected={countries}
        onChange={setCountries}
      />

      <MultiSelectCombobox
        label="State / Region"
        hint={
          countries.length === 0
            ? 'Select a country first to choose states.'
            : 'Selecting a state matches every city in it.'
        }
        placeholder="Search states…"
        options={stateOptions}
        selected={states}
        onChange={setStates}
        disabled={countries.length === 0}
        emptyText={countries.length === 0 ? 'Select a country first' : 'No matching states'}
      />

      <MultiSelectCombobox
        label="City"
        hint={
          states.length === 0
            ? 'Select a state first to choose specific cities.'
            : 'Optional — narrow to specific cities, or leave empty to keep the whole state.'
        }
        placeholder="Search cities…"
        options={cityOptions}
        selected={cities.filter((cd) => {
          // Only surface cities that belong to a currently-selected
          // state in THIS control. Off-list / other-state cities live
          // in the separate autocomplete and stay in preferredLocations.
          const st = cityStateOf(cd);
          return st !== null && states.includes(st);
        })}
        onChange={(picked) => {
          // Merge: keep cities outside the current state scope, replace
          // the in-scope selection with `picked`.
          const inScope = new Set(
            cities.filter((cd) => {
              const st = cityStateOf(cd);
              return st !== null && states.includes(st);
            }),
          );
          const outOfScope = cities.filter((cd) => !inScope.has(cd));
          setCities([...outOfScope, ...picked]);
        }}
        disabled={states.length === 0}
        emptyText={states.length === 0 ? 'Select a state first' : 'No matching cities'}
      />
    </div>
  );
}

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
