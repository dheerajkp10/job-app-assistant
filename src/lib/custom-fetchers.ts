/**
 * Custom per-company careers-page fetchers.
 *
 * Most tech giants (Google, Apple, Meta, Microsoft, Amazon, Uber, and
 * every Workday customer — Salesforce, Adobe, Visa, Expedia, DocuSign,
 * etc.) do NOT expose a public Greenhouse/Lever/Ashby board. They run
 * their own careers APIs. This file implements targeted clients for
 * each so we can actually pull their listings.
 *
 * Each fetcher:
 *   - Caps pagination at a reasonable max (we scan user preferences
 *     client-side; 1000 jobs per company is plenty to find matches).
 *   - Returns an empty array on parse failure rather than throwing —
 *     the dispatcher converts thrown errors into UI fetch-error rows.
 *   - Uses a 15s AbortSignal timeout per HTTP call.
 */

import type { CompanySource, JobListing } from './types';
import { extractSalary } from './salary-parser';

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';

const JSON_HEADERS = {
  'User-Agent': UA,
  Accept: 'application/json, text/plain, */*',
  'Accept-Language': 'en-US,en;q=0.9',
} as const;

const POST_HEADERS = {
  ...JSON_HEADERS,
  'Content-Type': 'application/json',
} as const;

const PAGE_TIMEOUT_MS = 15000;

// =========================================================
// Google Careers
// =========================================================
// Public JSON search API used by careers.google.com.
// URL: https://careers.google.com/api/v3/search/?page=N&page_size=100&jlo=en
// Each job exposes title, locations[], company_name, apply_url, etc.
// =========================================================
interface GoogleJob {
  id?: string;
  job_title?: string;
  title?: string;
  company_name?: string;
  locations?: { display?: string; city?: string; state?: string; country?: string }[];
  categories?: string[];
  description?: string;
  apply_url?: string;
  publish_date?: string;
  created?: string;
}
interface GoogleSearchResponse {
  jobs?: GoogleJob[];
  count?: number;
  next_page_token?: string;
  page_size?: number;
}

export async function fetchGoogleJobs(source: CompanySource): Promise<JobListing[]> {
  const listings: JobListing[] = [];
  const PAGE_SIZE = 100;
  const MAX_PAGES = 10; // up to 1000 jobs

  for (let page = 1; page <= MAX_PAGES; page++) {
    const url =
      `https://careers.google.com/api/v3/search/?page=${page}&page_size=${PAGE_SIZE}&jlo=en`;
    const res = await fetch(url, {
      headers: JSON_HEADERS,
      signal: AbortSignal.timeout(PAGE_TIMEOUT_MS),
    });
    if (!res.ok) {
      // If the very first page fails, propagate so it surfaces as an error.
      if (page === 1) throw new Error(`Google HTTP ${res.status}`);
      break;
    }
    let data: GoogleSearchResponse;
    try {
      data = (await res.json()) as GoogleSearchResponse;
    } catch {
      if (page === 1) throw new Error('Google returned invalid JSON');
      break;
    }
    const jobs = data.jobs || [];
    if (jobs.length === 0) break;

    for (const job of jobs) {
      const jobId = job.id || '';
      const title = job.job_title || job.title || '';
      if (!title) continue;
      const loc = (job.locations || [])
        .map((l) => l.display || [l.city, l.state, l.country].filter(Boolean).join(', '))
        .filter(Boolean)
        .join(' · ') || 'Not specified';
      listings.push({
        id: `gg-${source.boardToken}-${jobId || listings.length}`,
        sourceId: jobId,
        company: source.name,
        companySlug: source.slug,
        title,
        location: loc,
        department: job.categories?.[0] || '',
        salary: null,
        salaryMin: null,
        salaryMax: null,
        url: job.apply_url || `https://careers.google.com/jobs/results/${encodeURIComponent(jobId)}/`,
        ats: 'google',
        postedAt: job.publish_date || job.created || null,
        updatedAt: job.publish_date || job.created || null,
        fetchedAt: new Date().toISOString(),
      });
    }

    if (jobs.length < PAGE_SIZE) break; // last page
  }

  return listings;
}

