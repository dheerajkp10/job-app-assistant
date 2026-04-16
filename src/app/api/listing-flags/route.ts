import { NextRequest, NextResponse } from 'next/server';
import { getListingFlags, setListingFlag, clearListingFlag } from '@/lib/db';
import type { ListingFlag } from '@/lib/types';

const VALID_FLAGS: ListingFlag[] = ['applied', 'incorrect', 'not-applicable'];

/**
 * GET  /api/listing-flags              → { [listingId]: ListingFlagEntry }
 * POST /api/listing-flags              → body: { listingId, flag | null }
 *   - flag=null clears the flag for that listing.
 */
export async function GET() {
  const flags = await getListingFlags();
  return NextResponse.json(flags);
}

export async function POST(req: NextRequest) {
  const { listingId, flag } = await req.json();

  if (!listingId || typeof listingId !== 'string') {
    return NextResponse.json({ error: 'listingId is required' }, { status: 400 });
  }

  if (flag === null || flag === undefined) {
    const cleared = await clearListingFlag(listingId);
    return NextResponse.json({ ok: true, cleared });
  }

  if (!VALID_FLAGS.includes(flag)) {
    return NextResponse.json(
      { error: `flag must be one of ${VALID_FLAGS.join(', ')} or null` },
      { status: 400 }
    );
  }

  const entry = await setListingFlag(listingId, flag);
  return NextResponse.json(entry);
}
