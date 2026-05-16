'use client';

/**
 * Network Outreach Inbox — top-level page that surfaces every
 * referral draft / contact message the user has logged. The contact
 * popover on a listing card is fine for one-off outreach, but it
 * doesn't answer the bigger questions:
 *
 *   - Who did I message and haven't heard back from?
 *   - Which drafts haven't I actually sent?
 *   - When did I last reach out to person X?
 *
 * This page answers those by grouping records by status, sorting
 * within each group by recency, and exposing the same Mark sent /
 * Mark replied / Mark no-response transitions as the modal in the
 * listings popover.
 */

import { useEffect, useState, useCallback, useMemo } from 'react';
import Link from 'next/link';
import {
  Send, Inbox, Clock, CheckCheck, Slash, Trash2, ExternalLink,
} from 'lucide-react';
import type { NetworkOutreach, OutreachStatus } from '@/lib/types';

const STATUS_ORDER: OutreachStatus[] = ['drafted', 'sent', 'replied', 'no-response'];

const STATUS_META: Record<OutreachStatus, { label: string; icon: React.ComponentType<{ className?: string }>; color: string; bg: string }> = {
  drafted: { label: 'Drafted', icon: Clock, color: 'text-amber-700', bg: 'bg-amber-50 border-amber-100' },
  sent: { label: 'Sent — awaiting reply', icon: Send, color: 'text-indigo-700', bg: 'bg-indigo-50 border-indigo-100' },
  replied: { label: 'Replied', icon: CheckCheck, color: 'text-emerald-700', bg: 'bg-emerald-50 border-emerald-100' },
  'no-response': { label: 'No response', icon: Slash, color: 'text-slate-500', bg: 'bg-slate-50 border-slate-200' },
};

function ageAgo(iso: string): string {
  const ms = Date.now() - Date.parse(iso);
  if (isNaN(ms) || ms < 0) return 'just now';
  const min = Math.round(ms / 60_000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d < 30) return `${d}d ago`;
  return new Date(iso).toLocaleDateString();
}

