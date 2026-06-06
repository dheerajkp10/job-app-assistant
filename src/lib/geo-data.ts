/**
 * Geographic taxonomy for the Country → State → City cascading
 * location picker (Settings + onboarding).
 *
 * Shape:
 *   COUNTRIES            — ordered list of selectable countries.
 *   STATES_BY_COUNTRY    — country code → its states/provinces/regions.
 *   CITIES_BY_STATE      — state code → its major cities (display names).
 *
 * Design notes
 * ────────────
 * - State codes are GLOBALLY UNIQUE within this table (US uses the
 *   2-letter USPS codes; we prefix non-US regions to avoid clashes —
 *   e.g. Canadian "ON" stays "ON" because it doesn't collide, but UK
 *   nations use "UK-ENG" etc. and Indian states use "IN-KA" etc.).
 *   This lets the matcher treat `preferredStates` as a flat set.
 * - City entries are stored as their bare display name ("Seattle").
 *   The picker renders them and stores the canonical "City, STATE"
 *   string in preferredLocations so the existing location matcher
 *   (which parses "City, ST") keeps working unchanged.
 * - This is intentionally a static module, not a JSON import, so
 *   tree-shaking + type-checking work. New countries can be appended
 *   here without touching any component.
 */

export interface GeoCountry {
  /** ISO-3166 alpha-2 (uppercase) or 'REMOTE' pseudo-country. */
  code: string;
  name: string;
}

export interface GeoState {
  /** Globally-unique region code. US = USPS 2-letter. */
  code: string;
  name: string;
  /** USPS/postal abbreviation to append to city display strings
   *  ("Seattle" + ", WA"). For non-US regions we use a short form
   *  the job boards actually print (province codes for CA, etc.). */
  abbr: string;
}

export const COUNTRIES: GeoCountry[] = [
  { code: 'US', name: 'United States' },
  { code: 'CA', name: 'Canada' },
  { code: 'UK', name: 'United Kingdom' },
  { code: 'IN', name: 'India' },
  { code: 'REMOTE', name: 'Remote (anywhere)' },
];

// ─── United States ──────────────────────────────────────────────────
const US_STATES: GeoState[] = [
  { code: 'AL', name: 'Alabama', abbr: 'AL' },
  { code: 'AK', name: 'Alaska', abbr: 'AK' },
  { code: 'AZ', name: 'Arizona', abbr: 'AZ' },
  { code: 'AR', name: 'Arkansas', abbr: 'AR' },
  { code: 'CA', name: 'California', abbr: 'CA' },
  { code: 'CO', name: 'Colorado', abbr: 'CO' },
  { code: 'CT', name: 'Connecticut', abbr: 'CT' },
  { code: 'DE', name: 'Delaware', abbr: 'DE' },
  { code: 'DC', name: 'Washington, D.C.', abbr: 'DC' },
  { code: 'FL', name: 'Florida', abbr: 'FL' },
  { code: 'GA', name: 'Georgia', abbr: 'GA' },
  { code: 'HI', name: 'Hawaii', abbr: 'HI' },
  { code: 'ID', name: 'Idaho', abbr: 'ID' },
  { code: 'IL', name: 'Illinois', abbr: 'IL' },
  { code: 'IN', name: 'Indiana', abbr: 'IN' },
  { code: 'IA', name: 'Iowa', abbr: 'IA' },
  { code: 'KS', name: 'Kansas', abbr: 'KS' },
  { code: 'KY', name: 'Kentucky', abbr: 'KY' },
  { code: 'LA', name: 'Louisiana', abbr: 'LA' },
  { code: 'ME', name: 'Maine', abbr: 'ME' },
  { code: 'MD', name: 'Maryland', abbr: 'MD' },
  { code: 'MA', name: 'Massachusetts', abbr: 'MA' },
  { code: 'MI', name: 'Michigan', abbr: 'MI' },
  { code: 'MN', name: 'Minnesota', abbr: 'MN' },
  { code: 'MS', name: 'Mississippi', abbr: 'MS' },
  { code: 'MO', name: 'Missouri', abbr: 'MO' },
  { code: 'MT', name: 'Montana', abbr: 'MT' },
  { code: 'NE', name: 'Nebraska', abbr: 'NE' },
  { code: 'NV', name: 'Nevada', abbr: 'NV' },
  { code: 'NH', name: 'New Hampshire', abbr: 'NH' },
  { code: 'NJ', name: 'New Jersey', abbr: 'NJ' },
  { code: 'NM', name: 'New Mexico', abbr: 'NM' },
  { code: 'NY', name: 'New York', abbr: 'NY' },
  { code: 'NC', name: 'North Carolina', abbr: 'NC' },
  { code: 'ND', name: 'North Dakota', abbr: 'ND' },
  { code: 'OH', name: 'Ohio', abbr: 'OH' },
  { code: 'OK', name: 'Oklahoma', abbr: 'OK' },
  { code: 'OR', name: 'Oregon', abbr: 'OR' },
  { code: 'PA', name: 'Pennsylvania', abbr: 'PA' },
  { code: 'RI', name: 'Rhode Island', abbr: 'RI' },
  { code: 'SC', name: 'South Carolina', abbr: 'SC' },
  { code: 'SD', name: 'South Dakota', abbr: 'SD' },
  { code: 'TN', name: 'Tennessee', abbr: 'TN' },
  { code: 'TX', name: 'Texas', abbr: 'TX' },
  { code: 'UT', name: 'Utah', abbr: 'UT' },
  { code: 'VT', name: 'Vermont', abbr: 'VT' },
  { code: 'VA', name: 'Virginia', abbr: 'VA' },
  { code: 'WA', name: 'Washington', abbr: 'WA' },
  { code: 'WV', name: 'West Virginia', abbr: 'WV' },
  { code: 'WI', name: 'Wisconsin', abbr: 'WI' },
  { code: 'WY', name: 'Wyoming', abbr: 'WY' },
];

