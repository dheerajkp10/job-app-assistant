'use client';

import { useEffect, useMemo, useState, useCallback } from 'react';
import Link from 'next/link';
import {
  MapPin, ExternalLink, Loader2, Trash2, ChevronRight, Download,
} from 'lucide-react';
import type { JobListing, ListingFlag, ListingFlagEntry, ScoreCacheEntry } from '@/lib/types';
import { PIPELINE_FLAGS } from '@/lib/types';
import { CompanyLogo } from '@/components/company-logo';

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
  const [loading, setLoading] = useState(true);

  // Fetch on mount + refresh on tab focus so the board stays in sync
  // when the user updates flags from the Listings page in another tab.
  const reload = useCallback(async () => {
    try {
      const [listingsRes, flagsRes, scoresRes] = await Promise.all([
        fetch('/api/listings').then((r) => r.json()),
        fetch('/api/listing-flags').then((r) => r.json()),
        fetch('/api/scores-cache').then((r) => r.json()),
      ]);
      setListings(listingsRes.listings || []);
      setFlags(flagsRes || {});
      setScoreCache(scoresRes || {});
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
    <div className="p-8 max-w-[1500px] mx-auto animate-fade-in">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight bg-gradient-to-r from-slate-800 via-indigo-600 to-violet-600 bg-clip-text text-transparent">
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
            className="inline-flex items-center gap-2 px-3 py-1.5 border border-slate-200 text-slate-700 text-sm font-medium rounded-lg hover:bg-slate-50"
            title="Markdown summary of your pipeline + top leads"
          >
            <Download className="w-4 h-4" /> Status report
          </button>
        )}
      </div>

      {/* Kanban columns. Horizontal scroll on narrow screens — five
          fixed-width columns is friendly on a 1500px laptop and
          collapses cleanly to a swipe deck below ~1100px. */}
      <div className="flex gap-4 overflow-x-auto pb-4">
        {PIPELINE_FLAGS.map((flagDef, idx) => {
          const items = grouped[flagDef.key];
          const isFirst = idx === 0;
          const isLast = idx === PIPELINE_FLAGS.length - 1;
          return (
            <section
              key={flagDef.key}
              className="flex-shrink-0 w-[280px] bg-slate-50 rounded-xl border border-slate-200 flex flex-col max-h-[calc(100vh-220px)]"
            >
              <header
                className="px-3 py-2.5 border-b border-slate-200 rounded-t-xl"
                style={{ backgroundColor: `${flagDef.color}10` }}
              >
                <div className="flex items-center gap-2">
                  <span
                    className="w-2 h-2 rounded-full"
                    style={{ backgroundColor: flagDef.color }}
                  />
                  <h3 className="text-xs font-semibold text-slate-700 uppercase tracking-wide">
                    {flagDef.label}
                  </h3>
                  <span className="text-xs text-slate-500 ml-auto">{items.length}</span>
                </div>
              </header>

              <div className="flex-1 overflow-y-auto p-2 space-y-2">
                {items.length === 0 && (
                  <p className="text-xs text-slate-400 italic text-center py-6">
                    No applications here yet.
                  </p>
                )}
                {items.map(({ listing }) => {
                  const score = scoreCache[listing.id];
                  return (
                    <article
                      key={listing.id}
                      className="bg-white rounded-lg border border-slate-200 hover:border-blue-300 hover:shadow-sm p-3 transition-all"
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
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
