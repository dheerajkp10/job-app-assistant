import { NextRequest, NextResponse } from 'next/server';
import { getSettings, getListingById, saveScore } from '@/lib/db';
import { fetchJobDetail } from '@/lib/job-fetcher';
import { scoreResume } from '@/lib/ats-scorer';
import { SCORER_VERSION } from '@/lib/types';
import { detectSuggestions } from '@/lib/resume-suggestions';

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
    // Persist a sentinel so the auto-scorer doesn't keep retrying this
    // listing (and so any stale bogus score from a previous run is cleared).
    await saveScore({
      listingId,
      overall: 0,
      technical: 0,
      management: 0,
      domain: 0,
      soft: 0,
      matchedCount: 0,
      totalCount: 0,
      scoredAt: new Date().toISOString(),
      scorerVersion: SCORER_VERSION,
    });
    return NextResponse.json(
      { error: 'This listing has no public job description — scoring isn\'t available for it.' },
      { status: 422 }
    );
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
    phrases: score.phrases,
    matchedCount: score.totalMatched,
    totalCount: score.totalJdKeywords,
    scoredAt: new Date().toISOString(),
    scorerVersion: SCORER_VERSION,
  });

  // Beyond the score, surface concrete edit suggestions the user can
  // accept à la carte (mirror JD title in summary, mention niche
  // multi-word phrases the JD repeats, etc.). Detection is fast and
  // only runs on the single-listing path — the batch scorer skips it.
  const suggestions = detectSuggestions({
    resumeText: settings.baseResumeText,
    jdContent: detail.content,
    jdTitle: listing.title,
  });

  return NextResponse.json({ ...score, suggestions });
}
