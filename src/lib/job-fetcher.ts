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
} from './custom-fetchers';

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
    case 'apple':      return fetchAppleJobs;
    case 'microsoft':  return fetchMicrosoftJobs;
    case 'amazon':     return fetchAmazonJobs;
    case 'meta':       return fetchMetaJobs;
    case 'uber':       return fetchUberJobs;
    case 'workday':    return fetchWorkdayJobs;
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

  return { listings, errors };
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

  // Custom ATSs (google, apple, microsoft, amazon, meta, uber, workday):
  // we don't have a cheap single-job detail endpoint for these, so fall back
  // to a synthetic detail built from the listing's title/department/location.
  // This is enough signal for the ATS keyword scorer to produce a reasonable
  // match percentage — it's not as rich as a full JD but avoids these listings
  // showing "no score" forever (which would leave the progress bar stuck).
  const syntheticContent = [
    listing.title,
    listing.department,
    listing.location,
    listing.company,
  ]
    .filter(Boolean)
    .join(' — ');
  return {
    ...listing,
    content: syntheticContent,
    qualifications: [],
    responsibilities: [],
  };
}

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
