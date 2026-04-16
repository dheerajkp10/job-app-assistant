import { detectPortal } from './portal-detector';

interface ExtractedJob {
  description: string;
  portal: ReturnType<typeof detectPortal>;
  companyName: string;
  jobTitle: string;
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
  const pageTitle = titleMatch ? titleMatch[1].replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;/g, "'").replace(/&quot;/g, '"').trim() : '';

  // Extract meta description
  const metaDescMatch = html.match(/<meta[^>]*name=["']description["'][^>]*content=["'](.*?)["'][^>]*>/is)
    || html.match(/<meta[^>]*content=["'](.*?)["'][^>]*name=["']description["'][^>]*>/is);
  const metaDesc = metaDescMatch ? metaDescMatch[1].trim() : '';

  // Extract og:title
  const ogTitleMatch = html.match(/<meta[^>]*property=["']og:title["'][^>]*content=["'](.*?)["'][^>]*>/is)
    || html.match(/<meta[^>]*content=["'](.*?)["'][^>]*property=["']og:title["'][^>]*>/is);
  const ogTitle = ogTitleMatch ? ogTitleMatch[1].trim() : '';

  // Strip HTML tags for description - get the body text
  const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  const bodyHtml = bodyMatch ? bodyMatch[1] : html;

  // Remove script and style tags
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

  // Try to parse job title and company from page title
  // Common patterns: "Job Title - Company | LinkedIn", "Job Title at Company - Glassdoor"
  let jobTitle = '';
  let companyName = '';
  const titleStr = ogTitle || pageTitle;

  if (titleStr) {
    // LinkedIn: "Senior EM at Stripe | LinkedIn"
    const atMatch = titleStr.match(/^(.+?)\s+at\s+(.+?)(?:\s*[|–-]\s*.+)?$/i);
    if (atMatch) {
      jobTitle = atMatch[1].trim();
      companyName = atMatch[2].trim();
    } else {
      // Generic: "Job Title - Company | Site"
      const dashMatch = titleStr.match(/^(.+?)\s*[–-]\s*(.+?)(?:\s*[|–-]\s*.+)?$/);
      if (dashMatch) {
        jobTitle = dashMatch[1].trim();
        companyName = dashMatch[2].trim();
      } else {
        jobTitle = titleStr.split(/[|–-]/)[0].trim();
      }
    }
  }

  // Use the longer of cleaned body or meta description
  const description = cleaned.length > 200 ? cleaned.slice(0, 10000) : metaDesc || cleaned;

  return {
    description,
    portal,
    companyName,
    jobTitle,
  };
}
