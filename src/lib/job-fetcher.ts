import type { CompanySource, JobListing, JobListingDetail } from './types';
import { extractSalary } from './salary-parser';
import { unescapeHtml } from './html-utils';
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
  const url = `https://boards-api.greenhouse.io/v1/boards/${source.boardToken}/jobs`;
  const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  const jobs: GreenhouseJob[] = data.jobs || [];

  return jobs.map((job) => ({
    id: `gh-${source.boardToken}-${job.id}`,
    sourceId: String(job.id),
    company: source.name,
    companySlug: source.slug,
    title: job.title,
    location: job.location?.name || 'Not specified',
    department: job.departments?.[0]?.name || '',
    salary: null,
    salaryMin: null,
    salaryMax: null,
    url: job.absolute_url,
    ats: 'greenhouse' as const,
    postedAt: job.updated_at,
    updatedAt: job.updated_at,
    fetchedAt: new Date().toISOString(),
  }));
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
  const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
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
  const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data: AshbyBoardResponse = await res.json();
  const jobs = data.jobs || [];

  return jobs.map((job) => {
    const salaryStr = job.compensation?.compensationTierSummary || null;
    const salaryInfo = salaryStr ? extractSalary(salaryStr) : null;
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
  }
}

export async function fetchAllJobs(sources: CompanySource[]): Promise<FetchResult> {
  const results = await Promise.allSettled(
    sources.map(async (source) => {
      const fetcher = pickFetcher(source);
      const jobs = await fetcher(source);
      return { source, jobs };
    })
  );

  const listings: JobListing[] = [];
  const errors: { company: string; error: string }[] = [];

  for (const result of results) {
    if (result.status === 'fulfilled') {
      listings.push(...result.value.jobs);
    } else {
      // Extract company name from the error context
      const idx = results.indexOf(result);
      const source = sources[idx];
      errors.push({
        company: source.name,
        error: result.reason?.message || 'Unknown error',
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

  return { listings: deduped, errors };
}

// =========================================================
// Detail fetcher — get full job content for a single listing
// =========================================================
export async function fetchJobDetail(
  listing: JobListing
): Promise<JobListingDetail | null> {
  // Manual listings: content is stored as a local file on disk.
  if (listing.id.startsWith('manual-')) {
    try {
      const { readFile } = await import('fs/promises');
      const { join } = await import('path');
      const { existsSync } = await import('fs');
      const filePath = join(process.cwd(), 'data', 'listing-details', `${listing.id}.html`);
      if (!existsSync(filePath)) return null;
      const content = await readFile(filePath, 'utf-8');
      return { ...listing, content, qualifications: [], responsibilities: [] };
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
    // Uber's individual careers pages embed the full job description as
    // unicode-escaped JSON inside a `<script type="application/json">`.
    // We fetch the page directly (cheaper than the bulk paginated API)
    // and pull the `description` value out via regex. The encoding
    // chain is gnarly (HTML-escaped → unicode-escaped → JSON string),
    // so we decode in three passes.
    try {
      const res = await fetch(listing.url, {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept-Language': 'en-US,en;q=0.9',
        },
        signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) return null;
      const html = await res.text();
      const m = html.match(
        /\\u0022description\\u0022:\\u0022((?:[^\\]|\\.){50,20000}?)\\u0022/,
      );
      if (!m) return null;
      // Pass 1: unicode-escape decode (handles ", \uXXXX).
      let decoded: string;
      try {
        decoded = JSON.parse(`"${m[1]}"`);
      } catch {
        return null;
      }
      // Pass 2: HTML-entity decode (the inner string was &lt;p&gt;…).
      decoded = decoded
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&amp;/g, '&')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&nbsp;/g, ' ');
      const { qualifications, responsibilities } = extractSections(decoded);
      return {
        ...listing,
        content: decoded,
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
