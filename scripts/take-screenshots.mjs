#!/usr/bin/env node
/**
 * Take Puppeteer screenshots of every major page for the README.
 *
 * Run with the dev server up at http://localhost:3000:
 *   npm run dev    # in one terminal
 *   node scripts/take-screenshots.mjs
 *
 * Output → docs/screenshots/<name>.png at 1440×900 (a clean
 * 16:10 viewport that fits comfortably inside README's max
 * content width).
 */
import puppeteer from 'puppeteer';
import { mkdir } from 'fs/promises';
import { resolve } from 'path';

const BASE = 'http://localhost:3000';
const OUT_DIR = resolve('docs/screenshots');
const WIDTH = 1440;
const HEIGHT = 900;

// Pages to capture. `wait` is an optional CSS selector to wait for
// before snapping the shot — guarantees the page has actually
// rendered its data, not just the loading shell.
const PAGES = [
  { name: '01-dashboard',     path: '/dashboard',    wait: 'h2:has-text("Resume Performance"), h2' },
  { name: '02-listings',      path: '/listings',     wait: 'input[placeholder*="Search"], h1' },
  { name: '03-pipeline',      path: '/pipeline',     wait: 'h1' },
  { name: '04-compare',       path: '/compare',      wait: 'h1' },
  { name: '05-add-job',       path: '/jobs/add',     wait: 'h1' },
  { name: '06-settings',      path: '/settings',     wait: 'h1' },
];

async function capture() {
  await mkdir(OUT_DIR, { recursive: true });
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
      // Give the React shell + any client effects a moment to
      // hydrate / fetch their data before snapping.
      await new Promise((r) => setTimeout(r, 1500));
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
