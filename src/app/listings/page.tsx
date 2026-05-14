'use client';

import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import {
  Search, RefreshCw, MapPin, Calendar, Building2, ExternalLink,
  DollarSign, Filter, ChevronDown, ChevronUp, ChevronRight, Loader2, AlertCircle,
  Target, Download, FileText, AlertTriangle, CheckCircle2, XCircle,
  Tag, EyeOff, Eye, Globe, Sparkles, Check, Users, NotebookPen,
} from 'lucide-react';
import type { JobListing, ScoreCacheEntry, ListingFlag, ListingFlagEntry, Settings, WorkMode } from '@/lib/types';
import { LISTING_FLAGS, LEVEL_TIERS } from '@/lib/types';
import { CompanyLogo } from '@/components/company-logo';
import { Button, Card, Chip } from '@heroui/react';
import { filterByUserPreferences } from '@/lib/role-filter';
import { isWorkAuthorized } from '@/lib/work-auth-filter';
import { matchesLevelPreference } from '@/lib/level-matcher';
import {
  detectCurrentCompany,
  getCompanyAliases,
  isExcludedCompany,
} from '@/lib/current-company';
import { isUnscorableAts } from '@/lib/scorable';
import { buildLocationMatcher } from '@/lib/location-match';

const ATS_LABELS: Record<string, string> = {
  greenhouse: 'Greenhouse',
  lever: 'Lever',
  ashby: 'Ashby',
};

// ─── Posted-date helpers ────────────────────────────────────────────

/**
 * Format an ISO timestamp as a human-friendly relative string.
 * Examples: "today", "yesterday", "3 days ago", "2 weeks ago", "Mar 4".
 * Returns null if the input is null/undefined/invalid.
 */
