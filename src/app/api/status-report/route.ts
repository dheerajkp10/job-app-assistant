import { NextResponse } from 'next/server';
import { readDb } from '@/lib/db';
import { PIPELINE_FLAGS } from '@/lib/types';
import type { JobListing } from '@/lib/types';

/**
 * GET /api/status-report
 *
 * Returns a shareable Markdown summary of the user's pipeline + a
 * condensed application status. Designed to be pasted into a
 * weekly mentor email or printed to PDF via the browser's "Save
 * as PDF" path. No external PDF dep.
 *
 * The report includes:
 *   - Header with date + total counts per pipeline stage
 *   - One section per pipeline stage with a list of company / role
 *     / location / score / posted date
 *   - A "Recently scored" section pulling top-5 scored listings
 *     that aren't on the pipeline (high-potential leads)
 */

function fmtDate(d: string | undefined | null): string {
  if (!d) return '';
  const t = Date.parse(d);
  if (isNaN(t)) return '';
  return new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export async function GET() {
  const db = await readDb();
  const listings = db.listingsCache.listings ?? [];
  const flags = db.listingFlags ?? {};
  const scores = db.scoreCache ?? {};
  const today = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });

  const byId = new Map<string, JobListing>();
  for (const l of listings) byId.set(l.id, l);

  // Group flags by pipeline stage.
  const byStage: Record<string, { listing: JobListing; flaggedAt: string }[]> = {};
  for (const f of PIPELINE_FLAGS) byStage[f.key] = [];
  for (const entry of Object.values(flags)) {
    const listing = byId.get(entry.listingId);
    if (!listing) continue;
    if (!byStage[entry.flag]) continue; // triage flag — skip
    byStage[entry.flag].push({ listing, flaggedAt: entry.flaggedAt });
  }
  for (const k of Object.keys(byStage)) {
    byStage[k].sort((a, b) => Date.parse(b.flaggedAt) - Date.parse(a.flaggedAt));
  }

  const totalOnBoard = PIPELINE_FLAGS.reduce((acc, f) => acc + byStage[f.key].length, 0);

  // Top-5 unflagged listings by score — "high-potential leads".
  const flaggedIds = new Set(Object.keys(flags));
  const leads = Object.values(scores)
    .filter((s) => !flaggedIds.has(s.listingId) && s.totalCount > 0)
    .sort((a, b) => b.overall - a.overall)
    .slice(0, 5)
    .map((s) => ({ score: s, listing: byId.get(s.listingId) }))
    .filter((x): x is { score: typeof scores[string]; listing: JobListing } => !!x.listing);

  // ── Render Markdown ────────────────────────────────────────────
  const lines: string[] = [];
  lines.push(`# Job Search Status — ${today}`);
  lines.push('');
  lines.push('## Pipeline summary');
  lines.push('');
  lines.push('| Stage | Count |');
  lines.push('| --- | ---: |');
  for (const f of PIPELINE_FLAGS) {
    lines.push(`| ${f.label} | ${byStage[f.key].length} |`);
  }
  lines.push(`| **Total active** | **${totalOnBoard}** |`);
  lines.push('');

  // Per-stage detail
  for (const f of PIPELINE_FLAGS) {
    const items = byStage[f.key];
    if (items.length === 0) continue;
    lines.push(`### ${f.label} (${items.length})`);
    lines.push('');
    for (const { listing, flaggedAt } of items) {
      const sc = scores[listing.id];
      const scoreStr = sc && sc.totalCount > 0 ? ` · ${sc.overall}%` : '';
      lines.push(`- **${listing.title}** — ${listing.company} · ${listing.location}${scoreStr} · _moved to ${f.label.toLowerCase()} ${fmtDate(flaggedAt)}_`);
    }
    lines.push('');
  }

  if (leads.length > 0) {
    lines.push('## High-potential leads');
    lines.push('_Top scored listings you haven\'t acted on yet._');
    lines.push('');
    for (const { listing, score } of leads) {
      lines.push(`- **${listing.title}** — ${listing.company} · ${listing.location} · ${score.overall}% match`);
    }
    lines.push('');
  }

  lines.push('---');
  lines.push('_Generated locally by Job Application Assistant. No data left this machine._');

  return new NextResponse(lines.join('\n'), {
    status: 200,
    headers: {
      'Content-Type': 'text/markdown; charset=utf-8',
      'Content-Disposition': `inline; filename="status-${new Date().toISOString().slice(0, 10)}.md"`,
    },
  });
}
