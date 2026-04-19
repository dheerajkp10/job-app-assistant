/**
 * Current-employer detection + brand aliases.
 *
 * The listings page uses this to exclude jobs from the user's current
 * employer (and its sibling brands — e.g. "Amazon" and "AWS" are the
 * same employer, so picking one should hide both).
 *
 * Detection is resume-driven: we scan for the line(s) that end in
 * "Present" or "Current" and look for a recognized brand name nearby.
 * If the resume is missing or doesn't mention a known brand, nothing is
 * excluded.
 */

export interface CompanyAliasGroup {
  canonical: string;     // Display name used when reporting the current employer.
  aliases: string[];     // All names treated as "the same employer" for filtering.
}

/**
 * Groups of brand names that share an employer. Add entries conservatively:
 * only list brands a user would confidently consider "the same company"
 * (subsidiaries, cloud arms, rebrands). Sibling-but-separate brands
 * (e.g. Microsoft ↔ GitHub) are intentionally omitted — applying to one
 * from the other is still a real move.
 */
export const COMPANY_ALIAS_GROUPS: CompanyAliasGroup[] = [
  {
    canonical: 'Amazon',
    aliases: [
      'Amazon', 'AWS', 'Amazon Web Services', 'Amazon.com',
      'A9', 'Audible', 'Ring', 'Twitch', 'Whole Foods', 'Zappos',
    ],
  },
  {
    canonical: 'Google',
    aliases: [
      'Google', 'Alphabet', 'YouTube', 'Google Cloud', 'GCP',
      'Waymo', 'Verily', 'DeepMind',
    ],
  },
  {
    canonical: 'Meta',
    aliases: ['Meta', 'Facebook', 'Instagram', 'WhatsApp', 'Oculus', 'Reality Labs'],
  },
  {
    canonical: 'Microsoft',
    aliases: ['Microsoft', 'MSFT', 'Microsoft Corporation'],
  },
  {
    canonical: 'Apple',
    aliases: ['Apple', 'Apple Inc', 'Apple Inc.'],
  },
  {
    canonical: 'Salesforce',
    aliases: ['Salesforce', 'Salesforce.com', 'Slack', 'Tableau', 'MuleSoft', 'Mulesoft', 'Heroku'],
  },
  {
    canonical: 'Uber',
    aliases: ['Uber', 'Uber Technologies'],
  },
];

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Return all lowercased names that should be treated as the same employer
 * as `name`. If `name` isn't a known brand, returns `[lowercased(name)]`
 * so callers still get a correct single-brand exclusion set.
 */
export function getCompanyAliases(name: string): string[] {
  const norm = name.trim().toLowerCase();
  if (!norm) return [];
  for (const { aliases } of COMPANY_ALIAS_GROUPS) {
    if (aliases.some((a) => a.toLowerCase() === norm)) {
      return aliases.map((a) => a.toLowerCase());
    }
  }
  return [norm];
}

/**
 * True if `listingCompany` names an employer in `excludedAliases`
 * (case-insensitive, substring-safe). Substring match handles cases like
 * listings labelled "Amazon (AWS)" or "Google Cloud Platform" — we want
 * those to match the "amazon" / "google" alias sets.
 */
export function isExcludedCompany(
  listingCompany: string,
  excludedAliases: string[],
): boolean {
  if (excludedAliases.length === 0) return false;
  const hay = listingCompany.toLowerCase();
  return excludedAliases.some((a) => {
    if (!a) return false;
    // Use a word-boundary match so "google" doesn't match "googlebot"
    // but still matches "Google Cloud" and "Google, Inc.".
    const re = new RegExp(`\\b${escapeRegex(a)}\\b`, 'i');
    return re.test(hay);
  });
}

/**
 * Scan resume text for the user's current employer.
 *
 * Three-stage fallback:
 *  1. Lines containing a "still here" marker — Present / Current / Now /
 *     Today / Ongoing / Till Date — with a known brand within ±3 lines.
 *  2. Lines that end with a recent year (last 3 years) suggesting an open
 *     end-date, with a brand within ±3 lines.
 *  3. As a last resort, the first known brand that appears in the first
 *     60 non-empty lines (experience sections are almost always near the
 *     top and the first role listed is almost always the current one).
 *
 * Longer aliases win over shorter ones ("Amazon Web Services" > "Amazon").
 * Returns the canonical brand name (e.g. "Amazon"), or null if nothing
 * recognizable is found.
 */
export function detectCurrentCompany(resumeText: string | null | undefined): string | null {
  if (!resumeText) return null;
  const lines = resumeText.split(/\r?\n/).map((l) => l.trim());

  const allBrands = COMPANY_ALIAS_GROUPS.flatMap(({ canonical, aliases }) =>
    aliases.map((alias) => ({ canonical, alias: alias.toLowerCase() })),
  );
  // Longer aliases first so "Amazon Web Services" beats "Amazon".
  allBrands.sort((a, b) => b.alias.length - a.alias.length);

  const findBrandIn = (text: string): string | null => {
    const hay = text.toLowerCase();
    for (const { canonical, alias } of allBrands) {
      const re = new RegExp(`\\b${escapeRegex(alias)}\\b`, 'i');
      if (re.test(hay)) return canonical;
    }
    return null;
  };

  const windowAround = (i: number): string =>
    [lines[i - 3] || '', lines[i - 2] || '', lines[i - 1] || '', lines[i], lines[i + 1] || '', lines[i + 2] || '']
      .join(' ');

  // Stage 1: classic end-date markers.
  const PRESENT_RE = /\b(present|current|currently|now|today|ongoing|till date|to date)\b/i;
  for (let i = 0; i < lines.length; i++) {
    if (!PRESENT_RE.test(lines[i])) continue;
    const match = findBrandIn(windowAround(i));
    if (match) return match;
  }

  // Stage 2: open-ended date ranges ending with a recent year (last 3 years).
  const thisYear = new Date().getFullYear();
  const recentYears = [thisYear, thisYear - 1, thisYear - 2];
  // Matches "Jan 2020 - 2024", "2021 – 2024", "2024 -", "2024 –"
  const OPEN_RANGE_RE = new RegExp(
    `[–—-]\\s*(?:${recentYears.join('|')})\\b\\s*$|[–—-]\\s*$`,
  );
  for (let i = 0; i < lines.length; i++) {
    if (!OPEN_RANGE_RE.test(lines[i])) continue;
    const match = findBrandIn(windowAround(i));
    if (match) return match;
  }

  // Stage 3: just pick the first known brand near the top of the resume.
  // Most resumes list the current role first under "Experience".
  const topLines = lines.filter(Boolean).slice(0, 60).join(' ');
  return findBrandIn(topLines);
}
