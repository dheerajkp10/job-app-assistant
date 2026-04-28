/**
 * Puppeteer-based (headless-browser) fetchers for careers sites whose
 * server-side JSON APIs are locked down, stale, or protected.
 *
 * Right now that's Apple (jobs.apple.com) and Meta (metacareers.com):
 *
 *   - Apple's public `/api/role/search` endpoint 301-redirects to a
 *     "page not found" and `/api/v1/jobs` returns 401. The only way to
 *     enumerate current roles without auth is to load the JS-rendered
 *     search page.
 *   - Meta's GraphQL endpoint (doc_id=…) works for some hashes but the
 *     hash rotates, and the unauth `jobs/` and `jobsearch` pages return
 *     a 1.5KB SSR shell that requires a client hydration pass before
 *     listings are rendered.
 *
 * Tradeoffs vs the JSON fetchers in custom-fetchers.ts:
 *   + Works when the JSON APIs don't.
 *   - Much slower: ~20–60s per fetch, launches Chromium.
 *   - Adds ~170MB to node_modules for the bundled Chromium binary.
 *   - Per-job detail endpoints are not scraped (would be 1 page
 *     navigation per listing, too slow for 1000s of jobs). Apple/Meta
 *     stay in `isUnscorableAts()`.
 *
 * Implementation notes:
 *   - Puppeteer is imported dynamically the first time a fetcher runs so
 *     the app doesn't pay the module-load cost (or the Chromium boot
 *     time) for users who never hit Apple/Meta.
 *   - A single Chromium instance is shared across fetchers via
 *     `getBrowser()`. We open a fresh page per call and close it when
 *     done. The browser itself stays alive for subsequent fetches in
 *     the same server process.
 *   - Every fetcher has a hard cap on pages/scrolls so a page-structure
 *     change on Apple/Meta can't spin forever.
 */

import type { CompanySource, JobListing } from './types';

// Chromium UA — Puppeteer's default UA advertises HeadlessChrome which
// Meta in particular sometimes refuses to hydrate for. Spoof a real UA.
const REAL_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';

const NAV_TIMEOUT_MS = 45_000;
const SELECTOR_TIMEOUT_MS = 20_000;

// ─── Shared browser singleton ─────────────────────────────────────────
// Puppeteer cold-start is ~1.5–3s. Keep one browser alive for the life
// of the server process and hand out fresh pages.
//
// We use `unknown` for the cached promise so the type-only Puppeteer
// import below doesn't force consumers of this module to resolve
// `puppeteer` types at compile time (it's still a heavy optional dep).

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PuppeteerBrowser = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PuppeteerPage = any;

let browserPromise: Promise<PuppeteerBrowser> | null = null;

async function getBrowser(): Promise<PuppeteerBrowser> {
  if (browserPromise) return browserPromise;
  browserPromise = (async () => {
    let puppeteer;
    try {
      // Dynamic import so `puppeteer` stays optional — if the user hasn't
      // installed it (or Chromium failed to download) we throw a clear
      // error that surfaces in the UI fetch-error panel.
      puppeteer = await import('puppeteer');
    } catch (err) {
      browserPromise = null;
      throw new Error(
        `Puppeteer is not installed. Run \`npm install puppeteer\` to enable Apple/Meta fetchers. ` +
        `(${err instanceof Error ? err.message : String(err)})`
      );
    }
    // The default export is the puppeteer instance; a few Node module
    // resolution paths return it under `.default`.
    const pptr = (puppeteer as unknown as { default?: unknown }).default ?? puppeteer;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const browser = await (pptr as any).launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-blink-features=AutomationControlled',
        '--disable-features=IsolateOrigins,site-per-process',
      ],
    });
    // If Chromium dies (SIGKILL etc.) reset the singleton so the next
    // call re-launches instead of handing back a dead handle.
    browser.on('disconnected', () => {
      browserPromise = null;
    });
    return browser;
  })();
  try {
    return await browserPromise;
  } catch (err) {
    browserPromise = null;
    throw err;
  }
}

async function withPage<T>(fn: (page: PuppeteerPage) => Promise<T>): Promise<T> {
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    await page.setUserAgent(REAL_UA);
    await page.setViewport({ width: 1366, height: 900 });
    // Block heavy resources we don't need — cuts page load by ~5–10s on
    // ad-heavy careers sites.
    await page.setRequestInterception(true);
    page.on('request', (req: { resourceType: () => string; abort: () => void; continue: () => void }) => {
      const type = req.resourceType();
      if (type === 'image' || type === 'font' || type === 'media') {
        req.abort();
      } else {
        req.continue();
      }
    });
    return await fn(page);
  } finally {
    try { await page.close(); } catch { /* ignore */ }
  }
}

