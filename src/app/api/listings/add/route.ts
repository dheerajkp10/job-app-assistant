import { NextRequest, NextResponse } from 'next/server';
import { getListingsCache, saveListingsCache } from '@/lib/db';
import { writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { randomUUID } from 'crypto';
import type { JobListing } from '@/lib/types';

/**
 * POST /api/listings/add
 * Manually add a listing to the listings cache.
 * Used when user adds a job from the Add Job page so it also appears on
 * the listings page and can be scored / tailored via the ATS pipeline.
 *
 * Body: { company, title, location, url, description, portal }
 */
export async function POST(req: NextRequest) {
  const { company, title, location, url: jobUrl, description } = await req.json();

  if (!company || !title) {
    return NextResponse.json({ error: 'company and title are required' }, { status: 400 });
  }

  const id = `manual-${randomUUID()}`;

  const listing: JobListing = {
    id,
    sourceId: id,
    company,
    companySlug: company.toLowerCase().replace(/\s+/g, '-'),
    title,
    location: location || 'Not specified',
    department: '',
    salary: null,
    salaryMin: null,
    salaryMax: null,
    url: jobUrl || '',
    ats: 'greenhouse', // placeholder — manual entries don't have a real ATS
    postedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    fetchedAt: new Date().toISOString(),
  };

  // Save listing into the cache
  const cache = await getListingsCache();
  cache.listings.push(listing);
  await saveListingsCache(cache);

  // Store the job description as a local file so fetchJobDetail can
  // read it when the ATS scorer or tailor-resume routes need it.
  if (description) {
    const detailDir = join(process.cwd(), 'data', 'listing-details');
    if (!existsSync(detailDir)) {
      await mkdir(detailDir, { recursive: true });
    }
    await writeFile(join(detailDir, `${id}.html`), description, 'utf-8');
  }

  return NextResponse.json({ listingId: id, listing });
}