// =========================================================
// Apple Jobs
// =========================================================
// POST https://jobs.apple.com/api/role/search
// Request body requests a page of roles; response `searchResults` has
// title, team, postLocation, postingDescription etc.
// =========================================================
interface AppleRole {
  id?: string;
  positionId?: string;
  reqId?: string;
  postingTitle?: string;
  jobLocation?: { city?: string; state?: string; countryName?: string }[];
  postLocation?: { name?: string }[];
  team?: { teamName?: string };
  postingDate?: string;
  postDateInGMT?: string;
  postingDescription?: string;
}
interface AppleSearchResponse {
  searchResults?: AppleRole[];
  totalRecords?: number;
}

export async function fetchAppleJobs(source: CompanySource): Promise<JobListing[]> {
  const listings: JobListing[] = [];
  const PAGE_SIZE = 100;
  const MAX_PAGES = 10;

  for (let page = 1; page <= MAX_PAGES; page++) {
    const res = await fetch('https://jobs.apple.com/api/role/search', {
      method: 'POST',
      headers: POST_HEADERS,
      body: JSON.stringify({
        filters: { range: { value: 60, unit: 'day' } },
        page,
        locale: 'en-us',
        sort: 'newest',
        search: '',
      }),
      signal: AbortSignal.timeout(PAGE_TIMEOUT_MS),
    });
    if (!res.ok) {
      if (page === 1) throw new Error(`Apple HTTP ${res.status}`);
      break;
    }
    let data: AppleSearchResponse;
    try {
      data = (await res.json()) as AppleSearchResponse;
    } catch {
      if (page === 1) throw new Error('Apple returned invalid JSON');
      break;
    }
    const roles = data.searchResults || [];
    if (roles.length === 0) break;

    for (const role of roles) {
      const jobId = role.positionId || role.reqId || role.id || '';
      const title = role.postingTitle || '';
      if (!title) continue;
      const locParts =
        (role.postLocation && role.postLocation.map((p) => p.name).filter(Boolean)) ||
        (role.jobLocation &&
          role.jobLocation.map((l) =>
            [l.city, l.state, l.countryName].filter(Boolean).join(', '),
          )) ||
        [];
      const location = locParts.filter(Boolean).join(' · ') || 'Not specified';
      listings.push({
        id: `ap-${source.boardToken}-${jobId || listings.length}`,
        sourceId: jobId,
        company: source.name,
        companySlug: source.slug,
        title,
        location,
        department: role.team?.teamName || '',
        salary: null,
        salaryMin: null,
        salaryMax: null,
        url: jobId
          ? `https://jobs.apple.com/en-us/details/${jobId}`
          : 'https://jobs.apple.com/en-us/search',
        ats: 'apple',
        postedAt: role.postingDate || role.postDateInGMT || null,
        updatedAt: role.postingDate || role.postDateInGMT || null,
        fetchedAt: new Date().toISOString(),
      });
    }

    if (roles.length < PAGE_SIZE) break;
  }

  return listings;
}

// =========================================================
// Microsoft Careers
// =========================================================
// GET https://gcsservices.careers.microsoft.com/search/api/v1/search
//   ?q=&lc=&p=&o=Recent&pgSz=100&pg=N
// Response: operationResult.result.jobs[]
// =========================================================
interface MicrosoftJob {
  jobId?: string;
  title?: string;
  category?: string;
  primaryLocation?: string;
  locations?: string[];
  postingDate?: string;
  postedDate?: string;
  properties?: {
    primaryLocation?: string;
    locations?: string[];
    employmentType?: string;
    workSiteFlexibility?: string;
    description?: string;
  };
}
interface MicrosoftSearchResponse {
  operationResult?: {
    result?: {
      jobs?: MicrosoftJob[];
      totalJobs?: number;
    };
  };
}