// ─── Canada ─────────────────────────────────────────────────────────
const CA_STATES: GeoState[] = [
  { code: 'CA-AB', name: 'Alberta', abbr: 'AB' },
  { code: 'CA-BC', name: 'British Columbia', abbr: 'BC' },
  { code: 'CA-MB', name: 'Manitoba', abbr: 'MB' },
  { code: 'CA-NB', name: 'New Brunswick', abbr: 'NB' },
  { code: 'CA-NL', name: 'Newfoundland and Labrador', abbr: 'NL' },
  { code: 'CA-NS', name: 'Nova Scotia', abbr: 'NS' },
  { code: 'CA-ON', name: 'Ontario', abbr: 'ON' },
  { code: 'CA-PE', name: 'Prince Edward Island', abbr: 'PE' },
  { code: 'CA-QC', name: 'Quebec', abbr: 'QC' },
  { code: 'CA-SK', name: 'Saskatchewan', abbr: 'SK' },
];

// ─── United Kingdom ─────────────────────────────────────────────────
const UK_STATES: GeoState[] = [
  { code: 'UK-ENG', name: 'England', abbr: 'England' },
  { code: 'UK-SCT', name: 'Scotland', abbr: 'Scotland' },
  { code: 'UK-WLS', name: 'Wales', abbr: 'Wales' },
  { code: 'UK-NIR', name: 'Northern Ireland', abbr: 'Northern Ireland' },
];

// ─── India ──────────────────────────────────────────────────────────
const IN_STATES: GeoState[] = [
  { code: 'IN-KA', name: 'Karnataka', abbr: 'Karnataka' },
  { code: 'IN-MH', name: 'Maharashtra', abbr: 'Maharashtra' },
  { code: 'IN-TG', name: 'Telangana', abbr: 'Telangana' },
  { code: 'IN-TN', name: 'Tamil Nadu', abbr: 'Tamil Nadu' },
  { code: 'IN-DL', name: 'Delhi (NCR)', abbr: 'Delhi' },
  { code: 'IN-HR', name: 'Haryana', abbr: 'Haryana' },
  { code: 'IN-UP', name: 'Uttar Pradesh', abbr: 'Uttar Pradesh' },
  { code: 'IN-WB', name: 'West Bengal', abbr: 'West Bengal' },
  { code: 'IN-GJ', name: 'Gujarat', abbr: 'Gujarat' },
  { code: 'IN-KL', name: 'Kerala', abbr: 'Kerala' },
];

export const STATES_BY_COUNTRY: Record<string, GeoState[]> = {
  US: US_STATES,
  CA: CA_STATES,
  UK: UK_STATES,
  IN: IN_STATES,
  REMOTE: [],
};

