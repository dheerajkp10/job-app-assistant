// Quick smoke test for the Puppeteer fetchers.
// Run with: node --experimental-vm-modules scripts/smoke-puppeteer.mjs
// Prints the first few listings from Apple and Meta so we can confirm
// the selector logic is still alive.

import { register } from 'node:module';
import { pathToFileURL } from 'node:url';

// Use tsx/esbuild-via-node? We don't have either installed. Instead,
// import the compiled JS after `npm run build` — but the build outputs
// to .next and is bundled. So do it the simple way: transpile on the
// fly with the TypeScript module if installed, else fall back to
// requiring the typescript-compiled source path.

// Simpler: just import straight — Node supports .ts via experimental
// strip-types in recent Node 22+, else we fail loud.
let appleFetcher, metaFetcher, closeBrowser;
try {
  ({
    fetchAppleJobsViaPuppeteer: appleFetcher,
    fetchMetaJobsViaPuppeteer: metaFetcher,
    closePuppeteerBrowser: closeBrowser,
  } = await import('../src/lib/puppeteer-fetchers.ts'));
} catch (err) {
  console.error('Failed to import puppeteer-fetchers.ts directly.');
  console.error('Run with: node --experimental-strip-types scripts/smoke-puppeteer.mjs');
  console.error(err.message);
  process.exit(1);
}

const appleSource = {
  name: 'Apple', slug: 'apple', ats: 'apple', boardToken: 'apple', logoColor: '#000000',
};
const metaSource = {
  name: 'Meta', slug: 'meta', ats: 'meta', boardToken: 'meta', logoColor: '#1877F2',
};

const which = process.argv[2] || 'both';

try {
  if (which === 'apple' || which === 'both') {
    console.log('— Apple —');
    const start = Date.now();
    const apple = await appleFetcher(appleSource);
    console.log(`  ${apple.length} listings in ${((Date.now() - start) / 1000).toFixed(1)}s`);
    for (const j of apple.slice(0, 5)) {
      console.log(`  · ${j.title} | ${j.location} | ${j.url}`);
    }
  }

  if (which === 'meta' || which === 'both') {
    console.log('— Meta —');
    const start = Date.now();
    const meta = await metaFetcher(metaSource);
    console.log(`  ${meta.length} listings in ${((Date.now() - start) / 1000).toFixed(1)}s`);
    for (const j of meta.slice(0, 5)) {
      console.log(`  · ${j.title} | ${j.location} | ${j.url}`);
    }
  }
} finally {
  await closeBrowser();
}