export async function fetchMicrosoftJobs(source: CompanySource): Promise<JobListing[]> {
  const listings: JobListing[] = [];
  const PAGE_SIZE = 100;
  const MAX_PAGES = 10;

  for (let page = 1; page <= MAX_PAGES; page++) {
    const url =
      `https://gcsservices.careers.microsoft.com/search/api/v1/search` +
      `?q=&lc=&p=&o=Recent&pgSz=${PAGE_SIZE}&pg=${page}&l=en_us`;
    const res = await fetch(url, {
      headers: JSON_HEADERS,
      signal: AbortSignal.timeout(PAGE_TIMEOUT_MS),
    });
    if (!res.ok) {
      if (page === 1) throw new Error(`Microsoft HTTP ${res.status}`);
      break;
    }
    let data: MicrosoftSearchResponse;
    try {
      data = (await res.json()) as MicrosoftSearchResponse;
    } catch {
      if (page === 1) throw new Error('Microsoft returned invalid JSON');
      break;
    }
    const jobs = data.operationResult?.result?.jobs || [];
    if (jobs.length === 0) break;

    for (const job of jobs) {
      const jobId = job.jobId || '';
      const title = job.title || '';
      if (!title) continue;
      const location =
        job.primaryLocation ||
        job.properties?.primaryLocation ||
        (job.locations && job.locations.join(' · ')) ||
        (job.properties?.locations && job.properties.locations.join(' · ')) ||
        'Not specified';
      listings.push({
        id: `ms-${source.boardToken}-${jobId || listings.length}`,
        sourceId: jobId,
        company: source.name,
        companySlug: source.slug,
        title,
        location,
        department: job.category || '',
        salary: null,
        salaryMin: null,
        salaryMax: null,
        url: jobId
          ? `https://jobs.careers.microsoft.com/global/en/job/${jobId}`
          : 'https://careers.microsoft.com/',
        ats: 'microsoft',
        postedAt: job.postingDate || job.postedDate || null,
        updatedAt: job.postingDate || job.postedDate || null,
        fetchedAt: new Date().toISOString(),
      });
    }

    if (jobs.length < PAGE_SIZE) break;
  }

  return listings;
}

// =========================================================
// Amazon Jobs
// =========================================================
// GET https://www.amazon.jobs/en/search.json?result_limit=100&offset=N
// =========================================================
interface AmazonJob {
  id?: string;
  id_icims?: string;
  title?: string;
  business_category?: string;
  job_category?: string;
  location?: string;
  normalized_location?: string;
  posted_date?: string;
  updated_time?: string;
  job_path?: string;
  description_short?: string;
}
interface AmazonSearchResponse {
  jobs?: AmazonJob[];
  hits?: number;
}

export async function fetchAmazonJobs(source: CompanySource): Promise<JobListing[]> {
  const listings: JobListing[] = [];
  const PAGE_SIZE = 100;
  const MAX_PAGES = 10;

  for (let page = 0; page < MAX_PAGES; page++) {
    const offset = page * PAGE_SIZE;
    const url =
      `https://www.amazon.jobs/en/search.json?result_limit=${PAGE_SIZE}` +
      `&offset=${offset}&sort=recent`;
    const res = await fetch(url, {
      headers: JSON_HEADERS,
      signal: AbortSignal.timeout(PAGE_TIMEOUT_MS),
    });
    if (!res.ok) {
      if (page === 0) throw new Error(`Amazon HTTP ${res.status}`);
      break;
    }
    let data: AmazonSearchResponse;
    try {
      data = (await res.json()) as AmazonSearchResponse;
    } catch {
      if (page === 0) throw new Error('Amazon returned invalid JSON');
      break;
    }
    const jobs = data.jobs || [];
    if (jobs.length === 0) break;

    for (const job of jobs) {
      const jobId = job.id_icims || job.id || '';
      const title = job.title || '';
      if (!title) continue;
      listings.push({
        id: `az-${source.boardToken}-${jobId || listings.length}`,
        sourceId: jobId,
        company: source.name,
        companySlug: source.slug,
        title,
        location: job.normalized_location || job.location || 'Not specified',
        department: job.business_category || job.job_category || '',
        salary: null,
        salaryMin: null,
        salaryMax: null,
        url: job.job_path
          ? `https://www.amazon.jobs${job.job_path}`
          : `https://www.amazon.jobs/en/jobs/${jobId}`,
        ats: 'amazon',
        postedAt: job.posted_date || job.updated_time || null,
        updatedAt: job.updated_time || job.posted_date || null,
        fetchedAt: new Date().toISOString(),
      });
    }

    if (jobs.length < PAGE_SIZE) break;
  }

  return listings;
}