// ─── Cities by state ────────────────────────────────────────────────
// US: ~10-15 cities per high-population state, fewer for smaller ones.
// Bay Area + SoCal expanded since the user explicitly called them out.
export const CITIES_BY_STATE: Record<string, string[]> = {
  AL: ['Birmingham', 'Huntsville', 'Montgomery', 'Mobile'],
  AK: ['Anchorage', 'Fairbanks', 'Juneau'],
  AZ: ['Phoenix', 'Tucson', 'Scottsdale', 'Tempe', 'Chandler', 'Mesa', 'Gilbert'],
  AR: ['Little Rock', 'Fayetteville', 'Bentonville'],
  CA: [
    // Bay Area
    'San Francisco', 'San Jose', 'Oakland', 'Berkeley', 'Palo Alto',
    'Mountain View', 'Sunnyvale', 'Santa Clara', 'Menlo Park', 'Redwood City',
    'Cupertino', 'Fremont', 'San Mateo', 'Emeryville', 'South San Francisco',
    // SoCal
    'Los Angeles', 'San Diego', 'Irvine', 'Santa Monica', 'Pasadena',
    'Long Beach', 'Anaheim', 'Culver City', 'El Segundo', 'Burbank',
    // Other
    'Sacramento', 'San Luis Obispo', 'Santa Barbara', 'Fresno',
  ],
  CO: ['Denver', 'Boulder', 'Colorado Springs', 'Fort Collins', 'Aurora'],
  CT: ['Stamford', 'Hartford', 'New Haven', 'Greenwich'],
  DE: ['Wilmington', 'Newark'],
  DC: ['Washington'],
  FL: ['Miami', 'Orlando', 'Tampa', 'Jacksonville', 'Fort Lauderdale', 'St. Petersburg'],
  GA: ['Atlanta', 'Savannah', 'Augusta', 'Alpharetta'],
  HI: ['Honolulu'],
  ID: ['Boise', 'Meridian'],
  IL: ['Chicago', 'Evanston', 'Naperville', 'Schaumburg'],
  IN: ['Indianapolis', 'Fishers', 'Bloomington'],
  IA: ['Des Moines', 'Cedar Rapids', 'Iowa City'],
  KS: ['Kansas City', 'Wichita', 'Overland Park'],
  KY: ['Louisville', 'Lexington'],
  LA: ['New Orleans', 'Baton Rouge'],
  ME: ['Portland'],
  MD: ['Baltimore', 'Bethesda', 'Rockville', 'Columbia', 'Silver Spring'],
  MA: ['Boston', 'Cambridge', 'Somerville', 'Waltham', 'Burlington', 'Worcester'],
  MI: ['Detroit', 'Ann Arbor', 'Grand Rapids'],
  MN: ['Minneapolis', 'St. Paul', 'Rochester'],
  MS: ['Jackson'],
  MO: ['St. Louis', 'Kansas City', 'Columbia'],
  MT: ['Bozeman', 'Missoula', 'Billings'],
  NE: ['Omaha', 'Lincoln'],
  NV: ['Las Vegas', 'Reno', 'Henderson'],
  NH: ['Manchester', 'Nashua'],
  NJ: ['Newark', 'Jersey City', 'Hoboken', 'Princeton', 'Edison'],
  NM: ['Albuquerque', 'Santa Fe'],
  NY: ['New York', 'Brooklyn', 'Buffalo', 'Rochester', 'Albany', 'Syracuse'],
  NC: ['Charlotte', 'Raleigh', 'Durham', 'Cary', 'Chapel Hill'],
  ND: ['Fargo'],
  OH: ['Columbus', 'Cleveland', 'Cincinnati', 'Dublin'],
  OK: ['Oklahoma City', 'Tulsa'],
  OR: ['Portland', 'Beaverton', 'Hillsboro', 'Eugene', 'Bend'],
  PA: ['Philadelphia', 'Pittsburgh', 'Malvern', 'King of Prussia'],
  RI: ['Providence'],
  SC: ['Charleston', 'Columbia', 'Greenville'],
  SD: ['Sioux Falls'],
  TN: ['Nashville', 'Memphis', 'Knoxville', 'Chattanooga'],
  TX: [
    'Austin', 'Dallas', 'Houston', 'San Antonio', 'Fort Worth',
    'Plano', 'Round Rock', 'Irving', 'Frisco', 'Richardson', 'El Paso',
  ],
  UT: ['Salt Lake City', 'Lehi', 'Provo', 'Park City'],
  VT: ['Burlington'],
  VA: ['Arlington', 'Alexandria', 'Richmond', 'McLean', 'Reston', 'Herndon', 'Tysons'],
  WA: [
    'Seattle', 'Bellevue', 'Kirkland', 'Redmond', 'Tacoma', 'Spokane',
    'Bothell', 'Everett', 'Renton', 'Issaquah', 'Sammamish', 'Olympia',
  ],
  WV: ['Charleston', 'Morgantown'],
  WI: ['Madison', 'Milwaukee'],
  WY: ['Cheyenne', 'Jackson'],

  // Canada
  'CA-AB': ['Calgary', 'Edmonton'],
  'CA-BC': ['Vancouver', 'Victoria', 'Burnaby', 'Richmond'],
  'CA-MB': ['Winnipeg'],
  'CA-NB': ['Fredericton', 'Moncton'],
  'CA-NL': ["St. John's"],
  'CA-NS': ['Halifax'],
  'CA-ON': ['Toronto', 'Ottawa', 'Waterloo', 'Mississauga', 'Hamilton', 'Kitchener'],
  'CA-PE': ['Charlottetown'],
  'CA-QC': ['Montreal', 'Quebec City'],
  'CA-SK': ['Saskatoon', 'Regina'],

  // UK
  'UK-ENG': ['London', 'Manchester', 'Birmingham', 'Bristol', 'Leeds', 'Cambridge', 'Oxford'],
  'UK-SCT': ['Edinburgh', 'Glasgow'],
  'UK-WLS': ['Cardiff', 'Swansea'],
  'UK-NIR': ['Belfast'],

  // India
  'IN-KA': ['Bengaluru', 'Mysuru'],
  'IN-MH': ['Mumbai', 'Pune', 'Nagpur'],
  'IN-TG': ['Hyderabad'],
  'IN-TN': ['Chennai', 'Coimbatore'],
  'IN-DL': ['New Delhi', 'Gurugram', 'Noida'],
  'IN-HR': ['Gurugram', 'Faridabad'],
  'IN-UP': ['Noida', 'Lucknow'],
  'IN-WB': ['Kolkata'],
  'IN-GJ': ['Ahmedabad', 'Gandhinagar'],
  'IN-KL': ['Kochi', 'Thiruvananthapuram'],
};

