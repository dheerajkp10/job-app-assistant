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
  clearListingFlag, readDb, writeDb, addCompanyRejection,
} from '@/lib/db';
import type { CompanyRejection } from '@/lib/types';

export const dynamic = 'force-dynamic';

export async function GET() {
  // Reconcile pass: any company with at least one 'rejected'
  // per-listing flag should ALSO appear in companyRejections.
  // Backfills entries from before the cascade landed (commit
  // c9f54e0) — listings flagged rejected back then were never
  // recorded as company-level rejections, so the pipeline page's
  // Rejected column missed them entirely. The `addCompanyRejection`
  // helper is idempotent, so calling it for already-listed
  // companies is a cheap no-op.
  const db = await readDb();
  const flags = await getListingFlags();
  const listingsById = new Map(
    db.listingsCache.listings.map((l) => [l.id, l] as const),
  );
  const seenSlugs = new Set<string>(
    (db.companyRejections ?? []).map((r) => r.companySlug),
  );
  const oldestByCompany = new Map<string, { name: string; ts: number }>();
  for (const entry of Object.values(flags)) {
    if (entry.flag !== 'rejected') continue;
    const listing = listingsById.get(entry.listingId);
    if (!listing) continue;
    const slug = listing.companySlug || listing.company.trim().toLowerCase();
    if (seenSlugs.has(slug)) continue;
    const ts = Date.parse(entry.flaggedAt);
    const prev = oldestByCompany.get(slug);
    if (!prev || ts < prev.ts) {
      oldestByCompany.set(slug, { name: listing.company, ts });
    }
  }
  // Apply backfills in chronological order so rejectedAt
  // timestamps mirror real history. addCompanyRejection sets
  // rejectedAt = Date.now() — for a more accurate backfill we
  // patch the entry's rejectedAt right after.
  if (oldestByCompany.size > 0) {
    for (const [slug, { name, ts }] of oldestByCompany) {
      await addCompanyRejection(slug, name);
      // Patch the timestamp to the oldest known flaggedAt so the
      // pipeline UI's "N days ago" matches when the user actually
      // rejected the company.
      const refreshed = await readDb();
      const target = (refreshed.companyRejections ?? []).find(
        (r) => r.companySlug === slug,
      );
      if (target && Date.parse(target.rejectedAt) > ts) {
        target.rejectedAt = new Date(ts).toISOString();
        await writeDb(refreshed);
      }
    }
  }

  const rejections: CompanyRejection[] = await getCompanyRejections();
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
