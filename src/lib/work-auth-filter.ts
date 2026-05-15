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
//
// NOTE on substring matching: the `lc` string the matcher sees is the
// location lowercased and wrapped in leading + trailing spaces. We rely
// on that padding to anchor short tokens — e.g. `' us '` matches
// "Seattle, US" but not "Houston" (no embedded "us"). When adding new
// phrases, prefer space-anchored or comma-anchored variants over bare
// words to avoid the kind of substring false-positive that bit us
// historically (`'america'` matching "South America" / "Latin America").
const COUNTRY_PATTERNS: { code: string; phrases: string[] }[] = [
  {
    code: 'US',
    phrases: [
      'united states', 'usa', 'u.s.a', 'u.s.', ' us ', 'us-', '-us', ', us',
      // Intentionally NOT including bare 'america' — it substring-matches
      // "South America" and "Latin America" (both common in remote-LatAm
      // postings) and flags them as US-authorized. The named phrases above
      // cover all legitimate US references.
    ],
  },
  // Bare ' ca ' is too risky — it false-positives California in some
  // formatting variants. Stick to comma-anchored and named forms; the
  // CITY_TO_COUNTRY table catches Toronto/Vancouver/etc. as well.
  { code: 'CA', phrases: ['canada', 'canadian', ', ca'] },
  { code: 'GB', phrases: ['united kingdom', 'great britain', 'england', 'scotland', 'wales', ' uk ', ', uk', 'uk-', '-uk', 'u.k.'] },
  { code: 'IE', phrases: ['ireland', 'irish'] },
  { code: 'DE', phrases: ['germany', 'german', 'deutschland'] },
  { code: 'FR', phrases: ['france', 'french'] },
  { code: 'NL', phrases: ['netherlands', 'holland', 'dutch'] },
  { code: 'BE', phrases: ['belgium', 'brussels'] },
  { code: 'AT', phrases: ['austria', 'vienna'] },
  { code: 'CH', phrases: ['switzerland', 'zurich', 'geneva'] },
  { code: 'SE', phrases: ['sweden', 'sverige', 'stockholm', 'gothenburg'] },
  { code: 'NO', phrases: ['norway', 'oslo'] },
  { code: 'DK', phrases: ['denmark', 'copenhagen'] },
  { code: 'FI', phrases: ['finland', 'helsinki'] },
  { code: 'PL', phrases: ['poland', 'warsaw', 'krakow'] },
  { code: 'CZ', phrases: ['czech republic', 'czechia', 'prague'] },
  { code: 'ES', phrases: ['spain', 'españa', 'madrid', 'barcelona'] },
  { code: 'PT', phrases: ['portugal', 'lisbon', 'lisboa', 'porto'] },
  { code: 'IT', phrases: ['italy', 'italia', 'milan', 'rome', 'milano', 'roma'] },
  { code: 'RO', phrases: ['romania', 'bucharest'] },
  { code: 'UA', phrases: ['ukraine', 'kyiv', 'kiev'] },
  { code: 'AU', phrases: ['australia', 'australian'] },
  { code: 'NZ', phrases: ['new zealand'] },
  { code: 'IN', phrases: ['india', 'indian'] },
  { code: 'SG', phrases: ['singapore'] },
  { code: 'JP', phrases: ['japan', 'tokyo', 'osaka'] },
  { code: 'KR', phrases: ['south korea', 'korea', 'seoul'] },
  { code: 'CN', phrases: ['china', 'beijing', 'shanghai', 'shenzhen', 'hangzhou'] },
  { code: 'HK', phrases: ['hong kong'] },
  { code: 'TW', phrases: ['taiwan', 'taipei'] },
  { code: 'TH', phrases: ['thailand', 'bangkok'] },
  { code: 'PH', phrases: ['philippines', 'manila'] },
  { code: 'MY', phrases: ['malaysia', 'kuala lumpur'] },
  { code: 'ID', phrases: ['indonesia', 'jakarta'] },
  { code: 'VN', phrases: ['vietnam', 'ho chi minh', 'hanoi'] },
  { code: 'BR', phrases: ['brazil', 'brasil', 'são paulo', 'sao paulo', 'rio de janeiro'] },
  { code: 'MX', phrases: ['mexico', 'méxico', 'guadalajara'] },
  { code: 'AR', phrases: ['argentina', 'buenos aires'] },
  { code: 'CL', phrases: ['chile', 'santiago'] },
  { code: 'CO', phrases: ['colombia', 'bogota', 'bogotá', 'medellin', 'medellín'] },
  { code: 'PE', phrases: ['peru', 'perú', 'lima'] },
  { code: 'UY', phrases: ['uruguay', 'montevideo'] },
  { code: 'IL', phrases: ['israel', 'tel aviv', 'haifa'] },
  { code: 'AE', phrases: ['united arab emirates', ' uae ', ', uae', 'dubai', 'abu dhabi'] },
  { code: 'SA', phrases: ['saudi arabia', 'riyadh'] },
  { code: 'ZA', phrases: ['south africa', 'johannesburg', 'cape town'] },
  { code: 'NG', phrases: ['nigeria', 'lagos'] },
  { code: 'KE', phrases: ['kenya', 'nairobi'] },
  { code: 'EG', phrases: ['egypt', 'cairo'] },
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
  // Singapore is both a city and a country (handled by COUNTRY_PATTERNS).
  // Latin America
  'são paulo': 'BR', 'sao paulo': 'BR', 'rio de janeiro': 'BR',
  'mexico city': 'MX', 'guadalajara': 'MX',
  'buenos aires': 'AR',
  'santiago': 'CL',
  'bogota': 'CO', 'bogotá': 'CO', 'medellin': 'CO', 'medellín': 'CO',
  'lima': 'PE',
  // Europe
  'stockholm': 'SE', 'gothenburg': 'SE',
  'oslo': 'NO',
  'copenhagen': 'DK',
  'helsinki': 'FI',
  'warsaw': 'PL', 'krakow': 'PL',
  'prague': 'CZ',
  'vienna': 'AT',
  'madrid': 'ES', 'barcelona': 'ES',
  'lisbon': 'PT', 'porto': 'PT',
  'milan': 'IT', 'rome': 'IT',
  'brussels': 'BE',
  // Asia / Pacific
  'seoul': 'KR',
  'hong kong': 'HK',
  'taipei': 'TW',
  'beijing': 'CN', 'shanghai': 'CN', 'shenzhen': 'CN', 'hangzhou': 'CN',
  'bangkok': 'TH',
  'manila': 'PH',
  'kuala lumpur': 'MY',
  'jakarta': 'ID',
  'ho chi minh city': 'VN', 'hanoi': 'VN',
  'auckland': 'NZ',
  'osaka': 'JP',
  // Middle East / Africa
  'tel aviv': 'IL', 'haifa': 'IL',
  'dubai': 'AE', 'abu dhabi': 'AE',
  'riyadh': 'SA',
  'cairo': 'EG',
  'lagos': 'NG',
  'nairobi': 'KE',
  'johannesburg': 'ZA', 'cape town': 'ZA',
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

/** ISO-3166 alpha-2 codes that ALSO collide with US state codes. When
 *  we see one of these as a comma-anchored 2-letter token and the
 *  listing has another signal pointing to the matching country (via
 *  COUNTRY_PATTERNS or CITY_TO_COUNTRY), we should NOT also tag US.
 *  Schema.org JobPosting `addressCountry` frequently uses ISO codes,
 *  so "Bengaluru, KA, IN" used to get flagged as Indiana → US. */
const STATE_VS_COUNTRY_AMBIGUITY: Record<string, string> = {
  IN: 'IN', // Indiana (US) vs India
  AL: 'AL', // Alabama (US) vs Albania
  AR: 'AR', // Arkansas (US) vs Argentina
  GA: 'GA', // Georgia (US state) vs Georgia (country)
  ID: 'ID', // Idaho (US) vs Indonesia
  MD: 'MD', // Maryland (US) vs Moldova
  NE: 'NE', // Nebraska (US) vs Niger
  CO: 'CO', // Colorado (US) vs Colombia
  CA: 'CA', // California (US state) vs Canada (already special-cased)
  PA: 'PA', // Pennsylvania (US) vs Panama
  DE: 'DE', // Delaware (US) vs Germany
  IL: 'IL', // Illinois (US) vs Israel
  AT: 'AT', // (no US state at this code, but Austria's ISO is AT) — kept for completeness
  KR: 'KR', // (no US state collision; safe no-op)
};

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

  // 1a. Regional buckets (LATAM / EMEA / APAC / EU). These need to run
  // before the per-country pass so we don't accidentally also tag
  // "South America - Remote" as something else via the substring tables.
  for (const { code, phrases } of REGION_PATTERNS) {
    for (const p of phrases) {
      if (lc.includes(p)) {
        found.add(code);
        break;
      }
    }
  }

  // 1b. Explicit country names / abbreviations. We use word-boundary
  // regex (not raw substring) so 'india' doesn't match "Indianapolis"
  // and 'spain' doesn't match "spaint". Phrases containing punctuation
  // or leading/trailing spaces are treated as literal-anchor patterns
  // (the author already encoded their own anchoring in the phrase).
  for (const { code, phrases } of COUNTRY_PATTERNS) {
    for (const p of phrases) {
      const isLiteralAnchored = /[\s,\-.]/.test(p);
      let hit = false;
      if (isLiteralAnchored) {
        hit = lc.includes(p);
      } else {
        // Word-boundary match. Escape regex metacharacters defensively.
        const esc = p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        hit = new RegExp(`\\b${esc}\\b`, 'i').test(lc);
      }
      if (hit) {
        found.add(code);
        break;
      }
    }
  }

  // 2. Well-known cities. We run this BEFORE state-code interpretation
  // so cities like "Bengaluru" / "Toronto" register their country first,
  // letting the state-code pass disambiguate the IN / CA / GA / AR codes
  // that collide with US state abbreviations.
  for (const [city, code] of Object.entries(CITY_TO_COUNTRY)) {
    if (lc.includes(` ${city} `) || lc.includes(`${city},`) || lc.includes(`,${city}`)) {
      found.add(code);
    }
  }

  // 3. State / province codes after a comma. ", WA" → US, ", ON" → CA.
  // We use the original-cased text for these so we don't false-match
  // " ca " (California) — that path stays in COUNTRY_PATTERNS where
  // it's already gated on whitespace.
  //
  // For codes that collide with ISO country codes (IN = Indiana / India,
  // AR = Arkansas / Argentina, etc.), we skip the US-state interpretation
  // when the location already named the matching country via patterns or
  // a known city. That prevents "Bengaluru, KA, IN" from being tagged
  // as Indiana → US just because the schema.org block uses ISO codes.
  const stateMatches = location.match(/,\s*([A-Z]{2})\b/g);
  if (stateMatches) {
    for (const m of stateMatches) {
      const code = m.replace(/[,\s]/g, '');
      const ambigCountry = STATE_VS_COUNTRY_AMBIGUITY[code];
      if (ambigCountry && found.has(ambigCountry)) {
        // The other country already won via a stronger signal — don't
        // also tag US.
        continue;
      }
      if (US_STATES.has(code)) found.add('US');
      else if (CA_PROVINCES.has(code)) found.add('CA');
    }
  }

  return found;
}

