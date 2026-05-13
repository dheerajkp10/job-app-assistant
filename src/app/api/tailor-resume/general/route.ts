import { NextRequest, NextResponse } from 'next/server';
import { readDb } from '@/lib/db';
import { filterByUserPreferences } from '@/lib/role-filter';
import { matchesLevelPreference } from '@/lib/level-matcher';
import { isWorkAuthorized } from '@/lib/work-auth-filter';
import { buildLocationMatcher } from '@/lib/location-match';
import { classifyRoleFamily } from '@/lib/salary-intelligence';
import { isUnscorableAts } from '@/lib/scorable';
import {
  getCompanyAliases,
  isExcludedCompany,
  detectCurrentCompany,
} from '@/lib/current-company';
import type { JobListing, Settings } from '@/lib/types';

/**
 * POST /api/tailor-resume/general
 *
 * "Master resume" tailor — generates ONE resume optimized for the
 * broadest possible coverage across every open listing matching the
 * user's stored preferences. Unlike /multi (which takes an explicit
 * listingIds array) this route selects the cohort itself based on
 * stored settings: role family, level, location, work mode, salary
 * range, work auth countries, excluded companies.
 *
 * The selection step uses **stratified sampling**: listings are
 * grouped by role family (Software Engineer, Engineering Manager,
 * Staff Engineer, …), top-K per family are picked by ATS score, then
 * the picks are unioned until we hit the cap. This keeps the
 * aggregated keyword set balanced across the user's target roles
 * instead of being dominated by whichever family has the most
 * listings.
 *
 * Once listings are picked, the route forwards to /multi for the
 * actual keyword aggregation + tailoring pipeline. /multi already
 * handles mandatory-mode compression cascade, suggestions, and
 * docx/pdf rendering — we just supply it with a curated input set.
 *
 * Body:
 *   {
 *     // Same modes as /multi: 'analyze' (default) returns the
 *     // aggregated keywords + cohort metadata for review; 'pdf' or
 *     // 'docx' generates the tailored resume.
 *     format?: 'analyze' | 'pdf' | 'docx';
 *
 *     // Selection cap. Defaults to 100. Stratified across role
 *     // families. Caller can override (e.g. for fast preview).
 *     cap?: number;
 *
 *     // Forwarded to /multi when generating: which auto-selected
 *     // keywords the user kept in the review step, and any accepted
 *     // tailoring suggestions. Required for pdf/docx.
 *     selectedKeywords?: string[];
 *     selectedSuggestions?: string[];
 *
 *     // 'mandatory' (default) or 'budget-ladder' — same semantics
 *     // as /multi and /tailor-resume.
 *     mode?: 'mandatory' | 'budget-ladder';
 *   }
 *
 * Analyze response adds, on top of the /multi analyze fields:
 *   cohort: {
 *     totalMatching: number;     // listings matching prefs (before cap)
 *     sampled: number;           // listings actually analyzed
 *     byFamily: Record<string, number>;  // sample distribution
 *   }
 */
