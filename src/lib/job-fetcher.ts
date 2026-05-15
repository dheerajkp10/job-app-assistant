import type { CompanySource, JobListing, JobListingDetail } from './types';
import { extractSalary } from './salary-parser';
import { unescapeHtml } from './html-utils';
import { fetchWithRetry, HttpError } from './fetch-with-retry';
import {
  fetchGoogleJobs,
  fetchAppleJobs,
  fetchMicrosoftJobs,
  fetchAmazonJobs,
  fetchMetaJobs,
  fetchUberJobs,
  fetchWorkdayJobs,
  fetchEightfoldJobs,
  fetchEightfoldJobDetail,
} from './custom-fetchers';
import {
  fetchAppleJobsViaPuppeteer,
  fetchMetaJobsViaPuppeteer,
  fetchAppleJobDetailViaPuppeteer,
} from './puppeteer-fetchers';

// Apple's `/api/role/search` has been decommissioned (301 → pagenotfound)
// and Meta's GraphQL endpoint rotates `doc_id`s faster than we can track,
// so for these two we fall back to a headless-browser scrape of the
// public search UI. Flip this to `false` to bypass Puppeteer and use the
// (currently non-working) JSON fetchers — useful for local testing.
const USE_PUPPETEER_FOR_APPLE_META = true;

// =========================================================
// Greenhouse Board API
// =========================================================
interface GreenhouseJob {
  id: number;
  title: string;
  updated_at: string;
  absolute_url: string;
  location: { name: string };
  departments: { name: string }[];
  offices: { name: string }[];
}

interface GreenhouseJobDetail extends GreenhouseJob {
  content: string;
}

async function fetchGreenhouseJobs(source: CompanySource): Promise<JobListing[]> {
  // `?content=true` enriches every listing with the JD body in one call.
  // We rely on it for salary extraction — without it the Greenhouse
  // list endpoint returns no description text and salaryMin/Max stay
  // null, which kills the salary-intel cohort for most listings. The
  // payload is bigger (~2-5× without content) but still completes in
  // a single HTTP roundtrip per company.
  const url = `https://boards-api.greenhouse.io/v1/boards/${source.boardToken}/jobs?content=true`;
  const res = await fetchWithRetry(url, {
    timeoutMs: 20000,
    atsName: 'Greenhouse',
  });
  const data = await res.json();
  const jobs: (GreenhouseJob & { content?: string })[] = data.jobs || [];

  return jobs.map((job) => {
    const content = job.content ? unescapeHtml(job.content) : '';
    const salaryInfo = content ? extractSalary(content) : null;
    return {
      id: `gh-${source.boardToken}-${job.id}`,
      sourceId: String(job.id),
      company: source.name,
      companySlug: source.slug,
      title: job.title,
      location: job.location?.name || 'Not specified',
      department: job.departments?.[0]?.name || '',
      salary: salaryInfo?.display || null,
      salaryMin: salaryInfo?.min || null,
      salaryMax: salaryInfo?.max || null,
      salaryCurrency: salaryInfo?.currency ?? null,
      url: job.absolute_url,
      ats: 'greenhouse' as const,
      postedAt: job.updated_at,
      updatedAt: job.updated_at,
      fetchedAt: new Date().toISOString(),
    };
  });
}

export async function fetchGreenhouseJobDetail(
  boardToken: string,
  jobId: string
): Promise<GreenhouseJobDetail | null> {
  const url = `https://boards-api.greenhouse.io/v1/boards/${boardToken}/jobs/${jobId}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!res.ok) return null;
  return res.json();
}

// =========================================================
// Lever Postings API
// =========================================================
interface LeverPosting {
  id: string;
  text: string;
  hostedUrl: string;
  createdAt: number;
  categories: {
    commitment?: string;
    department?: string;
    location?: string;
    team?: string;
  };
  description?: string;
  descriptionPlain?: string;
  lists?: { text: string; content: string }[];
  additional?: string;
  additionalPlain?: string;
}

async function fetchLeverJobs(source: CompanySource): Promise<JobListing[]> {
  const url = `https://api.lever.co/v0/postings/${source.boardToken}?mode=json`;
  const res = await fetchWithRetry(url, { atsName: 'Lever' });
  const postings: LeverPosting[] = await res.json();

  return postings.map((post) => {
    const salaryInfo = extractSalary(post.descriptionPlain || post.additionalPlain || '');
    return {
      id: `lv-${source.boardToken}-${post.id}`,
      sourceId: post.id,
      company: source.name,
      companySlug: source.slug,
      title: post.text,
      location: post.categories?.location || 'Not specified',
      department: post.categories?.team || post.categories?.department || '',
      salary: salaryInfo?.display || null,
      salaryMin: salaryInfo?.min || null,
      salaryMax: salaryInfo?.max || null,
      salaryCurrency: salaryInfo?.currency ?? null,
      url: post.hostedUrl,
      ats: 'lever' as const,
      postedAt: new Date(post.createdAt).toISOString(),
      updatedAt: new Date(post.createdAt).toISOString(),
      fetchedAt: new Date().toISOString(),
    };
  });
}

