'use client';

import { useEffect, useMemo, useState, useCallback } from 'react';
import Link from 'next/link';
import {
  MapPin, ExternalLink, Loader2, Trash2, ChevronRight, Download,
  AlertTriangle, X,
} from 'lucide-react';
import type {
  JobListing, ListingFlag, ListingFlagEntry, ScoreCacheEntry, CompanyRejection,
} from '@/lib/types';
import { PIPELINE_FLAGS } from '@/lib/types';
import { CompanyLogo } from '@/components/company-logo';

/** Resolve a company "identity" key from a listing. Prefers
 *  companySlug (already canonical) and falls back to a normalized
 *  company name for legacy listings missing a slug. Same rule both
 *  the rejection-sibling lookup and the cascade prompt use. */
function companyKey(listing: JobListing): string {
  return listing.companySlug || listing.company.trim().toLowerCase();
}

/**
 * Pipeline page — Kanban-style view of every listing the user has
 * tagged with a pipeline status (applied / phone-screen / interviewing
 * / offer / rejected). Replaces the old need to scroll through Job
 * Listings looking for "what did I apply to?".
 *
 * Data shape
 * ──────────
 * Re-uses the existing listingFlags store (no new schema). Each
 * column corresponds to one of `PIPELINE_FLAGS`. The flag value moves
 * the listing between columns; clicking → / ← arrows on a card writes
 * the new flag via `/api/listing-flags`. Removing the flag drops the
 * listing off the board entirely.
 *
 * Layout
 * ──────
 * Five fixed columns, horizontal scroll on small screens. Each card
 * shows company / title / location / score and a "Open" link back
 * into the full listing page. Pipeline summary counts at the top so
 * the user gets the at-a-glance "I have 3 in interviews, 1 offer"
 * answer they came for.
 */

