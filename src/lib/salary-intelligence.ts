/**
 * Salary intelligence — derives "what's normal" from the user's own
 * listings cache rather than requiring a Levels.fyi / Glassdoor API.
 *
 * For a given listing, finds peer listings (same role family, same
 * location bucket) and reports the median + p25/p75 of posted
 * salaries across those peers. Falls back to global stats when the
 * peer cohort is too small.
 *
 * Limitations
 * ───────────
 * Posted salaries skew low (companies often post the floor of their
 * band). Not all postings include a range. The peer cohort is bounded
 * by what the user's filters pull in. We surface n= and a confidence
 * label so the user can interpret accordingly.
 */

import type { JobListing } from './types';

export interface SalaryStats {
  /** Sample size feeding the stats. */
  n: number;
  median: number;
  p25: number;
  p75: number;
  /** "high" (n ≥ 30), "medium" (n ≥ 10), "low" (n < 10). UI cue. */
  confidence: 'low' | 'medium' | 'high';
  /** Where the cohort came from — purely for display. */
  scope: string;
}

/** Title → role family bucket. Same idea as the level matcher; we
 *  reuse a simple keyword-based grouping so we can find peers
 *  without depending on the heavier resume-tailor code. */
const ROLE_FAMILY_RULES: { family: string; keywords: string[] }[] = [
  { family: 'Software Engineer', keywords: ['software engineer', 'sde', 'developer', 'backend', 'frontend', 'full-stack', 'fullstack'] },
  { family: 'Engineering Manager', keywords: ['engineering manager', 'software development manager', 'em', 'manager of engineering'] },
  { family: 'Director of Engineering', keywords: ['director of engineering', 'engineering director', 'sr. director'] },
  { family: 'Staff Engineer', keywords: ['staff engineer', 'principal engineer', 'distinguished'] },
  { family: 'Product Manager', keywords: ['product manager', 'pm,', 'group product manager', 'tpm', 'technical program manager'] },
  { family: 'Data Scientist', keywords: ['data scientist', 'applied scientist'] },
  { family: 'ML Engineer', keywords: ['machine learning engineer', 'ml engineer', 'mle', 'ai engineer'] },
  { family: 'Designer', keywords: ['designer', 'ux', 'ui designer'] },
  { family: 'DevOps / SRE', keywords: ['devops', 'site reliability', 'sre', 'platform engineer'] },
  { family: 'Security Engineer', keywords: ['security engineer', 'application security', 'appsec'] },
];

export function classifyRoleFamily(title: string): string | null {
  const t = title.toLowerCase();
  for (const rule of ROLE_FAMILY_RULES) {
    for (const k of rule.keywords) {
      if (t.includes(k)) return rule.family;
    }
  }
  return null;
}

/** Coarsely bucket a location string. "Seattle, WA" / "Bellevue, WA"
 *  → "WA-Seattle"; "Remote — US" → "Remote-US"; everything else →
 *  the raw lowercased string. We only care about same-bucket peers. */
function bucketLocation(loc: string): string {
  const lc = loc.toLowerCase();
  if (/\bremote\b/.test(lc)) {
    if (/india|bangalore/.test(lc)) return 'Remote-IN';
    if (/canada|toronto|vancouver/.test(lc)) return 'Remote-CA';
    if (/uk|london|united kingdom/.test(lc)) return 'Remote-UK';
    return 'Remote-US';
  }
  if (/\bwa\b|seattle|bellevue|kirkland|redmond/.test(lc)) return 'WA-Seattle';
  if (/san francisco|sf bay|palo alto|sunnyvale|menlo park|cupertino|mountain view|san jose|oakland/.test(lc)) return 'CA-SFBay';
  if (/new york|nyc|brooklyn|manhattan/.test(lc)) return 'NY-NYC';
  if (/austin|texas/.test(lc)) return 'TX-Austin';
  return lc.split(',')[0].trim();
}

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  const pos = (sorted.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  if (sorted[base + 1] !== undefined) {
    return sorted[base] + rest * (sorted[base + 1] - sorted[base]);
  }
  return sorted[base];
}

/**
 * Given a target listing and the full listings array, find peers in
 * the same role family + location bucket and compute salary stats.
 * Returns null when there aren't enough peers with salary data.
 */
export function computeSalaryStats(
  target: JobListing,
  allListings: JobListing[],
): SalaryStats | null {
  const family = classifyRoleFamily(target.title);
  const targetBucket = bucketLocation(target.location);

  // Collect midpoints of any listing with both family + bucket match.
  const tightSamples: number[] = [];
  const familySamples: number[] = [];
  for (const l of allListings) {
    if (l.id === target.id) continue;
    const mid = midpoint(l);
    if (mid == null) continue;
    const lFamily = classifyRoleFamily(l.title);
    if (family && lFamily === family) {
      familySamples.push(mid);
      if (bucketLocation(l.location) === targetBucket) tightSamples.push(mid);
    }
  }

  // Prefer the tight cohort; fall back to family-only if too small.
  const samples = tightSamples.length >= 5 ? tightSamples : familySamples;
  if (samples.length < 3) return null;

  const sorted = [...samples].sort((a, b) => a - b);
  const median = Math.round(quantile(sorted, 0.5));
  const p25 = Math.round(quantile(sorted, 0.25));
  const p75 = Math.round(quantile(sorted, 0.75));
  const n = samples.length;
  const confidence: SalaryStats['confidence'] =
    n >= 30 ? 'high' : n >= 10 ? 'medium' : 'low';
  const scope = tightSamples.length >= 5
    ? `${family} in ${targetBucket}`
    : `${family ?? 'Similar roles'} (any location)`;
  return { n, median, p25, p75, confidence, scope };
}

function midpoint(l: JobListing): number | null {
  if (l.salaryMin != null && l.salaryMax != null) {
    return (l.salaryMin + l.salaryMax) / 2;
  }
  if (l.salaryMin != null) return l.salaryMin;
  if (l.salaryMax != null) return l.salaryMax;
  return null;
}
