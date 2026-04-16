import { NextResponse } from 'next/server';
import { getScoreCache } from '@/lib/db';

/**
 * GET /api/scores-cache
 * Returns all cached ATS scores (keyed by listingId).
 */
export async function GET() {
  const cache = await getScoreCache();
  return NextResponse.json(cache);
}