export default function PipelinePage() {
  const [listings, setListings] = useState<JobListing[]>([]);
  const [flags, setFlags] = useState<Record<string, ListingFlagEntry>>({});
  const [scoreCache, setScoreCache] = useState<Record<string, ScoreCacheEntry>>({});
  const [companyRejections, setCompanyRejections] = useState<CompanyRejection[]>([]);
  const [loading, setLoading] = useState(true);
  // Mobile single-lane selector. The five-column kanban can't fit on
  // a phone, so we render one lane at a time on narrow viewports
  // (driven by a select). Defaults to the first lane in PIPELINE_FLAGS.
  const [mobileLane, setMobileLane] = useState<ListingFlag>(PIPELINE_FLAGS[0].key);

  // Fetch on mount + refresh on tab focus so the board stays in sync
  // when the user updates flags from the Listings page in another tab.
  const reload = useCallback(async () => {
    try {
      const [listingsRes, flagsRes, scoresRes, rejectionsRes] = await Promise.all([
        fetch('/api/listings', { cache: 'no-store' }).then((r) => r.json()),
        fetch('/api/listing-flags', { cache: 'no-store' }).then((r) => r.json()),
        fetch('/api/scores-cache', { cache: 'no-store' }).then((r) => r.json()),
        fetch('/api/company-rejections', { cache: 'no-store' }).then((r) => r.json()),
      ]);
      setListings(listingsRes.listings || []);
      setFlags(flagsRes || {});
      setScoreCache(scoresRes || {});
      setCompanyRejections(Array.isArray(rejectionsRes) ? rejectionsRes : []);
    } catch {
      // Network hiccups — keep whatever we have on screen.
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    reload();
    const onVisible = () => {
      if (document.visibilityState === 'visible') reload();
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
    };
  }, [reload]);

  // Index listings by id for O(1) lookup when grouping by flag.
  const listingById = useMemo(() => {
    const m = new Map<string, JobListing>();
    for (const l of listings) m.set(l.id, l);
    return m;
  }, [listings]);

  // Group listings by their pipeline flag. Listings without a
  // pipeline flag (or with a triage flag like 'incorrect') don't
  // appear on the board.
  const grouped = useMemo(() => {
    const out: Record<string, { listing: JobListing; flaggedAt: string }[]> = {};
    for (const f of PIPELINE_FLAGS) out[f.key] = [];
    for (const entry of Object.values(flags)) {
      const listing = listingById.get(entry.listingId);
      if (!listing) continue;
      if (!out[entry.flag]) continue; // triage flags (incorrect / N/A) — skip
      out[entry.flag].push({ listing, flaggedAt: entry.flaggedAt });
    }
    // Most-recently-flagged first within each column.
    for (const key of Object.keys(out)) {
      out[key].sort((a, b) => Date.parse(b.flaggedAt) - Date.parse(a.flaggedAt));
    }
    return out;
  }, [flags, listingById]);

  // Optimistic flag mutation — immediately reflects the change in the
  // UI then writes through to the server. If the server write fails
  // we re-fetch the canonical state.
  const updateFlag = useCallback(async (listingId: string, flag: ListingFlag | null) => {
    setFlags((prev) => {
      const next = { ...prev };
      if (flag === null) delete next[listingId];
      else next[listingId] = { listingId, flag, flaggedAt: new Date().toISOString() };
      return next;
    });
    try {
      await fetch('/api/listing-flags', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ listingId, flag }),
      });
    } catch {
      reload();
    }
  }, [reload]);

  // ─── Company-rejection awareness ───────────────────────────────────
  //
  // Rejection is now a COMPANY-level concept (per user preference).
  // When the user moves any card to 'rejected', the server cascades
  // the flag to every sibling listing at the same company and
  // records the company in /api/company-rejections. Future scrapes
  // from that company auto-archive (handled by the listings page
  // filter that hides rejected-company listings from the active
  // feed).
  //
  // Two derived structures we use in render:
  //   - rejectedByCompany — listings flagged rejected, keyed by
  //     company. Powers the collapsed company cards in the Rejected
  //     column.
  const rejectedByCompany = useMemo(() => {
    const out = new Map<string, { listing: JobListing; flaggedAt: string }[]>();
    for (const entry of Object.values(flags)) {
      if (entry.flag !== 'rejected') continue;
      const listing = listingById.get(entry.listingId);
      if (!listing) continue;
      const key = companyKey(listing);
      const arr = out.get(key) ?? [];
      arr.push({ listing, flaggedAt: entry.flaggedAt });
      out.set(key, arr);
    }
    for (const arr of out.values()) {
      arr.sort((a, b) => Date.parse(b.flaggedAt) - Date.parse(a.flaggedAt));
    }
    return out;
  }, [flags, listingById]);

  /** Un-reject a company: removes it from companyRejections + clears
   *  every per-listing rejected flag at that company. Reverts the
   *  cascade silently — single round trip to DELETE
   *  /api/company-rejections. */
  const unrejectCompany = useCallback(async (slug: string) => {
    await fetch(`/api/company-rejections?slug=${encodeURIComponent(slug)}`, {
      method: 'DELETE',
      cache: 'no-store',
    });
    await reload();
  }, [reload]);

  if (loading) {
    return (
      <div className="p-8 flex flex-col items-center justify-center min-h-[60vh]">
        <Loader2 className="w-10 h-10 text-indigo-500 animate-spin mb-4" />
        <h2 className="text-lg font-semibold text-slate-800 mb-2">Loading pipeline…</h2>
      </div>
    );
  }

  const totalOnBoard = PIPELINE_FLAGS.reduce((acc, f) => acc + grouped[f.key].length, 0);

  return (
    <div className="p-4 sm:p-6 max-w-[1400px] mx-auto animate-fade-in">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight bg-gradient-to-r from-slate-800 via-indigo-600 to-violet-600 bg-clip-text text-transparent">
            Application Pipeline
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            {totalOnBoard === 0
              ? 'Nothing on your board yet. Click "I applied" on any listing to start tracking.'
              : (
                <>
                  <span className="text-indigo-600 font-semibold">{totalOnBoard}</span> active application{totalOnBoard === 1 ? '' : 's'} across {PIPELINE_FLAGS.length} stages
                </>
              )}
          </p>
        </div>
        {totalOnBoard > 0 && (
          <button
            type="button"
            onClick={async () => {
              const res = await fetch('/api/status-report');
              const md = await res.text();
              const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
              const url = URL.createObjectURL(blob);
              const a = document.createElement('a');
              a.href = url;
              a.download = `pipeline-${new Date().toISOString().slice(0, 10)}.md`;
              a.click();
              URL.revokeObjectURL(url);
            }}
            className="inline-flex items-center gap-2 px-3 py-1.5 bg-indigo-50 border border-indigo-100 text-indigo-700 text-xs font-semibold rounded-lg shadow-sm shadow-indigo-500/10 hover:bg-indigo-100 hover:border-indigo-200 hover:shadow-md hover:shadow-indigo-500/15 transition-all duration-200"
            title="Markdown summary of your pipeline + top leads"
          >
            <Download className="w-3.5 h-3.5" /> Status report
          </button>
        )}
      </div>

      {/* ─── Mobile single-lane view ──────────────────────────────
          On a phone the 5-column kanban can't fit. We replace it with
          a lane selector (a row of pill buttons, one per stage, each
          showing the count) and a single full-width column showing the
          cards for whichever lane is active. The pill row scrolls
          horizontally inside its own container if needed, but the
          card column doesn't — so the user only scrolls vertically
          through their actual pipeline once they pick a lane. */}
      <div className="sm:hidden mb-3 -mx-1 px-1 flex gap-2 overflow-x-auto pb-1">
        {PIPELINE_FLAGS.map((flagDef) => {
          const count = grouped[flagDef.key].length;
          const active = mobileLane === flagDef.key;
          return (
            <button
              key={flagDef.key}
              type="button"
              onClick={() => setMobileLane(flagDef.key)}
              className={`shrink-0 inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                active
                  ? 'text-white border-transparent shadow-sm'
                  : 'bg-white text-slate-700 border-slate-200 hover:border-slate-300'
              }`}
              style={active ? { backgroundColor: flagDef.color } : undefined}
            >
              <span
                className="w-1.5 h-1.5 rounded-full"
                style={{
                  backgroundColor: active ? 'rgba(255,255,255,0.9)' : flagDef.color,
                }}
              />
              {flagDef.label}
              <span
                className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                  active ? 'bg-white/20 text-white' : 'bg-slate-100 text-slate-600'
                }`}
              >
                {count}
              </span>
            </button>
          );
        })}
      </div>
      <div className="sm:hidden pb-4">
        {(() => {
          const flagDef = PIPELINE_FLAGS.find((f) => f.key === mobileLane);
          if (!flagDef) return null;
          const items = grouped[flagDef.key];
          const idx = PIPELINE_FLAGS.indexOf(flagDef);
          const isFirst = idx === 0;
          const isLast = idx === PIPELINE_FLAGS.length - 1;
          return (
            <section
              className="bg-white/60 rounded-2xl border border-slate-100 shadow-card"
            >
              <div className="p-2 space-y-2">
                {/* Rejected column — company-grouped rendering. One
                    card per rejected company instead of one per role.
                    Same data in both mobile + desktop branches; the
                    only difference is the wrapping section width. */}
                {flagDef.key === 'rejected' ? (
                  companyRejections.length === 0 ? (
                    <p className="text-xs text-slate-400 italic text-center py-6">
                      No rejected companies yet.
                    </p>
                  ) : (
                    [...companyRejections]
                      .sort((a, b) => Date.parse(b.rejectedAt) - Date.parse(a.rejectedAt))
                      .map((r) => (
                        <RejectedCompanyCard
                          key={r.companySlug}
                          companyName={r.companyName}
                          companySlug={r.companySlug}
                          rejectedAt={r.rejectedAt}
                          listings={rejectedByCompany.get(r.companySlug) ?? []}
                          onUnreject={unrejectCompany}
                        />
                      ))
                  )
                ) : (<>
                {items.length === 0 && (
                  <p className="text-xs text-slate-400 italic text-center py-6">
                    No applications in {flagDef.label.toLowerCase()} yet.
                  </p>
                )}
                {items.map(({ listing }) => {
                  const score = scoreCache[listing.id];
                  // Company-rejection sibling badge — only fires on
                  // non-rejected cards (no point telling the user
                  // their rejected card was also rejected somewhere
                  // else). Same logic as the desktop branch below.
                  const cKey = companyKey(listing);
                  const companyRejectionList = rejectedByCompany.get(cKey) ?? [];
                  const showRejBadge =
                    flagDef.key !== 'rejected' &&
                    companyRejectionList.some((r) => r.listing.id !== listing.id);
                  return (
                    <article
                      key={listing.id}
                      className="bg-white rounded-xl border border-slate-100 shadow-card p-3"
                    >
                      <div className="flex items-start gap-2 mb-1">
                        <CompanyLogo companySlug={listing.companySlug} companyName={listing.company} size={20} />
                        <div className="min-w-0">
                          <h4 className="text-sm font-semibold text-slate-800 line-clamp-2">
                            {listing.title}
                          </h4>
                          <div className="text-xs text-slate-600 truncate">{listing.company}</div>
                        </div>
                      </div>
                      {showRejBadge && (
                        <CompanyRejectedBadge rejections={companyRejectionList.filter((r) => r.listing.id !== listing.id)} />
                      )}
                      {listing.location && listing.location !== 'Not specified' && (
                        <div className="flex items-center gap-1 text-xs text-slate-500 mb-1.5">
                          <MapPin className="w-3 h-3 text-slate-400 shrink-0" />
                          <span className="truncate">{listing.location}</span>
                        </div>
                      )}
                      <div className="flex items-center justify-between gap-1 mt-2">
                        <div className="flex gap-0.5">
                          <button
                            type="button"
                            disabled={isFirst}
                            onClick={() => {
                              const prev = PIPELINE_FLAGS[idx - 1];
                              if (prev) {
                                updateFlag(listing.id, prev.key);
                                setMobileLane(prev.key);
                              }
                            }}
                            className="p-1 rounded text-slate-400 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-30 disabled:hover:bg-transparent"
                            title="Move to previous stage"
                          >
                            <ChevronRight className="w-3.5 h-3.5 rotate-180" />
                          </button>
                          <button
                            type="button"
                            disabled={isLast}
                            onClick={() => {
                              const nxt = PIPELINE_FLAGS[idx + 1];
                              if (nxt) {
                                updateFlag(listing.id, nxt.key);
                                setMobileLane(nxt.key);
                              }
                            }}
                            className="p-1 rounded text-slate-400 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-30 disabled:hover:bg-transparent"
                            title="Move to next stage"
                          >
                            <ChevronRight className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => updateFlag(listing.id, null)}
                            className="p-1 rounded text-slate-400 hover:bg-red-50 hover:text-red-600"
                            title="Remove from pipeline"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                        <div className="flex items-center gap-1.5">
                          {score && score.totalCount > 0 && (
                            <span
                              className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${
                                score.overall >= 70
                                  ? 'bg-green-100 text-green-700'
                                  : score.overall >= 50
                                    ? 'bg-yellow-100 text-yellow-700'
                                    : 'bg-slate-100 text-slate-600'
                              }`}
                              title="ATS match score"
                            >
                              {score.overall}%
                            </span>
                          )}
                          <Link
                            href={`/listings/${listing.id}`}
                            className="p-1 rounded text-slate-400 hover:bg-indigo-50 hover:text-indigo-600"
                            title="Open listing"
                          >
                            <ExternalLink className="w-3.5 h-3.5" />
                          </Link>
                        </div>
                      </div>
                    </article>
                  );
                })}
                </>)}
              </div>
            </section>
          );
        })()}
      </div>

      {/* ─── Desktop kanban (sm: and up) ──────────────────────────
          Sized so all five stages fit a 1440px laptop without
          horizontal scroll: 5 × 248 + 4 × 12 (gap-3) + 48 (container
          padding) = 1336 — comfortable margin on a 1440 viewport, still
          scrolls cleanly on anything narrower. */}
      <div className="hidden sm:flex gap-3 overflow-x-auto pb-4">
        {PIPELINE_FLAGS.map((flagDef, idx) => {
          const items = grouped[flagDef.key];
          const isFirst = idx === 0;
          const isLast = idx === PIPELINE_FLAGS.length - 1;
          return (
            <section
              key={flagDef.key}
              className="flex-shrink-0 w-[248px] bg-white/60 rounded-2xl border border-slate-100 shadow-card flex flex-col max-h-[calc(100vh-220px)]"
            >
              <header
                className="px-4 py-3 border-b border-slate-100 rounded-t-2xl"
                style={{ backgroundColor: `${flagDef.color}14` }}
              >
                <div className="flex items-center gap-2">
                  <span
                    className="w-2 h-2 rounded-full"
                    style={{ backgroundColor: flagDef.color }}
                  />
                  <h3 className="text-xs font-semibold text-slate-700 uppercase tracking-wide">
                    {flagDef.label}
                  </h3>
                  <span className="text-xs text-slate-500 ml-auto">
                    {flagDef.key === 'rejected' ? companyRejections.length : items.length}
                  </span>
                </div>
              </header>

              <div className="flex-1 overflow-y-auto p-2 space-y-2">
                {flagDef.key === 'rejected' ? (
                  companyRejections.length === 0 ? (
                    <p className="text-xs text-slate-400 italic text-center py-6">
                      No rejected companies yet.
                    </p>
                  ) : (
                    [...companyRejections]
                      .sort((a, b) => Date.parse(b.rejectedAt) - Date.parse(a.rejectedAt))
                      .map((r) => (
                        <RejectedCompanyCard
                          key={r.companySlug}
                          companyName={r.companyName}
                          companySlug={r.companySlug}
                          rejectedAt={r.rejectedAt}
                          listings={rejectedByCompany.get(r.companySlug) ?? []}
                          onUnreject={unrejectCompany}
                        />
                      ))
                  )
                ) : (<>
                {items.length === 0 && (
                  <p className="text-xs text-slate-400 italic text-center py-6">
                    No applications here yet.
                  </p>
                )}
                {items.map(({ listing }) => {
                  const score = scoreCache[listing.id];
                  const cKey = companyKey(listing);
                  const companyRejectionList = rejectedByCompany.get(cKey) ?? [];
                  const showRejBadge =
                    flagDef.key !== 'rejected' &&
                    companyRejectionList.some((r) => r.listing.id !== listing.id);
                  return (
                    <article
                      key={listing.id}
                      className="bg-white rounded-xl border border-slate-100 shadow-card hover:shadow-card-hover hover:border-indigo-200 hover:-translate-y-0.5 p-3 transition-all duration-200"
                    >
                      <div className="flex items-start gap-2 mb-1">
                        <CompanyLogo companySlug={listing.companySlug} companyName={listing.company} size={20} />
                        <div className="min-w-0">
                          <h4 className="text-sm font-semibold text-slate-800 line-clamp-2">
                            {listing.title}
                          </h4>
                          <div className="text-xs text-slate-600 truncate">{listing.company}</div>
                        </div>
                      </div>
                      {showRejBadge && (
                        <CompanyRejectedBadge rejections={companyRejectionList.filter((r) => r.listing.id !== listing.id)} />
                      )}
                      {listing.location && listing.location !== 'Not specified' && (
                        <div className="flex items-center gap-1 text-xs text-slate-500 mb-1.5">
                          <MapPin className="w-3 h-3 text-slate-400 shrink-0" />
                          <span className="truncate">{listing.location}</span>
                        </div>
                      )}
                      <div className="flex items-center justify-between gap-1 mt-2">
                        {/* Move-left / move-right arrows. The column
                            order in PIPELINE_FLAGS is the natural
                            applied → screen → interview → offer
                            progression. Rejected is the last column;
                            users can also click → from any column to
                            advance. */}
                        <div className="flex gap-0.5">
                          <button
                            type="button"
                            disabled={isFirst}
                            onClick={() => {
                              const prev = PIPELINE_FLAGS[idx - 1];
                              if (prev) updateFlag(listing.id, prev.key);
                            }}
                            className="p-1 rounded text-slate-400 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-30 disabled:hover:bg-transparent"
                            title="Move to previous stage"
                          >
                            <ChevronRight className="w-3.5 h-3.5 rotate-180" />
                          </button>
                          <button
                            type="button"
                            disabled={isLast}
                            onClick={() => {
                              const nxt = PIPELINE_FLAGS[idx + 1];
                              if (nxt) updateFlag(listing.id, nxt.key);
                            }}
                            className="p-1 rounded text-slate-400 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-30 disabled:hover:bg-transparent"
                            title="Move to next stage"
                          >
                            <ChevronRight className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => updateFlag(listing.id, null)}
                            className="p-1 rounded text-slate-400 hover:bg-red-50 hover:text-red-600"
                            title="Remove from pipeline"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                        <div className="flex items-center gap-1.5">
                          {score && score.totalCount > 0 && (
                            <span
                              className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${
                                score.overall >= 70
                                  ? 'bg-green-100 text-green-700'
                                  : score.overall >= 50
                                    ? 'bg-yellow-100 text-yellow-700'
                                    : 'bg-slate-100 text-slate-600'
                              }`}
                              title="ATS match score"
                            >
                              {score.overall}%
                            </span>
                          )}
                          <Link
                            href={`/listings/${listing.id}`}
                            className="p-1 rounded text-slate-400 hover:bg-indigo-50 hover:text-indigo-600"
                            title="Open listing"
                          >
                            <ExternalLink className="w-3.5 h-3.5" />
                          </Link>
                        </div>
                      </div>
                    </article>
                  );
                })}
                </>)}
              </div>
            </section>
          );
        })}
      </div>

    </div>
  );
}

// ─── Company-rejection badge ─────────────────────────────────────────
//
// Quiet rose-tinted chip rendered on any active pipeline card whose
// company already has a rejection elsewhere. Hover for a list of the
// rejected siblings. The point is to give the user a heads-up that
// the company has signaled rejection — they can decide whether the
// active app is still worth chasing, withdraw it, or keep going.

function CompanyRejectedBadge({
  rejections,
}: {
  rejections: { listing: JobListing; flaggedAt: string }[];
}) {
  if (rejections.length === 0) return null;
  const fmt = (iso: string) => {
    const days = Math.floor((Date.now() - Date.parse(iso)) / 86_400_000);
    if (days <= 0) return 'today';
    if (days === 1) return 'yesterday';
    if (days < 30) return `${days}d ago`;
    if (days < 365) return `${Math.floor(days / 30)}mo ago`;
    return `${Math.floor(days / 365)}y ago`;
  };
  const tooltip = rejections
    .slice(0, 4)
    .map((r) => `${r.listing.title} — rejected ${fmt(r.flaggedAt)}`)
    .join('\n') + (rejections.length > 4 ? `\n+${rejections.length - 4} more` : '');
  return (
    <div
      className="inline-flex items-center gap-1 mt-1 mb-1.5 px-1.5 py-0.5 rounded-md text-[10px] font-medium bg-rose-50 text-rose-700 border border-rose-100 max-w-full"
      title={tooltip}
    >
      <AlertTriangle className="w-3 h-3 shrink-0" />
      <span className="truncate">
        Company rejected {rejections.length === 1 ? 'another role' : `${rejections.length} other roles`}
      </span>
    </div>
  );
}

// ─── Rejected-column company card ────────────────────────────────────
//
// The Rejected column collapses every per-listing rejection into ONE
// card per company. Rejection in tech hiring is a company-level
// signal, not a role-level one, so the user sees "Acme — 3 roles
// rejected · 12d ago" instead of three separate Acme cards. Expanding
// the card reveals the affected role list. An un-reject button
// re-activates every cascaded listing in one go (DELETE
// /api/company-rejections?slug=…).

function RejectedCompanyCard({
  companyName,
  companySlug,
  rejectedAt,
  listings,
  onUnreject,
  compact = false,
}: {
  companyName: string;
  companySlug: string;
  rejectedAt: string;
  listings: { listing: JobListing; flaggedAt: string }[];
  onUnreject: (slug: string) => void;
  /** Mobile single-lane gives extra width — set false. Desktop
   *  columns are narrow — set true. Currently both pass false; the
   *  flag is reserved for future tuning. */
  compact?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  void compact;
  const fmt = (iso: string) => {
    const days = Math.floor((Date.now() - Date.parse(iso)) / 86_400_000);
    if (days <= 0) return 'today';
    if (days === 1) return 'yesterday';
    if (days < 30) return `${days}d ago`;
    if (days < 365) return `${Math.floor(days / 30)}mo ago`;
    return `${Math.floor(days / 365)}y ago`;
  };
  const first = listings[0]?.listing;
  return (
    <article className="bg-white rounded-xl border border-slate-100 shadow-card p-3">
      <div className="flex items-start gap-2">
        {first && (
          <CompanyLogo
            companySlug={first.companySlug}
            companyName={first.company}
            size={24}
          />
        )}
        <div className="min-w-0 flex-1">
          <h4 className="text-sm font-semibold text-slate-800 truncate">
            {companyName}
          </h4>
          <div className="text-xs text-slate-500">
            {listings.length} role{listings.length === 1 ? '' : 's'} rejected · {fmt(rejectedAt)}
          </div>
        </div>
        <button
          type="button"
          onClick={() => onUnreject(companySlug)}
          className="shrink-0 p-1 rounded text-slate-400 hover:bg-emerald-50 hover:text-emerald-600 transition-colors"
          title="Un-reject company — re-activates every cascaded listing"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
      {listings.length > 0 && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="mt-2 w-full text-left text-[11px] text-slate-500 hover:text-slate-700 inline-flex items-center gap-1"
        >
          <ChevronRight
            className={`w-3 h-3 transition-transform ${expanded ? 'rotate-90' : ''}`}
          />
          {expanded ? 'Hide affected roles' : 'Show affected roles'}
        </button>
      )}
      {expanded && (
        <ul className="mt-2 pl-4 space-y-1 border-l border-slate-100">
          {listings.map((l) => (
            <li
              key={l.listing.id}
              className="text-xs text-slate-600 flex items-center gap-1.5 min-w-0"
            >
              <span className="text-slate-300 shrink-0">•</span>
              <Link
                href={`/listings/${l.listing.id}`}
                className="truncate hover:text-indigo-600 hover:underline flex-1 min-w-0"
                title={l.listing.title}
              >
                {l.listing.title}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </article>
  );
}