export async function fetchLeverJobDetail(
  boardToken: string,
  jobId: string
): Promise<LeverPosting | null> {
  const url = `https://api.lever.co/v0/postings/${boardToken}/${jobId}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!res.ok) return null;
  return res.json();
}

// =========================================================
// Ashby Posting API
// =========================================================
interface AshbyJob {
  id: string;
  title: string;
  location: string;
  departmentName: string;
  teamName: string;
  employmentType: string;
  publishedAt: string;
  updatedAt: string;
  jobUrl: string;
  descriptionHtml?: string;
  descriptionPlain?: string;
  compensation?: {
    compensationTierSummary?: string;
  };
}

interface AshbyBoardResponse {
  jobs: AshbyJob[];
}

async function fetchAshbyJobs(source: CompanySource): Promise<JobListing[]> {
  const url = `https://api.ashbyhq.com/posting-api/job-board/${source.boardToken}`;
  const res = await fetchWithRetry(url, { atsName: 'Ashby' });
  const data: AshbyBoardResponse = await res.json();
  const jobs = data.jobs || [];

  return jobs.map((job) => {
    const salaryStr = job.compensation?.compensationTierSummary || null;
    // Many Ashby boards don't fill in `compensationTierSummary` even
    // when the JD body contains a "Compensation: $X – $Y" block. Fall
    // back to scraping the descriptionPlain/Html so we still populate
    // the salary cohort.
    const descText = job.descriptionPlain || job.descriptionHtml || '';
    const salaryInfo =
      (salaryStr ? extractSalary(salaryStr) : null) ||
      (descText ? extractSalary(descText) : null);
    return {
      id: `ab-${source.boardToken}-${job.id}`,
      sourceId: job.id,
      company: source.name,
      companySlug: source.slug,
      title: job.title,
      location: job.location || 'Not specified',
      department: job.departmentName || job.teamName || '',
      salary: salaryStr || salaryInfo?.display || null,
      salaryMin: salaryInfo?.min || null,
      salaryMax: salaryInfo?.max || null,
      salaryCurrency: salaryInfo?.currency ?? null,
      url: job.jobUrl,
      ats: 'ashby' as const,
      postedAt: job.publishedAt,
      updatedAt: job.updatedAt || job.publishedAt,
      fetchedAt: new Date().toISOString(),
    };
  });
}

