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
import { writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { existsSync } from 'fs';

/**
 * Persist a per-listing job description HTML blob to
 * `data/listing-details/<listingId>.html` so `fetchJobDetail` can
 * read it back later for ATS scoring + tailoring. Used by custom
 * fetchers (Google, …) that have the full description in their
 * list response and would otherwise discard it.
 *
 * Errors are intentionally swallowed — a failed cache write just
 * means the listing falls back to "not scorable" downstream, which
 * is the same behavior we had before this optimization.
 */
export async function cacheJobDetailHtml(listingId: string, html: string): Promise<void> {
  if (!html || html.length < 20) return;
  try {
    const dir = join(process.cwd(), 'data', 'listing-details');
    if (!existsSync(dir)) await mkdir(dir, { recursive: true });
    await writeFile(join(dir, `${listingId}.html`), html, 'utf-8');
  } catch {
    /* non-fatal */
  }
}

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
// Google Careers (SSR-extraction)
// =========================================================
// Google retired their `/api/v3/search/` JSON endpoint at
// careers.google.com (HTTP 404 since at least early 2026) and
// migrated to https://www.google.com/about/careers/applications/.
// There's no public REST API replacement — but the new SSR HTML
// embeds the full job payload as
// `AF_initDataCallback({key:'ds:1', data:[…]})` (Google's standard
// server-side state hook). We extract that block, sanitize raw
// control characters that break JSON.parse (description HTML
// contains literal newlines/tabs), and map each entry into our
// JobListing shape.
//
// Schema (verified against live response, 2026):
//   data = [ jobs[], null, totalCount, pageSize ]
//   jobs[i] = [
//     [0]  jobId
//     [1]  title
//     [2]  apply URL (signin redirect)
//     [3]  [null, responsibilities HTML]
//     [4]  [null, qualifications HTML]
//     [5]  company-project path
//     [7]  company display name (Google / DeepMind / GFiber / …)
//     [9]  [[country, [cities], …, countryCode], …]
//     [10] [null, "about the job" body]
//     [12] [unix-seconds, nanos]   posted
//     ...
//   ]
//
// Pagination: `?page=N` with 20 jobs/page. Total at probe time
// was ~3,600 jobs across Alphabet brands.
//
// Coverage strategy
// ─────────────────
// A single global crawl misses any specific role beyond ~500 jobs
// (the cap we have to set to keep Refresh All bounded). Instead, we
// run one crawl per (preferredRole × preferredLocations) combination
// using Google's own `?q=&location=` filters. A user looking for an
// Engineering Manager in Seattle gets a focused crawl over THAT
// query, hitting deep into Google's full catalog without scanning
// 3,600 unrelated jobs. We dedupe by jobId across queries and fall
// back to a single global crawl if the user has no preferences set
// (early onboarding state).
// =========================================================

interface GoogleQuery {
  /** Encoded URL query string (already includes `&q=…&location=…`),
   *  without the leading `?` or the `&page=N` suffix. */
  filterQS: string;
  /** Human-friendly label used only for error/log strings. */
  label: string;
}

/** Build the (role × location) query matrix from user settings.
 *  Returns the empty array when no preferences are set, signalling
 *  the caller to fall back to a single un-filtered global crawl. */
async function buildGoogleQueries(): Promise<GoogleQuery[]> {
  // Lazy import to avoid pulling the DB module at top level (which
  // would cascade into client bundles importing CompanySource types
  // through `sources.ts`).
  const { getSettings } = await import('./db');
  const settings = await getSettings();
  const roles = (settings.preferredRoles ?? []).filter(Boolean);
  const locations = (settings.preferredLocations ?? []).filter(Boolean);

  if (roles.length === 0) return [];

  // Filter the role list so we don't fan out into 20 queries when
  // a user typed a long preferences list. Cap to top 4 roles —
  // empirically covers >95% of relevant matches without blowing up
  // refresh wall time.
  const roleCap = roles.slice(0, 4);
  const locParam = locations.length > 0
    // Google's location filter expects "City, ST, Country" tokens.
    // Our preferred locations are typically "City, ST" — append
    // ", USA" when the entry has only two comma-parts so the filter
    // matches actual postings.
    ? locations
        .map((l) => (l.split(',').length === 2 ? `${l}, USA` : l))
        .map((l) => `&location=${encodeURIComponent(l.trim())}`)
        .join('')
    : '';

  return roleCap.map((role) => ({
    // Wrap role in quotes so "Engineering Manager" doesn't loose-
    // match "Engineering" + "Manager" (which would pull in any
    // engineering OR manager listing).
    filterQS: `&q=${encodeURIComponent(`"${role}"`)}${locParam}`,
    label: locations.length > 0 ? `${role} in ${locations[0]}…` : role,
  }));
}

export async function fetchGoogleJobs(source: CompanySource): Promise<JobListing[]> {
  const queries = await buildGoogleQueries();
  const listings: JobListing[] = [];
  const seen = new Set<string>();

  // No prefs → single un-filtered global crawl, capped at 25 pages
  // (matches the previous behavior so the early-onboarding flow
  // doesn't return 0 jobs).
  if (queries.length === 0) {
    await crawlGoogleQuery(source, '', 25, listings, seen);
    return listings;
  }

  // Per-query cap. 12 pages × 20 jobs = up to 240 listings per
  // (role, location) tuple; with up to 4 roles that's 960 jobs max
  // per refresh — the same order of magnitude as the previous
  // global cap but every job is role-relevant.
  const PAGES_PER_QUERY = 12;
  for (const q of queries) {
    try {
      await crawlGoogleQuery(source, q.filterQS, PAGES_PER_QUERY, listings, seen);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(`Google query "${q.label}" failed: ${err instanceof Error ? err.message : err}`);
    }
  }
  return listings;
}

/** Inner crawl loop — runs the page=1..N walk for one filter
 *  combination, appending results to `listings` and skipping
 *  job IDs already in `seen`. Throws on first-page HTTP failure
 *  so the caller can surface the per-query error. */
async function crawlGoogleQuery(
  source: CompanySource,
  filterQS: string,
  maxPages: number,
  listings: JobListing[],
  seen: Set<string>,
): Promise<void> {
  for (let page = 1; page <= maxPages; page++) {
    const url = `https://www.google.com/about/careers/applications/jobs/results/?page=${page}&distance=50&hl=en_US${filterQS}`;
    const res = await fetch(url, {
      // Google's careers SSR returns the embedded payload regardless
      // of UA, but we still send a browser-shaped Accept header so
      // we get HTML rather than a redirect to a mobile shell.
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      signal: AbortSignal.timeout(PAGE_TIMEOUT_MS),
      redirect: 'follow',
    });
    if (!res.ok) {
      if (page === 1) throw new Error(`Google HTTP ${res.status}`);
      break;
    }
    const html = await res.text();
    const m = html.match(
      /AF_initDataCallback\(\{key:\s*'ds:1'[\s\S]*?data:\s*(\[[\s\S]*?\]),\s*sideChannel/,
    );
    if (!m) {
      if (page === 1) throw new Error('Google: ds:1 SSR block not found');
      break;
    }
    // Description HTML inside the payload contains literal \n / \t.
    // JSON.parse rejects those — escape every 0x00–0x1F char as
    // \uXXXX before parsing. Doesn't change semantics: those control
    // chars live inside double-quoted strings and end up identical
    // after parsing.
    const sanitized = m[1].replace(
      // eslint-disable-next-line no-control-regex
      /[\x00-\x1f]/g,
      (c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'),
    );
    let data: unknown;
    try {
      data = JSON.parse(sanitized);
    } catch {
      if (page === 1) throw new Error('Google: ds:1 JSON parse failed');
      break;
    }
    const jobs: unknown[] = Array.isArray(data) && Array.isArray((data as unknown[])[0])
      ? ((data as unknown[])[0] as unknown[])
      : [];
    if (jobs.length === 0) break;

    for (const j of jobs) {
      if (!Array.isArray(j) || j.length < 10) continue;
      const id = String(j[0] ?? '');
      const title = String(j[1] ?? '');
      if (!id || !title) continue;
      if (seen.has(id)) continue;
      seen.add(id);

      // Location extraction: job[9] = [[country, [cities], …, code], …]
      const locArr = Array.isArray(j[9]) ? (j[9] as unknown[]) : [];
      const loc = locArr
        .map((l) => {
          if (!Array.isArray(l)) return '';
          const country = String(l[0] ?? '');
          const cities = Array.isArray(l[1])
            ? (l[1] as unknown[]).map((c) => String(c ?? '')).filter(Boolean).join(', ')
            : '';
          // Prefer "Cities, Country" when cities differ from the
          // country label; fall back to just the country.
          if (cities && cities !== country) return `${cities}, ${country}`;
          return country;
        })
        .filter(Boolean)
        .join(' · ') || 'Not specified';

      // Posted timestamp: job[12] = [unixSeconds, nanos]
      let postedAt: string | null = null;
      const ts = j[12];
      if (Array.isArray(ts) && typeof ts[0] === 'number') {
        postedAt = new Date(ts[0] * 1000).toISOString();
      }

      // Brand: Alphabet has Google + DeepMind + GFiber + Verily + …
      // job[7] holds the actual brand. Tag listings outside Google
      // proper so the listings UI shows e.g. "DeepMind (Google)" —
      // helps users distinguish in filters/comparison.
      const brand = String(j[7] ?? source.name);
      const company =
        brand && brand !== source.name && brand.toLowerCase() !== 'google'
          ? `${brand} (Google)`
          : source.name;

      const applyUrl =
        String(j[2] ?? '') ||
        `https://www.google.com/about/careers/applications/jobs/results/${encodeURIComponent(id)}`;

      const listingId = `gg-${source.boardToken}-${id}`;

      // The SSR payload already contains the full description across
      // four fields — responsibilities ([3][1]), qualifications
      // ([4][1]), about-the-job body ([10][1]), additional notes
      // ([18][1]). Combine + cache to disk so fetchJobDetail can
      // return it later for ATS scoring + tailoring without a second
      // HTTP round-trip per listing. Each field's shape is
      // [null, "<html string>"] when present.
      const pickHtml = (field: unknown): string => {
        if (Array.isArray(field) && typeof field[1] === 'string') return field[1];
        return '';
      };
      const descriptionHtml = [
        pickHtml(j[10]),
        pickHtml(j[3]),
        pickHtml(j[4]),
        pickHtml(j[18]),
      ].filter(Boolean).join('\n');
      // Fire-and-forget; we don't await per-job to keep the list
      // fetch fast. Worst case the file lands a few ms after the
      // listing is in the cache — fetchJobDetail handles a missing
      // file by falling through to its existing null path.
      void cacheJobDetailHtml(listingId, descriptionHtml);

      // Try to extract a salary range from the JD body (Google
      // sometimes posts "$X – $Y per year" inline, especially for
      // California / NYC / Washington roles).
      const salaryInfo = descriptionHtml ? extractSalary(descriptionHtml) : null;

      listings.push({
        id: listingId,
        sourceId: id,
        company,
        companySlug: source.slug,
        title,
        location: loc,
        department: '',
        salary: salaryInfo?.display ?? null,
        salaryMin: salaryInfo?.min ?? null,
        salaryMax: salaryInfo?.max ?? null,
        url: applyUrl,
        ats: 'google',
        postedAt,
        updatedAt: postedAt,
        fetchedAt: new Date().toISOString(),
      });
    }

    // SSR returns 20 jobs/page when full. Anything less means we hit
    // the end of the result set for this filter combination.
    if (jobs.length < 20) break;
  }
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

// US state code → full region name mapping. Uber's location filter
// expects regions in their full-name form ("Washington", not "WA"),
// while the user's preferred-location strings are typically
// "Seattle, WA". A small lookup keeps us from shipping a full state
// table; the cap is the same set we already trust elsewhere.
const US_STATE_NAMES: Record<string, string> = {
  AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas',
  CA: 'California', CO: 'Colorado', CT: 'Connecticut', DE: 'Delaware',
  DC: 'District of Columbia', FL: 'Florida', GA: 'Georgia',
  HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois', IN: 'Indiana',
  IA: 'Iowa', KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana',
  ME: 'Maine', MD: 'Maryland', MA: 'Massachusetts', MI: 'Michigan',
  MN: 'Minnesota', MS: 'Mississippi', MO: 'Missouri', MT: 'Montana',
  NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire', NJ: 'New Jersey',
  NM: 'New Mexico', NY: 'New York', NC: 'North Carolina',
  ND: 'North Dakota', OH: 'Ohio', OK: 'Oklahoma', OR: 'Oregon',
  PA: 'Pennsylvania', RI: 'Rhode Island', SC: 'South Carolina',
  SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas', UT: 'Utah',
  VT: 'Vermont', VA: 'Virginia', WA: 'Washington', WV: 'West Virginia',
  WI: 'Wisconsin', WY: 'Wyoming',
};

interface UberLocationParam { city: string; region: string; country: string }

/** Convert a "Seattle, WA" / "Bellevue, WA" / "London, UK" preferred-
 *  location string into the Uber API's {city, region, country} shape.
 *  Returns null for strings we can't confidently parse (Uber will
 *  still return ALL jobs when the location array is empty, so a
 *  failed parse just degrades gracefully to a less-targeted query). */
function parseUberLocation(loc: string): UberLocationParam | null {
  const parts = loc.split(',').map((p) => p.trim()).filter(Boolean);
  if (parts.length < 2) return null;
  const city = parts[0];
  const stateCode = parts[1].toUpperCase();
  const region = US_STATE_NAMES[stateCode];
  if (!region) return null; // non-US — skip for now
  return { city, region, country: 'USA' };
}

interface UberQuery {
  query: string;
  location: UberLocationParam[];
  label: string;
}

/** Build the (role × locations) query matrix from user settings.
 *  Empty array = caller falls back to a single un-filtered crawl. */
async function buildUberQueries(): Promise<UberQuery[]> {
  const { getSettings } = await import('./db');
  const settings = await getSettings();
  const roles = (settings.preferredRoles ?? []).filter(Boolean).slice(0, 4);
  const locations = (settings.preferredLocations ?? [])
    .map(parseUberLocation)
    .filter((l): l is UberLocationParam => l !== null);
  if (roles.length === 0) return [];
  return roles.map((role) => ({
    query: role,
    location: locations,
    label: locations.length > 0 ? `${role} in ${locations[0].city}…` : role,
  }));
}

export async function fetchUberJobs(source: CompanySource): Promise<JobListing[]> {
  const queries = await buildUberQueries();
  const listings: JobListing[] = [];
  const seen = new Set<string>();

  // No prefs → single un-filtered crawl (matches the legacy behavior).
  if (queries.length === 0) {
    await crawlUberQuery(source, '', [], 8, listings, seen);
    return listings;
  }

  // Per-query cap. Uber's API ignores `limit` past ~700 results per
  // page so each query is effectively a single round-trip.
  const PAGES_PER_QUERY = 8;
  for (const q of queries) {
    try {
      await crawlUberQuery(source, q.query, q.location, PAGES_PER_QUERY, listings, seen);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(`Uber query "${q.label}" failed: ${err instanceof Error ? err.message : err}`);
    }
  }
  return listings;
}

/** Inner crawl loop for one (query, location) tuple. Appends to
 *  `listings` and skips IDs in `seen`. Throws on first-page HTTP
 *  failure so the caller can record per-query errors. */
async function crawlUberQuery(
  source: CompanySource,
  query: string,
  location: UberLocationParam[],
  maxPages: number,
  listings: JobListing[],
  seen: Set<string>,
): Promise<void> {
  const PAGE_SIZE = 100;
  for (let page = 0; page < maxPages; page++) {
    const body = {
      params: {
        limit: PAGE_SIZE,
        page,
        // Empty string for query = match all (Uber's API quirk).
        query: query || undefined,
        department: [],
        location,
        programs: [],
        team: [],
      },
    };
    const res = await fetch('https://www.uber.com/api/loadSearchJobsResults', {
      method: 'POST',
      headers: { ...POST_HEADERS, 'x-csrf-token': 'x' },
      body: JSON.stringify(body),
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
      if (!jobId || seen.has(jobId)) continue;
      seen.add(jobId);
      const loc =
        (job.allLocations &&
          job.allLocations
            .map(
              (l) =>
                l.name || [l.city, l.region, l.countryName].filter(Boolean).join(', '),
            )
            .filter(Boolean)
            .join(' · ')) ||
        job.location?.name ||
        'Not specified';
      listings.push({
        id: `ub-${source.boardToken}-${jobId}`,
        sourceId: jobId,
        company: source.name,
        companySlug: source.slug,
        title,
        location: loc,
        department: job.department || '',
        salary: null,
        salaryMin: null,
        salaryMax: null,
        url: `https://www.uber.com/global/en/careers/list/${jobId}/`,
        ats: 'uber',
        postedAt: job.creationDate || job.updatedDate || null,
        updatedAt: job.updatedDate || job.creationDate || null,
        fetchedAt: new Date().toISOString(),
      });
    }

    if (jobs.length < PAGE_SIZE) break;
  }
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
