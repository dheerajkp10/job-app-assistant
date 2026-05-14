import { NextRequest, NextResponse } from 'next/server';
import { getListingById } from '@/lib/db';
import { fetchJobDetail } from '@/lib/job-fetcher';

/**
 * GET /api/keyword-context?listingId=<id>&keyword=<word>
 *
 * Returns the sentences in the listing's JD body that contain the
 * given keyword. Powers the per-keyword explanation popover on the
 * listings page: click a missing keyword → see exactly where in the
 * JD it came from so the score feels grounded.
 *
 * Match strategy:
 *   - Tokenize the keyword the same way the scorer does (split on
 *     `-` / `_`, lowercase, individual words). A keyword like
 *     "distributed-systems" matches a sentence containing either
 *     'distributed' or 'systems' adjacent.
 *   - For each variant, build a word-boundary regex so we don't
 *     match 'java' inside 'javascript'.
 *   - Cap results at 6 sentences so the popover stays compact.
 *
 * Response: { sentences: string[], totalMatches: number, source }
 *   source = 'cache' when we found the JD content via fetchJobDetail
 *   (which checks the on-disk listing-details cache first); the UI
 *   uses this only for diagnostics.
 */
export async function GET(req: NextRequest) {
  const listingId = req.nextUrl.searchParams.get('listingId');
  const keyword = (req.nextUrl.searchParams.get('keyword') ?? '').trim();
  if (!listingId || !keyword) {
    return NextResponse.json(
      { error: 'listingId and keyword are required' },
      { status: 400 },
    );
  }

  const listing = await getListingById(listingId);
  if (!listing) {
    return NextResponse.json({ error: 'Listing not found' }, { status: 404 });
  }
  const detail = await fetchJobDetail(listing);
  if (!detail) {
    return NextResponse.json({ sentences: [], totalMatches: 0, source: 'none' });
  }

  const plain = (detail.content ?? '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!plain) {
    return NextResponse.json({ sentences: [], totalMatches: 0, source: 'empty' });
  }

  // Build a word-boundary regex for each token of the keyword.
  // Match a sentence if it contains ANY token (catches multi-word
  // keywords like 'distributed systems' across sentence boundaries
  // less precisely — close enough for an explanation UI).
  const tokens = keyword
    .toLowerCase()
    .split(/[-_\s]+/)
    .filter((t) => t.length >= 3);
  if (tokens.length === 0) {
    return NextResponse.json({ sentences: [], totalMatches: 0, source: 'short' });
  }
  const tokenRegexes = tokens.map(
    (t) => new RegExp(`\\b${t.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\$&')}\\b`, 'i'),
  );

  // Sentence-split. JDs are messy — handle ., !, ?, newlines, and
  // bullet markers as terminators.
  const sentences = plain
    .split(/(?<=[.!?])\s+|[\n•]+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 12 && s.length < 320);

  const hits: string[] = [];
  for (const s of sentences) {
    if (tokenRegexes.some((re) => re.test(s))) {
      hits.push(s);
      if (hits.length >= 6) break;
    }
  }

  return NextResponse.json({
    sentences: hits,
    totalMatches: hits.length,
    source: 'cache',
  });
}
