/**
 * Work-authorization filter for job listings.
 *
 * Companies post roles in many countries, including remote roles that
 * are explicitly restricted to a single country ("Remote — Canada").
 * Without this filter, a user authorized only to work in the United
 * States gets recommendations they can't legally take — which is both
 * confusing and a waste of attention.
 *
 * Approach
 * ────────
 * 1. Detect the country (or countries) a listing's location string
 *    advertises. We look for explicit country names, common ISO codes,
 *    US state abbreviations, and a couple of well-known city names so
 *    bare "Toronto" / "London" / "Bangalore" don't slip through.
 * 2. If we can't determine ANY country (e.g. "Remote", "Anywhere",
 *    just a city we don't know), the listing is treated as "unknown"
 *    and shown — the cost of false-negatives (hiding a real US job
 *    because we couldn't infer the country) is worse than the cost of
 *    leaving an ambiguous one in.
 * 3. A listing passes the filter if at least one of its detected
 *    countries is in the user's authorization list.
 *
 * The filter is deliberately heuristic and erring on the side of
 * showing too much. The classifier is a regex pass — fast enough to
 * run on the full listings array on every render.
 */

// ─── Country tokens ──────────────────────────────────────────────────

/**
 * Lowercase phrase → ISO alpha-2 code. Order matters: more-specific
 * phrases come first so "united kingdom" matches before "united" or
 * "kingdom" alone.
 */
const COUNTRY_PATTERNS: { code: string; phrases: string[] }[] = [
  {
    code: 'US',
    phrases: [
      'united states', 'usa', 'u.s.a', 'u.s.', ' us ', 'us-', '-us', ', us',
      'america',
    ],
  },
  { code: 'CA', phrases: ['canada', 'canadian', ' ca ', ', ca'] },
  { code: 'GB', phrases: ['united kingdom', 'great britain', 'england', 'scotland', 'wales', 'uk', 'u.k.'] },
  { code: 'IE', phrases: ['ireland', 'irish'] },
  { code: 'DE', phrases: ['germany', 'german', 'deutschland'] },
  { code: 'FR', phrases: ['france', 'french'] },
  { code: 'NL', phrases: ['netherlands', 'holland', 'dutch'] },
  { code: 'AU', phrases: ['australia', 'australian'] },
  { code: 'NZ', phrases: ['new zealand'] },
  { code: 'IN', phrases: ['india', 'indian'] },
  { code: 'SG', phrases: ['singapore'] },
  { code: 'JP', phrases: ['japan', 'tokyo'] },
  { code: 'BR', phrases: ['brazil', 'brasil'] },
  { code: 'MX', phrases: ['mexico'] },
  { code: 'ES', phrases: ['spain', 'madrid', 'barcelona'] },
  { code: 'IT', phrases: ['italy', 'milan', 'rome'] },
  { code: 'PL', phrases: ['poland', 'warsaw', 'krakow'] },
  { code: 'CH', phrases: ['switzerland', 'zurich', 'geneva'] },
  { code: 'IL', phrases: ['israel', 'tel aviv'] },
  { code: 'AE', phrases: ['united arab emirates', 'dubai', 'abu dhabi'] },
];

/** Country-disambiguating cities. Avoids false negatives where a JD
 *  posts a city without country, e.g. "Toronto, ON" or "Bangalore". */
const CITY_TO_COUNTRY: Record<string, string> = {
  // Canada
  'toronto': 'CA', 'vancouver': 'CA', 'montreal': 'CA', 'ottawa': 'CA',
  'calgary': 'CA', 'edmonton': 'CA', 'waterloo': 'CA', 'mississauga': 'CA',
  // UK
  'london': 'GB', 'manchester': 'GB', 'edinburgh': 'GB', 'cambridge': 'GB',
  // Ireland
  'dublin': 'IE', 'cork': 'IE',
  // India
  'bangalore': 'IN', 'bengaluru': 'IN', 'mumbai': 'IN', 'delhi': 'IN',
  'hyderabad': 'IN', 'pune': 'IN', 'chennai': 'IN', 'gurgaon': 'IN',
  'noida': 'IN',
  // Australia
  'sydney': 'AU', 'melbourne': 'AU', 'brisbane': 'AU',
  // Germany / NL / France
  'berlin': 'DE', 'munich': 'DE', 'hamburg': 'DE',
  'amsterdam': 'NL', 'rotterdam': 'NL',
  'paris': 'FR', 'lyon': 'FR',
  // Singapore is both a city and a country
  // Latin America
  'são paulo': 'BR', 'sao paulo': 'BR',
  'mexico city': 'MX',
};

/** US state abbreviations — a 2-letter code that follows a comma in
 *  the location string is a strong US indicator. Includes DC. */
const US_STATES = new Set([
  'AL','AK','AZ','AR','CA','CO','CT','DE','DC','FL','GA','HI','ID','IL','IN',
  'IA','KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH',
  'NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT',
  'VT','VA','WA','WV','WI','WY',
]);

/** Canadian province codes — same idea: ", ON" / ", BC" → CA. */
const CA_PROVINCES = new Set([
  'AB','BC','MB','NB','NL','NS','NT','NU','ON','PE','QC','SK','YT',
]);

// ─── Detection ───────────────────────────────────────────────────────

/**
 * Return the set of country codes a location string advertises.
 * Empty set = "unknown / can't tell" (in which case callers SHOULD
 * keep the listing — see the rationale at the top of the file).
 */
export function detectCountries(location: string | null | undefined): Set<string> {
  if (!location) return new Set();
  const lc = ` ${location.toLowerCase()} `;
  const found = new Set<string>();

  // 1. Explicit country names / abbreviations.
  for (const { code, phrases } of COUNTRY_PATTERNS) {
    for (const p of phrases) {
      if (lc.includes(p)) {
        found.add(code);
        break;
      }
    }
  }

  // 2. State / province codes after a comma. ", WA" → US, ", ON" → CA.
  // We use the original-cased text for these so we don't false-match
  // " ca " (California) — that path stays in COUNTRY_PATTERNS where
  // it's already gated on whitespace.
  const stateMatches = location.match(/,\s*([A-Z]{2})\b/g);
  if (stateMatches) {
    for (const m of stateMatches) {
      const code = m.replace(/[,\s]/g, '');
      if (US_STATES.has(code)) found.add('US');
      else if (CA_PROVINCES.has(code)) found.add('CA');
    }
  }

  // 3. Well-known cities.
  for (const [city, code] of Object.entries(CITY_TO_COUNTRY)) {
    if (lc.includes(` ${city} `) || lc.includes(`${city},`) || lc.includes(`,${city}`)) {
      found.add(code);
    }
  }

  return found;
}

// ─── Filter ──────────────────────────────────────────────────────────

/**
 * Returns true if the listing's location is compatible with the user's
 * authorization. Specifically:
 *   - If we can't detect any country → keep (unknown bucket).
 *   - If at least one detected country is in the user's auth list → keep.
 *   - Otherwise → drop.
 */
export function isWorkAuthorized(
  location: string | null | undefined,
  authorizedCountries: string[],
): boolean {
  // Empty auth list shouldn't accidentally hide everything — fall back
  // to the legacy "show everything" behavior.
  if (!authorizedCountries || authorizedCountries.length === 0) return true;

  const detected = detectCountries(location);
  if (detected.size === 0) return true; // unknown → don't hide

  for (const c of detected) {
    if (authorizedCountries.includes(c)) return true;
  }
  return false;
}
