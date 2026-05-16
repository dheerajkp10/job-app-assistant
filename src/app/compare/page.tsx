'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Loader2, X, ExternalLink, MapPin, DollarSign, Calendar, Briefcase } from 'lucide-react';
import type { JobListing, ScoreCacheEntry } from '@/lib/types';
import { CompanyLogo } from '@/components/company-logo';

/**
 * Side-by-side comparison view.
 *
 * URL query: `?ids=<id1>,<id2>,<id3>` — supports up to 3 listings.
 * The Job Listings page links here when the user picks 2-3 cards
 * via the per-card "Compare" toggle.
 *
 * Renders one column per listing: company / title / location /
 * salary / overall score / category bars / top matched & missing
 * keywords. Headers stay in sync across columns; the user can
 * remove a column without leaving the page (re-pushes the URL).
 */
export default function ComparePage() {
  const [allListings, setAllListings] = useState<JobListing[]>([]);
  const [scoreCache, setScoreCache] = useState<Record<string, ScoreCacheEntry>>({});
  const [loading, setLoading] = useState(true);
  const [ids, setIds] = useState<string[]>([]);

  // Read ?ids= on mount and on history changes (browser back/forward).
  useEffect(() => {
    const sync = () => {
      const params = new URLSearchParams(window.location.search);
      const raw = params.get('ids') ?? '';
      setIds(raw.split(',').map((s) => s.trim()).filter(Boolean).slice(0, 3));
    };
    sync();
    window.addEventListener('popstate', sync);
    return () => window.removeEventListener('popstate', sync);
  }, []);

  useEffect(() => {
    Promise.all([
      fetch('/api/listings').then((r) => r.json()),
      fetch('/api/scores-cache').then((r) => r.json()),
    ])
      .then(([listings, scores]) => {
        setAllListings(listings.listings || []);
        setScoreCache(scores || {});
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const selected = useMemo(() => {
    const byId = new Map<string, JobListing>();
    for (const l of allListings) byId.set(l.id, l);
    return ids.map((id) => byId.get(id)).filter(Boolean) as JobListing[];
  }, [allListings, ids]);

  function removeId(id: string) {
    const next = ids.filter((x) => x !== id);
    setIds(next);
    const url = next.length > 0
      ? `/compare?ids=${next.join(',')}`
      : '/compare';
    window.history.pushState({}, '', url);
  }

  if (loading) {
    return (
      <div className="p-8 flex flex-col items-center justify-center min-h-[60vh]">
        <Loader2 className="w-10 h-10 text-indigo-500 animate-spin mb-4" />
        <h2 className="text-lg font-semibold text-slate-800 mb-2">Loading comparison…</h2>
      </div>
    );
  }

  if (selected.length === 0) {
    return (
      <div className="p-4 sm:p-8 max-w-3xl mx-auto">
        <h1 className="text-3xl font-bold tracking-tight bg-gradient-to-r from-slate-800 via-indigo-600 to-violet-600 bg-clip-text text-transparent mb-3">
          Compare Listings
        </h1>
        <p className="text-sm text-slate-500">
          No listings selected. Open <Link href="/listings" className="text-indigo-600 underline">Job Listings</Link>, tick the &ldquo;Compare&rdquo; box on 2&ndash;3 cards, then come back here.
        </p>
      </div>
    );
  }

  // ── Enrichment helpers ─────────────────────────────────────────────
  function detectWorkMode(loc: string): 'Remote' | 'Hybrid' | 'On-site' | null {
    if (!loc) return null;
    const lc = loc.toLowerCase();
    if (lc.includes('remote')) return 'Remote';
    if (lc.includes('hybrid')) return 'Hybrid';
    if (loc === 'Not specified') return null;
    return 'On-site';
  }
  function formatSalaryRange(l: JobListing): string | null {
    if (l.salaryMin != null && l.salaryMax != null) {
      return `$${Math.round(l.salaryMin / 1000)}k – $${Math.round(l.salaryMax / 1000)}k`;
    }
    if (l.salaryMin != null) return `from $${Math.round(l.salaryMin / 1000)}k`;
    if (l.salaryMax != null) return `up to $${Math.round(l.salaryMax / 1000)}k`;
    return l.salary;
  }
  function formatPosted(iso: string | null | undefined): string | null {
    if (!iso) return null;
    const ms = Date.parse(iso);
    if (isNaN(ms)) return null;
    const days = Math.floor((Date.now() - ms) / (24 * 3600 * 1000));
    if (days <= 0) return 'today';
    if (days === 1) return 'yesterday';
    if (days < 30) return `${days} days ago`;
    return new Date(ms).toLocaleDateString();
  }
  // Are every selected listing from the same company? Drives the
  // "same-company variants" callout — when true, the user is
  // weighing two roles inside one org, not across orgs, and we
  // emphasize role-level differences over company-level signals.
  const sameCompany =
    selected.length >= 2 &&
    selected.every((l) => l.company === selected[0].company);

  // Row helpers — render once per metric across all columns.
  const renderHeader = (l: JobListing) => (
    <div className="flex items-start justify-between gap-2 mb-3">
      <div className="flex items-center gap-2 min-w-0">
        <CompanyLogo companySlug={l.companySlug} companyName={l.company} size={32} />
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-slate-800 line-clamp-2">{l.title}</h3>
          <p className="text-xs text-slate-600 truncate">{l.company}</p>
        </div>
      </div>
      <button
        type="button"
        onClick={() => removeId(l.id)}
        className="p-1 rounded text-slate-400 hover:bg-red-50 hover:text-red-600 shrink-0"
        title="Remove from comparison"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );

  return (
    <div className="p-4 sm:p-8 max-w-[1500px] mx-auto animate-fade-in">
      <div className="mb-6 flex items-baseline justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight bg-gradient-to-r from-slate-800 via-indigo-600 to-violet-600 bg-clip-text text-transparent">
            Compare Listings
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            Side-by-side on {selected.length} role{selected.length === 1 ? '' : 's'}.
          </p>
        </div>
        <Link href="/listings" className="text-sm text-indigo-600 hover:text-indigo-700">
          ← Back to Job Listings
        </Link>
      </div>

      {sameCompany && (
        <div className="mb-4 flex items-center gap-2 px-3 py-2 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-800">
          <span className="font-semibold">Same-company comparison:</span>
          comparing {selected.length} roles at <span className="font-medium">{selected[0].company}</span>. Differences highlighted below reflect role-level, not company-level, distinctions (level, scope, location).
        </div>
      )}

      <div
        className="grid gap-4"
        style={{ gridTemplateColumns: `repeat(${selected.length}, minmax(0, 1fr))` }}
      >
        {selected.map((l) => {
          const score = scoreCache[l.id];
          const matchedTop = (score?.matchedCount ?? 0) > 0
            ? null /* full keyword set is on the listings page; this is a summary */
            : null;
          void matchedTop;
          return (
            <article
              key={l.id}
              className="bg-white rounded-xl border border-slate-200 p-5 flex flex-col gap-3"
            >
              {renderHeader(l)}

              <div className="space-y-1.5 text-xs">
                {l.location && l.location !== 'Not specified' && (
                  <div className="flex items-center gap-1.5 text-slate-600">
                    <MapPin className="w-3 h-3 text-slate-400" />
                    {l.location}
                  </div>
                )}
                {detectWorkMode(l.location) && (
                  <div className="flex items-center gap-1.5">
                    <Briefcase className="w-3 h-3 text-slate-400" />
                    <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-indigo-50 text-indigo-700 border border-indigo-100">
                      {detectWorkMode(l.location)}
                    </span>
                  </div>
                )}
                {formatSalaryRange(l) && (
                  <div className="flex items-center gap-1.5 text-green-600 font-medium">
                    <DollarSign className="w-3 h-3" />
                    {formatSalaryRange(l)}
                  </div>
                )}
                {formatPosted(l.postedAt) && (
                  <div className="flex items-center gap-1.5 text-slate-500">
                    <Calendar className="w-3 h-3 text-slate-400" />
                    Posted {formatPosted(l.postedAt)}
                  </div>
                )}
                {l.department && (
                  <div className="text-slate-500">{l.department}</div>
                )}
              </div>

              <div className="border-t border-slate-100 pt-3">
                <p className="text-xs uppercase tracking-wide text-slate-400 mb-1.5">ATS Score</p>
                {score && score.totalCount > 0 ? (
                  <div className="space-y-1">
                    <div className="flex items-baseline gap-2">
                      <span
                        className={`text-3xl font-bold ${
                          score.overall >= 70
                            ? 'text-green-600'
                            : score.overall >= 50
                              ? 'text-yellow-600'
                              : 'text-red-500'
                        }`}
                      >
                        {score.overall}%
                      </span>
                      <span className="text-xs text-slate-500">
                        ({score.matchedCount} / {score.totalCount} matched)
                      </span>
                    </div>
                    <div className="space-y-0.5 text-[11px] text-slate-600 mt-2">
                      <div className="flex justify-between"><span>Technical</span><span>{score.technical}%</span></div>
                      <div className="flex justify-between"><span>Management</span><span>{score.management}%</span></div>
                      <div className="flex justify-between"><span>Domain</span><span>{score.domain}%</span></div>
                      <div className="flex justify-between"><span>Soft</span><span>{score.soft}%</span></div>
                      {score.phrases != null && (
                        <div className="flex justify-between"><span>JD phrases</span><span>{score.phrases}%</span></div>
                      )}
                    </div>
                  </div>
                ) : (
                  <p className="text-xs text-slate-400 italic">Not scorable</p>
                )}
              </div>

              <div className="border-t border-slate-100 pt-3 mt-auto flex gap-2">
                <Link
                  href={`/listings/${l.id}`}
                  className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-1.5 border border-slate-200 text-slate-700 text-xs font-medium rounded-lg hover:bg-slate-50"
                >
                  Open
                </Link>
                {/* Inline Apply pill. Mirrors the small-size shared
                    Button visual (gradient indigo→violet, rounded-lg)
                    via inline classes since this is an external
                    <a> link, not a <button>. */}
                <a
                  href={l.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-gradient-to-r from-indigo-500 to-violet-500 text-white shadow-sm hover:from-indigo-600 hover:to-violet-600 hover:shadow-md transition-all"
                >
                  <ExternalLink className="w-3 h-3" />
                  Apply
                </a>
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}
