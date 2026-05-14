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

/** One resume the user has uploaded. Multiple resume variants are
 *  supported so a user can keep e.g. an EM-track resume, an IC-track
 *  resume, and an early-career resume side-by-side and switch the
 *  active one per session.
 *
 *  Storage:
 *    - On-disk file: `data/resume/<id>.docx` (or .pdf)
 *    - `text` is the extracted plain-text version (used for ATS scoring)
 *    - `id` is opaque to the UI — generated on upload.
 *
 *  The single-resume legacy fields (`baseResumeFileName`,
 *  `baseResumeText`) remain for back-compat; readers should prefer
 *  the active entry in `resumes[]` when both are present. Migration
 *  in `db.ts` lifts a legacy single resume into a single-item
 *  `resumes` array transparently. */
export interface Resume {
  id: string;
  /** Human-friendly label (e.g. "EM track", "Staff IC"). */
  name: string;
  /** Original filename the user uploaded. */
  fileName: string;
  /** Extracted plain-text — the ATS-scorable form. */
  text: string;
  /** ISO timestamp of the upload. */
  addedAt: string;
}

export interface Settings {
  /** Legacy single-resume filename. Mirrors the active resume's
   *  `fileName` after migration so code that still reads this works.
   *  Prefer `resumes` + `activeResumeId`. */
  baseResumeFileName: string | null;
  /** Legacy single-resume extracted text. Mirrors the active
   *  resume's `text` after migration. Prefer `resumes` + `activeResumeId`. */
  baseResumeText: string | null;
  /** Library of resume variants. Empty on fresh install — onboarding
   *  populates it from the uploaded file. */
  resumes?: Resume[];
  /** ID of the resume currently in use for scoring + tailoring.
   *  Always points at one of `resumes[].id` when `resumes` is
   *  non-empty. Switching this wipes the score cache (cached scores
   *  were computed against the previous active resume). */
  activeResumeId?: string;
  /** User-saved cover-letter templates. Generated cover letters can
   *  be promoted to templates via the cover-letter pane's 'Save as
   *  template' button; templates show up in the listing detail's
   *  'Load template' picker so the user can clone-then-edit a
   *  proven letter for similar roles. Plain text body — no variable
   *  interpolation yet (kept minimal until usage tells us what
   *  placeholders to support). */
  coverLetterTemplates?: CoverLetterTemplate[];
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

  // ─── Auto-refresh ───
  // When true, listings older than `autoRefreshHours` (default 24)
  // are refreshed automatically on the next listings-page load. The
  // streaming refresh runs in the background so the user can keep
  // browsing the existing dataset while new jobs come in.
  autoRefreshEnabled?: boolean;
  autoRefreshHours?: number;

  // ─── Auto-reminders ───
  // When a listing's flag becomes 'applied', the listing-flags
  // route auto-creates a reminder `applyFollowupDays` days from
  // now (default 14) labeled 'Follow up with recruiter'. Set to 0
  // to disable. Existing auto-applied reminders for the same
  // listing aren't duplicated.
  applyFollowupDays?: number;

  // ─── User-curated custom company sources ───
  // Lives alongside the static `COMPANY_SOURCES` in src/lib/sources.ts.
  // The fetcher unions the two sets at runtime so users can add their
  // own niche company without editing source code or deploying.
  customSources?: CustomCompanySource[];

