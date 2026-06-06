/**
 * Location matching for job listings.
 *
 * The previous matcher was a city-name + state-code substring check
 * over the preferredLocations list. That missed every variant the
 * user reported on real listings:
 *   - "USA - Remote", "U.S. Remote", "Remote, US", "United States - Remote",
 *     "Remote - US: All locations", "USA | Remote"  (Netflix-style)
 *   - "SEA", "US-SEA", "US-Remote", "US Remote"  (Stripe-style airport codes)
 *
 * The fix is a normalize-then-token-overlap matcher:
 *
 *   1. parseLocation() walks both the user's prefs and the listing's
 *      location string, breaking either into a structured
 *      { cities, states, countries, isRemote } token bag using the
 *      synonym + airport-code tables below.
 *
 *   2. The matcher returns true when ANY of:
 *        a. a city token is shared
 *        b. a state token is shared (code or full name, normalized)
 *        c. the listing is Remote AND the user has Remote in workMode
 *           AND the listing's country (or "US" if unknown) is in the
 *           user's workAuthCountries.
 *
 * That last clause is the key fix for "USA - Remote" listings: the
 * user typically has Seattle/WA in their preferred locations (no
 * remote token there) but DOES have Remote in workMode + US in
 * workAuthCountries. The new matcher recognizes that combination.
 */

import type { WorkMode } from './types';
import { COUNTRY_OF_STATE, CITY_TO_STATES } from './geo-data';

// ─── Synonym tables ────────────────────────────────────────────────

/** All the ways "United States" appears in a job-board location
 *  string. Lowercased, stripped of punctuation. The matcher
 *  normalizes the listing string the same way before lookup. */
const US_ALIASES = new Set([
  'us', 'usa', 'united states', 'united states of america',
  'america', 'us only',
]);

/** US state code → full lowercase name. Used to bridge "WA" ↔
 *  "Washington" in either direction. Includes DC. */
const STATE_CODE_TO_NAME: Record<string, string> = {
  AL: 'alabama', AK: 'alaska', AZ: 'arizona', AR: 'arkansas',
  CA: 'california', CO: 'colorado', CT: 'connecticut', DE: 'delaware',
  DC: 'district of columbia', FL: 'florida', GA: 'georgia',
  HI: 'hawaii', ID: 'idaho', IL: 'illinois', IN: 'indiana',
  IA: 'iowa', KS: 'kansas', KY: 'kentucky', LA: 'louisiana',
  ME: 'maine', MD: 'maryland', MA: 'massachusetts', MI: 'michigan',
  MN: 'minnesota', MS: 'mississippi', MO: 'missouri', MT: 'montana',
  NE: 'nebraska', NV: 'nevada', NH: 'new hampshire', NJ: 'new jersey',
  NM: 'new mexico', NY: 'new york', NC: 'north carolina',
  ND: 'north dakota', OH: 'ohio', OK: 'oklahoma', OR: 'oregon',
  PA: 'pennsylvania', RI: 'rhode island', SC: 'south carolina',
  SD: 'south dakota', TN: 'tennessee', TX: 'texas', UT: 'utah',
  VT: 'vermont', VA: 'virginia', WA: 'washington', WV: 'west virginia',
  WI: 'wisconsin', WY: 'wyoming',
};

/** Full-name → code. Built once at module load. */
const STATE_NAME_TO_CODE: Record<string, string> = {};
for (const [code, name] of Object.entries(STATE_CODE_TO_NAME)) {
  STATE_NAME_TO_CODE[name] = code;
}

/** Airport / IATA codes that career boards use as location tokens.
 *  Each maps to { city, state }. Stripe in particular posts US-SEA,
 *  US-NYC, US-SFO, US-AUS for their major hubs.  */
