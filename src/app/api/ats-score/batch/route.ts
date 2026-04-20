import { NextRequest, NextResponse } from 'next/server';
import { readDb, saveScoresBatch } from '@/lib/db';
import { fetchJobDetail } from '@/lib/job-fetcher';
import { scoreResume } from '@/lib/ats-scorer';
import type { ScoreCacheEntry, JobListing } from '@/lib/types';

/**
 * POST /api/ats-score/batch
 * Body: { listingIds: string[] }
 * Scores multiple listings, skipping already-cached ones.
 * Saves all new scores in a single write to prevent file corruption.
 *
 * Perf: the DB file can be 10+MB with a full listings cache. A single call
 * to `readDb()` at the top gives us settings, listings, and the score cache
 * without re-parsing the file for every listing we look up.
 */
export async function POST(req: NextRequest) {
  const { listingIds } = await req.json();

  if (!Array.isArray(listingIds) || listingIds.length === 0) {
    return NextResponse.json({ error: 'listingIds array is required' }, { status: 400 });
  }

  // Single DB read for everything we need (was: 12+ reads per chunk).
  const db = await readDb();

  if (!db.settings.baseResumeText) {
    return NextResponse.json(
      { error: 'No resume uploaded. Please upload your resume in Settings first.' },
      { status: 400 }
    );
  }

  const resumeText = db.settings.baseResumeText;
  const existingCache = db.scoreCache ?? {};

  // Build an in-memory index once so per-listing lookups are O(1).
  const listingIndex: Map<string, JobListing> = new Map();
  for (const l of db.listingsCache.listings) {
    listingIndex.set(l.id, l);
  }

  const scores: Record<string, { overall: number; matchedCount: number; totalCount: number }> = {};
  const newEntries: ScoreCacheEntry[] = [];
  const errors: string[] = [];

  // Filter out already-cached
  const toScore: string[] = [];
  for (const id of listingIds) {
    if (existingCache[id]) {
      scores[id] = {
        overall: existingCache[id].overall,
        matchedCount: existingCache[id].matchedCount,
        totalCount: existingCache[id].totalCount,
      };
    } else {
      toScore.push(id);
    }
  }

  // Process uncached listings in sequential batches of 5 (parallel HTTP fetches per batch)
  const BATCH_SIZE = 5;
  for (let i = 0; i < toScore.length; i += BATCH_SIZE) {
    const batch = toScore.slice(i, i + BATCH_SIZE);
    const results = await Promise.allSettled(
      batch.map(async (id: string) => {
        const listing = listingIndex.get(id);
        if (!listing) { errors.push(`${id}: not found`); return null; }

        const detail = await fetchJobDetail(listing);
        if (!detail) {
          // No public JD available — persist a sentinel (totalCount=0) so we
          // don't retry forever and so any stale score from an earlier run
          // (when synthetic content was being scored) gets cleared.
          errors.push(`${id}: could not fetch details`);
          const sentinel: ScoreCacheEntry = {
            listingId: id,
            overall: 0,
            technical: 0,
            management: 0,
            domain: 0,
            soft: 0,
            matchedCount: 0,
            totalCount: 0,
            scoredAt: new Date().toISOString(),
          };
          // Also surface the sentinel in the response map so the client
          // overwrites any stale (bogus 100%) entry in its local state.
          scores[id] = { overall: 0, matchedCount: 0, totalCount: 0 };
          return sentinel;
        }

        const score = scoreResume(resumeText, detail.content);

        const entry: ScoreCacheEntry = {
          listingId: id,
          overall: score.overall,
          technical: score.technical,
          management: score.management,
          domain: score.domain,
          soft: score.soft,
          matchedCount: score.totalMatched,
          totalCount: score.totalJdKeywords,
          scoredAt: new Date().toISOString(),
        };

        scores[id] = { overall: score.overall, matchedCount: score.totalMatched, totalCount: score.totalJdKeywords };
        return entry;
      })
    );

    for (const r of results) {
      if (r.status === 'fulfilled' && r.value) {
        newEntries.push(r.value);
      } else if (r.status === 'rejected') {
        errors.push(r.reason?.message || 'Unknown error');
      }
    }
  }

  // Single batch write for all new scores
  if (newEntries.length > 0) {
    await saveScoresBatch(newEntries);
  }

  // Report which IDs we attempted but couldn't score, so the client can
  // advance its progress indicator (otherwise failed listings would leave
  // the bar stuck at the last successful count).
  const attemptedButFailed = toScore.filter((id) => !scores[id]);

  return NextResponse.json({ scores, errors, attemptedButFailed });
}
