'use client';

import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import {
  Search, RefreshCw, MapPin, Calendar, Building2, ExternalLink,
  DollarSign, Filter, ChevronDown, ChevronUp, ChevronRight, Loader2, AlertCircle,
  Target, Download, FileText, AlertTriangle, CheckCircle2, XCircle,
  Tag, EyeOff, Eye, Globe, Sparkles, Check, Users, NotebookPen,
  Mic, MicOff, X,
} from 'lucide-react';
import type { JobListing, ScoreCacheEntry, ListingFlag, ListingFlagEntry, Settings, WorkMode } from '@/lib/types';
import { LISTING_FLAGS, LEVEL_TIERS } from '@/lib/types';
import { CompanyLogo } from '@/components/company-logo';
import { Card, Chip } from '@heroui/react';
import { Button } from '@/components/ui/button';
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
import { diffResume } from '@/lib/text-diff';
import { isNonUsdSalary } from '@/lib/salary-parser';

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

/**
 * Score-category bar. Used in the per-listing ATS Match Score panel.
 *
 * Optional coaching affordance — when (a) the category is weak, (b)
 * there ARE missing keywords for it in this listing's JD, and (c) the
 * caller wires an `onAlertClick`, the bar grows a small amber ⚠ button
 * to the right of the score that opens a per-category fix popover.
 *
 * When the user has already selected ≥1 keyword from this category
 * for the next tailor, the ⚠ flips to a check pill showing the count
 * — quiet confirmation that the picks landed without re-opening the
 * popover.
 */