// =========================================================
// Meta Careers
// =========================================================
// POST https://www.metacareers.com/graphql with the "CareersJobSearchResultsQuery".
// Meta's GraphQL is public but the query hash rotates — for resilience we
// use the simpler JSON fallback endpoint at /jobs/search/?results_per_page=...
// and parse the embedded JSON.
// =========================================================

export async function fetchMetaJobs(source: CompanySource): Promise<JobListing[]> {
  const listings: JobListing[] = [];
  const PAGE_SIZE = 100;
  const MAX_PAGES = 10;

  for (let page = 1; page <= MAX_PAGES; page++) {
    const url =
      `https://www.metacareers.com/graphql?doc_id=9509267205807711&variables=` +
      encodeURIComponent(
        JSON.stringify({
          search_input: {
            q: null,
            divisions: [],
            offices: [],
            roles: [],
            leadership_levels: [],
            saved_jobs: [],
            saved_searches: [],
            sub_teams: [],
            teams: [],
            is_leadership: false,
            is_in_page: false,
            is_remote_only: false,
            page,
            results_per_page: PAGE_SIZE,
            sort_by_new: true,
          },
        }),
      );

    const res = await fetch(url, {
      headers: {
        ...JSON_HEADERS,
        'X-FB-Friendly-Name': 'CareersJobSearchResultsQuery',
      },
      signal: AbortSignal.timeout(PAGE_TIMEOUT_MS),
    });
    if (!res.ok) {
      if (page === 1) throw new Error(`Meta HTTP ${res.status}`);
      break;
    }
    let data: {
      data?: {
        job_search?: {
          id?: string;
          title?: string;
          locations?: string[];
          teams?: string[];
          sub_teams?: string[];
        }[];
      };
    };
    try {
      data = await res.json();
    } catch {
      if (page === 1) throw new Error('Meta returned invalid JSON');
      break;
    }
    const jobs = data.data?.job_search || [];
    if (jobs.length === 0) break;

    for (const job of jobs) {
      const jobId = job.id || '';
      const title = job.title || '';
      if (!title) continue;
      listings.push({
        id: `mt-${source.boardToken}-${jobId || listings.length}`,
        sourceId: jobId,
        company: source.name,
        companySlug: source.slug,
        title,
        location: (job.locations || []).filter(Boolean).join(' · ') || 'Not specified',
        department:
          (job.teams && job.teams[0]) || (job.sub_teams && job.sub_teams[0]) || '',
        salary: null,
        salaryMin: null,
        salaryMax: null,
        url: jobId ? `https://www.metacareers.com/jobs/${jobId}/` : 'https://www.metacareers.com/jobs',
        ats: 'meta',
        postedAt: null,
        updatedAt: null,
        fetchedAt: new Date().toISOString(),
      });
    }

    if (jobs.length < PAGE_SIZE) break;
  }

  return listings;
}

// =========================================================
// Uber Careers (custom API)
// =========================================================
// Uber's public board is powered by their own service at
// https://www.uber.com/api/loadSearchJobsResults (POST).
// =========================================================
interface UberJob {
  id?: string | number;
  title?: string;
  department?: string;
  allLocations?: { name?: string; city?: string; region?: string; countryName?: string }[];
  location?: { name?: string };
  creationDate?: string;
  updatedDate?: string;
}
interface UberSearchResponse {
  data?: {
    results?: UberJob[];
    totalCount?: number;
  };
}

