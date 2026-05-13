import { NextRequest, NextResponse } from 'next/server';
import { getSettings, getListingById } from '@/lib/db';
import { generateOutreachEmail } from '@/lib/outreach-email';
import type { OutreachTemplate } from '@/lib/outreach-email';

/**
 * POST /api/outreach
 * Body: { listingId, template, contactName? }
 * Returns { subject, body }.
 */
export async function POST(req: NextRequest) {
  const { listingId, template, contactName } = await req.json();
  if (!listingId || !template) {
    return NextResponse.json({ error: 'listingId and template are required' }, { status: 400 });
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
  const result = generateOutreachEmail({
    listing,
    resumeText: settings.baseResumeText,
    userName: settings.userName || 'Your Name',
    template: template as OutreachTemplate,
    contactName,
  });
  return NextResponse.json(result);
}
