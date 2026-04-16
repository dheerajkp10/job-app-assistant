import { NextRequest, NextResponse } from 'next/server';
import { getSettings, getListingById, saveScore } from '@/lib/db';
import { fetchJobDetail } from '@/lib/job-fetcher';
import { scoreResume } from '@/lib/ats-scorer';

/**
 * POST /api/ats-score
 * Body: { listingId: string }
 * Scores the user's resume against a specific job listing.
 */
export async function POST(req: NextRequest) {
  const { listingId } = await req.json();

  if (!listingId) {
    return NextResponse.json({ error: 'listingId is required' }, { status: 400 });
  }

  // Get resume text
  const settings = await getSettings();
  if (!settings.baseResumeText) {
    return NextResponse.json(
      { error: 'No resume uploaded. Please upload your resume in Settings first.' },
      { status: 400 }
    );
  }

  // Get listing + full details
  const listing = await getListingById(listingId);
  if (!listing) {
    return NextResponse.json({ error: 'Listing not found' }, { status: 404 });
  }

  const detail = await fetchJobDetail(listing);
  if (!detail) {
    return NextResponse.json({ error: 'Could not fetch job details' }, { status: 500 });
  }

  // Score
  const score = scoreResume(settings.baseResumeText, detail.content);

  // Cache the score
  await saveScore({
    listingId,
    overall: score.overall,
    technical: score.technical,
    management: score.management,
    domain: score.domain,
    soft: score.soft,
    matchedCount: score.totalMatched,
    totalCount: score.totalJdKeywords,
    scoredAt: new Date().toISOString(),
  });

  return NextResponse.json(score);
}
