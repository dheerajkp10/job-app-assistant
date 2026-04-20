'use client';

import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import Link from 'next/link';
import {
  Search, RefreshCw, MapPin, Calendar, Building2, ExternalLink,
  DollarSign, Filter, ChevronDown, ChevronUp, Loader2, AlertCircle,
  Target, Download, FileText, AlertTriangle, CheckCircle2, XCircle,
  Tag, EyeOff, Eye, Globe,
} from 'lucide-react';
import type { JobListing, ScoreCacheEntry, ListingFlag, ListingFlagEntry, Settings, WorkMode } from '@/lib/types';
import { PORTAL_SEARCH_LINKS, LISTING_FLAGS, LEVEL_TIERS } from '@/lib/types';
import { filterByUserPreferences } from '@/lib/role-filter';
import { matchesLevelPreference } from '@/lib/level-matcher';
import {
  detectCurrentCompany,
  getCompanyAliases,
  isExcludedCompany,
} from '@/lib/current-company';
import { isUnscorableAts } from '@/lib/scorable';
import { PageHeaderNav } from '@/components/layout/page-header-nav';

const ATS_LABELS: Record<string, string> = {
  greenhouse: 'Greenhouse',
  lever: 'Lever',
  ashby: 'Ashby',
};

// ─── Location matching (preference-driven) ──────────────────────────
// Falls back to Washington/Remote when user has no preferences set.

const WA_PATTERNS = [
  'seattle', 'bellevue', 'kirkland', 'redmond', 'tacoma', 'spokane',
  'olympia', 'everett', 'renton', 'kent', 'bothell', 'woodinville',
  'issaquah', 'sammamish', 'mercer island', 'tukwila', 'lynnwood',
  'washington', ', wa',
];
const REMOTE_PATTERNS = ['remote'];

function isWashingtonOrRemote(location: string): boolean {
  const loc = location.toLowerCase();
  return (
    WA_PATTERNS.some((p) => loc.includes(p)) ||
    REMOTE_PATTERNS.some((p) => loc.includes(p))
  );
}

/**
 * Build location matcher from the user's preferred locations.
 * For each location like "Seattle, WA" we extract lowercase tokens
 * (e.g., "seattle", "wa") and match any of them.
 */
function buildLocationMatcher(preferredLocations: string[]): (location: string) => boolean {
  if (!preferredLocations || preferredLocations.length === 0) {
    return isWashingtonOrRemote;
  }

  // Build tokens from each preferred location.
  const tokens: string[] = [];
  for (const loc of preferredLocations) {
    const lower = loc.toLowerCase().trim();
    // "Remote" as a location is a special case
    if (lower === 'remote') {
      tokens.push('remote');
      continue;
    }
    // Split "Seattle, WA" → ["seattle", "wa"]
    for (const part of lower.split(/[,\s]+/).filter(Boolean)) {
      if (part.length >= 2) tokens.push(part);
    }
  }

  return (location: string) => {
    const loc = location.toLowerCase();
    return tokens.some((t) => loc.includes(t));
  };
}

/**
 * Check if a listing's location matches the user's preferred work mode.
 */
function matchesWorkMode(location: string, workModes: WorkMode[]): boolean {
  if (!workModes || workModes.length === 0) return true;
  const loc = location.toLowerCase();
  const isRemote = loc.includes('remote');
  const isHybrid = loc.includes('hybrid');
  const isOnsite = !isRemote && !isHybrid;

  for (const mode of workModes) {
    if (mode === 'remote' && isRemote) return true;
    if (mode === 'hybrid' && isHybrid) return true;
    if (mode === 'onsite' && isOnsite) return true;
  }
  return false;
}

// ─── Score visualization components ─────────────────────────────────

function ScoreRing({ score, size = 80, label }: { score: number; size?: number; label?: string }) {
  const radius = (size - 8) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (score / 100) * circumference;
  const color = score >= 75 ? '#22c55e' : score >= 50 ? '#eab308' : '#ef4444';

  return (
    <div className="flex flex-col items-center">
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} className="-rotate-90">
          <circle cx={size / 2} cy={size / 2} r={radius} stroke="#e5e7eb" strokeWidth="6" fill="none" />
          <circle
            cx={size / 2} cy={size / 2} r={radius}
            stroke={color} strokeWidth="6" fill="none"
            strokeDasharray={circumference} strokeDashoffset={offset}
            strokeLinecap="round"
            className="transition-all duration-700"
          />
        </svg>
        <span
          className="absolute inset-0 flex items-center justify-center text-lg font-bold"
          style={{ color }}
        >
          {score}%
        </span>
      </div>
      {label && <span className="text-xs text-gray-500 mt-1">{label}</span>}
    </div>
  );
}

function CategoryBar({ label, score }: { label: string; score: number }) {
  const color = score >= 75 ? 'bg-green-500' : score >= 50 ? 'bg-yellow-500' : 'bg-red-400';
  return (
    <div className="flex items-center gap-3">
      <span className="text-xs text-gray-500 w-24 text-right">{label}</span>
      <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
        <div className={`h-full rounded-full transition-all duration-700 ${color}`} style={{ width: `${score}%` }} />
      </div>
      <span className="text-xs font-semibold text-gray-700 w-10">{score}%</span>
    </div>
  );
}

// ─── Types for inline ATS / tailor ──────────────────────────────────

interface ATSScore {
  overall: number;
  technical: number;
  management: number;
  domain: number;
  soft: number;
  matchedKeywords: string[];
  missingKeywords: string[];
  totalJdKeywords: number;
  totalMatched: number;
}

interface TailorResult {
  addedKeywords: string[];
  originalScore: ATSScore;
  tailoredScore: ATSScore;
  changesSummary: string[];
  tailoredText: string;
}

// ─── Main page ──────────────────────────────────────────────────────