// ─── Lookups ────────────────────────────────────────────────────────

/** Flat map: stateCode → GeoState, across every country. */
export const STATE_BY_CODE: Record<string, GeoState> = {};
for (const states of Object.values(STATES_BY_COUNTRY)) {
  for (const s of states) STATE_BY_CODE[s.code] = s;
}

/** stateCode → its parent country code. */
export const COUNTRY_OF_STATE: Record<string, string> = {};
for (const [country, states] of Object.entries(STATES_BY_COUNTRY)) {
  for (const s of states) COUNTRY_OF_STATE[s.code] = country;
}

/** Build the canonical "City, ABBR" display+storage string the
 *  location matcher understands. */
export function cityDisplay(city: string, stateCode: string): string {
  const st = STATE_BY_CODE[stateCode];
  return st ? `${city}, ${st.abbr}` : city;
}

/** abbr → state code, built once. Used to resolve "Seattle, WA"
 *  back to the WA state code (and thence its country). */
const STATE_BY_ABBR: Record<string, string> = {};
for (const s of Object.values(STATE_BY_CODE)) {
  // First writer wins; abbrs are unique within our table.
  if (!(s.abbr in STATE_BY_ABBR)) STATE_BY_ABBR[s.abbr] = s.code;
}

/**
 * Migration helper: given a legacy preferredLocations list of
 * "City, ABBR" strings, derive which COUNTRIES they belong to so
 * the cascade can open in the right place. We deliberately do NOT
 * derive states here — auto-selecting a state would broaden a
 * user's existing city-only matches to the whole state, changing
 * behavior silently. Country derivation is safe (it's only used to
 * reveal the state row in the picker, not as a match filter unless
 * the user keeps it selected).
 */
export function deriveCascadeFromLocations(
  locations: string[],
): { countries: string[]; states: string[] } {
  const countries = new Set<string>();
  const states = new Set<string>();
  for (const loc of locations) {
    const m = loc.match(/,\s*([^,]+)$/);
    if (!m) continue;
    const abbr = m[1].trim();
    const stateCode = STATE_BY_ABBR[abbr];
    if (!stateCode) continue;
    states.add(stateCode);
    const country = COUNTRY_OF_STATE[stateCode];
    if (country) countries.add(country);
  }
  // Return states too so the picker can reveal the city rows that
  // hold the user's existing cities — but the SETTINGS loader
  // chooses whether to apply them as a filter (it doesn't, to avoid
  // broadening). The cascade component uses them only for display.
  return { countries: [...countries], states: [...states] };
}