export async function fetchUberJobs(source: CompanySource): Promise<JobListing[]> {
  const listings: JobListing[] = [];
  // Uber's paginated API occasionally returns the same job across pages,
  // so we track seen job IDs and skip duplicates to avoid React key collisions.
  const seenIds = new Set<string>();
  const PAGE_SIZE = 100;
  const MAX_PAGES = 10;

  for (let page = 0; page < MAX_PAGES; page++) {
    const res = await fetch('https://www.uber.com/api/loadSearchJobsResults', {
      method: 'POST',
      headers: {
        ...POST_HEADERS,
        'x-csrf-token': 'x',
      },
      body: JSON.stringify({
        params: { limit: PAGE_SIZE, page, department: [], location: [], programs: [], team: [] },
      }),
      signal: AbortSignal.timeout(PAGE_TIMEOUT_MS),
    });
    if (!res.ok) {
      if (page === 0) throw new Error(`Uber HTTP ${res.status}`);
      break;
    }
    let data: UberSearchResponse;
    try {
      data = (await res.json()) as UberSearchResponse;
    } catch {
      if (page === 0) throw new Error('Uber returned invalid JSON');
      break;
    }
    const jobs = data.data?.results || [];
    if (jobs.length === 0) break;

    for (const job of jobs) {
      const jobId = String(job.id ?? '');
      const title = job.title || '';
      if (!title) continue;
      if (jobId && seenIds.has(jobId)) continue;
      if (jobId) seenIds.add(jobId);
      const location =
        (job.allLocations && job.allLocations.map((l) => l.name || [l.city, l.region, l.countryName].filter(Boolean).join(', ')).filter(Boolean).join(' · ')) ||
        job.location?.name ||
        'Not specified';
      listings.push({
        id: `ub-${source.boardToken}-${jobId || listings.length}`,
        sourceId: jobId,
        company: source.name,
        companySlug: source.slug,
        title,
        location,
        department: job.department || '',
        salary: null,
        salaryMin: null,
        salaryMax: null,
        url: jobId
          ? `https://www.uber.com/global/en/careers/list/${jobId}/`
          : 'https://www.uber.com/careers/',
        ats: 'uber',
        postedAt: job.creationDate || job.updatedDate || null,
        updatedAt: job.updatedDate || job.creationDate || null,
        fetchedAt: new Date().toISOString(),
      });
    }

    if (jobs.length < PAGE_SIZE) break;
  }

  return listings;
}

// =========================================================
// Workday (generic)
// =========================================================
// Every Workday careers site shares an API shape:
//   POST https://{host}/wday/cxs/{tenant}/{site}/jobs
//   body: {"appliedFacets":{},"limit":20,"offset":N,"searchText":""}
// Response: { total, jobPostings: [{title, externalPath, locationsText, postedOn, bulletFields}] }
// The `externalPath` is appended to `https://{host}/{site}` for the apply URL.
// =========================================================
interface WorkdayPosting {
  title?: string;
  externalPath?: string;
  locationsText?: string;
  postedOn?: string;
  bulletFields?: string[];
}
interface WorkdayResponse {
  total?: number;
  jobPostings?: WorkdayPosting[];
}

