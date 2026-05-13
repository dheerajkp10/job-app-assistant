import { NextRequest, NextResponse } from 'next/server';
import { getListingFlags, setListingFlag, clearListingFlag } from '@/lib/db';
import type { ListingFlag } from '@/lib/types';

// The full set of accepted flag values. Was previously
// ['applied', 'incorrect', 'not-applicable'] which silently 400'd
// pipeline-only flags (phone-screen / interviewing / offer / rejected)
// — that's why marking a listing as "Rejected" on the Listings page
// never showed up on the Kanban board. Keep this in sync with the
// `ListingFlag` union in `src/lib/types.ts`.
const VALID_FLAGS: ListingFlag[] = [
  'applied',
  'phone-screen',
  'interviewing',
  'offer',
  'rejected',
  'incorrect',
  'not-applicable',
];

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
