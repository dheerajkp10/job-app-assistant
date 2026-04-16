import type { JobListing } from './types';

/**
 * Title patterns that match Engineering Manager level roles.
 * Case-insensitive matching.
 */
const EM_TITLE_PATTERNS: RegExp[] = [
  /engineering manager/i,
  /software development manager/i,
  /software engineering manager/i,
  /eng\s*manager/i,
  /manager,?\s*software/i,
  /manager,?\s*engineering/i,
  /manager,?\s*platform/i,
  /manager,?\s*infrastructure/i,
  /manager,?\s*backend/i,
  /manager,?\s*distributed/i,
  /manager,?\s*systems/i,
  /manager,?\s*data\s*platform/i,
  /manager,?\s*ml/i,
  /manager,?\s*machine\s*learning/i,
  /manager,?\s*ai\b/i,
  /manager,?\s*cloud/i,
  /manager,?\s*reliability/i,
  /manager,?\s*site\s*reliability/i,
  /manager,?\s*devops/i,
  /manager,?\s*developer\s*(platform|experience|tools)/i,
  /manager,?\s*full\s*stack/i,
  /manager,?\s*application/i,
  /manager,?\s*services/i,
  /\bdev\s+manager\b/i,
  // Only match "development manager" when preceded by an engineering-flavored noun —
  // avoids matching "Business Development Manager", "Corporate Development Manager", etc.
  /(software|engineering|platform|application|product\s*engineering|web|mobile|systems?|infrastructure|backend|frontend|full[-\s]?stack|cloud|data)\s*development\s*manager/i,
  /technical\s*manager/i,
  /head\s*of\s*engineering/i,
  /director.*engineering/i,
  /engineering\s*lead/i,
];

/**
 * Title patterns to EXCLUDE (too senior, too different, or non-engineering).
 */
const EXCLUDE_PATTERNS: RegExp[] = [
  /\bvp\b/i,
  /vice\s*president/i,
  /\bcto\b/i,
  /chief\s*technology/i,
  /\bintern\b/i,
  /\bstudent\b/i,
  /program\s*manager/i,
  /project\s*manager/i,
  /product\s*manager/i,
  /technical\s*program/i,
  /general\s*manager/i,
  /business\s*manager/i,
  /business\s*development\s*manager/i,
  /corporate\s*development\s*manager/i,
  /partner(ship)?s?\s*manager/i,
  /growth\s*manager/i,
  /marketing\s*manager/i,
  /sales\s*manager/i,
  /account\s*manager/i,
  /operations\s*manager/i,
  /office\s*manager/i,
  /customer\s*(success|support)\s*manager/i,
  /design\s*manager/i,
  /content\s*manager/i,
  /people\s*manager/i,
  /hr\s*manager/i,
  /finance\s*manager/i,
  /legal\s*manager/i,
  /facilities\s*manager/i,
  /recruiting\s*manager/i,
  /talent\s*manager/i,
  /community\s*manager/i,
];

/**
 * Filter listings to only EM-relevant roles.
 */
export function filterRelevantEMRoles(listings: JobListing[]): JobListing[] {
  return listings.filter((listing) => {
    const title = listing.title;

    // Must match at least one EM title pattern
    const matchesEM = EM_TITLE_PATTERNS.some((p) => p.test(title));
    if (!matchesEM) return false;

    // Must NOT match any exclusion pattern
    const matchesExclude = EXCLUDE_PATTERNS.some((p) => p.test(title));
    if (matchesExclude) return false;

    return true;
  });
}
