import { NextRequest, NextResponse } from 'next/server';
import { getListingById } from '@/lib/db';
import { fetchJobDetail } from '@/lib/job-fetcher';
import { generateInterviewPrep } from '@/lib/interview-prep';

/**
 * POST /api/interview-prep
 * Body: { listingId: string }
 *
 * Returns a deterministic 8-12 question prep deck for the given
 * listing, organized into Behavioral / Technical / Company-fit
 * buckets with optional STAR prompts.
 */
export async function POST(req: NextRequest) {
  const { listingId } = await req.json();
  if (!listingId) {
    return NextResponse.json({ error: 'listingId is required' }, { status: 400 });
  }
  const listing = await getListingById(listingId);
  if (!listing) {
    return NextResponse.json({ error: 'Listing not found' }, { status: 404 });
  }
  const detail = await fetchJobDetail(listing);
  if (!detail) {
    return NextResponse.json(
      { error: 'Could not fetch job details for this listing.' },
      { status: 500 },
    );
  }
  const result = generateInterviewPrep({ jdContent: detail.content, listing });
  return NextResponse.json(result);
}
