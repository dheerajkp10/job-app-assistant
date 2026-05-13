import { NextRequest, NextResponse } from 'next/server';
import { getSettings, getListingById } from '@/lib/db';
import { fetchJobDetail } from '@/lib/job-fetcher';
import { generateCoverLetter } from '@/lib/cover-letter';

/**
 * POST /api/cover-letter
 *
 * Body: { listingId: string, format?: 'json' | 'txt' }
 *   - format=json (default): returns { text, matchedKeywords }
 *   - format=txt:            streams the plain text as a downloadable
 *                            attachment so the user gets a .txt file
 *                            ready to paste into their email client.
 *
 * The generator is deterministic — same listing + same resume always
 * produces the same letter — so re-clicking is idempotent.
 */
export async function POST(req: NextRequest) {
  const { listingId, format } = await req.json();

  if (!listingId) {
    return NextResponse.json({ error: 'listingId is required' }, { status: 400 });
  }

  const settings = await getSettings();
  if (!settings.baseResumeText) {
    return NextResponse.json(
      { error: 'No resume uploaded. Please upload your resume in Settings first.' },
      { status: 400 },
    );
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

  const result = generateCoverLetter({
    resumeText: settings.baseResumeText,
    jdContent: detail.content,
    listing,
    userName: settings.userName || 'Your Name',
  });

  if (format === 'txt') {
    const safeName = `${settings.userName || 'CoverLetter'}_${listing.company}_${listing.title}`
      .replace(/[^a-zA-Z0-9_\- ]/g, '')
      .replace(/\s+/g, '_')
      .slice(0, 80);
    return new NextResponse(result.text, {
      status: 200,
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Content-Disposition': `attachment; filename="${safeName}.txt"`,
      },
    });
  }

  return NextResponse.json(result);
}
