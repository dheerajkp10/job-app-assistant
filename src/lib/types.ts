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
  preferredLocations: string[];       // e.g. ["Seattle, WA", "San Francisco, CA"]
  workMode: WorkMode[];               // multi-select
  salaryMin: number | null;           // annual, e.g. 200000
  salaryMax: number | null;           // annual, e.g. 350000
  onboardingComplete: boolean;        // gate for landing page
}

// --- Job Listings (auto-fetched from company career pages) ---

export type ATSType = 'greenhouse' | 'lever' | 'ashby';

export interface CompanySource {
  name: string;
  slug: string;
  ats: ATSType;
  boardToken: string;
  logoColor: string; // for UI badge
  region?: string; // e.g. "Seattle", "SF Bay Area"
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
 * - incorrect:     the title/category isn't actually an EM role (or otherwise mislabeled).
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
}

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