export async function POST(req: NextRequest) {
  const body = await req.json();
  const {
    format = 'analyze',
    cap = 100,
    selectedKeywords,
    selectedSuggestions,
    mode,
  } = body;

  // Read settings + listings cache once.
  const db = await readDb();
  const settings = db.settings;
  const allListings = db.listingsCache?.listings ?? [];

  if (allListings.length === 0) {
    return NextResponse.json(
      { error: 'No listings in cache. Run a fetch refresh first.' },
      { status: 400 },
    );
  }

  // ── Apply user preferences (mirrors src/app/listings/page.tsx) ────
  const filtered = applyPreferenceFilters(allListings, settings, db.scoreCache);

  if (filtered.length === 0) {
    return NextResponse.json(
      {
        error:
          'No listings match your current preferences. Loosen role/level/location filters in Settings, then try again.',
      },
      { status: 400 },
    );
  }

  // ── Stratified sample by role family ──────────────────────────────
  const sampled = stratifiedSampleByFamily(filtered, db.scoreCache, cap);
  const familyDistribution = countByFamily(sampled);

  if (format === 'analyze') {
    // Forward to /multi for the keyword aggregation. We can't
    // import the heavy aggregation/scoring logic without circular
    // dependency risk, so we hit the route over HTTP — same pattern
    // /tailor-resume/stream uses. The /multi analyze pass already
    // handles per-job detail fetching, frequency-ranked aggregation,
    // and category bucketing.
    const targetUrl = new URL('/api/tailor-resume/multi', req.url);
    const res = await fetch(targetUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        listingIds: sampled.map((l) => l.id),
        format: 'analyze',
      }),
    });
    const data = await res.json();
    if (!res.ok || data.error) {
      return NextResponse.json(
        { error: data.error || `Analyze pass failed (HTTP ${res.status})` },
        { status: res.status || 500 },
      );
    }
    // Decorate /multi's response with cohort metadata so the UI can
    // show "Analyzed 47 listings across 3 role families".
    return NextResponse.json({
      ...data,
      cohort: {
        totalMatching: filtered.length,
        sampled: sampled.length,
        cap,
        byFamily: familyDistribution,
      },
    });
  }

  // ── Generate mode: forward to /multi for the actual render ────────
  if (format === 'pdf' || format === 'docx') {
    if (!Array.isArray(selectedKeywords) || selectedKeywords.length === 0) {
      return NextResponse.json(
        { error: 'selectedKeywords is required for pdf/docx generation' },
        { status: 400 },
      );
    }
    const targetUrl = new URL('/api/tailor-resume/multi', req.url);
    const res = await fetch(targetUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        listingIds: sampled.map((l) => l.id),
        selectedKeywords,
        selectedSuggestions,
        format,
        mode,
      }),
    });
    // Forward the binary response verbatim — /multi already
    // streams the PDF/DOCX and sets X-Compression-Steps. We just
    // pipe through.
    if (!res.ok) {
      let errMsg = `HTTP ${res.status}`;
      try {
        const j = await res.json();
        if (j.error) errMsg = j.error;
      } catch {
        // not JSON — keep status
      }
      return NextResponse.json({ error: errMsg }, { status: res.status });
    }
    const buffer = Buffer.from(await res.arrayBuffer());
    const headers: Record<string, string> = {};
    // Pass through every header /multi set on the binary response
    // so the browser receives the right Content-Type, filename, and
    // compression-steps metadata.
    const passThrough = [
      'Content-Type',
      'Content-Disposition',
      'Content-Length',
      'X-Compression-Steps',
      'Access-Control-Expose-Headers',
    ];
    for (const h of passThrough) {
      const v = res.headers.get(h);
      if (v != null) headers[h] = v;
    }
    return new NextResponse(buffer as unknown as BodyInit, {
      status: 200,
      headers,
    });
  }

  return NextResponse.json(
    { error: `Unknown format: ${format}. Use 'analyze', 'pdf', or 'docx'.` },
    { status: 400 },
  );
}

// ──────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────

/**
 * Apply every preference filter the listings page applies, server-
 * side. Keeps the master-resume cohort in sync with what the user
 * sees in their listings view: role family, level, location, work
 * mode, salary range, work auth, excluded companies, unscorable
 * ATSes, and the user's own current employer (if detected).
 *
 * We deliberately do NOT apply per-listing user flags (applied,
 * not-applicable, etc) here — the master resume optimizes for the
 * full market matching the user's prefs, not for what they've
 * personally engaged with.
 */
