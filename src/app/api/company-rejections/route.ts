/**
 * Company-level rejection list.
 *
 * GET    /api/company-rejections                 → CompanyRejection[]
 * DELETE /api/company-rejections?slug=<slug>     → un-reject a company:
 *   - removes the company from the rejection list
 *   - clears the 'rejected' flag from every listing at that company
 *
 * Additions go through POST /api/listing-flags (which cascades to
 * siblings + adds to the rejection list as a side effect). There's
 * no dedicated POST here on purpose — the source of truth for "this
 * company was rejected" is the user marking a listing rejected; we
 * want both paths to flow through one handler so the cascade
 * behavior stays consistent.
 */
import { NextRequest, NextResponse } from 'next/server';
import {
  getCompanyRejections, removeCompanyRejection, getListingFlags,
  clearListingFlag, readDb,
} from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET() {
  const rejections = await getCompanyRejections();
  return NextResponse.json(rejections, {
    headers: { 'Cache-Control': 'no-store' },
  });
}

export async function DELETE(req: NextRequest) {
  const slug = req.nextUrl.searchParams.get('slug');
  if (!slug) {
    return NextResponse.json({ error: 'slug query param is required' }, { status: 400 });
  }
  const removed = await removeCompanyRejection(slug);
  if (!removed) {
    return NextResponse.json({ ok: false, cleared: 0 }, { status: 404 });
  }

  // Clear the per-listing 'rejected' flag on every listing at this
  // company so the pipeline / listings pages stop treating them as
  // rejected. Without this the un-reject would leave individual
  // role cards stuck in Rejected — confusing, since the user
  // explicitly said "the company isn't rejected anymore".
  const db = await readDb();
  const listingsBySlug = db.listingsCache.listings.filter(
    (l) => (l.companySlug || l.company.trim().toLowerCase()) === slug,
  );
  const flags = await getListingFlags();
  let cleared = 0;
  for (const l of listingsBySlug) {
    if (flags[l.id]?.flag === 'rejected') {
      if (await clearListingFlag(l.id)) cleared++;
    }
  }
  return NextResponse.json({ ok: true, cleared });
}
