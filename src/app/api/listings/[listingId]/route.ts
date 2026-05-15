import { NextRequest, NextResponse } from 'next/server';
import { getListingById, updateListingSalary } from '@/lib/db';
import { fetchJobDetail } from '@/lib/job-fetcher';
import { extractSalary } from '@/lib/salary-parser';
import { cacheJobDetailHtml } from '@/lib/custom-fetchers';
import { jdRejectsSponsorship } from '@/lib/work-auth-filter';
import { readDb, writeDb } from '@/lib/db';

/**
 * GET /api/listings/[listingId]
 * Returns full job detail including content, qualifications, responsibilities.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ listingId: string }> }
) {
  const { listingId } = await params;

  // Find the listing in cache
  const listing = await getListingById(listingId);
  if (!listing) {
    return NextResponse.json({ error: 'Listing not found' }, { status: 404 });
  }

  // Fetch full details from the API
  try {
    const detail = await fetchJobDetail(listing);
    if (detail) {
      // Cache the JD body to disk so /api/search/jd can find it
      // later for full-text search. Standard ATSes (Greenhouse /
      // Lever / Ashby) return their content inline in the list
      // call, so this is the first chance we get to persist it
      // to a stable per-listing path. Non-fatal on write failure.
      if (detail.content) {
        void cacheJobDetailHtml(listingId, detail.content);
      }
      // Re-run the (now smarter) salary extractor against the full
      // JD body. Detail-fetcher results often have richer text than
      // whatever the list-time extractor saw, so this is our best
      // chance to pick up Base + TC splits, OTE, hourly rates, etc.
      // We prefer the parsed signal but keep whatever the fetcher
      // already populated as a fallback.
      const parsed = detail.content ? extractSalary(detail.content) : null;
      await updateListingSalary(listingId, {
        salary: parsed?.display ?? detail.salary,
        salaryMin: parsed?.min ?? detail.salaryMin,
        salaryMax: parsed?.max ?? detail.salaryMax,
        salaryBaseMin: parsed?.baseMin ?? null,
        salaryBaseMax: parsed?.baseMax ?? null,
        salaryTcMin: parsed?.tcMin ?? null,
        salaryTcMax: parsed?.tcMax ?? null,
        salaryEquityHint: parsed?.equityHint ?? null,
        salarySource: parsed?.source ?? null,
        salaryCurrency: parsed?.currency ?? null,
      });

      // Scan the JD body for explicit "we do not sponsor" phrasing.
      // Persisted on the listing so the filter pipeline can drop it
      // for users who require sponsorship (Settings.needsVisaSponsorship).
      // Only writes when we have a real signal so we don't churn the DB.
      if (detail.content) {
        const rejects = jdRejectsSponsorship(detail.content);
        if (rejects) {
          const db = await readDb();
          const idx = db.listingsCache.listings.findIndex((l) => l.id === listingId);
          if (idx !== -1 && !db.listingsCache.listings[idx].noSponsorship) {
            db.listingsCache.listings[idx] = {
              ...db.listingsCache.listings[idx],
              noSponsorship: true,
            };
            await writeDb(db);
          }
        }
      }
    }
    if (!detail) {
      return NextResponse.json({
        ...listing,
        content: '<p>Unable to load full details. Please visit the original listing.</p>',
        qualifications: [],
        responsibilities: [],
      });
    }
    return NextResponse.json(detail);
  } catch {
    return NextResponse.json({
      ...listing,
      content: '<p>Error loading details. Please try again or visit the original listing.</p>',
      qualifications: [],
      responsibilities: [],
    });
  }
}
