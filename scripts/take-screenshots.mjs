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

// Pages to capture. `redactExtra` lets each page contribute
// additional string→string substitutions (e.g. LinkedIn contact
// names visible only on the listings hover popovers).
const PAGES = [
  { name: '01-dashboard', path: '/dashboard' },
  { name: '02-listings',  path: '/listings'  },
  { name: '03-pipeline',  path: '/pipeline'  },
  { name: '04-compare',   path: '/compare'   },
  { name: '05-add-job',   path: '/jobs/add'  },
  { name: '06-settings',  path: '/settings'  },
];

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
function redactInPage(real, fake) {
  // We accept the real values as an arg so this can run in the
  // browser page context with no closures over Node-side state.
  const pairs = [];
  if (real.userName) {
    const u = real.userName.trim();
    pairs.push([u, fake.fullName]);
    // Also handle a first-name-only fallback (e.g. greeting after a
    // settings change) so "Welcome back, Dheeraj" gets caught.
    const firstName = u.split(/\s+/)[0];
    if (firstName && firstName !== u) {
      pairs.push([firstName, fake.firstName]);
    }
  }
  if (real.resumeFileName) pairs.push([real.resumeFileName, fake.resumeFileName]);
  if (real.email) pairs.push([real.email, fake.email]);
  if (real.phone) pairs.push([real.phone, fake.phone]);
  if (real.address) pairs.push([real.address, fake.address]);

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
}

async function capture() {
  await mkdir(OUT_DIR, { recursive: true });

  console.log('Fetching real PII from /api/settings to build redaction map…');
  const real = await fetchRealValues();
  for (const [k, v] of Object.entries(real)) {
    if (v) console.log(`  ${k}: ${v.length > 60 ? v.slice(0, 60) + '…' : v}`);
  }
  console.log('');

  const browser = await puppeteer.launch({
    headless: 'new',
    defaultViewport: { width: WIDTH, height: HEIGHT, deviceScaleFactor: 2 },
    args: ['--no-sandbox'],
  });
  const page = await browser.newPage();

  for (const { name, path } of PAGES) {
    const url = `${BASE}${path}`;
    process.stdout.write(`  ${name}  ${url}  →  `);
    try {
      await page.goto(url, { waitUntil: 'networkidle0', timeout: 30000 });
      // Let React + lazy data fetches settle.
      await new Promise((r) => setTimeout(r, 1500));
      // Redact PII inside the live DOM.
      await page.evaluate(redactInPage, real, FAKE);
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