export default function ListingsPage() {
  const [allListings, setAllListings] = useState<JobListing[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [lastFetched, setLastFetched] = useState<string | null>(null);
  const [fetchErrors, setFetchErrors] = useState<{ company: string; error: string }[]>([]);
  const [showErrors, setShowErrors] = useState(false);
  const [scoreCache, setScoreCache] = useState<Record<string, ScoreCacheEntry>>({});
  const [scoringProgress, setScoringProgress] = useState<{ scored: number; total: number } | null>(null);
  const scoringRef = useRef(false);

  // User preferences
  const [prefs, setPrefs] = useState<Partial<Settings>>({});
  const locationMatcher = useMemo(
    () => buildLocationMatcher(prefs.preferredLocations ?? []),
    [prefs.preferredLocations],
  );

  // User-set flags (applied / incorrect / not-applicable) on listings.
  const [flags, setFlags] = useState<Record<string, ListingFlagEntry>>({});
  const [showFlagged, setShowFlagged] = useState(false);

  const setFlagFor = useCallback(async (listingId: string, flag: ListingFlag | null) => {
    // Optimistic update
    setFlags((prev) => {
      const next = { ...prev };
      if (flag === null) {
        delete next[listingId];
      } else {
        next[listingId] = { listingId, flag, flaggedAt: new Date().toISOString() };
      }
      return next;
    });
    try {
      await fetch('/api/listing-flags', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ listingId, flag }),
      });
    } catch {
      // If the request fails, refetch the source of truth to repair state.
      fetch('/api/listing-flags').then(r => r.json()).then(setFlags).catch(() => {});
    }
  }, []);

  // Filters
  const [search, setSearch] = useState('');
  const [selectedCompany, setSelectedCompany] = useState<string>('all');
  const [selectedDepartment, setSelectedDepartment] = useState<string>('all');
  const [showFilters, setShowFilters] = useState(false);
  const [locationPreset, setLocationPreset] = useState<'wa-remote' | 'all'>('wa-remote');
  // Salary range (annual USD). null = no minimum; filter also keeps
  // listings with no salary data so we don't hide 99% of postings.
  const [minSalary, setMinSalary] = useState<number | null>(null);
  const [maxSalary, setMaxSalary] = useState<number | null>(null);
  const [salaryOnly, setSalaryOnly] = useState(false); // when true, hide listings without salary data
  // Selected level tier keys (e.g. "em1", "staff")
  const [selectedLevels, setSelectedLevels] = useState<string[]>([]);

  // When we load the user's preferences, default the level filter to
  // their onboarding-chosen levels (but allow them to override).
  const [levelsInitialized, setLevelsInitialized] = useState(false);

  // Expanded card
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Pagination
  const [page, setPage] = useState(1);
  const pageSize = 50;

  const loadListings = useCallback(async (refresh = false) => {
    if (refresh) setRefreshing(true);
    else setLoading(true);

    try {
      const url = refresh ? '/api/listings?refresh=true' : '/api/listings';
      const res = await fetch(url);
      const data = await res.json();
      // Defensive dedupe on the client in case the cached DB still contains
      // duplicate listings from an earlier fetch before the dedupe landed.
      const raw: JobListing[] = data.listings || [];
      const seen = new Set<string>();
      const deduped: JobListing[] = [];
      for (const l of raw) {
        if (seen.has(l.id)) continue;
        seen.add(l.id);
        deduped.push(l);
      }
      setAllListings(deduped);
      setLastFetched(data.lastFetchedAt);
      setFetchErrors(data.fetchErrors || []);

      // Stale data notification — user can click Refresh All to update
      // (no automatic background refresh)
    } catch {
      // keep existing listings on error
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  // Companies the user has explicitly chosen to hide (persisted in settings).
  // Seeded on first load from auto-detection of the resume's current employer.
  const [excludedCompanies, setExcludedCompanies] = useState<string[]>([]);
  const [excludeInitialized, setExcludeInitialized] = useState(false);
  const [autoDetected, setAutoDetected] = useState<string | null>(null);

  useEffect(() => {
    loadListings();
    fetch('/api/scores-cache').then(r => r.json()).then(setScoreCache).catch(() => {});
    fetch('/api/listing-flags').then(r => r.json()).then(setFlags).catch(() => {});
    fetch('/api/settings').then(r => r.json()).then((d: { settings: Settings }) => {
      if (!d.settings.onboardingComplete) {
        window.location.href = '/';
        return;
      }
      setPrefs(d.settings);
      // Seed filters from onboarding preferences (user can still override).
      if (!levelsInitialized) {
        if (d.settings.preferredLevels && d.settings.preferredLevels.length > 0) {
          setSelectedLevels(d.settings.preferredLevels);
        }
        if (d.settings.salaryMin != null) setMinSalary(d.settings.salaryMin);
        if (d.settings.salaryMax != null) setMaxSalary(d.settings.salaryMax);
        setLevelsInitialized(true);
      }
      // Seed excludedCompanies from settings; if empty, try to auto-detect
      // the current employer from the resume and persist it so it sticks.
      if (!excludeInitialized) {
        const saved = d.settings.excludedCompanies ?? [];
        const detected = detectCurrentCompany(d.settings.baseResumeText ?? null);
        setAutoDetected(detected);
        if (saved.length > 0) {
          setExcludedCompanies(saved);
        } else if (detected) {
          setExcludedCompanies([detected]);
          // Fire-and-forget persist so reloads remember the choice.
          fetch('/api/settings', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ excludedCompanies: [detected] }),
          }).catch(() => {});
        }
        setExcludeInitialized(true);
      }
    }).catch(() => {});
  }, [loadListings, levelsInitialized, excludeInitialized]);

  // Persist excludedCompanies whenever the user edits the list.
  const saveExcludedCompanies = useCallback((next: string[]) => {
    setExcludedCompanies(next);
    fetch('/api/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ excludedCompanies: next }),
    }).catch(() => {});
  }, []);

  // Full unique list of companies across all fetched listings, for
  // autocomplete in the ExcludedCompaniesBar. Needs to be a top-level
  // memo (not inline inside JSX) to keep hook order stable across renders.
  const allCompanyNames = useMemo(
    () => [...new Set(allListings.map((l) => l.company))].sort(),
    [allListings],
  );

  // Expand excluded canonical names to full alias sets (Amazon → Amazon+AWS+...).
  const excludedAliases = useMemo(() => {
    const set = new Set<string>();
    for (const name of excludedCompanies) {
      for (const a of getCompanyAliases(name)) set.add(a);
    }
    return Array.from(set);
  }, [excludedCompanies]);

  // Filter to relevant roles using user preferences (or fallback to EM
  // patterns), then drop anything from excluded employers.
  const listings = useMemo(() => {
    const roleMatched = filterByUserPreferences(allListings, prefs.preferredRoles ?? []);
    if (excludedAliases.length === 0) return roleMatched;
    return roleMatched.filter((l) => !isExcludedCompany(l.company, excludedAliases));
  }, [allListings, prefs.preferredRoles, excludedAliases]);

  // Count of listings hidden by the current-employer filter, for a small
  // info banner so the user understands what's being excluded.
  const excludedByEmployerCount = useMemo(() => {
    if (excludedAliases.length === 0) return 0;
    const roleMatched = filterByUserPreferences(allListings, prefs.preferredRoles ?? []);
    return roleMatched.filter((l) => isExcludedCompany(l.company, excludedAliases)).length;
  }, [allListings, prefs.preferredRoles, excludedAliases]);

  // Auto-score all matching listings in background batches
  useEffect(() => {
    if (listings.length === 0 || scoringRef.current) return;
    // Skip ATSs we can't score — their "No score" chip is a truthful terminal
    // state, not a prompt to retry on every page load.
    const unscoredIds = listings
      .filter((l) => !scoreCache[l.id] && !isUnscorableAts(l.ats))
      .map((l) => l.id);
    if (unscoredIds.length === 0) return;

    scoringRef.current = true;
    const CHUNK = 10;
    let scored = listings.length - unscoredIds.length;
    setScoringProgress({ scored, total: listings.length });

    (async () => {
      for (let i = 0; i < unscoredIds.length; i += CHUNK) {
        const chunk = unscoredIds.slice(i, i + CHUNK);
        try {
          const res = await fetch('/api/ats-score/batch', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ listingIds: chunk }),
          });
          const data = await res.json();
          if (data.error) break;
          if (data.scores) {
            setScoreCache(prev => {
              const next = { ...prev };
              for (const [id, s] of Object.entries(data.scores) as [string, { overall: number; matchedCount: number; totalCount: number }][]) {
                next[id] = { listingId: id, overall: s.overall, matchedCount: s.matchedCount, totalCount: s.totalCount, technical: 0, management: 0, domain: 0, soft: 0, scoredAt: '' } as ScoreCacheEntry;
              }
              return next;
            });
          }
          // Advance by the full chunk size — including any listings that
          // couldn't be scored — so the progress bar never stalls on
          // custom-ATS listings whose detail endpoints aren't available.
          scored += chunk.length;
          setScoringProgress({ scored, total: listings.length });
        } catch { break; }
      }
      setScoringProgress(null);
      scoringRef.current = false;
      fetch('/api/scores-cache').then(r => r.json()).then(setScoreCache).catch(() => {});
    })();
  }, [listings, scoreCache]);

  // Derive filter options
  const companies = useMemo(
    () => [...new Set(listings.map((l) => l.company))].sort(),
    [listings]
  );

  const departments = useMemo(() => {
    const deps = [...new Set(listings.map((l) => l.department).filter(Boolean))].sort();
    return deps.slice(0, 50);
  }, [listings]);

  // Count how many location-matching jobs there are (for badge)
  const waRemoteCount = useMemo(
    () => listings.filter(l => locationMatcher(l.location)).length,
    [listings, locationMatcher]
  );

  // Apply text search + dropdown filters + location preset
  const filtered = useMemo(() => {
    let result = listings;
    // Hide flagged listings by default — user can toggle them back in.
    if (!showFlagged) {
      result = result.filter((l) => !flags[l.id]);
    }
    if (search) {
      const q = search.toLowerCase();
      result = result.filter(
        (l) =>
          l.title.toLowerCase().includes(q) ||
          l.company.toLowerCase().includes(q) ||
          l.department.toLowerCase().includes(q) ||
          l.location.toLowerCase().includes(q)
      );
    }
    if (selectedCompany !== 'all') {
      result = result.filter((l) => l.company === selectedCompany);
    }
    if (locationPreset === 'wa-remote') {
      result = result.filter((l) => locationMatcher(l.location));
    }
    // Work-mode preference filter (remote / hybrid / onsite)
    if (prefs.workMode && prefs.workMode.length > 0) {
      result = result.filter((l) => matchesWorkMode(l.location, prefs.workMode!));
    }
    if (selectedDepartment !== 'all') {
      result = result.filter((l) => l.department === selectedDepartment);
    }
    // Salary filter — keep listings missing salary data unless salaryOnly is on.
    if (minSalary != null || maxSalary != null || salaryOnly) {
      result = result.filter((l) => {
        const hasSalary = l.salaryMin != null || l.salaryMax != null;
        if (!hasSalary) return !salaryOnly;
        // Listing's max should be >= user's min (if set)
        if (minSalary != null) {
          const top = l.salaryMax ?? l.salaryMin ?? 0;
          if (top < minSalary) return false;
        }
        // Listing's min should be <= user's max (if set)
        if (maxSalary != null) {
          const bottom = l.salaryMin ?? l.salaryMax ?? 0;
          if (bottom > maxSalary) return false;
        }
        return true;
      });
    }
    // Level filter
    if (selectedLevels.length > 0) {
      result = result.filter((l) => matchesLevelPreference(l.title, selectedLevels));
    }
    // Sort by score (highest first), then by date
    result = [...result].sort((a, b) => {
      const sa = scoreCache[a.id]?.overall ?? -1;
      const sb = scoreCache[b.id]?.overall ?? -1;
      if (sb !== sa) return sb - sa;
      return new Date(b.updatedAt || b.fetchedAt).getTime() - new Date(a.updatedAt || a.fetchedAt).getTime();
    });
    return result;
  }, [listings, search, selectedCompany, locationPreset, selectedDepartment, scoreCache, flags, showFlagged, locationMatcher, prefs.workMode, minSalary, maxSalary, salaryOnly, selectedLevels]);

  const flaggedCount = useMemo(
    () => listings.filter((l) => flags[l.id]).length,
    [listings, flags]
  );

  // Paginate
  const totalPages = Math.ceil(filtered.length / pageSize);
  const paginated = filtered.slice((page - 1) * pageSize, page * pageSize);

  // Reset page when filters change
  useEffect(() => { setPage(1); }, [search, selectedCompany, locationPreset, selectedDepartment, minSalary, maxSalary, salaryOnly, selectedLevels]);

  if (loading && allListings.length === 0) {
    return (
      <div className="p-8 flex flex-col items-center justify-center min-h-[60vh]">
        <Loader2 className="w-10 h-10 text-blue-500 animate-spin mb-4" />
        <h2 className="text-lg font-semibold text-gray-900 mb-2">Loading...</h2>
      </div>
    );
  }

  if (!loading && allListings.length === 0) {
    return (
      <div className="p-8 flex flex-col items-center justify-center min-h-[60vh]">
        <Globe className="w-14 h-14 text-gray-300 mb-4" />
        <h2 className="text-lg font-semibold text-gray-900 mb-2">No Job Listings Yet</h2>
        <p className="text-sm text-gray-500 mb-6 max-w-md text-center">
          Click below to search across 40+ company career pages and populate your listings based on your preferences.
        </p>
        <button
          onClick={() => loadListings(true)}
          disabled={refreshing}
          className="flex items-center gap-2 px-6 py-3 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
        >
          {refreshing ? (
            <><Loader2 className="w-4 h-4 animate-spin" /> Fetching Jobs...</>
          ) : (
            <><RefreshCw className="w-4 h-4" /> Fetch Job Listings</>
          )}
        </button>
      </div>
    );
  }

  return (
    <div className="p-8">
      <PageHeaderNav current="Job Listings" />
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Job Listings</h1>
          <p className="text-sm text-gray-500 mt-1">
            <span className="text-blue-600 font-medium">{listings.length} matching roles</span> from {allListings.length.toLocaleString()} total jobs across {new Set(allListings.map(l => l.company)).size} companies
            {lastFetched && (
              <span> &middot; Updated {new Date(lastFetched).toLocaleString()}</span>
            )}
          </p>
        </div>
        <button
          onClick={() => loadListings(true)}
          disabled={refreshing}
          className="flex items-center gap-2 px-4 py-2.5 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
        >
          <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
          {refreshing ? 'Refreshing...' : 'Refresh All'}
        </button>
      </div>

      {/* Excluded-companies editor (seeded from resume auto-detection). */}
      <ExcludedCompaniesBar
        excluded={excludedCompanies}
        onChange={saveExcludedCompanies}
        autoDetected={autoDetected}
        hiddenCount={excludedByEmployerCount}
        allCompanies={allCompanyNames}
      />

      {/* Scoring progress */}
      {scoringProgress && (
        <div className="mb-4 bg-blue-50 border border-blue-200 rounded-lg p-3">
          <div className="flex items-center gap-3 mb-1.5">
            <Target className="w-4 h-4 text-blue-500" />
            <span className="text-sm font-medium text-blue-800">
              Scoring resumes... {scoringProgress.scored}/{scoringProgress.total}
            </span>
            <Loader2 className="w-3.5 h-3.5 text-blue-500 animate-spin ml-auto" />
          </div>
          <div className="h-1.5 bg-blue-100 rounded-full overflow-hidden">
            <div
              className="h-full bg-blue-500 rounded-full transition-all duration-300"
              style={{ width: `${Math.round((scoringProgress.scored / scoringProgress.total) * 100)}%` }}
            />
          </div>
        </div>
      )}

      {/* Portal search links */}
      <div className="mb-6 bg-white rounded-xl border border-gray-200 p-4">
        <p className="text-xs text-gray-500 mb-2 font-medium uppercase tracking-wide">
          Search Job Portals Directly
        </p>
        <div className="flex gap-3">
          {PORTAL_SEARCH_LINKS.map((p) => (
            <a
              key={p.portal}
              href={p.searchUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium text-white transition-opacity hover:opacity-90"
              style={{ backgroundColor: p.color }}
            >
              <ExternalLink className="w-3.5 h-3.5" />
              {p.label}
            </a>
          ))}
        </div>
      </div>

      {/* Fetch errors */}
      {fetchErrors.length > 0 && (
        <div className="mb-4">
          <button
            onClick={() => setShowErrors(!showErrors)}
            className="flex items-center gap-2 text-sm text-amber-600 hover:text-amber-700"
          >
            <AlertCircle className="w-4 h-4" />
            {fetchErrors.length} companies could not be fetched
            {showErrors ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
          </button>
          {showErrors && (
            <div className="mt-2 p-3 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-700 space-y-1">
              {fetchErrors.map((e, i) => (
                <div key={i}>{e.company}: {e.error}</div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Search + Location preset + Filters */}
      <div className="mb-6 space-y-3">
        <div className="flex gap-3">
          <div className="flex-1 relative">
            <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by title, company, department, or location..."
              className="w-full pl-10 pr-4 py-2.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
            />
          </div>
          <button
            onClick={() => setShowFilters(!showFilters)}
            className={`flex items-center gap-2 px-4 py-2.5 border rounded-lg text-sm font-medium transition-colors ${
              showFilters ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-gray-300 text-gray-700 hover:bg-gray-50'
            }`}
          >
            <Filter className="w-4 h-4" />
            Filters
          </button>
        </div>

        {/* Location preset buttons */}
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-gray-500 mr-1">
            <MapPin className="w-3 h-3 inline -mt-0.5" /> Location:
          </span>
          <button
            onClick={() => setLocationPreset('wa-remote')}
            className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
              locationPreset === 'wa-remote'
                ? 'bg-blue-600 text-white'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            {prefs.preferredLocations && prefs.preferredLocations.length > 0
              ? `Preferred Locations (${waRemoteCount})`
              : `Washington & Remote (${waRemoteCount})`
            }
          </button>
          <button
            onClick={() => setLocationPreset('all')}
            className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
              locationPreset === 'all'
                ? 'bg-blue-600 text-white'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            All Locations ({listings.length})
          </button>
          {flaggedCount > 0 && (
            <button
              onClick={() => setShowFlagged((v) => !v)}
              className={`ml-auto flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                showFlagged
                  ? 'bg-gray-800 text-white'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
              title="Toggle visibility of listings flagged as Applied / Incorrect / Not Applicable"
            >
              {showFlagged ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />}
              {showFlagged ? 'Hide' : 'Show'} flagged ({flaggedCount})
            </button>
          )}
        </div>

        {showFilters && (
          <div className="p-4 bg-white border border-gray-200 rounded-lg space-y-4">
            <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Company</label>
              <select
                value={selectedCompany}
                onChange={(e) => setSelectedCompany(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
              >
                <option value="all">All Companies ({companies.length})</option>
                {companies.map((c) => {
                  // Count reflects ALL active filters (except company itself) so the
                  // number shown matches what the user actually sees after selecting.
                  const visibleCount = listings.filter((l) => {
                    if (l.company !== c) return false;
                    if (!showFlagged && flags[l.id]) return false;
                    if (locationPreset === 'wa-remote' && !locationMatcher(l.location)) return false;
                    if (prefs.workMode && prefs.workMode.length > 0 && !matchesWorkMode(l.location, prefs.workMode)) return false;
                    return true;
                  }).length;
                  const totalCount = listings.filter((l) => l.company === c).length;
                  // Always show the company in the dropdown; when filters hide all
                  // of its jobs we still list it (with "0 here / N total") so the
                  // user can see we searched it.
                  const label = visibleCount === totalCount
                    ? `${c} (${totalCount})`
                    : `${c} (${visibleCount} here / ${totalCount} total)`;
                  return (
                    <option key={c} value={c}>{label}</option>
                  );
                })}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Department</label>
              <select
                value={selectedDepartment}
                onChange={(e) => setSelectedDepartment(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
              >
                <option value="all">All Departments</option>
                {departments.map((d) => (
                  <option key={d} value={d}>{d}</option>
                ))}
              </select>
            </div>
            </div>

            {/* Salary range */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="block text-xs font-medium text-gray-500">
                  <DollarSign className="w-3 h-3 inline -mt-0.5" /> Salary Range (annual, USD)
                </label>
                <label className="flex items-center gap-1.5 text-xs text-gray-500 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={salaryOnly}
                    onChange={(e) => setSalaryOnly(e.target.checked)}
                    className="rounded"
                  />
                  Only show jobs with salary info
                </label>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-gray-400">Min $</span>
                  <input
                    type="number"
                    min="0"
                    step="5000"
                    value={minSalary ?? ''}
                    onChange={(e) => setMinSalary(e.target.value ? Number(e.target.value) : null)}
                    placeholder="e.g. 200000"
                    className="w-full pl-12 pr-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                  />
                </div>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-gray-400">Max $</span>
                  <input
                    type="number"
                    min="0"
                    step="5000"
                    value={maxSalary ?? ''}
                    onChange={(e) => setMaxSalary(e.target.value ? Number(e.target.value) : null)}
                    placeholder="e.g. 450000"
                    className="w-full pl-12 pr-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                  />
                </div>
              </div>
              {(minSalary != null || maxSalary != null) && (
                <button
                  onClick={() => { setMinSalary(null); setMaxSalary(null); }}
                  className="mt-1 text-xs text-blue-600 hover:text-blue-700"
                >
                  Clear salary filter
                </button>
              )}
            </div>

            {/* Level tier multi-select */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="block text-xs font-medium text-gray-500">
                  Desired Level
                </label>
                {selectedLevels.length > 0 && (
                  <button
                    onClick={() => setSelectedLevels([])}
                    className="text-xs text-blue-600 hover:text-blue-700"
                  >
                    Clear
                  </button>
                )}
              </div>
              <div className="flex flex-wrap gap-2">
                {LEVEL_TIERS.map((tier) => {
                  const selected = selectedLevels.includes(tier.key);
                  return (
                    <button
                      key={tier.key}
                      onClick={() => {
                        setSelectedLevels((prev) =>
                          prev.includes(tier.key)
                            ? prev.filter((k) => k !== tier.key)
                            : [...prev, tier.key],
                        );
                      }}
                      title={tier.examples}
                      className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                        selected
                          ? 'bg-blue-600 text-white'
                          : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                      }`}
                    >
                      {tier.label}
                    </button>
                  );
                })}
              </div>
              {selectedLevels.length > 0 && (
                <p className="text-xs text-gray-400 mt-1.5">
                  Showing listings matching any selected level. Titles with no clear level signal are included.
                </p>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Results count */}
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm text-gray-500">
          {filtered.length > 0 ? (
            <>Showing {((page - 1) * pageSize) + 1}-{Math.min(page * pageSize, filtered.length)} of {filtered.length.toLocaleString()} results</>
          ) : (
            <>No results</>
          )}
        </p>
        {refreshing && (
          <span className="flex items-center gap-1.5 text-xs text-blue-600">
            <Loader2 className="w-3 h-3 animate-spin" /> Refreshing in background...
          </span>
        )}
      </div>

      {/* Listings */}
      <div className="space-y-2">
        {paginated.map((listing) => (
          <ListingCard
            key={listing.id}
            listing={listing}
            score={scoreCache[listing.id]}
            flag={flags[listing.id]?.flag}
            onFlagChange={(f) => setFlagFor(listing.id, f)}
            isExpanded={expandedId === listing.id}
            onToggle={() => setExpandedId(expandedId === listing.id ? null : listing.id)}
          />
        ))}
      </div>

      {paginated.length === 0 && !loading && (() => {
        // If results are empty because the WA/Remote filter is hiding jobs for the
        // selected company/department, offer a one-click escape.
        const unfilteredByLocation = listings.filter((l) => {
          if (selectedCompany !== 'all' && l.company !== selectedCompany) return false;
          if (selectedDepartment !== 'all' && l.department !== selectedDepartment) return false;
          if (search) {
            const q = search.toLowerCase();
            if (
              !l.title.toLowerCase().includes(q) &&
              !l.company.toLowerCase().includes(q) &&
              !l.department.toLowerCase().includes(q) &&
              !l.location.toLowerCase().includes(q)
            ) return false;
          }
          return true;
        });
        const hiddenByLocation = locationPreset === 'wa-remote' && unfilteredByLocation.length > 0;

        return (
          <div className="text-center py-12 bg-white rounded-xl border border-gray-200">
            <Search className="w-10 h-10 text-gray-300 mx-auto mb-3" />
            <p className="text-gray-500 mb-3">No jobs match your filters.</p>
            {hiddenByLocation && (
              <div className="text-sm text-gray-600">
                <p className="mb-2">
                  {unfilteredByLocation.length} matching {unfilteredByLocation.length === 1 ? 'job is' : 'jobs are'} hidden by the <b>Preferred Locations</b> filter.
                </p>
                <button
                  onClick={() => setLocationPreset('all')}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white text-xs font-medium rounded-lg hover:bg-blue-700"
                >
                  Show all locations
                </button>
              </div>
            )}
          </div>
        );
      })()}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 mt-8">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page === 1}
            className="px-3 py-2 text-sm font-medium border border-gray-300 rounded-lg disabled:opacity-40 hover:bg-gray-50"
          >
            Previous
          </button>
          <span className="text-sm text-gray-500 px-3">
            Page {page} of {totalPages}
          </span>
          <button
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page === totalPages}
            className="px-3 py-2 text-sm font-medium border border-gray-300 rounded-lg disabled:opacity-40 hover:bg-gray-50"
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Helpers ────────────────────────────────────────────────────────

function scoreColor(score: number): string {
  if (score >= 75) return 'text-green-600 bg-green-50 border-green-200';
  if (score >= 50) return 'text-yellow-600 bg-yellow-50 border-yellow-200';
  return 'text-red-500 bg-red-50 border-red-200';
}

// ─── Expandable Listing Card ────────────────────────────────────────

function ListingCard({
  listing,
  score,
  flag,
  onFlagChange,
  isExpanded,
  onToggle,
}: {
  listing: JobListing;
  score?: ScoreCacheEntry;
  flag?: ListingFlag;
  onFlagChange: (flag: ListingFlag | null) => void;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  const [flagMenuOpen, setFlagMenuOpen] = useState(false);
  const flagMeta = flag ? LISTING_FLAGS.find((f) => f.key === flag) : null;
  const posted = listing.postedAt
    ? new Date(listing.postedAt).toLocaleDateString()
    : null;

  // Detailed score (fetched on expand)
  const [detailScore, setDetailScore] = useState<ATSScore | null>(null);
  const [loadingScore, setLoadingScore] = useState(false);
  const [scoreError, setScoreError] = useState<string | null>(null);

  // Tailor state
  const [tailorResult, setTailorResult] = useState<TailorResult | null>(null);
  const [tailoring, setTailoring] = useState(false);
  const [tailorError, setTailorError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);

  // Keyword selection state — all selected by default
  const [selectedKeywords, setSelectedKeywords] = useState<Set<string>>(new Set());
  const [keywordsInitialized, setKeywordsInitialized] = useState(false);

  // Initialize selected keywords when score loads
  useEffect(() => {
    if (detailScore && !keywordsInitialized) {
      setSelectedKeywords(new Set(detailScore.missingKeywords));
      setKeywordsInitialized(true);
    }
  }, [detailScore, keywordsInitialized]);

  function toggleKeyword(keyword: string) {
    setSelectedKeywords(prev => {
      const next = new Set(prev);
      if (next.has(keyword)) next.delete(keyword);
      else next.add(keyword);
      return next;
    });
  }

  // Fetch detailed score when expanded
  useEffect(() => {
    if (isExpanded && !detailScore && !loadingScore && !scoreError) {
      setLoadingScore(true);
      fetch('/api/ats-score', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ listingId: listing.id }),
      })
        .then(r => r.json())
        .then(data => {
          if (data.error) setScoreError(data.error);
          else setDetailScore(data);
        })
        .catch(() => setScoreError('Failed to load score'))
        .finally(() => setLoadingScore(false));
    }
  }, [isExpanded, detailScore, loadingScore, scoreError, listing.id]);

  async function handleTailor() {
    setTailoring(true);
    setTailorError(null);
    try {
      const res = await fetch('/api/tailor-resume', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          listingId: listing.id,
          format: 'json',
          selectedKeywords: Array.from(selectedKeywords),
        }),
      });
      const data = await res.json();
      if (data.error) setTailorError(data.error);
      else setTailorResult(data);
    } catch {
      setTailorError('Failed to tailor resume');
    } finally {
      setTailoring(false);
    }
  }

  async function handleDownload() {
    setDownloading(true);
    try {
      const res = await fetch('/api/tailor-resume', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          listingId: listing.id,
          format: 'pdf',
          selectedKeywords: Array.from(selectedKeywords),
        }),
      });
      const blob = await res.blob();
      const disposition = res.headers.get('Content-Disposition') || '';
      const match = disposition.match(/filename="(.+?)"/);
      const filename = match?.[1] || 'tailored_resume.pdf';

      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      setTailorError('Failed to download resume');
    } finally {
      setDownloading(false);
    }
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 hover:border-blue-300 hover:shadow-sm transition-all">
      {/* Collapsed header — always visible.
          Using a div (not a button) because we need nested interactive controls
          (flag menu, chevron button) which aren't allowed inside <button>. */}
      <div
        onClick={onToggle}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onToggle();
          }
        }}
        className="w-full text-left p-5 cursor-pointer"
      >
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <h3 className="font-semibold text-gray-900 truncate text-base">{listing.title}</h3>
            </div>
            <div className="flex items-center gap-2 mb-2">
              <Building2 className="w-3.5 h-3.5 text-gray-400 shrink-0" />
              <span className="text-sm font-medium text-gray-700">{listing.company}</span>
              {listing.department && (
                <span className="text-xs text-gray-400">&middot; {listing.department}</span>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-3 text-xs text-gray-400">
              {listing.location && listing.location !== 'Not specified' && (
                <span className="flex items-center gap-1">
                  <MapPin className="w-3 h-3" />
                  {listing.location}
                </span>
              )}
              {listing.salary && (
                <span className="flex items-center gap-1 text-green-600 font-medium">
                  <DollarSign className="w-3 h-3" />
                  {listing.salary}
                </span>
              )}
              {posted && (
                <span className="flex items-center gap-1">
                  <Calendar className="w-3 h-3" />
                  {posted}
                </span>
              )}
              <span className="flex items-center gap-1">
                <ExternalLink className="w-3 h-3" />
                {ATS_LABELS[listing.ats] || listing.ats}
              </span>
            </div>
          </div>
          <div
            className="shrink-0 flex items-center gap-3"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Flag menu */}
            <div className="relative">
              {flagMeta ? (
                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault();
                    setFlagMenuOpen((v) => !v);
                  }}
                  className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium text-white hover:opacity-90"
                  style={{ backgroundColor: flagMeta.color }}
                  title={`Flagged: ${flagMeta.label}. Click to change.`}
                >
                  <Tag className="w-3 h-3" />
                  {flagMeta.short}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault();
                    setFlagMenuOpen((v) => !v);
                  }}
                  className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium text-gray-500 border border-gray-200 hover:bg-gray-50"
                  title="Flag this listing"
                >
                  <Tag className="w-3 h-3" />
                  Flag
                </button>
              )}

              {flagMenuOpen && (
                <>
                  {/* click-away overlay */}
                  <div
                    className="fixed inset-0 z-40"
                    onClick={(e) => {
                      e.preventDefault();
                      setFlagMenuOpen(false);
                    }}
                  />
                  <div className="absolute right-0 top-full mt-1 w-44 bg-white border border-gray-200 rounded-lg shadow-lg z-50 py-1 text-left">
                    {LISTING_FLAGS.map((f) => (
                      <button
                        key={f.key}
                        type="button"
                        onClick={(e) => {
                          e.preventDefault();
                          onFlagChange(f.key);
                          setFlagMenuOpen(false);
                        }}
                        className={`flex items-center gap-2 w-full px-3 py-1.5 text-xs hover:bg-gray-50 ${
                          flag === f.key ? 'bg-gray-50 font-medium' : ''
                        }`}
                      >
                        <span
                          className="w-2 h-2 rounded-full"
                          style={{ backgroundColor: f.color }}
                        />
                        {f.label}
                      </button>
                    ))}
                    {flag && (
                      <>
                        <div className="border-t border-gray-100 my-1" />
                        <button
                          type="button"
                          onClick={(e) => {
                            e.preventDefault();
                            onFlagChange(null);
                            setFlagMenuOpen(false);
                          }}
                          className="flex items-center gap-2 w-full px-3 py-1.5 text-xs text-gray-500 hover:bg-gray-50"
                        >
                          <XCircle className="w-3 h-3" />
                          Clear flag
                        </button>
                      </>
                    )}
                  </div>
                </>
              )}
            </div>

            {isUnscorableAts(listing.ats) ? (
              <span
                className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-50 text-gray-400 border border-gray-200"
                title="This company's careers API doesn't expose full job descriptions, so we can't score it."
              >
                N/A
              </span>
            ) : score && score.totalCount > 0 ? (
              <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-sm font-bold border ${scoreColor(score.overall)}`}>
                {score.overall}%
              </span>
            ) : score && score.totalCount === 0 ? (
              <span
                className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-50 text-gray-400 border border-gray-200"
                title="No public job description available — we couldn't score this listing."
              >
                N/A
              </span>
            ) : (
              <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-50 text-gray-400 border border-gray-200">
                No score
              </span>
            )}
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                onToggle();
              }}
              className="p-1 hover:bg-gray-100 rounded"
              aria-label={isExpanded ? 'Collapse' : 'Expand'}
            >
              {isExpanded ? (
                <ChevronUp className="w-4 h-4 text-gray-400" />
              ) : (
                <ChevronDown className="w-4 h-4 text-gray-400" />
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Expanded panel */}
      {isExpanded && (
        <div className="border-t border-gray-100 px-5 pb-5 pt-4 space-y-5">
          {/* Action links */}
          <div className="flex gap-3">
            <a
              href={listing.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors"
            >
              <ExternalLink className="w-4 h-4" /> Apply on {listing.company}
            </a>
            <Link
              href={`/listings/${listing.id}`}
              className="inline-flex items-center gap-2 px-4 py-2 border border-gray-300 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-50 transition-colors"
            >
              <FileText className="w-4 h-4" /> View Full Details
            </Link>
          </div>

          {/* ATS Score Detail */}
          <section className="bg-gray-50 rounded-lg p-4">
            <div className="flex items-center gap-2 mb-3">
              <Target className="w-4 h-4 text-blue-500" />
              <h4 className="text-sm font-semibold text-gray-900">ATS Match Score</h4>
            </div>

            {loadingScore && (
              <div className="flex items-center gap-3 py-4 justify-center">
                <Loader2 className="w-4 h-4 text-blue-500 animate-spin" />
                <span className="text-sm text-gray-500">Analyzing resume...</span>
              </div>
            )}

            {scoreError && (
              <div className="flex items-start gap-3 p-3 bg-amber-50 border border-amber-200 rounded-lg">
                <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
                <p className="text-sm text-amber-800">{scoreError}</p>
              </div>
            )}

            {detailScore && (
              <div>
                <div className="flex items-start gap-6 mb-4">
                  <ScoreRing score={detailScore.overall} size={90} label="Overall" />
                  <div className="flex-1 space-y-2 pt-1">
                    <CategoryBar label="Technical" score={detailScore.technical} />
                    <CategoryBar label="Management" score={detailScore.management} />
                    <CategoryBar label="Domain" score={detailScore.domain} />
                    <CategoryBar label="Soft Skills" score={detailScore.soft} />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div className="p-3 bg-green-50 rounded-lg border border-green-100">
                    <div className="flex items-center gap-1.5 mb-1.5">
                      <CheckCircle2 className="w-3.5 h-3.5 text-green-500" />
                      <span className="font-medium text-green-800 text-xs">Matched ({detailScore.totalMatched})</span>
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {detailScore.matchedKeywords.slice(0, 15).map((k) => (
                        <span key={k} className="px-1.5 py-0.5 bg-green-100 text-green-700 rounded text-xs">{k}</span>
                      ))}
                      {detailScore.matchedKeywords.length > 15 && (
                        <span className="text-xs text-green-600">+{detailScore.matchedKeywords.length - 15} more</span>
                      )}
                    </div>
                  </div>
                  <div className="p-3 bg-red-50 rounded-lg border border-red-100">
                    <div className="flex items-center justify-between mb-1.5">
                      <div className="flex items-center gap-1.5">
                        <XCircle className="w-3.5 h-3.5 text-red-400" />
                        <span className="font-medium text-red-800 text-xs">Missing ({detailScore.missingKeywords.length})</span>
                      </div>
                      {!tailorResult && (
                        <span className="text-xs text-gray-400">Click to select/deselect</span>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {detailScore.missingKeywords.map((k) => {
                        const isSelected = selectedKeywords.has(k);
                        return (
                          <button
                            key={k}
                            onClick={() => !tailorResult && toggleKeyword(k)}
                            disabled={!!tailorResult}
                            className={`px-1.5 py-0.5 rounded text-xs transition-colors ${
                              tailorResult
                                ? 'bg-red-100 text-red-700 cursor-default'
                                : isSelected
                                  ? 'bg-red-200 text-red-800 ring-1 ring-red-400 font-medium cursor-pointer hover:bg-red-300'
                                  : 'bg-gray-100 text-gray-400 line-through cursor-pointer hover:bg-gray-200'
                            }`}
                          >
                            {k}
                          </button>
                        );
                      })}
                    </div>
                    {!tailorResult && selectedKeywords.size < detailScore.missingKeywords.length && (
                      <p className="text-xs text-gray-400 mt-1.5">
                        {selectedKeywords.size} of {detailScore.missingKeywords.length} keywords selected for tailoring
                      </p>
                    )}
                  </div>
                </div>
              </div>
            )}
          </section>

          {/* Resume Tailor section */}
          <section className="bg-gray-50 rounded-lg p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <FileText className="w-4 h-4 text-purple-500" />
                <h4 className="text-sm font-semibold text-gray-900">Resume Tailor</h4>
              </div>
              {!tailorResult && (
                <button
                  onClick={handleTailor}
                  disabled={tailoring || !detailScore}
                  className="flex items-center gap-2 px-3 py-1.5 bg-purple-600 text-white text-xs font-medium rounded-lg hover:bg-purple-700 disabled:opacity-50 transition-colors"
                >
                  {tailoring ? (
                    <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Tailoring...</>
                  ) : (
                    <><FileText className="w-3.5 h-3.5" /> Tailor My Resume</>
                  )}
                </button>
              )}
            </div>

            {!detailScore && !loadingScore && !scoreError && (
              <p className="text-xs text-gray-400">Waiting for score analysis...</p>
            )}

            {detailScore && !tailorResult && !tailoring && !tailorError && (
              <p className="text-xs text-gray-500">
                Click &ldquo;Tailor My Resume&rdquo; to optimize keywords for this role. No false info added.
              </p>
            )}

            {tailorError && (
              <div className="flex items-start gap-2 p-3 bg-amber-50 border border-amber-200 rounded-lg">
                <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
                <p className="text-xs text-amber-800">{tailorError}</p>
              </div>
            )}

            {tailorResult && (
              <div className="space-y-3">
                {/* Score improvement */}
                <div className="flex items-center gap-4 p-3 bg-gradient-to-r from-purple-50 to-blue-50 rounded-lg border border-purple-100">
                  <div className="text-center">
                    <div className="text-lg font-bold text-gray-400">{tailorResult.originalScore.overall}%</div>
                    <div className="text-xs text-gray-400">Before</div>
                  </div>
                  <div className="text-lg text-gray-300">&rarr;</div>
                  <div className="text-center">
                    <div className="text-lg font-bold text-green-600">{tailorResult.tailoredScore.overall}%</div>
                    <div className="text-xs text-green-600">After</div>
                  </div>
                  <div className="text-center ml-auto">
                    <div className="text-lg font-bold text-blue-600">
                      +{tailorResult.tailoredScore.overall - tailorResult.originalScore.overall}%
                    </div>
                    <div className="text-xs text-blue-600">Improvement</div>
                  </div>
                </div>

                {/* Changes summary */}
                <div>
                  <h5 className="text-xs font-medium text-gray-700 mb-1.5">Changes Made</h5>
                  <ul className="space-y-1">
                    {tailorResult.changesSummary.map((c, i) => (
                      <li key={i} className="text-xs text-gray-600 flex gap-1.5">
                        <CheckCircle2 className="w-3.5 h-3.5 text-green-500 shrink-0 mt-0.5" />
                        {c}
                      </li>
                    ))}
                  </ul>
                </div>

                {/* Added keywords */}
                {tailorResult.addedKeywords.length > 0 && (
                  <div>
                    <h5 className="text-xs font-medium text-gray-700 mb-1.5">Keywords Added</h5>
                    <div className="flex flex-wrap gap-1">
                      {tailorResult.addedKeywords.map((k) => (
                        <span key={k} className="px-1.5 py-0.5 bg-purple-100 text-purple-700 rounded text-xs font-medium">{k}</span>
                      ))}
                    </div>
                  </div>
                )}

                {/* Download button */}
                <button
                  onClick={handleDownload}
                  disabled={downloading}
                  className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700 disabled:opacity-50 transition-colors w-full justify-center"
                >
                  {downloading ? (
                    <><Loader2 className="w-4 h-4 animate-spin" /> Generating PDF...</>
                  ) : (
                    <><Download className="w-4 h-4" /> Download Tailored Resume (PDF)</>
                  )}
                </button>
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  );
}

// ─── Excluded Companies Editor ──────────────────────────────────────
// Lets the user curate which companies are hidden from the listings page.
// Auto-seeded from resume detection; changes persist to settings.

function ExcludedCompaniesBar({
  excluded,
  onChange,
  autoDetected,
  hiddenCount,
  allCompanies,
}: {
  excluded: string[];
  onChange: (next: string[]) => void;
  autoDetected: string | null;
  hiddenCount: number;
  allCompanies: string[];
}) {
  const [input, setInput] = useState('');
  const [showSuggestions, setShowSuggestions] = useState(false);

  const suggestions = useMemo(() => {
    const q = input.trim().toLowerCase();
    if (!q) return [];
    return allCompanies
      .filter((c) => c.toLowerCase().includes(q) && !excluded.some((e) => e.toLowerCase() === c.toLowerCase()))
      .slice(0, 6);
  }, [input, allCompanies, excluded]);

  function add(name: string) {
    const trimmed = name.trim();
    if (!trimmed) return;
    if (excluded.some((e) => e.toLowerCase() === trimmed.toLowerCase())) return;
    onChange([...excluded, trimmed]);
    setInput('');
    setShowSuggestions(false);
  }
  function remove(name: string) {
    onChange(excluded.filter((e) => e.toLowerCase() !== name.toLowerCase()));
  }

  return (
    <div className="mb-4 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2.5">
      <div className="flex items-center gap-2 flex-wrap">
        <EyeOff className="w-3.5 h-3.5 text-gray-400 shrink-0" />
        <span className="text-xs font-medium text-gray-600 shrink-0">
          Excluded companies
          {hiddenCount > 0 && (
            <span className="text-gray-400 font-normal"> · hiding {hiddenCount}</span>
          )}
          :
        </span>
        {excluded.length === 0 && (
          <span className="text-xs text-gray-400 italic">
            {autoDetected ? `None — detected ${autoDetected}` : 'None'}
          </span>
        )}
        {excluded.map((name) => (
          <span
            key={name}
            className="inline-flex items-center gap-1 px-2 py-0.5 bg-white border border-gray-300 rounded-full text-xs text-gray-700"
          >
            {name}
            {autoDetected && name.toLowerCase() === autoDetected.toLowerCase() && (
              <span className="text-[10px] text-gray-400">(auto)</span>
            )}
            <button
              type="button"
              onClick={() => remove(name)}
              className="text-gray-400 hover:text-red-500"
              aria-label={`Remove ${name}`}
            >
              <XCircle className="w-3 h-3" />
            </button>
          </span>
        ))}
        <div className="relative flex-1 min-w-[160px]">
          <input
            type="text"
            value={input}
            onChange={(e) => {
              setInput(e.target.value);
              setShowSuggestions(true);
            }}
            onFocus={() => setShowSuggestions(true)}
            onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                if (suggestions.length > 0) add(suggestions[0]);
                else if (input.trim()) add(input);
              }
            }}
            placeholder="Add company to hide…"
            className="w-full px-2 py-1 text-xs bg-white border border-gray-300 rounded focus:ring-1 focus:ring-blue-500 focus:border-blue-500 outline-none"
          />
          {showSuggestions && suggestions.length > 0 && (
            <div className="absolute left-0 top-full mt-1 w-full bg-white border border-gray-200 rounded-md shadow-lg z-20 max-h-48 overflow-y-auto">
              {suggestions.map((s) => (
                <button
                  key={s}
                  type="button"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    add(s);
                  }}
                  className="block w-full text-left px-2 py-1 text-xs text-gray-700 hover:bg-blue-50"
                >
                  {s}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
