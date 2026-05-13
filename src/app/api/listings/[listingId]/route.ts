import { NextRequest, NextResponse } from 'next/server';
import { getListingById, updateListingSalary } from '@/lib/db';
import { fetchJobDetail } from '@/lib/job-fetcher';

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
      // Persist any newly-extracted salary back to the cache so the
      // salary-intel cohort grows as the user opens more listings.
      await updateListingSalary(listingId, {
        salary: detail.salary,
        salaryMin: detail.salaryMin,
        salaryMax: detail.salaryMax,
      });
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