export async function fetchWorkdayJobs(source: CompanySource): Promise<JobListing[]> {
  if (!source.workdayHost || !source.workdaySite) {
    throw new Error(`Workday source ${source.name} missing workdayHost/workdaySite config`);
  }
  const tenant = source.boardToken; // tenant is the first path segment
  const baseUrl = `https://${source.workdayHost}/wday/cxs/${tenant}/${source.workdaySite}/jobs`;
  const siteRoot = `https://${source.workdayHost}/${source.workdaySite}`;

  // Workday's API caps at 20 postings per call. Large tenants (Oracle,
  // Nvidia, Salesforce, Adobe, Cisco) commonly have 2000–5000+ open roles
  // globally, so we pull everything up to MAX_JOBS rather than stopping
  // at a fixed page count. The flow:
  //   1. Fetch page 0 to learn `data.total`.
  //   2. Request the remaining pages in parallel batches of CONCURRENCY
  //      (keeps us well below per-host rate limits while draining fast).
  //   3. Bail out of a page if it returns zero postings (some tenants
  //      report an inflated `total` and pad with empty tail pages).
  //   4. Emit a console warning if we truncate at MAX_JOBS so ops can
  //      bump the cap when a tenant really does exceed it.
  const PAGE_SIZE = 20;
  const MAX_JOBS = 6000;          // hard ceiling per tenant (safety net)
  const CONCURRENCY = 4;           // parallel page requests after page 0

  const fetchPage = async (offset: number): Promise<WorkdayResponse | null> => {
    const res = await fetch(baseUrl, {
      method: 'POST',
      headers: POST_HEADERS,
      body: JSON.stringify({
        appliedFacets: {},
        limit: PAGE_SIZE,
        offset,
        searchText: '',
      }),
      signal: AbortSignal.timeout(PAGE_TIMEOUT_MS),
    });
    if (!res.ok) {
      if (offset === 0) throw new Error(`Workday HTTP ${res.status}`);
      return null;
    }
    try {
      return (await res.json()) as WorkdayResponse;
    } catch {
      if (offset === 0) throw new Error('Workday returned invalid JSON');
      return null;
    }
  };

  const pushPostings = (postings: WorkdayPosting[], listings: JobListing[]) => {
    for (const post of postings) {
      const title = post.title || '';
      if (!title) continue;
      const externalPath = post.externalPath || '';
      const jobId = externalPath.split('/').pop() || `${source.boardToken}-${listings.length}`;
      const bulletText = (post.bulletFields || []).join(' ');
      const salaryInfo = extractSalary(bulletText);
      listings.push({
        id: `wd-${source.boardToken}-${jobId}`,
        sourceId: jobId,
        company: source.name,
        companySlug: source.slug,
        title,
        location: post.locationsText || 'Not specified',
        department: '',
        salary: salaryInfo?.display || null,
        salaryMin: salaryInfo?.min || null,
        salaryMax: salaryInfo?.max || null,
        url: externalPath ? `${siteRoot}${externalPath}` : siteRoot,
        ats: 'workday',
        postedAt: post.postedOn || null,
        updatedAt: post.postedOn || null,
        fetchedAt: new Date().toISOString(),
      });
    }
  };

  const listings: JobListing[] = [];

  // ─── Page 0: blocks on response so we can read `total` ───
  const firstPage = await fetchPage(0);
  if (!firstPage) return listings;
  const firstPostings = firstPage.jobPostings || [];
  pushPostings(firstPostings, listings);

  // Determine how many pages we actually need. Prefer `total` when
  // provided; otherwise keep paginating until a page returns < PAGE_SIZE
  // (the old behavior). We still cap at MAX_JOBS to be safe.
  const total = typeof firstPage.total === 'number' ? firstPage.total : undefined;
  if (firstPostings.length < PAGE_SIZE) return listings; // reached the end already

  // If we know the total, compute the exact remaining offsets. If we
  // don't, grow offsets incrementally in CONCURRENCY-sized waves and
  // stop when any wave returns a short/empty page.
  const hardCap = Math.min(total ?? MAX_JOBS, MAX_JOBS);
  let nextOffset = PAGE_SIZE;
  let exhausted = false;

  while (!exhausted && nextOffset < hardCap && listings.length < MAX_JOBS) {
    // Build a wave of up to CONCURRENCY offsets.
    const wave: number[] = [];
    for (let i = 0; i < CONCURRENCY && nextOffset < hardCap; i++) {
      wave.push(nextOffset);
      nextOffset += PAGE_SIZE;
    }
    if (wave.length === 0) break;

    const results = await Promise.allSettled(wave.map((off) => fetchPage(off)));
    for (let i = 0; i < results.length; i++) {
      const r = results[i];
      if (r.status !== 'fulfilled' || r.value === null) {
        // Individual page failure — stop so we don't leave holes in the
        // listings. Any pages already accumulated are returned as-is.
        exhausted = true;
        break;
      }
      const postings = r.value.jobPostings || [];
      if (postings.length === 0) { exhausted = true; break; }
      pushPostings(postings, listings);
      if (postings.length < PAGE_SIZE) { exhausted = true; break; }
      if (listings.length >= MAX_JOBS) { exhausted = true; break; }
    }
  }

  if (listings.length >= MAX_JOBS && total !== undefined && total > MAX_JOBS) {
    // Ops breadcrumb: we truncated. If this fires in practice, raise
    // MAX_JOBS for this tenant (or globally).
    console.warn(
      `Workday ${source.name}: truncated at ${MAX_JOBS} of ${total} postings. ` +
      `Raise MAX_JOBS in fetchWorkdayJobs if this tenant really has that many matches.`
    );
  }

  return listings;
}

