import { NextResponse } from 'next/server';
import { readDb, updateListingSalary } from '@/lib/db';
import { extractSalary } from '@/lib/salary-parser';
import { readFile } from 'fs/promises';
import { join } from 'path';

/**
 * POST /api/salary-intel/reprocess
 *
 * Walks every listing in the cache and re-runs the salary extractor
 * against the best text source available, then patches the cache
 * with any newly-detected base/TC/equity fields. Run this after
 * shipping a smarter extractor or after a parser change to back-fill
 * structured salary data on previously-fetched listings.
 *
 * Text source priority per listing:
 *   1. On-disk cached JD detail at data/listing-details/<id>.html
 *      (written by the detail-fetch route for big custom fetchers).
 *   2. The existing `salary` display string on the listing (worst
 *      case — only catches malformed legacy entries).
 *
 * Returns a summary so the UI can render a "N listings reprocessed,
 * M new base+TC splits, K new equity hints" toast.
 */
export async function POST() {
  const db = await readDb();
  const listings = db.listingsCache?.listings ?? [];

  let scanned = 0;
  let updated = 0;
  let baseTcSplits = 0;
  let equityHints = 0;
  let hourlyNormalized = 0;
  const errors: string[] = [];

  for (const listing of listings) {
    scanned += 1;

    // Try the on-disk JD HTML first — that's the richest text
    // source. The detail-fetcher caches it under data/listing-details
    // for the custom fetchers (Google, Uber, etc.); standard ATSes
    // (Greenhouse/Lever/Ashby) embed content directly in the list
    // response so they won't have a file. Both paths are fine.
    let text = '';
    try {
      const path = join(process.cwd(), 'data', 'listing-details', `${listing.id}.html`);
      text = await readFile(path, 'utf-8');
    } catch {
      // No cached file — fall back to whatever we already know.
      text = listing.salary ?? '';
    }
    if (!text) continue;

    const parsed = extractSalary(text);
    if (!parsed) continue;

    // Only write when at least one numeric field changed; the
    // updateListingSalary helper is idempotent but we want to keep
    // the loop running fast on no-ops.
    const hadNumbers = listing.salaryMin != null || listing.salaryMax != null;
    const newNumbers = parsed.min != null || parsed.max != null;
    const gainsBaseTc =
      (parsed.baseMin != null || parsed.tcMin != null) &&
      listing.salaryBaseMin == null && listing.salaryTcMin == null;
    const gainsEquity = !!parsed.equityHint && !listing.salaryEquityHint;
    if (!gainsBaseTc && !gainsEquity && hadNumbers === newNumbers && parsed.min === listing.salaryMin) {
      continue;
    }

    try {
      await updateListingSalary(listing.id, {
        salary: parsed.display,
        salaryMin: parsed.min,
        salaryMax: parsed.max,
        salaryBaseMin: parsed.baseMin ?? null,
        salaryBaseMax: parsed.baseMax ?? null,
        salaryTcMin: parsed.tcMin ?? null,
        salaryTcMax: parsed.tcMax ?? null,
        salaryEquityHint: parsed.equityHint ?? null,
        salarySource: parsed.source ?? null,
      });
      updated += 1;
      if (gainsBaseTc) baseTcSplits += 1;
      if (gainsEquity) equityHints += 1;
      if (parsed.source === 'hourly') hourlyNormalized += 1;
    } catch (err) {
      errors.push(`${listing.id}: ${err instanceof Error ? err.message : 'unknown'}`);
    }
  }

  return NextResponse.json({
    scanned,
    updated,
    baseTcSplits,
    equityHints,
    hourlyNormalized,
    errors: errors.slice(0, 10),
  });
}
