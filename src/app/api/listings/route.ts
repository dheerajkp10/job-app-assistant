import { NextRequest, NextResponse } from 'next/server';
import { getListingsCache, saveListingsCache, getSettings, updateSettings } from '@/lib/db';
import { fetchAllJobs } from '@/lib/job-fetcher';
import { getAllSources } from '@/lib/sources';

/** Merge fresh 404s into Settings.deadSources so the next refresh
 *  skips them. Called after each refresh — no-op when the run found
 *  no new dead sources. */
async function recordDeadSources(
  newDead: Record<string, { since: string; statusCode: number }> | undefined,
) {
  if (!newDead || Object.keys(newDead).length === 0) return;
  const settings = await getSettings();
  await updateSettings({
    deadSources: { ...(settings.deadSources ?? {}), ...newDead },
  });
}

const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

/**
 * GET /api/listings
 * Returns cached listings. If stale (>1hr), triggers background refresh.
 * Query params: ?refresh=true to force refresh
 */
export async function GET(req: NextRequest) {
  const forceRefresh = req.nextUrl.searchParams.get('refresh') === 'true';
  const cache = await getListingsCache();

  const isStale = !cache.lastFetchedAt ||
    Date.now() - new Date(cache.lastFetchedAt).getTime() > CACHE_TTL_MS;

  if (forceRefresh) {
    // Synchronous fetch — forced refresh only
    const sources = await getAllSources();
    const settings = await getSettings();
    const result = await fetchAllJobs(sources, settings.deadSources);
    await recordDeadSources(result.newDeadSources);
    const newCache = {
      listings: result.listings,
      lastFetchedAt: new Date().toISOString(),
      fetchErrors: result.errors,
    };
    await saveListingsCache(newCache);
    return NextResponse.json({
      ...newCache,
      total: result.listings.length,
      companiesFetched: sources.length - result.errors.length,
      companiesFailed: result.errors.length,
    });
  }

  return NextResponse.json({
    ...cache,
    total: cache.listings.length,
    isStale,
  });
}

/**
 * POST /api/listings
 * Triggers a full refresh from all sources.
 */
export async function POST() {
  const sources = await getAllSources();
  const settings = await getSettings();
  const result = await fetchAllJobs(sources, settings.deadSources);
  await recordDeadSources(result.newDeadSources);
  const newCache = {
    listings: result.listings,
    lastFetchedAt: new Date().toISOString(),
    fetchErrors: result.errors,
  };
  await saveListingsCache(newCache);
  return NextResponse.json({
    ...newCache,
    total: result.listings.length,
    companiesFetched: sources.length - result.errors.length,
    companiesFailed: result.errors.length,
  });
}
