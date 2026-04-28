export type JobPortal = 'linkedin' | 'glassdoor' | 'indeed' | 'company';

export type JobStatus = 'new' | 'applied' | 'interviewing' | 'offer' | 'rejected' | 'archived';

export interface Job {
  id: string;
  portal: JobPortal;
  companyName: string;
  jobTitle: string;
  location: string;
  jobUrl: string | null;
  description: string;
  status: JobStatus;
  notes: string;
  dateAdded: string; // ISO timestamp
}

export type WorkMode = 'remote' | 'hybrid' | 'onsite';

export interface Settings {
  baseResumeFileName: string | null;
  baseResumeText: string | null;
  userName: string;

  // ─── User preferences (set during onboarding) ───
  preferredRoles: string[];           // e.g. ["Engineering Manager", "Software Dev Manager"]
  preferredLevels: string[];          // e.g. ["L6 / EM / Senior Manager", "L5 / Senior SDE"]
  preferredLocations: string[];       // e.g. ["Seattle, WA", "San Francisco, CA"]
  workMode: WorkMode[];               // multi-select
  salaryMin: number | null;           // annual total comp min, e.g. 200000
  salaryMax: number | null;           // annual total comp max, e.g. 350000
  salaryBaseMin: number | null;       // base salary min (optional breakdown)
  salaryBaseMax: number | null;       // base salary max
  salaryBonusMin: number | null;      // target bonus min (annual)
  salaryBonusMax: number | null;      // target bonus max
  salaryEquityMin: number | null;     // RSU / stock grant annualized min
  salaryEquityMax: number | null;     // RSU / stock grant annualized max
  salarySkipped: boolean;             // user chose to skip salary step
  onboardingComplete: boolean;        // gate for landing page

  // ─── Employer filters ───
  // Companies to hide from listings (the user's current/previous employers
  // they don't want to see). Stored as canonical brand names (e.g. "Amazon",
  // "Google") — siblings are expanded at filter time via COMPANY_ALIAS_GROUPS.
  excludedCompanies?: string[];

  // ─── Work authorization ───
  // ISO-3166 alpha-2 country codes the user is authorized to work in.
  // Defaults to ["US"] when missing (legacy users predate this field).
  // Listings whose location is exclusively in a country NOT in this list
  // (e.g. "Remote — Canada" for a US-only user) are filtered out — we
  // can't honestly recommend a job the user couldn't legally take.
  // Choosing multiple codes (e.g. ["US","CA"]) opens up roles in any of
  // those countries.
  workAuthCountries?: string[];
}

/**
 * Country options offered in onboarding for the "where can you legally
 * work" picker. Curated list — covers the main English-speaking job
 * markets we currently fetch listings from. We deliberately keep it
 * short rather than exposing the full ISO-3166 set so the choice stays
 * meaningful.
 */
export const WORK_AUTH_COUNTRIES: { code: string; label: string }[] = [
  { code: 'US', label: 'United States' },
  { code: 'CA', label: 'Canada' },
  { code: 'GB', label: 'United Kingdom' },
  { code: 'IE', label: 'Ireland' },
  { code: 'DE', label: 'Germany' },
  { code: 'FR', label: 'France' },
  { code: 'NL', label: 'Netherlands' },
  { code: 'AU', label: 'Australia' },
  { code: 'NZ', label: 'New Zealand' },
  { code: 'IN', label: 'India' },
  { code: 'SG', label: 'Singapore' },
  { code: 'JP', label: 'Japan' },
];

/**
 * Cross-company level ladder. Each entry groups roughly-equivalent titles
 * across tech companies so the user can express level preferences without
 * picking a specific firm's ladder.
 */
export const LEVEL_TIERS: { key: string; label: string; examples: string }[] = [
  { key: 'entry',      label: 'Entry / New Grad',       examples: 'SDE1 · L3 · E3 · Associate' },
  { key: 'mid',        label: 'Mid-level',              examples: 'SDE2 · L4 · E4 · Engineer II · PM' },
  { key: 'senior',     label: 'Senior',                 examples: 'Senior SDE · L5 · E5 · Senior PM' },
  { key: 'staff',      label: 'Staff / Principal IC',   examples: 'Staff · Principal · L6/L7 · E6/E7' },
  { key: 'distinguished', label: 'Distinguished / Sr. Principal', examples: 'Sr. Principal · L8 · Distinguished' },
  { key: 'em1',        label: 'Manager / EM1',          examples: 'Manager · EM1 · L6 Mgr · M1' },
  { key: 'em2',        label: 'Sr. Manager / EM2',      examples: 'Sr. Manager · EM2 · L7 Mgr · M2' },
  { key: 'director',   label: 'Director',               examples: 'Director · L8 · D1' },
  { key: 'sr-director', label: 'Senior Director',       examples: 'Sr. Director · L9 · D2' },
  { key: 'vp',         label: 'VP / GM',                examples: 'VP · General Manager · L10' },
];

// --- Job Listings (auto-fetched from company career pages) ---

export type ATSType =
  | 'greenhouse'
  | 'lever'
  | 'ashby'
  // Custom per-company APIs (scraped directly from each careers page).
  | 'google'
  | 'apple'
  | 'microsoft'
  | 'amazon'
  | 'meta'
  | 'uber'
  | 'workday'
  // Eightfold AI careers platform (Netflix, many others). Exposes a
  // public JSON API that returns full job descriptions, so we can both
  // list AND score these roles.
  | 'eightfold';

