import type { ATSType } from './types';

/**
 * True if this listing's ATS doesn't expose a per-job detail endpoint.
 * These are careers APIs where we only get a title/location in the list
 * response — not enough signal for a meaningful ATS keyword score.
 * Kept as a client-safe pure predicate so both server routes and React
 * components can import it without pulling in Node-only fetchers.
 */
export function isUnscorableAts(ats: ATSType): boolean {
  // Scorable: greenhouse, lever, ashby, eightfold, apple (via
  // Puppeteer), uber (via single-job-page scrape), AND google (the
  // SSR-embedded payload from the new careers site contains the
  // full description; fetchGoogleJobs caches it to disk during the
  // list pass, so fetchJobDetail can read it back without a second
  // HTTP call).
  return (
    ats === 'microsoft' ||
    ats === 'amazon' ||
    ats === 'meta' ||
    ats === 'workday'
  );
}
