import { NextRequest, NextResponse } from 'next/server';
import { getSettings, getListingById, getScoreCache, saveScoresBatch } from '@/lib/db';
import { fetchJobDetail } from '@/lib/job-fetcher';
import { scoreResume } from '@/lib/ats-scorer';
import type { ScoreCacheEntry } from '@/lib/types';

/**
 * POST /api/ats-score/batch
 * Body: { listingIds: string[] }
 * Scores multiple listings, skipping already-cached ones.
 * Saves all new scores in a single write to prevent file corruption.
 */
export async function POST(req: NextRequest) {
  const { listingIds } = await req.json();

  if (!Array.isArray(listingIds) || listingIds.length === 0) {
    return NextResponse.json({ error: 'listingIds array is required' }, { status: 400 });
  }

  const settings = await getSettings();
  if (!settings.baseResumeText) {
    return NextResponse.json(
      { error: 'No resume uploaded. Please upload your resume in Settings first.' },
      { status: 400 }
    );
  }

  // Load existing cache to skip already-scored listings
  const existingCache = await getScoreCache();

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
        const listing = await getListingById(id);
        if (!listing) { errors.push(`${id}: not found`); return null; }

        const detail = await fetchJobDetail(listing);
        if (!detail) { errors.push(`${id}: could not fetch details`); return null; }

        const score = scoreResume(settings.baseResumeText!, detail.content);

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

  return NextResponse.json({ scores, errors });
}
