import { detectPortal } from './portal-detector';
import { fetchGreenhouseJobDetail, fetchLeverJobDetail, fetchAshbyJobDetail } from './job-fetcher';
import { COMPANY_SOURCES } from './sources';

export interface ExtractedJob {
  description: string;
  portal: ReturnType<typeof detectPortal>;
  companyName: string;
  jobTitle: string;
  location: string;
}

/**
 * Decode common HTML entities.
 */
function decodeEntities(str: string): string {
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&nbsp;/g, ' ');
}

/**
 * Strip HTML and collapse whitespace.
 */
function htmlToText(html: string): string {
  return decodeEntities(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|li|h[1-6]|tr)>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
  )
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

/**
 * Extract a pretty company name from a URL hostname.
 */
function companyFromHostname(url: string): string {
  try {
    const host = new URL(url).hostname.toLowerCase();
    const stripped = host.replace(/^(www\.|careers\.|jobs\.|hire\.|apply\.|boards?\.)/, '');
    const domain = stripped.split('.')[0];
    if (!domain || domain.length < 2) return '';
    return domain.charAt(0).toUpperCase() + domain.slice(1);
  } catch {
    return '';
  }
}

/**
 * Walk a JSON-LD blob looking for a JobPosting (or nested one).
 * Returns the first matching object or null.
 */
interface JobPostingLD {
  '@type'?: string | string[];
  title?: string;
  description?: string;
  hiringOrganization?: { name?: string } | string;
  jobLocation?: unknown;
  '@graph'?: unknown[];
}

function findJobPostingLD(data: unknown): JobPostingLD | null {
  if (!data) return null;
  if (Array.isArray(data)) {
    for (const item of data) {
      const found = findJobPostingLD(item);
      if (found) return found;
    }
    return null;
  }
  if (typeof data === 'object') {
    const obj = data as JobPostingLD;
    const t = obj['@type'];
    const isJob = Array.isArray(t) ? t.includes('JobPosting') : t === 'JobPosting';
    if (isJob) return obj;
    if (obj['@graph']) {
      const found = findJobPostingLD(obj['@graph']);
      if (found) return found;
    }
  }
  return null;
}

function extractLocationFromJobPosting(posting: JobPostingLD): string {
  const loc = posting.jobLocation;
  if (!loc) return '';
  const first = Array.isArray(loc) ? loc[0] : loc;
  if (!first || typeof first !== 'object') return '';
  const addr = (first as { address?: Record<string, string> }).address;
  if (!addr) return '';
  const parts = [addr.addressLocality, addr.addressRegion, addr.addressCountry].filter(Boolean);
  return parts.join(', ');
}

/**
 * Try to extract a location from common meta tags or JSON-LD.
 */
