import { NextRequest, NextResponse } from 'next/server';
import { readDb, saveScoresBatch } from '@/lib/db';
import { fetchJobDetail } from '@/lib/job-fetcher';
import { extractKeywords, scoreResumeFromKeywords } from '@/lib/ats-scorer';
import { SCORER_VERSION } from '@/lib/types';
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

  // Extract the resume's keyword map ONCE for the whole request.
  // `scoreResumeFromKeywords` reuses this across every listing — same output
  // as calling `scoreResume(resumeText, jd)` per listing, but saves one
  // ~300-regex scan over the resume per listing.
  const resumeKeywords = extractKeywords(resumeText);

  const scores: Record<string, { overall: number; matchedCount: number; totalCount: number }> = {};
  const newEntries: ScoreCacheEntry[] = [];
  const errors: string[] = [];

  // Filter out already-cached entries — but only if they were scored
  // with the *current* algorithm version. v1-cached entries get rescored
  // on demand so users see the new TF-weighted output without having to
  // manually clear anything. The version field is checked here (not in
  // the GET cache reader) because rescoring requires the resume + JD
  // detail, which only the batch endpoint has.
  const toScore: string[] = [];
  for (const id of listingIds) {
    const cached = existingCache[id];
    const isFresh = cached && cached.scorerVersion === SCORER_VERSION;
    if (isFresh) {
      scores[id] = {
        overall: cached.overall,
        matchedCount: cached.matchedCount,
        totalCount: cached.totalCount,
      };
    } else {
      toScore.push(id);
    }
  }

  // Fan out all uncached listings in parallel. The per-listing work is
  // dominated by `fetchJobDetail` (external HTTP across many unrelated
  // hosts — greenhouse, lever, ashby, careers APIs — so host-level
  // throttling isn't a concern) plus CPU-light keyword matching. The
  // client already chunks this endpoint into reasonable batches, so we
  // don't need to sub-batch server-side too.
  const results = await Promise.allSettled(
    toScore.map(async (id: string) => {
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
          scorerVersion: SCORER_VERSION,
        };
        // Also surface the sentinel in the response map so the client
        // overwrites any stale (bogus 100%) entry in its local state.
        scores[id] = { overall: 0, matchedCount: 0, totalCount: 0 };
        return sentinel;
      }

      const score = scoreResumeFromKeywords(resumeKeywords, detail.content);

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
        scorerVersion: SCORER_VERSION,
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
