import { NextRequest, NextResponse } from 'next/server';
import { readdir, readFile } from 'fs/promises';
import { join, basename, extname } from 'path';

/**
 * Full-text search across cached job-description bodies.
 *
 * The detail-fetch path writes `data/listing-details/<id>.html` for
 * any listing whose JD body we've fetched. This endpoint scans
 * that directory, strips HTML, and returns the IDs of listings
 * whose JD text contains the query (case-insensitive substring).
 *
 * GET /api/search/jd?q=<query>
 *   → { matchingIds: string[], cachedCount: number }
 *
 * Coverage caveat: a listing only contributes a result if its JD
 * body has been cached. Listings whose body has never been fetched
 * are invisible to this search. The listings page surfaces this as
 * "matches in N of M cached job descriptions" so the user knows
 * coverage is partial.
 */
const CACHE_DIR = join(process.cwd(), 'data', 'listing-details');

export async function GET(req: NextRequest) {
  const q = (req.nextUrl.searchParams.get('q') ?? '').trim();
  if (!q) return NextResponse.json({ matchingIds: [], cachedCount: 0 });

  const needle = q.toLowerCase();
  let files: string[] = [];
  try {
    files = await readdir(CACHE_DIR);
  } catch {
    return NextResponse.json({ matchingIds: [], cachedCount: 0 });
  }
  const htmlFiles = files.filter((f) => extname(f) === '.html');

  const matches: string[] = [];
  // Sequential read keeps disk IO predictable on the JSON-file db
  // (the same fd budget the rest of the app uses). 296KB across 43
  // files runs in < 50ms in practice — no need to parallelize.
  for (const f of htmlFiles) {
    try {
      const raw = await readFile(join(CACHE_DIR, f), 'utf-8');
      const text = raw.replace(/<[^>]+>/g, ' ').toLowerCase();
      if (text.includes(needle)) {
        matches.push(basename(f, '.html'));
      }
    } catch {
      // skip unreadable file
    }
  }

  return NextResponse.json({
    matchingIds: matches,
    cachedCount: htmlFiles.length,
  });
}
