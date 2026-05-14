#!/usr/bin/env node
/**
 * Take Puppeteer screenshots of every major page for the README,
 * with personal-data redaction so the public repo never leaks the
 * developer's real name / email / phone / address / resume filename.
 *
 * Redaction happens in-browser via page.evaluate() right before each
 * shot. The redaction set is sourced from /api/settings so it
 * automatically follows whatever profile is in the running dev DB:
 *
 *   - userName ............... → "Alex Carter"
 *   - baseResumeFileName ..... → "Resume.docx"
 *   - email pattern .......... → "alex@example.com"
 *   - US phone pattern ....... → "+1 (555) 555-0100"
 *   - 4-digit ZIP / US street → "100 Main St, Anytown, USA"
 *
 * Run with the dev server up at http://localhost:3000:
 *   npm run dev                              # one terminal
 *   node scripts/take-screenshots.mjs        # another
 *
 * Output → docs/screenshots/<name>.png at 1440×900 @ 2x DPR.
 */
import puppeteer from 'puppeteer';
import { mkdir } from 'fs/promises';
import { resolve } from 'path';

const BASE = 'http://localhost:3000';
const OUT_DIR = resolve('docs/screenshots');
const WIDTH = 1440;
const HEIGHT = 900;

// Placeholders the redactor will substitute. Pick names that look
// real enough to not jar the reader but obviously fictitious.
const FAKE = {
  fullName: 'Alex Carter',
  firstName: 'Alex',
  resumeFileName: 'Resume.docx',
  email: 'alex@example.com',
  phone: '+1 (555) 555-0100',
  address: '100 Main St, Anytown, USA',
  zip: '00000',
};

// Pages to capture. A `path` can be a string (static) or a fn that
// receives `context` (the listings + score-cache pulled at boot)
// and returns a string — used for /compare where we need to inject
// 3 real listing IDs so the page renders something meaningful.
const PAGES = [
  { name: '01-dashboard', path: '/dashboard' },
  { name: '02-listings',  path: '/listings'  },
  { name: '03-pipeline',  path: '/pipeline'  },
  {
    name: '04-compare',
    // Pre-select 3 high-scoring listings so the compare page
    // renders a real side-by-side view rather than the empty
    // state. Falls back to /compare if we can't find 3.
    path: (ctx) => {
      const top = ctx.topScoredListingIds.slice(0, 3);
      return top.length === 3 ? `/compare?ids=${top.join(',')}` : '/compare';
    },
  },
  { name: '05-add-job',   path: '/jobs/add'  },
  { name: '06-settings',  path: '/settings'  },
];

/**
 * Pick the listing IDs we'll seed into /compare. Highest-ATS-scoring
 * listings produce the most visually-interesting compare view (all
 * green chips, full category-bar breakdowns). We pull the listings
 * cache + score cache, filter to scored entries, and return the
 * top 5 IDs (the screenshot uses the first 3).
 */
async function fetchTopScoredListingIds() {
  try {
    const [listingsRes, scoresRes] = await Promise.all([
      fetch(`${BASE}/api/listings`).then((r) => r.json()),
      fetch(`${BASE}/api/scores-cache`).then((r) => r.json()),
    ]);
    const listings = listingsRes.listings ?? [];
    const scores = scoresRes ?? {};
    return listings
      .filter((l) => {
        const s = scores[l.id];
        return s && s.totalCount > 0 && s.overall >= 70;
      })
      .sort((a, b) => (scores[b.id].overall ?? 0) - (scores[a.id].overall ?? 0))
      .slice(0, 5)
      .map((l) => l.id);
  } catch (err) {
    console.warn(`  (couldn't load listings for compare seed: ${err.message})`);
    return [];
  }
}

/**
 * Pull every distinct company name from the listings cache and map
 * each one to a fictitious placeholder. Same real name → same fake
 * across screenshots so the same listing stays visually consistent
 * row-to-row. Uses a small pool of obviously-fictional brand names
 * (Hollywood / classic-business-school stand-ins) so a reader of the
 * README sees realistic-looking data without leaking which companies
 * the developer is actually looking at.
 */
