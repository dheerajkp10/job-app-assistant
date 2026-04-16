'use client';

import { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import {
  User, Briefcase, MapPin, DollarSign, FileText, Target, Building2,
  TrendingUp, ChevronRight, Globe, PlusCircle, Loader2, BarChart3,
  CheckCircle2, AlertTriangle, Star, Zap,
} from 'lucide-react';
import type { Settings, JobListing, ScoreCacheEntry, WorkMode, ListingFlagEntry } from '@/lib/types';
import { filterByUserPreferences } from '@/lib/role-filter';

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

  useEffect(() => {
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
        setAllListings(listingsData.listings || []);
        setScoreCache(scores || {});
        setFlags(flagsData || {});
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  // Filter listings by user preferences
  const listings = useMemo(
    () => filterByUserPreferences(allListings, settings?.preferredRoles ?? []),
    [allListings, settings?.preferredRoles],
  );

  // Compute aggregate stats
  const stats = useMemo(() => {
    const scored = listings.filter((l) => scoreCache[l.id]);
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
      const score = scoreCache[listing.id];
      if (!score) continue;
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

  // Top individual listings by score
  const topListings = useMemo(() => {
    return listings
      .filter((l) => scoreCache[l.id])
      .sort((a, b) => scoreCache[b.id].overall - scoreCache[a.id].overall)
      .slice(0, 8);
  }, [listings, scoreCache]);

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
    <div className="p-8 max-w-7xl mx-auto">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">
          {settings.userName ? `Welcome back, ${settings.userName}` : 'Dashboard'}
        </h1>
        <p className="text-sm text-gray-500 mt-1">
          Your job search overview and resume performance
        </p>
      </div>

      {/* Quick actions */}
      <div className="grid grid-cols-3 gap-4 mb-8">
        <Link
          href="/listings"
          className="flex items-center gap-3 p-4 bg-white rounded-xl border border-gray-200 hover:border-blue-300 hover:shadow-sm transition-all group"
        >
          <div className="w-10 h-10 rounded-lg bg-blue-50 flex items-center justify-center">
            <Globe className="w-5 h-5 text-blue-600" />
          </div>
          <div className="flex-1">
            <h3 className="text-sm font-semibold text-gray-900 group-hover:text-blue-600">Browse Listings</h3>
            <p className="text-xs text-gray-500">{stats.totalListings} matching roles</p>
          </div>
          <ChevronRight className="w-4 h-4 text-gray-400 group-hover:text-blue-600" />
        </Link>
        <Link
          href="/jobs/add"
          className="flex items-center gap-3 p-4 bg-white rounded-xl border border-gray-200 hover:border-green-300 hover:shadow-sm transition-all group"
        >
          <div className="w-10 h-10 rounded-lg bg-green-50 flex items-center justify-center">
            <PlusCircle className="w-5 h-5 text-green-600" />
          </div>
          <div className="flex-1">
            <h3 className="text-sm font-semibold text-gray-900 group-hover:text-green-600">Add a Job</h3>
            <p className="text-xs text-gray-500">Paste a URL to score & tailor</p>
          </div>
          <ChevronRight className="w-4 h-4 text-gray-400 group-hover:text-green-600" />
        </Link>
        <Link
          href="/settings"
          className="flex items-center gap-3 p-4 bg-white rounded-xl border border-gray-200 hover:border-purple-300 hover:shadow-sm transition-all group"
        >
          <div className="w-10 h-10 rounded-lg bg-purple-50 flex items-center justify-center">
            <User className="w-5 h-5 text-purple-600" />
          </div>
          <div className="flex-1">
            <h3 className="text-sm font-semibold text-gray-900 group-hover:text-purple-600">Settings</h3>
            <p className="text-xs text-gray-500">Preferences & resume</p>
          </div>
          <ChevronRight className="w-4 h-4 text-gray-400 group-hover:text-purple-600" />
        </Link>
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
          <Link href="/listings" className="text-xs text-blue-600 hover:text-blue-700 font-medium">
            View all &rarr;
          </Link>
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
    </div>
  );
}
