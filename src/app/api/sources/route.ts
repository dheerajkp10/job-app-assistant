import { NextRequest, NextResponse } from 'next/server';
import { getSettings, updateSettings } from '@/lib/db';
import type { CustomCompanySource, ATSType } from '@/lib/types';

/**
 * GET /api/sources
 * Returns the user's saved custom company sources.
 *
 * POST /api/sources
 * Body: { name, ats, boardToken, slug?, logoColor?, region?, workdayHost?, workdaySite? }
 * Adds (or replaces by slug) a custom company source. The companion
 * /api/sources/probe endpoint verifies the token works against the
 * chosen ATS before the user clicks save.
 *
 * DELETE /api/sources?slug=<slug>
 * Removes a custom source. No-op for slugs that aren't user-added
 * (we never delete static `COMPANY_SOURCES` entries from this route).
 */

const ALLOWED_ATS: ATSType[] = [
  'greenhouse', 'lever', 'ashby',
  'google', 'apple', 'microsoft', 'amazon', 'meta', 'uber',
  'workday', 'eightfold',
];

export async function GET() {
  const settings = await getSettings();
  return NextResponse.json({ sources: settings.customSources ?? [] });
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { name, ats, boardToken } = body;
  if (!name || !ats || !boardToken) {
    return NextResponse.json(
      { error: 'name, ats, and boardToken are required' },
      { status: 400 },
    );
  }
  if (!ALLOWED_ATS.includes(ats)) {
    return NextResponse.json(
      { error: `Unsupported ATS "${ats}". Allowed: ${ALLOWED_ATS.join(', ')}` },
      { status: 400 },
    );
  }
  const slug = (body.slug ?? name).toString().toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
  if (!slug) {
    return NextResponse.json({ error: 'invalid slug' }, { status: 400 });
  }
  const newSource: CustomCompanySource = {
    name,
    slug,
    ats,
    boardToken,
    logoColor: body.logoColor || '#6366F1',
    region: body.region,
    workdayHost: body.workdayHost,
    workdaySite: body.workdaySite,
    eightfoldHost: body.eightfoldHost,
    eightfoldDomain: body.eightfoldDomain,
    addedByUser: true,
    addedAt: new Date().toISOString(),
  };

  const settings = await getSettings();
  const existing = settings.customSources ?? [];
  const filtered = existing.filter((s) => s.slug.toLowerCase() !== slug);
  const next = [...filtered, newSource];
  await updateSettings({ customSources: next });
  return NextResponse.json({ source: newSource });
}

export async function DELETE(req: NextRequest) {
  const slug = req.nextUrl.searchParams.get('slug');
  if (!slug) {
    return NextResponse.json({ error: 'slug query parameter is required' }, { status: 400 });
  }
  const settings = await getSettings();
  const existing = settings.customSources ?? [];
  const next = existing.filter((s) => s.slug.toLowerCase() !== slug.toLowerCase());
  await updateSettings({ customSources: next });
  return NextResponse.json({ ok: true, removed: existing.length - next.length });
}