// ─── Filter ──────────────────────────────────────────────────────────

/** Markers that indicate an "anywhere / unspecified country" listing —
 *  remote roles with no country tag should keep passing the filter (it's
 *  better to surface them and let the user decide than to silently hide
 *  them). Anchored with word boundaries to avoid matching "remotely" etc.
 *  in body text, but the location field is short so collisions are rare. */
const ANYWHERE_MARKERS = /\b(remote|anywhere|virtual|work from home|wfh|distributed)\b/i;

/** Regional buckets that name a continent / multi-country area without
 *  naming a specific country. These are NOT countries — they map to a
 *  synthetic region code that will never appear in a user's auth list,
 *  so the listing is correctly classified as "not US-authorized" rather
 *  than slipping through the anywhere-marker branch via the trailing
 *  "Remote" word. Example: "South America - Remote" → REGION-LATAM,
 *  not US. */
const REGION_PATTERNS: { code: string; phrases: string[] }[] = [
  // LATAM / EMEA / APAC are unambiguous acronyms — safe to match bare
  // since no English word contains them as a substring. EU needs
  // anchoring (it appears inside "europe", "euro", etc.).
  { code: 'REGION-LATAM', phrases: ['latin america', 'south america', 'latam'] },
  { code: 'REGION-EMEA',  phrases: ['emea'] },
  { code: 'REGION-APAC',  phrases: ['apac', 'asia pacific', 'asia-pacific'] },
  { code: 'REGION-EU',    phrases: [' eu ', ', eu', 'eu-', '-eu', 'european union'] },
];

