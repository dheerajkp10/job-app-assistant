import { NextRequest, NextResponse } from 'next/server';
import { extractJobFromUrl } from '@/lib/job-extractor';
import { getListingsCache } from '@/lib/db';

/**
 * Normalize a job URL for cross-listing comparison. Strips trailing
 * slashes, query strings, and protocol differences (http/https) so a
 * user pasting the exact URL we already have in cache still matches.
 *
 * Why not just `===`: career page URLs often have utm_source / gh_src
 * /  ?source=indeed type query strings appended; without normalization
 * those differ from the canonical URL we cached during the bulk fetch.
 */
function normalizeUrl(raw: string): string {
  try {
    const u = new URL(raw);
    const path = u.pathname.replace(/\/+$/, '');
    return `${u.host}${path}`.toLowerCase();
  } catch {
    return raw.replace(/\/+$/, '').toLowerCase();
  }
}

export async function POST(req: NextRequest) {
  const { url } = await req.json();

  if (!url) {
    return NextResponse.json({ error: 'url is required' }, { status: 400 });
  }

  // Dedup pre-check: before scraping the URL, see if we already have
  // a listing with the exact URL in the cache. This is a strict
  // savings on the common case ("user copies a Stripe URL we already
  // pulled from Greenhouse") AND prevents creating a duplicate
  // manual-* listing that would shadow the auto-fetched one.
  try {
    const cache = await getListingsCache();
    const target = normalizeUrl(url);
    const match = cache.listings.find((l) => normalizeUrl(l.url) === target);
    if (match) {
      return NextResponse.json({
        match: {
          listingId: match.id,
          company: match.company,
          title: match.title,
          location: match.location,
          ats: match.ats,
        },
      });
    }
  } catch {
    // If the dedup check itself fails (e.g. cache corruption), fall
    // through to extraction — better to risk a duplicate than to fail
    // the Add Job flow entirely.
  }

  try {
    const result = await extractJobFromUrl(url);
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to extract job from URL';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
