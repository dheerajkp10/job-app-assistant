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

  const listings: JobListing[] = [];
  const PAGE_SIZE = 20; // Workday caps most tenants at 20 per call
  const MAX_PAGES = 25; // up to 500 postings per company

  for (let page = 0; page < MAX_PAGES; page++) {
    const offset = page * PAGE_SIZE;
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
      if (page === 0) throw new Error(`Workday HTTP ${res.status}`);
      break;
    }
    let data: WorkdayResponse;
    try {
      data = (await res.json()) as WorkdayResponse;
    } catch {
      if (page === 0) throw new Error('Workday returned invalid JSON');
      break;
    }
    const postings = data.jobPostings || [];
    if (postings.length === 0) break;

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

    if (postings.length < PAGE_SIZE) break;
  }

  return listings;
}
