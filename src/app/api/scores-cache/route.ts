import { NextResponse } from 'next/server';
import { readDb, saveScoresBatch, clearScoreCache } from '@/lib/db';
import { isUnscorableAts } from '@/lib/job-fetcher';
import { SCORER_VERSION } from '@/lib/types';
import type { ScoreCacheEntry } from '@/lib/types';

/**
 * GET /api/scores-cache
 * Returns all cached ATS scores (keyed by listingId).
 *
 * Side-effect: cleans up stale entries from an earlier build that scored
 * listings against synthetic content (just title/department). Those produced
 * noisy 0% / 100% scores for careers APIs that don't expose a full JD
 * (Google, Apple, Uber, etc.). We normalize any such entry to a sentinel
 * (totalCount=0) so the UI treats them consistently as "not scorable".
 */
export async function GET() {
  const db = await readDb();
  const cache = db.scoreCache ?? {};

  // Build listingId → ATS lookup so we can spot entries that shouldn't
  // have a real score.
  const atsById = new Map<string, string>();
  for (const l of db.listingsCache.listings) atsById.set(l.id, l.ats);

  const stale: ScoreCacheEntry[] = [];
  for (const [id, entry] of Object.entries(cache)) {
    const ats = atsById.get(id);
    // Only touch entries we can confidently classify as unscorable —
    // if the listing is gone from the cache we leave it alone.
    if (!ats) continue;
    if (!isUnscorableAts(ats as Parameters<typeof isUnscorableAts>[0])) continue;
    if (entry.totalCount === 0) continue; // already a sentinel
    stale.push({
      ...entry,
      overall: 0,
      technical: 0,
      management: 0,
      domain: 0,
      soft: 0,
      matchedCount: 0,
      totalCount: 0,
    });
  }

  if (stale.length > 0) {
    await saveScoresBatch(stale);
    for (const s of stale) cache[s.listingId] = s;
  }

  // Hide entries scored with an older algorithm version from the client.
  // The listings page treats absent scoreCache[id] entries as "needs
  // scoring" — so dropping older entries here makes them get rescored
  // automatically by the batch scorer the next time the page mounts.
  // The DB rows themselves stay (no destructive write); the batch
  // endpoint re-checks the version and overwrites them on rescore.
  //
  // We also count how many entries were filtered (and what versions
  // they were on) so the UI can surface a banner like "We've upgraded
  // the scoring algorithm — recomputing N scores now." Two stale-
  // category buckets are tracked: stale-version (older scorer) and
  // stale-other (everything else, e.g. for unscorable-ATS sentinels).
  const fresh: Record<string, ScoreCacheEntry> = {};
  let staleVersionCount = 0;
  for (const [id, entry] of Object.entries(cache)) {
    if (entry.scorerVersion === SCORER_VERSION) fresh[id] = entry;
    else if ((entry.scorerVersion ?? 1) < SCORER_VERSION) staleVersionCount++;
  }

  return NextResponse.json(fresh, {
    headers: {
      'X-Scorer-Version': String(SCORER_VERSION),
      'X-Scores-Stale-Version-Count': String(staleVersionCount),
    },
  });
}

/**
 * DELETE /api/scores-cache
 *
 * Manual escape hatch — wipes every cached ATS score so the
 * dashboard's auto-rescore effect refills them against the
 * CURRENT active resume. Used by the "Recompute against current
 * resume" button on the Resume Performance card for cases where
 * the cache wasn't auto-wiped (e.g. a resume swap that happened
 * before the auto-invalidate fix shipped, or any future state
 * drift between active text and cached scores).
 */
export async function DELETE() {
  const cleared = await clearScoreCache();
  return NextResponse.json({ cleared });
}