export async function fetchAshbyJobDetail(
  boardToken: string,
  jobId: string
): Promise<AshbyJob | null> {
  // Ashby doesn't have a single-job endpoint, so we fetch the full board and filter
  const url = `https://api.ashbyhq.com/posting-api/job-board/${boardToken}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!res.ok) return null;
  const data: AshbyBoardResponse = await res.json();
  return data.jobs.find((j) => j.id === jobId) || null;
}

// =========================================================
// Unified fetcher — fetch from all sources in parallel
// =========================================================
export interface FetchResult {
  listings: JobListing[];
  errors: { company: string; error: string }[];
  /** New permanent failures (404) detected this run. The refresh
   *  endpoints merge these into Settings.deadSources so subsequent
   *  refreshes skip them for the cooldown window. Empty when nothing
   *  new went dead. */
  newDeadSources?: Record<string, { since: string; statusCode: number }>;
}

/**
 * Pick the right fetcher for a given company source. Covers the three
 * public ATSs (Greenhouse/Lever/Ashby) plus every custom careers API
 * we've implemented.
 */
function pickFetcher(source: CompanySource): (s: CompanySource) => Promise<JobListing[]> {
  switch (source.ats) {
    case 'greenhouse': return fetchGreenhouseJobs;
    case 'lever':      return fetchLeverJobs;
    case 'ashby':      return fetchAshbyJobs;
    case 'google':     return fetchGoogleJobs;
    case 'apple':      return USE_PUPPETEER_FOR_APPLE_META ? fetchAppleJobsViaPuppeteer : fetchAppleJobs;
    case 'microsoft':  return fetchMicrosoftJobs;
    case 'amazon':     return fetchAmazonJobs;
    case 'meta':       return USE_PUPPETEER_FOR_APPLE_META ? fetchMetaJobsViaPuppeteer : fetchMetaJobs;
    case 'uber':       return fetchUberJobs;
    case 'workday':    return fetchWorkdayJobs;
    case 'eightfold': return fetchEightfoldJobs;
    case 'smartrecruiters': return fetchSmartRecruitersJobs;
  }
}

// =========================================================
// SmartRecruiters Public Postings API
// =========================================================
// Powers ServiceNow, HelloFresh, Bosch, and ~hundreds of mid-market
// employers. Public + unauthenticated:
//   GET https://api.smartrecruiters.com/v1/companies/{slug}/postings
//      ?limit=100&offset=N
// Response: { totalFound, content: [{ id, name, location: { city, region,
//   country }, releasedDate, ... }], nextOffset? }
//
// Posting body (description) lives at a separate endpoint:
//   GET https://api.smartrecruiters.com/v1/companies/{slug}/postings/{id}
// — fetched per-listing in fetchJobDetail when scoring kicks in.
// =========================================================

interface SmartRecruitersPosting {
  id: string;
  name: string;
  location?: {
    city?: string;
    region?: string;
    country?: string;
    fullLocation?: string;
    remote?: boolean;
  };
  releasedDate?: string;
  refNumber?: string;
  department?: { id?: string; label?: string };
  function?: { id?: string; label?: string };
}

interface SmartRecruitersListResponse {
  totalFound?: number;
  content?: SmartRecruitersPosting[];
  nextOffset?: number;
}

async function fetchSmartRecruitersJobs(source: CompanySource): Promise<JobListing[]> {
  const out: JobListing[] = [];
  const PAGE_SIZE = 100;
  const MAX_PAGES = 10; // up to 1000 jobs per source
  for (let page = 0; page < MAX_PAGES; page++) {
    const offset = page * PAGE_SIZE;
    const url = `https://api.smartrecruiters.com/v1/companies/${source.boardToken}/postings?limit=${PAGE_SIZE}&offset=${offset}`;
    let res: Response;
    try {
      res = await fetchWithRetry(url, { atsName: 'SmartRecruiters' });
    } catch (err) {
      // First page failure is fatal (board likely doesn't exist).
      // Past page 0 we've already fetched some results — treat as
      // "end of pagination" rather than losing the whole batch.
      if (page === 0) throw err;
      // 404 mid-paginate just means we walked off the end.
      if (err instanceof HttpError && err.status === 404) break;
      // Transient that exhausted retries past page 0: keep what we have.
      break;
    }
    let data: SmartRecruitersListResponse;
    try {
      data = await res.json();
    } catch {
      if (page === 0) throw new Error('SmartRecruiters returned invalid JSON');
      break;
    }
    const items = data.content ?? [];
    if (items.length === 0) break;
    for (const p of items) {
      const id = p.id;
      const title = p.name || '';
      if (!id || !title) continue;
      const locParts = [
        p.location?.city,
        p.location?.region,
        p.location?.country,
      ].filter(Boolean);
      const remoteSuffix = p.location?.remote ? ' (Remote)' : '';
      const location =
        p.location?.fullLocation ||
        (locParts.length > 0 ? `${locParts.join(', ')}${remoteSuffix}` : 'Not specified');
      out.push({
        id: `sr-${source.boardToken}-${id}`,
        sourceId: id,
        company: source.name,
        companySlug: source.slug,
        title,
        location,
        department: p.department?.label || p.function?.label || '',
        salary: null,
        salaryMin: null,
        salaryMax: null,
        url: `https://jobs.smartrecruiters.com/${source.boardToken}/${id}`,
        ats: 'smartrecruiters',
        postedAt: p.releasedDate || null,
        updatedAt: p.releasedDate || null,
        fetchedAt: new Date().toISOString(),
      });
    }
    // Stop early if we've already fetched everything the API says exists.
    if (typeof data.totalFound === 'number' && out.length >= data.totalFound) break;
    if (items.length < PAGE_SIZE) break;
  }
  return out;
}