/**
 * Returns true if the listing's location is compatible with the user's
 * authorization. Specifically:
 *   - If we detect any country → must overlap with auth list.
 *   - If we detect NO country AND the location is empty / explicitly
 *     "Remote" / "Anywhere" → keep (unknown bucket — trust the user).
 *   - If we detect NO country but the location is a non-empty, non-remote
 *     string we don't recognize → DROP. Previously this returned true,
 *     which silently passed every unknown-country city (e.g. "Lagos",
 *     "Helsinki") through a US-only filter. With the expanded alias
 *     tables above, anything legitimate is now recognized; what's left
 *     is either a typo or a country we don't have an entry for, and the
 *     safer default is to hide it.
 */
export function isWorkAuthorized(
  location: string | null | undefined,
  authorizedCountries: string[],
): boolean {
  // Empty auth list shouldn't accidentally hide everything — fall back
  // to the legacy "show everything" behavior.
  if (!authorizedCountries || authorizedCountries.length === 0) return true;

  // Empty / missing location → can't filter, trust the user.
  if (!location || !location.trim()) return true;

  const detected = detectCountries(location);
  if (detected.size > 0) {
    for (const c of detected) {
      if (authorizedCountries.includes(c)) return true;
    }
    return false;
  }

  // No country signal. Pass only when the listing is explicitly
  // remote / anywhere (the typical "we couldn't tell because the role
  // has no country" case). Bare unknown city names get dropped.
  return ANYWHERE_MARKERS.test(location);
}