export default function NetworkPage() {
  const [records, setRecords] = useState<NetworkOutreach[]>([]);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    try {
      const r = await fetch('/api/network/outreach');
      const d = await r.json();
      if (Array.isArray(d.outreach)) setRecords(d.outreach);
    } catch {
      // Leave whatever we had — same pattern as the pipeline page.
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  // Group records by status; each group sorted newest-first (the API
  // already does this, but we re-sort defensively in case a caller
  // mutates the array later).
  const grouped = useMemo(() => {
    const out: Record<OutreachStatus, NetworkOutreach[]> = {
      drafted: [], sent: [], replied: [], 'no-response': [],
    };
    for (const r of records) out[r.status]?.push(r);
    for (const s of STATUS_ORDER) {
      out[s].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
    }
    return out;
  }, [records]);

  const total = records.length;

  // Optimistic status mutation — update local state immediately, then
  // PATCH. Re-fetch on failure to recover the canonical state.
  const markStatus = useCallback(async (id: string, status: OutreachStatus) => {
    setRecords((prev) => prev.map((r) => (r.id === id ? { ...r, status } : r)));
    try {
      const res = await fetch('/api/network/outreach', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, status }),
      });
      if (!res.ok) reload();
    } catch {
      reload();
    }
  }, [reload]);

  const remove = useCallback(async (id: string) => {
    setRecords((prev) => prev.filter((r) => r.id !== id));
    try {
      await fetch(`/api/network/outreach?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
    } catch {
      reload();
    }
  }, [reload]);

  return (
    <div className="p-4 sm:p-6 max-w-[1400px] mx-auto animate-fade-in">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight bg-gradient-to-r from-slate-800 via-indigo-600 to-violet-600 bg-clip-text text-transparent">
            Network Outreach
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            {total === 0
              ? 'Nothing here yet. Draft a referral request from any listing’s "you know N people" badge to start tracking.'
              : (
                <>
                  <span className="text-indigo-600 font-semibold">{total}</span> outreach record{total === 1 ? '' : 's'} across {STATUS_ORDER.filter((s) => grouped[s].length > 0).length} status{STATUS_ORDER.filter((s) => grouped[s].length > 0).length === 1 ? '' : 'es'}
                </>
              )}
          </p>
        </div>
      </div>

      {loading ? (
        <div className="py-16 text-center text-slate-400 text-sm">Loading outreach…</div>
      ) : total === 0 ? (
        <div className="bg-white rounded-2xl border border-slate-100 p-8 sm:p-12 text-center shadow-card">
          <Inbox className="w-10 h-10 mx-auto mb-3 text-slate-300" />
          <h2 className="text-base font-semibold text-slate-700 mb-1">No outreach yet</h2>
          <p className="text-sm text-slate-500 max-w-md mx-auto">
            When you open a listing and click <strong>Referral</strong> next to a
            LinkedIn connection at that company, the draft lands here. Mark it
            sent when you actually message them, and flip it to replied once
            you hear back.
          </p>
          <Link
            href="/listings"
            className="inline-flex items-center gap-1.5 mt-4 px-4 py-2 text-sm font-medium rounded-xl bg-indigo-500 text-white hover:bg-indigo-600 transition-colors"
          >
            Browse listings
          </Link>
        </div>
      ) : (
        <div className="space-y-6">
          {STATUS_ORDER.map((status) => {
            const items = grouped[status];
            if (items.length === 0) return null;
            const meta = STATUS_META[status];
            const Icon = meta.icon;
            return (
              <section key={status}>
                <header className="flex items-center gap-2 mb-3">
                  <Icon className={`w-4 h-4 ${meta.color}`} />
                  <h2 className="text-sm font-semibold text-slate-700">
                    {meta.label}
                  </h2>
                  <span className="text-xs text-slate-400">{items.length}</span>
                </header>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {items.map((r) => (
                    <article
                      key={r.id}
                      className={`bg-white border rounded-xl shadow-card p-4 ${meta.bg}`}
                    >
                      <div className="flex items-start justify-between gap-2 mb-1">
                        <div className="min-w-0">
                          <div className="font-semibold text-slate-800 text-sm truncate">
                            {r.contactName}
                          </div>
                          <div className="text-xs text-slate-500 truncate">
                            at <span className="font-medium text-slate-700">{r.company}</span>
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => remove(r.id)}
                          className="shrink-0 p-1 rounded text-slate-400 hover:bg-rose-50 hover:text-rose-600"
                          title="Delete outreach record"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>

                      {r.draftSubject && (
                        <div className="text-[11px] text-slate-500 mb-2 truncate">
                          <span className="uppercase tracking-wide text-slate-400">Re:</span>{' '}
                          {r.draftSubject}
                        </div>
                      )}

                      <div className="flex items-center gap-3 text-[11px] text-slate-500">
                        <span>Drafted {ageAgo(r.createdAt)}</span>
                        {r.sentAt && <span>· Sent {ageAgo(r.sentAt)}</span>}
                        {r.repliedAt && <span>· Replied {ageAgo(r.repliedAt)}</span>}
                      </div>

                      {r.listingId && (
                        <Link
                          href={`/listings/${r.listingId}`}
                          className="inline-flex items-center gap-1 text-[11px] text-indigo-600 hover:text-indigo-700 hover:underline mt-2"
                        >
                          <ExternalLink className="w-3 h-3" />
                          Linked listing
                        </Link>
                      )}

                      <div className="flex flex-wrap gap-2 mt-3 pt-3 border-t border-slate-100">
                        {status === 'drafted' && (
                          <button
                            type="button"
                            onClick={() => markStatus(r.id, 'sent')}
                            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium bg-white border border-slate-200 text-slate-700 hover:bg-slate-50"
                          >
                            <Send className="w-3 h-3" /> Mark sent
                          </button>
                        )}
                        {status === 'sent' && (
                          <>
                            <button
                              type="button"
                              onClick={() => markStatus(r.id, 'replied')}
                              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium bg-emerald-100 text-emerald-700 hover:bg-emerald-200"
                            >
                              <CheckCheck className="w-3 h-3" /> Mark replied
                            </button>
                            <button
                              type="button"
                              onClick={() => markStatus(r.id, 'no-response')}
                              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium bg-white border border-slate-200 text-slate-500 hover:bg-slate-50"
                            >
                              <Slash className="w-3 h-3" /> No reply
                            </button>
                          </>
                        )}
                        {(status === 'replied' || status === 'no-response') && (
                          <button
                            type="button"
                            onClick={() => markStatus(r.id, 'sent')}
                            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium bg-white border border-slate-200 text-slate-500 hover:bg-slate-50"
                            title="Move back to Sent — useful if you mis-marked or want to re-engage"
                          >
                            Reopen
                          </button>
                        )}
                      </div>
                    </article>
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