function formatPostedDate(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  if (isNaN(ms)) return null;
  const diffMs = Date.now() - ms;
  const day = 24 * 60 * 60 * 1000;
  const days = Math.floor(diffMs / day);
  if (days < 0) return new Date(ms).toLocaleDateString();
  if (days === 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days} days ago`;
  if (days < 14) return '1 week ago';
  if (days < 30) return `${Math.floor(days / 7)} weeks ago`;
  if (days < 60) return '1 month ago';
  if (days < 365) return `${Math.floor(days / 30)} months ago`;
  return new Date(ms).toLocaleDateString();
}

/**
 * Returns true if the listing was posted (or, when the posting date is
 * unknown, fetched into the system) within the last 72 hours (3 days).
 * Used to render the "New" badge. Bumped from 48h because most job
 * boards don't update postedAt for ~24h after publication, so the
 * old 48h window was effectively a 24h "freshly-fetched" window.
 */
function isRecentlyPosted(listing: { postedAt: string | null; fetchedAt: string }): boolean {
  const ref = listing.postedAt || listing.fetchedAt;
  const ms = Date.parse(ref);
  if (isNaN(ms)) return false;
  return Date.now() - ms < 72 * 60 * 60 * 1000;
}

// ─── Location matching (preference-driven) ──────────────────────────
// Replaced the old substring-pattern matcher with the synonym-aware
// one in `src/lib/location-match.ts`. That module handles US country
// aliases (US / USA / U.S. / United States), airport codes (SEA /
// SFO / NYC), state-code↔name normalization, and the
// remote-friendly fallback that combines workMode + workAuthCountries.

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
      {label && <span className="text-xs text-slate-500 mt-1">{label}</span>}
    </div>
  );
}

function CategoryBar({ label, score }: { label: string; score: number }) {
  const color = score >= 75 ? "bg-gradient-to-r from-emerald-500 to-teal-500" : score >= 50 ? "bg-gradient-to-r from-amber-400 to-orange-400" : "bg-gradient-to-r from-rose-400 to-pink-400";
  return (
    <div className="flex items-center gap-3">
      <span className="text-xs text-slate-500 w-24 text-right">{label}</span>
      <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden">
        <div className={`h-full rounded-full transition-all duration-700 ${color}`} style={{ width: `${score}%` }} />
      </div>
      <span className="text-xs font-semibold text-slate-700 w-10">{score}%</span>
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
  /** Tailoring suggestions returned alongside the score (server-side
   *  heuristic detector). Each can be toggled and round-tripped to the
   *  tailor route as `selectedSuggestions: string[]`. */
  suggestions?: { id: string; kind: string; label: string; description: string }[];
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
  // System-dependency health (most importantly LibreOffice — without
  // soffice on PATH the tailor route fails late with a confusing
  // ENOENT). We probe `/api/health` on mount and surface an actionable
  // banner BEFORE the user clicks Tailor and hits a wall.
  const [health, setHealth] = useState<{
    libreoffice: { ok: boolean; version?: string; error?: string };
    platform: string;
  } | null>(null);
  const [healthDismissed, setHealthDismissed] = useState(false);
  // Score-version migration. When the scorer algorithm bumps (we did
  // v2 → v3 to add JD-bigram scoring), the /api/scores-cache route
  // hides v2 entries from the client; the auto-scorer effect then
  // recomputes them. We surface a one-time banner explaining what's
  // happening so users don't think their scores got reset randomly.
  const [staleScoreCount, setStaleScoreCount] = useState(0);
  // Compare selection — up to 3 listings can be ticked at once. The
  // floating Compare button at the bottom-right opens /compare with
  // the selected ids in the query string.
  const [compareIds, setCompareIds] = useState<string[]>([]);
  // Bulk-selection state — orthogonal to compare. When non-empty, a
  // floating action bar at the bottom of the listings page surfaces
  // bulk flag / clear-flag / archive operations. Reusing the existing
  // listing-flag store as the back-end so bulk archive ===
  // bulk-set-flag('not-applicable') and bulk-clear === clear-flag.
  const [bulkSelectedIds, setBulkSelectedIds] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState<null | ListingFlag | 'clear'>(null);
  const toggleBulk = useCallback((listingId: string) => {
    setBulkSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(listingId)) next.delete(listingId);
      else next.add(listingId);
      return next;
    });
  }, []);
  const clearBulk = useCallback(() => setBulkSelectedIds(new Set()), []);
  const toggleCompare = useCallback((listingId: string) => {
    setCompareIds((prev) => {
      if (prev.includes(listingId)) return prev.filter((x) => x !== listingId);
      if (prev.length >= 3) return prev; // cap; UI should disable add at 3
      return [...prev, listingId];
    });
  }, []);
  // Streaming refresh progress (SSE-driven). Mirrors the onboarding
  // wizard's fetch flow — discovers ALL companies, then pulls listings
  // from each one in parallel batches, all in the background while the
  // user can keep browsing the existing data.
  const [refreshProgress, setRefreshProgress] = useState<{
    completed: number;
    total: number;
    currentCompany: string | null;
    totalJobsSoFar: number;
    failed: number;
  } | null>(null);
  const [lastFetched, setLastFetched] = useState<string | null>(null);
  const [fetchErrors, setFetchErrors] = useState<{ company: string; error: string }[]>([]);
  const [showErrors, setShowErrors] = useState(false);
  const [scoreCache, setScoreCache] = useState<Record<string, ScoreCacheEntry>>({});
  const [scoringProgress, setScoringProgress] = useState<{ scored: number; total: number } | null>(null);
  const scoringRef = useRef(false);

  // User preferences
  const [prefs, setPrefs] = useState<Partial<Settings>>({});
  const locationMatcher = useMemo(
    () => buildLocationMatcher({
      preferredLocations: prefs.preferredLocations ?? [],
      workModes: prefs.workMode ?? [],
      workAuthCountries: prefs.workAuthCountries ?? ['US'],
    }),
    [prefs.preferredLocations, prefs.workMode, prefs.workAuthCountries],
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
  // Full-text search across cached JD bodies. When enabled, the
  // listings page also surfaces matches found inside job-description
  // text on top of the existing title/company/department/location
  // search. Implemented as a server-side endpoint that walks the
  // on-disk cache (data/listing-details/*.html); coverage is
  // partial because not every listing has been opened yet. The
  // listings page surfaces "matches in N of M cached JDs" so the
  // user understands the coverage limit.
  const [searchInJd, setSearchInJd] = useState(false);
  // Set of listing IDs whose cached JD body matches the current
  // search query. Refreshed via /api/search/jd whenever the query
  // OR the toggle changes. Null = "no JD search active".
  const [jdMatchIds, setJdMatchIds] = useState<Set<string> | null>(null);
  const [jdSearchMeta, setJdSearchMeta] = useState<{ matched: number; cached: number } | null>(null);
  const [selectedCompany, setSelectedCompany] = useState<string>('all');
  const [selectedDepartment, setSelectedDepartment] = useState<string>('all');
  const [showFilters, setShowFilters] = useState(false);
  const [locationPreset, setLocationPreset] = useState<'wa-remote' | 'all'>('wa-remote');
  // Salary range (annual USD). null = no minimum; filter also keeps
  // listings with no salary data so we don't hide 99% of postings.
  const [minSalary, setMinSalary] = useState<number | null>(null);
  const [maxSalary, setMaxSalary] = useState<number | null>(null);
  const [salaryOnly, setSalaryOnly] = useState(false); // when true, hide listings without salary data
  // Hide listings older than ~30 days. Many career boards leave dead
  // postings up for months — those are noise once a user has skimmed
  // through them. Default off so first-time users see everything;
  // power users typically toggle on after their first refresh cycle.
  const [hideStale, setHideStale] = useState(false);
  // Date-posted filter — keeps listings whose `postedAt` falls within
  // the selected window. 'all' is a no-op (default). Listings without
  // a postedAt fall back to fetchedAt so manually-added entries still
  // appear under "today"/"this week". The window thresholds are in
  // milliseconds and resolved against `Date.now()` at filter time.
  type DatePreset = 'all' | 'today' | '1d' | '2d' | 'week' | 'month';
  const [datePosted, setDatePosted] = useState<DatePreset>('all');
  // Score-range filter — drops listings whose ATS score isn't within
  // the picked window. Default 0-100 (no-op). Only listings WITH a
  // valid score are gated by the upper bound.
  const [minScore, setMinScore] = useState(0);
  const [maxScore, setMaxScore] = useState(100);
  // Saved filter presets — localStorage-backed, user-named snapshots
  // of every meaningful filter on this page. Useful for the user
  // who wants to switch between "EM Seattle ≥70%" and "Staff IC
  // remote ≥80%" without re-typing the same set every time.
  interface FilterPreset {
    name: string;
    search: string;
    selectedCompany: string;
    selectedDepartment: string;
    locationPreset: 'wa-remote' | 'all';
    minSalary: number | null;
    maxSalary: number | null;
    salaryOnly: boolean;
    selectedLevels: string[];
    hideStale: boolean;
    minScore: number;
    maxScore: number;
  }
  const [presets, setPresets] = useState<FilterPreset[]>([]);
  useEffect(() => {
    try {
      const raw = localStorage.getItem('listings-filter-presets');
      if (raw) setPresets(JSON.parse(raw));
    } catch {
      // bad JSON — ignore, treat as empty
    }
  }, []);
  const persistPresets = useCallback((next: FilterPreset[]) => {
    setPresets(next);
    try {
      localStorage.setItem('listings-filter-presets', JSON.stringify(next));
    } catch {
      // localStorage may be disabled — silent fallback to in-memory.
    }
  }, []);
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

  const loadListings = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/listings');
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
    } catch {
      // keep existing listings on error
    } finally {
      setLoading(false);
    }
  }, []);

  /**
   * Streaming refresh — same flow as the onboarding wizard.
   * Re-discovers ALL configured companies, then for each one pulls every
   * listing they currently have open. Progress events stream back over
   * Server-Sent Events so the UI shows live "X / Y companies, Z jobs"
   * while the user can keep browsing the existing dataset.
   *
   * Once the SSE stream completes, we re-fetch the cache and the scores
   * cache so the listings table picks up newly discovered jobs and any
   * background ATS rescoring.
   */
  const streamingRefresh = useCallback(() => {
    if (refreshing) return;
    setRefreshing(true);
    setRefreshProgress({
      completed: 0,
      total: 0,
      currentCompany: null,
      totalJobsSoFar: 0,
      failed: 0,
    });

    const evt = new EventSource('/api/listings/fetch-stream');
    let failed = 0;

    evt.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        if (data.type === 'start') {
          setRefreshProgress((p) => p && { ...p, total: data.total });
        } else if (data.type === 'progress') {
          if (data.status === 'error') failed++;
          setRefreshProgress((p) =>
            p && {
              ...p,
              completed: data.completed,
              currentCompany: data.company,
              totalJobsSoFar: data.totalJobsSoFar,
              failed,
            }
          );
        } else if (data.type === 'complete') {
          evt.close();
          // Pull fresh listings + scores into the page state so
          // newly-fetched jobs show immediately without a hard reload.
          loadListings();
          fetch('/api/scores-cache')
            .then((r) => r.json())
            .then(setScoreCache)
            .catch(() => {});
          // Hide the progress card a moment after completion so the
          // "all done" state is briefly visible.
          setTimeout(() => {
            setRefreshing(false);
            setRefreshProgress(null);
          }, 1200);
        }
      } catch {
        // Ignore malformed SSE frames.
      }
    };

    evt.onerror = () => {
      evt.close();
      setRefreshing(false);
      setRefreshProgress(null);
    };
  }, [refreshing, loadListings]);

  // Companies the user has explicitly chosen to hide (persisted in settings).
  // Seeded on first load from auto-detection of the resume's current employer.
  const [excludedCompanies, setExcludedCompanies] = useState<string[]>([]);
  const [excludeInitialized, setExcludeInitialized] = useState(false);
  const [autoDetected, setAutoDetected] = useState<string | null>(null);

  useEffect(() => {
    loadListings();
    // First scores-cache load reads the X-Scores-Stale-Version-Count
    // header so we can show a one-time "scoring upgraded" banner if
    // the algorithm version bumped since the last load.
    fetch('/api/scores-cache')
      .then(async (r) => {
        const stale = parseInt(r.headers.get('X-Scores-Stale-Version-Count') ?? '0', 10);
        if (stale > 0) setStaleScoreCount(stale);
        return r.json();
      })
      .then(setScoreCache)
      .catch(() => {});
    fetch('/api/listing-flags').then(r => r.json()).then(setFlags).catch(() => {});
    // One-shot dependency probe — only runs on first mount; the
    // banner stays cached for the rest of the session via the React
    // state. Dismissal also persists for the session via
    // healthDismissed.
    fetch('/api/health').then((r) => r.json()).then(setHealth).catch(() => {});
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

  // Auto-refresh: if the user has it enabled in Settings AND the
  // listings cache is older than `autoRefreshHours` (default 24),
  // kick off a streaming refresh in the background. Fires at most
  // once per page mount via the ref guard so opening the page
  // doesn't race-spam the SSE endpoint.
  const autoRefreshFiredRef = useRef(false);
  useEffect(() => {
    if (autoRefreshFiredRef.current) return;
    if (!prefs.autoRefreshEnabled) return;
    if (!lastFetched) return;
    if (refreshing) return;
    const hours = prefs.autoRefreshHours ?? 24;
    const ageMs = Date.now() - new Date(lastFetched).getTime();
    if (ageMs < hours * 60 * 60 * 1000) return;
    autoRefreshFiredRef.current = true;
    streamingRefresh();
  }, [prefs.autoRefreshEnabled, prefs.autoRefreshHours, lastFetched, refreshing, streamingRefresh]);

  // Reload listings + scores when the user returns to this tab/page.
  // This makes the page feel "live" — when a job is added on /jobs/add
  // and the user navigates back here (or switches tabs), they immediately
  // see the new entry without having to hit "Refresh All".
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        loadListings();
        fetch('/api/scores-cache').then(r => r.json()).then(setScoreCache).catch(() => {});
        fetch('/api/listing-flags').then(r => r.json()).then(setFlags).catch(() => {});
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
    };
  }, [loadListings]);

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

  // Resolve the user's work-authorization countries — defaults to ["US"]
  // for legacy settings that predate the field. We snapshot it here so
  // the filter chain below stays referentially stable in useMemo deps.
  const authCountries = useMemo(
    () => (prefs.workAuthCountries && prefs.workAuthCountries.length > 0
      ? prefs.workAuthCountries
      : ['US']),
    [prefs.workAuthCountries],
  );

  // Filter to relevant roles using user preferences (or fallback to EM
  // patterns), then drop anything from excluded employers OR from a
  // country the user isn't authorized to work in.
  const listings = useMemo(() => {
    const roleMatched = filterByUserPreferences(allListings, prefs.preferredRoles ?? []);
    const authFiltered = roleMatched.filter((l) => isWorkAuthorized(l.location, authCountries));
    if (excludedAliases.length === 0) return authFiltered;
    return authFiltered.filter((l) => !isExcludedCompany(l.company, excludedAliases));
  }, [allListings, prefs.preferredRoles, excludedAliases, authCountries]);

  // Count of listings hidden by the current-employer filter, for a small
  // info banner so the user understands what's being excluded.
  const excludedByEmployerCount = useMemo(() => {
    if (excludedAliases.length === 0) return 0;
    const roleMatched = filterByUserPreferences(allListings, prefs.preferredRoles ?? []);
    return roleMatched.filter((l) => isExcludedCompany(l.company, excludedAliases)).length;
  }, [allListings, prefs.preferredRoles, excludedAliases]);

  // Auto-score all matching listings in background batches.
  //
  // Performance: with 4000+ listings the naive "one chunk at a time"
  // pattern leaves the client idle while the server processes each chunk,
  // even though the work is I/O-bound (per-listing JD fetches against
  // many unrelated hosts). We now run a small pool of workers that each
  // pull chunks off a shared queue and POST to /api/ats-score/batch in
  // parallel. The server already fans out all listings in a chunk via
  // Promise.allSettled, so total in-flight fetches ≈ CONCURRENCY × CHUNK.
  //
  // Tuning tradeoffs:
  //   CHUNK up → fewer HTTP round-trips and fewer server-side DB
  //              read/writes (the db.json can be 10+MB; each batch does
  //              one read and one write), but more per-request wall time.
  //   CONCURRENCY up → higher effective parallelism against external
  //                    job boards. We stay well below levels that would
  //                    trigger per-host throttling across the mix of
  //                    Greenhouse/Lever/Ashby/custom career APIs.
  useEffect(() => {
    if (listings.length === 0 || scoringRef.current) return;
    // Skip ATSs we can't score — their "No score" chip is a truthful terminal
    // state, not a prompt to retry on every page load.
    const unscoredIds = listings
      .filter((l) => !scoreCache[l.id] && !isUnscorableAts(l.ats))
      .map((l) => l.id);
    if (unscoredIds.length === 0) return;

    scoringRef.current = true;
    const CHUNK = 20;
    const CONCURRENCY = 4;

    // Build the chunk queue up-front so each worker just pops the next one.
    const queue: string[][] = [];
    for (let i = 0; i < unscoredIds.length; i += CHUNK) {
      queue.push(unscoredIds.slice(i, i + CHUNK));
    }

    const total = listings.length;
    let scored = total - unscoredIds.length;
    setScoringProgress({ scored, total });

    // Abort flag shared across workers so a single failure doesn't leave
    // other workers still firing requests.
    let aborted = false;

    const worker = async () => {
      while (!aborted) {
        const chunk = queue.shift();
        if (!chunk) return;
        try {
          const res = await fetch('/api/ats-score/batch', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ listingIds: chunk }),
          });
          const data = await res.json();
          if (data.error) { aborted = true; return; }
          if (data.scores) {
            // Functional setState is concurrency-safe: each worker's
            // update merges into the latest cache, not a stale snapshot.
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
          setScoringProgress({ scored, total });
        } catch {
          aborted = true;
          return;
        }
      }
    };

    (async () => {
      // Kick off N workers and wait for all of them to drain the queue.
      await Promise.all(Array.from({ length: CONCURRENCY }, worker));
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
      // Boolean search — supports AND / OR / NOT (uppercase only) and
      // quoted phrases. Whitespace defaults to AND. Examples:
      //   engineering manager kubernetes        → AND of all three
      //   "engineering manager" OR director      → phrase OR token
      //   manager AND (kafka OR kinesis)         → AND/OR group  (parens not yet — flat OR groups only)
      //   manager NOT director                   → AND with negation
      //
      // We don't implement parens; in practice "AND" is the dominant
      // operator and OR runs are short. The parser walks the input
      // splitting on AND/OR boundaries and respects quoted phrases.
      const matchesField = (l: typeof result[number], term: string): boolean => {
        const t = term.toLowerCase();
        return (
          l.title.toLowerCase().includes(t) ||
          l.company.toLowerCase().includes(t) ||
          l.department.toLowerCase().includes(t) ||
          l.location.toLowerCase().includes(t)
        );
      };
      // Tokenize: respect double-quoted phrases as single tokens.
      const tokens: string[] = [];
      const re = /"([^"]+)"|(\S+)/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(search)) !== null) tokens.push(m[1] ?? m[2]);
      // Build AND-groups separated by OR. Each AND-group is an array
      // of terms, each prefixed with optional NOT. The whole search
      // matches if ANY AND-group matches.
      type Term = { term: string; negate: boolean };
      const orGroups: Term[][] = [[]];
      for (let i = 0; i < tokens.length; i++) {
        const tok = tokens[i];
        if (tok === 'AND') continue; // implicit
        if (tok === 'OR') { orGroups.push([]); continue; }
        if (tok === 'NOT') {
          const next = tokens[i + 1];
          if (next) {
            orGroups[orGroups.length - 1].push({ term: next, negate: true });
            i++;
          }
          continue;
        }
        orGroups[orGroups.length - 1].push({ term: tok, negate: false });
      }
      result = result.filter((l) => {
        // Standard title/company/dept/location match (with AND/OR/NOT).
        const fieldMatch = orGroups.some((group) =>
          group.length === 0 ||
          group.every((t) => (t.negate ? !matchesField(l, t.term) : matchesField(l, t.term)))
        );
        if (fieldMatch) return true;
        // JD body fallback — kept disjunctive with the field match
        // so a listing matches if EITHER its metadata fields hit OR
        // its cached JD body contains the query. The server already
        // applied the (simpler) substring match to the JD text, so
        // we just check membership here.
        if (searchInJd && jdMatchIds && jdMatchIds.has(l.id)) return true;
        return false;
      });
    }
    // Score-range filter (only kicks in when bounds are non-default).
    if (minScore > 0 || maxScore < 100) {
      result = result.filter((l) => {
        const s = scoreCache[l.id];
        // Listings without a usable score are kept at the bottom of
        // the range — drop them only when the user explicitly raises
        // the floor above 0.
        if (!s || s.totalCount === 0) return minScore === 0;
        return s.overall >= minScore && s.overall <= maxScore;
      });
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
    // Hide-stale filter — drops listings whose postedAt (or fetchedAt
    // as a fallback) is older than 30 days. Listings with no posted
    // date at all are kept, since not knowing their age isn't grounds
    // to assume they're stale.
    if (hideStale) {
      const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
      result = result.filter((l) => {
        const stamp = l.postedAt || l.fetchedAt;
        if (!stamp) return true;
        const t = Date.parse(stamp);
        if (isNaN(t)) return true;
        return t >= cutoff;
      });
    }
    // Date-posted preset. Same semantics as hideStale — unknown date
    // means "don't drop", so we never penalize manual entries that
    // lack a postedAt.
    if (datePosted !== 'all') {
      const DAY = 24 * 60 * 60 * 1000;
      const windowMs: Record<Exclude<DatePreset, 'all'>, number> = {
        today: DAY,
        '1d':  DAY,
        '2d':  2 * DAY,
        week:  7 * DAY,
        month: 30 * DAY,
      };
      const cutoff = Date.now() - windowMs[datePosted];
      result = result.filter((l) => {
        const stamp = l.postedAt || l.fetchedAt;
        if (!stamp) return true;
        const t = Date.parse(stamp);
        if (isNaN(t)) return true;
        return t >= cutoff;
      });
    }
    // Sort by score (highest first), then by date
    result = [...result].sort((a, b) => {
      const sa = scoreCache[a.id]?.overall ?? -1;
      const sb = scoreCache[b.id]?.overall ?? -1;
      if (sb !== sa) return sb - sa;
      return new Date(b.updatedAt || b.fetchedAt).getTime() - new Date(a.updatedAt || a.fetchedAt).getTime();
    });
    return result;
  }, [listings, search, searchInJd, jdMatchIds, selectedCompany, locationPreset, selectedDepartment, scoreCache, flags, showFlagged, locationMatcher, prefs.workMode, minSalary, maxSalary, salaryOnly, selectedLevels, hideStale, datePosted, minScore, maxScore]);

  const flaggedCount = useMemo(
    () => listings.filter((l) => flags[l.id]).length,
    [listings, flags]
  );

  // Paginate
  const totalPages = Math.ceil(filtered.length / pageSize);
  const paginated = filtered.slice((page - 1) * pageSize, page * pageSize);

  // Reset page when filters change
  useEffect(() => { setPage(1); }, [search, selectedCompany, locationPreset, selectedDepartment, minSalary, maxSalary, salaryOnly, selectedLevels]);

  // Fire the JD full-text search whenever the query or toggle
  // changes. Debounced 300ms so each keystroke doesn't kick a
  // disk-walk on the server. Empty query clears the match set so
  // the JD filter is a no-op.
  useEffect(() => {
    if (!searchInJd || !search.trim()) {
      setJdMatchIds(null);
      setJdSearchMeta(null);
      return;
    }
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search/jd?q=${encodeURIComponent(search.trim())}`);
        if (!res.ok) return;
        const data = await res.json();
        const ids: string[] = Array.isArray(data.matchingIds) ? data.matchingIds : [];
        setJdMatchIds(new Set(ids));
        setJdSearchMeta({ matched: ids.length, cached: data.cachedCount ?? 0 });
      } catch {
        // Network blip — keep last result rather than nuking it.
      }
    }, 300);
    return () => clearTimeout(t);
  }, [search, searchInJd]);

  if (loading && allListings.length === 0) {
    return (
      <div className="p-8 flex flex-col items-center justify-center min-h-[60vh]">
        <Loader2 className="w-10 h-10 text-blue-500 animate-spin mb-4" />
        <h2 className="text-lg font-semibold text-slate-800 mb-2">Loading...</h2>
      </div>
    );
  }

  if (!loading && allListings.length === 0) {
    return (
      <div className="p-8 flex flex-col items-center justify-center min-h-[60vh]">
        <Globe className="w-14 h-14 text-slate-300 mb-4" />
        <h2 className="text-lg font-semibold text-slate-800 mb-2">No Job Listings Yet</h2>
        <p className="text-sm text-slate-500 mb-6 max-w-md text-center">
          Click below to search across 40+ company career pages and populate your listings based on your preferences.
        </p>
        <Button
          onPress={streamingRefresh}
          isDisabled={refreshing}
          size="lg"
          className="px-6 bg-gradient-to-r from-indigo-500 to-violet-500 text-white shadow-md data-[hovered=true]:shadow-lg data-[hovered=true]:from-indigo-600 data-[hovered=true]:to-violet-600"
        >
          {refreshing ? (
            <><Loader2 className="w-4 h-4 animate-spin" /> Fetching Jobs...</>
          ) : (
            <><RefreshCw className="w-4 h-4" /> Fetch Job Listings</>
          )}
        </Button>
      </div>
    );
  }

  return (
    <div className="p-8 max-w-[1500px] mx-auto animate-fade-in">
      {/* Score-version migration banner. Shown once after a scorer
          upgrade (e.g. v2 → v3). The auto-batch-scorer effect kicks
          off automatically since the cache GET hides stale entries;
          this banner just explains what's happening so the user
          doesn't think their scores got randomly reset. Disappears
          on its own once `staleScoreCount` drops to zero (after the
          batch finishes and the next page load gets a clean cache). */}
      {staleScoreCount > 0 && (
        <div className="mb-4 rounded-xl border border-indigo-200/70 bg-gradient-to-r from-indigo-50 via-violet-50 to-indigo-50 p-4 shadow-sm flex items-start gap-3">
          <Sparkles className="w-5 h-5 text-violet-600 shrink-0 mt-0.5" />
          <div className="flex-1 text-sm">
            <p className="font-semibold text-violet-900">
              Scoring algorithm upgraded — recomputing {staleScoreCount.toLocaleString()} score{staleScoreCount === 1 ? '' : 's'}
            </p>
            <p className="text-violet-800/90 text-xs mt-0.5">
              The new algorithm scores against JD-extracted multi-word phrases (e.g. <em>agent foundations, data plane</em>) in addition to taxonomy keywords. Your scores will refresh automatically over the next minute.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setStaleScoreCount(0)}
            className="text-violet-700 hover:text-violet-900 shrink-0"
            aria-label="Dismiss banner"
            title="Dismiss"
          >
            <XCircle className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* System-dependency banner — surfaces missing LibreOffice (or
          other runtime requirements added later) BEFORE the user
          clicks Tailor and gets an opaque ENOENT. Dismissible for the
          session; persists across page reloads only if the dep is
          still missing. */}
      {health && !health.libreoffice.ok && !healthDismissed && (
        <div className="mb-4 rounded-xl border border-amber-300/70 bg-gradient-to-r from-amber-50 via-orange-50 to-amber-50 p-4 shadow-sm flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0 text-sm">
            <p className="font-semibold text-amber-900">
              LibreOffice isn&apos;t installed — resume tailoring will fail
            </p>
            <p className="text-amber-800/90 text-xs mt-1">
              Resume → PDF conversion shells out to <code className="px-1 py-0.5 bg-white/60 rounded text-[11px]">soffice --headless</code>. Install LibreOffice and restart the dev server:
            </p>
            <pre className="mt-2 px-3 py-2 bg-white/70 rounded text-[11px] font-mono text-amber-900 overflow-x-auto">
{health.platform === 'darwin'
  ? 'brew install --cask libreoffice'
  : health.platform === 'linux'
    ? 'sudo apt-get install -y libreoffice'
    : 'Download from https://www.libreoffice.org/download/download/'}
            </pre>
          </div>
          <button
            type="button"
            onClick={() => setHealthDismissed(true)}
            className="text-amber-700 hover:text-amber-900 shrink-0"
            aria-label="Dismiss banner"
            title="Dismiss for this session"
          >
            <XCircle className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight bg-gradient-to-r from-slate-800 via-indigo-600 to-violet-600 bg-clip-text text-transparent">
            Job Listings
          </h1>
          <p className="text-sm text-slate-500 mt-1 flex items-center gap-2 flex-wrap">
            <span>
              <span className="text-indigo-600 font-semibold">{listings.length.toLocaleString()}</span>
              {' '}of {allListings.length.toLocaleString()} roles match
              {lastFetched && (
                <span className="text-slate-400">
                  {' '}&middot; updated{' '}
                  {(() => {
                    const ms = Date.parse(lastFetched);
                    if (isNaN(ms)) return new Date(lastFetched).toLocaleString();
                    const diffMin = Math.round((Date.now() - ms) / 60000);
                    if (diffMin < 1) return 'just now';
                    if (diffMin < 60) return `${diffMin}m ago`;
                    const diffH = Math.round(diffMin / 60);
                    if (diffH < 24) return `${diffH}h ago`;
                    return new Date(ms).toLocaleDateString();
                  })()}
                </span>
              )}
            </span>
            {/* Error-count badge — surfaces ONLY when fetches failed,
                hidden behind an icon so it doesn't clutter the
                summary line on a successful refresh. Click expands
                the full list below the header. */}
            {fetchErrors.length > 0 && (
              <button
                onClick={() => setShowErrors(!showErrors)}
                className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[11px] font-medium bg-amber-50 border border-amber-100 text-amber-700 hover:bg-amber-100 transition-colors"
                title={`${fetchErrors.length} companies could not be fetched — click for details`}
              >
                <AlertCircle className="w-3 h-3" />
                {fetchErrors.length}
              </button>
            )}
          </p>
        </div>
        <Button
          onPress={streamingRefresh}
          isDisabled={refreshing}
          size="lg"
          className="group bg-gradient-to-r from-indigo-500 to-violet-500 text-white shadow-md data-[hovered=true]:shadow-lg data-[hovered=true]:from-indigo-600 data-[hovered=true]:to-violet-600"
        >
          <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : 'group-data-[hovered=true]:rotate-180 transition-transform duration-500'}`} />
          {refreshing ? 'Refreshing...' : 'Refresh All'}
        </Button>
      </div>

      {/* Streaming refresh progress card. Mirrors the onboarding wizard:
          discovers all companies, then walks each one to pull listings,
          all in the background while the existing data stays usable. */}
      {refreshProgress && (
        <Card className="mb-6 bg-gradient-to-r from-indigo-50 via-violet-50 to-indigo-50 ring-indigo-200/70 shadow-sm animate-fade-in-up p-4">
          <div className="flex items-center gap-3 mb-2">
            <div className="relative">
              <Loader2 className="w-5 h-5 text-blue-600 animate-spin" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-blue-900">
                Refreshing {refreshProgress.total > 0 ? `${refreshProgress.completed} / ${refreshProgress.total}` : ''} companies
              </p>
              <p className="text-xs text-blue-700/80 truncate">
                {refreshProgress.currentCompany
                  ? `Just fetched ${refreshProgress.currentCompany}`
                  : 'Discovering company sources...'}
                {' · '}
                <span className="font-medium">{refreshProgress.totalJobsSoFar.toLocaleString()}</span> jobs found
                {refreshProgress.failed > 0 && (
                  <span className="text-amber-700"> · {refreshProgress.failed} failed</span>
                )}
              </p>
            </div>
          </div>
          <div className="h-2 bg-white/60 rounded-full overflow-hidden ring-1 ring-blue-100">
            <div
              className="h-full bg-gradient-to-r from-indigo-500 via-violet-500 to-fuchsia-500 rounded-full transition-all duration-500"
              style={{
                width: refreshProgress.total > 0
                  ? `${Math.round((refreshProgress.completed / refreshProgress.total) * 100)}%`
                  : '5%',
              }}
            />
          </div>
        </Card>
      )}

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
              className="h-full bg-gradient-to-r from-indigo-500 to-violet-500 rounded-full transition-all duration-300"
              style={{ width: `${Math.round((scoringProgress.scored / scoringProgress.total) * 100)}%` }}
            />
          </div>
        </div>
      )}


      {/* Fetch errors — toggled by the count badge in the summary
          line above. Rendered as a separate strip so the expanded
          list is full-width rather than wrapping inside the header
          paragraph. */}
      {fetchErrors.length > 0 && showErrors && (
        <div className="mb-4 p-3 bg-amber-50 border border-amber-100 rounded-xl text-xs text-amber-700 space-y-1">
          {fetchErrors.map((e, i) => (
            <div key={i}>{e.company}: {e.error}</div>
          ))}
        </div>
      )}

      {/* Search + Location preset + Filters */}
      <div className="mb-6 space-y-3">
        <div className="flex gap-3">
          <div className="flex-1 relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by title, company, department, or location..."
              className="w-full pl-10 pr-4 py-2.5 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-indigo-200 focus:border-indigo-300 outline-none"
            />
          </div>
          <button
            onClick={() => setShowFilters(!showFilters)}
            className={`flex items-center gap-2 px-4 py-2.5 border rounded-lg text-sm font-medium transition-colors ${
              showFilters ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-slate-200 text-slate-700 hover:bg-slate-50'
            }`}
          >
            <Filter className="w-4 h-4" />
            Filters
          </button>
        </div>

        {/* The flagged-toggle now lives inside the Filters drawer
            alongside Hide-stale / Date-posted (see below). Keeps the
            top of the listings page uncluttered. */}

        {showFilters && (
          <div className="p-4 bg-white border border-slate-200 rounded-lg space-y-4">
            {/* Saved presets row — apply / save / delete named filter
                snapshots. Persists in localStorage so it survives
                page refreshes. */}
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs font-medium text-slate-500 mr-1">Presets:</span>
              {presets.length === 0 && (
                <span className="text-xs text-slate-400 italic">None saved yet.</span>
              )}
              {presets.map((p) => (
                <span
                  key={p.name}
                  className="inline-flex items-center gap-1 bg-slate-100 rounded-full pl-3 pr-1 py-0.5 text-xs"
                >
                  <button
                    onClick={() => {
                      setSearch(p.search);
                      setSelectedCompany(p.selectedCompany);
                      setSelectedDepartment(p.selectedDepartment);
                      setLocationPreset(p.locationPreset);
                      setMinSalary(p.minSalary);
                      setMaxSalary(p.maxSalary);
                      setSalaryOnly(p.salaryOnly);
                      setSelectedLevels(p.selectedLevels);
                      setHideStale(p.hideStale);
                      setMinScore(p.minScore);
                      setMaxScore(p.maxScore);
                    }}
                    className="text-slate-700 hover:text-blue-700"
                  >
                    {p.name}
                  </button>
                  <button
                    onClick={() => persistPresets(presets.filter((x) => x.name !== p.name))}
                    className="text-slate-400 hover:text-red-500 p-0.5"
                    title={`Delete preset "${p.name}"`}
                  >
                    <XCircle className="w-3 h-3" />
                  </button>
                </span>
              ))}
              <button
                onClick={() => {
                  const name = window.prompt('Name this preset (e.g. "EM Seattle 70%+"):')?.trim();
                  if (!name) return;
                  const next: FilterPreset = {
                    name,
                    search,
                    selectedCompany,
                    selectedDepartment,
                    locationPreset,
                    minSalary,
                    maxSalary,
                    salaryOnly,
                    selectedLevels,
                    hideStale,
                    minScore,
                    maxScore,
                  };
                  // Replace if name collides; otherwise append.
                  const existing = presets.findIndex((p) => p.name === name);
                  const updated = existing >= 0
                    ? presets.map((p, i) => (i === existing ? next : p))
                    : [...presets, next];
                  persistPresets(updated);
                }}
                className="ml-auto text-xs text-blue-600 hover:text-blue-700"
              >
                + Save current as preset
              </button>
            </div>

            {/* Location preset (Preferred Locations vs All) — moved
                inside the filters drawer per UX revision. */}
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs font-medium text-slate-500 mr-1">
                <MapPin className="w-3 h-3 inline -mt-0.5" /> Location:
              </span>
              <button
                onClick={() => setLocationPreset('wa-remote')}
                className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                  locationPreset === 'wa-remote'
                    ? 'bg-indigo-500 text-white'
                    : 'bg-slate-100 text-slate-600 hover:bg-gray-200'
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
                    ? 'bg-indigo-500 text-white'
                    : 'bg-slate-100 text-slate-600 hover:bg-gray-200'
                }`}
              >
                All Locations ({listings.length})
              </button>
            </div>

            {/* Excluded companies — also moved into the filters drawer.
                Compact form: chips inline + tiny add input. */}
            <ExcludedCompaniesBar
              excluded={excludedCompanies}
              onChange={saveExcludedCompanies}
              autoDetected={autoDetected}
              hiddenCount={excludedByEmployerCount}
              allCompanies={allCompanyNames}
            />
            <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">Company</label>
              <select
                value={selectedCompany}
                onChange={(e) => setSelectedCompany(e.target.value)}
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-indigo-200 outline-none"
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
              <label className="block text-xs font-medium text-slate-500 mb-1">Department</label>
              <select
                value={selectedDepartment}
                onChange={(e) => setSelectedDepartment(e.target.value)}
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-indigo-200 outline-none"
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
                <label className="block text-xs font-medium text-slate-500">
                  <DollarSign className="w-3 h-3 inline -mt-0.5" /> Salary Range (annual, USD)
                </label>
                <div className="flex items-center gap-3">
                  <label className="flex items-center gap-1.5 text-xs text-slate-500 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={salaryOnly}
                      onChange={(e) => setSalaryOnly(e.target.checked)}
                      className="rounded"
                    />
                    Only with salary info
                  </label>
                  <label
                    className="flex items-center gap-1.5 text-xs text-slate-500 cursor-pointer"
                    title="Hides postings older than 30 days (using Posted Date when known, otherwise the date we first fetched it)"
                  >
                    <input
                      type="checkbox"
                      checked={hideStale}
                      onChange={(e) => setHideStale(e.target.checked)}
                      className="rounded"
                    />
                    Hide listings &gt; 30 days old
                  </label>
                  {flaggedCount > 0 && (
                    <label
                      className="flex items-center gap-1.5 text-xs text-slate-500 cursor-pointer"
                      title="Toggle visibility of listings flagged as Applied / Incorrect / Not Applicable"
                    >
                      <input
                        type="checkbox"
                        checked={showFlagged}
                        onChange={(e) => setShowFlagged(e.target.checked)}
                        className="rounded"
                      />
                      Show flagged ({flaggedCount})
                    </label>
                  )}
                  <label
                    className="flex items-center gap-1.5 text-xs text-slate-500 cursor-pointer"
                    title="Also match the search query against the body of cached job descriptions, not just the title / company / department / location. Coverage grows as you expand more listings (each expand caches the JD to disk)."
                  >
                    <input
                      type="checkbox"
                      checked={searchInJd}
                      onChange={(e) => setSearchInJd(e.target.checked)}
                      className="rounded"
                    />
                    Also search job descriptions
                    {jdSearchMeta && (
                      <span className="text-slate-400">
                        ({jdSearchMeta.matched} of {jdSearchMeta.cached} cached JDs)
                      </span>
                    )}
                  </label>
                </div>
                {/* Date-posted preset — keeps only listings within the
                    selected window. Distinct from hideStale (which is a
                    boolean 30-day cutoff); this lets the user narrow to
                    "fresh today" / "this week" / "this month" without
                    losing the rest of the filter state. */}
                <div className="flex items-center gap-2 flex-wrap mt-2">
                  <Calendar className="w-3.5 h-3.5 text-slate-400" />
                  <span className="text-xs text-slate-500">Posted:</span>
                  {([
                    ['all',   'Any time'],
                    ['today', 'Today'],
                    ['1d',    'Last 24h'],
                    ['2d',    'Last 2 days'],
                    ['week',  'Last week'],
                    ['month', 'Last month'],
                  ] as [DatePreset, string][]).map(([key, label]) => (
                    <button
                      key={key}
                      type="button"
                      onClick={() => setDatePosted(key)}
                      className={`px-2 py-0.5 rounded text-xs border transition-colors ${
                        datePosted === key
                          ? 'bg-indigo-500 text-white border-indigo-500'
                          : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-slate-400">Min $</span>
                  <input
                    type="number"
                    min="0"
                    step="5000"
                    value={minSalary ?? ''}
                    onChange={(e) => setMinSalary(e.target.value ? Number(e.target.value) : null)}
                    placeholder="e.g. 200000"
                    className="w-full pl-12 pr-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-indigo-200 outline-none"
                  />
                </div>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-slate-400">Max $</span>
                  <input
                    type="number"
                    min="0"
                    step="5000"
                    value={maxSalary ?? ''}
                    onChange={(e) => setMaxSalary(e.target.value ? Number(e.target.value) : null)}
                    placeholder="e.g. 450000"
                    className="w-full pl-12 pr-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-indigo-200 outline-none"
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

            {/* ATS score range — keeps listings whose overall score
                falls within [minScore, maxScore]. Default 0-100 is a
                no-op. Listings with no score (unscorable ATSes like
                Google/Microsoft) are kept unless the floor is raised
                above 0, on the theory that the user only wants to
                "filter to good matches" not "drop unscored entirely". */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="block text-xs font-medium text-slate-500">
                  <Target className="w-3 h-3 inline -mt-0.5" /> ATS Score Range
                </label>
                {(minScore > 0 || maxScore < 100) && (
                  <button
                    onClick={() => { setMinScore(0); setMaxScore(100); }}
                    className="text-xs text-blue-600 hover:text-blue-700"
                  >
                    Clear
                  </button>
                )}
              </div>
              <div className="flex items-center gap-2 text-xs text-slate-600">
                <input
                  type="number"
                  min={0} max={100}
                  value={minScore}
                  onChange={(e) => setMinScore(Math.max(0, Math.min(100, Number(e.target.value) || 0)))}
                  className="w-16 px-2 py-1 border border-slate-200 rounded focus:ring-2 focus:ring-indigo-200 outline-none"
                />
                <span>%</span>
                <span className="text-slate-400">to</span>
                <input
                  type="number"
                  min={0} max={100}
                  value={maxScore}
                  onChange={(e) => setMaxScore(Math.max(0, Math.min(100, Number(e.target.value) || 100)))}
                  className="w-16 px-2 py-1 border border-slate-200 rounded focus:ring-2 focus:ring-indigo-200 outline-none"
                />
                <span>%</span>
              </div>
            </div>

            {/* Level tier multi-select */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="block text-xs font-medium text-slate-500">
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
                          ? 'bg-indigo-500 text-white'
                          : 'bg-slate-100 text-slate-600 hover:bg-gray-200'
                      }`}
                    >
                      {tier.label}
                    </button>
                  );
                })}
              </div>
              {selectedLevels.length > 0 && (
                <p className="text-xs text-slate-400 mt-1.5">
                  Showing listings matching any selected level. Titles with no clear level signal are included.
                </p>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Results count */}
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm text-slate-500">
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
        {paginated.map((listing, idx) => (
          <div
            key={listing.id}
            className="animate-fade-in-up"
            // Cap the per-card stagger delay so a long page (50 cards
            // at default page size) finishes the entrance animation in
            // well under a second. Anything past idx 12 lands at the
            // same time — feels lively without dragging.
            style={{ animationDelay: `${Math.min(idx, 12) * 25}ms` }}
          >
            <ListingCard
              listing={listing}
              score={scoreCache[listing.id]}
              flag={flags[listing.id]?.flag}
              onFlagChange={(f) => setFlagFor(listing.id, f)}
              isExpanded={expandedId === listing.id}
              onToggle={() => setExpandedId(expandedId === listing.id ? null : listing.id)}
              isCompareSelected={compareIds.includes(listing.id)}
              compareDisabled={!compareIds.includes(listing.id) && compareIds.length >= 3}
              onCompareToggle={() => toggleCompare(listing.id)}
              isBulkSelected={bulkSelectedIds.has(listing.id)}
              onBulkToggle={() => toggleBulk(listing.id)}
            />
          </div>
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
          <div className="text-center py-12 bg-white rounded-xl border border-slate-200">
            <Search className="w-10 h-10 text-slate-300 mx-auto mb-3" />
            <p className="text-slate-500 mb-3">No jobs match your filters.</p>
            {hiddenByLocation && (
              <div className="text-sm text-slate-600">
                <p className="mb-2">
                  {unfilteredByLocation.length} matching {unfilteredByLocation.length === 1 ? 'job is' : 'jobs are'} hidden by the <b>Preferred Locations</b> filter.
                </p>
                <button
                  onClick={() => setLocationPreset('all')}
                  className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-50 text-indigo-700 border border-indigo-100 text-xs font-semibold rounded-xl shadow-sm shadow-indigo-500/10 hover:bg-indigo-100 hover:border-indigo-200 hover:shadow-md hover:shadow-indigo-500/15 transition-all duration-200"
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
            className="px-3 py-2 text-sm font-medium border border-slate-200 rounded-xl disabled:opacity-40 hover:bg-slate-50 hover:border-slate-300 transition-all duration-200"
          >
            Previous
          </button>
          <span className="text-sm text-slate-500 px-3">
            Page {page} of {totalPages}
          </span>
          <button
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page === totalPages}
            className="px-3 py-2 text-sm font-medium border border-slate-200 rounded-xl disabled:opacity-40 hover:bg-slate-50 hover:border-slate-300 transition-all duration-200"
          >
            Next
          </button>
        </div>
      )}

      {/* Floating Compare CTA — visible only when ≥ 2 cards are
          ticked. Goes away as soon as the user opens /compare or
          deselects back to 1. */}
      {compareIds.length >= 2 && (
        <Link
          href={`/compare?ids=${compareIds.join(',')}`}
          className="fixed bottom-6 right-6 z-40 inline-flex items-center gap-2 px-5 py-3 bg-gradient-to-r from-indigo-500 to-violet-500 text-white text-sm font-medium rounded-full shadow-btn-primary hover:shadow-btn-primary-hover hover:from-indigo-600 hover:to-violet-600 transition-all"
        >
          Compare {compareIds.length} listings
          <ChevronRight className="w-4 h-4" />
        </Link>
      )}

      {/* Bulk-actions bar — visible only when ≥ 1 card is ticked
          via the per-card 'Select' checkbox. Floats above the
          listings, doesn't conflict with the Compare CTA (Compare
          uses right-6; this uses centered-bottom). All actions
          POST to /api/listing-flags in parallel for each selected
          listing, then optimistically updates local flag state. */}
      {bulkSelectedIds.size > 0 && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 inline-flex items-center gap-2 px-4 py-2.5 bg-white border border-slate-200 rounded-2xl shadow-modal flex-wrap">
          <span className="text-sm font-semibold text-slate-700 pr-2 border-r border-slate-100">
            {bulkSelectedIds.size} selected
          </span>
          {([
            { flag: 'applied', label: 'Applied', color: 'bg-indigo-50 text-indigo-700 border-indigo-100 hover:bg-indigo-100' },
            { flag: 'phone-screen', label: 'Phone Screen', color: 'bg-sky-50 text-sky-700 border-sky-100 hover:bg-sky-100' },
            { flag: 'interviewing', label: 'Interviewing', color: 'bg-cyan-50 text-cyan-700 border-cyan-100 hover:bg-cyan-100' },
            { flag: 'offer', label: 'Offer', color: 'bg-emerald-50 text-emerald-700 border-emerald-100 hover:bg-emerald-100' },
            { flag: 'rejected', label: 'Rejected', color: 'bg-rose-50 text-rose-700 border-rose-100 hover:bg-rose-100' },
            { flag: 'not-applicable', label: 'Archive', color: 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100' },
          ] as const).map(({ flag, label, color }) => (
            <button
              key={flag}
              type="button"
              disabled={!!bulkBusy}
              onClick={async () => {
                setBulkBusy(flag);
                const ids = Array.from(bulkSelectedIds);
                try {
                  // Fire all flag-set requests in parallel; the
                  // listing-flag store keys by listingId so writes
                  // are independent.
                  await Promise.all(
                    ids.map((id) =>
                      fetch('/api/listing-flags', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ listingId: id, flag }),
                      }),
                    ),
                  );
                  // Optimistic local update — mirror what setFlagFor does.
                  setFlags((prev) => {
                    const next = { ...prev };
                    const now = new Date().toISOString();
                    for (const id of ids) {
                      next[id] = { listingId: id, flag, flaggedAt: now };
                    }
                    return next;
                  });
                  clearBulk();
                } finally {
                  setBulkBusy(null);
                }
              }}
              className={`inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all duration-200 disabled:opacity-50 ${color}`}
            >
              {bulkBusy === flag && <Loader2 className="w-3 h-3 animate-spin" />}
              {label}
            </button>
          ))}
          <button
            type="button"
            disabled={!!bulkBusy}
            onClick={async () => {
              setBulkBusy('clear');
              const ids = Array.from(bulkSelectedIds);
              try {
                await Promise.all(
                  ids.map((id) =>
                    fetch('/api/listing-flags', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ listingId: id, flag: null }),
                    }),
                  ),
                );
                setFlags((prev) => {
                  const next = { ...prev };
                  for (const id of ids) delete next[id];
                  return next;
                });
                clearBulk();
              } finally {
                setBulkBusy(null);
              }
            }}
            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-800 transition-all duration-200 disabled:opacity-50"
          >
            {bulkBusy === 'clear' && <Loader2 className="w-3 h-3 animate-spin" />}
            Clear flags
          </button>
          <button
            type="button"
            onClick={clearBulk}
            className="ml-1 p-1 rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700 transition-colors"
            title="Deselect all"
          >
            <XCircle className="w-4 h-4" />
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Helpers ────────────────────────────────────────────────────────