// ─── Visa-sponsorship signal in JD body ──────────────────────────────

/** Phrases that signal the employer will NOT sponsor work visas.
 *  Detected on the JD body (not just location), since this is where
 *  companies put the sponsorship policy. */
const NO_SPONSORSHIP_PATTERNS: RegExp[] = [
  // "unable to sponsor", "cannot offer visa sponsorship", etc.
  // visa(s) and sponsorship(s) both supported via optional suffix groups
  // so we catch the plural forms employers commonly use.
  /\b(?:unable|not\s+able|cannot|can[' ]t|do\s+not|will\s+not|don[' ]t|won[' ]t)\s+(?:to\s+)?(?:offer|provide|sponsor)\b[^.]{0,40}\b(?:visas?|sponsorship|work\s+authorization)\b/i,
  /\b(?:no|without)\s+(?:visa\s+)?sponsorship\b/i,
  /\bmust\s+be\s+(?:authorized|legally\s+authorized|eligible)\s+to\s+work\b[^.]{0,80}\bwithout\s+sponsorship\b/i,
  /\bnot\s+(?:currently\s+)?(?:offering|providing|sponsoring)\s+(?:work\s+)?visas?\b/i,
  /\bsponsorship\s+is\s+not\s+(?:available|offered|provided)\b/i,
  /\bwe\s+do\s+not\s+sponsor\b/i,
];

/**
 * Returns true if the job description body indicates the employer will
 * NOT sponsor a work visa. Callers can combine this with the user's
 * `needsVisaSponsorship` setting to drop incompatible listings.
 *
 * Intentionally conservative — only fires on clear, unambiguous phrases.
 * A vague "must be authorized to work in the US" is NOT a no-sponsorship
 * signal on its own (could still be sponsored for a transfer); we require
 * the explicit negation.
 */
export function jdRejectsSponsorship(jdText: string | null | undefined): boolean {
  if (!jdText) return false;
  // The JD can be large — only scan the first ~8KB where employers
  // typically put requirements/eligibility blocks.
  const slice = jdText.slice(0, 8000);
  for (const re of NO_SPONSORSHIP_PATTERNS) {
    if (re.test(slice)) return true;
  }
  return false;
}