export interface CompanySource {
  name: string;
  slug: string;
  ats: ATSType;
  boardToken: string;
  logoColor: string; // for UI badge
  region?: string; // e.g. "Seattle", "SF Bay Area"
  // Workday-specific configuration.
  // Host example: "salesforce.wd12.myworkdayjobs.com"
  // Site example: "External_Career_Site"
  workdayHost?: string;
  workdaySite?: string;
  // Eightfold-specific configuration.
  // host example: "explore.jobs.netflix.net"
  // domain example: "netflix.com"
  eightfoldHost?: string;
  eightfoldDomain?: string;
}

export interface JobListing {
  id: string; // composite: `${ats}-${boardToken}-${sourceId}`
  sourceId: string; // original ID from the ATS
  company: string;
  companySlug: string;
  title: string;
  location: string;
  department: string;
  salary: string | null; // extracted from description
  salaryMin: number | null; // parsed number for filtering
  salaryMax: number | null;
  url: string; // direct link to apply
  ats: ATSType;
  postedAt: string | null;
  updatedAt: string | null;
  fetchedAt: string;
}

export interface JobListingDetail extends JobListing {
  content: string; // full HTML content
  qualifications: string[];
  responsibilities: string[];
}

export interface ListingsCache {
  listings: JobListing[];
  lastFetchedAt: string | null;
  fetchErrors: { company: string; error: string }[];
}

/**
 * User-set flag on an auto-fetched JobListing.
 * - applied:       user has applied externally and wants it marked.
 * - incorrect:     the title/category isn't actually a matching role (or otherwise mislabeled).
 * - not-applicable: user reviewed and isn't interested.
 * Flagged listings are hidden from the default view but can be revealed via a toggle.
 */
export type ListingFlag = 'applied' | 'incorrect' | 'not-applicable';

export interface ListingFlagEntry {
  listingId: string;
  flag: ListingFlag;
  flaggedAt: string;
}

export const LISTING_FLAGS: { key: ListingFlag; label: string; color: string; short: string }[] = [
  { key: 'applied', label: 'Already Applied', color: '#8B5CF6', short: 'Applied' },
  { key: 'incorrect', label: 'Incorrect Job', color: '#EF4444', short: 'Incorrect' },
  { key: 'not-applicable', label: 'Not Applicable', color: '#6B7280', short: 'N/A' },
];

export interface ScoreCacheEntry {
  listingId: string;
  overall: number;
  technical: number;
  management: number;
  domain: number;
  soft: number;
  matchedCount: number;
  totalCount: number;
  scoredAt: string;
  /**
   * Algorithm version this entry was scored under. Bumped whenever the
   * scorer's output changes meaningfully (formula, weights, smoothing
   * constants) so the cache layer can detect "this entry was computed
   * with an old algorithm" and force a rescore.
   *
   * History:
   *   1 — original linear `matched/total` per-category, equal weights.
   *   2 — TF-weighted JD keywords + Laplace smoothing + [25,95] clamp.
   */
  scorerVersion?: number;
}

/** Current ATS scorer version. See `ScoreCacheEntry.scorerVersion`. */
export const SCORER_VERSION = 2;

export interface Database {
  settings: Settings;
  jobs: Job[];
  listingsCache: ListingsCache;
  scoreCache?: Record<string, ScoreCacheEntry>;
  listingFlags?: Record<string, ListingFlagEntry>;
}

// --- Portal search links (for LinkedIn, Indeed, Glassdoor) ---

export interface PortalSearchLink {
  portal: string;
  label: string;
  color: string;
  searchUrl: string;
}

export const PORTAL_SEARCH_LINKS: PortalSearchLink[] = [
  {
    portal: 'linkedin',
    label: 'LinkedIn',
    color: '#0A66C2',
    searchUrl: 'https://www.linkedin.com/jobs/search/?keywords=engineering%20manager&location=Seattle%2C%20WA&f_TPR=r604800&f_SB2=4',
  },
  {
    portal: 'indeed',
    label: 'Indeed',
    color: '#2164F3',
    searchUrl: 'https://www.indeed.com/jobs?q=engineering+manager+%24300%2C000&l=Seattle%2C+WA&fromage=14',
  },
  {
    portal: 'glassdoor',
    label: 'Glassdoor',
    color: '#0CAA41',
    searchUrl: 'https://www.glassdoor.com/Job/seattle-engineering-manager-jobs-SRCH_IL.0,7_IC1150505_KO8,27.htm',
  },
];

export const PORTALS: { key: JobPortal; label: string; color: string }[] = [
  { key: 'linkedin', label: 'LinkedIn', color: '#0A66C2' },
  { key: 'glassdoor', label: 'Glassdoor', color: '#0CAA41' },
  { key: 'indeed', label: 'Indeed', color: '#2164F3' },
  { key: 'company', label: 'Company Sites', color: '#6B7280' },
];

export const JOB_STATUSES: { key: JobStatus; label: string; color: string }[] = [
  { key: 'new', label: 'New', color: '#3B82F6' },
  { key: 'applied', label: 'Applied', color: '#8B5CF6' },
  { key: 'interviewing', label: 'Interviewing', color: '#F59E0B' },
  { key: 'offer', label: 'Offer', color: '#10B981' },
  { key: 'rejected', label: 'Rejected', color: '#EF4444' },
  { key: 'archived', label: 'Archived', color: '#6B7280' },
];
