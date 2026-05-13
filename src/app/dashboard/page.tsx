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
  const color = score >= 70 ? '#22c55e' : score >= 45 ? '#eab308' : '#ef4444';

  return (
    <div className="flex flex-col items-center">
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} className="-rotate-90">
          <circle cx={size / 2} cy={size / 2} r={radius} stroke="#e5e7eb" strokeWidth="8" fill="none" />
          <circle
            cx={size / 2} cy={size / 2} r={radius}
            stroke={color} strokeWidth="8" fill="none"
            strokeDasharray={circumference} strokeDashoffset={offset}
            strokeLinecap="round"
            className="transition-all duration-700"
          />
        </svg>
        <span
          className="absolute inset-0 flex items-center justify-center text-2xl font-bold"
          style={{ color }}
        >
          {score}%
        </span>
      </div>
      {label && <span className="text-xs text-gray-500 mt-1.5 font-medium">{label}</span>}
    </div>
  );
}

function CategoryBar({ label, score }: { label: string; score: number }) {
  const color = score >= 70 ? 'bg-green-500' : score >= 45 ? 'bg-yellow-500' : 'bg-red-400';
  return (
    <div className="flex items-center gap-3">
      <span className="text-xs text-gray-500 w-20 text-right">{label}</span>
      <div className="flex-1 h-2.5 bg-gray-100 rounded-full overflow-hidden">
        <div className={`h-full rounded-full transition-all duration-700 ${color}`} style={{ width: `${score}%` }} />
      </div>
      <span className="text-xs font-semibold text-gray-700 w-10">{score}%</span>
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
    blue: 'bg-blue-50 text-blue-600 border-blue-100',
    green: 'bg-green-50 text-green-600 border-green-100',
    purple: 'bg-purple-50 text-purple-600 border-purple-100',
    amber: 'bg-amber-50 text-amber-600 border-amber-100',
  };
  return (
    <div className={`rounded-xl border p-5 ${colors[color]}`}>
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

  // Show up to 20 jobs — same pool the "Tailor for Top Jobs" flow uses,
  // so what the user sees matches what will be tailored.
  const topListings = useMemo(() => rankedListings.slice(0, 20), [rankedListings]);
  const topListingsForTailor = topListings;

  const [tailorModalOpen, setTailorModalOpen] = useState(false);
  // "Optimize for general ATS" — a second tailor flow that pulls the
  // listings the user has actively pursued (any pipeline flag) and
  // surfaces best-overlap keywords across THOSE jobs specifically.
  // The hypothesis is that the user already knows what they're going
  // after, so a tailored "general ATS" pass against their applied set
  // is more useful than against an algorithm-picked top-20.
  const [optimizeModalOpen, setOptimizeModalOpen] = useState(false);
  const PIPELINE_FLAG_SET = new Set([
    'applied', 'phone-screen', 'interviewing', 'offer', 'rejected',
  ]);
  const flaggedListings = useMemo(() => {
    const ids = new Set(
      Object.values(flags)
        .filter((f) => PIPELINE_FLAG_SET.has(f.flag))
        .map((f) => f.listingId),
    );
    return listings.filter((l) => ids.has(l.id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flags, listings]);

  if (loading) {
    return (
      <div className="p-8 flex flex-col items-center justify-center min-h-[60vh]">
        <Loader2 className="w-10 h-10 text-blue-500 animate-spin mb-4" />
        <h2 className="text-lg font-semibold text-gray-900 mb-2">Loading Dashboard...</h2>
      </div>
    );
  }

  if (!settings) return null;

  const workModeLabels: Record<WorkMode, string> = { remote: 'Remote', hybrid: 'Hybrid', onsite: 'On-site' };

  return (
    <div className="p-8 max-w-7xl mx-auto animate-fade-in">
      {/* Header */}
      <div className="mb-8">
        <div className="inline-flex items-center gap-2 mb-2 px-3 py-1 rounded-full bg-blue-50 border border-blue-100">
          <Sparkles className="w-3.5 h-3.5 text-blue-600" />
          <span className="text-xs font-medium text-blue-700">Live job search</span>
        </div>
        <h1 className="text-3xl font-bold tracking-tight bg-gradient-to-r from-gray-900 via-indigo-700 to-purple-700 bg-clip-text text-transparent">
          {settings.userName ? `Welcome back, ${settings.userName}` : 'Dashboard'}
        </h1>
        <p className="text-sm text-gray-500 mt-1">
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
        {/* Resume ATS Performance */}
        <div className="col-span-1 bg-white rounded-xl border border-gray-200 p-6">
          <div className="flex items-center gap-2 mb-5">
            <Target className="w-5 h-5 text-blue-500" />
            <h2 className="text-base font-semibold text-gray-900">Resume Performance</h2>
          </div>

          <div className="flex justify-center mb-5">
            <ScoreRing score={stats.avgScore} size={120} label="Average Match" />
          </div>

          <div className="space-y-3">
            <CategoryBar label="Technical" score={stats.avgTechnical} />
            <CategoryBar label="Management" score={stats.avgManagement} />
            <CategoryBar label="Domain" score={stats.avgDomain} />
            <CategoryBar label="Soft Skills" score={stats.avgSoft} />
          </div>

          <div className="mt-5 pt-4 border-t border-gray-100">
            <div className="grid grid-cols-3 gap-2 text-center">
              <div>
                <div className="text-lg font-bold text-green-600">{stats.high}</div>
                <div className="text-xs text-gray-500">Strong</div>
              </div>
              <div>
                <div className="text-lg font-bold text-yellow-600">{stats.medium}</div>
                <div className="text-xs text-gray-500">Moderate</div>
              </div>
              <div>
                <div className="text-lg font-bold text-red-500">{stats.low}</div>
                <div className="text-xs text-gray-500">Weak</div>
              </div>
            </div>
          </div>

          {settings.baseResumeFileName && (
            <div className="mt-4 p-3 bg-gray-50 rounded-lg">
              <div className="flex items-center gap-2">
                <FileText className="w-4 h-4 text-gray-400" />
                <span className="text-xs text-gray-600 font-medium truncate">{settings.baseResumeFileName}</span>
              </div>
            </div>
          )}
        </div>

        {/* Top Companies */}
        <div className="col-span-2 bg-white rounded-xl border border-gray-200 p-6">
          <div className="flex items-center justify-between mb-5">
            <div className="flex items-center gap-2">
              <Star className="w-5 h-5 text-amber-500" />
              <h2 className="text-base font-semibold text-gray-900">Top Companies by ATS Match</h2>
            </div>
            <Link href="/listings" className="text-xs text-blue-600 hover:text-blue-700 font-medium">
              View all &rarr;
            </Link>
          </div>

          {topCompanies.length === 0 ? (
            <div className="text-center py-8 text-gray-400">
              <Building2 className="w-10 h-10 mx-auto mb-2 opacity-50" />
              <p className="text-sm">No scored listings yet. Browse listings to start scoring.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {topCompanies.map((c, i) => {
                const barColor = c.avgScore >= 60 ? 'bg-green-500' : c.avgScore >= 40 ? 'bg-yellow-500' : 'bg-red-400';
                return (
                  <div key={c.company} className="flex items-center gap-3 p-3 rounded-lg hover:bg-gray-50 transition-colors">
                    <span className="text-xs font-bold text-gray-400 w-5 text-right">{i + 1}</span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold text-gray-900 truncate">{c.company}</span>
                        <span className="text-xs text-gray-400">{c.count} role{c.count > 1 ? 's' : ''}</span>
                      </div>
                      <div className="flex items-center gap-2 mt-1">
                        <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden max-w-[200px]">
                          <div className={`h-full rounded-full ${barColor}`} style={{ width: `${c.avgScore}%` }} />
                        </div>
                        <span className="text-xs font-medium text-gray-600">{c.avgScore}% avg</span>
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="text-sm font-bold text-gray-700">{c.bestScore}%</div>
                      <div className="text-xs text-gray-400">best</div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Top Matching Listings */}
      <div className="bg-white rounded-xl border border-gray-200 p-6 mb-8">
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-2">
            <Zap className="w-5 h-5 text-blue-500" />
            <h2 className="text-base font-semibold text-gray-900">Top Matching Jobs</h2>
          </div>
          <div className="flex items-center gap-3">
            {topListingsForTailor.length >= 3 && (
              <button
                onClick={() => setTailorModalOpen(true)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-gradient-to-r from-indigo-500 to-purple-600 text-white hover:from-indigo-600 hover:to-purple-700 shadow-sm transition-all"
              >
                <Sparkles className="w-3.5 h-3.5" />
                Tailor for Top {topListingsForTailor.length} Jobs
              </button>
            )}
            {flaggedListings.length >= 3 && (
              <button
                onClick={() => setOptimizeModalOpen(true)}
                title="Find best-overlap keywords across the jobs you've already flagged (applied / interviewing / etc.) and bake them into your resume for a general-ATS-score lift."
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-gradient-to-r from-emerald-500 to-teal-600 text-white hover:from-emerald-600 hover:to-teal-700 shadow-sm transition-all"
              >
                <Target className="w-3.5 h-3.5" />
                Optimize for general ATS ({flaggedListings.length} jobs)
              </button>
            )}
            <Link href="/listings" className="text-xs text-blue-600 hover:text-blue-700 font-medium">
              View all &rarr;
            </Link>
          </div>
        </div>

        {topListings.length === 0 ? (
          <div className="text-center py-8 text-gray-400">
            <Briefcase className="w-10 h-10 mx-auto mb-2 opacity-50" />
            <p className="text-sm">No scored listings yet.</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            {topListings.map((listing) => {
              const score = scoreCache[listing.id];
              const scoreColor = score.overall >= 60 ? 'text-green-600 bg-green-50 border-green-200' : score.overall >= 40 ? 'text-yellow-600 bg-yellow-50 border-yellow-200' : 'text-red-500 bg-red-50 border-red-200';
              return (
                <Link
                  key={listing.id}
                  href={`/listings/${listing.id}`}
                  className="flex items-start gap-3 p-4 rounded-lg border border-gray-100 hover:border-blue-200 hover:shadow-sm transition-all group"
                >
                  <span className={`shrink-0 inline-flex items-center px-2.5 py-1 rounded-lg text-sm font-bold border ${scoreColor}`}>
                    {score.overall}%
                  </span>
                  <div className="flex-1 min-w-0">
                    <h4 className="text-sm font-semibold text-gray-900 truncate group-hover:text-blue-600">{listing.title}</h4>
                    <p className="text-xs text-gray-500 truncate">{listing.company} &middot; {listing.location}</p>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </div>

      {/* Profile & Preferences */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-2">
            <User className="w-5 h-5 text-gray-500" />
            <h2 className="text-base font-semibold text-gray-900">Your Profile & Preferences</h2>
          </div>
          <Link href="/settings" className="text-xs text-blue-600 hover:text-blue-700 font-medium">
            Edit &rarr;
          </Link>
        </div>

        <div className="grid grid-cols-2 gap-6">
          {/* Left column */}
          <div className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-gray-400 uppercase tracking-wide mb-1">Name</label>
              <p className="text-sm font-medium text-gray-900">{settings.userName || 'Not set'}</p>
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-400 uppercase tracking-wide mb-1.5">
                <span className="inline-flex items-center gap-1"><Briefcase className="w-3 h-3" /> Target Roles</span>
              </label>
              {settings.preferredRoles.length > 0 ? (
                <div className="flex flex-wrap gap-1.5">
                  {settings.preferredRoles.map((r) => (
                    <span key={r} className="px-2.5 py-1 bg-blue-50 text-blue-700 rounded-lg text-xs font-medium">{r}</span>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-gray-400">No roles specified</p>
              )}
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-400 uppercase tracking-wide mb-1.5">
                <span className="inline-flex items-center gap-1"><MapPin className="w-3 h-3" /> Locations</span>
              </label>
              {settings.preferredLocations.length > 0 ? (
                <div className="flex flex-wrap gap-1.5">
                  {settings.preferredLocations.map((l) => (
                    <span key={l} className="px-2.5 py-1 bg-purple-50 text-purple-700 rounded-lg text-xs font-medium">{l}</span>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-gray-400">No locations specified</p>
              )}
            </div>
          </div>

          {/* Right column */}
          <div className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-gray-400 uppercase tracking-wide mb-1.5">Work Mode</label>
              {settings.workMode.length > 0 ? (
                <div className="flex gap-2">
                  {settings.workMode.map((m) => (
                    <span key={m} className="px-3 py-1.5 bg-green-50 text-green-700 rounded-lg text-xs font-medium">
                      {workModeLabels[m]}
                    </span>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-gray-400">Any</p>
              )}
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-400 uppercase tracking-wide mb-1">
                <span className="inline-flex items-center gap-1"><DollarSign className="w-3 h-3" /> Salary Range</span>
              </label>
              {settings.salaryMin || settings.salaryMax ? (
                <p className="text-sm font-medium text-gray-900">
                  {settings.salaryMin ? `$${settings.salaryMin.toLocaleString()}` : 'Any'}
                  {' \u2013 '}
                  {settings.salaryMax ? `$${settings.salaryMax.toLocaleString()}` : 'Any'}
                </p>
              ) : (
                <p className="text-xs text-gray-400">Not specified</p>
              )}
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-400 uppercase tracking-wide mb-1">Resume</label>
              {settings.baseResumeFileName ? (
                <div className="flex items-center gap-2">
                  <FileText className="w-4 h-4 text-green-500" />
                  <span className="text-sm font-medium text-gray-900">{settings.baseResumeFileName}</span>
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

      {tailorModalOpen && (
        <TailorTopJobsModal
          listings={topListingsForTailor}
          onClose={() => setTailorModalOpen(false)}
        />
      )}
      {optimizeModalOpen && (
        <TailorTopJobsModal
          listings={flaggedListings}
          onClose={() => setOptimizeModalOpen(false)}
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
  technical: 'bg-blue-50 text-blue-700 border-blue-200',
  management: 'bg-purple-50 text-purple-700 border-purple-200',
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
          const parsed = JSON.parse(stepsHeader);
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
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="bg-white w-full max-w-4xl max-h-[90vh] rounded-2xl shadow-2xl overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between p-6 border-b border-gray-100">
          <div>
            <div className="flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-indigo-500" />
              <h2 className="text-lg font-semibold text-gray-900">Tailor Resume for Top Jobs</h2>
            </div>
            <p className="text-xs text-gray-500 mt-1">
              Pick keywords to add to your resume. Ranked by how many of your top matching jobs mention them.
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-700"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-6">
          {loading && (
            <div className="py-12 flex flex-col items-center gap-3 text-gray-500">
              <Loader2 className="w-8 h-8 animate-spin text-indigo-500" />
              <p className="text-sm">Analyzing {listings.length} jobs...</p>
              <p className="text-xs text-gray-400">This fetches each job description — may take ~15s.</p>
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
              <div className="flex items-center gap-4 mb-6 p-4 bg-gradient-to-r from-indigo-50 to-purple-50 rounded-xl border border-indigo-100">
                <div className="flex-1">
                  <div className="text-xs text-gray-500 uppercase tracking-wide">Current avg ATS</div>
                  <div className="text-2xl font-bold text-gray-900">{analysis.avgOriginalScore}%</div>
                  <div className="text-xs text-gray-500 mt-0.5">across {analysis.jobsAnalyzed} jobs</div>
                </div>
                <div className="flex-1">
                  <div className="text-xs text-gray-500 uppercase tracking-wide">Missing keywords</div>
                  <div className="text-2xl font-bold text-gray-900">{keywords.length}</div>
                  <div className="text-xs text-gray-500 mt-0.5">union across all jobs</div>
                </div>
                <div className="flex-1">
                  <div className="text-xs text-gray-500 uppercase tracking-wide">Selected</div>
                  <div className="text-2xl font-bold text-indigo-600">{selected.size}</div>
                  <div className="text-xs text-gray-500 mt-0.5">will be added to resume</div>
                </div>
              </div>

              {analysis.errors.length > 0 && (
                <div className="mb-4 p-3 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-800">
                  Couldn&apos;t fully analyze {analysis.errors.length} job{analysis.errors.length > 1 ? 's' : ''} — results are based on the {analysis.jobsAnalyzed} that succeeded.
                </div>
              )}

              {keywords.length === 0 ? (
                <div className="py-8 text-center text-gray-500 text-sm">
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
                          <h3 className="text-sm font-semibold text-gray-700">
                            {CATEGORY_LABEL[cat]} <span className="text-gray-400 font-normal">({kws.length})</span>
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
                                    : 'bg-gray-50 text-gray-500 border-gray-200 hover:bg-gray-100'
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
        <div className="px-4 pt-3 border-t border-gray-100 bg-gray-50">
          <label
            className="flex items-start gap-2 text-xs text-gray-700 cursor-pointer"
            title="When ON, every selected keyword lands and the server tightens margins/spacing/font to fit one page. When OFF, the legacy budget ladder runs and some keywords may be dropped."
          >
            <input
              type="checkbox"
              checked={mandatoryMode}
              onChange={(e) => setMandatoryMode(e.target.checked)}
              className="mt-0.5 rounded"
            />
            <div className="flex-1">
              <span className="font-medium text-gray-800">
                Pack all keywords on 1 page (aggressive)
              </span>
              <span className="text-gray-500">
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
        <div className="flex items-center justify-between p-4 border-t border-gray-100 bg-gray-50">
          <div className="text-xs text-gray-500">
            {error && !loading && analysis && <span className="text-red-600">{error}</span>}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 rounded-lg"
            >
              Cancel
            </button>
            <button
              onClick={() => handleDownload('docx')}
              disabled={!!downloadingFormat || loading || selected.size === 0 || !analysis}
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-lg border border-indigo-200 text-indigo-700 bg-white hover:bg-indigo-50 disabled:opacity-50 disabled:cursor-not-allowed"
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
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-lg bg-gradient-to-r from-indigo-500 to-purple-600 text-white disabled:opacity-50 disabled:cursor-not-allowed hover:from-indigo-600 hover:to-purple-700"
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