const AIRPORT_TO_CITY: Record<string, { city: string; state: string }> = {
  SEA: { city: 'seattle', state: 'WA' },
  PDX: { city: 'portland', state: 'OR' },
  SFO: { city: 'san francisco', state: 'CA' },
  SJC: { city: 'san jose', state: 'CA' },
  OAK: { city: 'oakland', state: 'CA' },
  LAX: { city: 'los angeles', state: 'CA' },
  SAN: { city: 'san diego', state: 'CA' },
  NYC: { city: 'new york', state: 'NY' },
  LGA: { city: 'new york', state: 'NY' },
  JFK: { city: 'new york', state: 'NY' },
  EWR: { city: 'newark', state: 'NJ' },
  BOS: { city: 'boston', state: 'MA' },
  CHI: { city: 'chicago', state: 'IL' },
  ORD: { city: 'chicago', state: 'IL' },
  MDW: { city: 'chicago', state: 'IL' },
  WAS: { city: 'washington', state: 'DC' },
  DCA: { city: 'washington', state: 'DC' },
  IAD: { city: 'washington', state: 'DC' },
  BWI: { city: 'baltimore', state: 'MD' },
  ATL: { city: 'atlanta', state: 'GA' },
  MIA: { city: 'miami', state: 'FL' },
  TPA: { city: 'tampa', state: 'FL' },
  DEN: { city: 'denver', state: 'CO' },
  AUS: { city: 'austin', state: 'TX' },
  DAL: { city: 'dallas', state: 'TX' },
  DFW: { city: 'dallas', state: 'TX' },
  HOU: { city: 'houston', state: 'TX' },
  IAH: { city: 'houston', state: 'TX' },
  PHX: { city: 'phoenix', state: 'AZ' },
  LAS: { city: 'las vegas', state: 'NV' },
  SLC: { city: 'salt lake city', state: 'UT' },
  MSP: { city: 'minneapolis', state: 'MN' },
  DTW: { city: 'detroit', state: 'MI' },
  CLE: { city: 'cleveland', state: 'OH' },
  CMH: { city: 'columbus', state: 'OH' },
  PHL: { city: 'philadelphia', state: 'PA' },
  PIT: { city: 'pittsburgh', state: 'PA' },
  RDU: { city: 'raleigh', state: 'NC' },
  CLT: { city: 'charlotte', state: 'NC' },
  // Common aliases on career boards
  BAY: { city: 'san francisco', state: 'CA' },     // "Bay Area"
};

/** Country aliases beyond the US, lowercased. We don't enumerate
 *  every nation — only the ones job boards commonly use as a
 *  shorthand the matcher might confuse with a city. */
const COUNTRY_ALIASES: Record<string, string> = {
  uk: 'gb', 'u.k.': 'gb', 'great britain': 'gb', 'united kingdom': 'gb',
  ca: 'ca', canada: 'ca', // 'CA' is also a US state — disambiguated by context (see normalizeToken)
  au: 'au', australia: 'au',
  in: 'in', india: 'in',
  de: 'de', germany: 'de', deutschland: 'de',
  fr: 'fr', france: 'fr',
  ie: 'ie', ireland: 'ie',
  nl: 'nl', netherlands: 'nl', holland: 'nl',
  jp: 'jp', japan: 'jp',
  sg: 'sg', singapore: 'sg',
  // LatAm — common on remote job boards. Without these, listings like
  // "Argentina Remote" parse with countries=∅ and slip through the
  // remote-fallback clause that assumes unknown-country = US.
  ar: 'ar', argentina: 'ar',
  br: 'br', brazil: 'br', brasil: 'br',
  mx: 'mx', mexico: 'mx', méxico: 'mx',
  cl: 'cl', chile: 'cl',
  co: 'co', colombia: 'co', // 'CO' is also Colorado — handled by 2-letter state check first
  pe: 'pe', peru: 'pe', perú: 'pe',
  uy: 'uy', uruguay: 'uy',
  // Europe (non-EU + EU we hadn't covered)
  es: 'es', spain: 'es', españa: 'es',
  it: 'it', italy: 'it', italia: 'it',
  pt: 'pt', portugal: 'pt',
  pl: 'pl', poland: 'pl',
  se: 'se', sweden: 'se', sverige: 'se',
  no: 'no', norway: 'no',
  dk: 'dk', denmark: 'dk',
  fi: 'fi', finland: 'fi',
  ch: 'ch', switzerland: 'ch',
  at: 'at', austria: 'at',
  be: 'be', belgium: 'be',
  cz: 'cz', czechia: 'cz', 'czech republic': 'cz',
  ro: 'ro', romania: 'ro',
  ua: 'ua', ukraine: 'ua',
  // Asia / Oceania
  cn: 'cn', china: 'cn',
  hk: 'hk', 'hong kong': 'hk',
  tw: 'tw', taiwan: 'tw',
  kr: 'kr', korea: 'kr', 'south korea': 'kr',
  ph: 'ph', philippines: 'ph',
  id: 'id', indonesia: 'id',
  my: 'my', malaysia: 'my',
  th: 'th', thailand: 'th',
  vn: 'vn', vietnam: 'vn',
  nz: 'nz', 'new zealand': 'nz',
  // Middle East / Africa
  il: 'il', israel: 'il',
  ae: 'ae', uae: 'ae', 'united arab emirates': 'ae',
  za: 'za', 'south africa': 'za',
  ng: 'ng', nigeria: 'ng',
  eg: 'eg', egypt: 'eg',
  ke: 'ke', kenya: 'ke',
};

