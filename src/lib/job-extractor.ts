import { detectPortal } from './portal-detector';

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
 * Extract a pretty company name from a URL hostname.
 * e.g. "jobs.lever.co" → "Lever",  "boards.greenhouse.io" → "Greenhouse"
 *       "careers.stripe.com" → "Stripe",  "www.google.com" → "Google"
 */
function companyFromHostname(url: string): string {
  try {
    const host = new URL(url).hostname.toLowerCase();
    // Strip "www.", "careers.", "jobs." prefixes
    const stripped = host.replace(/^(www\.|careers\.|jobs\.|hire\.|apply\.|boards?\.)/, '');
    // Take the first segment before .com, .io, etc.
    const domain = stripped.split('.')[0];
    if (!domain || domain.length < 2) return '';
    // Capitalize
    return domain.charAt(0).toUpperCase() + domain.slice(1);
  } catch {
    return '';
  }
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
  const jsonLdMatch = html.match(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi);
  if (jsonLdMatch) {
    for (const block of jsonLdMatch) {
      const jsonStr = block.replace(/<\/?script[^>]*>/gi, '');
      try {
        const data = JSON.parse(jsonStr);
        const loc = data?.jobLocation ?? data?.['@graph']?.[0]?.jobLocation;
        if (loc) {
          const addr = Array.isArray(loc) ? loc[0]?.address : loc?.address;
          if (addr) {
            const parts = [
              addr.addressLocality,
              addr.addressRegion,
              addr.addressCountry,
            ].filter(Boolean);
            if (parts.length > 0) return parts.join(', ');
          }
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

export async function extractJobFromUrl(url: string): Promise<ExtractedJob> {
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
    // Avoid generic site names like "LinkedIn", "Indeed", "Glassdoor"
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
  const description = cleaned.length > 200 ? cleaned.slice(0, 10000) : metaDesc || cleaned;

  return {
    description,
    portal,
    companyName,
    jobTitle,
    location,
  };
}