/**
 * SmartRecruiters per-job detail: pulls the JD body + sections.
 * Used by fetchJobDetail to power ATS scoring on SmartRecruiters
 * listings. Returns the raw JSON; the caller assembles the content
 * string from `jobAd.sections.{jobDescription,qualifications,additionalInformation}.text`.
 */
async function fetchSmartRecruitersJobDetail(
  boardToken: string,
  jobId: string,
): Promise<{ jobAd?: { sections?: Record<string, { text?: string }> } } | null> {
  const url = `https://api.smartrecruiters.com/v1/companies/${boardToken}/postings/${jobId}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!res.ok) return null;
  return res.json();
}

// Dead-source cooldown window — once a 404 is recorded for a board,
// we skip that source for this many hours before trying again. 24h
// is generous enough to absorb a one-off ATS outage while keeping the
// retry cadence low.
const DEAD_SOURCE_COOLDOWN_HOURS = 24;

export function isDeadSourceFresh(
  entry: { since: string } | undefined,
  now = Date.now(),
): boolean {
  if (!entry) return false;
  const ageMs = now - new Date(entry.since).getTime();
  return ageMs < DEAD_SOURCE_COOLDOWN_HOURS * 60 * 60 * 1000;
}

export function deadSourceKey(source: { ats: string; boardToken: string }): string {
  return `${source.ats}:${source.boardToken}`;
}

export async function fetchAllJobs(
  sources: CompanySource[],
  /** Optional dead-source map (typically `settings.deadSources`). When
   *  passed, sources with a fresh entry are skipped — they go straight
   *  into `errors` with a "skipped (cooldown)" note so the UI can show
   *  the user without spending a retry slot on them. */
  deadSources?: Record<string, { since: string; statusCode: number }>,
): Promise<FetchResult & {
  /** New 404s detected during this run. Callers (the refresh API) should
   *  merge these into `settings.deadSources` so the next refresh skips
   *  them within the cooldown window. */
  newDeadSources: Record<string, { since: string; statusCode: number }>;
}> {
  const now = Date.now();
  const newDeadSources: Record<string, { since: string; statusCode: number }> = {};
  // Partition sources into "try" vs "skip-by-cooldown" up front so we
  // can report the skipped ones without spending a network roundtrip.
  const skipped: CompanySource[] = [];
  const tryable: CompanySource[] = [];
  for (const s of sources) {
    const entry = deadSources?.[deadSourceKey(s)];
    if (isDeadSourceFresh(entry, now)) skipped.push(s);
    else tryable.push(s);
  }

  const results = await Promise.allSettled(
    tryable.map(async (source) => {
      const fetcher = pickFetcher(source);
      const jobs = await fetcher(source);
      return { source, jobs };
    })
  );

  const listings: JobListing[] = [];
  const errors: { company: string; error: string }[] = [];

  // Cooldown-skipped sources: report so the UI can tell the user
  // they were intentionally skipped (rather than silently dropped).
  for (const s of skipped) {
    const entry = deadSources![deadSourceKey(s)];
    errors.push({
      company: s.name,
      error: `skipped — ${s.ats} board returned ${entry.statusCode} on a prior fetch (cooldown until ${new Date(new Date(entry.since).getTime() + DEAD_SOURCE_COOLDOWN_HOURS * 3600_000).toLocaleString()})`,
    });
  }

  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    const source = tryable[i];
    if (result.status === 'fulfilled') {
      listings.push(...result.value.jobs);
    } else {
      const reason = result.reason;
      // Record permanent dead sources so the next refresh can skip
      // them rather than re-paying the failure latency.
      if (reason instanceof HttpError && reason.isDead) {
        newDeadSources[deadSourceKey(source)] = {
          since: new Date().toISOString(),
          statusCode: reason.status,
        };
      }
      errors.push({
        company: source.name,
        error: reason?.message || 'Unknown error',
      });
    }
  }

  // Deduplicate by listing ID — a safety net in case an upstream ATS API
  // (e.g. Uber's paginated jobs endpoint) hands us the same job twice.
  // Without this, React throws "Encountered two children with the same key".
  const seen = new Set<string>();
  const deduped: JobListing[] = [];
  for (const l of listings) {
    if (seen.has(l.id)) continue;
    seen.add(l.id);
    deduped.push(l);
  }

  return { listings: deduped, errors, newDeadSources };
}

// =========================================================
// Detail fetcher — get full job content for a single listing
// =========================================================
export async function fetchJobDetail(
  listing: JobListing
): Promise<JobListingDetail | null> {
  // Manual listings AND Google listings: the description was already
  // cached to disk during list-fetch (manual: by /api/listings/add,
  // Google: by fetchGoogleJobs which extracts the SSR payload's
  // responsibilities/qualifications/about/notes fields). Reading the
  // file is faster than re-hitting the careers API and means Google
  // listings get full ATS scoring + tailoring just like Greenhouse.
  if (listing.id.startsWith('manual-') || listing.id.startsWith('gg-')) {
    try {
      const { readFile } = await import('fs/promises');
      const { join } = await import('path');
      const { existsSync } = await import('fs');
      const filePath = join(process.cwd(), 'data', 'listing-details', `${listing.id}.html`);
      if (!existsSync(filePath)) return null;
      const content = await readFile(filePath, 'utf-8');
      const { qualifications, responsibilities } = extractSections(content);
      return { ...listing, content, qualifications, responsibilities };
    } catch {
      return null;
    }
  }

  if (listing.ats === 'greenhouse') {
    const boardToken = listing.id.split('-')[1]; // gh-{boardToken}-{id}
    const detail = await fetchGreenhouseJobDetail(boardToken, listing.sourceId);
    if (!detail) return null;

    const content = unescapeHtml(detail.content || '');
    const salaryInfo = extractSalary(content);
    const { qualifications, responsibilities } = extractSections(content);

    return {
      ...listing,
      salary: salaryInfo?.display || listing.salary,
      salaryMin: salaryInfo?.min || listing.salaryMin,
      salaryMax: salaryInfo?.max || listing.salaryMax,
      salaryCurrency: salaryInfo?.currency ?? listing.salaryCurrency ?? null,
      content,
      qualifications,
      responsibilities,
    };
  }

  if (listing.ats === 'lever') {
    const boardToken = listing.id.split('-')[1]; // lv-{boardToken}-{id}
    const detail = await fetchLeverJobDetail(boardToken, listing.sourceId);
    if (!detail) return null;

    // Combine all content sections
    const allContent = [
      detail.description || '',
      ...(detail.lists || []).map((l) => `<h3>${l.text}</h3>${l.content}`),
      detail.additional || '',
    ].join('\n');

    const salaryInfo = extractSalary(detail.descriptionPlain || detail.additionalPlain || '');
    const { qualifications, responsibilities } = extractSectionsFromLever(detail);

    return {
      ...listing,
      salary: salaryInfo?.display || listing.salary,
      salaryMin: salaryInfo?.min || listing.salaryMin,
      salaryMax: salaryInfo?.max || listing.salaryMax,
      salaryCurrency: salaryInfo?.currency ?? listing.salaryCurrency ?? null,
      content: allContent,
      qualifications,
      responsibilities,
    };
  }

  if (listing.ats === 'ashby') {
    const boardToken = listing.id.split('-')[1]; // ab-{boardToken}-{id}
    const detail = await fetchAshbyJobDetail(boardToken, listing.sourceId);
    if (!detail) return null;

    const content = detail.descriptionHtml || detail.descriptionPlain || '';
    const salaryStr = detail.compensation?.compensationTierSummary || null;
    const salaryInfo = salaryStr ? extractSalary(salaryStr) : extractSalary(content);
    const { qualifications, responsibilities } = extractSections(content);

    return {
      ...listing,
      salary: salaryStr || salaryInfo?.display || listing.salary,
      salaryMin: salaryInfo?.min || listing.salaryMin,
      salaryMax: salaryInfo?.max || listing.salaryMax,
      salaryCurrency: salaryInfo?.currency ?? listing.salaryCurrency ?? null,
      content,
      qualifications,
      responsibilities,
    };
  }

  if (listing.ats === 'smartrecruiters') {
    // SmartRecruiters per-job detail. Listing id shape:
    //   sr-{boardToken}-{jobId}.
    // The slice() — not split('-')[1] — preserves multi-segment job
    // IDs like '7c4b…-9d12' that SmartRecruiters routinely uses as
    // GUIDs. Same trick is used for greenhouse-token splitting where
    // boards have hyphens.
    const prefix = `sr-`;
    const after = listing.id.slice(prefix.length);
    const dash = after.indexOf('-');
    const boardToken = dash > 0 ? after.slice(0, dash) : after;
    const detail = await fetchSmartRecruitersJobDetail(boardToken, listing.sourceId);
    if (!detail) return null;
    const sections = detail.jobAd?.sections ?? {};
    // Combine the JD's primary text fields. SmartRecruiters splits
    // them so we keep them in section order for the section-extractor
    // to work the same way it does for Greenhouse / Lever.
    const content = [
      sections.companyDescription?.text ?? '',
      sections.jobDescription?.text ?? '',
      sections.qualifications?.text ?? '',
      sections.additionalInformation?.text ?? '',
    ].filter(Boolean).join('\n');
    if (!content) return null;
    const salaryInfo = extractSalary(content);
    const { qualifications, responsibilities } = extractSections(content);
    return {
      ...listing,
      salary: salaryInfo?.display || listing.salary,
      salaryMin: salaryInfo?.min || listing.salaryMin,
      salaryMax: salaryInfo?.max || listing.salaryMax,
      salaryCurrency: salaryInfo?.currency ?? listing.salaryCurrency ?? null,
      content,
      qualifications,
      responsibilities,
    };
  }

  if (listing.ats === 'eightfold') {
    // Eightfold listing IDs: `ef-{boardToken}-{positionId}`. We need the
    // eightfoldHost to hit the detail endpoint — look it up in the
    // sources list so callers don't have to thread it through.
    const { COMPANY_SOURCES } = await import('./sources');
    const src = COMPANY_SOURCES.find(
      (s) => s.slug === listing.companySlug || s.boardToken === listing.id.split('-')[1]
    );
    if (!src?.eightfoldHost) return null;

    const detail = await fetchEightfoldJobDetail(src.eightfoldHost, listing.sourceId);
    if (!detail) return null;

    const content = detail.job_description || '';
    if (!content) return null;

    const salaryInfo = extractSalary(content);
    const { qualifications, responsibilities } = extractSections(content);

    return {
      ...listing,
      salary: salaryInfo?.display || listing.salary,
      salaryMin: salaryInfo?.min ?? listing.salaryMin,
      salaryMax: salaryInfo?.max ?? listing.salaryMax,
      salaryCurrency: salaryInfo?.currency ?? listing.salaryCurrency ?? null,
      content,
      qualifications,
      responsibilities,
    };
  }

  // Apple: hit the per-role detail page via headless Chromium. Enables
  // ATS scoring + tailoring for Apple listings (previously the route
  // returned null for apple and the UI hid the Tailor button).
  if (listing.ats === 'apple') {
    try {
      const detail = await fetchAppleJobDetailViaPuppeteer(listing.url);
      if (!detail || !detail.content) return null;
      const salaryInfo = extractSalary(detail.content);
      const { qualifications, responsibilities } = extractSections(detail.content);
      return {
        ...listing,
        salary: salaryInfo?.display || listing.salary,
        salaryMin: salaryInfo?.min ?? listing.salaryMin,
        salaryMax: salaryInfo?.max ?? listing.salaryMax,
        salaryCurrency: salaryInfo?.currency ?? listing.salaryCurrency ?? null,
        content: detail.content,
        qualifications,
        responsibilities,
      };
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(
        `Apple detail fetch failed for ${listing.id}: ` +
        `${err instanceof Error ? err.message : String(err)}`,
      );
      return null;
    }
  }

  if (listing.ats === 'uber') {
    // Uber's per-listing pages now serve a clean schema.org JSON-LD
    // <script type="application/ld+json"> block containing the full
    // JobPosting (title, datePosted, description, hiringOrganization,
    // jobLocation, …). The old unicode-escaped JSON we used to pull
    // out only captured a 123-char fragment of the description on
    // current pages — JSON-LD is the canonical source. Falling back
    // to the old pattern only when JSON-LD is missing.
    //
    // Required headers: Uber's CDN now returns 406 Not Acceptable
    // unless we send a browser-shape Accept header.
    try {
      const res = await fetch(listing.url, {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
        },
        redirect: 'follow',
        signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) return null;
      const html = await res.text();

      const decodeEntities = (s: string): string =>
        s
          .replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>')
          .replace(/&quot;/g, '"')
          .replace(/&#39;/g, "'")
          .replace(/&nbsp;/g, ' ')
          .replace(/&amp;/g, '&'); // last so we don't double-decode

      let descriptionHtml = '';

      // Primary path: parse the schema.org JobPosting block.
      const ldMatches = html.match(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g);
      if (ldMatches) {
        for (const block of ldMatches) {
          const inner = block.replace(/<script[^>]*>|<\/script>/g, '');
          try {
            const parsed = JSON.parse(inner);
            const node = Array.isArray(parsed) ? parsed.find((p) => p?.['@type'] === 'JobPosting') : parsed;
            if (node && node['@type'] === 'JobPosting' && typeof node.description === 'string') {
              descriptionHtml = decodeEntities(node.description);
              break;
            }
          } catch {
            /* not valid JSON — skip */
          }
        }
      }

      // Fallback: legacy unicode-escaped pattern (older Uber pages
      // still in cache may serve this shape).
      if (!descriptionHtml) {
        const m = html.match(
          /\\u0022description\\u0022:\\u0022((?:[^\\]|\\.){50,20000}?)\\u0022/,
        );
        if (m) {
          try {
            descriptionHtml = decodeEntities(JSON.parse(`"${m[1]}"`));
          } catch {
            /* fall through */
          }
        }
      }

      if (!descriptionHtml) return null;

      const { qualifications, responsibilities } = extractSections(descriptionHtml);
      return {
        ...listing,
        content: descriptionHtml,
        qualifications,
        responsibilities,
      };
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(
        `Uber detail fetch failed for ${listing.id}: ` +
        `${err instanceof Error ? err.message : String(err)}`,
      );
      return null;
    }
  }

  // Other custom ATSs (google, microsoft, amazon, meta, workday):
  // we don't have a cheap single-job detail endpoint for these. Return null
  // rather than inventing synthetic content — a JD built from just the title
  // has so few keywords that scoring against it produces noise (1/1 → 100%,
  // 0/0 → 0%). Callers should treat null as "not scorable" and move on.
  return null;
}

// Re-export the client-safe predicate from ./scorable so server-side callers
// that were already importing from this module keep working.
export { isUnscorableAts } from './scorable';

// =========================================================
// Section extraction helpers
// =========================================================
function extractSections(html: string): { qualifications: string[]; responsibilities: string[] } {
  const qualifications: string[] = [];
  const responsibilities: string[] = [];

  // Split by headers
  const sections = html.split(/<h[2-4][^>]*>/i);

  for (const section of sections) {
    const lowerSection = section.toLowerCase();
    const items = extractListItems(section);

    if (lowerSection.includes('qualif') || lowerSection.includes('requirement') || lowerSection.includes('what you need') || lowerSection.includes('who you are') || lowerSection.includes('minimum')) {
      qualifications.push(...items);
    } else if (lowerSection.includes('responsibilit') || lowerSection.includes('what you\'ll do') || lowerSection.includes('about the role') || lowerSection.includes('you will')) {
      responsibilities.push(...items);
    }
  }

  return { qualifications, responsibilities };
}

function extractSectionsFromLever(post: LeverPosting): { qualifications: string[]; responsibilities: string[] } {
  const qualifications: string[] = [];
  const responsibilities: string[] = [];

  for (const list of post.lists || []) {
    const header = list.text.toLowerCase();
    const items = extractListItems(list.content);

    if (header.includes('qualif') || header.includes('requirement') || header.includes('what you need') || header.includes('who you are')) {
      qualifications.push(...items);
    } else if (header.includes('responsibilit') || header.includes('what you\'ll') || header.includes('you will')) {
      responsibilities.push(...items);
    }
  }

  return { qualifications, responsibilities };
}

function extractListItems(html: string): string[] {
  const items: string[] = [];
  const liMatches = html.match(/<li[^>]*>([\s\S]*?)<\/li>/gi);
  if (liMatches) {
    for (const li of liMatches) {
      const text = li.replace(/<[^>]+>/g, '').trim();
      if (text.length > 5) items.push(text);
    }
  }
  return items;
}