  // ─── Imported network (LinkedIn connections CSV) ───
  // The user uploads their LinkedIn "Connections.csv" export; we
  // parse the company column and store a flat name->[contacts] map
  // so the listings UI can surface "you know N people at this co".
  // Stored as a name-indexed lookup to keep the per-listing cost O(1).
  network?: NetworkContact[];
  networkUpdatedAt?: string;

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
  | 'eightfold'
  // SmartRecruiters Public Postings API (ServiceNow, HelloFresh,
  // Bosch, etc.). Endpoint:
  //   GET https://api.smartrecruiters.com/v1/companies/{slug}/postings
  // Returns { content: [{id, name, location, releasedDate, ...}], totalFound }
  // No auth required; up to 100 items per page via &limit=100&offset=N.
  | 'smartrecruiters';

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

/** A single LinkedIn connection imported from the user's
 *  Connections.csv export. We keep it minimal — just the fields
 *  we need to surface "you know N people at <Company>" on a
 *  listing card and let the user tap through to the LinkedIn URL. */
export interface NetworkContact {
  firstName: string;
  lastName: string;
  /** Company at time of export. Lowercased + trimmed for matching. */
  company: string;
  position?: string;
  url?: string;
  /** ISO date the connection was added (LinkedIn calls it "Connected On"). */
  connectedOn?: string;
}

/** A user-added company source. Lives in `Settings.customSources`
 *  and gets unioned with the static `COMPANY_SOURCES` whenever we
 *  need to fetch listings. The `addedByUser` flag distinguishes
 *  these in the Settings UI for delete/edit affordances. */
export interface CustomCompanySource extends CompanySource {
  addedByUser: true;
  addedAt: string;
}

export interface JobListing {
  id: string; // composite: `${ats}-${boardToken}-${sourceId}`
  sourceId: string; // original ID from the ATS
  company: string;
  companySlug: string;
  title: string;
  location: string;
  department: string;
  salary: string | null; // extracted from description (display string)
  salaryMin: number | null; // parsed number for filtering (base when both base+TC parsed, else best signal)
  salaryMax: number | null;
  // Optional structured breakdown — populated when the JD makes the
  // base-vs-TC distinction explicit (e.g. "Base salary: $X – $Y.
  // Total compensation: $A – $B."). Existing callers ignore these
  // safely; the salary chip + compare view render them when present.
  salaryBaseMin?: number | null;
  salaryBaseMax?: number | null;
  salaryTcMin?: number | null;
  salaryTcMax?: number | null;
  /** Free-form snippet — first equity / stock / RSU mention near the
   *  detected pay band. Not parsed into a number because postings vary
   *  too much. */
  salaryEquityHint?: string | null;
  /** Which extractor layer fired. Useful for the UI source-badge. */
  salarySource?: string | null;
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
export type ListingFlag =
  // ── Pipeline states ─────────────────────────────────────────────
  // The user's progress on a job they're actually pursuing. Rendered
  // as columns on the /pipeline Kanban page.
  | 'applied'
  | 'phone-screen'
  | 'interviewing'
  | 'offer'
  | 'rejected'
  // ── Triage tags ──────────────────────────────────────────────────
  // Used to filter noise out of the listings page; not pipeline
  // states. Listings with these tags are hidden by default.
  | 'incorrect'
  | 'not-applicable';

export interface ListingFlagEntry {
  listingId: string;
  flag: ListingFlag;
  flaggedAt: string;
}

/** A user-created reminder for a specific listing. Driven entirely
 *  client-side via Notification API + a polling effect — no email
 *  sending, no cron. Persists in `Database.reminders`. */
export interface Reminder {
  id: string;
  listingId: string;
  /** ISO timestamp the reminder should fire at. */
  dueAt: string;
  /** What the user typed when they set it ("Follow up with recruiter"). */
  note: string;
  /** Set when the reminder fires (or the user dismisses); reminders
   *  with `firedAt` set are no longer surfaced. */
  firedAt?: string;
  createdAt: string;
  /** How this reminder was created. Auto-created reminders (e.g.
   *  the follow-up scheduled when the user flags a listing as
   *  Applied) carry source='auto-applied' so we don't double-create
   *  them on subsequent flag changes. User-created reminders carry
   *  source='manual' or are left undefined for back-compat. */
  source?: 'manual' | 'auto-applied';
}

/**
 * Subset of `LISTING_FLAGS` that represent active pipeline progress
 * (applied → phone-screen → interviewing → offer → rejected). The
 * Kanban page renders one column per entry here, in order.
 */
export const PIPELINE_FLAGS: { key: ListingFlag; label: string; color: string; short: string }[] = [
  // Softened palette harmonized with the indigo-violet primary —
  // each stage shifts down the cool spectrum (indigo → sky → cyan
  // → emerald) and only the terminal "rejected" state borrows a
  // warm tone (rose). Previously the colors used the bright 500
  // shade across the board which felt loud against the new warm
  // off-white background.
  { key: 'applied',       label: 'Applied',       color: '#818CF8', short: 'Applied' },   // indigo-400
  { key: 'phone-screen',  label: 'Phone Screen',  color: '#38BDF8', short: 'Screen' },    // sky-400
  { key: 'interviewing',  label: 'Interviewing',  color: '#06B6D4', short: 'Interview' }, // cyan-500
  { key: 'offer',         label: 'Offer',         color: '#34D399', short: 'Offer' },     // emerald-400
  { key: 'rejected',      label: 'Rejected',      color: '#FB7185', short: 'Rejected' },  // rose-400
];

export const LISTING_FLAGS: { key: ListingFlag; label: string; color: string; short: string }[] = [
  ...PIPELINE_FLAGS,
  { key: 'incorrect',      label: 'Incorrect Job', color: '#FB923C', short: 'Incorrect' }, // orange-400
  { key: 'not-applicable', label: 'Not Applicable', color: '#94A3B8', short: 'N/A' },      // slate-400
];

export interface ScoreCacheEntry {
  listingId: string;
  overall: number;
  technical: number;
  management: number;
  domain: number;
  soft: number;
  /** v3: JD-extracted bigram-phrase coverage. Optional for back-compat
   *  with v2 entries that haven't been recomputed yet. */
  phrases?: number;
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
   *   3 — adds JD-extracted bigram phrases as a 5th category (15%
   *       weight) so resumes that mirror the JD's distinctive
   *       multi-word language ("agent foundations", "data plane")
   *       score above resumes that share only generic skills.
   */
  scorerVersion?: number;
}

/** Current ATS scorer version. See `ScoreCacheEntry.scorerVersion`. */
export const SCORER_VERSION = 3;

export interface Database {
  settings: Settings;
  jobs: Job[];
  listingsCache: ListingsCache;
  scoreCache?: Record<string, ScoreCacheEntry>;
  listingFlags?: Record<string, ListingFlagEntry>;
  /** Per-listing reminders the user set on the Pipeline / listing
   *  detail page. Surfaced via the small bell badge on the top nav
   *  when one is overdue. */
  reminders?: Reminder[];
  /** Per-listing free-form notes — research, contact names, "why I
   *  passed" / "why I want this", anything the user wants to remember.
   *  Plain text (Markdown rendered on display). Keyed by listingId.
   *  Empty/whitespace-only strings are treated as "no note" and
   *  pruned at write time. */
  listingNotes?: Record<string, ListingNote>;
}

export interface CoverLetterTemplate {
  id: string;
  /** Short display label, e.g. 'EM short intro', 'Detailed EM'. */
  name: string;
  text: string;
  createdAt: string;
  updatedAt?: string;
}

export interface ListingNote {
  listingId: string;
  text: string;
  updatedAt: string;
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