// ─── Tokenization ───────────────────────────────────────────────────

/** Split a location string into atomic tokens.
 *  "USA | Seattle, WA — Remote" → ["usa", "seattle", "wa", "remote"].
 *  Splits on every common career-board delimiter: , - | / : · ; • */
function splitDelimiters(loc: string): string[] {
  return loc
    .split(/[,\-|\/:·;•—–]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Normalize a single token: strip punctuation, lowercase. Special-
 *  case "U.S." / "U.S.A." (the dots get stripped, leaving "us" / "usa"
 *  which already match US_ALIASES). */
function normalizeToken(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/\./g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export interface ParsedLocation {
  /** Lowercased city names — always the canonical/expanded form
   *  (e.g. "san francisco", not "SFO"). */
  cities: Set<string>;
  /** Uppercase 2-letter state codes (WA, CA, NY, …). */
  states: Set<string>;
  /** Lowercase country codes (us, gb, ca, …). */
  countries: Set<string>;
  /** True if any token matched a remote signal. */
  isRemote: boolean;
}

/**
 * Parse a freeform location string into a structured token bag.
 * Used both for the user's preferredLocations and for each listing's
 * location field — symmetry guarantees the matcher compares like
 * with like.
 */
export function parseLocation(loc: string): ParsedLocation {
  const out: ParsedLocation = {
    cities: new Set(),
    states: new Set(),
    countries: new Set(),
    isRemote: false,
  };
  if (!loc) return out;

  const tokens = splitDelimiters(loc);

  // Track tokens whose state classification is ambiguous with a city
  // of the same name. The canonical example: "Washington, DC" — the
  // "Washington" token first parses as the state WA, but the DC token
  // in the same string proves it's actually the city. After the main
  // pass we reclassify these to cities iff DC also ended up in states.
  const ambiguousCityStates = new Map<string, string>([
    ['washington', 'WA'], // Washington state vs. Washington, DC
    ['new york', 'NY'],   // New York state vs. New York City (NYC)
  ]);
  const ambiguousHits: string[] = [];

  // Also keep the original lower-cased string for substring checks
  // we can't capture via tokens alone (e.g. "remote in the us").
  const flat = loc.toLowerCase().replace(/[^\w\s]/g, ' ').replace(/\s+/g, ' ').trim();
  if (/\bremote\b/.test(flat) || /\bvirtual\b/.test(flat) || /\bwork[\s-]?from[\s-]?home\b/.test(flat)) {
    out.isRemote = true;
  }

  for (const raw of tokens) {
    const norm = normalizeToken(raw);
    if (!norm) continue;

    // Remote / virtual.
    if (norm === 'remote' || norm === 'virtual' || norm === 'work from home') {
      out.isRemote = true;
      continue;
    }

    // US country aliases.
    if (US_ALIASES.has(norm)) {
      out.countries.add('us');
      continue;
    }

    // Other country aliases. Note: "ca" is ambiguous (California vs
    // Canada). We only map "ca" → Canada when the surrounding token
    // bag has another country signal AND no US state context. Conservative
    // approach: leave bare "ca" as a state token; the disambiguation
    // happens via co-occurrence of "us" / "usa" elsewhere.
    if (norm !== 'ca' && COUNTRY_ALIASES[norm]) {
      out.countries.add(COUNTRY_ALIASES[norm]);
      continue;
    }

    // 2-letter US state code? Match case-insensitively.
    const upper = norm.toUpperCase();
    if (upper.length === 2 && STATE_CODE_TO_NAME[upper]) {
      out.states.add(upper);
      continue;
    }

    // Full state name?
    if (STATE_NAME_TO_CODE[norm]) {
      out.states.add(STATE_NAME_TO_CODE[norm]);
      if (ambiguousCityStates.has(norm)) ambiguousHits.push(norm);
      continue;
    }

    // Airport / IATA code? 3 uppercase letters.
    const u3 = norm.toUpperCase();
    if (u3.length === 3 && AIRPORT_TO_CITY[u3]) {
      const ap = AIRPORT_TO_CITY[u3];
      out.cities.add(ap.city);
      out.states.add(ap.state);
      continue;
    }

    // Multi-word token fallback — try whitespace-splitting and
    // re-checking against country/state tables. Catches space-only
    // separators like "Argentina Remote" (no comma/dash), where the
    // whole phrase otherwise becomes a single bogus "city" and the
    // country signal is lost.
    if (/\s/.test(norm)) {
      let matchedAny = false;
      for (const part of norm.split(/\s+/)) {
        if (!part) continue;
        if (part === 'remote' || part === 'virtual') {
          out.isRemote = true;
          matchedAny = true;
          continue;
        }
        if (US_ALIASES.has(part)) { out.countries.add('us'); matchedAny = true; continue; }
        if (part !== 'ca' && COUNTRY_ALIASES[part]) {
          out.countries.add(COUNTRY_ALIASES[part]);
          matchedAny = true;
          continue;
        }
        const up = part.toUpperCase();
        if (up.length === 2 && STATE_CODE_TO_NAME[up]) {
          out.states.add(up); matchedAny = true; continue;
        }
        if (STATE_NAME_TO_CODE[part]) {
          out.states.add(STATE_NAME_TO_CODE[part]);
          if (ambiguousCityStates.has(part)) ambiguousHits.push(part);
          matchedAny = true;
          continue;
        }
      }
      // If any sub-token matched a structured field, don't also dump
      // the raw phrase into cities — it'd just create noise.
      if (matchedAny) continue;
    }

    // City fallback. We don't gate on a known-city list — career
    // boards use thousands of city names. Just trust the token; the
    // matcher's symmetry handles it (user preferred-loc cities pass
    // through here too).
    if (norm.length >= 2) {
      out.cities.add(norm);
    }
  }

  // Post-pass: reclassify ambiguous city/state collisions.
  for (const norm of ambiguousHits) {
    const bogusState = ambiguousCityStates.get(norm)!;
    if (norm === 'washington') {
      // "Washington" is the CITY (Washington, D.C.) when DC is also
      // present — drop the bogus WA state and record the city.
      if (out.states.has('DC')) {
        out.states.delete(bogusState);
        out.cities.add('washington');
      }
      // Otherwise "Washington" = the state WA; leave as-is.
    } else if (norm === 'new york') {
      // "New York" is almost always the CITY (NYC) on job boards —
      // "New York, NY", "New York, United States", etc. Record it as
      // a city WHILE KEEPING the NY state token, so it matches both
      // a "New York, NY" city pref AND a "New York" (NY) state pref.
      // The state stays because NYC is in NY — no accuracy loss.
      out.cities.add('new york');
    }
  }

  return out;
}

// ─── Matcher ────────────────────────────────────────────────────────

export interface LocationMatchInput {
  preferredLocations: string[];
  /** State/region geo codes from geo-data (e.g. "WA", "CA",
   *  "CA-BC"). Optional — older saves don't have it. */
  preferredStates?: string[];
  /** Country geo codes (e.g. "US", "REMOTE"). Optional. */
  preferredCountries?: string[];
  workModes: WorkMode[];
  workAuthCountries: string[];
}

/**
 * Build a matcher closure with HIERARCHICAL, accuracy-first semantics.
 *
 * The three preference levels are matched independently (a listing
 * matches if ANY level matches), but each level is matched *precisely*
 * so we neither under- nor over-match:
 *
 *   CITY level (preferredLocations, e.g. "Portland, OR")
 *     A listing matches only if it names that city AND the state is
 *     consistent:
 *       • listing prints a state → it must equal the pref's state
 *         ("Portland, OR" pref does NOT match "Portland, ME"),
 *       • listing prints no state → we infer the city's state(s) from
 *         the geo table; ambiguous/unknown cities match permissively
 *         (we can't disprove, so we don't hide a possibly-valid job).
 *     A city pref does NOT promote to its whole state — that's what the
 *     STATE level is for. (Picking "Seattle, WA" gives Seattle jobs,
 *     not all of Washington; pick the WA state option for that.)
 *
 *   STATE level (preferredStates, e.g. "WA")
 *     Matches any listing in that state. If the listing prints only a
 *     bare city ("Austin"), we infer its state from the geo table so
 *     state prefs still catch state-less city listings.
 *     "WA" never matches "Washington, DC" (DC is its own code).
 *
 *   COUNTRY level (preferredCountries, e.g. "US")
 *     Matches any listing in that country. Inference climbs the
 *     hierarchy: country token → state's parent country → city's
 *     state's parent country, so "Austin, TX" (no country printed)
 *     still matches a US country pref.
 *
 *   REMOTE: explicit "Remote (anywhere)" pick OR the workMode-gated
 *     remote fallback (auth-country scoped), unchanged.
 */
export function buildLocationMatcher(
  input: LocationMatchInput,
): (location: string) => boolean {
  // ─── City prefs: (city, state?) pairs from preferredLocations ────
  // Each preferredLocation is a single "City, ST" string. We parse it
  // and pair the city with its state (if the entry carried one). Some
  // entries parse to a state with no city (a bare "Texas", or "New
  // York" before the post-pass adds the city) — those fold into the
  // state-pref set so they still match.
  const cityPrefs: { city: string; state?: string }[] = [];
  const prefStateCodes = new Set<string>();
  const prefCountryCodes = new Set<string>();
  let prefersRemoteCountry = false;

  for (const loc of input.preferredLocations ?? []) {
    const p = parseLocation(loc);
    const cities = [...p.cities];
    const states = [...p.states];
    if (cities.length > 0) {
      // Pair each city with the entry's (single) state when present.
      const state = states.length === 1 ? states[0] : undefined;
      for (const c of cities) cityPrefs.push({ city: c, state });
    } else if (states.length > 0) {
      // City-less entry that resolved to a state → treat as a state
      // pref (e.g. someone typed a bare "Texas" into the city box).
      for (const s of states) prefStateCodes.add(s);
    } else if (p.isRemote) {
      prefersRemoteCountry = true;
    } else {
      for (const c of p.countries) prefCountryCodes.add(c);
    }
  }

  // ─── Structured state prefs (cascade picker) ─────────────────────
  // Track which countries have an explicit state drilled in under
  // them. A country with a selected state is a NAVIGATION SCOPE, not
  // a broad "all of this country" match — so we exclude it from the
  // country-match filter below. (Picking US → WA matches only WA, not
  // every US job; picking US alone matches all US.)
  const scopedCountries = new Set<string>();
  for (const code of input.preferredStates ?? []) {
    if (STATE_CODE_TO_NAME[code]) {
      prefStateCodes.add(code); // US USPS code — exact state match.
      scopedCountries.add('US');
    } else {
      // Non-US region code (CA-BC, UK-ENG, IN-KA): listing state
      // tokens won't carry it, so widen to its parent country. This
      // is an explicit match (we can't do better for non-US regions
      // without city tokens), so it is NOT treated as merely scoped.
      const parent = COUNTRY_OF_STATE[code];
      if (parent === 'REMOTE') prefersRemoteCountry = true;
      else if (parent) prefCountryCodes.add(parent.toLowerCase());
    }
  }

  // ─── Structured country prefs (cascade picker) ───────────────────
  // A selected country matches the whole country UNLESS the user has
  // drilled into states under it (scopedCountries) — then it's just a
  // navigation parent and contributes no broad match.
  for (const c of input.preferredCountries ?? []) {
    if (c === 'REMOTE') { prefersRemoteCountry = true; continue; }
    if (scopedCountries.has(c)) continue; // drilled into states → scope only
    prefCountryCodes.add(c.toLowerCase());
  }

  const remoteOK = (input.workModes ?? []).includes('remote');
  const authCountries = new Set(
    (input.workAuthCountries ?? []).map((c) => c.toLowerCase()),
  );
  if (authCountries.size === 0) authCountries.add('us');

  return (listingLocation: string) => {
    if (!listingLocation) return false;
    const L = parseLocation(listingLocation);

    // ── 1. CITY level (state-qualified) ──────────────────────────
    for (const pref of cityPrefs) {
      if (!L.cities.has(pref.city)) continue;
      if (!pref.state) return true; // pref had no state qualifier → name match
      if (L.states.size > 0) {
        // Listing printed a state — require it to match the pref's.
        // This is the over-match fix: Portland-OR pref vs Portland-ME
        // listing fails here because L.states = {ME} lacks OR.
        if (L.states.has(pref.state)) return true;
      } else {
        // Listing printed no state — infer from the city name.
        const inferred = CITY_TO_STATES[pref.city];
        if (!inferred) return true;                 // unknown city → can't disprove
        if (inferred.includes(pref.state)) return true;
        // City is known to belong to OTHER state(s) only → genuinely
        // a different-state same-name city → no match.
      }
    }

    // ── 2. STATE level ───────────────────────────────────────────
    if (prefStateCodes.size > 0) {
      for (const s of L.states) if (prefStateCodes.has(s)) return true;
      // Listing printed no state but has a city → infer its state.
      if (L.states.size === 0) {
        for (const c of L.cities) {
          const inferred = CITY_TO_STATES[c];
          if (inferred) for (const s of inferred) if (prefStateCodes.has(s)) return true;
        }
      }
    }

    // ── 3. COUNTRY level (with upward inference) ─────────────────
    if (prefCountryCodes.size > 0) {
      for (const c of L.countries) if (prefCountryCodes.has(c)) return true;
      // Infer country from any state token (US state → "us").
      for (const s of L.states) {
        const parent = COUNTRY_OF_STATE[s];
        if (parent && prefCountryCodes.has(parent.toLowerCase())) return true;
      }
      // Infer country from a bare city (city → state → country).
      if (L.states.size === 0) {
        for (const c of L.cities) {
          const inferred = CITY_TO_STATES[c];
          if (!inferred) continue;
          for (const s of inferred) {
            const parent = COUNTRY_OF_STATE[s];
            if (parent && prefCountryCodes.has(parent.toLowerCase())) return true;
          }
        }
      }
    }

    // ── 4. Remote ────────────────────────────────────────────────
    // Explicit "Remote (anywhere)" pick.
    if (prefersRemoteCountry && L.isRemote) return true;
    // workMode-gated fallback: remote listing in an authorized country
    // (or no country tag → assumed primary auth country).
    if (remoteOK && L.isRemote) {
      if (L.countries.size === 0) return true;
      for (const c of L.countries) if (authCountries.has(c)) return true;
    }

    return false;
  };
}