function applyPreferenceFilters(
  listings: JobListing[],
  settings: Settings,
  scoreCache: Record<string, { overall: number; totalCount: number }> | undefined,
): JobListing[] {
  // Role family
  let result = filterByUserPreferences(
    listings,
    settings.preferredRoles ?? [],
  );

  // Level
  if (settings.preferredLevels && settings.preferredLevels.length > 0) {
    result = result.filter((l) =>
      matchesLevelPreference(l.title, settings.preferredLevels!),
    );
  }

  // Location — same synonym-aware matcher the listings page uses
  if (settings.preferredLocations && settings.preferredLocations.length > 0) {
    const matcher = buildLocationMatcher({
      preferredLocations: settings.preferredLocations,
      workModes: settings.workMode ?? [],
      workAuthCountries: settings.workAuthCountries ?? ['US'],
    });
    result = result.filter((l) => matcher(l.location));
  }

  // Work auth
  result = result.filter((l) =>
    isWorkAuthorized(l.location, settings.workAuthCountries ?? ['US']),
  );

  // Salary range
  if (settings.salaryMin != null || settings.salaryMax != null) {
    result = result.filter((l) => {
      const hasSalary = l.salaryMin != null || l.salaryMax != null;
      // Keep listings without salary info — we don't want to drop
      // 90% of postings just because they don't post comp.
      if (!hasSalary) return true;
      if (settings.salaryMin != null) {
        const top = l.salaryMax ?? l.salaryMin ?? 0;
        if (top < settings.salaryMin) return false;
      }
      if (settings.salaryMax != null) {
        const bottom = l.salaryMin ?? l.salaryMax ?? 0;
        if (bottom > settings.salaryMax) return false;
      }
      return true;
    });
  }

  // Excluded companies (manual + auto-detected current employer)
  const explicitExcludes = (settings.excludedCompanies ?? []).map((c) =>
    c.toLowerCase().trim(),
  );
  const currentEmployer = detectCurrentCompany(settings.baseResumeText ?? '');
  const allExcludes = new Set([
    ...explicitExcludes,
    ...(currentEmployer ? getCompanyAliases(currentEmployer).map((c) => c.toLowerCase()) : []),
  ]);
  if (allExcludes.size > 0) {
    result = result.filter(
      (l) => !isExcludedCompany(l.company, [...allExcludes]),
    );
  }

  // Drop unscorable ATSes — the master resume is fundamentally
  // about ATS keyword coverage, and listings we can't score don't
  // contribute meaningful keyword signal. Listings with no fetched
  // JD detail also can't be aggregated.
  result = result.filter((l) => !isUnscorableAts(l.ats));

  // Prefer scored listings — they have richer aggregation potential.
  // But keep unscored ones too if they pass the prefs filter, since
  // /multi will fetch their details on demand.
  // (Sorting happens in stratifiedSampleByFamily; nothing to do here.)
  void scoreCache;

  return result;
}

/**
 * Group by role family (using the same `classifyRoleFamily` heuristic
 * salary-intelligence uses) and pick top-K-by-ATS-score from each
 * family until we hit the cap. Families that are smaller than their
 * quota contribute all their listings; the remaining budget rolls
 * over to other families in a second pass.
 *
 * Listings without a recognized role family fall into a single
 * 'unclassified' bucket and get the same per-stratum treatment.
 */
function stratifiedSampleByFamily(
  listings: JobListing[],
  scoreCache: Record<string, { overall: number; totalCount: number }> | undefined,
  cap: number,
): JobListing[] {
  if (listings.length <= cap) return listings;

  // Bucket by role family
  const byFamily = new Map<string, JobListing[]>();
  for (const l of listings) {
    const fam = classifyRoleFamily(l.title) ?? 'unclassified';
    const bucket = byFamily.get(fam);
    if (bucket) bucket.push(l);
    else byFamily.set(fam, [l]);
  }

  // Sort each bucket by ATS score (highest first). Unscored entries
  // get -1 so scored ones always come first within a stratum.
  const scoreOf = (id: string) => {
    const s = scoreCache?.[id];
    return s && s.totalCount > 0 ? s.overall : -1;
  };
  for (const bucket of byFamily.values()) {
    bucket.sort((a, b) => scoreOf(b.id) - scoreOf(a.id));
  }

  // First pass: even quota per family. If a family has fewer than
  // quota listings, the slack rolls over to a second pass that
  // tops up from families with leftovers.
  const families = Array.from(byFamily.keys());
  const perFamilyQuota = Math.max(1, Math.floor(cap / families.length));
  const picked: JobListing[] = [];
  const leftover = new Map<string, JobListing[]>();

  for (const fam of families) {
    const bucket = byFamily.get(fam)!;
    const take = bucket.slice(0, perFamilyQuota);
    picked.push(...take);
    if (bucket.length > take.length) {
      leftover.set(fam, bucket.slice(take.length));
    }
  }

  // Second pass — fill the remaining budget by score-merging the
  // leftover buckets. Largest-score-first across families.
  const remaining = cap - picked.length;
  if (remaining > 0 && leftover.size > 0) {
    const flatLeftover = Array.from(leftover.values())
      .flat()
      .sort((a, b) => scoreOf(b.id) - scoreOf(a.id))
      .slice(0, remaining);
    picked.push(...flatLeftover);
  }

  return picked.slice(0, cap);
}

function countByFamily(listings: JobListing[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const l of listings) {
    const fam = classifyRoleFamily(l.title) ?? 'unclassified';
    counts[fam] = (counts[fam] ?? 0) + 1;
  }
  return counts;
}
