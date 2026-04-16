import { NextRequest, NextResponse } from 'next/server';
import { getListingsCache, saveListingsCache } from '@/lib/db';
import { fetchAllJobs } from '@/lib/job-fetcher';
import { COMPANY_SOURCES } from '@/lib/sources';

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
    const result = await fetchAllJobs(COMPANY_SOURCES);
    const newCache = {
      listings: result.listings,
      lastFetchedAt: new Date().toISOString(),
      fetchErrors: result.errors,
    };
    await saveListingsCache(newCache);
    return NextResponse.json({
      ...newCache,
      total: result.listings.length,
      companiesFetched: COMPANY_SOURCES.length - result.errors.length,
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
  const result = await fetchAllJobs(COMPANY_SOURCES);
  const newCache = {
    listings: result.listings,
    lastFetchedAt: new Date().toISOString(),
    fetchErrors: result.errors,
  };
  await saveListingsCache(newCache);
  return NextResponse.json({
    ...newCache,
    total: result.listings.length,
    companiesFetched: COMPANY_SOURCES.length - result.errors.length,
    companiesFailed: result.errors.length,
  });
}
