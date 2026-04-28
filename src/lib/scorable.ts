import type { ATSType } from './types';

/**
 * True if this listing's ATS doesn't expose a per-job detail endpoint.
 * These are careers APIs where we only get a title/location in the list
 * response — not enough signal for a meaningful ATS keyword score.
 * Kept as a client-safe pure predicate so both server routes and React
 * components can import it without pulling in Node-only fetchers.
 */
export function isUnscorableAts(ats: ATSType): boolean {
  // Apple and Uber are scorable: fetchJobDetail() pulls the full JD
  // for each (Apple via Puppeteer, Uber via embedded JSON on the
  // single-job page), so ATS scoring + tailoring work for both.
  return (
    ats === 'google' ||
    ats === 'microsoft' ||
    ats === 'amazon' ||
    ats === 'meta' ||
    ats === 'workday'
  );
}