// =========================================================
// Eightfold AI Careers (Netflix, and many other enterprises)
// =========================================================
// Eightfold powers careers portals at `{host}/careers`. The public JSON
// API used by the site itself:
//   List:   GET {host}/api/apply/v2/jobs?domain={domain}&num=10&start=N&sort_by=relevance&query=
//           → { count, positions: [...] }
//   Detail: GET {host}/api/apply/v2/jobs/{positionId}
//           → position object with `job_description` (HTML)
//
// Config: `eightfoldHost` (e.g. "explore.jobs.netflix.net") and
// `eightfoldDomain` (e.g. "netflix.com"). Both are required.
//
// Eightfold hard-caps the per-page size at 10 server-side regardless of
// the `num` param, so for big tenants we need a lot of pages. We drive
// pagination off `count` and fan out in parallel waves.
// =========================================================
interface EightfoldPosition {
  id?: number | string;
  name?: string;
  posting_name?: string;
  location?: string;
  locations?: string[];
  department?: string;
  business_unit?: string;
  t_create?: number;
  t_update?: number;
  ats_job_id?: string;
  display_job_id?: string;
  job_description?: string;
  canonicalPositionUrl?: string;
  work_location_option?: string;
  location_flexibility?: string | null;
  salary_min?: number | null;
  salary_max?: number | null;
}
interface EightfoldResponse {
  count?: number;
  positions?: EightfoldPosition[];
}

const EIGHTFOLD_PAGE_SIZE = 10;       // server-enforced cap
const EIGHTFOLD_MAX_JOBS = 5000;      // safety net per tenant
const EIGHTFOLD_CONCURRENCY = 4;

