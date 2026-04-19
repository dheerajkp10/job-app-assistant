import { NextResponse } from 'next/server';
import { COMPANY_SOURCES } from '@/lib/sources';

export const dynamic = 'force-dynamic';

/**
 * GET /api/companies/preview
 * Returns the list of prospective companies we'll search against, as a
 * preview before the actual fetch. For now this is the full COMPANY_SOURCES
 * list (minus duplicates), optionally ranked by region match against the
 * user's preferred locations.
 */
export async function GET() {
  const companies = COMPANY_SOURCES.map((c) => ({
    name: c.name,
    slug: c.slug,
    ats: c.ats,
    region: c.region,
  }));

  // De-dupe in case of any accidental repeats in sources.ts
  const seen = new Set<string>();
  const unique = companies.filter((c) => {
    const key = c.slug.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // Sort alphabetically so the preview is predictable
  unique.sort((a, b) => a.name.localeCompare(b.name));

  return NextResponse.json({ companies: unique, total: unique.length });
}
