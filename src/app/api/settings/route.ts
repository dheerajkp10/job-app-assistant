import { NextRequest, NextResponse } from 'next/server';
import { getSettings, updateSettings } from '@/lib/db';

// Force-dynamic — settings.baseResumeText / activeResumeId mutate
// on every upload + active-switch. The dashboard reload chain
// drops back to a stale snapshot if anything caches the response.
export const dynamic = 'force-dynamic';

export async function GET() {
  const settings = await getSettings();
  return NextResponse.json(
    { settings },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}

export async function PUT(req: NextRequest) {
  const updates = await req.json();
  const settings = await updateSettings(updates);
  return NextResponse.json({ settings });
}