function CategoryBar({
  label,
  score,
  missingCount = 0,
  selectedCount = 0,
  onAlertClick,
  buttonRef,
}: {
  label: string;
  score: number;
  /** Total missing keywords for this category in the listing's JD.
   *  When 0, the ⚠ is hidden — there's nothing to pick. */
  missingCount?: number;
  /** How many of those missing keywords the user has staged for the
   *  next tailor (across all popovers). Renders a small badge so the
   *  caller doesn't have to expose another row. */
  selectedCount?: number;
  /** Click handler for the ⚠ icon. When omitted, the icon doesn't
   *  render at all (legacy callers stay unchanged). */
  onAlertClick?: () => void;
  /** Forwarded so the popover can anchor itself to the icon. */
  buttonRef?: React.RefObject<HTMLButtonElement | null>;
}) {
  const color = score >= 75 ? "bg-gradient-to-r from-emerald-500 to-teal-500" : score >= 50 ? "bg-gradient-to-r from-amber-400 to-orange-400" : "bg-gradient-to-r from-rose-400 to-pink-400";
  // Show coaching trigger when the bar is weak and there's something
  // actionable to pick. Threshold mirrors the dashboard (< 80).
  const showCoach = !!onAlertClick && score < 80 && missingCount > 0;
  return (
    <div className="flex items-center gap-2">
      {/* Tightened from w-24 → w-20: the longest label ("Soft Skills")
          fits in ~70px at text-xs, w-20 (80px) is enough with breathing
          room. Gives the bar +16px per row. */}
      <span className="text-xs text-slate-500 w-20 text-right shrink-0">{label}</span>
      <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden">
        <div className={`h-full rounded-full transition-all duration-700 ${color}`} style={{ width: `${score}%` }} />
      </div>
      <span className="text-xs font-semibold text-slate-700 w-10 text-right shrink-0">{score}%</span>
      {/* Trigger slot tightened from w-14 → w-9 (36px). The at-rest
          ⚠ no longer carries a count (the matched/missing summary
          below the bars already reports totals), so the icon-only
          button is ~28px and fits cleanly. When the user has staged
          items the button shows "✓ N" and may bleed a few px past
          the slot — acceptable for staged counts ≤9. */}
      <div className="w-9 shrink-0 flex justify-end">
        {showCoach && (
          <button
            ref={buttonRef}
            type="button"
            onClick={onAlertClick}
            className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-semibold border transition-colors ${
              selectedCount > 0
                ? 'bg-indigo-50 text-indigo-700 border-indigo-200 hover:bg-indigo-100'
                : 'bg-amber-50 text-amber-700 border-amber-100 hover:bg-amber-100'
            }`}
            title={
              selectedCount > 0
                ? `${selectedCount} of ${missingCount} ${label} keyword${missingCount === 1 ? '' : 's'} staged for tailor — click to edit`
                : `${missingCount} missing ${label} keyword${missingCount === 1 ? '' : 's'} — click to pick`
            }
            aria-label={`Fix ${label}`}
          >
            {selectedCount > 0 ? (
              <>
                <Check className="w-3 h-3" /> {selectedCount}
              </>
            ) : (
              <AlertCircle className="w-3 h-3" />
            )}
          </button>
        )}
      </div>
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
  /** Per-keyword breakdown — used by the Quick-wins panel to rank
   *  missing keywords by their category's weight in the overall
   *  score. The server-side ATSScore already includes this; the
   *  local mirror just declares the field so TypeScript doesn't
   *  trip over `keywordDetails` access. */
  keywordDetails?: { keyword: string; category: 'technical' | 'management' | 'domain' | 'soft'; found: boolean }[];
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
  // "Only new since last visit" filter — drops listings the user has
  // already seen on a prior visit. Driven by Settings.listingsLastVisitedAt
  // which we read once on mount; we re-stamp the timestamp AFTER read
  // so toggling the filter still shows the same set within a single
  // session.
  const [onlyNewSinceVisit, setOnlyNewSinceVisit] = useState(false);
  const [lastVisitedAt, setLastVisitedAt] = useState<string | null>(null);
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

  // Dashboard → listings deep link. When the user clicks "Improve" on
  // a CategoryBar in the Resume Performance card, the dashboard sends
  // them here with ?weakCategory=technical|management|domain|soft.
  // We surface a small banner and, on first paint with listings in
  // hand, auto-expand the highest-scoring listing so the user lands
  // one click away from its per-listing Quick Wins panel (which
  // already ranks missing keywords by category weight).
  const [weakCategory, setWeakCategory] = useState<string | null>(null);
  // Opt-in fix titles the user checked in the dashboard popover. Read
  // from sessionStorage so the banner can echo them back — gives the
  // user a visible reminder of their chosen punch list as they open
  // the highest-match listing.
  const [weakCategoryFixes, setWeakCategoryFixes] = useState<{ id: string; title: string }[]>([]);
  const [autoExpandedForWeakCat, setAutoExpandedForWeakCat] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const wc = params.get('weakCategory');
    if (wc && ['technical', 'management', 'domain', 'soft'].includes(wc)) {
      setWeakCategory(wc);
      // Pull the chosen fix titles (if any) that the dashboard popover
      // stashed. We DON'T clear the storage here so a page reload
      // still surfaces the reminder until the user dismisses the
      // banner explicitly.
      try {
        const raw = sessionStorage.getItem('weakCategoryFixes');
        if (raw) {
          const parsed = JSON.parse(raw);
          if (parsed?.category === wc && Array.isArray(parsed.fixes)) {
            setWeakCategoryFixes(parsed.fixes);
          }
        }
      } catch {
        // sessionStorage may be unavailable — banner still works
        // with the category-only fallback path.
      }
      // Clean the URL so a reload doesn't re-fire the banner — same
      // pattern the share-target prefill on /jobs/add uses.
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, []);

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
      // Capture the previous "last visited" timestamp BEFORE we stamp
      // the new one, so the "only new since last visit" filter has a
      // stable cutoff for this session. Then update the timestamp on
      // the server so the next session compares against this visit.
      if (d.settings.listingsLastVisitedAt) {
        setLastVisitedAt(d.settings.listingsLastVisitedAt);
      }
      fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ listingsLastVisitedAt: new Date().toISOString() }),
      }).catch(() => {});

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
    // Salary filter — keep listings missing salary data unless
    // salaryOnly is on. Listings denominated in a non-USD currency
    // (e.g. "$120k–$160k CAD") skip the floor/ceiling compare because
    // the user's min/max are USD-only — directly comparing dollar
    // amounts across currencies leaks listings that look like they
    // pass but don't (CAD ≈ 0.73 USD).
    if (minSalary != null || maxSalary != null || salaryOnly) {
      result = result.filter((l) => {
        const hasSalary = l.salaryMin != null || l.salaryMax != null;
        if (!hasSalary) return !salaryOnly;
        if (isNonUsdSalary(l.salary, l.salaryCurrency)) return true;
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
    // "Only new since last visit" filter — drops listings whose
    // fetchedAt is at-or-before the cutoff captured at page load.
    // If we never recorded a last visit (first time on this page),
    // the filter is a no-op so the user doesn't see an empty page.
    if (onlyNewSinceVisit && lastVisitedAt) {
      const cutoff = Date.parse(lastVisitedAt);
      if (!isNaN(cutoff)) {
        result = result.filter((l) => {
          const stamp = l.fetchedAt || l.postedAt;
          if (!stamp) return false;
          const t = Date.parse(stamp);
          if (isNaN(t)) return false;
          return t > cutoff;
        });
      }
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
  }, [listings, search, searchInJd, jdMatchIds, selectedCompany, locationPreset, selectedDepartment, scoreCache, flags, showFlagged, locationMatcher, prefs.workMode, minSalary, maxSalary, salaryOnly, selectedLevels, hideStale, datePosted, minScore, maxScore, onlyNewSinceVisit, lastVisitedAt]);

  const flaggedCount = useMemo(
    () => listings.filter((l) => flags[l.id]).length,
    [listings, flags]
  );

  // Salary midpoints across every Applied-flagged listing that has
  // parseable salary data. Fed into each ListingCard's Pay Snapshot
  // so the rank-among-applied comparison renders without each card
  // having to re-scan the whole listings array. Stable identity
  // across renders that don't change flags/listings.
  const appliedSalaryMids = useMemo(() => {
    const mids: number[] = [];
    for (const l of listings) {
      if (flags[l.id]?.flag !== 'applied') continue;
      const min = l.salaryMin;
      const max = l.salaryMax;
      if (min != null && max != null) mids.push((min + max) / 2);
      else if (min != null) mids.push(min);
      else if (max != null) mids.push(max);
    }
    return mids;
  }, [listings, flags]);

  // Paginate
  const totalPages = Math.ceil(filtered.length / pageSize);
  const paginated = filtered.slice((page - 1) * pageSize, page * pageSize);

  // Deep-link auto-expand. When the dashboard sent us here with a
  // weakCategory query param, expand the highest-scoring listing on
  // the first page so the user lands inside that listing's Score
  // panel — the per-listing Quick Wins panel ranks missing keywords
  // by category weight, completing the dashboard → tailor handoff.
  useEffect(() => {
    if (!weakCategory) return;
    if (autoExpandedForWeakCat) return;
    if (paginated.length === 0) return;
    const top = paginated[0];
    setExpandedId(top.id);
    setAutoExpandedForWeakCat(true);
  }, [weakCategory, autoExpandedForWeakCat, paginated]);

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
          size="lg"
          onClick={streamingRefresh}
          isLoading={refreshing}
          leftIcon={!refreshing ? <RefreshCw className="w-4 h-4" /> : undefined}
        >
          {refreshing ? 'Fetching Jobs…' : 'Fetch Job Listings'}
        </Button>
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6 max-w-[1400px] mx-auto animate-fade-in">
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

      {/* Header — stacks vertically on mobile so the title doesn't
          fight the Refresh All button for the same row; goes inline
          again above sm: where there's room for both. */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight bg-gradient-to-r from-slate-800 via-indigo-600 to-violet-600 bg-clip-text text-transparent">
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
          size="md"
          onClick={streamingRefresh}
          isLoading={refreshing}
          leftIcon={!refreshing ? <RefreshCw className="w-4 h-4" /> : undefined}
          className="self-start sm:self-auto"
        >
          {refreshing ? 'Refreshing…' : 'Refresh All'}
        </Button>
      </div>

      {/* Dashboard → listings deep-link banner. When the dashboard
          popover handed off the user with checked fixes, surface them
          as a punch list so the user has a visible reminder while
          they triage. Otherwise falls back to the category-only
          version. Dismissing clears both the banner state and the
          sessionStorage so it doesn't re-appear on the next visit. */}
      {weakCategory && (() => {
        const labels: Record<string, string> = {
          technical: 'Technical', management: 'Management',
          domain: 'Domain', soft: 'Soft Skills',
        };
        const dismiss = () => {
          setWeakCategory(null);
          setWeakCategoryFixes([]);
          try { sessionStorage.removeItem('weakCategoryFixes'); } catch { /* noop */ }
        };
        return (
          <div className="mb-4 px-4 py-3 rounded-lg border border-indigo-200/70 bg-gradient-to-r from-indigo-50 to-violet-50 animate-fade-in-up">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-start gap-2 text-sm min-w-0">
                <Target className="w-4 h-4 text-indigo-600 shrink-0 mt-0.5" />
                <div className="min-w-0">
                  <div className="text-indigo-900">
                    Improving <strong>{labels[weakCategory] ?? weakCategory}</strong>.
                    <span className="text-indigo-700/80">
                      {' '}Open any listing&apos;s <span className="font-medium">Quick wins</span> panel to target this category in the next tailor.
                    </span>
                  </div>
                  {weakCategoryFixes.length > 0 && (
                    <ul className="mt-2 space-y-0.5">
                      {weakCategoryFixes.map((f) => (
                        <li key={f.id} className="text-[12px] text-indigo-800/90 flex items-start gap-1.5">
                          <Check className="w-3 h-3 mt-0.5 shrink-0 text-indigo-500" />
                          <span>{f.title}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
              <button
                type="button"
                onClick={dismiss}
                className="shrink-0 p-1 rounded text-indigo-400 hover:bg-indigo-100 hover:text-indigo-700"
                aria-label="Dismiss"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
        );
      })()}

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
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
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
                  {/* New-since-visit filter — drops listings the user
                      already saw on a prior visit. Disabled (with hint)
                      on first-ever visit when we have no cutoff. */}
                  <label
                    className={`flex items-center gap-1.5 text-xs cursor-pointer ${
                      lastVisitedAt ? 'text-slate-500' : 'text-slate-300 cursor-not-allowed'
                    }`}
                    title={
                      lastVisitedAt
                        ? `Shows only listings fetched after your last visit (${new Date(lastVisitedAt).toLocaleString()})`
                        : "We'll start tracking from this visit — come back to use this filter."
                    }
                  >
                    <input
                      type="checkbox"
                      checked={onlyNewSinceVisit}
                      onChange={(e) => setOnlyNewSinceVisit(e.target.checked)}
                      disabled={!lastVisitedAt}
                      className="rounded"
                    />
                    Only new since last visit
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
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
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
              userSalaryFloor={prefs.salaryMin ?? null}
              appliedSalaryMids={appliedSalaryMids}
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
  userSalaryFloor,
  appliedSalaryMids,
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
  /** settings.salaryMin, for the "vs your floor" badge in Pay
   *  Snapshot. Null when the user hasn't set one. */
  userSalaryFloor: number | null;
  /** Midpoints of every Applied-flagged listing with parseable
   *  salary. Used for the rank-among-applied comparison. */
  appliedSalaryMids: number[];
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
  // Notes are collapsed by default — they're a power-user feature
  // and most listings never get one. Auto-expand when we discover
  // existing content on load (handled in the noteText fetch effect)
  // so the user never thinks their note has disappeared.
  const [notesExpanded, setNotesExpanded] = useState(false);
  const [noteSaving, setNoteSaving] = useState(false);
  const [noteSavedAt, setNoteSavedAt] = useState<string | null>(null);
  const noteTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Cover-letter template library. Lazy-loaded on expand. The
  // 'Save as template' button takes the current textarea contents
  // and posts it; the picker loads a saved template into the
  // textarea (clobbers current contents, with a confirm when there
  // are unsaved edits).
  const [coverTemplates, setCoverTemplates] = useState<{ id: string; name: string; text: string }[]>([]);
  const [savingTemplate, setSavingTemplate] = useState(false);
  useEffect(() => {
    if (!isExpanded) return;
    let cancelled = false;
    fetch('/api/cover-letter-templates')
      .then((r) => r.json())
      .then((d) => {
        if (!cancelled && Array.isArray(d.templates)) setCoverTemplates(d.templates);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [isExpanded]);

  // Resume-diff modal state. After tailoring, the user can open a
  // line-by-line diff of the base resume vs the tailored output.
  // Tailored text comes from tailorResult.tailoredText (already
  // populated by the analyze pass). The base text is lazy-fetched
  // from /api/resume on first open so we don't preload it on every
  // card expand.
  const [diffOpen, setDiffOpen] = useState(false);
  const [diffBaseText, setDiffBaseText] = useState<string | null>(null);
  // 'unified' = the original single-column view (red-then-amber stacked
  // pairs); 'split' = two columns (base on the left, tailored on the
  // right) with the rows aligned so you can scan a change horizontally.
  const [diffView, setDiffView] = useState<'unified' | 'split'>('split');
  // Mobile force-flip. Side-by-side at 375px would give two ~150px
  // columns of mono text — unreadable. We track the viewport via a
  // matchMedia subscription and treat `isNarrow=true` as "always
  // unified" regardless of the user's toggle selection. The toggle
  // itself is hidden below sm: so the user doesn't see a button that
  // would do nothing.
  const [isNarrow, setIsNarrow] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mq = window.matchMedia('(max-width: 639px)');
    const update = () => setIsNarrow(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);
  const effectiveDiffView: 'unified' | 'split' = isNarrow ? 'unified' : diffView;
  useEffect(() => {
    if (!diffOpen || diffBaseText !== null) return;
    fetch('/api/resume')
      .then((r) => r.json())
      .then((d) => setDiffBaseText(typeof d.text === 'string' ? d.text : ''))
      .catch(() => setDiffBaseText(''));
  }, [diffOpen, diffBaseText]);

  // Per-keyword scoring explanation. Click the magnifying-glass on
  // a missing-keyword chip → opens a popover showing the JD
  // sentences that mention this keyword, so the user can see WHY
  // the scorer flagged it as missing. Lazy-fetches on demand.
  const [keywordContext, setKeywordContext] = useState<{
    keyword: string;
    sentences: string[];
    loading: boolean;
    anchor: { top: number; left: number };
  } | null>(null);
  async function openKeywordContext(keyword: string, btn: HTMLElement) {
    const rect = btn.getBoundingClientRect();
    setKeywordContext({
      keyword,
      sentences: [],
      loading: true,
      anchor: { top: rect.bottom + 4, left: rect.left },
    });
    try {
      const res = await fetch(
        `/api/keyword-context?listingId=${encodeURIComponent(listing.id)}&keyword=${encodeURIComponent(keyword)}`,
      );
      const data = await res.json();
      setKeywordContext((prev) =>
        prev?.keyword === keyword
          ? { ...prev, sentences: data.sentences ?? [], loading: false }
          : prev,
      );
    } catch {
      setKeywordContext((prev) =>
        prev?.keyword === keyword ? { ...prev, sentences: [], loading: false } : prev,
      );
    }
  }

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
  // Which per-category popover (if any) is currently open. Each
  // category's ⚠ button toggles it. The popover writes back into
  // `selectedKeywords` directly so the Tailor button below the
  // score panel consumes the aggregate selection across categories.
  // Cleared on Tailor click so the user lands in the result strip
  // without leftover overlays.
  const [openScoreCategory, setOpenScoreCategory] = useState<'technical' | 'management' | 'domain' | 'soft' | null>(null);
  const techBtnRef = useRef<HTMLButtonElement | null>(null);
  const mgmtBtnRef = useRef<HTMLButtonElement | null>(null);
  const domainBtnRef = useRef<HTMLButtonElement | null>(null);
  const softBtnRef = useRef<HTMLButtonElement | null>(null);
  // Keywords the user has REJECTED after seeing the first tailored
  // result — they were originally selected and accepted, but on review
  // the user decided they don't want them. Subtracted from selected
  // when re-tailoring. Resets every time a fresh tailor finishes (any
  // re-tailor produces a new acceptance baseline).
  const [rejectedKeywords, setRejectedKeywords] = useState<Set<string>>(new Set());
  const [keywordsInitialized, setKeywordsInitialized] = useState(false);

  // Suggestion-selection state. Same model as keywords: server returns
  // a list, all selected by default; user toggles individually; the
  // selected IDs ride along on the tailor request.
  const [selectedSuggestions, setSelectedSuggestions] = useState<Set<string>>(new Set());
  const [suggestionsInitialized, setSuggestionsInitialized] = useState(false);
  // Strategic-edits drawer in the Resume Tailor section. Collapsed
  // by default so the section's primary affordance (Tailor button +
  // staged-status row) stays uncluttered; opt-in opens the edits.
  const [suggestionsExpanded, setSuggestionsExpanded] = useState(false);

  // Initialize selected keywords + suggestions when score loads.
  useEffect(() => {
    // Note: we deliberately DON'T auto-select missing keywords or
    // suggestions anymore. The new flow is "open ⚠ → pick what you
    // have backing for". Auto-seeding everything led to users firing
    // tailors with default selections they hadn't actually reviewed
    // (matchedKeywords includes long-tail terms they wouldn't endorse).
    if (detailScore && !keywordsInitialized) {
      setKeywordsInitialized(true);
    }
    if (detailScore && !suggestionsInitialized) {
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
          // Existing note → auto-open the collapsed Notes section so
          // the content is visible without an extra click.
          if (d.note.text.trim()) setNotesExpanded(true);
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
    // Close any open per-category fix popover so the user lands in
    // the result strip without overlays leftover from the picking flow.
    setOpenScoreCategory(null);
    setTailoring(true);
    setTailorError(null);
    try {
      // Subtract any keywords the user rejected after seeing the first
      // tailor. On the first call rejectedKeywords is empty so this is
      // equivalent to the previous behavior.
      const effectiveKeywords = Array.from(selectedKeywords).filter(
        (k) => !rejectedKeywords.has(k),
      );
      const res = await fetch('/api/tailor-resume', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          listingId: listing.id,
          format: 'json',
          selectedKeywords: effectiveKeywords,
          selectedSuggestions: Array.from(selectedSuggestions),
          mode: mandatoryMode ? 'mandatory' : 'budget-ladder',
        }),
      });
      const data = await res.json();
      if (data.error) setTailorError(data.error);
      else {
        setTailorResult(data);
        // Fresh tailor — clear any prior rejections so the new
        // addedKeywords set is the baseline for further rejection.
        setRejectedKeywords(new Set());
      }
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
        className="w-full text-left p-4 sm:p-5 cursor-pointer"
      >
        {/* Header — on mobile the title gets its own full-width row
            (so it isn't truncated by the Flag pill + Score badge eating
            the right side), and the Flag/Score/Chevron drop below as a
            small actions strip. Above sm: we go back to the inline
            two-column layout. */}
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2 sm:gap-4">
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
              <NetworkBadge company={listing.company} listingId={listing.id} />
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
            className="sm:shrink-0 flex items-center gap-3 self-end sm:self-auto"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Bulk-select checkbox — ticking one or more cards
                surfaces a floating bulk-actions bar (flag / archive
                / clear) at the bottom of the page. Independent of
                the Compare checkbox so a card can be in both sets
                simultaneously. */}
            <label
              className="hidden sm:inline-flex items-center gap-1 text-xs select-none cursor-pointer text-slate-600 hover:text-slate-800"
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
                cap (3) is hit unless this card is already selected.
                Hidden on mobile — same reasoning as Select above. */}
            <label
              className={`hidden sm:inline-flex items-center gap-1 text-xs select-none ${
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

          <SalaryIntelInline
            listing={listing}
            userSalaryFloor={userSalaryFloor}
            appliedSalaryMids={appliedSalaryMids}
          />


          {/* 3-col grid wrapping the primary application-prep
              sections: ATS Match Score | Resume Tailor | Cover Letter.
              `items-stretch` (default) + `h-full flex flex-col` on
              each section makes every column the same visual height
              regardless of content — the bg-slate-50 cards used to
              look mismatched when one column was much taller. */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">

          {/* ATS Score Detail */}
          <section className="bg-slate-50 rounded-lg p-4 h-full flex flex-col">
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

            {detailScore && (() => {
              // Build missing-keyword lists per category from
              // keywordDetails. Bigram phrases live outside the
              // category taxonomy (they don't have a category field)
              // so the popovers cover only the 4 taxonomy buckets.
              // That's the entire actionable surface for tailor —
              // phrases get strategic-edit treatment via the
              // Tailoring Suggestions block below.
              const details = detailScore.keywordDetails ?? [];
              const missingByCat = {
                technical: details.filter((d) => d.category === 'technical' && !d.found).map((d) => d.keyword),
                management: details.filter((d) => d.category === 'management' && !d.found).map((d) => d.keyword),
                domain: details.filter((d) => d.category === 'domain' && !d.found).map((d) => d.keyword),
                soft: details.filter((d) => d.category === 'soft' && !d.found).map((d) => d.keyword),
              };
              const selCountFor = (kws: string[]) => kws.filter((k) => selectedKeywords.has(k)).length;
              const totalSelected = selectedKeywords.size;
              const totalMissingTaxonomy =
                missingByCat.technical.length + missingByCat.management.length +
                missingByCat.domain.length + missingByCat.soft.length;
              return (
              <div>
                <div className="flex items-start gap-3 mb-4">
                  <ScoreRing score={detailScore.overall} size={90} label="Overall" />
                  <div className="flex-1 min-w-0 space-y-2 pt-1">
                    <CategoryBar
                      label="Technical"
                      score={detailScore.technical}
                      missingCount={missingByCat.technical.length}
                      selectedCount={selCountFor(missingByCat.technical)}
                      onAlertClick={tailorResult ? undefined : () => setOpenScoreCategory(openScoreCategory === 'technical' ? null : 'technical')}
                      buttonRef={techBtnRef}
                    />
                    <CategoryBar
                      label="Management"
                      score={detailScore.management}
                      missingCount={missingByCat.management.length}
                      selectedCount={selCountFor(missingByCat.management)}
                      onAlertClick={tailorResult ? undefined : () => setOpenScoreCategory(openScoreCategory === 'management' ? null : 'management')}
                      buttonRef={mgmtBtnRef}
                    />
                    <CategoryBar
                      label="Domain"
                      score={detailScore.domain}
                      missingCount={missingByCat.domain.length}
                      selectedCount={selCountFor(missingByCat.domain)}
                      onAlertClick={tailorResult ? undefined : () => setOpenScoreCategory(openScoreCategory === 'domain' ? null : 'domain')}
                      buttonRef={domainBtnRef}
                    />
                    <CategoryBar
                      label="Soft Skills"
                      score={detailScore.soft}
                      missingCount={missingByCat.soft.length}
                      selectedCount={selCountFor(missingByCat.soft)}
                      onAlertClick={tailorResult ? undefined : () => setOpenScoreCategory(openScoreCategory === 'soft' ? null : 'soft')}
                      buttonRef={softBtnRef}
                    />
                  </div>
                </div>

                {/* Compact aggregate status. The "staged for tailor"
                    pill that used to live here is gone — the cart
                    in the Resume Tailor card is now the single
                    source of truth for what's queued. This row just
                    keeps the at-a-glance matched/missing count. */}
                <div className="mb-3 px-3 py-2 rounded-lg bg-slate-50 border border-slate-100 flex items-center justify-between gap-3 text-xs">
                  <span className="text-slate-600">
                    <span className="font-semibold text-slate-800">{detailScore.totalMatched}</span> matched
                    {' · '}
                    <span className="font-semibold text-slate-800">{totalMissingTaxonomy}</span> missing across 4 categories
                  </span>
                  {totalMissingTaxonomy > 0 && totalSelected === 0 && (
                    <span className="text-slate-500 italic shrink-0">
                      Click <AlertCircle className="inline w-3 h-3 text-amber-500" /> to pick fixes
                    </span>
                  )}
                </div>

                {/* Per-category fix popovers — only one open at a time.
                    Each writes into the shared selectedKeywords set;
                    the Tailor button in the Resume Tailor section
                    below consumes the aggregate. */}
                {openScoreCategory === 'technical' && (
                  <ListingScoreFixPopover
                    anchor={techBtnRef.current}
                    label="Technical"
                    categoryKey="Technical"
                    missingKeywords={missingByCat.technical}
                    selectedKeywords={selectedKeywords}
                    onToggle={toggleKeyword}
                    onClose={() => setOpenScoreCategory(null)}
                  />
                )}
                {openScoreCategory === 'management' && (
                  <ListingScoreFixPopover
                    anchor={mgmtBtnRef.current}
                    label="Management"
                    categoryKey="Management"
                    missingKeywords={missingByCat.management}
                    selectedKeywords={selectedKeywords}
                    onToggle={toggleKeyword}
                    onClose={() => setOpenScoreCategory(null)}
                  />
                )}
                {openScoreCategory === 'domain' && (
                  <ListingScoreFixPopover
                    anchor={domainBtnRef.current}
                    label="Domain"
                    categoryKey="Domain"
                    missingKeywords={missingByCat.domain}
                    selectedKeywords={selectedKeywords}
                    onToggle={toggleKeyword}
                    onClose={() => setOpenScoreCategory(null)}
                  />
                )}
                {openScoreCategory === 'soft' && (
                  <ListingScoreFixPopover
                    anchor={softBtnRef.current}
                    label="Soft Skills"
                    categoryKey="Soft"
                    missingKeywords={missingByCat.soft}
                    selectedKeywords={selectedKeywords}
                    onToggle={toggleKeyword}
                    onClose={() => setOpenScoreCategory(null)}
                  />
                )}

                {/* Quick-wins panel + matched/missing 2-col cloud
                    were here. Both removed — the per-category ⚠
                    popovers above cover the actionable picking. */}

                {/* Tailoring Suggestions used to live here; moved
                    into the Resume Tailor section below so all
                    tailor-bound pickers (keywords + strategic edits)
                    sit next to the Tailor button. */}
              </div>
              );
            })()}
          </section>
          {/* Resume Tailor section */}
          <section className="bg-slate-50 rounded-lg p-4 h-full flex flex-col">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <FileText className="w-4 h-4 text-violet-500" />
                <h4 className="text-sm font-semibold text-slate-800">Resume Tailor</h4>
              </div>
              {!tailorResult && (
                <Button
                  size="sm"
                  onClick={handleTailor}
                  disabled={!detailScore}
                  isLoading={tailoring}
                  leftIcon={!tailoring ? <FileText className="w-3.5 h-3.5" /> : undefined}
                >
                  {tailoring ? 'Tailoring…' : 'Tailor My Resume'}
                </Button>
              )}
            </div>

            {!detailScore && !loadingScore && !scoreError && (
              <p className="text-xs text-slate-400">Waiting for score analysis...</p>
            )}

            {/* Pre-tailor staging "cart" — shows every selected
                keyword + strategic edit as a removable chip grouped
                by category. Replaces the text-only "N staged" line
                so the user can see exactly what's queued and remove
                items inline without re-opening the ⚠ popovers. */}
            {detailScore && !tailorResult && !tailoring && (
              <div className="mb-3 rounded-lg bg-white border border-slate-200 p-3">
                {selectedKeywords.size === 0 && selectedSuggestions.size === 0 ? (
                  <div className="text-xs italic text-slate-500 flex items-center gap-1.5">
                    <AlertCircle className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                    Nothing staged. Open the ⚠ on a weak category above to pick keywords for this tailor.
                  </div>
                ) : (() => {
                  // Group staged keywords by category for display.
                  // Uses keywordDetails (when present) so we know which
                  // bucket each pill belongs to; bigram phrases that
                  // aren't in keywordDetails fall under "Other".
                  const detailsByKw = new Map(
                    (detailScore.keywordDetails ?? []).map((d) => [d.keyword, d.category]),
                  );
                  const grouped: Record<string, string[]> = {
                    technical: [], management: [], domain: [], soft: [], other: [],
                  };
                  for (const kw of selectedKeywords) {
                    const cat = detailsByKw.get(kw) ?? 'other';
                    grouped[cat] = grouped[cat] ?? [];
                    grouped[cat].push(kw);
                  }
                  const CAT_LABEL: Record<string, string> = {
                    technical: 'Technical', management: 'Management',
                    domain: 'Domain', soft: 'Soft', other: 'Other',
                  };
                  const totalChips = selectedKeywords.size + selectedSuggestions.size;
                  return (
                    <>
                      <div className="flex items-center justify-between gap-2 mb-2">
                        <div className="text-[11px] uppercase tracking-wide font-semibold text-slate-500">
                          Staged for tailor
                        </div>
                        <div className="text-[11px] text-slate-500">
                          <span className="font-semibold text-slate-800">{totalChips}</span>{' '}
                          edit{totalChips === 1 ? '' : 's'} queued
                        </div>
                      </div>
                      {/* Stacked category groups: small uppercase
                          label, then the chip row on the line below.
                          The earlier side-by-side layout (label on
                          left, chips on right) collided in the
                          narrow 3-col layout when a long label like
                          "MANAGEMENT" sat next to a chip and looked
                          ragged. Stacking gives chips the full row
                          width to wrap cleanly. */}
                      <div className="space-y-2">
                        {(['technical', 'management', 'domain', 'soft', 'other'] as const).map((cat) => {
                          const items = grouped[cat];
                          if (!items || items.length === 0) return null;
                          return (
                            <div key={cat}>
                              <div className="text-[10px] uppercase tracking-wide text-slate-400 font-semibold mb-1">
                                {CAT_LABEL[cat]}
                              </div>
                              <div className="flex flex-wrap gap-1">
                                {items.map((kw) => (
                                  <span
                                    key={kw}
                                    className="inline-flex items-center gap-0.5 pl-2 pr-0.5 py-0.5 rounded-md text-[11px] font-medium bg-indigo-100 text-indigo-700 border border-indigo-200"
                                  >
                                    {kw}
                                    <button
                                      type="button"
                                      onClick={() => toggleKeyword(kw)}
                                      className="ml-0.5 px-1 rounded-full text-indigo-500 hover:bg-indigo-200 hover:text-indigo-800 leading-none"
                                      title={`Remove ${kw}`}
                                      aria-label={`Remove ${kw}`}
                                    >
                                      ×
                                    </button>
                                  </span>
                                ))}
                              </div>
                            </div>
                          );
                        })}
                        {selectedSuggestions.size > 0 && (
                          <div className="pt-2 border-t border-slate-100">
                            <div className="text-[10px] uppercase tracking-wide text-slate-400 font-semibold mb-1">
                              Strategy
                            </div>
                            <div className="flex flex-wrap gap-1">
                              {(detailScore.suggestions ?? [])
                                .filter((s) => selectedSuggestions.has(s.id))
                                .map((s) => (
                                  <span
                                    key={s.id}
                                    className="inline-flex items-center gap-0.5 pl-2 pr-0.5 py-0.5 rounded-md text-[11px] font-medium bg-violet-100 text-violet-700 border border-violet-200"
                                    title={s.description}
                                  >
                                    {s.label}
                                    <button
                                      type="button"
                                      onClick={() => toggleSuggestion(s.id)}
                                      className="ml-0.5 px-1 rounded-full text-violet-500 hover:bg-violet-200 hover:text-violet-800 leading-none"
                                      title={`Remove ${s.label}`}
                                      aria-label={`Remove ${s.label}`}
                                    >
                                      ×
                                    </button>
                                  </span>
                                ))}
                            </div>
                          </div>
                        )}
                      </div>
                    </>
                  );
                })()}
              </div>
            )}

            {/* Strategic edits — moved here from inside the Score
                panel. Whole-line edits the scorer suggests (mirror
                JD title, append a skills group, etc.). Collapsible
                and opt-in: nothing is selected until the user
                explicitly checks a box. The header acts as the
                toggle; chevron mirrors the Notes section pattern. */}
            {detailScore && !tailorResult && detailScore.suggestions && detailScore.suggestions.length > 0 && (
              <div className="mb-3 rounded-lg border border-slate-200 bg-white">
                <button
                  type="button"
                  onClick={() => setSuggestionsExpanded((v) => !v)}
                  className="w-full flex items-center justify-between gap-2 px-3 py-2 text-left"
                  aria-expanded={suggestionsExpanded}
                >
                  <div className="flex items-center gap-1.5 min-w-0">
                    <Sparkles className="w-3.5 h-3.5 text-violet-500 shrink-0" />
                    <span className="text-xs font-semibold text-slate-700">
                      Strategic edits
                    </span>
                    <span className="text-[10px] text-slate-400">
                      ({selectedSuggestions.size}/{detailScore.suggestions.length} selected)
                    </span>
                  </div>
                  {suggestionsExpanded ? (
                    <ChevronUp className="w-4 h-4 text-slate-400" />
                  ) : (
                    <ChevronDown className="w-4 h-4 text-slate-400" />
                  )}
                </button>
                {suggestionsExpanded && (
                  <div className="px-3 pb-3 space-y-1.5 border-t border-slate-100 pt-2">
                    {detailScore.suggestions.map((s) => {
                      const isSelected = selectedSuggestions.has(s.id);
                      const checkboxId = `suggestion-${listing.id}-${s.id}`;
                      return (
                        <label
                          key={s.id}
                          htmlFor={checkboxId}
                          onClick={(e) => e.stopPropagation()}
                          className={`flex gap-2 items-start p-2 rounded-lg text-xs transition-all border cursor-pointer ${
                            isSelected
                              ? 'bg-violet-50 border-violet-200 hover:bg-violet-100'
                              : 'bg-white border-slate-200 hover:bg-slate-50'
                          }`}
                        >
                          <input
                            id={checkboxId}
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => toggleSuggestion(s.id)}
                            onClick={(e) => e.stopPropagation()}
                            className="mt-0.5 w-3.5 h-3.5 accent-violet-600 cursor-pointer"
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
                )}
              </div>
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
                  <button
                    type="button"
                    onClick={() => setDiffOpen(true)}
                    className="ml-2 inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-white text-indigo-700 border border-indigo-100 hover:bg-indigo-50 hover:border-indigo-200 transition-colors"
                    title="See exactly which lines were added or modified in the tailored resume"
                  >
                    View diff
                  </button>
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

                {/* Added keywords with reject + re-tailor flow.
                    Click × on any pill to mark it rejected (strike-
                    through + slate background); once you have at
                    least one rejection, the "Re-tailor without N"
                    button appears so you can rebuild the resume
                    without those keywords. Lets users walk back
                    individual decisions without restarting the whole
                    keyword-selection flow. */}
                {tailorResult.addedKeywords.length > 0 && (
                  <div>
                    <h5 className="text-xs font-medium text-slate-700 mb-1.5 flex items-center justify-between gap-2">
                      <span>Keywords Added</span>
                      {rejectedKeywords.size > 0 && (
                        <button
                          type="button"
                          onClick={handleTailor}
                          disabled={tailoring}
                          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-semibold bg-rose-50 text-rose-700 border border-rose-100 hover:bg-rose-100 hover:border-rose-200 disabled:opacity-50 transition-colors"
                          title="Regenerate the tailored resume without the keywords you've rejected"
                        >
                          Re-tailor without {rejectedKeywords.size}
                        </button>
                      )}
                    </h5>
                    <div className="flex flex-wrap gap-1">
                      {tailorResult.addedKeywords.map((k) => {
                        const isRejected = rejectedKeywords.has(k);
                        return (
                          <span
                            key={k}
                            className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-medium transition-colors ${
                              isRejected
                                ? 'bg-slate-100 text-slate-400 line-through'
                                : 'bg-violet-100 text-violet-700'
                            }`}
                          >
                            {k}
                            <button
                              type="button"
                              onClick={() =>
                                setRejectedKeywords((prev) => {
                                  const next = new Set(prev);
                                  if (next.has(k)) next.delete(k);
                                  else next.add(k);
                                  return next;
                                })
                              }
                              className={`-mr-0.5 ml-0.5 rounded-full text-[10px] leading-none px-1 ${
                                isRejected
                                  ? 'text-slate-400 hover:text-slate-600'
                                  : 'text-violet-500 hover:bg-violet-200 hover:text-violet-800'
                              }`}
                              title={
                                isRejected
                                  ? 'Restore — include this keyword on next re-tailor'
                                  : 'Reject — exclude from the next re-tailor'
                              }
                            >
                              {isRejected ? '↺' : '×'}
                            </button>
                          </span>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Delta stats — quick numerical sanity check that the
                    tailored resume didn't grow unreasonably. Words +
                    lines are the things that drive readability +
                    page-fit; characters are a finer-grained signal we
                    show only when the change is significant. Lazy:
                    we read diffBaseText when it's already been loaded
                    for the diff modal; otherwise we render nothing
                    rather than fetch eagerly. */}
                {diffBaseText && (() => {
                  const baseWords = diffBaseText.trim().split(/\s+/).filter(Boolean).length;
                  const tailWords = tailorResult.tailoredText.trim().split(/\s+/).filter(Boolean).length;
                  const baseLines = diffBaseText.split('\n').filter((l) => l.trim()).length;
                  const tailLines = tailorResult.tailoredText.split('\n').filter((l) => l.trim()).length;
                  const wDelta = tailWords - baseWords;
                  const lDelta = tailLines - baseLines;
                  return (
                    <div className="grid grid-cols-3 gap-2 p-2 rounded-lg bg-slate-50 border border-slate-100 text-center">
                      <div>
                        <div className="text-xs font-semibold text-slate-700">{tailWords}</div>
                        <div className="text-[10px] text-slate-400 uppercase tracking-wide">
                          Words {wDelta >= 0 ? '+' : ''}{wDelta}
                        </div>
                      </div>
                      <div>
                        <div className="text-xs font-semibold text-slate-700">{tailLines}</div>
                        <div className="text-[10px] text-slate-400 uppercase tracking-wide">
                          Lines {lDelta >= 0 ? '+' : ''}{lDelta}
                        </div>
                      </div>
                      <div>
                        <div className="text-xs font-semibold text-slate-700">
                          {tailorResult.addedKeywords.length - rejectedKeywords.size}
                        </div>
                        <div className="text-[10px] text-slate-400 uppercase tracking-wide">
                          Accepted kw
                        </div>
                      </div>
                    </div>
                  );
                })()}

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
          <section className="bg-slate-50 rounded-lg p-4 h-full flex flex-col">
            <div className="flex items-center justify-between mb-3 gap-2 flex-wrap">
              <div className="flex items-center gap-2">
                <FileText className="w-4 h-4 text-blue-500" />
                <h4 className="text-sm font-semibold text-slate-800">Cover Letter</h4>
              </div>
              <div className="flex items-center gap-2">
                {coverTemplates.length > 0 && (
                  <select
                    value=""
                    onChange={(e) => {
                      const id = e.target.value;
                      if (!id) return;
                      const t = coverTemplates.find((x) => x.id === id);
                      if (!t) return;
                      if (
                        coverLetter &&
                        coverLetter.text.trim() &&
                        !window.confirm(`Replace the current cover letter with template "${t.name}"?`)
                      ) {
                        e.target.value = '';
                        return;
                      }
                      setCoverLetter({ text: t.text, matchedKeywords: [] });
                      // reset select back to placeholder
                      e.target.value = '';
                    }}
                    className="text-xs border border-slate-200 rounded-lg px-2 py-1 bg-white text-slate-700 focus:ring-2 focus:ring-indigo-200 focus:border-indigo-300 outline-none"
                    title="Load one of your saved cover-letter templates into the textarea"
                  >
                    <option value="">Load template…</option>
                    {coverTemplates.map((t) => (
                      <option key={t.id} value={t.id}>{t.name}</option>
                    ))}
                  </select>
                )}
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
                  <button
                    type="button"
                    disabled={savingTemplate || !coverLetter.text.trim()}
                    onClick={async () => {
                      const defaultName = `${listing.company} — ${listing.title}`.slice(0, 60);
                      const name = window.prompt(
                        'Name this template (e.g. "Short EM intro", "Detailed staff IC"):',
                        defaultName,
                      );
                      if (!name || !name.trim()) return;
                      setSavingTemplate(true);
                      try {
                        const res = await fetch('/api/cover-letter-templates', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ name: name.trim(), text: coverLetter.text }),
                        });
                        const data = await res.json();
                        if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`);
                        if (data.template) {
                          setCoverTemplates((prev) => [
                            ...prev.filter((x) => x.id !== data.template.id),
                            data.template,
                          ]);
                        }
                      } catch (e) {
                        window.alert(
                          `Couldn't save template: ${e instanceof Error ? e.message : 'unknown'}`,
                        );
                      } finally {
                        setSavingTemplate(false);
                      }
                    }}
                    className="flex items-center gap-2 px-4 py-2 bg-indigo-50 text-indigo-700 border border-indigo-100 text-sm font-medium rounded-xl shadow-sm shadow-indigo-500/10 hover:bg-indigo-100 hover:border-indigo-200 hover:shadow-md hover:shadow-indigo-500/15 transition-all duration-200 disabled:opacity-50"
                    title="Save this letter as a reusable template — loadable on any future listing via the picker above"
                  >
                    {savingTemplate ? (
                      <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Saving…</>
                    ) : (
                      <>Save as template</>
                    )}
                  </button>
                </div>
              </div>
            )}
          </section>

          </div>
          {/* /grid: ATS Score | Resume Tailor | Cover Letter */}

          {/* 2-col grid wrapping Find Hiring Contacts + Notes — the
              two secondary concerns parallel to the resume-prep
              flow above. Stacks on mobile; side-by-side on md+. */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

          {/* Hiring & Recruiting Contacts — no scraping; just pre-built
              LinkedIn deep-search URLs that the user clicks through.
              Avoids ToS issues and stays robust against LinkedIn UI
              changes. */}
          <section className="bg-slate-50 rounded-lg p-4 h-full flex flex-col">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <Users className="w-4 h-4 text-indigo-500" />
                <h4 className="text-sm font-semibold text-slate-800">Find hiring contacts</h4>
              </div>
            </div>
            <p className="text-xs text-slate-500 mb-3">
              Pre-built LinkedIn people-searches. Each opens in a new tab.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {(() => {
                // Build a smart role keyword based on the listing's
                // title. For an EM listing → 'engineering manager';
                // for a Staff IC → 'staff engineer'. Falls back to
                // the listing title itself if no obvious match.
                const t = (listing.title || '').toLowerCase();
                let mgrKeyword = 'engineering manager';
                if (/director/.test(t)) mgrKeyword = 'director engineering';
                else if (/vp|vice president/.test(t)) mgrKeyword = 'VP engineering';
                else if (/staff|principal/.test(t)) mgrKeyword = 'engineering manager';
                else if (/product manager/.test(t)) mgrKeyword = 'director product';
                else if (/design/.test(t)) mgrKeyword = 'head of design';
                const company = listing.company;
                // LinkedIn people-search keyword query string. We
                // can't pass company-id without scraping LinkedIn's
                // typeahead, so we put the company name into the
                // keywords field (LinkedIn returns close-enough
                // matches via full-text search).
                const linkedinUrl = (q: string) =>
                  `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(q)}`;
                const cards = [
                  {
                    label: 'Recruiters on LinkedIn',
                    desc: `"recruiter" at ${company}`,
                    href: linkedinUrl(`recruiter ${company}`),
                  },
                  {
                    label: 'Hiring managers on LinkedIn',
                    desc: `"${mgrKeyword}" at ${company}`,
                    href: linkedinUrl(`${mgrKeyword} ${company}`),
                  },
                ];
                return cards.map((c) => (
                  <a
                    key={c.label}
                    href={c.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-start gap-2 p-3 bg-white border border-slate-200 rounded-lg hover:border-indigo-200 hover:bg-indigo-50/40 hover:shadow-sm transition-all"
                  >
                    <ExternalLink className="w-3.5 h-3.5 text-indigo-500 shrink-0 mt-0.5" />
                    <div className="min-w-0">
                      <div className="text-xs font-semibold text-slate-800">{c.label}</div>
                      <div className="text-[11px] text-slate-500 truncate">{c.desc}</div>
                    </div>
                  </a>
                ));
              })()}
            </div>
          </section>

          {/* Notes section — collapsed by default. The Notes feature
              is power-user-only (most listings never get one); keeping
              it collapsed keeps the card header tidy. Auto-opens when
              an existing note is loaded so users never think their
              note disappeared. Click the header to toggle.

              Auto-saves on a 800ms debounce when expanded; empty text
              deletes the note server-side. Voice-note button on
              supported browsers streams Web Speech API transcription
              straight into the textarea. */}
          <section className="bg-slate-50 rounded-lg p-4 h-full flex flex-col">
            {/* Header row. Structured as a flex strip rather than a
                single big <button> because we need to nest a separate
                <button> (Voice) on the right side, and HTML doesn't
                allow button-in-button. Left side (icon + label + hint
                pill) AND the chevron pill on the right both call the
                toggle; the Voice button sits between save-indicator
                and chevron WITHOUT being a toggle target. */}
            <div className="flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={() => setNotesExpanded((v) => !v)}
                className="flex items-center gap-2 text-left flex-1 min-w-0"
                aria-expanded={notesExpanded}
              >
                <NotebookPen className="w-4 h-4 text-amber-500 shrink-0" />
                <h4 className="text-sm font-semibold text-slate-800">Notes</h4>
                {/* Hint pill when collapsed — surfaces whether a note
                    already exists (with a char count) so the user knows
                    there's content underneath without opening it. */}
                {!notesExpanded && noteText.trim() && (
                  <span className="px-1.5 py-0 rounded text-[10px] font-semibold uppercase tracking-wide bg-amber-100 text-amber-700">
                    {noteText.trim().length} chars
                  </span>
                )}
                {!notesExpanded && !noteText.trim() && (
                  <span className="text-[11px] text-slate-400 italic">
                    Click to add
                  </span>
                )}
              </button>
              <div className="flex items-center gap-2 shrink-0">
                {/* Voice button — only visible when expanded; would
                    otherwise be a confusing always-on control. Sits
                    inline with the save indicator + chevron so the
                    header row has a single, tidy right-edge. */}
                {notesExpanded && (
                  <VoiceNoteButton
                    onTranscript={(text) => handleNoteChange(noteText ? `${noteText.trimEnd()}\n${text}` : text)}
                  />
                )}
                {/* Save indicator. Stays visible even when collapsed
                    so a debounced save kicked off from a long voice
                    session still surfaces persistence feedback. */}
                <div className="text-[11px] text-slate-400">
                  {noteSaving ? (
                    <span className="flex items-center gap-1">
                      <Loader2 className="w-3 h-3 animate-spin" /> Saving…
                    </span>
                  ) : noteSavedAt && notesExpanded ? (
                    <span title={`Last saved ${new Date(noteSavedAt).toLocaleString()}`}>
                      Saved {formatPostedDate(noteSavedAt) ?? ''}
                    </span>
                  ) : null}
                </div>
                {/* Chevron — secondary toggle target so the user can
                    click the icon directly without aiming at the label. */}
                <button
                  type="button"
                  onClick={() => setNotesExpanded((v) => !v)}
                  aria-label={notesExpanded ? 'Collapse notes' : 'Expand notes'}
                  className="p-0.5 rounded text-slate-400 hover:text-slate-700 hover:bg-slate-200"
                >
                  {notesExpanded ? (
                    <ChevronUp className="w-4 h-4" />
                  ) : (
                    <ChevronDown className="w-4 h-4" />
                  )}
                </button>
              </div>
            </div>

            {notesExpanded && (
              <div className="mt-3">
                <textarea
                  value={noteText}
                  onChange={(e) => handleNoteChange(e.target.value)}
                  placeholder="Research, contacts, why this job, why you passed — anything you want attached to this listing. Saves automatically."
                  rows={Math.max(3, Math.min(10, noteText.split('\n').length + 1))}
                  className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-sm text-slate-700 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-200 focus:border-indigo-300 transition-all resize-y"
                  spellCheck
                />
              </div>
            )}
          </section>

          </div>
          {/* /grid: Find Hiring Contacts | Notes */}
        </div>
      )}

      {/* Resume-diff modal. Renders a line-by-line view of the
          base resume vs the tailored output. Tailor only appends,
          so 'added' lines are the headline; we surface 'modified'
          (bullets with new inline keywords) and 'removed' (rare)
          for completeness. */}
      {diffOpen && tailorResult && typeof document !== 'undefined' &&
        createPortal(
          <div
            className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-900/40 backdrop-blur-sm p-4"
            onClick={() => setDiffOpen(false)}
          >
            <div
              className={`bg-white w-full ${
                effectiveDiffView === 'split' ? 'max-w-6xl' : 'max-w-3xl'
              } max-h-[90vh] sm:max-h-[85vh] rounded-2xl shadow-modal border border-slate-100 overflow-hidden flex flex-col`}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-start justify-between p-5 border-b border-slate-100">
                <div>
                  <h2 className="text-lg font-semibold text-slate-800">Resume diff</h2>
                  <p className="text-xs text-slate-500 mt-1">
                    Line-by-line view of what changed in the tailored version of your resume.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {/* View toggle. Side-by-side ('split') is the default
                      because aligned rows make it easier to spot what's
                      different at a glance; 'unified' keeps the legacy
                      vertical view for narrow viewports or quick scans.
                      Hidden on mobile — there isn't enough horizontal
                      room for the split view to be readable at 375px,
                      so we just always render unified there (see
                      effectiveDiffView above). */}
                  <div className="hidden sm:inline-flex rounded-lg border border-slate-200 p-0.5 text-xs">
                    <button
                      type="button"
                      onClick={() => setDiffView('split')}
                      className={`px-2.5 py-1 rounded-md transition-colors ${
                        diffView === 'split'
                          ? 'bg-indigo-500 text-white'
                          : 'text-slate-600 hover:bg-slate-100'
                      }`}
                    >
                      Side-by-side
                    </button>
                    <button
                      type="button"
                      onClick={() => setDiffView('unified')}
                      className={`px-2.5 py-1 rounded-md transition-colors ${
                        diffView === 'unified'
                          ? 'bg-indigo-500 text-white'
                          : 'text-slate-600 hover:bg-slate-100'
                      }`}
                    >
                      Unified
                    </button>
                  </div>
                  <button
                    onClick={() => setDiffOpen(false)}
                    className="p-1 rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                  >
                    <XCircle className="w-5 h-5" />
                  </button>
                </div>
              </div>
              <div className="flex-1 overflow-y-auto px-5 py-4">
                {diffBaseText === null ? (
                  <div className="flex items-center gap-2 text-sm text-slate-500 py-6 justify-center">
                    <Loader2 className="w-4 h-4 animate-spin" /> Loading base resume…
                  </div>
                ) : (() => {
                  const diff = diffResume(diffBaseText, tailorResult.tailoredText);
                  return (
                    <>
                      <div className="flex items-center gap-3 mb-4 text-xs flex-wrap">
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-100">
                          <strong>{diff.counts.added}</strong> added
                        </span>
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-100">
                          <strong>{diff.counts.modified}</strong> modified
                        </span>
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-slate-50 text-slate-600 border border-slate-200">
                          <strong>{diff.counts.unchanged}</strong> unchanged
                        </span>
                        {diff.counts.removed > 0 && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-rose-50 text-rose-700 border border-rose-100">
                            <strong>{diff.counts.removed}</strong> removed
                          </span>
                        )}
                      </div>
                      {effectiveDiffView === 'unified' ? (
                        // ─── Unified view (legacy) ────────────────────
                        <div className="space-y-1 font-mono text-[12px] leading-relaxed">
                          {diff.lines.map((l, i) => {
                            if (l.kind === 'unchanged') {
                              return (
                                <div key={i} className="flex gap-2 text-slate-500">
                                  <span className="w-5 shrink-0 text-slate-300 select-none">·</span>
                                  <span className="truncate">{l.text}</span>
                                </div>
                              );
                            }
                            if (l.kind === 'modified') {
                              return (
                                <div key={i} className="space-y-0.5">
                                  <div className="flex gap-2 bg-rose-50 px-2 py-1 rounded">
                                    <span className="w-5 shrink-0 text-rose-500 select-none">-</span>
                                    <span className="text-rose-700">{l.basedOn}</span>
                                  </div>
                                  <div className="flex gap-2 bg-amber-50 px-2 py-1 rounded">
                                    <span className="w-5 shrink-0 text-amber-600 select-none">~</span>
                                    <span className="text-amber-900">{l.text}</span>
                                  </div>
                                </div>
                              );
                            }
                            // added
                            return (
                              <div key={i} className="flex gap-2 bg-emerald-50 px-2 py-1 rounded">
                                <span className="w-5 shrink-0 text-emerald-600 select-none">+</span>
                                <span className="text-emerald-800">{l.text}</span>
                              </div>
                            );
                          })}
                          {diff.removed.length > 0 && (
                            <>
                              <div className="text-[11px] uppercase tracking-wide text-slate-400 mt-4 mb-1">
                                Removed (unusual — tailor normally only appends)
                              </div>
                              {diff.removed.map((r, i) => (
                                <div key={`r-${i}`} className="flex gap-2 bg-rose-50 px-2 py-1 rounded">
                                  <span className="w-5 shrink-0 text-rose-500 select-none">-</span>
                                  <span className="text-rose-700">{r}</span>
                                </div>
                              ))}
                            </>
                          )}
                        </div>
                      ) : (
                        // ─── Side-by-side view ────────────────────────
                        // Two aligned columns. Each row pairs the base
                        // line on the left with the tailored line on the
                        // right so changes show up horizontally rather
                        // than as stacked pairs the eye has to associate.
                        //
                        // Row mapping:
                        //   unchanged → same text both sides, dimmed
                        //   modified  → basedOn on left, text on right
                        //   added     → left empty / placeholder, right filled
                        //   removed   → left filled, right empty (rare)
                        (() => {
                          type SplitRow = {
                            kind: 'unchanged' | 'modified' | 'added' | 'removed';
                            left: string | null;
                            right: string | null;
                          };
                          const rows: SplitRow[] = diff.lines.map((l) => {
                            if (l.kind === 'unchanged') {
                              return { kind: 'unchanged', left: l.text, right: l.text };
                            }
                            if (l.kind === 'modified') {
                              return { kind: 'modified', left: l.basedOn ?? '', right: l.text };
                            }
                            // added
                            return { kind: 'added', left: null, right: l.text };
                          });
                          for (const r of diff.removed) {
                            rows.push({ kind: 'removed', left: r, right: null });
                          }
                          return (
                            <div className="font-mono text-[12px] leading-relaxed">
                              {/* Column headers */}
                              <div className="grid grid-cols-2 gap-3 mb-2 pb-2 border-b border-slate-100 text-[11px] uppercase tracking-wide text-slate-500 sticky top-0 bg-white">
                                <div className="px-2">Base resume</div>
                                <div className="px-2">Tailored</div>
                              </div>
                              <div className="space-y-1">
                                {rows.map((row, i) => {
                                  // Per-row backgrounds telegraph the
                                  // change kind. Unchanged rows are
                                  // muted so the eye lands on diffs.
                                  const leftBg =
                                    row.kind === 'modified' || row.kind === 'removed'
                                      ? 'bg-rose-50'
                                      : '';
                                  const rightBg =
                                    row.kind === 'added'
                                      ? 'bg-emerald-50'
                                      : row.kind === 'modified'
                                      ? 'bg-amber-50'
                                      : '';
                                  const leftText =
                                    row.kind === 'modified' || row.kind === 'removed'
                                      ? 'text-rose-700'
                                      : 'text-slate-500';
                                  const rightText =
                                    row.kind === 'added'
                                      ? 'text-emerald-800'
                                      : row.kind === 'modified'
                                      ? 'text-amber-900'
                                      : 'text-slate-500';
                                  // Marker glyphs match the unified view
                                  // so users switching between modes see
                                  // the same vocabulary.
                                  const leftMarker =
                                    row.kind === 'modified' || row.kind === 'removed'
                                      ? '-'
                                      : row.left
                                      ? '·'
                                      : '';
                                  const rightMarker =
                                    row.kind === 'added'
                                      ? '+'
                                      : row.kind === 'modified'
                                      ? '~'
                                      : row.right
                                      ? '·'
                                      : '';
                                  return (
                                    <div key={i} className="grid grid-cols-2 gap-3">
                                      <div className={`flex gap-2 px-2 py-1 rounded ${leftBg}`}>
                                        <span className="w-4 shrink-0 select-none text-slate-300">
                                          {leftMarker}
                                        </span>
                                        <span className={`break-words whitespace-pre-wrap ${leftText}`}>
                                          {row.left ?? ''}
                                        </span>
                                      </div>
                                      <div className={`flex gap-2 px-2 py-1 rounded ${rightBg}`}>
                                        <span className="w-4 shrink-0 select-none text-slate-300">
                                          {rightMarker}
                                        </span>
                                        <span className={`break-words whitespace-pre-wrap ${rightText}`}>
                                          {row.right ?? ''}
                                        </span>
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          );
                        })()
                      )}
                    </>
                  );
                })()}
              </div>
              <div className="flex justify-end gap-2 p-4 border-t border-slate-100 bg-slate-50/60">
                <button
                  type="button"
                  onClick={() => setDiffOpen(false)}
                  className="px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-800 rounded-xl transition-all duration-200"
                >
                  Close
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )}

      {/* Per-keyword context popover. Portaled so it floats above
          every card boundary. Click-outside (the overlay) closes it. */}
      {keywordContext && typeof document !== 'undefined' &&
        createPortal(
          <>
            <div
              className="fixed inset-0 z-[60]"
              onClick={() => setKeywordContext(null)}
            />
            <div
              className="fixed w-80 max-w-[calc(100vw-32px)] bg-white border border-slate-200 rounded-xl shadow-modal z-[70] text-left overflow-hidden"
              style={{
                top: keywordContext.anchor.top,
                left: Math.min(keywordContext.anchor.left, window.innerWidth - 320 - 16),
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between px-3 py-2 border-b border-slate-100 bg-slate-50">
                <div className="flex items-center gap-2 min-w-0">
                  <Search className="w-3.5 h-3.5 text-indigo-500 shrink-0" />
                  <span className="text-xs font-semibold text-slate-700 truncate">
                    Where &quot;{keywordContext.keyword}&quot; appears
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => setKeywordContext(null)}
                  className="p-0.5 rounded text-slate-400 hover:text-slate-700 hover:bg-slate-100"
                  title="Close"
                >
                  <XCircle className="w-3.5 h-3.5" />
                </button>
              </div>
              <div className="p-3 max-h-72 overflow-y-auto">
                {keywordContext.loading ? (
                  <div className="flex items-center gap-2 text-xs text-slate-500 py-3 justify-center">
                    <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading JD context…
                  </div>
                ) : keywordContext.sentences.length === 0 ? (
                  <p className="text-xs text-slate-500">
                    No JD sentences found. The body might not be cached yet — try expanding
                    the listing once first.
                  </p>
                ) : (
                  <ul className="space-y-2">
                    {keywordContext.sentences.map((s, i) => (
                      <li key={i} className="text-xs text-slate-700 bg-slate-50 border border-slate-100 rounded-lg px-2.5 py-1.5 leading-relaxed">
                        {/* Highlight tokens of the keyword in the
                            sentence so the user sees the match
                            inline. We split on the keyword's first
                            token; sufficient for visual scanning. */}
                        {(() => {
                          const token = keywordContext.keyword.split(/[-_\s]+/)[0];
                          if (!token || token.length < 3) return s;
                          const re = new RegExp(`(\\b${token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b)`, 'gi');
                          const parts = s.split(re);
                          return parts.map((p, j) =>
                            re.test(p) ? (
                              <mark key={j} className="bg-amber-100 text-amber-900 rounded px-0.5">{p}</mark>
                            ) : (
                              <span key={j}>{p}</span>
                            ),
                          );
                        })()}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </>,
          document.body,
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

/** Mirror of the server-side dedup key in /api/network. Lets the
 *  client correlate a contact with any prior outreach record without
 *  another round-trip. URL wins when present (LinkedIn's stable id);
 *  otherwise we fall back to first+last+company, lowercased. */
function contactDedupKey(c: BadgeContact, company: string): string {
  if (c.url) return c.url.trim().toLowerCase();
  return `${c.firstName}|${c.lastName}|${company}`.toLowerCase();
}

type ContactOutreach = {
  id: string;
  contactKey: string;
  status: 'drafted' | 'sent' | 'replied' | 'no-response';
  createdAt: string;
  sentAt?: string;
  repliedAt?: string;
};

function NetworkBadge({ company, listingId }: { company: string; listingId?: string }) {
  const [contacts, setContacts] = useState<BadgeContact[]>([]);
  const [open, setOpen] = useState(false);
  // Outreach records for THIS company — keyed by contactKey for fast
  // lookup so each contact row can render a "Contacted" pill with the
  // latest status. Refreshed when the popover opens.
  const [outreachByContact, setOutreachByContact] = useState<Record<string, ContactOutreach>>({});
  const reloadOutreach = useCallback(async () => {
    try {
      const r = await fetch(`/api/network/outreach?company=${encodeURIComponent(company)}`);
      const d = await r.json();
      if (Array.isArray(d.outreach)) {
        // For each contact, keep the most-recent record. API returns
        // newest-first so we just take the first hit per contactKey.
        const map: Record<string, ContactOutreach> = {};
        for (const o of d.outreach as ContactOutreach[]) {
          if (!map[o.contactKey]) map[o.contactKey] = o;
        }
        setOutreachByContact(map);
      }
    } catch {
      // Network blip — leave whatever we had on screen.
    }
  }, [company]);
  // Referral-draft modal state. When set, renders a portaled modal
  // with the generated subject + body for the chosen contact. The
  // popover stays mounted underneath; user closes the modal to get
  // back to the contact list and pick another contact or close.
  const [referral, setReferral] = useState<
    | {
        contactName: string;
        contactKey: string;
        outreachId?: string;
        subject: string;
        body: string;
        loading?: false;
      }
    | { contactName: string; contactKey: string; loading: true }
    | null
  >(null);

  async function requestReferral(contact: BadgeContact) {
    if (!listingId) return;
    const contactName = `${contact.firstName} ${contact.lastName}`.trim() || 'there';
    const contactKey = contactDedupKey(contact, company);
    setReferral({ contactName, contactKey, loading: true });
    try {
      const res = await fetch('/api/outreach', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          listingId,
          template: 'referral-request',
          contactName: contact.firstName || contactName,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`);
      const subject = data.subject ?? '';
      const body = data.body ?? '';
      // Persist the draft as an outreach record so the contact list
      // shows a "Drafted" pill and the user can mark it sent / replied
      // later from the inbox.
      let outreachId: string | undefined;
      try {
        const persistRes = await fetch('/api/network/outreach', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contactKey,
            contactName,
            company,
            listingId,
            draftSubject: subject,
            draftBody: body,
          }),
        });
        const persistData = await persistRes.json();
        if (persistRes.ok && persistData?.outreach?.id) {
          outreachId = persistData.outreach.id as string;
          // Optimistically update the local cache so the contact list
          // shows the pill without waiting for a refetch.
          setOutreachByContact((prev) => ({
            ...prev,
            [contactKey]: persistData.outreach,
          }));
        }
      } catch {
        // Persistence failure shouldn't block the user from seeing the
        // generated text — they can still copy/paste from the modal.
      }
      setReferral({ contactName, contactKey, outreachId, subject, body });
    } catch (e) {
      setReferral({
        contactName,
        contactKey,
        subject: '',
        body: `Couldn't draft a referral message: ${e instanceof Error ? e.message : 'unknown error'}.\n\nMake sure you have an active resume in Settings and try again.`,
      });
    }
  }

  /** Move an outreach record to a new status (sent / replied / no-response).
   *  Used by the buttons in the referral modal footer. */
  async function markOutreachStatus(id: string, status: 'sent' | 'replied' | 'no-response') {
    try {
      const r = await fetch('/api/network/outreach', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, status }),
      });
      if (r.ok) {
        const d = await r.json();
        if (d?.outreach?.contactKey) {
          setOutreachByContact((prev) => ({ ...prev, [d.outreach.contactKey]: d.outreach }));
        }
      }
    } catch {
      // Silent — user can retry; we'll re-read on next open.
    }
  }
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
    // Refresh outreach state whenever the popover opens — the user
    // may have marked things sent/replied in the inbox view since the
    // last open. Cheap call (one record per contact).
    reloadOutreach();
    const onChange = () => recomputePos();
    window.addEventListener('scroll', onChange, true);
    window.addEventListener('resize', onChange);
    return () => {
      window.removeEventListener('scroll', onChange, true);
      window.removeEventListener('resize', onChange);
    };
  }, [open, recomputePos, reloadOutreach]);
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
                const key = contactDedupKey(c, company);
                const outreach = outreachByContact[key];
                return (
                  <li key={`${name}-${i}`} className="py-1.5 px-1">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="text-xs font-medium text-slate-800 truncate flex items-center gap-1.5">
                          <span className="truncate">{name || 'Unknown'}</span>
                          {/* Outreach status pill. Surfaces previous
                              messages so the user doesn't re-draft to
                              someone they've already contacted. */}
                          {outreach && (
                            <span
                              className={`shrink-0 inline-flex items-center px-1.5 py-0 rounded text-[9px] font-bold uppercase tracking-wide ${
                                outreach.status === 'replied'
                                  ? 'bg-emerald-100 text-emerald-700'
                                  : outreach.status === 'sent'
                                  ? 'bg-indigo-100 text-indigo-700'
                                  : outreach.status === 'no-response'
                                  ? 'bg-slate-100 text-slate-500'
                                  : 'bg-amber-100 text-amber-700'
                              }`}
                              title={`Outreach ${outreach.status} — ${new Date(outreach.createdAt).toLocaleDateString()}`}
                            >
                              {outreach.status === 'no-response' ? 'no reply' : outreach.status}
                            </span>
                          )}
                        </div>
                        {c.position && (
                          <div className="text-[11px] text-slate-500 truncate">
                            {c.position}
                          </div>
                        )}
                      </div>
                      <div className="shrink-0 flex items-center gap-1.5">
                        {listingId && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              requestReferral(c);
                            }}
                            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-semibold bg-indigo-50 text-indigo-700 border border-indigo-100 hover:bg-indigo-100 hover:border-indigo-200 transition-colors"
                            title="Draft a referral request message to this contact for this listing"
                          >
                            Referral
                          </button>
                        )}
                        {c.url && (
                          <a
                            href={c.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-0.5 text-[11px] text-indigo-600 hover:text-indigo-700 hover:underline"
                            onClick={(e) => e.stopPropagation()}
                          >
                            LinkedIn
                            <ExternalLink className="w-3 h-3" />
                          </a>
                        )}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        </>,
          document.body,
        )}
      {/* Referral-draft modal. Portaled to body so it overlays the
          popover + listing card without z-index gymnastics. Renders
          the generated subject + body in a textarea so the user can
          tweak before copying. */}
      {referral && typeof document !== 'undefined' &&
        createPortal(
          <div
            className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-900/40 backdrop-blur-sm p-4"
            onClick={() => setReferral(null)}
          >
            <div
              className="bg-white w-full max-w-xl rounded-2xl shadow-modal border border-slate-100 overflow-hidden"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-start justify-between p-5 border-b border-slate-100">
                <div>
                  <div className="flex items-center gap-2">
                    <Users className="w-5 h-5 text-indigo-500" />
                    <h2 className="text-lg font-semibold text-slate-800">Referral request</h2>
                  </div>
                  <p className="text-xs text-slate-500 mt-1">
                    Drafted for <strong className="text-slate-700">{referral.contactName}</strong> at {company}. Tweak as needed, then copy.
                  </p>
                </div>
                <button
                  onClick={() => setReferral(null)}
                  className="p-1 rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                >
                  <XCircle className="w-5 h-5" />
                </button>
              </div>
              <div className="p-5 space-y-3">
                {referral.loading ? (
                  <div className="flex items-center gap-2 text-sm text-slate-500 py-6 justify-center">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Drafting referral request…
                  </div>
                ) : (
                  <>
                    <div>
                      <label className="block text-[11px] uppercase tracking-wide text-slate-400 mb-1">Subject</label>
                      <input
                        type="text"
                        value={referral.subject}
                        onChange={(e) => setReferral({ ...referral, subject: e.target.value })}
                        className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-indigo-200 focus:border-indigo-300 outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] uppercase tracking-wide text-slate-400 mb-1">Message</label>
                      <textarea
                        value={referral.body}
                        onChange={(e) => setReferral({ ...referral, body: e.target.value })}
                        rows={12}
                        className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs font-mono text-slate-700 bg-white focus:ring-2 focus:ring-indigo-200 focus:border-indigo-300 outline-none resize-y"
                        spellCheck
                      />
                    </div>
                  </>
                )}
              </div>
              <div className="flex flex-wrap justify-end gap-2 p-4 border-t border-slate-100 bg-slate-50/60">
                <button
                  type="button"
                  onClick={() => setReferral(null)}
                  className="px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-800 rounded-xl transition-all duration-200"
                >
                  Close
                </button>
                {!referral.loading && referral.outreachId && (() => {
                  // Status of the persisted outreach record. Drives
                  // which transition buttons we render so the user
                  // can't double-mark and we don't show "Mark sent"
                  // after they've already marked replied.
                  const current = outreachByContact[referral.contactKey];
                  const status = current?.status ?? 'drafted';
                  return (
                    <>
                      {status === 'drafted' && (
                        <button
                          type="button"
                          onClick={() => markOutreachStatus(referral.outreachId!, 'sent')}
                          className="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium rounded-xl bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 hover:border-slate-300 transition-all duration-200"
                          title="Mark this outreach as sent — flips to 'sent' so you stop seeing it as a draft"
                        >
                          Mark sent
                        </button>
                      )}
                      {status === 'sent' && (
                        <>
                          <button
                            type="button"
                            onClick={() => markOutreachStatus(referral.outreachId!, 'replied')}
                            className="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium rounded-xl bg-emerald-50 border border-emerald-100 text-emerald-700 hover:bg-emerald-100 hover:border-emerald-200 transition-all duration-200"
                          >
                            Mark replied
                          </button>
                          <button
                            type="button"
                            onClick={() => markOutreachStatus(referral.outreachId!, 'no-response')}
                            className="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium rounded-xl bg-white border border-slate-200 text-slate-600 hover:bg-slate-50 transition-all duration-200"
                          >
                            No response
                          </button>
                        </>
                      )}
                    </>
                  );
                })()}
                {!referral.loading && (
                  <button
                    type="button"
                    onClick={() => {
                      const text = `Subject: ${referral.subject}\n\n${referral.body}`;
                      navigator.clipboard.writeText(text).catch(() => {});
                    }}
                    className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-xl bg-gradient-to-r from-indigo-500 to-violet-500 text-white shadow-btn-primary hover:from-indigo-600 hover:to-violet-600 hover:shadow-btn-primary-hover hover:-translate-y-0.5 active:translate-y-0 transition-all duration-200"
                  >
                    Copy to clipboard
                  </button>
                )}
              </div>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}

// ─── Pay Snapshot (inline strip) ────────────────────────────────────
// Three signals the user picked as actually useful (the old cohort
// median + percentile + P25–P75 were dropped for false-precision):
//
//   1. vs your salary floor — compares posting against settings.salaryMin
//   2. Pay structure detail — base / TC / equity (parser already
//      extracts these; we promote them from a tooltip to first-class)
//   3. vs your applied set — "highest among your N applied" /
//      "below your typical apply"
//
// All three are computed client-side from props already in scope on
// the listings page — no network fetch.

function SalaryIntelInline({
  listing,
  userSalaryFloor,
  appliedSalaryMids,
}: {
  listing: JobListing;
  /** settings.salaryMin from the user's profile. When null, the "vs
   *  your floor" badge hides — comparison needs a target. */
  userSalaryFloor: number | null;
  /** Midpoints (or single value) of every listing flagged Applied
   *  that has parseable salary data. Used for the rank-among-applied
   *  comparison. */
  appliedSalaryMids: number[];
}) {
  // Helpers for $ display: $156k / $1.25M.
  const fmtK = (v: number) =>
    v >= 1_000_000 ? `$${(v / 1_000_000).toFixed(2).replace(/\.?0+$/, '')}M`
    : `$${Math.round(v / 1000)}k`;

  // ── Signal 1: vs your salary floor ────────────────────────────
  // Compare the listing's MAX (or single value) to the user's floor.
  // If the listing has no salary or the user hasn't set a floor, the
  // badge hides.
  const listingTop = listing.salaryMax ?? listing.salaryMin;
  const vsFloor = (() => {
    if (!userSalaryFloor || listingTop == null) return null;
    const delta = listingTop - userSalaryFloor;
    if (delta >= 0) {
      return {
        label: `Above your ${fmtK(userSalaryFloor)} floor`,
        sub: delta > 0 ? `+${fmtK(delta)} headroom` : 'at the floor',
        color: 'bg-emerald-50 text-emerald-700 border-emerald-200',
      };
    }
    return {
      label: `Below your ${fmtK(userSalaryFloor)} floor`,
      sub: `${fmtK(Math.abs(delta))} short`,
      color: 'bg-rose-50 text-rose-700 border-rose-200',
    };
  })();

  // ── Signal 2: Pay structure ──────────────────────────────────
  // Pull whichever structured fields the parser populated. We always
  // have at least one of salaryMin/Max (otherwise listing.salary is
  // null and the strip hides entirely). Base / TC / equity light up
  // when the parser captured them.
  const hasAnySalary = listing.salaryMin != null || listing.salaryMax != null;
  if (!hasAnySalary && !listing.salary) return null;
  const baseRange = listing.salaryBaseMin != null && listing.salaryBaseMax != null
    ? `${fmtK(listing.salaryBaseMin)}–${fmtK(listing.salaryBaseMax)}`
    : null;
  const tcRange = listing.salaryTcMin != null && listing.salaryTcMax != null
    ? `${fmtK(listing.salaryTcMin)}–${fmtK(listing.salaryTcMax)}`
    : null;
  // Posted range (the headline). Falls back to the raw string when
  // we couldn't parse numeric min/max (manual entries, etc.).
  const postedRange = listing.salaryMin != null && listing.salaryMax != null
    ? `${fmtK(listing.salaryMin)}–${fmtK(listing.salaryMax)}`
    : listing.salaryMin != null ? `from ${fmtK(listing.salaryMin)}`
    : listing.salaryMax != null ? `up to ${fmtK(listing.salaryMax)}`
    : listing.salary;

  // ── Signal 3: vs your applied set ────────────────────────────
  // Compute where this listing's midpoint sits among the user's
  // existing applied listings (with parseable salaries).
  const listingMid = listing.salaryMin != null && listing.salaryMax != null
    ? (listing.salaryMin + listing.salaryMax) / 2
    : listing.salaryMin ?? listing.salaryMax ?? null;
  const vsApplied = (() => {
    if (listingMid == null || appliedSalaryMids.length === 0) return null;
    const above = appliedSalaryMids.filter((m) => listingMid > m).length;
    const below = appliedSalaryMids.filter((m) => listingMid < m).length;
    const total = appliedSalaryMids.length;
    if (above === total) {
      return { label: `Highest pay among your ${total} applied`, color: 'text-emerald-700' };
    }
    if (below === total) {
      return { label: `Lowest pay among your ${total} applied`, color: 'text-rose-700' };
    }
    return {
      label: `Ranks ${above + 1} of ${total + 1} among your applied set`,
      color: 'text-slate-600',
    };
  })();

  return (
    <div className="rounded-lg border border-emerald-100 bg-gradient-to-br from-emerald-50/80 to-teal-50/60 px-4 py-3">
      <div className="flex items-center justify-between gap-2 mb-2.5">
        <div className="flex items-center gap-1.5 min-w-0">
          <DollarSign className="w-4 h-4 text-emerald-600 shrink-0" />
          <span className="text-[11px] font-semibold uppercase tracking-wide text-emerald-700">
            Pay snapshot
          </span>
        </div>
        {vsFloor && (
          <span
            className={`shrink-0 inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-semibold border ${vsFloor.color}`}
            title={vsFloor.sub}
          >
            {vsFloor.label}
            <span className="opacity-70 font-medium">· {vsFloor.sub}</span>
          </span>
        )}
      </div>
      {/* Pay-structure detail. Posted range is the headline; Base and
          TC light up when distinct from posted (and from each other). */}
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-sm">
        <div>
          <span className="text-[10px] uppercase tracking-wide text-slate-500 font-medium mr-1.5">
            Posted
          </span>
          <span className="font-bold text-emerald-900">{postedRange ?? '—'}</span>
        </div>
        {baseRange && baseRange !== postedRange && (
          <div>
            <span className="text-[10px] uppercase tracking-wide text-slate-500 font-medium mr-1.5">
              Base
            </span>
            <span className="font-semibold text-slate-800">{baseRange}</span>
          </div>
        )}
        {tcRange && tcRange !== postedRange && tcRange !== baseRange && (
          <div>
            <span className="text-[10px] uppercase tracking-wide text-slate-500 font-medium mr-1.5">
              Total comp
            </span>
            <span className="font-semibold text-slate-800">{tcRange}</span>
          </div>
        )}
        {listing.salaryEquityHint && (
          <div className="text-[11px] text-slate-500 italic">
            · {listing.salaryEquityHint}
          </div>
        )}
      </div>
      {vsApplied && (
        <div className={`mt-2 pt-2 border-t border-emerald-100 text-[11px] ${vsApplied.color}`}>
          {vsApplied.label}
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

// ─── Voice-note button ──────────────────────────────────────────────
//
// Uses the browser's built-in Web Speech API (SpeechRecognition) to
// stream transcription of the user's voice into the notes textarea.
// Zero server dependency — runs entirely on-device on Chrome, Edge,
// and Safari (iOS 14.5+). Firefox doesn't ship it; we gracefully
// hide the button there rather than show a broken control.
//
// Use cases this unlocks:
//   - 30-second dump after a recruiter call without typing on a phone
//   - Hands-free capture of thoughts while reading a JD
//
// We DON'T store the audio itself — transcript only — which keeps the
// db.json footprint bounded.

// Minimal types for the SpeechRecognition API. TypeScript's lib.dom
// doesn't bundle these because the API is still non-standard.
interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: ArrayLike<{
    isFinal: boolean;
    0: { transcript: string };
  }>;
}
interface SpeechRecognitionLike {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((e: SpeechRecognitionEventLike) => void) | null;
  onerror: ((e: Event) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
}
type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

function VoiceNoteButton({ onTranscript }: { onTranscript: (text: string) => void }) {
  const [supported, setSupported] = useState(false);
  const [recording, setRecording] = useState(false);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const w = window as unknown as {
      SpeechRecognition?: SpeechRecognitionCtor;
      webkitSpeechRecognition?: SpeechRecognitionCtor;
    };
    setSupported(!!(w.SpeechRecognition || w.webkitSpeechRecognition));
  }, []);

  if (!supported) return null;

  function start() {
    const w = window as unknown as {
      SpeechRecognition?: SpeechRecognitionCtor;
      webkitSpeechRecognition?: SpeechRecognitionCtor;
    };
    const Ctor = w.SpeechRecognition || w.webkitSpeechRecognition;
    if (!Ctor) return;
    const rec = new Ctor();
    rec.continuous = true;
    rec.interimResults = false; // we only commit finalized chunks
    rec.lang = navigator.language || 'en-US';
    rec.onresult = (e) => {
      // Collect only finalized results since the last index — interim
      // results would spam onTranscript with growing prefixes.
      let final = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) final += r[0].transcript;
      }
      if (final.trim()) onTranscript(final.trim());
    };
    rec.onerror = () => {
      // Most common: permission denied or no-speech timeout. Silently
      // stop — the user will retry if they meant to record.
      setRecording(false);
    };
    rec.onend = () => setRecording(false);
    rec.start();
    recognitionRef.current = rec;
    setRecording(true);
  }

  function stop() {
    recognitionRef.current?.stop();
    recognitionRef.current = null;
    setRecording(false);
  }

  return (
    <button
      type="button"
      onClick={recording ? stop : start}
      className={`inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium border transition-colors ${
        recording
          ? 'bg-rose-50 text-rose-700 border-rose-200 hover:bg-rose-100 animate-pulse'
          : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50 hover:border-slate-300'
      }`}
      title={
        recording
          ? 'Stop recording — finalized speech is appended to the note as you speak'
          : 'Record a voice note — transcription is appended to the note as you speak'
      }
    >
      {recording ? (
        <>
          <MicOff className="w-3 h-3" /> Stop
        </>
      ) : (
        <>
          <Mic className="w-3 h-3" /> Voice
        </>
      )}
    </button>
  );
}

// ─── Per-listing score-fix popover ──────────────────────────────────
//
// Opened from the ⚠ button on each CategoryBar in the listing's ATS
// Match Score panel. Shows the missing keywords for ONE category as
// atomic toggle pills; clicking a pill flips its membership in the
// shared `selectedKeywords` set the listing card already maintains.
//
// Unlike the dashboard's CategoryFixPopover, this popover doesn't
// run the tailor itself. The Tailor button lives outside (in the
// Resume Tailor sub-section below the score) and consumes the
// aggregate selection from across every category's popover. That
// matches the user's mental model: open ⚠ on each weak category in
// sequence, pick what you have backing for, then commit once.
//
// Closes on overlay click or Escape. The PARENT also closes it on
// Tailor click so the user lands in the result strip without
// leftover overlays.

function ListingScoreFixPopover({
  anchor,
  label,
  categoryKey,
  missingKeywords,
  selectedKeywords,
  onToggle,
  onClose,
}: {
  anchor: HTMLElement | null;
  label: string;
  categoryKey: string;
  /** Listing-scoped missing keywords for this category. Already
   *  filtered to "in JD but not in resume" by the caller. */
  missingKeywords: string[];
  /** Live reference to the listing card's selectedKeywords set. The
   *  popover doesn't own this state — it just reads + dispatches
   *  toggles back up to the parent. */
  selectedKeywords: Set<string>;
  onToggle: (kw: string) => void;
  onClose: () => void;
}) {
  // Anchor position. Mirrors the flag-dropdown + network-badge +
  // dashboard-popover patterns. Fixed to document.body so card
  // overflow / transform ancestors can't clip us.
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const recompute = useCallback(() => {
    if (!anchor) return;
    const r = anchor.getBoundingClientRect();
    const width = 360;
    const margin = 8;
    const left = Math.max(margin, Math.min(r.right - width, window.innerWidth - width - margin));
    setPos({ top: r.bottom + 6, left });
  }, [anchor]);
  useEffect(() => {
    recompute();
    const onChange = () => recompute();
    window.addEventListener('scroll', onChange, true);
    window.addEventListener('resize', onChange);
    return () => {
      window.removeEventListener('scroll', onChange, true);
      window.removeEventListener('resize', onChange);
    };
  }, [recompute]);

  // Escape closes — convention for modals + popovers across the app.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  if (typeof document === 'undefined' || !pos) return null;

  const selectedInCat = missingKeywords.filter((k) => selectedKeywords.has(k)).length;
  const allOn = selectedInCat === missingKeywords.length && missingKeywords.length > 0;

  function toggleAll() {
    // Bulk operation: if everything is already on, deselect all;
    // otherwise select all. Mirrors the dashboard popover's group
    // All/None convention.
    for (const kw of missingKeywords) {
      const isOn = selectedKeywords.has(kw);
      if (allOn) {
        if (isOn) onToggle(kw);
      } else {
        if (!isOn) onToggle(kw);
      }
    }
  }

  return createPortal(
    <>
      <div
        className="fixed inset-0 z-[60]"
        onClick={onClose}
      />
      <div
        className="fixed w-[360px] max-w-[calc(100vw-16px)] bg-white border border-slate-200 rounded-2xl shadow-modal z-[70] overflow-hidden"
        style={{ top: pos.top, left: pos.left }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-2 p-4 border-b border-slate-100">
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-slate-800 flex items-center gap-1.5">
              <AlertCircle className="w-4 h-4 text-amber-500" />
              Improve {label}
            </h3>
            <p className="text-[11px] text-slate-500 mt-0.5">
              {missingKeywords.length} keyword{missingKeywords.length === 1 ? '' : 's'} in this JD missing from your resume. Pick the ones you have backing for; they&apos;ll be staged for the next tailor.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 p-1 rounded text-slate-400 hover:bg-slate-100 hover:text-slate-700"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="max-h-[340px] overflow-y-auto p-4">
          <div className="flex items-center justify-between gap-2 mb-2">
            <span className="text-[10px] uppercase font-semibold tracking-wide text-slate-500">
              {categoryKey} keywords
            </span>
            <button
              type="button"
              onClick={toggleAll}
              className="text-[10px] font-semibold uppercase tracking-wide text-indigo-600 hover:text-indigo-700"
              title={allOn ? 'Deselect all' : 'Select all'}
            >
              {allOn ? 'None' : 'All'} ({selectedInCat}/{missingKeywords.length})
            </button>
          </div>
          <div className="flex flex-wrap gap-1">
            {missingKeywords.map((kw) => {
              const isOn = selectedKeywords.has(kw);
              return (
                <button
                  key={kw}
                  type="button"
                  onClick={() => onToggle(kw)}
                  className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-medium border transition-colors ${
                    isOn
                      ? 'bg-indigo-100 text-indigo-700 border-indigo-200 hover:bg-indigo-200'
                      : 'bg-white text-slate-400 border-slate-200 line-through hover:bg-slate-50'
                  }`}
                  title={isOn ? 'Click to exclude' : 'Click to include'}
                >
                  {isOn && <Check className="w-2.5 h-2.5" />}
                  {kw}
                </button>
              );
            })}
          </div>
        </div>
        <div className="flex items-center justify-between gap-2 p-3 border-t border-slate-100 bg-slate-50/60">
          <span className="text-[11px] text-slate-500">
            {selectedInCat} selected in {label}
          </span>
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-800 rounded-lg transition-colors"
          >
            Done
          </button>
        </div>
      </div>
    </>,
    document.body,
  );
}
