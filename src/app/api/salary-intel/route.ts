import { NextRequest, NextResponse } from 'next/server';
import { getListingsCache, getListingById } from '@/lib/db';
import { computeSalaryStats } from '@/lib/salary-intelligence';

/**
 * GET /api/salary-intel?listingId=<id>
 *
 * Returns market-rate context for the given listing using the
 * user's own listings cache as the peer cohort. No external APIs —
 * purely local statistics over postings the app already pulled.
 *
 * Response: { stats: SalaryStats | null }
 *   stats=null when the peer cohort is too small (< 3 samples).
 */
export async function GET(req: NextRequest) {
  const listingId = req.nextUrl.searchParams.get('listingId');
  if (!listingId) {
    return NextResponse.json({ error: 'listingId is required' }, { status: 400 });
  }
  const listing = await getListingById(listingId);
  if (!listing) {
    return NextResponse.json({ error: 'Listing not found' }, { status: 404 });
  }
  const cache = await getListingsCache();
  const stats = computeSalaryStats(listing, cache.listings);
  return NextResponse.json({ stats });
}
