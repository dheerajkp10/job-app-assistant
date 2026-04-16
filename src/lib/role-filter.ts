import type { JobListing } from './types';

/**
 * Broad title patterns covering common tech job families.
 * Used as the FALLBACK when a user has no role preferences set.
 * Case-insensitive matching.
 */
const DEFAULT_TECH_PATTERNS: RegExp[] = [
  // --- Software Engineering ---
  /software\s*engineer/i,
  /software\s*developer/i,
  /\bsde\b/i, // Amazon-style "SDE"
  /full[-\s]?stack\s*(engineer|developer)/i,
  /frontend\s*(engineer|developer)/i,
  /backend\s*(engineer|developer)/i,
  /web\s*developer/i,
  /mobile\s*(engineer|developer)/i,
  /\bios\s*(engineer|developer)/i,
  /android\s*(engineer|developer)/i,
  /platform\s*engineer/i,
  /systems?\s*engineer/i,
  /infrastructure\s*engineer/i,
  /cloud\s*engineer/i,
  /devops\s*engineer/i,
  /site\s*reliability\s*engineer/i,
  /\bsre\b/i,
  /security\s*engineer/i,
  /application\s*engineer/i,

  // --- Data & ML ---
  /data\s*scientist/i,
  /data\s*engineer/i,
  /data\s*analyst/i,
  /machine\s*learning\s*engineer/i,
  /\bml\s*engineer/i,
  /\bai\s*engineer/i,
  /research\s*(scientist|engineer)/i,
  /applied\s*scientist/i,

  // --- Product Management ---
  /product\s*manager/i,
  /\bpm\b.*(?:technical|product|software)/i,
  /technical\s*product\s*manager/i,

  // --- Program / Project Management ---
  /program\s*manager/i,
  /technical\s*program\s*manager/i,
  /\btpm\b/i,
  /project\s*manager/i,

  // --- Engineering Management ---
  /engineering\s*manager/i,
  /software\s*development\s*manager/i,
  /software\s*engineering\s*manager/i,
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
  // Only match "development manager" when preceded by an engineering-flavored noun --
  // avoids "Business Development Manager", "Corporate Development Manager", etc.
  /(software|engineering|platform|application|product\s*engineering|web|mobile|systems?|infrastructure|backend|frontend|full[-\s]?stack|cloud|data)\s*development\s*manager/i,
  /technical\s*manager/i,
  /head\s*of\s*engineering/i,
  /director.*engineering/i,
  /engineering\s*lead/i,

  // --- Design & UX (tech-adjacent) ---
  /ux\s*(designer|researcher|engineer)/i,
  /product\s*designer/i,

  // --- QA & Test ---
  /qa\s*engineer/i,
  /quality\s*engineer/i,
  /test\s*engineer/i,
  /\bsdet\b/i,

  // --- Solutions / Sales Engineering ---
  /solutions?\s*(architect|engineer)/i,
  /sales\s*engineer/i,
  /technical\s*account\s*manager/i,
];

/**
 * Title patterns to EXCLUDE -- clearly non-tech roles.
 * Applied only when filtering with the broad DEFAULT_TECH_PATTERNS fallback,
 * NOT when the user has explicitly chosen their preferred roles.
 */
const EXCLUDE_PATTERNS: RegExp[] = [
  // --- Business / Corporate ---
  /general\s*manager/i,
  /business\s*manager/i,
  /business\s*development\s*manager/i,
  /corporate\s*development\s*manager/i,
  /partner(ship)?s?\s*manager/i,
  /growth\s*manager/i,

  // --- Marketing / Sales / Account ---
  /marketing\s*manager/i,
  /sales\s*manager/i,
  /account\s*manager/i,

  // --- Operations / Facilities ---
  /operations\s*manager/i,
  /office\s*manager/i,
  /facilities\s*manager/i,

  // --- HR / People / Recruiting ---
  /hr\s*manager/i,
  /people\s*manager/i,
  /recruiting\s*manager/i,
  /talent\s*manager/i,

  // --- Finance / Legal ---
  /finance\s*manager/i,
  /legal\s*manager/i,

  // --- Customer / Community / Content ---
  /customer\s*(success|support)\s*manager/i,
  /community\s*manager/i,
  /content\s*manager/i,

  // --- Junior / Internship ---
  /\bintern\b/i,
  /\bstudent\b/i,
];

/**
 * Filter listings to tech-relevant roles using the broad default patterns.
 * Used as the fallback when no user preferences are set.
 */
export function filterDefaultTechRoles(listings: JobListing[]): JobListing[] {
  return listings.filter((listing) => {
    const title = listing.title;

    // Must match at least one default tech pattern
    const matchesTech = DEFAULT_TECH_PATTERNS.some((p) => p.test(title));
    if (!matchesTech) return false;

    // Must NOT match any non-tech exclusion pattern
    const matchesExclude = EXCLUDE_PATTERNS.some((p) => p.test(title));
    if (matchesExclude) return false;

    return true;
  });
}

/**
 * Backwards-compatible alias -- callers that imported the old name still work.
 * @deprecated Use filterDefaultTechRoles instead.
 */
export const filterRelevantEMRoles = filterDefaultTechRoles;

/**
 * Build regex patterns from user-supplied role strings.
 * Each role becomes a case-insensitive substring match.
 */
function buildUserRolePatterns(roles: string[]): RegExp[] {
  return roles.map((role) => {
    // Escape regex special chars and create a case-insensitive pattern
    const escaped = role.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(escaped, 'i');
  });
}

/**
 * Filter listings by the user's preferred role titles.
 * Falls back to the broad default tech filter when no preferences are set.
 *
 * When the user HAS preferences, we trust their explicit choices and do NOT
 * apply the EXCLUDE_PATTERNS -- those exist only to keep the no-preference
 * fallback from surfacing clearly non-tech roles.
 */
export function filterByUserPreferences(
  listings: JobListing[],
  preferredRoles: string[],
): JobListing[] {
  if (!preferredRoles || preferredRoles.length === 0) {
    return filterDefaultTechRoles(listings);
  }

  const userPatterns = buildUserRolePatterns(preferredRoles);

  return listings.filter((listing) => {
    const title = listing.title;

    // Must match at least one user-selected role pattern
    const matchesRole = userPatterns.some((p) => p.test(title));
    return matchesRole;
  });
}