export async function fetchEightfoldJobs(source: CompanySource): Promise<JobListing[]> {
  if (!source.eightfoldHost || !source.eightfoldDomain) {
    throw new Error(`Eightfold source ${source.name} missing eightfoldHost/eightfoldDomain config`);
  }
  const host = source.eightfoldHost;
  const domain = source.eightfoldDomain;
  const listApi = `https://${host}/api/apply/v2/jobs`;

  const fetchPage = async (start: number): Promise<EightfoldResponse | null> => {
    const url =
      `${listApi}?domain=${encodeURIComponent(domain)}` +
      `&num=${EIGHTFOLD_PAGE_SIZE}&start=${start}&sort_by=relevance&query=`;
    const res = await fetch(url, {
      headers: JSON_HEADERS,
      signal: AbortSignal.timeout(PAGE_TIMEOUT_MS),
    });
    if (!res.ok) {
      if (start === 0) throw new Error(`Eightfold HTTP ${res.status}`);
      return null;
    }
    try {
      return (await res.json()) as EightfoldResponse;
    } catch {
      if (start === 0) throw new Error('Eightfold returned invalid JSON');
      return null;
    }
  };

  const pushPositions = (positions: EightfoldPosition[], listings: JobListing[]) => {
    for (const pos of positions) {
      const jobId = String(pos.id ?? pos.display_job_id ?? pos.ats_job_id ?? '');
      const title = pos.posting_name || pos.name || '';
      if (!title || !jobId) continue;
      // Eightfold's `location` field is a comma-joined "City,State,Country"
      // string — reformat to "City, State, Country" for readability.
      const loc =
        (pos.locations && pos.locations.length > 0
          ? pos.locations
          : pos.location
            ? [pos.location]
            : []
        )
          .map((l) => l.split(',').map((p) => p.trim()).filter(Boolean).join(', '))
          .filter(Boolean)
          .join(' · ') || 'Not specified';
      listings.push({
        id: `ef-${source.boardToken}-${jobId}`,
        sourceId: jobId,
        company: source.name,
        companySlug: source.slug,
        title,
        location: loc,
        department: pos.department || pos.business_unit || '',
        salary: null,
        salaryMin: pos.salary_min ?? null,
        salaryMax: pos.salary_max ?? null,
        url:
          pos.canonicalPositionUrl ||
          `https://${host}/careers/job/${jobId}`,
        ats: 'eightfold',
        postedAt: pos.t_create ? new Date(pos.t_create * 1000).toISOString() : null,
        updatedAt: pos.t_update ? new Date(pos.t_update * 1000).toISOString() : null,
        fetchedAt: new Date().toISOString(),
      });
    }
  };

  const listings: JobListing[] = [];

  // Page 0 sequential to learn `count`.
  const firstPage = await fetchPage(0);
  if (!firstPage) return listings;
  const firstPositions = firstPage.positions || [];
  pushPositions(firstPositions, listings);
  if (firstPositions.length < EIGHTFOLD_PAGE_SIZE) return listings;

  const count = typeof firstPage.count === 'number' ? firstPage.count : undefined;
  const hardCap = Math.min(count ?? EIGHTFOLD_MAX_JOBS, EIGHTFOLD_MAX_JOBS);

  let nextStart = EIGHTFOLD_PAGE_SIZE;
  let exhausted = false;

  while (!exhausted && nextStart < hardCap && listings.length < EIGHTFOLD_MAX_JOBS) {
    const wave: number[] = [];
    for (let i = 0; i < EIGHTFOLD_CONCURRENCY && nextStart < hardCap; i++) {
      wave.push(nextStart);
      nextStart += EIGHTFOLD_PAGE_SIZE;
    }
    if (wave.length === 0) break;

    const results = await Promise.allSettled(wave.map((s) => fetchPage(s)));
    for (const r of results) {
      if (r.status !== 'fulfilled' || r.value === null) { exhausted = true; break; }
      const positions = r.value.positions || [];
      if (positions.length === 0) { exhausted = true; break; }
      pushPositions(positions, listings);
      if (positions.length < EIGHTFOLD_PAGE_SIZE) { exhausted = true; break; }
      if (listings.length >= EIGHTFOLD_MAX_JOBS) { exhausted = true; break; }
    }
  }

  if (listings.length >= EIGHTFOLD_MAX_JOBS && count !== undefined && count > EIGHTFOLD_MAX_JOBS) {
    console.warn(
      `Eightfold ${source.name}: truncated at ${EIGHTFOLD_MAX_JOBS} of ${count} positions.`
    );
  }

  return listings;
}

/**
 * Fetch the full detail (including the HTML `job_description`) for a
 * single Eightfold position. Used by the scorer to do ATS keyword
 * matching against the real JD rather than the title alone.
 */
export async function fetchEightfoldJobDetail(
  host: string,
  positionId: string
): Promise<EightfoldPosition | null> {
  const url = `https://${host}/api/apply/v2/jobs/${encodeURIComponent(positionId)}`;
  const res = await fetch(url, {
    headers: JSON_HEADERS,
    signal: AbortSignal.timeout(PAGE_TIMEOUT_MS),
  });
  if (!res.ok) return null;
  try {
    return (await res.json()) as EightfoldPosition;
  } catch {
    return null;
  }
}