function scoreColor(score: number): string {
  // Tier-coded soft pastels — match the dashboard ScoreRing palette
  // (emerald/teal, amber/orange, rose/pink) so a score chip on the
  // listings page reads the same as the dashboard's stat blocks.
  if (score >= 75) return 'text-emerald-700 bg-emerald-50 border-emerald-100';
  if (score >= 50) return 'text-amber-700 bg-amber-50 border-amber-100';
  return 'text-rose-700 bg-rose-50 border-rose-100';
}

// ─── Expandable Listing Card ────────────────────────────────────────

function ListingCard({
  listing,
  score,
  flag,
  onFlagChange,
  isExpanded,
  onToggle,
  isCompareSelected,
  compareDisabled,
  onCompareToggle,
  isBulkSelected,
  onBulkToggle,
}: {
  listing: JobListing;
  score?: ScoreCacheEntry;
  flag?: ListingFlag;
  onFlagChange: (flag: ListingFlag | null) => void;
  isExpanded: boolean;
  onToggle: () => void;
  isCompareSelected: boolean;
  compareDisabled: boolean;
  onCompareToggle: () => void;
  isBulkSelected: boolean;
  onBulkToggle: () => void;
}) {
  const [flagMenuOpen, setFlagMenuOpen] = useState(false);
  const flagButtonRef = useRef<HTMLButtonElement | null>(null);
  // Portal-anchor position for the flag dropdown. We compute it from
  // the trigger button's bounding rect at open-time (and recompute
  // on scroll/resize while open) so the menu renders into a portal
  // attached to <body>, completely escaping the card's overflow /
  // stacking context that was previously clipping it.
  const [flagMenuPos, setFlagMenuPos] = useState<{ top: number; right: number } | null>(null);
  const recomputeFlagMenuPos = useCallback(() => {
    const btn = flagButtonRef.current;
    if (!btn) return;
    const rect = btn.getBoundingClientRect();
    setFlagMenuPos({
      top: rect.bottom + 4,                    // 4px gap below button
      right: window.innerWidth - rect.right,   // right-align with button
    });
  }, []);
  useEffect(() => {
    if (!flagMenuOpen) return;
    recomputeFlagMenuPos();
    const onChange = () => recomputeFlagMenuPos();
    window.addEventListener('scroll', onChange, true);
    window.addEventListener('resize', onChange);
    return () => {
      window.removeEventListener('scroll', onChange, true);
      window.removeEventListener('resize', onChange);
    };
  }, [flagMenuOpen, recomputeFlagMenuPos]);
  const flagMeta = flag ? LISTING_FLAGS.find((f) => f.key === flag) : null;
  // Show the actual posted date the company published the role (postedAt).
  // We deliberately do NOT fall back to fetchedAt here — that would mislead
  // the user about when the company posted the job. If postedAt is null
  // (e.g. Meta, manually-added jobs), the date row simply omits the date.
  const posted = formatPostedDate(listing.postedAt);
  const isNew = isRecentlyPosted(listing);

  // Detailed score (fetched on expand)
  const [detailScore, setDetailScore] = useState<ATSScore | null>(null);
  const [loadingScore, setLoadingScore] = useState(false);
  const [scoreError, setScoreError] = useState<string | null>(null);

  // Tailor state
  const [tailorResult, setTailorResult] = useState<TailorResult | null>(null);
  // Mandatory mode — when ON (default), the tailor route injects
  // every user-selected keyword AND runs a compression cascade
  // (margins/spacing/line-height/font shrink) to keep the result on
  // one page. When OFF the legacy budget-ladder runs, which is more
  // formatting-preserving but may drop keywords on tight resumes.
  const [mandatoryMode, setMandatoryMode] = useState(true);
  // Compression steps the server applied to fit on 1 page. Surfaced
  // as a footer under the download CTA so the user knows what was
  // sacrificed (e.g. "margins 0.4", line height 1.05, body 10pt").
  // Special trailing token 'exhausted' means we couldn't fit even at
  // max compression and shipped a best-effort multi-page.
  const [compressionSteps, setCompressionSteps] = useState<string[] | null>(null);
  const [tailoring, setTailoring] = useState(false);
  const [tailorError, setTailorError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  // Cover-letter state — paired with the resume tailor flow but
  // independent (you can generate either without the other). The
  // text round-trips through a textarea so the user can edit before
  // downloading; we only push the FRESH server-generated text into
  // the textarea, never overwriting unsaved edits without prompt.
  const [coverLetter, setCoverLetter] = useState<{
    text: string;
    matchedKeywords: string[];
  } | null>(null);
  const [generatingCover, setGeneratingCover] = useState(false);
  const [coverError, setCoverError] = useState<string | null>(null);
  // Per-listing note. Lazy-loaded on expand. Auto-saves on a 800ms
  // debounce so the user never has to click Save. Empty/whitespace
  // text deletes the note server-side.
  const [noteText, setNoteText] = useState<string>('');
  const [noteLoaded, setNoteLoaded] = useState(false);
  const [noteSaving, setNoteSaving] = useState(false);
  const [noteSavedAt, setNoteSavedAt] = useState<string | null>(null);
  const noteTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // In-app PDF preview. Set when the tailor stream completes; the
  // expanded card shows an inline iframe with the generated PDF
  // alongside a Download button so the user can review before
  // downloading. The blob URL is revoked on unmount + when a new
  // generation kicks off.
  const [previewPdf, setPreviewPdf] = useState<{
    url: string;
    filename: string;
    contentType: string;
    sizeBytes: number;
  } | null>(null);
  useEffect(() => {
    return () => {
      // Revoke any stale blob URL when the component unmounts so we
      // don't leak object-URL handles.
      if (previewPdf?.url) URL.revokeObjectURL(previewPdf.url);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // Live progress for the SSE-driven download. Null when no download
  // is in flight; the inline progress card renders only while this is
  // populated.
  const [downloadProgress, setDownloadProgress] = useState<{
    stage: string;
    message: string;
    elapsedSec: number;
  } | null>(null);

  // Keyword selection state — all selected by default
  const [selectedKeywords, setSelectedKeywords] = useState<Set<string>>(new Set());
  const [keywordsInitialized, setKeywordsInitialized] = useState(false);

  // Suggestion-selection state. Same model as keywords: server returns
  // a list, all selected by default; user toggles individually; the
  // selected IDs ride along on the tailor request.
  const [selectedSuggestions, setSelectedSuggestions] = useState<Set<string>>(new Set());
  const [suggestionsInitialized, setSuggestionsInitialized] = useState(false);

  // Initialize selected keywords + suggestions when score loads.
  useEffect(() => {
    if (detailScore && !keywordsInitialized) {
      setSelectedKeywords(new Set(detailScore.missingKeywords));
      setKeywordsInitialized(true);
    }
    if (detailScore && !suggestionsInitialized) {
      setSelectedSuggestions(new Set((detailScore.suggestions ?? []).map((s) => s.id)));
      setSuggestionsInitialized(true);
    }
  }, [detailScore, keywordsInitialized, suggestionsInitialized]);

  function toggleSuggestion(id: string) {
    setSelectedSuggestions((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

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

  // Lazy-load the note on first expand. Subsequent collapse/expand
  // doesn't re-fetch — the in-memory text is the source of truth
  // once loaded.
  useEffect(() => {
    if (!isExpanded || noteLoaded) return;
    let cancelled = false;
    fetch(`/api/listing-notes?listingId=${encodeURIComponent(listing.id)}`)
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return;
        if (d.note && typeof d.note.text === 'string') {
          setNoteText(d.note.text);
          setNoteSavedAt(d.note.updatedAt ?? null);
        }
        setNoteLoaded(true);
      })
      .catch(() => !cancelled && setNoteLoaded(true));
    return () => { cancelled = true; };
  }, [isExpanded, noteLoaded, listing.id]);

  /** Debounced auto-save — 800ms after the user stops typing the
   *  note is POSTed. Empty text triggers a server-side delete. */
  function handleNoteChange(next: string) {
    setNoteText(next);
    if (noteTimerRef.current) clearTimeout(noteTimerRef.current);
    noteTimerRef.current = setTimeout(async () => {
      setNoteSaving(true);
      try {
        const res = await fetch('/api/listing-notes', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ listingId: listing.id, text: next }),
        });
        const data = await res.json();
        setNoteSavedAt(data?.note?.updatedAt ?? new Date().toISOString());
      } catch {
        // Network blip — leave saving false; user can re-type to retry.
      } finally {
        setNoteSaving(false);
      }
    }, 800);
  }

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
          selectedSuggestions: Array.from(selectedSuggestions),
          mode: mandatoryMode ? 'mandatory' : 'budget-ladder',
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

  /**
   * Generate the cover letter for this listing. Same auth/env model
   * as the tailor flow — uses the locally-stored resume + the
   * fetched JD to produce a 3-paragraph deterministic letter.
   * Idempotent: re-clicking re-renders the same text (modulo any
   * date change), discarding unsaved textarea edits with a prompt.
   */
  async function handleGenerateCoverLetter() {
    setGeneratingCover(true);
    setCoverError(null);
    try {
      const res = await fetch('/api/cover-letter', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ listingId: listing.id }),
      });
      const data = await res.json();
      if (data.error) {
        setCoverError(data.error);
      } else {
        setCoverLetter({ text: data.text, matchedKeywords: data.matchedKeywords ?? [] });
      }
    } catch {
      setCoverError('Failed to generate cover letter');
    } finally {
      setGeneratingCover(false);
    }
  }

  function handleDownloadCoverLetter() {
    if (!coverLetter) return;
    // Build the same filename shape the server uses, but driven by
    // the (possibly-edited) textarea contents so the user gets a
    // .txt of exactly what they see on screen.
    const safeName = `CoverLetter_${listing.company}_${listing.title}`
      .replace(/[^a-zA-Z0-9_\- ]/g, '')
      .replace(/\s+/g, '_')
      .slice(0, 80);
    const blob = new Blob([coverLetter.text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${safeName}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function handleDownload() {
    setDownloading(true);
    setTailorError(null);
    setDownloadProgress({ stage: 'start', message: 'Starting tailoring pipeline', elapsedSec: 0 });
    try {
      // Stream the tailor pipeline so the user sees stage-by-stage
      // progress instead of a generic spinner. The server emits
      // text/event-stream frames; we read them with the fetch + reader
      // API (EventSource doesn't support POST). The terminal 'done'
      // event carries a base64-encoded PDF that we decode and
      // download via a Blob URL.
      // Reset any prior compression footer before we kick off — we'll
      // re-populate from the `done` event when the new render lands.
      setCompressionSteps(null);
      const res = await fetch('/api/tailor-resume/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          listingId: listing.id,
          format: 'pdf',
          selectedKeywords: Array.from(selectedKeywords),
          selectedSuggestions: Array.from(selectedSuggestions),
          mode: mandatoryMode ? 'mandatory' : 'budget-ladder',
        }),
      });
      if (!res.body) throw new Error('No response body');
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      let done = false;
      let errored = false;
      while (!done) {
        const { value, done: streamDone } = await reader.read();
        if (streamDone) break;
        buf += decoder.decode(value, { stream: true });
        // SSE frames are separated by a blank line. Process each
        // complete frame and leave any partial frame in `buf`.
        let nl: number;
        while ((nl = buf.indexOf('\n\n')) >= 0) {
          const frame = buf.slice(0, nl);
          buf = buf.slice(nl + 2);
          const dataLine = frame.split('\n').find((l) => l.startsWith('data:'));
          if (!dataLine) continue;
          let event: { type?: string; [k: string]: unknown };
          try {
            event = JSON.parse(dataLine.slice(5).trim());
          } catch {
            continue;
          }
          if (event.type === 'progress') {
            setDownloadProgress({
              stage: String(event.stage ?? ''),
              message: String(event.message ?? ''),
              elapsedSec: Number(event.elapsedSec ?? 0),
            });
          } else if (event.type === 'error') {
            errored = true;
            setTailorError(String(event.message ?? 'Tailoring failed'));
            done = true;
            break;
          } else if (event.type === 'done') {
            // Decode base64 payload → Blob → stash for in-app preview
            // (the user clicks Download from there). Previously we
            // auto-triggered the browser download; the preview UX is
            // a) what JobScan / Teal users keep asking for and b)
            // saves a download/iterate round-trip when the user just
            // wants to eyeball the result.
            const base64 = String(event.base64 ?? '');
            const contentType = String(event.contentType ?? 'application/pdf');
            const filename = String(event.filename ?? 'tailored_resume.pdf');
            // Mandatory-mode footer: which cascade steps were
            // applied (margins, spacing, fonts, ADDITIONAL drop).
            const steps = Array.isArray(event.compressionSteps)
              ? (event.compressionSteps as unknown[]).filter(
                  (s): s is string => typeof s === 'string',
                )
              : [];
            setCompressionSteps(steps.length > 0 ? steps : null);
            const binary = atob(base64);
            const bytes = new Uint8Array(binary.length);
            for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
            const blob = new Blob([bytes], { type: contentType });
            const url = URL.createObjectURL(blob);
            // Revoke any previous preview URL so we don't leak.
            if (previewPdf?.url) URL.revokeObjectURL(previewPdf.url);
            setPreviewPdf({ url, filename, contentType, sizeBytes: bytes.length });
            done = true;
            break;
          }
        }
      }
      if (errored) {
        // Error path already set via setTailorError; nothing more to do.
      }
    } catch {
      setTailorError('Failed to download resume');
    } finally {
      setDownloading(false);
      setDownloadProgress(null);
    }
  }

  return (
    <div className="bg-white rounded-2xl border border-slate-100 shadow-card hover:shadow-card-hover hover:border-indigo-200 hover:-translate-y-0.5 transition-all duration-200">
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
              <h3 className="font-semibold text-slate-800 truncate text-base">{listing.title}</h3>
              {isNew && (
                <Chip
                  size="sm"
                  className="animate-pop bg-gradient-to-r from-emerald-500 to-teal-500 text-white border-0 shadow-sm uppercase tracking-wider text-[10px] font-semibold gap-1 inline-flex items-center"
                  title={
                    listing.postedAt
                      ? `Posted ${posted}`
                      : `Discovered ${formatPostedDate(listing.fetchedAt)}`
                  }
                >
                  <Sparkles className="w-3 h-3" />
                  New
                </Chip>
              )}
            </div>
            <div className="flex items-center gap-2 mb-2 flex-wrap">
              <CompanyLogo companySlug={listing.companySlug} companyName={listing.company} size={20} />
              <span className="text-sm font-medium text-slate-700">{listing.company}</span>
              {listing.department && (
                <span className="text-xs text-slate-400">&middot; {listing.department}</span>
              )}
              <NetworkBadge company={listing.company} />
            </div>
            <div className="flex flex-wrap items-center gap-3 text-xs text-slate-400">
              {listing.location && listing.location !== 'Not specified' && (
                <span className="flex items-center gap-1">
                  <MapPin className="w-3 h-3" />
                  {listing.location}
                </span>
              )}
              {listing.salary && (
                <span
                  className="flex items-center gap-1 text-emerald-600 font-medium"
                  title={(() => {
                    // Rich tooltip: base + TC + equity hint when any
                    // of those came in from the smarter parser.
                    const parts: string[] = [];
                    if (listing.salaryBaseMin != null && listing.salaryBaseMax != null) {
                      parts.push(`Base: $${Math.round(listing.salaryBaseMin/1000)}k – $${Math.round(listing.salaryBaseMax/1000)}k`);
                    }
                    if (listing.salaryTcMin != null && listing.salaryTcMax != null) {
                      parts.push(`Total comp: $${Math.round(listing.salaryTcMin/1000)}k – $${Math.round(listing.salaryTcMax/1000)}k`);
                    }
                    if (listing.salaryEquityHint) parts.push(`Equity: ${listing.salaryEquityHint}`);
                    if (listing.salarySource) parts.push(`(from JD: ${listing.salarySource})`);
                    return parts.length > 0 ? parts.join('\n') : listing.salary;
                  })()}
                >
                  <DollarSign className="w-3 h-3" />
                  {listing.salary}
                </span>
              )}
              {posted && (
                <span
                  className="flex items-center gap-1"
                  title={
                    listing.postedAt
                      ? `Posted ${new Date(listing.postedAt).toLocaleString()}`
                      : undefined
                  }
                >
                  <Calendar className="w-3 h-3" />
                  Posted {posted}
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
            {/* Bulk-select checkbox — ticking one or more cards
                surfaces a floating bulk-actions bar (flag / archive
                / clear) at the bottom of the page. Independent of
                the Compare checkbox so a card can be in both sets
                simultaneously. */}
            <label
              className="inline-flex items-center gap-1 text-xs select-none cursor-pointer text-slate-600 hover:text-slate-800"
              title="Bulk-select — applies whatever action you pick at the bottom of the page"
            >
              <input
                type="checkbox"
                checked={isBulkSelected}
                onChange={onBulkToggle}
                className="rounded"
              />
              Select
            </label>

            {/* Compare checkbox — ticking 2-3 surfaces the floating
                Compare button at the page level. Disabled when the
                cap (3) is hit unless this card is already selected. */}
            <label
              className={`inline-flex items-center gap-1 text-xs select-none ${
                compareDisabled ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer text-slate-600 hover:text-slate-800'
              }`}
              title={compareDisabled ? 'Compare cap is 3' : 'Tick to add to comparison'}
            >
              <input
                type="checkbox"
                checked={isCompareSelected}
                disabled={compareDisabled}
                onChange={onCompareToggle}
                className="rounded"
              />
              Compare
            </label>

            {/* Flag menu */}
            <div className="relative">
              {flagMeta ? (
                <button
                  ref={flagButtonRef}
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
                  ref={flagButtonRef}
                  type="button"
                  onClick={(e) => {
                    e.preventDefault();
                    setFlagMenuOpen((v) => !v);
                  }}
                  className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium text-slate-500 border border-slate-200 hover:bg-slate-50"
                  title="Flag this listing"
                >
                  <Tag className="w-3 h-3" />
                  Flag
                </button>
              )}

              {flagMenuOpen && flagMenuPos && typeof document !== 'undefined' &&
                createPortal(
                  <>
                    {/* click-away overlay — also portaled so it covers
                        the full viewport regardless of any parent
                        overflow/transform ancestry. */}
                    <div
                      className="fixed inset-0 z-[60]"
                      onClick={(e) => {
                        e.preventDefault();
                        setFlagMenuOpen(false);
                      }}
                    />
                    <div
                      className="fixed w-44 bg-white border border-slate-200 rounded-lg shadow-lg z-[70] py-1 text-left"
                      style={{ top: flagMenuPos.top, right: flagMenuPos.right }}
                      onClick={(e) => e.stopPropagation()}
                    >
                      {LISTING_FLAGS.map((f) => (
                        <button
                          key={f.key}
                          type="button"
                          onClick={(e) => {
                            e.preventDefault();
                            onFlagChange(f.key);
                            setFlagMenuOpen(false);
                          }}
                          className={`flex items-center gap-2 w-full px-3 py-1.5 text-xs hover:bg-slate-50 ${
                            flag === f.key ? 'bg-slate-50 font-medium' : ''
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
                          <div className="border-t border-slate-100 my-1" />
                          <button
                            type="button"
                            onClick={(e) => {
                              e.preventDefault();
                              onFlagChange(null);
                              setFlagMenuOpen(false);
                            }}
                            className="flex items-center gap-2 w-full px-3 py-1.5 text-xs text-slate-500 hover:bg-slate-50"
                          >
                            <XCircle className="w-3 h-3" />
                            Clear flag
                          </button>
                        </>
                      )}
                    </div>
                  </>,
                  document.body,
                )}
            </div>

            {isUnscorableAts(listing.ats) ? (
              <span
                className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-slate-50 text-slate-400 border border-slate-200"
                title="This company's careers API doesn't expose full job descriptions, so we can't score it."
              >
                N/A
              </span>
            ) : score && score.totalCount > 0 ? (
              <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-xl text-sm font-bold border ${scoreColor(score.overall)}`}>
                {score.overall}%
              </span>
            ) : score && score.totalCount === 0 ? (
              <span
                className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-slate-50 text-slate-400 border border-slate-200"
                title="No public job description available — we couldn't score this listing."
              >
                N/A
              </span>
            ) : (
              <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-slate-50 text-slate-400 border border-slate-200">
                No score
              </span>
            )}
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                onToggle();
              }}
              className="p-1 hover:bg-slate-100 rounded"
              aria-label={isExpanded ? 'Collapse' : 'Expand'}
            >
              {isExpanded ? (
                <ChevronUp className="w-4 h-4 text-slate-400" />
              ) : (
                <ChevronDown className="w-4 h-4 text-slate-400" />
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Expanded panel */}
      {isExpanded && (
        <div className="border-t border-slate-100 px-5 pb-5 pt-4 space-y-5">
          {/* Action links */}
          <div className="flex gap-3">
            <a
              href={listing.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-50 text-indigo-700 border border-indigo-100 text-sm font-semibold rounded-xl shadow-sm shadow-indigo-500/10 hover:bg-indigo-100 hover:border-indigo-200 hover:shadow-md hover:shadow-indigo-500/15 transition-all duration-200"
            >
              <ExternalLink className="w-4 h-4" /> Apply on {listing.company}
            </a>
            {/* One-click applied/unmark toggle. Surfaced inline next
                to the apply link so users don't have to dig into the
                Tag menu after they apply on the company site.
                Re-uses the existing onFlagChange plumbing. */}
            <button
              type="button"
              onClick={() => onFlagChange(flag === 'applied' ? null : 'applied')}
              className={`inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
                flag === 'applied'
                  ? 'bg-violet-600 text-white hover:bg-violet-700'
                  : 'border border-slate-200 text-slate-700 hover:bg-slate-50'
              }`}
              title={flag === 'applied' ? 'Click to remove the applied flag' : 'Mark this job as applied'}
            >
              {flag === 'applied' ? (
                <><CheckCircle2 className="w-4 h-4" /> Applied</>
              ) : (
                <><Tag className="w-4 h-4" /> I applied</>
              )}
            </button>
            <Link
              href={`/listings/${listing.id}`}
              className="inline-flex items-center gap-2 px-4 py-2 border border-slate-200 text-slate-700 text-sm font-medium rounded-xl hover:bg-slate-50 hover:border-slate-300 transition-all duration-200"
            >
              <FileText className="w-4 h-4" /> View Full Details
            </Link>
          </div>

          <SalaryIntelInline listingId={listing.id} listingSalary={listing.salary} />

          {/* ATS Score Detail */}
          <section className="bg-slate-50 rounded-lg p-4">
            <div className="flex items-center gap-2 mb-3">
              <Target className="w-4 h-4 text-blue-500" />
              <h4 className="text-sm font-semibold text-slate-800">ATS Match Score</h4>
            </div>

            {loadingScore && (
              <div className="flex items-center gap-3 py-4 justify-center">
                <Loader2 className="w-4 h-4 text-blue-500 animate-spin" />
                <span className="text-sm text-slate-500">Analyzing resume...</span>
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
                        <span className="text-xs text-slate-400">Click to select/deselect</span>
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
                                  : 'bg-slate-100 text-slate-400 line-through cursor-pointer hover:bg-gray-200'
                            }`}
                          >
                            {k}
                          </button>
                        );
                      })}
                    </div>
                    {!tailorResult && selectedKeywords.size < detailScore.missingKeywords.length && (
                      <p className="text-xs text-slate-400 mt-1.5">
                        {selectedKeywords.size} of {detailScore.missingKeywords.length} keywords selected for tailoring
                      </p>
                    )}
                  </div>
                </div>

                {/* Resume tailoring suggestions. Each suggestion is a
                    concrete, opt-in edit — mirror JD title, fill a
                    skills gap, mirror a niche phrase, etc. The accepted
                    IDs round-trip to the tailor route as
                    `selectedSuggestions` and dispatch by `kind`
                    (replace-text, append-summary, append-skills).
                    Implemented with native checkbox <label>s so the
                    toggle is unambiguous — clicking either the box or
                    the label text flips state, and stopPropagation
                    prevents any parent expand/collapse handler from
                    swallowing the click. */}
                {detailScore.suggestions && detailScore.suggestions.length > 0 && (
                  <div className="mt-3 pt-3 border-t border-slate-200">
                    <div className="flex items-center gap-2 mb-2">
                      <Sparkles className="w-3.5 h-3.5 text-violet-500" />
                      <span className="font-medium text-slate-700 text-xs">
                        Tailoring Suggestions ({selectedSuggestions.size}/{detailScore.suggestions.length} selected)
                      </span>
                    </div>
                    <div className="space-y-1.5">
                      {detailScore.suggestions.map((s) => {
                        const isSelected = selectedSuggestions.has(s.id);
                        const checkboxId = `suggestion-${listing.id}-${s.id}`;
                        return (
                          <label
                            key={s.id}
                            htmlFor={checkboxId}
                            onClick={(e) => e.stopPropagation()}
                            className={`flex gap-2 items-start p-2 rounded-lg text-xs transition-all border ${
                              tailorResult
                                ? 'bg-violet-50 border-violet-200 cursor-default'
                                : isSelected
                                  ? 'bg-violet-100 border-violet-300 cursor-pointer hover:bg-violet-100'
                                  : 'bg-white border-slate-200 cursor-pointer hover:bg-slate-50'
                            }`}
                          >
                            <input
                              id={checkboxId}
                              type="checkbox"
                              checked={isSelected}
                              disabled={!!tailorResult}
                              onChange={() => toggleSuggestion(s.id)}
                              onClick={(e) => e.stopPropagation()}
                              className="mt-0.5 w-3.5 h-3.5 accent-purple-600 cursor-pointer"
                            />
                            <span className="flex-1 min-w-0">
                              <span className={`block font-semibold ${isSelected ? 'text-slate-800' : 'text-slate-700'}`}>
                                {s.label}
                              </span>
                              <span className={`block mt-0.5 text-[11px] leading-snug ${isSelected ? 'text-slate-600' : 'text-slate-500'}`}>
                                {s.description}
                              </span>
                            </span>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            )}
          </section>

          {/* Notes section — free-form per-listing notes. Auto-saves
              on a 800ms debounce; empty text deletes the note
              server-side. The textarea grows with content so short
              notes don't waste space and long ones don't truncate. */}
          <section className="bg-slate-50 rounded-lg p-4">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <NotebookPen className="w-4 h-4 text-amber-500" />
                <h4 className="text-sm font-semibold text-slate-800">Notes</h4>
              </div>
              <div className="text-[11px] text-slate-400">
                {noteSaving ? (
                  <span className="flex items-center gap-1">
                    <Loader2 className="w-3 h-3 animate-spin" /> Saving…
                  </span>
                ) : noteSavedAt ? (
                  <span title={`Last saved ${new Date(noteSavedAt).toLocaleString()}`}>
                    Saved {formatPostedDate(noteSavedAt) ?? ''}
                  </span>
                ) : null}
              </div>
            </div>
            <textarea
              value={noteText}
              onChange={(e) => handleNoteChange(e.target.value)}
              placeholder="Research, contacts, why this job, why you passed — anything you want attached to this listing. Saves automatically."
              rows={Math.max(3, Math.min(10, noteText.split('\n').length + 1))}
              className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-sm text-slate-700 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-200 focus:border-indigo-300 transition-all resize-y"
              spellCheck
            />
          </section>

          {/* Resume Tailor section */}
          <section className="bg-slate-50 rounded-lg p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <FileText className="w-4 h-4 text-violet-500" />
                <h4 className="text-sm font-semibold text-slate-800">Resume Tailor</h4>
              </div>
              {!tailorResult && (
                <Button
                  onPress={handleTailor}
                  isDisabled={tailoring || !detailScore}
                  size="sm"
                  className="bg-gradient-to-r from-indigo-500 to-violet-500 text-white shadow-sm data-[hovered=true]:from-indigo-600 data-[hovered=true]:to-violet-600 data-[hovered=true]:shadow-md"
                >
                  {tailoring ? (
                    <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Tailoring...</>
                  ) : (
                    <><FileText className="w-3.5 h-3.5" /> Tailor My Resume</>
                  )}
                </Button>
              )}
            </div>

            {!detailScore && !loadingScore && !scoreError && (
              <p className="text-xs text-slate-400">Waiting for score analysis...</p>
            )}

            {detailScore && !tailorResult && !tailoring && !tailorError && (
              <p className="text-xs text-slate-500">
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
                <div className="flex items-center gap-4 p-3 bg-gradient-to-r from-indigo-50 to-violet-50 rounded-lg border border-indigo-100">
                  <div className="text-center">
                    <div className="text-lg font-bold text-slate-400">{tailorResult.originalScore.overall}%</div>
                    <div className="text-xs text-slate-400">Before</div>
                  </div>
                  <div className="text-lg text-slate-300">&rarr;</div>
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
                  <h5 className="text-xs font-medium text-slate-700 mb-1.5">Changes Made</h5>
                  <ul className="space-y-1">
                    {tailorResult.changesSummary.map((c, i) => (
                      <li key={i} className="text-xs text-slate-600 flex gap-1.5">
                        <CheckCircle2 className="w-3.5 h-3.5 text-green-500 shrink-0 mt-0.5" />
                        {c}
                      </li>
                    ))}
                  </ul>
                </div>

                {/* Added keywords */}
                {tailorResult.addedKeywords.length > 0 && (
                  <div>
                    <h5 className="text-xs font-medium text-slate-700 mb-1.5">Keywords Added</h5>
                    <div className="flex flex-wrap gap-1">
                      {tailorResult.addedKeywords.map((k) => (
                        <span key={k} className="px-1.5 py-0.5 bg-violet-100 text-violet-700 rounded text-xs font-medium">{k}</span>
                      ))}
                    </div>
                  </div>
                )}

                {/* Live progress card — visible only while the SSE
                    stream from /api/tailor-resume/stream is in flight.
                    Replaces the previous "is it frozen?" spinner with
                    a stage label, elapsed-time counter, and a thin
                    indeterminate bar so the user can see real activity
                    during the 8–25s pipeline. */}
                {downloading && downloadProgress && (
                  <div className="rounded-xl border border-green-200/70 bg-gradient-to-r from-green-50 via-emerald-50 to-green-50 p-3 shadow-sm animate-fade-in-up">
                    <div className="flex items-center gap-2.5">
                      <Loader2 className="w-4 h-4 text-green-600 animate-spin shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-semibold text-green-900 truncate">
                          {downloadProgress.message || 'Tailoring resume…'}
                        </p>
                        <p className="text-[11px] text-green-700/80">
                          {downloadProgress.elapsedSec}s elapsed
                        </p>
                      </div>
                    </div>
                    <div className="mt-2 h-1 bg-white/60 rounded-full overflow-hidden ring-1 ring-green-100">
                      <div className="h-full bg-gradient-to-r from-green-500 via-emerald-500 to-teal-500 rounded-full animate-shimmer" />
                    </div>
                  </div>
                )}

                {/* Mandatory-mode toggle. Default-ON: the server
                    injects every keyword you selected and runs a
                    compression cascade (margins/spacing/line-height/
                    font shrink) to fit on one page. OFF reverts to
                    the legacy budget ladder, which is more
                    formatting-preserving but can drop keywords on
                    tight resumes. Floors enforced server-side: ≥ 9pt
                    body, ≥ 0.4" margins, no content drops. */}
                <label
                  className="flex items-start gap-2 px-3 py-2 bg-white border border-slate-200 rounded-lg text-xs text-slate-700 cursor-pointer hover:bg-slate-50"
                  title="When ON, the server keeps every keyword you picked and compresses layout to fit. When OFF, keywords may be dropped to preserve formatting."
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
                    <p className="text-[11px] text-slate-500 mt-0.5">
                      Recommended. Injects every selected keyword and tightens margins / line-height / font size as needed (floor: 9pt body, 0.4&quot; margins).
                    </p>
                  </div>
                </label>

                {/* Generate button — runs the tailor pipeline.
                    Label changes to 'Regenerate' once a preview is
                    in hand so it's obvious clicking again replaces
                    the current preview. */}
                <button
                  onClick={handleDownload}
                  disabled={downloading}
                  className="flex items-center gap-2 px-4 py-2 bg-emerald-50 text-emerald-700 border border-emerald-100 text-sm font-semibold rounded-xl shadow-sm shadow-emerald-500/10 hover:bg-emerald-100 hover:border-emerald-200 hover:shadow-md hover:shadow-emerald-500/15 transition-all duration-200 disabled:opacity-50 w-full justify-center"
                >
                  {downloading ? (
                    <><Loader2 className="w-4 h-4 animate-spin" /> Generating PDF…</>
                  ) : previewPdf ? (
                    <><RefreshCw className="w-4 h-4" /> Regenerate Tailored Resume</>
                  ) : (
                    <><FileText className="w-4 h-4" /> Generate Tailored Resume</>
                  )}
                </button>

                {/* In-app PDF preview. iframe with the rendered
                    blob URL — most modern browsers display PDFs
                    natively, so no PDF.js dependency needed. Below
                    the iframe: explicit Download button (since the
                    Generate click no longer auto-downloads) +
                    Discard. Height is tall enough to read a 1-page
                    resume comfortably without dominating the card. */}
                {previewPdf && (
                  <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
                    <div className="flex items-center justify-between px-3 py-2 border-b border-slate-100 bg-slate-50">
                      <div className="flex items-center gap-2 text-xs text-slate-600 min-w-0">
                        <FileText className="w-3.5 h-3.5 shrink-0 text-emerald-600" />
                        <span className="truncate font-medium text-slate-700">
                          {previewPdf.filename}
                        </span>
                        <span className="text-slate-400 shrink-0">
                          ({(previewPdf.sizeBytes / 1024).toFixed(0)} KB)
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <a
                          href={previewPdf.url}
                          download={previewPdf.filename}
                          className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold rounded-lg bg-emerald-50 text-emerald-700 border border-emerald-100 hover:bg-emerald-100 hover:border-emerald-200 transition-all"
                        >
                          <Download className="w-3 h-3" /> Download
                        </a>
                        <button
                          type="button"
                          onClick={() => {
                            if (previewPdf.url) URL.revokeObjectURL(previewPdf.url);
                            setPreviewPdf(null);
                          }}
                          className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-slate-500 hover:bg-slate-100 hover:text-slate-800 rounded-lg transition-all"
                          title="Discard preview (the file is gone from memory; click Regenerate to make a new one)"
                        >
                          <XCircle className="w-3 h-3" /> Discard
                        </button>
                      </div>
                    </div>
                    <iframe
                      src={previewPdf.url}
                      title="Tailored resume preview"
                      className="w-full bg-slate-100"
                      style={{ height: 720 }}
                    />
                  </div>
                )}

                {/* Compression footer — surfaces post-render what the
                    cascade had to do. 'exhausted' as the final token
                    means we couldn't hit 1 page even at max
                    compression and shipped a best-effort multi-page. */}
                {compressionSteps && compressionSteps.length > 0 && (() => {
                  const exhausted = compressionSteps[compressionSteps.length - 1] === 'exhausted';
                  const realSteps = exhausted ? compressionSteps.slice(0, -1) : compressionSteps;
                  return (
                    <div
                      className={`text-[11px] rounded-lg px-3 py-2 border ${
                        exhausted
                          ? 'bg-amber-50 border-amber-200 text-amber-800'
                          : 'bg-emerald-50 border-emerald-200 text-emerald-800'
                      }`}
                    >
                      {exhausted ? (
                        <>
                          <strong>Couldn&apos;t fit on 1 page.</strong> Applied max compression ({realSteps.join(', ')}) but the result is still {'>'} 1 page. Best-effort download served — consider deselecting a few keywords or trimming a bullet in your base resume.
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
            )}
          </section>

          {/* Cover Letter section. Deterministic 3-paragraph generator
              using the resume's most-recent role title, a quantified
              achievement (when present), the JD's mission sentence,
              and the top matched JD keywords. Editable before
              download — the textarea is the source of truth for the
              final .txt file. */}
          <section className="bg-slate-50 rounded-lg p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <FileText className="w-4 h-4 text-blue-500" />
                <h4 className="text-sm font-semibold text-slate-800">Cover Letter</h4>
              </div>
              <button
                type="button"
                onClick={handleGenerateCoverLetter}
                disabled={generatingCover}
                className="flex items-center gap-2 px-3 py-1.5 bg-indigo-50 text-indigo-700 border border-indigo-100 text-xs font-semibold rounded-lg shadow-sm shadow-indigo-500/10 hover:bg-indigo-100 hover:border-indigo-200 hover:shadow-md hover:shadow-indigo-500/15 transition-all duration-200 disabled:opacity-50"
              >
                {generatingCover ? (
                  <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Generating…</>
                ) : coverLetter ? (
                  <><FileText className="w-3.5 h-3.5" /> Regenerate</>
                ) : (
                  <><FileText className="w-3.5 h-3.5" /> Generate Cover Letter</>
                )}
              </button>
            </div>

            {coverError && (
              <div className="text-xs text-red-700 bg-red-50 border border-red-100 rounded-lg px-3 py-2 mb-2">
                {coverError}
              </div>
            )}

            {!coverLetter && !coverError && (
              <p className="text-xs text-slate-400">
                Generates a personalized 3-paragraph cover letter using your resume + the JD.
                You can edit before downloading.
              </p>
            )}

            {coverLetter && (
              <div className="space-y-2">
                <textarea
                  value={coverLetter.text}
                  onChange={(e) => setCoverLetter({ ...coverLetter, text: e.target.value })}
                  rows={14}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs font-mono text-slate-700 bg-white focus:ring-2 focus:ring-indigo-200 focus:border-indigo-300 outline-none resize-y"
                  spellCheck
                />
                {coverLetter.matchedKeywords.length > 0 && (
                  <p className="text-[11px] text-slate-500">
                    Used these matched keywords as proof-of-fit: <span className="font-medium text-slate-700">{coverLetter.matchedKeywords.join(', ')}</span>
                  </p>
                )}
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={handleDownloadCoverLetter}
                    className="flex items-center gap-2 px-4 py-2 bg-emerald-50 text-emerald-700 border border-emerald-100 text-sm font-semibold rounded-xl shadow-sm shadow-emerald-500/10 hover:bg-emerald-100 hover:border-emerald-200 hover:shadow-md hover:shadow-emerald-500/15 transition-all duration-200"
                  >
                    <Download className="w-4 h-4" /> Download as .txt
                  </button>
                  <button
                    type="button"
                    onClick={() => navigator.clipboard.writeText(coverLetter.text).catch(() => {})}
                    className="flex items-center gap-2 px-4 py-2 border border-slate-200 text-slate-700 text-sm font-medium rounded-xl hover:bg-slate-50 hover:border-slate-300 transition-all duration-200"
                  >
                    Copy to Clipboard
                  </button>
                </div>
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  );
}

// ─── LinkedIn Network badge ─────────────────────────────────────────
// Shows "N at <Company>" when the user's imported network has any
// contacts there. Lazy-fetches on mount; renders nothing on miss.

interface BadgeContact {
  firstName: string;
  lastName: string;
  position?: string;
  url?: string;
}

function NetworkBadge({ company }: { company: string }) {
  const [contacts, setContacts] = useState<BadgeContact[]>([]);
  const [open, setOpen] = useState(false);
  // Anchor position for the portaled popover. The badge itself sits
  // inside a job card whose ancestors have `overflow: hidden` and a
  // stacking context, so an absolute-positioned popover gets clipped
  // by the next card below it. Portaling to document.body with fixed
  // coords escapes that — same pattern as the flag dropdown.
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const [popoverPos, setPopoverPos] = useState<{ top: number; left: number } | null>(null);
  const recomputePos = useCallback(() => {
    const btn = buttonRef.current;
    if (!btn) return;
    const rect = btn.getBoundingClientRect();
    setPopoverPos({
      top: rect.bottom + 4,          // 4px gap below the badge
      left: rect.left,                // left-align with the badge
    });
  }, []);
  useEffect(() => {
    if (!open) return;
    recomputePos();
    const onChange = () => recomputePos();
    window.addEventListener('scroll', onChange, true);
    window.addEventListener('resize', onChange);
    return () => {
      window.removeEventListener('scroll', onChange, true);
      window.removeEventListener('resize', onChange);
    };
  }, [open, recomputePos]);
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/network?company=${encodeURIComponent(company)}`)
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return;
        if (Array.isArray(d.contacts)) setContacts(d.contacts);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [company]);
  if (contacts.length === 0) return null;
  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-indigo-100 text-indigo-700 hover:bg-indigo-200 transition-colors"
        title={`${contacts.length} of your LinkedIn connections currently at ${company} — click to expand`}
      >
        <Users className="w-3 h-3" />
        {contacts.length} you know
      </button>
      {open && popoverPos && typeof document !== 'undefined' &&
        createPortal(
        <>
          <div
            className="fixed inset-0 z-[60]"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setOpen(false);
            }}
          />
          <div
            className="fixed w-72 bg-white border border-slate-200 rounded-xl shadow-modal z-[70] p-2 text-left"
            style={{ top: popoverPos.top, left: popoverPos.left }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="text-[11px] uppercase tracking-wide text-slate-400 px-1 pb-1">
              At {company} ({contacts.length})
            </div>
            <ul className="max-h-72 overflow-y-auto divide-y divide-gray-100">
              {contacts.map((c, i) => {
                const name = `${c.firstName} ${c.lastName}`.trim();
                return (
                  <li key={`${name}-${i}`} className="py-1.5 px-1">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="text-xs font-medium text-slate-800 truncate">
                          {name || 'Unknown'}
                        </div>
                        {c.position && (
                          <div className="text-[11px] text-slate-500 truncate">
                            {c.position}
                          </div>
                        )}
                      </div>
                      {c.url && (
                        <a
                          href={c.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="shrink-0 inline-flex items-center gap-0.5 text-[11px] text-blue-600 hover:text-blue-700 hover:underline"
                          onClick={(e) => e.stopPropagation()}
                        >
                          LinkedIn
                          <ExternalLink className="w-3 h-3" />
                        </a>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        </>,
          document.body,
        )}
    </>
  );
}

// ─── Salary Intelligence (inline strip) ─────────────────────────────
// Pulls a peer cohort from the user's own listings cache and shows
// median + p25/p75 alongside the listing's posted salary. Lazy fetch
// on expand; gracefully hides when the peer cohort is too small.

function SalaryIntelInline({
  listingId,
  listingSalary,
}: {
  listingId: string;
  listingSalary: string | null;
}) {
  const [stats, setStats] = useState<{
    n: number;
    median: number;
    p25: number;
    p75: number;
    confidence: 'low' | 'medium' | 'high';
    scope: string;
  } | null>(null);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    fetch(`/api/salary-intel?listingId=${encodeURIComponent(listingId)}`)
      .then((r) => r.json())
      .then((d) => setStats(d.stats))
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, [listingId]);
  if (!loaded || !stats) return null;
  const fmt = (v: number) => `$${Math.round(v / 1000)}k`;
  const confidenceStyle: Record<typeof stats.confidence, string> = {
    high: 'text-green-700 bg-green-100',
    medium: 'text-amber-700 bg-amber-100',
    low: 'text-slate-600 bg-slate-100',
  };
  return (
    <div className="flex items-center gap-3 px-4 py-2.5 bg-gradient-to-r from-emerald-50 to-teal-50 border border-emerald-100 rounded-lg text-xs">
      <DollarSign className="w-4 h-4 text-emerald-600 shrink-0" />
      <div className="flex-1 min-w-0 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="font-semibold text-emerald-900">
          Market: {fmt(stats.p25)}–{fmt(stats.p75)}
        </span>
        <span className="text-emerald-800/80">
          median {fmt(stats.median)}
        </span>
        <span className="text-emerald-700/70">{stats.scope}</span>
        {listingSalary && (
          <span className="text-slate-500">· This posting: {listingSalary}</span>
        )}
      </div>
      <span
        className={`px-2 py-0.5 rounded-full font-medium ${confidenceStyle[stats.confidence]}`}
        title={`${stats.n} comparable postings in your listings cache`}
      >
        n={stats.n}
      </span>
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
    // Compact form — nested inside the Filters drawer. No outer card
    // background (drawer already provides one); inline label + chips
    // keep the section to a single visual row when there's only the
    // auto-detected current employer.
    <div className="flex items-center gap-2 flex-wrap">
      <EyeOff className="w-3.5 h-3.5 text-slate-400 shrink-0" />
      <span className="text-xs font-medium text-slate-500 shrink-0">
        Excluded companies
        {hiddenCount > 0 && (
          <span className="text-slate-400 font-normal"> · hiding {hiddenCount}</span>
        )}
        :
      </span>
        {excluded.length === 0 && (
          <span className="text-xs text-slate-400 italic">
            {autoDetected ? `None — detected ${autoDetected}` : 'None'}
          </span>
        )}
        {excluded.map((name) => (
          <span
            key={name}
            className="inline-flex items-center gap-1 px-2 py-0.5 bg-white border border-slate-200 rounded-full text-xs text-slate-700"
          >
            {name}
            {autoDetected && name.toLowerCase() === autoDetected.toLowerCase() && (
              <span className="text-[10px] text-slate-400">(auto)</span>
            )}
            <button
              type="button"
              onClick={() => remove(name)}
              className="text-slate-400 hover:text-red-500"
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
            className="w-full px-2 py-1 text-xs bg-white border border-slate-200 rounded focus:ring-2 focus:ring-indigo-200 focus:border-indigo-300 outline-none"
          />
          {showSuggestions && suggestions.length > 0 && (
            <div className="absolute left-0 top-full mt-1 w-full bg-white border border-slate-200 rounded-md shadow-lg z-20 max-h-48 overflow-y-auto">
              {suggestions.map((s) => (
                <button
                  key={s}
                  type="button"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    add(s);
                  }}
                  className="block w-full text-left px-2 py-1 text-xs text-slate-700 hover:bg-blue-50"
                >
                  {s}
                </button>
              ))}
            </div>
          )}
        </div>
    </div>
  );
}