async function buildCompanyAliasMap() {
  const FAKE_NAMES = [
    'Acme Corp', 'Globex', 'Initech', 'Hooli', 'Pied Piper',
    'Stark Industries', 'Wayne Enterprises', 'Wonka Industries',
    'Umbrella Co', 'Cyberdyne', 'Tyrell Corp', 'Soylent',
    'Massive Dynamic', 'Northwind', 'Contoso', 'Fabrikam',
    'Vandelay Industries', 'Bluth Co', 'Dunder Mifflin',
    'Sterling Cooper', 'Los Pollos', 'Oscorp', 'LexCorp',
    'Daily Planet', 'Cogswell Cogs', 'Spacely Sprockets',
    'Big Kahuna', 'Sirius Cybernetics', 'Yoyodyne', 'Aperture',
  ];
  try {
    const res = await fetch(`${BASE}/api/listings`);
    const data = await res.json();
    const listings = data.listings ?? [];
    // Pull unique company names. Sort by frequency descending so the
    // most-frequent real companies get the more memorable fake names
    // (the pool is finite — if the user has 100 distinct companies
    // we'll start cycling through name + " 2" etc, see below).
    const counts = new Map();
    for (const l of listings) {
      const c = (l.company ?? '').trim();
      if (c) counts.set(c, (counts.get(c) ?? 0) + 1);
    }
    const sorted = Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
    const map = {};
    let cycle = 0;
    for (let i = 0; i < sorted.length; i++) {
      const [realName] = sorted[i];
      // Pool cycles: first 30 get fresh names, next 30 get " II",
      // then " III", etc. Keeps things readable without name reuse.
      const base = FAKE_NAMES[i % FAKE_NAMES.length];
      cycle = Math.floor(i / FAKE_NAMES.length);
      const suffix = cycle === 0 ? '' : cycle === 1 ? ' II' : ` ${cycle + 1}`;
      map[realName] = `${base}${suffix}`;
    }
    return map;
  } catch {
    return {};
  }
}

async function fetchRealValues() {
  const res = await fetch(`${BASE}/api/settings`);
  const json = await res.json();
  const settings = json.settings ?? {};
  // The resume text holds name/email/phone/address — pull the
  // first few discoverables from it so we can substitute them
  // safely without having to know the exact format.
  const text = settings.baseResumeText ?? '';
  const phoneMatch = text.match(/\+?\d?[\s.-]?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/);
  const emailMatch = text.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i);
  // US street + ZIP — grabs the first matching line (best-effort).
  const addressMatch = text.match(/\d{1,5}\s+[\w.\s]+(?:,\s*[\w.\s]+)+(?:\s+\d{5})?/);
  return {
    userName: settings.userName ?? null,
    resumeFileName: settings.baseResumeFileName ?? null,
    email: emailMatch ? emailMatch[0] : null,
    phone: phoneMatch ? phoneMatch[0] : null,
    address: addressMatch ? addressMatch[0].split('\n')[0] : null,
  };
}

/**
 * Walk every text node + select attributes and replace real values
 * with the fake placeholders. Runs entirely client-side so the
 * actual DB is never touched. Idempotent.
 */
function redactInPage(real, fake, companyAliasMap) {
  // We accept the real values as an arg so this can run in the
  // browser page context with no closures over Node-side state.
  const pairs = [];
  if (real.userName) {
    const u = real.userName.trim();
    pairs.push([u, fake.fullName]);
    // Also handle a first-name-only fallback (e.g. greeting after a
    // settings change) so "Welcome back, <firstName>" gets caught.
    const firstName = u.split(/\s+/)[0];
    if (firstName && firstName !== u) {
      pairs.push([firstName, fake.firstName]);
    }
  }
  if (real.resumeFileName) pairs.push([real.resumeFileName, fake.resumeFileName]);
  if (real.email) pairs.push([real.email, fake.email]);
  if (real.phone) pairs.push([real.phone, fake.phone]);
  if (real.address) pairs.push([real.address, fake.address]);
  // Company-name redactions. Replace longer names first so a name
  // that's a prefix of another (e.g. "Pinterest" vs "Pinterest UK")
  // doesn't get partially matched and leave dangling text.
  const companyPairs = Object.entries(companyAliasMap ?? {})
    .sort((a, b) => b[0].length - a[0].length);
  for (const [real, fake] of companyPairs) pairs.push([real, fake]);

  // Common LinkedIn export patterns surface initials in avatar
  // bubbles on the listings page network popover. The popover
  // isn't open by default in the screenshot so this is precautionary.
  const PII_RE = /[A-Z][a-z]+ [A-Z][a-z]+/g;       // catches "Jane Doe" forms
  void PII_RE; // referenced inline below

  function replaceText(node) {
    let value = node.nodeValue;
    let dirty = false;
    for (const [from, to] of pairs) {
      if (value.includes(from)) {
        value = value.split(from).join(to);
        dirty = true;
      }
    }
    if (dirty) node.nodeValue = value;
  }

  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let n;
  while ((n = walker.nextNode())) replaceText(n);

  // Input fields hold values via the .value property, not the
  // child text node. Walk inputs/textareas separately.
  for (const el of document.querySelectorAll('input, textarea')) {
    let value = el.value;
    let dirty = false;
    for (const [from, to] of pairs) {
      if (value && value.includes(from)) {
        value = value.split(from).join(to);
        dirty = true;
      }
    }
    if (dirty) el.value = value;
  }

  // Resume text PRE/textarea on Settings can be huge; if anything's
  // left, blank it. Heuristic: an element with class containing
  // 'whitespace-pre' AND >800 chars likely IS the resume.
  for (const el of document.querySelectorAll('[class*="whitespace-pre"]')) {
    if (el.textContent && el.textContent.length > 800) {
      el.textContent = '[resume text hidden in screenshots]';
    }
  }

  // Company logo neutralization. CompanyLogo renders an <img> with
  // alt="<Company> logo" pointing at Clearbit/Google favicons that
  // carry brand colors. Replace each with a generic indigo→violet
  // initial chip showing the FAKE company's first letter, so no
  // brand visual leaks into the screenshot. Width/height/borderRadius
  // are read off the original img so layout stays identical.
  for (const img of Array.from(document.querySelectorAll('img'))) {
    const alt = img.getAttribute('alt') ?? '';
    const m = alt.match(/^(.+?)\s+logo$/i);
    if (!m) continue;
    const realCompany = m[1];
    const fakeCompany = (companyAliasMap && companyAliasMap[realCompany]) || 'Acme Corp';
    const initial = fakeCompany.trim().charAt(0).toUpperCase() || '?';
    const sizeAttr = img.getAttribute('width') || img.clientWidth || 24;
    const size = typeof sizeAttr === 'string' ? parseInt(sizeAttr, 10) || 24 : sizeAttr;
    const chip = document.createElement('span');
    chip.textContent = initial;
    chip.style.cssText = `
      display:inline-flex;align-items:center;justify-content:center;
      width:${size}px;height:${size}px;border-radius:6px;
      background:linear-gradient(135deg,#6366F1,#8B5CF6);
      color:#fff;font-weight:700;font-size:${Math.round(size * 0.55)}px;
      flex-shrink:0;
    `;
    img.replaceWith(chip);
  }
}