/**
 * Close the shared browser. Useful for tests and for a clean shutdown
 * when the Next.js dev server hot-reloads.
 */
export async function closePuppeteerBrowser(): Promise<void> {
  if (!browserPromise) return;
  try {
    const browser = await browserPromise;
    await browser.close();
  } catch { /* ignore */ } finally {
    browserPromise = null;
  }
}

// =========================================================
// Apple Jobs (Puppeteer)
// =========================================================
// We scrape the public search results at
//   https://jobs.apple.com/en-us/search?location=united-states-USA&sort=newest&page=N
// Each result row has a link of the form
//   /en-us/details/{reqId}/{slug}?team=...
// so we pull req IDs + titles out of the rendered DOM. Location is the
// sibling cell text; team is often encoded as the `?team=` query param.
// =========================================================

const APPLE_MAX_PAGES = 25;           // Apple usually returns ≤20 pages for US search.
const APPLE_PAGE_DELAY_MS = 400;      // small throttle between pages.

interface ScrapedAppleRow {
  reqId: string;
  title: string;
  location: string;
  team: string;
  href: string;
}

export async function fetchAppleJobsViaPuppeteer(source: CompanySource): Promise<JobListing[]> {
  const listings: JobListing[] = [];
  const seen = new Set<string>();

  return withPage(async (page) => {
    for (let pageNum = 1; pageNum <= APPLE_MAX_PAGES; pageNum++) {
      const url =
        `https://jobs.apple.com/en-us/search?` +
        `location=united-states-USA&sort=newest&page=${pageNum}`;

      try {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS });
      } catch (err) {
        if (pageNum === 1) {
          throw new Error(
            `Apple (Puppeteer) navigation failed: ${err instanceof Error ? err.message : String(err)}`
          );
        }
        break;
      }

      // Wait for a result row to appear. Apple's DOM has shifted over
      // time; try a few known selectors, fall back to any link matching
      // the detail URL pattern.
      try {
        await page.waitForSelector(
          'a[href*="/en-us/details/"], table.jobs a[href*="/details/"]',
          { timeout: SELECTOR_TIMEOUT_MS },
        );
      } catch {
        if (pageNum === 1) {
          throw new Error('Apple (Puppeteer) page 1 had no visible job links');
        }
        break;
      }

      // Extract rows in the browser context. This is tolerant of
      // Apple's layout churn: we just look for anchors whose href
      // matches the detail URL shape.
      const rows: ScrapedAppleRow[] = await page.evaluate(() => {
        const anchors = Array.from(
          document.querySelectorAll<HTMLAnchorElement>('a[href*="/en-us/details/"]'),
        );
        const out: ScrapedAppleRow[] = [];
        const seen = new Set<string>();
        for (const a of anchors) {
          const href = a.getAttribute('href') || '';
          // /en-us/details/200598471/software-engineer?team=...
          const m = href.match(/\/details\/(\d+)(?:\/([^?#]*))?/);
          if (!m) continue;
          const reqId = m[1];
          if (seen.has(reqId)) continue;
          seen.add(reqId);

          const title = (a.textContent || '').replace(/\s+/g, ' ').trim();
          if (!title) continue;

          // Walk up to the enclosing row/card to find sibling location text.
          let loc = '';
          let node: HTMLElement | null = a;
          for (let i = 0; i < 5 && node; i++) {
            node = node.parentElement;
            if (!node) break;
            // Any element with "location" in its class or data attr is a
            // strong signal; fall back to the whole row text on exit.
            const locEl = node.querySelector(
              '[class*="location" i], [data-automation*="location" i]',
            );
            if (locEl) {
              loc = (locEl.textContent || '').replace(/\s+/g, ' ').trim();
              if (loc) break;
            }
          }
          if (!loc && node) {
            // Last-resort: strip the title out of the row text.
            const rowText = (node.textContent || '').replace(/\s+/g, ' ').trim();
            loc = rowText.replace(title, '').slice(0, 120).trim();
          }
          // Apple prefixes the location text with a visually-hidden
          // "Location" label (screen-reader aid) that shows up as
          // "LocationAustin" etc. when we read textContent. Strip it.
          loc = loc.replace(/^Location\s*/i, '').trim();

          const teamMatch = href.match(/[?&]team=([^&#]+)/);
          const team = teamMatch ? decodeURIComponent(teamMatch[1]).replace(/\+/g, ' ') : '';

          out.push({
            reqId,
            title,
            location: loc || 'United States',
            team,
            href: href.startsWith('http') ? href : `https://jobs.apple.com${href}`,
          });
        }
        return out;
      });

      let newThisPage = 0;
      for (const row of rows) {
        if (seen.has(row.reqId)) continue;
        seen.add(row.reqId);
        newThisPage++;
        listings.push({
          id: `ap-${source.boardToken}-${row.reqId}`,
          sourceId: row.reqId,
          company: source.name,
          companySlug: source.slug,
          title: row.title,
          location: row.location,
          department: row.team,
          salary: null,
          salaryMin: null,
          salaryMax: null,
          url: row.href,
          ats: 'apple',
          postedAt: null,
          updatedAt: null,
          fetchedAt: new Date().toISOString(),
        });
      }

      // Stop as soon as a page contributes no new listings (end of
      // results, or Apple stopped paginating).
      if (newThisPage === 0) break;

      // Small delay before next page to stay polite.
      await new Promise((r) => setTimeout(r, APPLE_PAGE_DELAY_MS));
    }

    return listings;
  });
}

// =========================================================
// Apple Job Detail (Puppeteer)
// =========================================================
// Apple's per-role detail page renders the JD in a server-hydrated
// React tree at `/en-us/details/{reqId}/{slug}`. There's no public
// JSON endpoint for a single role (the enumeration API is 301'd —
// see the header comment at the top of this file), so we navigate
// to the detail URL and pull the rendered JD text out of the DOM.
//
// We extract the concatenated text of the known content containers:
//   - [data-automation="job-description"]  (newer layout)
//   - section#jd-description, section#jd-job-description (current)
//   - .jd-description, .rc-jobdetails                  (older class-based)
// and fall back to the <main> element if none of the above match,
// which covers layout churn without hard-coding brittle selectors.
// =========================================================

export interface AppleJobDetailResult {
  /** Full plain-text JD body, roughly equivalent to copy-pasting the
   *  page content. Includes role description + qualifications +
   *  responsibilities, whichever the page renders. */
  content: string;
}

export async function fetchAppleJobDetailViaPuppeteer(
  url: string,
): Promise<AppleJobDetailResult | null> {
  return withPage(async (page) => {
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(
        `Apple detail navigation failed (${url}): ` +
        `${err instanceof Error ? err.message : String(err)}`,
      );
      return null;
    }

    // Wait for any of the known JD containers to appear. Fall back to
    // <main> so we still scrape SOMETHING if Apple ships a layout
    // change we haven't mapped yet.
    try {
      await page.waitForSelector(
        [
          '[data-automation="job-description"]',
          'section#jd-description',
          'section#jd-job-description',
          '.jd-description',
          '.rc-jobdetails',
          'main',
        ].join(', '),
        { timeout: SELECTOR_TIMEOUT_MS },
      );
    } catch {
      return null;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const text: string = await page.evaluate(() => {
      const selectors = [
        '[data-automation="job-description"]',
        'section#jd-description',
        'section#jd-job-description',
        '.jd-description',
        '.rc-jobdetails',
      ];
      const parts: string[] = [];
      for (const sel of selectors) {
        const els = document.querySelectorAll(sel);
        for (const el of Array.from(els)) {
          const t = (el.textContent || '').replace(/\s+/g, ' ').trim();
          if (t && !parts.includes(t)) parts.push(t);
        }
      }
      // If none of the specific containers matched, grab the <main>
      // contents — noisier but still gives us the JD text.
      if (parts.length === 0) {
        const main = document.querySelector('main');
        const t = (main?.textContent || '').replace(/\s+/g, ' ').trim();
        if (t) parts.push(t);
      }
      return parts.join('\n\n');
    });

    const content = (text || '').trim();
    // Apple's login-wall / rate-limit responses render with ~200 chars
    // of boilerplate. Require a minimum length to call it success.
    if (content.length < 200) return null;
    return { content };
  });
}

// =========================================================
// Meta Careers (Puppeteer)
// =========================================================
// metacareers.com is a heavily obfuscated React app. The rendered DOM
// only ever shows ~12 "featured" jobs + a handful of virtual-scroll
// placeholders — scraping the DOM would require thousands of page
// interactions and still wouldn't return everything.
//
// BUT: under the hood the page makes a single GraphQL call,
// `CareersJobSearchResultsDataQuery`, which returns the full list of
// all open jobs (~500-600 at a time for a given filter set) in one
// ~125KB response. We let Puppeteer do the hard work of negotiating
// Meta's auth/CSRF/session state by loading the page normally, then
// we just intercept that one response and parse it.
//
// This is much faster and more reliable than DOM scraping. If Meta
// rotates the query name we'll need to update FRIENDLY_NAME, but doc_id
// rotation doesn't break us because we don't replay the request — we
// only read the response the browser already made.
// =========================================================

const META_FRIENDLY_NAME = 'CareersJobSearchResultsDataQuery';
const META_RESPONSE_TIMEOUT_MS = 30_000;

interface MetaGraphQLJob {
  id?: string;
  title?: string;
  locations?: string[];
  teams?: string[];
  sub_teams?: string[];
}

export async function fetchMetaJobsViaPuppeteer(source: CompanySource): Promise<JobListing[]> {
  return withPage(async (page) => {
    // Set up the response listener BEFORE navigating so we don't miss
    // the initial GraphQL call (Meta fires it immediately on load).
    let resolveResponse: (jobs: MetaGraphQLJob[]) => void;
    let rejectResponse: (err: Error) => void;
    const responsePromise = new Promise<MetaGraphQLJob[]>((resolve, reject) => {
      resolveResponse = resolve;
      rejectResponse = reject;
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const onResponse = async (res: any) => {
      const url = res.url();
      if (!url.includes('/graphql')) return;
      const post: string = res.request().postData() || '';
      // GraphQL calls are URL-encoded form posts; the friendly name is
      // in the body rather than the URL or headers.
      if (!post.includes(`fb_api_req_friendly_name=${META_FRIENDLY_NAME}`)) return;
      try {
        const text: string = await res.text();
        const json = JSON.parse(text);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const data = (json as any)?.data?.job_search_with_featured_jobs;
        const allJobs: MetaGraphQLJob[] = (data?.all_jobs || data?.featured_jobs || []) as MetaGraphQLJob[];
        resolveResponse(allJobs);
      } catch (err) {
        rejectResponse(
          new Error(`Meta GraphQL response parse failed: ${err instanceof Error ? err.message : String(err)}`),
        );
      }
    };
    page.on('response', onResponse);

    // Navigate — Meta redirects /jobs/ → /jobsearch; both trigger the
    // same GraphQL query on hydration.
    try {
      await page.goto('https://www.metacareers.com/jobs/', {
        waitUntil: 'domcontentloaded',
        timeout: NAV_TIMEOUT_MS,
      });
    } catch (err) {
      throw new Error(
        `Meta (Puppeteer) navigation failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    // Race the GraphQL response against a timeout.
    const timeoutPromise = new Promise<MetaGraphQLJob[]>((_, reject) =>
      setTimeout(
        () => reject(new Error(`Meta GraphQL ${META_FRIENDLY_NAME} did not fire within ${META_RESPONSE_TIMEOUT_MS}ms`)),
        META_RESPONSE_TIMEOUT_MS,
      ),
    );

    let jobs: MetaGraphQLJob[];
    try {
      jobs = await Promise.race([responsePromise, timeoutPromise]);
    } finally {
      page.off('response', onResponse);
    }

    const listings: JobListing[] = [];
    const seen = new Set<string>();
    for (const job of jobs) {
      const jobId = job.id ? String(job.id) : '';
      const title = job.title || '';
      if (!jobId || !title || seen.has(jobId)) continue;
      seen.add(jobId);
      const location = (job.locations || []).filter(Boolean).join(' · ') || 'Multiple Locations';
      const team = (job.teams && job.teams[0]) || (job.sub_teams && job.sub_teams[0]) || '';
      listings.push({
        id: `mt-${source.boardToken}-${jobId}`,
        sourceId: jobId,
        company: source.name,
        companySlug: source.slug,
        title,
        location,
        department: team,
        salary: null,
        salaryMin: null,
        salaryMax: null,
        url: `https://www.metacareers.com/jobs/${jobId}/`,
        ats: 'meta',
        postedAt: null,
        updatedAt: null,
        fetchedAt: new Date().toISOString(),
      });
    }

    return listings;
  });
}
