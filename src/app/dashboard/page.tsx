'use client';

import { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import {
  User, Briefcase, MapPin, DollarSign, FileText, Target, Building2,
  Loader2, BarChart3,
  CheckCircle2, AlertTriangle, Star, Zap, Sparkles, Download, X, Check,
} from 'lucide-react';
import type { Settings, JobListing, ScoreCacheEntry, WorkMode, ListingFlagEntry } from '@/lib/types';
import { filterByUserPreferences } from '@/lib/role-filter';
import { getCompanyAliases, isExcludedCompany } from '@/lib/current-company';
import { isUnscorableAts } from '@/lib/scorable';
import { isWorkAuthorized } from '@/lib/work-auth-filter';

// ─── Score visualization helpers ───────────────────────────────────

function ScoreRing({ score, size = 100, label }: { score: number; size?: number; label?: string }) {
  const radius = (size - 10) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (score / 100) * circumference;
  // Per-tier gradient (vs flat fill) — matches the new design
  // language. IDs are score-bucketed so the same ring instance
  // doesn't reuse another tier's gradient.
  const tier = score >= 70 ? 'high' : score >= 45 ? 'mid' : 'low';
  const colorPair: [string, string] =
    tier === 'high' ? ['#10B981', '#14B8A6']   // emerald → teal
    : tier === 'mid'  ? ['#FBBF24', '#FB923C'] // amber → orange
    :                   ['#FB7185', '#F472B6']; // rose → pink
  const gradientId = `score-ring-${tier}-${size}`;
  const displayColor = colorPair[0];

  return (
    <div className="flex flex-col items-center">
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} className="-rotate-90">
          <defs>
            <linearGradient id={gradientId} x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor={colorPair[0]} />
              <stop offset="100%" stopColor={colorPair[1]} />
            </linearGradient>
          </defs>
          <circle cx={size / 2} cy={size / 2} r={radius} stroke="#F1F5F9" strokeWidth="8" fill="none" />
          <circle
            cx={size / 2} cy={size / 2} r={radius}
            stroke={`url(#${gradientId})`} strokeWidth="8" fill="none"
            strokeDasharray={circumference} strokeDashoffset={offset}
            strokeLinecap="round"
            className="transition-all duration-700"
          />
        </svg>
        <span
          className="absolute inset-0 flex items-center justify-center text-2xl font-bold"
          style={{ color: displayColor }}
        >
          {score}%
        </span>
      </div>
      {label && <span className="text-xs text-slate-500 mt-1.5 font-medium">{label}</span>}
    </div>
  );
}

function CategoryBar({ label, score }: { label: string; score: number }) {
  // Match the new score-tier palette used by ScoreRing.
  const color =
    score >= 70 ? 'bg-gradient-to-r from-emerald-500 to-teal-500'
    : score >= 45 ? 'bg-gradient-to-r from-amber-400 to-orange-400'
    : 'bg-gradient-to-r from-rose-400 to-pink-400';
  return (
    <div className="flex items-center gap-3">
      <span className="text-xs text-slate-500 w-20 text-right">{label}</span>
      <div className="flex-1 h-2.5 bg-slate-100 rounded-full overflow-hidden">
        <div className={`h-full rounded-full transition-all duration-700 ${color}`} style={{ width: `${score}%` }} />
      </div>
      <span className="text-xs font-semibold text-slate-700 w-10">{score}%</span>
    </div>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
  sub,
  color = 'blue',
}: {
  icon: typeof Target;
  label: string;
  value: string | number;
  sub?: string;
  color?: 'blue' | 'green' | 'purple' | 'amber';
}) {
  const colors = {
    blue: 'bg-indigo-50 text-indigo-600 border-indigo-100',
    green: 'bg-emerald-50 text-emerald-600 border-emerald-100',
    purple: 'bg-violet-50 text-violet-600 border-violet-100',
    amber: 'bg-amber-50 text-amber-600 border-amber-100',
  };
  return (
    <div
      className={`rounded-2xl border p-5 shadow-card transition-all duration-200 hover:shadow-card-hover hover:-translate-y-0.5 ${colors[color]}`}
    >
      <div className="flex items-center gap-2 mb-2">
        <Icon className="w-4 h-4" />
        <span className="text-xs font-medium uppercase tracking-wide">{label}</span>
      </div>
      <div className="text-2xl font-bold">{value}</div>
      {sub && <p className="text-xs mt-1 opacity-75">{sub}</p>}
    </div>
  );
}

// ─── Types ─────────────────────────────────────────────────────────

interface CompanyStats {
  company: string;
  avgScore: number;
  bestScore: number;
  count: number;
  bestTitle: string;
  bestListingId: string;
}

// ─── Dashboard page ────────────────────────────────────────────────