async function capture() {
  await mkdir(OUT_DIR, { recursive: true });

  console.log('Fetching real PII from /api/settings to build redaction map…');
  const real = await fetchRealValues();
  for (const [k, v] of Object.entries(real)) {
    if (v) console.log(`  ${k}: ${v.length > 60 ? v.slice(0, 60) + '…' : v}`);
  }
  console.log('');

  console.log('Building company-alias map from /api/listings…');
  const companyAliasMap = await buildCompanyAliasMap();
  const aliasCount = Object.keys(companyAliasMap).length;
  if (aliasCount > 0) {
    const sample = Object.entries(companyAliasMap).slice(0, 5)
      .map(([r, f]) => `${r}→${f}`).join(', ');
    console.log(`  mapped ${aliasCount} companies (sample: ${sample}${aliasCount > 5 ? ', …' : ''})`);
  } else {
    console.log('  (no companies found in listings cache — skipping)');
  }
  console.log('');

  console.log('Picking top-scored listings for /compare seed…');
  const topScoredListingIds = await fetchTopScoredListingIds();
  console.log(`  found ${topScoredListingIds.length} listings with score ≥ 70%`);
  console.log('');

  const ctx = { topScoredListingIds };

  const browser = await puppeteer.launch({
    headless: 'new',
    defaultViewport: { width: WIDTH, height: HEIGHT, deviceScaleFactor: 2 },
    args: ['--no-sandbox'],
  });
  const page = await browser.newPage();

  for (const { name, path } of PAGES) {
    const resolvedPath = typeof path === 'function' ? path(ctx) : path;
    const url = `${BASE}${resolvedPath}`;
    process.stdout.write(`  ${name}  ${url}  →  `);
    try {
      // networkidle0 is too strict for pages with long-lived HMR
      // pings + background image loads (the listings page kicks off
      // tens of favicon requests). networkidle2 + an explicit settle
      // delay is reliable across all pages.
      await page.goto(url, { waitUntil: 'networkidle2', timeout: 45000 });
      // Let React + lazy data fetches settle.
      await new Promise((r) => setTimeout(r, 2500));
      // Redact PII + company names inside the live DOM.
      await page.evaluate(redactInPage, real, FAKE, companyAliasMap);
      // Tiny re-paint delay so layout reflow lands.
      await new Promise((r) => setTimeout(r, 200));
      const file = resolve(OUT_DIR, `${name}.png`);
      await page.screenshot({ path: file, type: 'png', fullPage: false });
      console.log('OK');
    } catch (err) {
      console.log(`FAILED: ${err.message}`);
    }
  }

  await browser.close();
  console.log(`\nDone. Files in ${OUT_DIR}`);
}

capture().catch((err) => {
  console.error(err);
  process.exit(1);
});