function extractLocation(html: string): string {
  // 1. og:locale / place:location
  const ogLocMatch = html.match(
    /<meta[^>]*property=["'](?:og:)?(?:place:)?location(?::region)?["'][^>]*content=["'](.*?)["'][^>]*>/is
  );
  if (ogLocMatch) return decodeEntities(ogLocMatch[1].trim());

  // 2. JSON-LD jobLocation
  const jsonLdBlocks = html.match(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi);
  if (jsonLdBlocks) {
    for (const block of jsonLdBlocks) {
      const jsonStr = block.replace(/<\/?script[^>]*>/gi, '').trim();
      try {
        const data = JSON.parse(jsonStr);
        const posting = findJobPostingLD(data);
        if (posting) {
          const loc = extractLocationFromJobPosting(posting);
          if (loc) return loc;
        }
      } catch {
        // Ignore invalid JSON-LD blocks
      }
    }
  }

  // 3. Greenhouse / Lever "location" span or div (common pattern)
  const locDivMatch = html.match(
    /<(?:span|div)[^>]*class=["'][^"']*location[^"']*["'][^>]*>(.*?)<\/(?:span|div)>/is
  );
  if (locDivMatch) {
    const text = locDivMatch[1].replace(/<[^>]+>/g, '').trim();
    if (text.length > 2 && text.length < 100) return decodeEntities(text);
  }

  return '';
}

// ─── Direct ATS dispatch ────────────────────────────────────────────
//
// Many public career pages are client-rendered SPAs (Uber, Lyft, Stripe,
// etc.) and a raw `fetch` returns an empty shell with no job data.
// But most of them are powered by a public Greenhouse / Lever / Ashby
// board, so we can skip the scrape entirely by detecting the URL
// pattern and calling the ATS API directly.

interface AtsRoute {
  ats: 'greenhouse' | 'lever' | 'ashby';
  boardToken: string;
  jobId: string;
  /** Optional company override when hostname → source lookup fails. */
  company?: string;
}

/**
 * Try to map an arbitrary job-listing URL to a Greenhouse/Lever/Ashby
 * board + job id. Returns null if the URL doesn't match a known pattern.
 */
function detectAtsRoute(url: string): AtsRoute | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const host = parsed.hostname.toLowerCase();
  const pathname = parsed.pathname;

  // 1. Direct Greenhouse-hosted board: boards.greenhouse.io/{token}/jobs/{id}
  if (host.endsWith('greenhouse.io')) {
    const m = pathname.match(/\/([^/]+)\/jobs\/(\d+)/);
    if (m) return { ats: 'greenhouse', boardToken: m[1], jobId: m[2] };
  }

  // 2. Direct Greenhouse embed: job-boards.greenhouse.io/{token}/jobs/{id}
  //    (newer URL format)
  if (host === 'job-boards.greenhouse.io') {
    const m = pathname.match(/\/([^/]+)\/jobs\/(\d+)/);
    if (m) return { ats: 'greenhouse', boardToken: m[1], jobId: m[2] };
  }

  // 3. Direct Lever-hosted board: jobs.lever.co/{token}/{uuid}
  if (host === 'jobs.lever.co') {
    const m = pathname.match(/^\/([^/]+)\/([a-f0-9-]{20,})/i);
    if (m) return { ats: 'lever', boardToken: m[1], jobId: m[2] };
  }

  // 4. Direct Ashby-hosted board: jobs.ashbyhq.com/{token}/{uuid}
  if (host === 'jobs.ashbyhq.com') {
    const m = pathname.match(/^\/([^/]+)\/([a-f0-9-]{20,})/i);
    if (m) return { ats: 'ashby', boardToken: m[1], jobId: m[2] };
  }

  // 5. Uber careers: www.uber.com/global/en/careers/list/{id}/
  //    Uber's public board is powered by Greenhouse (boardToken: "uber").
  if (host.endsWith('uber.com')) {
    const m = pathname.match(/\/careers\/list\/(\d+)/);
    if (m) return { ats: 'greenhouse', boardToken: 'uber', jobId: m[1], company: 'Uber' };
  }

  // 6. Lyft careers: www.lyft.com/careers/{slug}?jr={id} or similar
  if (host.endsWith('lyft.com')) {
    const m = pathname.match(/\/careers\/(\d+)/) ||
              parsed.search.match(/[?&]jr=(\d+)/);
    if (m) return { ats: 'greenhouse', boardToken: 'lyft', jobId: m[1], company: 'Lyft' };
  }

  // 7. Stripe careers: stripe.com/jobs/listing/{slug}/{id}
  if (host.endsWith('stripe.com')) {
    const m = pathname.match(/\/(?:jobs|careers)\/(?:listing\/)?[^/]+\/(\d+)/);
    if (m) return { ats: 'greenhouse', boardToken: 'stripe', jobId: m[1], company: 'Stripe' };
  }

  // 8. Airbnb, Pinterest, DoorDash, etc. often embed Greenhouse via their
  //    own careers site at /jobs/{id} style URLs. We fall through to generic.

  // 9. Generic: look for a numeric id at the tail of the path; then try to
  //    match the hostname against a known COMPANY_SOURCES entry. We only
  //    dispatch to the three public ATSs here — custom-API companies
  //    (Google/Apple/Microsoft/etc.) are handled by extractViaHtml's
  //    JSON-LD path, which is richer and more reliable for a single URL.
  const generic = pathname.match(/\/(\d{5,})\/?$/);
  if (generic) {
    const tokenRoot = host.replace(/^(www\.|careers\.|jobs\.|hire\.|apply\.)/, '').split('.')[0];
    const source = COMPANY_SOURCES.find(
      (s) => s.slug === tokenRoot || s.boardToken === tokenRoot,
    );
    if (
      source &&
      (source.ats === 'greenhouse' || source.ats === 'lever' || source.ats === 'ashby')
    ) {
      return {
        ats: source.ats,
        boardToken: source.boardToken,
        jobId: generic[1],
        company: source.name,
      };
    }
  }

  return null;
}

/**
 * Try to fetch a job via the ATS API. Returns null if the ATS route
 * lookup fails (caller falls back to HTML scraping).
 */
async function extractViaAts(url: string): Promise<ExtractedJob | null> {
  const route = detectAtsRoute(url);
  if (!route) return null;

  const source = COMPANY_SOURCES.find((s) => s.boardToken === route.boardToken);
  const companyName = route.company || source?.name || companyFromHostname(url);

  try {
    if (route.ats === 'greenhouse') {
      const detail = await fetchGreenhouseJobDetail(route.boardToken, route.jobId);
      if (!detail) return null;
      return {
        description: htmlToText(detail.content || '').slice(0, 15000),
        portal: detectPortal(url),
        companyName,
        jobTitle: detail.title || '',
        location: detail.location?.name || '',
      };
    }
    if (route.ats === 'lever') {
      const detail = await fetchLeverJobDetail(route.boardToken, route.jobId);
      if (!detail) return null;
      const allContent = [
        detail.descriptionPlain || detail.description || '',
        ...(detail.lists || []).map((l) => `${l.text}\n${htmlToText(l.content)}`),
        detail.additionalPlain || detail.additional || '',
      ].join('\n\n');
      return {
        description: htmlToText(allContent).slice(0, 15000),
        portal: detectPortal(url),
        companyName,
        jobTitle: detail.text || '',
        location: detail.categories?.location || '',
      };
    }
    if (route.ats === 'ashby') {
      const detail = await fetchAshbyJobDetail(route.boardToken, route.jobId);
      if (!detail) return null;
      const content = detail.descriptionPlain || htmlToText(detail.descriptionHtml || '');
      return {
        description: content.slice(0, 15000),
        portal: detectPortal(url),
        companyName,
        jobTitle: detail.title || '',
        location: detail.location || '',
      };
    }
  } catch {
    // Fall through to HTML scraper on any ATS error
    return null;
  }
  return null;
}

/**
 * Fallback: scrape the raw HTML for metadata.
 */
async function extractViaHtml(url: string): Promise<ExtractedJob> {
  const portal = detectPortal(url);

  const res = await fetch(url, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    },
    signal: AbortSignal.timeout(10000),
  });

  if (!res.ok) {
    throw new Error(`Failed to fetch URL: ${res.status} ${res.statusText}`);
  }

  const html = await res.text();

  // ── Prefer JSON-LD JobPosting when present (richest data) ──
  const jsonLdBlocks = html.match(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi);
  if (jsonLdBlocks) {
    for (const block of jsonLdBlocks) {
      const jsonStr = block.replace(/<\/?script[^>]*>/gi, '').trim();
      try {
        const data = JSON.parse(jsonStr);
        const posting = findJobPostingLD(data);
        if (posting && posting.title) {
          const orgName =
            typeof posting.hiringOrganization === 'object'
              ? posting.hiringOrganization?.name
              : posting.hiringOrganization;
          const description = htmlToText(posting.description || '').slice(0, 15000);
          if (description.length > 50) {
            return {
              description,
              portal,
              companyName: orgName || companyFromHostname(url),
              jobTitle: posting.title,
              location: extractLocationFromJobPosting(posting),
            };
          }
        }
      } catch {
        // ignore
      }
    }
  }

  // Extract title from HTML
  const titleMatch = html.match(/<title[^>]*>(.*?)<\/title>/is);
  const pageTitle = titleMatch ? decodeEntities(titleMatch[1].trim()) : '';

  // Extract meta description
  const metaDescMatch =
    html.match(/<meta[^>]*name=["']description["'][^>]*content=["'](.*?)["'][^>]*>/is) ||
    html.match(/<meta[^>]*content=["'](.*?)["'][^>]*name=["']description["'][^>]*>/is);
  const metaDesc = metaDescMatch ? metaDescMatch[1].trim() : '';

  // Extract og:title
  const ogTitleMatch =
    html.match(/<meta[^>]*property=["']og:title["'][^>]*content=["'](.*?)["'][^>]*>/is) ||
    html.match(/<meta[^>]*content=["'](.*?)["'][^>]*property=["']og:title["'][^>]*>/is);
  const ogTitle = ogTitleMatch ? ogTitleMatch[1].trim() : '';

  // Extract og:site_name (reliable company name source)
  const ogSiteMatch =
    html.match(/<meta[^>]*property=["']og:site_name["'][^>]*content=["'](.*?)["'][^>]*>/is) ||
    html.match(/<meta[^>]*content=["'](.*?)["'][^>]*property=["']og:site_name["'][^>]*>/is);
  const ogSiteName = ogSiteMatch ? decodeEntities(ogSiteMatch[1].trim()) : '';

  // Strip HTML tags for description — get the body text
  const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  const bodyHtml = bodyMatch ? bodyMatch[1] : html;

  const cleaned = bodyHtml
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<nav[\s\S]*?<\/nav>/gi, '')
    .replace(/<header[\s\S]*?<\/header>/gi, '')
    .replace(/<footer[\s\S]*?<\/footer>/gi, '')
    .replace(/<[^>]+>/g, '\n')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]+/g, ' ')
    .trim();

  // ── Parse job title and company from the page title ──
  let jobTitle = '';
  let companyName = '';
  const titleStr = ogTitle || pageTitle;

  if (titleStr) {
    // Pattern 1 — "Senior EM at Stripe | LinkedIn"
    const atMatch = titleStr.match(/^(.+?)\s+at\s+(.+?)(?:\s*[|–—-]\s*.+)?$/i);
    if (atMatch) {
      jobTitle = atMatch[1].trim();
      companyName = atMatch[2].trim();
    } else {
      // Pattern 2 — "Job Title - Company | Site"
      const dashMatch = titleStr.match(/^(.+?)\s*[–—-]\s*(.+?)(?:\s*[|–—-]\s*.+)?$/);
      if (dashMatch) {
        jobTitle = dashMatch[1].trim();
        companyName = dashMatch[2].trim();
      } else {
        // Fallback — take everything before the first delimiter
        jobTitle = titleStr.split(/[|–—-]/)[0].trim();
      }
    }
  }

  // ── Fallback: company from og:site_name or URL hostname ──
  if (!companyName && ogSiteName) {
    const genericSites = ['linkedin', 'indeed', 'glassdoor', 'ziprecruiter', 'monster', 'dice'];
    if (!genericSites.includes(ogSiteName.toLowerCase())) {
      companyName = ogSiteName;
    }
  }
  if (!companyName) {
    companyName = companyFromHostname(url);
  }

  // ── Extract location ──
  const location = extractLocation(html);

  // Use the longer of cleaned body or meta description
  const description = cleaned.length > 200 ? cleaned.slice(0, 15000) : metaDesc || cleaned;

  return {
    description,
    portal,
    companyName,
    jobTitle,
    location,
  };
}

/**
 * Public entry point. Tries ATS-direct first (works for SPA-rendered
 * career pages like Uber, Lyft, Stripe); falls back to HTML scraping.
 */
export async function extractJobFromUrl(url: string): Promise<ExtractedJob> {
  // Fast path — ATS API returns structured JSON with title, location, content.
  const viaAts = await extractViaAts(url);
  if (viaAts && viaAts.description.length > 100) return viaAts;

  // Fallback — scrape HTML (JSON-LD first, then og/meta/title).
  const viaHtml = await extractViaHtml(url);

  // If HTML scraping returned almost nothing (SPA shell) and ATS gave us
  // at least partial data (e.g. title/company but short description),
  // prefer the ATS result.
  if (viaAts && viaHtml.description.length < 200) return viaAts;

  return viaHtml;
}