export default function DashboardPage() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [allListings, setAllListings] = useState<JobListing[]>([]);
  const [scoreCache, setScoreCache] = useState<Record<string, ScoreCacheEntry>>({});
  const [flags, setFlags] = useState<Record<string, ListingFlagEntry>>({});
  const [loading, setLoading] = useState(true);

  // Loader factored out so we can re-run it on tab focus / visibility
  // changes — when the user adds a job on /jobs/add and navigates back,
  // the dashboard immediately reflects the new listing + ATS score.
  const reload = useMemo(
    () => () =>
      Promise.all([
        fetch('/api/settings').then((r) => r.json()),
        fetch('/api/listings').then((r) => r.json()),
        fetch('/api/scores-cache').then((r) => r.json()),
        fetch('/api/listing-flags').then((r) => r.json()),
      ])
        .then(([settingsData, listingsData, scores, flagsData]) => {
          if (!settingsData.settings?.onboardingComplete) {
            window.location.href = '/';
            return;
          }
          setSettings(settingsData.settings);
          // Defensive dedupe — the stored DB may still contain duplicate
          // listings from a fetch that ran before the dedupe landed.
          const raw: JobListing[] = listingsData.listings || [];
          const seen = new Set<string>();
          const deduped: JobListing[] = [];
          for (const l of raw) {
            if (seen.has(l.id)) continue;
            seen.add(l.id);
            deduped.push(l);
          }
          setAllListings(deduped);
          setScoreCache(scores || {});
          setFlags(flagsData || {});
        })
        .catch(() => {})
        .finally(() => setLoading(false)),
    [],
  );

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

  // Expand the user's excluded-companies list to all alias brands (e.g. "Amazon" → ["amazon","aws",...])
  const excludedAliases = useMemo(() => {
    const excluded = settings?.excludedCompanies ?? [];
    const set = new Set<string>();
    for (const name of excluded) {
      for (const alias of getCompanyAliases(name)) set.add(alias);
    }
    return Array.from(set);
  }, [settings?.excludedCompanies]);

  // Filter listings by user preferences, drop excluded employers, drop
  // jobs the user isn't authorized to work in (defaults to US).
  const authCountries = useMemo(
    () =>
      settings?.workAuthCountries && settings.workAuthCountries.length > 0
        ? settings.workAuthCountries
        : ['US'],
    [settings?.workAuthCountries],
  );
  const listings = useMemo(() => {
    const roleFiltered = filterByUserPreferences(allListings, settings?.preferredRoles ?? []);
    const authFiltered = roleFiltered.filter((l) => isWorkAuthorized(l.location, authCountries));
    if (excludedAliases.length === 0) return authFiltered;
    return authFiltered.filter((l) => !isExcludedCompany(l.company, excludedAliases));
  }, [allListings, settings?.preferredRoles, excludedAliases, authCountries]);

  // "Valid score" = cached entry with at least one JD keyword extracted,
  // AND from an ATS that actually exposes full job descriptions. Careers
  // APIs for the tech giants (Google, Apple, Uber, etc.) only return
  // list-view data, so their scores are just noise — they stay out of
  // averages and the "top matches" lists entirely.
  const hasValidScore = (listing: JobListing) => {
    if (isUnscorableAts(listing.ats)) return false;
    const s = scoreCache[listing.id];
    return !!s && s.totalCount > 0;
  };

  // Compute aggregate stats
  const stats = useMemo(() => {
    const scored = listings.filter((l) => hasValidScore(l));
    const scores = scored.map((l) => scoreCache[l.id].overall);
    const avgScore = scores.length > 0 ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : 0;

    const avgTechnical = scored.length > 0 ? Math.round(scored.reduce((a, l) => a + scoreCache[l.id].technical, 0) / scored.length) : 0;
    const avgManagement = scored.length > 0 ? Math.round(scored.reduce((a, l) => a + scoreCache[l.id].management, 0) / scored.length) : 0;
    const avgDomain = scored.length > 0 ? Math.round(scored.reduce((a, l) => a + scoreCache[l.id].domain, 0) / scored.length) : 0;
    const avgSoft = scored.length > 0 ? Math.round(scored.reduce((a, l) => a + scoreCache[l.id].soft, 0) / scored.length) : 0;

    const high = scores.filter((s) => s >= 60).length;
    const medium = scores.filter((s) => s >= 40 && s < 60).length;
    const low = scores.filter((s) => s < 40).length;

    const appliedCount = Object.values(flags).filter((f) => f.flag === 'applied').length;
    const companies = new Set(listings.map((l) => l.company)).size;

    return { avgScore, avgTechnical, avgManagement, avgDomain, avgSoft, high, medium, low, appliedCount, companies, scoredCount: scored.length, totalListings: listings.length };
  }, [listings, scoreCache, flags]);

  // Top companies by average ATS score
  const topCompanies = useMemo(() => {
    const companyMap = new Map<string, { scores: number[]; listings: { score: number; title: string; id: string }[] }>();

    for (const listing of listings) {
      if (!hasValidScore(listing)) continue;
      const score = scoreCache[listing.id];
      const entry = companyMap.get(listing.company) || { scores: [], listings: [] };
      entry.scores.push(score.overall);
      entry.listings.push({ score: score.overall, title: listing.title, id: listing.id });
      companyMap.set(listing.company, entry);
    }

    const result: CompanyStats[] = [];
    for (const [company, data] of companyMap) {
      const avg = Math.round(data.scores.reduce((a, b) => a + b, 0) / data.scores.length);
      const best = data.listings.sort((a, b) => b.score - a.score)[0];
      result.push({
        company,
        avgScore: avg,
        bestScore: best.score,
        count: data.scores.length,
        bestTitle: best.title,
        bestListingId: best.id,
      });
    }

    return result.sort((a, b) => b.avgScore - a.avgScore).slice(0, 10);
  }, [listings, scoreCache]);

  // Top individual listings by score (sorted once, then sliced for different uses).
  // We skip sentinel entries (totalCount=0) so tech-giant listings without a
  // public JD don't poison the rankings with synthetic 0% / 100% scores.
  const rankedListings = useMemo(() => {
    return listings
      .filter((l) => hasValidScore(l))
      .sort((a, b) => scoreCache[b.id].overall - scoreCache[a.id].overall);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listings, scoreCache]);

  // Show up to 20 jobs in the "Top Matching Jobs" preview grid.
  // The Master Resume flow uses its own server-side selection (every
  // listing matching prefs, stratified-sampled) so this slice is now
  // purely a display preview.
  const topListings = useMemo(() => rankedListings.slice(0, 20), [rankedListings]);

  // "Generate Master Resume" — replaces the prior Top-N / Optimize-for-
  // applied-set buttons. One unified flow that pulls every listing
  // matching the user's stored preferences (role / level / location /
  // salary / work-auth), stratified-samples up to a cap, aggregates
  // keywords across that set, and produces a single resume tuned for
  // broad ATS coverage across what the user would actually apply to.
  // Server endpoint: /api/tailor-resume/general.
  const [masterModalOpen, setMasterModalOpen] = useState(false);

  if (loading) {
    return (
      <div className="p-8 flex flex-col items-center justify-center min-h-[60vh]">
        <Loader2 className="w-10 h-10 text-blue-500 animate-spin mb-4" />
        <h2 className="text-lg font-semibold text-slate-800 mb-2">Loading Dashboard...</h2>
      </div>
    );
  }

  if (!settings) return null;

  const workModeLabels: Record<WorkMode, string> = { remote: 'Remote', hybrid: 'Hybrid', onsite: 'On-site' };

  return (
    <div className="p-8 max-w-7xl mx-auto animate-fade-in">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight bg-gradient-to-r from-slate-800 via-indigo-600 to-violet-600 bg-clip-text text-transparent">
          {settings.userName ? `Welcome back, ${settings.userName}` : 'Dashboard'}
        </h1>
        <p className="text-sm text-slate-500 mt-1">
          Your job search overview and resume performance
        </p>
      </div>

      {/* Stats cards */}
      <div className="grid grid-cols-4 gap-4 mb-8">
        <StatCard icon={Target} label="Avg ATS Score" value={`${stats.avgScore}%`} sub={`Across ${stats.scoredCount} scored listings`} color="blue" />
        <StatCard icon={BarChart3} label="Strong Matches" value={stats.high} sub={`Score 60%+ (of ${stats.scoredCount})`} color="green" />
        <StatCard icon={Building2} label="Companies" value={stats.companies} sub={`With ${stats.totalListings} matching roles`} color="purple" />
        <StatCard icon={CheckCircle2} label="Applied" value={stats.appliedCount} sub="Jobs you've applied to" color="amber" />
      </div>

      <div className="grid grid-cols-3 gap-6 mb-8">
        {/* Resume ATS Performance. Content wrapped in a fixed-height
            scroll pane so this card stays the same vertical size as
            its row neighbor (Top Companies) and any future addition
            to the score breakdown / tier-counts area scrolls instead
            of growing the card. */}
        <div className="col-span-1 bg-white rounded-2xl border border-slate-100 p-6 shadow-card flex flex-col">
          <div className="flex items-center gap-2 mb-5">
            <Target className="w-5 h-5 text-blue-500" />
            <h2 className="text-base font-semibold text-slate-800">Resume Performance</h2>
          </div>

          <div className="flex-1 overflow-y-auto pr-1 max-h-[340px] dashboard-scroll">
            <div className="flex justify-center mb-5">
              <ScoreRing score={stats.avgScore} size={120} label="Average Match" />
            </div>

            <div className="space-y-3">
              <CategoryBar label="Technical" score={stats.avgTechnical} />
              <CategoryBar label="Management" score={stats.avgManagement} />
              <CategoryBar label="Domain" score={stats.avgDomain} />
              <CategoryBar label="Soft Skills" score={stats.avgSoft} />
            </div>

            <div className="mt-5 pt-4 border-t border-slate-100">
              <div className="grid grid-cols-3 gap-2 text-center">
                <div>
                  <div className="text-lg font-bold text-green-600">{stats.high}</div>
                  <div className="text-xs text-slate-500">Strong</div>
                </div>
                <div>
                  <div className="text-lg font-bold text-yellow-600">{stats.medium}</div>
                  <div className="text-xs text-slate-500">Moderate</div>
                </div>
                <div>
                  <div className="text-lg font-bold text-red-500">{stats.low}</div>
                  <div className="text-xs text-slate-500">Weak</div>
                </div>
              </div>
            </div>

            {settings.baseResumeFileName && (
              <div className="mt-4 p-3 bg-slate-50 rounded-lg">
                <div className="flex items-center gap-2">
                  <FileText className="w-4 h-4 text-slate-400" />
                  <span className="text-xs text-slate-600 font-medium truncate">{settings.baseResumeFileName}</span>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Top Companies. List scrolls within a fixed-height pane so
            the dashboard layout stays stable as more companies hit
            the top-10 cutoff and the card height matches its row
            neighbor (Resume Performance). */}
        <div className="col-span-2 bg-white rounded-2xl border border-slate-100 p-6 shadow-card flex flex-col">
          <div className="flex items-center justify-between mb-5">
            <div className="flex items-center gap-2">
              <Star className="w-5 h-5 text-amber-500" />
              <h2 className="text-base font-semibold text-slate-800">Top Companies by ATS Match</h2>
            </div>
            <Link href="/listings" className="text-sm text-indigo-600 hover:text-indigo-700 font-medium">
              View all &rarr;
            </Link>
          </div>

          {topCompanies.length === 0 ? (
            <div className="text-center py-8 text-slate-400">
              <Building2 className="w-10 h-10 mx-auto mb-2 opacity-50" />
              <p className="text-sm">No scored listings yet. Browse listings to start scoring.</p>
            </div>
          ) : (
            // Height pinned to ~5 visible rows. Each row is ~60-66px
            // tall (p-3 + 2 lines of content) + 8px space-y gap; 5
            // rows × ~66px + 4 gaps ≈ 340px.
            <div className="space-y-2 flex-1 overflow-y-auto pr-1 max-h-[340px] dashboard-scroll">
              {topCompanies.map((c, i) => {
                const barColor =
                  c.avgScore >= 60 ? 'bg-gradient-to-r from-emerald-500 to-teal-500'
                  : c.avgScore >= 40 ? 'bg-gradient-to-r from-amber-400 to-orange-400'
                  : 'bg-gradient-to-r from-rose-400 to-pink-400';
                return (
                  <div key={c.company} className="flex items-center gap-3 p-3 rounded-xl hover:bg-slate-50 transition-colors">
                    <span className="text-xs font-bold text-slate-400 w-5 text-right">{i + 1}</span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold text-slate-800 truncate">{c.company}</span>
                        <span className="text-xs text-slate-400">{c.count} role{c.count > 1 ? 's' : ''}</span>
                      </div>
                      <div className="flex items-center gap-2 mt-1">
                        <div className="flex-1 h-1.5 bg-slate-100 rounded-full overflow-hidden max-w-[200px]">
                          <div className={`h-full rounded-full ${barColor}`} style={{ width: `${c.avgScore}%` }} />
                        </div>
                        <span className="text-xs font-medium text-slate-600">{c.avgScore}% avg</span>
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="text-sm font-bold text-slate-700">{c.bestScore}%</div>
                      <div className="text-xs text-slate-400">best</div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Top Matching Listings */}
      <div className="bg-white rounded-2xl border border-slate-100 p-6 shadow-card mb-8">
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-2">
            <Zap className="w-5 h-5 text-blue-500" />
            <h2 className="text-base font-semibold text-slate-800">Top Matching Jobs</h2>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => setMasterModalOpen(true)}
              title="Generate one resume optimized for broad ATS coverage across every open listing matching your preferences."
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold bg-gradient-to-r from-indigo-500 to-violet-500 text-white shadow-btn-primary hover:from-indigo-600 hover:to-violet-600 hover:shadow-btn-primary-hover hover:-translate-y-0.5 active:translate-y-0 transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-200 focus-visible:ring-offset-2"
            >
              <Sparkles className="w-3.5 h-3.5" />
              Generate Master Resume
            </button>
            <Link href="/listings" className="text-sm text-indigo-600 hover:text-indigo-700 font-medium">
              View all &rarr;
            </Link>
          </div>
        </div>

        {topListings.length === 0 ? (
          <div className="text-center py-8 text-slate-400">
            <Briefcase className="w-10 h-10 mx-auto mb-2 opacity-50" />
            <p className="text-sm">No scored listings yet.</p>
          </div>
        ) : (
          // Scrollable grid pinned to ~5 visible roles. The grid is
          // 2 columns, each card is ~76px tall (p-4 + 2 lines) and
          // rows are gap-3 (12px). Showing 5 roles → 3 rows
          // visible (2 + 2 + 1), so max-h ≈ 3 × 76 + 2 × 12 = 252px.
          // Round up to 280px to give a hint of the next row when
          // the user scrolls. `View all →` in the header still
          // links to the full Listings page.
          <div className="grid grid-cols-2 gap-3 overflow-y-auto pr-1 max-h-[280px] dashboard-scroll">
            {topListings.map((listing) => {
              const score = scoreCache[listing.id];
              const scoreColor =
                score.overall >= 60 ? 'text-emerald-700 bg-emerald-50 border-emerald-100'
                : score.overall >= 40 ? 'text-amber-700 bg-amber-50 border-amber-100'
                : 'text-rose-700 bg-rose-50 border-rose-100';
              return (
                <Link
                  key={listing.id}
                  href={`/listings/${listing.id}`}
                  className="flex items-start gap-3 p-4 rounded-xl border border-slate-100 hover:border-indigo-200 hover:shadow-card-hover hover:-translate-y-0.5 transition-all duration-200 group bg-white"
                >
                  <span className={`shrink-0 inline-flex items-center px-2.5 py-1 rounded-xl text-sm font-bold border ${scoreColor}`}>
                    {score.overall}%
                  </span>
                  <div className="flex-1 min-w-0">
                    <h4 className="text-sm font-semibold text-slate-800 truncate group-hover:text-indigo-600">{listing.title}</h4>
                    <p className="text-xs text-slate-500 truncate">{listing.company} &middot; {listing.location}</p>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </div>

      {/* Profile & Preferences */}
      <div className="bg-white rounded-2xl border border-slate-100 p-6 shadow-card">
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-2">
            <User className="w-5 h-5 text-slate-500" />
            <h2 className="text-base font-semibold text-slate-800">Your Profile & Preferences</h2>
          </div>
          <Link href="/settings" className="text-sm text-indigo-600 hover:text-indigo-700 font-medium">
            Edit &rarr;
          </Link>
        </div>

        <div className="grid grid-cols-2 gap-6">
          {/* Left column */}
          <div className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-slate-400 uppercase tracking-wide mb-1">Name</label>
              <p className="text-sm font-medium text-slate-800">{settings.userName || 'Not set'}</p>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-400 uppercase tracking-wide mb-1.5">
                <span className="inline-flex items-center gap-1"><Briefcase className="w-3 h-3" /> Target Roles</span>
              </label>
              {settings.preferredRoles.length > 0 ? (
                <div className="flex flex-wrap gap-1.5">
                  {settings.preferredRoles.map((r) => (
                    <span key={r} className="px-2.5 py-1 bg-indigo-50 text-indigo-700 rounded-lg text-xs font-medium">{r}</span>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-slate-400">No roles specified</p>
              )}
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-400 uppercase tracking-wide mb-1.5">
                <span className="inline-flex items-center gap-1"><MapPin className="w-3 h-3" /> Locations</span>
              </label>
              {settings.preferredLocations.length > 0 ? (
                <div className="flex flex-wrap gap-1.5">
                  {settings.preferredLocations.map((l) => (
                    <span key={l} className="px-2.5 py-1 bg-violet-50 text-violet-700 rounded-lg text-xs font-medium">{l}</span>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-slate-400">No locations specified</p>
              )}
            </div>
          </div>

          {/* Right column */}
          <div className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-slate-400 uppercase tracking-wide mb-1.5">Work Mode</label>
              {settings.workMode.length > 0 ? (
                <div className="flex gap-2">
                  {settings.workMode.map((m) => (
                    <span key={m} className="px-3 py-1.5 bg-emerald-50 text-emerald-700 rounded-lg text-xs font-medium">
                      {workModeLabels[m]}
                    </span>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-slate-400">Any</p>
              )}
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-400 uppercase tracking-wide mb-1">
                <span className="inline-flex items-center gap-1"><DollarSign className="w-3 h-3" /> Salary Range</span>
              </label>
              {settings.salaryMin || settings.salaryMax ? (
                <p className="text-sm font-medium text-slate-800">
                  {settings.salaryMin ? `$${settings.salaryMin.toLocaleString()}` : 'Any'}
                  {' \u2013 '}
                  {settings.salaryMax ? `$${settings.salaryMax.toLocaleString()}` : 'Any'}
                </p>
              ) : (
                <p className="text-xs text-slate-400">Not specified</p>
              )}
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-400 uppercase tracking-wide mb-1">Resume</label>
              {settings.baseResumeFileName ? (
                <div className="flex items-center gap-2">
                  <FileText className="w-4 h-4 text-green-500" />
                  <span className="text-sm font-medium text-slate-800">{settings.baseResumeFileName}</span>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-amber-500" />
                  <span className="text-xs text-amber-600">No resume uploaded</span>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {masterModalOpen && (
        <MasterResumeModal
          onClose={() => setMasterModalOpen(false)}
        />
      )}
    </div>
  );
}

// ─── Tailor for Top Jobs modal ───────────────────────────────────

type Category = 'technical' | 'management' | 'domain' | 'soft';

interface AggregatedKeyword {
  keyword: string;
  category: Category;
  frequency: number;
  jobTitles: string[];
}

interface MultiAnalyzeResponse {
  missingKeywords: AggregatedKeyword[];
  avgOriginalScore: number;
  jobsAnalyzed: number;
  jobsRequested: number;
  errors: string[];
}

const CATEGORY_LABEL: Record<Category, string> = {
  technical: 'Technical',
  management: 'Management',
  domain: 'Domain',
  soft: 'Soft Skills',
};

const CATEGORY_COLOR: Record<Category, string> = {
  technical: 'bg-indigo-50 text-indigo-700 border-blue-200',
  management: 'bg-violet-50 text-violet-700 border-purple-200',
  domain: 'bg-amber-50 text-amber-700 border-amber-200',
  soft: 'bg-emerald-50 text-emerald-700 border-emerald-200',
};

function displayKeyword(k: string): string {
  return k.split(/[-_]/).map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

function TailorTopJobsModal({
  listings,
  onClose,
}: {
  listings: JobListing[];
  onClose: () => void;
}) {
  const [analysis, setAnalysis] = useState<MultiAnalyzeResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  // Which format the user is actively downloading (if any). One at a
  // time — we disable both buttons while a download is in flight so we
  // don't run two LibreOffice jobs concurrently on the server.
  const [downloadingFormat, setDownloadingFormat] = useState<'pdf' | 'docx' | null>(null);
  // Mandatory-mode toggle — default-on. When ON the server injects
  // every selected keyword and runs the compression cascade
  // (margins/spacing/line-height/font shrink, floors at 9pt body
  // and 0.4" margins). When OFF the legacy budget-ladder runs.
  const [mandatoryMode, setMandatoryMode] = useState(true);
  // Compression steps reported by the server in X-Compression-Steps;
  // populated after each download. Trailing 'exhausted' token means
  // the cascade ran out before fitting on 1 page.
  const [compressionSteps, setCompressionSteps] = useState<string[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch('/api/tailor-resume/multi', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ listingIds: listings.map((l) => l.id), format: 'analyze' }),
    })
      .then((r) => r.json())
      .then((data: MultiAnalyzeResponse & { error?: string }) => {
        if (cancelled) return;
        if (data.error) {
          setError(data.error);
        } else {
          setAnalysis(data);
          // Default: select top 20 missing keywords by frequency.
          setSelected(new Set(data.missingKeywords.slice(0, 20).map((k) => k.keyword)));
        }
      })
      .catch(() => !cancelled && setError('Failed to analyze top jobs'))
      .finally(() => !cancelled && setLoading(false));
    return () => { cancelled = true; };
  }, [listings]);

  const toggle = (k: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
  };

  const selectAllInCategory = (cat: Category, kws: AggregatedKeyword[]) => {
    setSelected((prev) => {
      const next = new Set(prev);
      const catKws = kws.filter((k) => k.category === cat).map((k) => k.keyword);
      const allSelected = catKws.every((k) => next.has(k));
      if (allSelected) catKws.forEach((k) => next.delete(k));
      else catKws.forEach((k) => next.add(k));
      return next;
    });
  };

  async function handleDownload(format: 'pdf' | 'docx') {
    if (selected.size === 0 || downloadingFormat) return;
    setDownloadingFormat(format);
    setError(null);
    try {
      setCompressionSteps(null);
      const res = await fetch('/api/tailor-resume/multi', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          listingIds: listings.map((l) => l.id),
          selectedKeywords: Array.from(selected),
          format,
          mode: mandatoryMode ? 'mandatory' : 'budget-ladder',
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Request failed (${res.status})`);
      }
      // Pull the mandatory-mode cascade summary out of the response
      // header (server-side: tailoringHeaders in the multi route).
      const stepsHeader = res.headers.get('X-Compression-Steps');
      if (stepsHeader) {
        try {
          // Server URI-encodes because HTTP headers are ISO-8859-1
          // only. Decode then parse.
          const parsed = JSON.parse(decodeURIComponent(stepsHeader));
          if (Array.isArray(parsed)) {
            const valid = parsed.filter((s): s is string => typeof s === 'string');
            setCompressionSteps(valid.length > 0 ? valid : null);
          }
        } catch {
          // Malformed header — ignore; UI just won't show the footer.
        }
      }
      const blob = await res.blob();
      const cd = res.headers.get('Content-Disposition') || '';
      const match = cd.match(/filename="([^"]+)"/);
      const fallback = format === 'docx' ? 'tailored_resume_top_jobs.docx' : 'tailored_resume_top_jobs.pdf';
      const filename = match?.[1] || fallback;

      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to generate resume');
    } finally {
      setDownloadingFormat(null);
    }
  }

  const keywords = analysis?.missingKeywords ?? [];
  const categories: Category[] = ['technical', 'management', 'domain', 'soft'];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/30 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        className="bg-white w-full max-w-4xl max-h-[90vh] rounded-2xl shadow-modal border border-slate-100 overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between p-6 border-b border-slate-100">
          <div>
            <div className="flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-indigo-500" />
              <h2 className="text-lg font-semibold text-slate-800">Tailor Resume for Top Jobs</h2>
            </div>
            <p className="text-xs text-slate-500 mt-1">
              Pick keywords to add to your resume. Ranked by how many of your top matching jobs mention them.
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-6">
          {loading && (
            <div className="py-12 flex flex-col items-center gap-3 text-slate-500">
              <Loader2 className="w-8 h-8 animate-spin text-indigo-500" />
              <p className="text-sm">Analyzing {listings.length} jobs...</p>
              <p className="text-xs text-slate-400">This fetches each job description — may take ~15s.</p>
            </div>
          )}

          {!loading && error && !analysis && (
            <div className="p-4 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700">
              {error}
            </div>
          )}

          {analysis && (
            <>
              {/* Summary strip */}
              <div className="flex items-center gap-4 mb-6 p-4 bg-gradient-to-r from-indigo-50 to-violet-50 rounded-xl border border-indigo-100">
                <div className="flex-1">
                  <div className="text-xs text-slate-500 uppercase tracking-wide">Current avg ATS</div>
                  <div className="text-2xl font-bold text-slate-800">{analysis.avgOriginalScore}%</div>
                  <div className="text-xs text-slate-500 mt-0.5">across {analysis.jobsAnalyzed} jobs</div>
                </div>
                <div className="flex-1">
                  <div className="text-xs text-slate-500 uppercase tracking-wide">Missing keywords</div>
                  <div className="text-2xl font-bold text-slate-800">{keywords.length}</div>
                  <div className="text-xs text-slate-500 mt-0.5">union across all jobs</div>
                </div>
                <div className="flex-1">
                  <div className="text-xs text-slate-500 uppercase tracking-wide">Selected</div>
                  <div className="text-2xl font-bold text-indigo-600">{selected.size}</div>
                  <div className="text-xs text-slate-500 mt-0.5">will be added to resume</div>
                </div>
              </div>

              {analysis.errors.length > 0 && (
                <div className="mb-4 p-3 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-800">
                  Couldn&apos;t fully analyze {analysis.errors.length} job{analysis.errors.length > 1 ? 's' : ''} — results are based on the {analysis.jobsAnalyzed} that succeeded.
                </div>
              )}

              {keywords.length === 0 ? (
                <div className="py-8 text-center text-slate-500 text-sm">
                  Your resume already covers every keyword found in these jobs. Nice.
                </div>
              ) : (
                <div className="space-y-5">
                  {categories.map((cat) => {
                    const kws = keywords.filter((k) => k.category === cat);
                    if (kws.length === 0) return null;
                    const allSelected = kws.every((k) => selected.has(k.keyword));
                    return (
                      <div key={cat}>
                        <div className="flex items-center justify-between mb-2">
                          <h3 className="text-sm font-semibold text-slate-700">
                            {CATEGORY_LABEL[cat]} <span className="text-slate-400 font-normal">({kws.length})</span>
                          </h3>
                          <button
                            onClick={() => selectAllInCategory(cat, keywords)}
                            className="text-xs text-indigo-600 hover:text-indigo-800 font-medium"
                          >
                            {allSelected ? 'Deselect all' : 'Select all'}
                          </button>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {kws.map((kw) => {
                            const isSelected = selected.has(kw.keyword);
                            return (
                              <button
                                key={kw.keyword}
                                onClick={() => toggle(kw.keyword)}
                                className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs border transition-all ${
                                  isSelected
                                    ? `${CATEGORY_COLOR[cat]} font-semibold`
                                    : 'bg-slate-50 text-slate-500 border-slate-200 hover:bg-slate-100'
                                }`}
                                title={kw.jobTitles.join(' · ')}
                              >
                                {isSelected && <Check className="w-3 h-3" />}
                                <span>{displayKeyword(kw.keyword)}</span>
                                <span className={isSelected ? 'opacity-70' : 'opacity-50'}>
                                  ×{kw.frequency}
                                </span>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          )}
        </div>

        {/* Mandatory-mode toggle row — sits just above the footer
            CTAs. Default-on so the typical multi-tailor click ships
            every selected keyword and lets the cascade fit it. */}
        <div className="px-4 pt-3 border-t border-slate-100 bg-slate-50">
          <label
            className="flex items-start gap-2 text-xs text-slate-700 cursor-pointer"
            title="When ON, every selected keyword lands and the server tightens margins/spacing/font to fit one page. When OFF, the legacy budget ladder runs and some keywords may be dropped."
          >
            <input
              type="checkbox"
              checked={mandatoryMode}
              onChange={(e) => setMandatoryMode(e.target.checked)}
              className="mt-0.5 rounded"
            />
            <div className="flex-1">
              <span className="font-medium text-slate-700">
                Pack all keywords on 1 page (aggressive)
              </span>
              <span className="text-slate-500">
                {' '}— floors at 9pt body, 0.4&quot; margins; no content dropped.
              </span>
            </div>
          </label>
          {compressionSteps && compressionSteps.length > 0 && (() => {
            const exhausted = compressionSteps[compressionSteps.length - 1] === 'exhausted';
            const realSteps = exhausted ? compressionSteps.slice(0, -1) : compressionSteps;
            return (
              <div
                className={`mt-2 text-[11px] rounded-lg px-3 py-2 border ${
                  exhausted
                    ? 'bg-amber-50 border-amber-200 text-amber-800'
                    : 'bg-emerald-50 border-emerald-200 text-emerald-800'
                }`}
              >
                {exhausted ? (
                  <>
                    <strong>Couldn&apos;t fit on 1 page.</strong> Applied max compression ({realSteps.join(', ')}) but the result is still {'>'} 1 page. Best-effort download served — deselect a few keywords or tighten the base resume.
                  </>
                ) : (
                  <>
                    <strong>Fit applied:</strong> {realSteps.join(', ')}.
                  </>
                )}
              </div>
            );
          })()}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between p-4 border-t border-slate-100 bg-slate-50">
          <div className="text-xs text-slate-500">
            {error && !loading && analysis && <span className="text-red-600">{error}</span>}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-800 rounded-xl transition-all duration-200"
            >
              Cancel
            </button>
            <button
              onClick={() => handleDownload('docx')}
              disabled={!!downloadingFormat || loading || selected.size === 0 || !analysis}
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-xl border border-indigo-100 text-indigo-700 bg-indigo-50 shadow-sm shadow-indigo-500/10 hover:bg-indigo-100 hover:border-indigo-200 hover:shadow-md hover:shadow-indigo-500/15 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-200 focus-visible:ring-offset-2"
              title="Download the editable Word document. You can re-upload this .docx in Settings to make it your new base resume."
            >
              {downloadingFormat === 'docx' ? (
                <><Loader2 className="w-4 h-4 animate-spin" /> Generating...</>
              ) : (
                <><Download className="w-4 h-4" /> Download as DOCX</>
              )}
            </button>
            <button
              onClick={() => handleDownload('pdf')}
              disabled={!!downloadingFormat || loading || selected.size === 0 || !analysis}
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-xl bg-gradient-to-r from-indigo-500 to-violet-500 text-white shadow-btn-primary hover:from-indigo-600 hover:to-violet-600 hover:shadow-btn-primary-hover hover:-translate-y-0.5 active:translate-y-0 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed disabled:translate-y-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-200 focus-visible:ring-offset-2"
            >
              {downloadingFormat === 'pdf' ? (
                <><Loader2 className="w-4 h-4 animate-spin" /> Generating...</>
              ) : (
                <><Download className="w-4 h-4" /> Download as PDF</>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Master Resume modal ──────────────────────────────────────────
//
// One-button flow that replaces the old "Top N" + "Optimize for
// general ATS" pair. Talks to /api/tailor-resume/general, which:
//   1. Filters every cached listing by stored prefs (role / level /
//      location / salary / work auth / excluded companies).
//   2. Stratified-samples up to 100 by role family, weighted by
//      ATS score within each stratum.
//   3. Forwards to /api/tailor-resume/multi for the actual JD-detail
//      fetch + keyword aggregation + mandatory-mode cascade render.
//
// The modal auto-selects the top N missing keywords by frequency
// (N adjustable via slider, default 30, range 15–60) and surfaces a
// review step so the user can de-select keywords they can't
// legitimately back up. The Download button is gated to require ≥
// MIN_KEEP keywords selected — below that, the resume isn't worth
// generating (too little ATS coverage uplift).

const MIN_KEEP = 15;       // download disabled below this
const DEFAULT_TOP_N = 30;  // auto-selection size at modal open
const TOP_N_MIN = 15;
const TOP_N_MAX = 60;

interface CohortMeta {
  totalMatching: number;
  sampled: number;
  cap: number;
  byFamily: Record<string, number>;
}

function MasterResumeModal({ onClose }: { onClose: () => void }) {
  const [analysis, setAnalysis] = useState<MultiAnalyzeResponse | null>(null);
  const [cohort, setCohort] = useState<CohortMeta | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [downloadingFormat, setDownloadingFormat] = useState<'pdf' | 'docx' | null>(null);
  // Mandatory-mode toggle — same semantics as the legacy modal.
  // Default-on so the master resume gets the compression cascade.
  const [mandatoryMode, setMandatoryMode] = useState(true);
  const [compressionSteps, setCompressionSteps] = useState<string[] | null>(null);
  // Auto-select size slider. Re-running auto-select re-clobbers
  // anything the user de-selected — by design: changing the slider
  // is an explicit "start over" gesture.
  const [topN, setTopN] = useState(DEFAULT_TOP_N);

  // Run the analyze pass on mount. /general returns the same shape
  // as /multi analyze + a cohort metadata field.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch('/api/tailor-resume/general', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ format: 'analyze' }),
    })
      .then((r) => r.json())
      .then((data: MultiAnalyzeResponse & { cohort?: CohortMeta; error?: string }) => {
        if (cancelled) return;
        if (data.error) {
          setError(data.error);
        } else {
          setAnalysis(data);
          if (data.cohort) setCohort(data.cohort);
          // Auto-select the top N by frequency. /multi already
          // sorts missingKeywords by frequency desc + category prio.
          setSelected(new Set(data.missingKeywords.slice(0, DEFAULT_TOP_N).map((k) => k.keyword)));
        }
      })
      .catch(() => !cancelled && setError('Failed to analyze listings'))
      .finally(() => !cancelled && setLoading(false));
    return () => { cancelled = true; };
  }, []);

  // Re-pick top N whenever the slider changes. We deliberately do
  // NOT preserve the user's manual de-selections across slider
  // changes — moving the slider is an "I want a different starting
  // set" gesture, not a "tweak the existing one" gesture.
  function autoSelectTopN(n: number) {
    setTopN(n);
    if (!analysis) return;
    setSelected(new Set(analysis.missingKeywords.slice(0, n).map((k) => k.keyword)));
  }

  const toggle = (k: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
  };

  const selectAllInCategory = (cat: Category, kws: AggregatedKeyword[]) => {
    setSelected((prev) => {
      const next = new Set(prev);
      const catKws = kws.filter((k) => k.category === cat).map((k) => k.keyword);
      const allSelected = catKws.every((k) => next.has(k));
      if (allSelected) catKws.forEach((k) => next.delete(k));
      else catKws.forEach((k) => next.add(k));
      return next;
    });
  };

  async function handleDownload(format: 'pdf' | 'docx') {
    if (selected.size < MIN_KEEP || downloadingFormat) return;
    setDownloadingFormat(format);
    setError(null);
    setCompressionSteps(null);
    try {
      const res = await fetch('/api/tailor-resume/general', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          format,
          selectedKeywords: Array.from(selected),
          mode: mandatoryMode ? 'mandatory' : 'budget-ladder',
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Request failed (${res.status})`);
      }
      const stepsHeader = res.headers.get('X-Compression-Steps');
      if (stepsHeader) {
        try {
          const parsed = JSON.parse(decodeURIComponent(stepsHeader));
          if (Array.isArray(parsed)) {
            const valid = parsed.filter((s): s is string => typeof s === 'string');
            setCompressionSteps(valid.length > 0 ? valid : null);
          }
        } catch {
          // ignore — UI just skips the footer
        }
      }
      const blob = await res.blob();
      const cd = res.headers.get('Content-Disposition') || '';
      const match = cd.match(/filename="([^"]+)"/);
      const fallback = format === 'docx' ? 'master_resume.docx' : 'master_resume.pdf';
      const filename = match?.[1] || fallback;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to generate resume');
    } finally {
      setDownloadingFormat(null);
    }
  }

  const keywords = analysis?.missingKeywords ?? [];
  const categories: Category[] = ['technical', 'management', 'domain', 'soft'];
  const downloadDisabled =
    !!downloadingFormat || loading || !analysis || selected.size < MIN_KEEP;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/30 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        className="bg-white w-full max-w-4xl max-h-[90vh] rounded-2xl shadow-modal border border-slate-100 overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between p-6 border-b border-slate-100">
          <div>
            <div className="flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-indigo-500" />
              <h2 className="text-lg font-semibold text-slate-800">Generate Master Resume</h2>
            </div>
            <p className="text-xs text-slate-500 mt-1">
              One resume tuned for broad ATS coverage across every open listing matching your preferences. Review the auto-picked keywords below, then download.
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-6">
          {loading && (
            <div className="py-12 flex flex-col items-center gap-3 text-slate-500">
              <Loader2 className="w-8 h-8 animate-spin text-indigo-500" />
              <p className="text-sm">Analyzing listings matching your preferences…</p>
              <p className="text-xs text-slate-400">Stratified-samples up to 100 by role family. Takes 30–90s.</p>
            </div>
          )}

          {!loading && error && !analysis && (
            <div className="p-4 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700">
              {error}
            </div>
          )}

          {analysis && (
            <>
              {/* Cohort summary banner — the new bit vs. legacy modal */}
              {cohort && (
                <div className="mb-4 p-3 bg-indigo-50/50 border border-indigo-100 rounded-lg text-xs text-indigo-900">
                  <div className="flex items-center gap-4 flex-wrap">
                    <span>
                      <strong>{cohort.sampled}</strong> listings analyzed
                      {cohort.totalMatching > cohort.sampled && (
                        <span className="text-indigo-700/70">
                          {' '}(stratified sample of {cohort.totalMatching} matching your prefs)
                        </span>
                      )}
                    </span>
                    {Object.keys(cohort.byFamily).length > 1 && (
                      <span className="text-indigo-700/80">
                        {Object.entries(cohort.byFamily)
                          .sort((a, b) => b[1] - a[1])
                          .map(([fam, n]) => `${fam}: ${n}`)
                          .join(' · ')}
                      </span>
                    )}
                  </div>
                </div>
              )}

              {/* Summary strip */}
              <div className="flex items-center gap-4 mb-6 p-4 bg-gradient-to-r from-indigo-50 to-violet-50 rounded-xl border border-indigo-100">
                <div className="flex-1">
                  <div className="text-xs text-slate-500 uppercase tracking-wide">Current avg ATS</div>
                  <div className="text-2xl font-bold text-slate-800">{analysis.avgOriginalScore}%</div>
                  <div className="text-xs text-slate-500 mt-0.5">across {analysis.jobsAnalyzed} jobs</div>
                </div>
                <div className="flex-1">
                  <div className="text-xs text-slate-500 uppercase tracking-wide">Missing keywords</div>
                  <div className="text-2xl font-bold text-slate-800">{keywords.length}</div>
                  <div className="text-xs text-slate-500 mt-0.5">union across cohort</div>
                </div>
                <div className="flex-1">
                  <div className="text-xs text-slate-500 uppercase tracking-wide">Selected</div>
                  <div
                    className={`text-2xl font-bold ${
                      selected.size < MIN_KEEP ? 'text-amber-600' : 'text-indigo-600'
                    }`}
                  >
                    {selected.size}
                    {selected.size < MIN_KEEP && (
                      <span className="text-xs font-normal text-amber-600">
                        {' '}/ {MIN_KEEP} min
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-slate-500 mt-0.5">will be added to resume</div>
                </div>
              </div>

              {/* Auto-pick slider */}
              <div className="mb-4 p-3 bg-white border border-slate-200 rounded-lg">
                <div className="flex items-center justify-between mb-2">
                  <label className="text-xs font-medium text-slate-700">
                    Auto-pick top <strong>{topN}</strong> keywords by frequency
                  </label>
                  <button
                    onClick={() => autoSelectTopN(topN)}
                    className="text-xs text-indigo-600 hover:text-indigo-800 font-medium"
                    title="Reset selection to the auto-picked top N"
                  >
                    Reset to top {topN}
                  </button>
                </div>
                <input
                  type="range"
                  min={TOP_N_MIN}
                  max={TOP_N_MAX}
                  step={5}
                  value={topN}
                  onChange={(e) => autoSelectTopN(parseInt(e.target.value, 10))}
                  className="w-full accent-indigo-600"
                />
                <div className="flex justify-between text-[10px] text-slate-400 mt-1">
                  <span>{TOP_N_MIN} (lean)</span>
                  <span>{TOP_N_MAX} (max coverage)</span>
                </div>
              </div>

              {analysis.errors.length > 0 && (
                <div className="mb-4 p-3 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-800">
                  Couldn&apos;t fully analyze {analysis.errors.length} job{analysis.errors.length > 1 ? 's' : ''} — results are based on the {analysis.jobsAnalyzed} that succeeded.
                </div>
              )}

              {keywords.length === 0 ? (
                <div className="py-8 text-center text-slate-500 text-sm">
                  Your resume already covers every keyword found in this cohort. Nice.
                </div>
              ) : (
                <div className="space-y-5">
                  {categories.map((cat) => {
                    const kws = keywords.filter((k) => k.category === cat);
                    if (kws.length === 0) return null;
                    const allSelected = kws.every((k) => selected.has(k.keyword));
                    return (
                      <div key={cat}>
                        <div className="flex items-center justify-between mb-2">
                          <h3 className="text-sm font-semibold text-slate-700">
                            {CATEGORY_LABEL[cat]} <span className="text-slate-400 font-normal">({kws.length})</span>
                          </h3>
                          <button
                            onClick={() => selectAllInCategory(cat, keywords)}
                            className="text-xs text-indigo-600 hover:text-indigo-800 font-medium"
                          >
                            {allSelected ? 'Deselect all' : 'Select all'}
                          </button>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {kws.map((kw) => {
                            const isSelected = selected.has(kw.keyword);
                            return (
                              <button
                                key={kw.keyword}
                                onClick={() => toggle(kw.keyword)}
                                className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs border transition-all ${
                                  isSelected
                                    ? `${CATEGORY_COLOR[cat]} font-semibold`
                                    : 'bg-slate-50 text-slate-500 border-slate-200 hover:bg-slate-100'
                                }`}
                                title={kw.jobTitles.join(' · ')}
                              >
                                {isSelected && <Check className="w-3 h-3" />}
                                <span>{displayKeyword(kw.keyword)}</span>
                                <span className={isSelected ? 'opacity-70' : 'opacity-50'}>
                                  ×{kw.frequency}
                                </span>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          )}
        </div>

        {/* Mandatory-mode toggle + compression footer */}
        <div className="px-4 pt-3 border-t border-slate-100 bg-slate-50">
          <label className="flex items-start gap-2 text-xs text-slate-700 cursor-pointer">
            <input
              type="checkbox"
              checked={mandatoryMode}
              onChange={(e) => setMandatoryMode(e.target.checked)}
              className="mt-0.5 rounded"
            />
            <div className="flex-1">
              <span className="font-medium text-slate-700">
                Pack all keywords on 1 page (aggressive)
              </span>
              <span className="text-slate-500">
                {' '}— floors at 9pt body, 0.4&quot; margins; no content dropped.
              </span>
            </div>
          </label>
          {compressionSteps && compressionSteps.length > 0 && (() => {
            const exhausted = compressionSteps[compressionSteps.length - 1] === 'exhausted';
            const realSteps = exhausted ? compressionSteps.slice(0, -1) : compressionSteps;
            return (
              <div
                className={`mt-2 text-[11px] rounded-lg px-3 py-2 border ${
                  exhausted
                    ? 'bg-amber-50 border-amber-200 text-amber-800'
                    : 'bg-emerald-50 border-emerald-200 text-emerald-800'
                }`}
              >
                {exhausted ? (
                  <>
                    <strong>Couldn&apos;t fit on 1 page.</strong> Applied max compression ({realSteps.join(', ')}) but the result is still {'>'} 1 page. Best-effort download served — deselect a few keywords or tighten the base resume.
                  </>
                ) : (
                  <>
                    <strong>Fit applied:</strong> {realSteps.join(', ')}.
                  </>
                )}
              </div>
            );
          })()}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between p-4 border-t border-slate-100 bg-slate-50">
          <div className="text-xs">
            {error && !loading && analysis && <span className="text-red-600">{error}</span>}
            {!error && selected.size > 0 && selected.size < MIN_KEEP && (
              <span className="text-amber-700">
                Select at least <strong>{MIN_KEEP}</strong> keywords to download (currently {selected.size}).
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-800 rounded-xl transition-all duration-200"
            >
              Cancel
            </button>
            <button
              onClick={() => handleDownload('docx')}
              disabled={downloadDisabled}
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-xl border border-indigo-100 text-indigo-700 bg-indigo-50 shadow-sm shadow-indigo-500/10 hover:bg-indigo-100 hover:border-indigo-200 hover:shadow-md hover:shadow-indigo-500/15 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-200 focus-visible:ring-offset-2"
              title="Download the editable Word document. You can re-upload this .docx in Settings to make it your new base resume."
            >
              {downloadingFormat === 'docx' ? (
                <><Loader2 className="w-4 h-4 animate-spin" /> Generating...</>
              ) : (
                <><Download className="w-4 h-4" /> Download as DOCX</>
              )}
            </button>
            <button
              onClick={() => handleDownload('pdf')}
              disabled={downloadDisabled}
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-xl bg-gradient-to-r from-indigo-500 to-violet-500 text-white shadow-btn-primary hover:from-indigo-600 hover:to-violet-600 hover:shadow-btn-primary-hover hover:-translate-y-0.5 active:translate-y-0 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed disabled:translate-y-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-200 focus-visible:ring-offset-2"
            >
              {downloadingFormat === 'pdf' ? (
                <><Loader2 className="w-4 h-4 animate-spin" /> Generating...</>
              ) : (
                <><Download className="w-4 h-4" /> Download as PDF</>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
