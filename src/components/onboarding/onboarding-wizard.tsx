'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import {
  Briefcase, MapPin, DollarSign, FileText, Upload, Check,
  ChevronRight, ChevronLeft, Loader2, X, Globe, Building2,
  CheckCircle2, XCircle, Rocket,
} from 'lucide-react';
import type { WorkMode } from '@/lib/types';
import { LEVEL_TIERS, WORK_AUTH_COUNTRIES } from '@/lib/types';
import { LocationAutocomplete } from '@/components/location-autocomplete';

const STEPS = ['Role & Level', 'Location', 'Salary', 'Resume', 'Companies', 'Fetch Jobs'] as const;

// Step indices (keep in sync with STEPS order above).
const STEP_ROLE = 0;
const STEP_LOCATION = 1;
const STEP_SALARY = 2;
const STEP_RESUME = 3;
const STEP_COMPANIES = 4;
const STEP_FETCH = 5;

const SUGGESTED_ROLES = [
  // Engineering Management
  'Engineering Manager',
  'Software Development Manager',
  'Director of Engineering',
  'VP of Engineering',
  // Software Engineering
  'Software Engineer',
  'Senior Software Engineer',
  'Staff Engineer',
  'Principal Engineer',
  // Product & Program
  'Product Manager',
  'Technical Program Manager',
  'Program Manager',
  // Data & ML
  'Data Scientist',
  'Data Engineer',
  'Machine Learning Engineer',
  'Applied Scientist',
  // Other Tech
  'Solutions Architect',
  'DevOps Engineer',
  'Site Reliability Engineer',
  'UX Designer',
];

const SUGGESTED_LOCATIONS = [
  'Seattle, WA',
  'San Francisco, CA',
  'New York, NY',
  'Austin, TX',
  'Los Angeles, CA',
  'Boston, MA',
  'Denver, CO',
  'Chicago, IL',
  'Portland, OR',
  'Washington, DC',
  'Remote',
];

const WORK_MODES: { key: WorkMode; label: string; desc: string }[] = [
  { key: 'remote', label: 'Remote', desc: 'Work from anywhere' },
  { key: 'hybrid', label: 'Hybrid', desc: 'Mix of office & remote' },
  { key: 'onsite', label: 'On-site', desc: 'Full time in office' },
];

// ─── SSE progress types ────────────────────────────────────────────

interface FetchProgress {
  company: string;
  jobsFound: number;
  totalJobsSoFar: number;
  status: 'success' | 'error';
}

interface FetchState {
  phase: 'idle' | 'fetching' | 'done' | 'error';
  completed: number;
  total: number;
  totalJobs: number;
  companiesSuccess: number;
  companiesFailed: number;
  log: FetchProgress[];
}

// ─── Component ─────────────────────────────────────────────────────

export default function OnboardingWizard() {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [saving, setSaving] = useState(false);

  // Form state
  const [userName, setUserName] = useState('');
  const [roles, setRoles] = useState<string[]>([]);
  const [customRole, setCustomRole] = useState('');
  const [levels, setLevels] = useState<string[]>([]);
  const [locations, setLocations] = useState<string[]>([]);
  const [workMode, setWorkMode] = useState<WorkMode[]>([]);
  // Default to US — most users land here from the US, and the listings
  // filter is "show countries the user is authorized to work in".
  // Adding more countries is one click away in the same step.
  const [workAuthCountries, setWorkAuthCountries] = useState<string[]>(['US']);
  const [salaryMin, setSalaryMin] = useState('');
  const [salaryMax, setSalaryMax] = useState('');
  const [salaryBaseMin, setSalaryBaseMin] = useState('');
  const [salaryBaseMax, setSalaryBaseMax] = useState('');
  const [salaryBonusMin, setSalaryBonusMin] = useState('');
  const [salaryBonusMax, setSalaryBonusMax] = useState('');
  const [salaryEquityMin, setSalaryEquityMin] = useState('');
  const [salaryEquityMax, setSalaryEquityMax] = useState('');
  const [salarySkipped, setSalarySkipped] = useState(false);
  const [showSalaryBreakdown, setShowSalaryBreakdown] = useState(false);

  // Prospective companies (step 4 preview)
  const [companyPreview, setCompanyPreview] = useState<
    { name: string; region?: string; ats: string }[] | null
  >(null);
  const [companyPreviewLoading, setCompanyPreviewLoading] = useState(false);

  // Resume
  const [resumeFile, setResumeFile] = useState<string | null>(null);
  const [resumeText, setResumeText] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  // Job fetch progress (step 4)
  const [fetchState, setFetchState] = useState<FetchState>({
    phase: 'idle',
    completed: 0,
    total: 0,
    totalJobs: 0,
    companiesSuccess: 0,
    companiesFailed: 0,
    log: [],
  });
  const logEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Pre-fill from existing settings if any
    fetch('/api/settings')
      .then((r) => r.json())
      .then((data) => {
        const s = data.settings;
        if (s.userName) setUserName(s.userName);
        if (s.preferredRoles?.length) setRoles(s.preferredRoles);
        if (s.preferredLevels?.length) setLevels(s.preferredLevels);
        if (s.preferredLocations?.length) setLocations(s.preferredLocations);
        if (s.workMode?.length) setWorkMode(s.workMode);
        if (s.workAuthCountries?.length) setWorkAuthCountries(s.workAuthCountries);
        if (s.salaryMin) setSalaryMin(String(s.salaryMin));
        if (s.salaryMax) setSalaryMax(String(s.salaryMax));
        if (s.salaryBaseMin) setSalaryBaseMin(String(s.salaryBaseMin));
        if (s.salaryBaseMax) setSalaryBaseMax(String(s.salaryBaseMax));
        if (s.salaryBonusMin) setSalaryBonusMin(String(s.salaryBonusMin));
        if (s.salaryBonusMax) setSalaryBonusMax(String(s.salaryBonusMax));
        if (s.salaryEquityMin) setSalaryEquityMin(String(s.salaryEquityMin));
        if (s.salaryEquityMax) setSalaryEquityMax(String(s.salaryEquityMax));
        if (s.salarySkipped) setSalarySkipped(true);
      })
      .catch(() => {});
    fetch('/api/resume')
      .then((r) => r.json())
      .then((data) => {
        if (data.fileName) setResumeFile(data.fileName);
        if (data.text) setResumeText(data.text);
      })
      .catch(() => {});
  }, []);

  // Auto-scroll log to bottom
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [fetchState.log]);

  function toggleRole(role: string) {
    setRoles((prev) =>
      prev.includes(role) ? prev.filter((r) => r !== role) : [...prev, role]
    );
  }

  function addCustomRole() {
    const trimmed = customRole.trim();
    if (trimmed && !roles.includes(trimmed)) {
      setRoles((prev) => [...prev, trimmed]);
      setCustomRole('');
    }
  }

  function toggleLocation(loc: string) {
    setLocations((prev) =>
      prev.includes(loc) ? prev.filter((l) => l !== loc) : [...prev, loc]
    );
  }

  function toggleWorkMode(mode: WorkMode) {
    setWorkMode((prev) =>
      prev.includes(mode) ? prev.filter((m) => m !== mode) : [...prev, mode]
    );
  }

  function toggleLevel(key: string) {
    setLevels((prev) =>
      prev.includes(key) ? prev.filter((l) => l !== key) : [...prev, key]
    );
  }

  function skipSalary() {
    setSalaryMin('');
    setSalaryMax('');
    setSalaryBaseMin('');
    setSalaryBaseMax('');
    setSalaryBonusMin('');
    setSalaryBonusMax('');
    setSalaryEquityMin('');
    setSalaryEquityMax('');
    setSalarySkipped(true);
    setStep((s) => s + 1);
  }

  const uploadFile = useCallback(async (file: File) => {
    setUploading(true);
    setUploadError(null);
    const formData = new FormData();
    formData.append('file', file);
    try {
      const res = await fetch('/api/resume', { method: 'POST', body: formData });
      const raw = await res.text();
      let data: { fileName?: string; text?: string; error?: string; details?: string } = {};
      try {
        data = raw ? JSON.parse(raw) : {};
      } catch {
        throw new Error(
          `Server returned an unexpected response (HTTP ${res.status}). ${raw.slice(0, 200)}`
        );
      }
      if (!res.ok) throw new Error(data.error || `Upload failed (HTTP ${res.status})`);
      setResumeFile(data.fileName || null);
      setResumeText(data.text || '');
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploading(false);
    }
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      const file = e.dataTransfer.files[0];
      if (file) uploadFile(file);
    },
    [uploadFile]
  );

  const handleFileInput = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) uploadFile(file);
    },
    [uploadFile]
  );

  // Save preferences and move to the companies preview step.
  async function handleSaveAndPreview() {
    setSaving(true);
    try {
      await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userName,
          preferredRoles: roles,
          preferredLevels: levels,
          preferredLocations: locations,
          workMode,
          workAuthCountries,
          salaryMin: salaryMin ? Number(salaryMin) : null,
          salaryMax: salaryMax ? Number(salaryMax) : null,
          salaryBaseMin: salaryBaseMin ? Number(salaryBaseMin) : null,
          salaryBaseMax: salaryBaseMax ? Number(salaryBaseMax) : null,
          salaryBonusMin: salaryBonusMin ? Number(salaryBonusMin) : null,
          salaryBonusMax: salaryBonusMax ? Number(salaryBonusMax) : null,
          salaryEquityMin: salaryEquityMin ? Number(salaryEquityMin) : null,
          salaryEquityMax: salaryEquityMax ? Number(salaryEquityMax) : null,
          salarySkipped,
          onboardingComplete: true,
        }),
      });
      // Fetch the list of prospective companies to preview
      setCompanyPreviewLoading(true);
      try {
        const res = await fetch('/api/companies/preview');
        const raw = await res.text();
        const data = raw ? JSON.parse(raw) : {};
        setCompanyPreview(data.companies || []);
      } catch {
        setCompanyPreview([]);
      } finally {
        setCompanyPreviewLoading(false);
      }
      setStep(STEP_COMPANIES);
    } finally {
      setSaving(false);
    }
  }

  // Start SSE fetch of job listings
  function startFetch() {
    setFetchState({
      phase: 'fetching',
      completed: 0,
      total: 0,
      totalJobs: 0,
      companiesSuccess: 0,
      companiesFailed: 0,
      log: [],
    });

    const evtSource = new EventSource('/api/listings/fetch-stream');

    evtSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);

        if (data.type === 'start') {
          setFetchState((prev) => ({ ...prev, total: data.total }));
        } else if (data.type === 'progress') {
          setFetchState((prev) => ({
            ...prev,
            completed: data.completed,
            totalJobs: data.totalJobsSoFar,
            log: [
              ...prev.log,
              {
                company: data.company,
                jobsFound: data.jobsFound,
                totalJobsSoFar: data.totalJobsSoFar,
                status: data.status,
              },
            ],
          }));
        } else if (data.type === 'complete') {
          setFetchState((prev) => ({
            ...prev,
            phase: 'done',
            totalJobs: data.totalJobs,
            companiesSuccess: data.companiesSuccess,
            companiesFailed: data.companiesFailed,
          }));
          evtSource.close();
        }
      } catch {
        // ignore parse errors
      }
    };

    evtSource.onerror = () => {
      setFetchState((prev) => ({
        ...prev,
        phase: prev.phase === 'done' ? 'done' : 'error',
      }));
      evtSource.close();
    };
  }

  // Auto-start fetch when reaching the Fetch step
  useEffect(() => {
    if (step === STEP_FETCH && fetchState.phase === 'idle') {
      startFetch();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  const canProceed = () => {
    if (step === STEP_ROLE) return roles.length > 0;
    if (step === STEP_LOCATION) return locations.length > 0 || workMode.length > 0;
    return true; // salary & resume are optional
  };

  const pct = fetchState.total > 0
    ? Math.round((fetchState.completed / fetchState.total) * 100)
    : 0;

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50 flex items-center justify-center p-4">
      <div className="w-full max-w-2xl">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-3 mb-4">
            <Briefcase className="w-8 h-8 text-indigo-600" />
            <h1 className="text-3xl font-bold text-slate-800">Job App Assistant</h1>
          </div>
          <p className="text-slate-500">
            {step < STEP_COMPANIES
              ? "Let\u2019s set up your preferences to find the best jobs for you."
              : step === STEP_COMPANIES
                ? 'Here are the companies we\u2019ll search based on your preferences.'
                : 'Finding jobs that match your criteria...'}
          </p>
        </div>

        {/* Progress bar */}
        <div className="flex items-center gap-1 mb-8">
          {STEPS.map((s, i) => (
            <div key={s} className="flex-1 flex items-center gap-1">
              <div
                className={`h-1.5 flex-1 rounded-full transition-colors ${
                  i <= step ? 'bg-blue-600' : 'bg-gray-200'
                }`}
              />
            </div>
          ))}
        </div>

        {/* Step label */}
        {step < STEP_FETCH && (
          <div className="flex items-center gap-2 mb-6">
            <span className="text-xs font-medium text-indigo-600 bg-indigo-50 px-2 py-1 rounded-full">
              Step {step + 1} of {STEPS.length}
            </span>
            <span className="text-sm text-slate-500">{STEPS[step]}</span>
          </div>
        )}

        {/* Card */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-8">
          {/* ─── Step 0: Role preferences ─── */}
          {step === STEP_ROLE && (
            <div>
              <div className="flex items-center gap-3 mb-2">
                <Briefcase className="w-5 h-5 text-indigo-500" />
                <h2 className="text-xl font-semibold text-slate-800">What roles are you looking for?</h2>
              </div>
              <p className="text-sm text-slate-500 mb-6">
                Select or type the job titles you&apos;re targeting. We&apos;ll use these to find matching listings.
              </p>

              {/* Name field */}
              <div className="mb-6">
                <label className="block text-xs font-medium text-slate-500 mb-1.5">Your Name</label>
                <input
                  type="text"
                  value={userName}
                  onChange={(e) => setUserName(e.target.value)}
                  placeholder="e.g., John Doe"
                  className="w-full px-4 py-2.5 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-indigo-200 focus:border-indigo-300 outline-none"
                />
              </div>

              {/* Role chips */}
              <div className="mb-4">
                <label className="block text-xs font-medium text-slate-500 mb-2">
                  Select roles ({roles.length} selected)
                </label>
                <div className="flex flex-wrap gap-2">
                  {SUGGESTED_ROLES.map((r) => {
                    const on = roles.includes(r);
                    return (
                      <button
                        key={r}
                        type="button"
                        onClick={() => toggleRole(r)}
                        className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors ${
                          on
                            ? 'bg-blue-600 text-white border-blue-600'
                            : 'bg-white text-slate-700 border-slate-200 hover:border-blue-300 hover:bg-indigo-50'
                        }`}
                      >
                        {r}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Custom role */}
              <div className="flex gap-2">
                <input
                  type="text"
                  value={customRole}
                  onChange={(e) => setCustomRole(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && addCustomRole()}
                  placeholder="Add a custom role title..."
                  className="flex-1 px-4 py-2.5 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-indigo-200 outline-none"
                />
                <button
                  type="button"
                  onClick={addCustomRole}
                  disabled={!customRole.trim()}
                  className="px-4 py-2.5 bg-slate-100 text-slate-700 text-sm font-medium rounded-lg hover:bg-gray-200 disabled:opacity-40"
                >
                  Add
                </button>
              </div>

              {/* Selected custom roles (non-suggested) */}
              {roles.filter((r) => !SUGGESTED_ROLES.includes(r)).length > 0 && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {roles
                    .filter((r) => !SUGGESTED_ROLES.includes(r))
                    .map((r) => (
                      <span
                        key={r}
                        className="inline-flex items-center gap-1 px-3 py-1.5 bg-blue-100 text-indigo-700 rounded-lg text-sm font-medium"
                      >
                        {r}
                        <button type="button" onClick={() => toggleRole(r)} className="hover:text-indigo-900">
                          <X className="w-3 h-3" />
                        </button>
                      </span>
                    ))}
                </div>
              )}

              {/* Levels / seniority tier */}
              <div className="mt-8 pt-6 border-t border-slate-100">
                <label className="block text-xs font-medium text-slate-500 mb-1.5">
                  Desired Level{levels.length > 0 && ` (${levels.length} selected)`}
                </label>
                <p className="text-xs text-slate-400 mb-3">
                  Optional. Pick the seniority tiers you&apos;d consider. Each tier lists equivalents across major tech companies.
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {LEVEL_TIERS.map((tier) => {
                    const on = levels.includes(tier.key);
                    return (
                      <button
                        key={tier.key}
                        type="button"
                        onClick={() => toggleLevel(tier.key)}
                        className={`text-left p-3 rounded-lg border transition-colors ${
                          on
                            ? 'border-blue-600 bg-indigo-50'
                            : 'border-slate-200 hover:border-blue-300 hover:bg-slate-50'
                        }`}
                      >
                        <div className={`text-sm font-semibold ${on ? 'text-indigo-700' : 'text-slate-800'}`}>
                          {tier.label}
                        </div>
                        <div className="text-xs text-slate-500 mt-0.5">{tier.examples}</div>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {/* ─── Step 1: Location & work mode ─── */}
          {step === STEP_LOCATION && (
            <div>
              <div className="flex items-center gap-3 mb-2">
                <MapPin className="w-5 h-5 text-indigo-500" />
                <h2 className="text-xl font-semibold text-slate-800">Where do you want to work?</h2>
              </div>
              <p className="text-sm text-slate-500 mb-6">
                Select your preferred locations and work arrangement.
              </p>

              {/* Work mode */}
              <div className="mb-6">
                <label className="block text-xs font-medium text-slate-500 mb-2">Work Arrangement</label>
                <div className="grid grid-cols-3 gap-3">
                  {WORK_MODES.map((m) => {
                    const on = workMode.includes(m.key);
                    return (
                      <button
                        key={m.key}
                        type="button"
                        onClick={() => toggleWorkMode(m.key)}
                        className={`p-4 rounded-xl border-2 text-left transition-all ${
                          on
                            ? 'border-blue-600 bg-indigo-50'
                            : 'border-slate-200 hover:border-slate-200'
                        }`}
                      >
                        <span className={`block text-sm font-semibold ${on ? 'text-indigo-700' : 'text-slate-800'}`}>
                          {m.label}
                        </span>
                        <span className="block text-xs text-slate-500 mt-0.5">{m.desc}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Work authorization. Drives the listings filter so users only
                  see roles they could legally take. Defaults to US — the user
                  can add more countries (Canada, UK, etc.) if they're
                  authorized in those too. */}
              <div className="mb-6">
                <label className="block text-xs font-medium text-slate-500 mb-2">
                  Work Authorization (countries you can legally work in)
                </label>
                <p className="text-xs text-slate-400 mb-2">
                  Job listings outside these countries (e.g. <em>Remote — Canada</em> for a US-only worker) will be filtered out.
                </p>
                <div className="flex flex-wrap gap-2">
                  {WORK_AUTH_COUNTRIES.map((c) => {
                    const on = workAuthCountries.includes(c.code);
                    return (
                      <button
                        key={c.code}
                        type="button"
                        onClick={() =>
                          setWorkAuthCountries((prev) =>
                            prev.includes(c.code)
                              ? prev.filter((x) => x !== c.code)
                              : [...prev, c.code]
                          )
                        }
                        className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors ${
                          on
                            ? 'bg-blue-600 text-white border-blue-600'
                            : 'bg-white text-slate-700 border-slate-200 hover:border-blue-300 hover:bg-indigo-50'
                        }`}
                      >
                        {on && <Check className="inline w-3 h-3 mr-1" />}
                        {c.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Location chips */}
              <div className="mb-4">
                <label className="block text-xs font-medium text-slate-500 mb-2">
                  Preferred Locations ({locations.length} selected)
                </label>
                <div className="flex flex-wrap gap-2">
                  {SUGGESTED_LOCATIONS.map((loc) => {
                    const on = locations.includes(loc);
                    return (
                      <button
                        key={loc}
                        type="button"
                        onClick={() => toggleLocation(loc)}
                        className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors ${
                          on
                            ? 'bg-blue-600 text-white border-blue-600'
                            : 'bg-white text-slate-700 border-slate-200 hover:border-blue-300 hover:bg-indigo-50'
                        }`}
                      >
                        {loc}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Custom location with global tech-hub autocomplete */}
              <LocationAutocomplete
                existing={locations}
                onSelect={(loc) => {
                  if (!locations.includes(loc)) {
                    setLocations((prev) => [...prev, loc]);
                  }
                }}
              />

              {/* Selected custom locations (non-suggested) — e.g. "Bellevue, WA"
                  added via the autocomplete. Shown as removable chips so the
                  user can see that their pick registered. */}
              {locations.filter((l) => !SUGGESTED_LOCATIONS.includes(l)).length > 0 && (
                <div className="mt-3">
                  <label className="block text-xs font-medium text-slate-500 mb-2">
                    Added locations
                  </label>
                  <div className="flex flex-wrap gap-2">
                    {locations
                      .filter((l) => !SUGGESTED_LOCATIONS.includes(l))
                      .map((l) => (
                        <span
                          key={l}
                          className="inline-flex items-center gap-1 px-3 py-1.5 bg-blue-100 text-indigo-700 rounded-lg text-sm font-medium"
                        >
                          <MapPin className="w-3 h-3" />
                          {l}
                          <button
                            type="button"
                            onClick={() => toggleLocation(l)}
                            className="hover:text-indigo-900"
                            aria-label={`Remove ${l}`}
                          >
                            <X className="w-3 h-3" />
                          </button>
                        </span>
                      ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ─── Step 2: Salary ─── */}
          {step === STEP_SALARY && (
            <div>
              <div className="flex items-center gap-3 mb-2">
                <DollarSign className="w-5 h-5 text-indigo-500" />
                <h2 className="text-xl font-semibold text-slate-800">Salary Expectations</h2>
              </div>
              <p className="text-sm text-slate-500 mb-6">
                Optional. Enter total annual comp (base + bonus + equity), or either a minimum <b>or</b> a maximum.
                You can also add a breakdown or skip this step entirely.
              </p>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-500 mb-1.5">
                    Min total comp (optional)
                  </label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm">$</span>
                    <input
                      type="number"
                      value={salaryMin}
                      onChange={(e) => {
                        setSalaryMin(e.target.value);
                        if (e.target.value) setSalarySkipped(false);
                      }}
                      placeholder="e.g., 200000"
                      className="w-full pl-7 pr-4 py-2.5 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-indigo-200 outline-none"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-500 mb-1.5">
                    Max total comp (optional)
                  </label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm">$</span>
                    <input
                      type="number"
                      value={salaryMax}
                      onChange={(e) => {
                        setSalaryMax(e.target.value);
                        if (e.target.value) setSalarySkipped(false);
                      }}
                      placeholder="e.g., 350000"
                      className="w-full pl-7 pr-4 py-2.5 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-indigo-200 outline-none"
                    />
                  </div>
                </div>
              </div>

              {/* Breakdown toggle */}
              <button
                type="button"
                onClick={() => setShowSalaryBreakdown((v) => !v)}
                className="mt-4 text-xs font-medium text-indigo-600 hover:text-indigo-700"
              >
                {showSalaryBreakdown ? '− Hide breakdown' : '+ Show breakdown (base, bonus, equity)'}
              </button>

              {showSalaryBreakdown && (
                <div className="mt-4 space-y-3 p-4 bg-slate-50 border border-slate-200 rounded-lg">
                  {[
                    { label: 'Base salary', min: salaryBaseMin, max: salaryBaseMax, setMin: setSalaryBaseMin, setMax: setSalaryBaseMax, ph: '180000' },
                    { label: 'Annual bonus', min: salaryBonusMin, max: salaryBonusMax, setMin: setSalaryBonusMin, setMax: setSalaryBonusMax, ph: '30000' },
                    { label: 'Equity / RSUs (annualized)', min: salaryEquityMin, max: salaryEquityMax, setMin: setSalaryEquityMin, setMax: setSalaryEquityMax, ph: '100000' },
                  ].map((row) => (
                    <div key={row.label} className="grid grid-cols-[140px_1fr_1fr] items-center gap-2">
                      <label className="text-xs text-slate-600">{row.label}</label>
                      <div className="relative">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-xs">$</span>
                        <input
                          type="number"
                          value={row.min}
                          onChange={(e) => {
                            row.setMin(e.target.value);
                            if (e.target.value) setSalarySkipped(false);
                          }}
                          placeholder={`min ${row.ph}`}
                          className="w-full pl-6 pr-2 py-1.5 border border-slate-200 rounded text-xs focus:ring-2 focus:ring-indigo-200 outline-none"
                        />
                      </div>
                      <div className="relative">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-xs">$</span>
                        <input
                          type="number"
                          value={row.max}
                          onChange={(e) => {
                            row.setMax(e.target.value);
                            if (e.target.value) setSalarySkipped(false);
                          }}
                          placeholder={`max ${row.ph}`}
                          className="w-full pl-6 pr-2 py-1.5 border border-slate-200 rounded text-xs focus:ring-2 focus:ring-indigo-200 outline-none"
                        />
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {salarySkipped && (
                <p className="text-xs text-slate-400 mt-3 italic">
                  Salary step is currently set to skip. Enter any value above to unset.
                </p>
              )}
            </div>
          )}

          {/* ─── Step 3: Resume upload ─── */}
          {step === STEP_RESUME && (
            <div>
              <div className="flex items-center gap-3 mb-2">
                <FileText className="w-5 h-5 text-indigo-500" />
                <h2 className="text-xl font-semibold text-slate-800">Upload Your Resume</h2>
              </div>
              <p className="text-sm text-slate-500 mb-6">
                Upload your current resume so we can score it against job descriptions and help you tailor it.
              </p>

              {resumeFile && (
                <div className="flex items-center gap-2 mb-4 p-3 bg-green-50 border border-green-200 rounded-lg">
                  <Check className="w-4 h-4 text-green-600" />
                  <span className="text-sm text-green-700 font-medium">{resumeFile}</span>
                </div>
              )}

              <div
                onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={handleDrop}
                className={`border-2 border-dashed rounded-xl p-10 text-center transition-colors ${
                  dragOver
                    ? 'border-indigo-400 bg-indigo-50'
                    : 'border-slate-200 hover:border-slate-300'
                }`}
              >
                <Upload className="w-10 h-10 text-slate-400 mx-auto mb-3" />
                <p className="text-sm text-slate-600 mb-2">
                  {uploading ? 'Uploading...' : 'Drag and drop your resume here, or'}
                </p>
                <label className="inline-block px-5 py-2.5 bg-slate-100 text-slate-700 text-sm font-medium rounded-lg cursor-pointer hover:bg-gray-200 transition-colors">
                  Browse Files
                  <input
                    type="file"
                    accept=".docx,.pdf"
                    onChange={handleFileInput}
                    className="hidden"
                  />
                </label>
                <p className="text-xs text-slate-400 mt-2">Supports .docx and .pdf</p>
              </div>

              {uploadError && (
                <p className="text-sm text-red-600 mt-3">{uploadError}</p>
              )}

              {resumeText && (
                <div className="mt-4">
                  <h3 className="text-sm font-semibold text-slate-700 mb-2">Parsed Preview</h3>
                  <div className="bg-slate-50 border border-slate-200 rounded-lg p-4 max-h-48 overflow-y-auto">
                    <pre className="text-xs text-slate-600 whitespace-pre-wrap font-mono leading-relaxed">
                      {resumeText.slice(0, 1500)}
                      {resumeText.length > 1500 && '\n\n... (truncated)'}
                    </pre>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ─── Step 4: Companies Preview ─── */}
          {step === STEP_COMPANIES && (
            <div>
              <div className="flex items-center gap-3 mb-2">
                <Building2 className="w-5 h-5 text-indigo-500" />
                <h2 className="text-xl font-semibold text-slate-800">Prospective Companies</h2>
              </div>
              <p className="text-sm text-slate-500 mb-5">
                Based on your preferences, we&apos;ll search the career pages of these companies for matching jobs.
                {locations.length > 0 && (
                  <> Filtered to: <b>{locations.slice(0, 4).join(', ')}{locations.length > 4 && ` +${locations.length - 4} more`}</b>.</>
                )}
              </p>

              {companyPreviewLoading && (
                <div className="flex items-center gap-3 py-10 justify-center">
                  <Loader2 className="w-5 h-5 text-indigo-500 animate-spin" />
                  <span className="text-sm text-slate-500">Identifying prospective companies...</span>
                </div>
              )}

              {!companyPreviewLoading && companyPreview && companyPreview.length === 0 && (
                <div className="p-4 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-800">
                  No companies could be loaded. You can still continue &mdash; we&apos;ll search all available sources.
                </div>
              )}

              {!companyPreviewLoading && companyPreview && companyPreview.length > 0 && (
                <>
                  <div className="mb-3 text-xs text-slate-500 font-medium">
                    {companyPreview.length} companies will be searched
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 max-h-80 overflow-y-auto pr-1">
                    {companyPreview.map((c) => (
                      <div
                        key={c.name}
                        className="flex items-center gap-2 px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm"
                      >
                        <Building2 className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                        <div className="min-w-0 flex-1">
                          <div className="truncate font-medium text-slate-700">{c.name}</div>
                          {c.region && (
                            <div className="truncate text-xs text-slate-400">{c.region}</div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                  <p className="mt-4 text-xs text-slate-400">
                    Next, we&apos;ll scour each company&apos;s career page and collect all jobs matching your role &amp; level preferences.
                  </p>
                </>
              )}
            </div>
          )}

          {/* ─── Step 5: Fetching Jobs (live progress) ─── */}
          {step === STEP_FETCH && (
            <div>
              <div className="flex items-center gap-3 mb-2">
                <Globe className="w-5 h-5 text-indigo-500" />
                <h2 className="text-xl font-semibold text-slate-800">
                  {fetchState.phase === 'done' ? 'Jobs Found!' : 'Searching for Jobs...'}
                </h2>
              </div>
              <p className="text-sm text-slate-500 mb-6">
                {fetchState.phase === 'done'
                  ? 'We found jobs matching your criteria across multiple companies.'
                  : 'Scanning career pages from top tech companies. This takes 15\u201330 seconds.'}
              </p>

              {/* Progress bar */}
              {fetchState.phase === 'fetching' && (
                <div className="mb-5">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-medium text-indigo-700">
                      {fetchState.completed} / {fetchState.total} companies
                    </span>
                    <span className="text-sm font-bold text-indigo-700">{pct}%</span>
                  </div>
                  <div className="h-3 bg-blue-100 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-blue-600 rounded-full transition-all duration-300 ease-out"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <div className="flex items-center gap-2 mt-2">
                    <Loader2 className="w-3.5 h-3.5 text-indigo-500 animate-spin" />
                    <span className="text-xs text-slate-500">
                      {fetchState.totalJobs.toLocaleString()} jobs found so far...
                    </span>
                  </div>
                </div>
              )}

              {/* Completion summary */}
              {fetchState.phase === 'done' && (
                <div className="mb-5 p-4 bg-green-50 border border-green-200 rounded-xl">
                  <div className="flex items-center gap-3 mb-3">
                    <CheckCircle2 className="w-6 h-6 text-green-600" />
                    <div>
                      <p className="text-lg font-bold text-green-800">
                        {fetchState.totalJobs.toLocaleString()} jobs found
                      </p>
                      <p className="text-xs text-green-600">
                        From {fetchState.companiesSuccess} companies
                        {fetchState.companiesFailed > 0 && (
                          <span className="text-amber-600"> ({fetchState.companiesFailed} unavailable)</span>
                        )}
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {fetchState.phase === 'error' && fetchState.completed === 0 && (
                <div className="mb-5 p-4 bg-red-50 border border-red-200 rounded-xl">
                  <div className="flex items-center gap-3">
                    <XCircle className="w-6 h-6 text-red-500" />
                    <div>
                      <p className="text-sm font-semibold text-red-800">Failed to fetch listings</p>
                      <p className="text-xs text-red-600">Please check your connection and try again.</p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={startFetch}
                    className="mt-3 px-4 py-2 bg-red-600 text-white text-sm font-medium rounded-lg hover:bg-red-700"
                  >
                    Retry
                  </button>
                </div>
              )}

              {/* Live log */}
              {fetchState.log.length > 0 && (
                <div className="bg-slate-50 border border-slate-200 rounded-lg max-h-56 overflow-y-auto">
                  <div className="p-3 space-y-1">
                    {fetchState.log.map((entry, i) => (
                      <div key={i} className="flex items-center gap-2 text-xs">
                        {entry.status === 'success' ? (
                          <CheckCircle2 className="w-3.5 h-3.5 text-green-500 shrink-0" />
                        ) : (
                          <XCircle className="w-3.5 h-3.5 text-red-400 shrink-0" />
                        )}
                        <span className="font-medium text-slate-700">{entry.company}</span>
                        {entry.status === 'success' ? (
                          <span className="text-slate-400">
                            &mdash; {entry.jobsFound} jobs
                          </span>
                        ) : (
                          <span className="text-red-400">&mdash; unavailable</span>
                        )}
                      </div>
                    ))}
                    <div ref={logEndRef} />
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Navigation buttons */}
        <div className="flex items-center justify-between mt-6">
          {step < STEP_FETCH ? (
            <button
              type="button"
              onClick={() => setStep((s) => s - 1)}
              disabled={step === STEP_ROLE}
              className="flex items-center gap-2 px-5 py-2.5 text-sm font-medium text-slate-600 hover:text-slate-800 disabled:opacity-0"
            >
              <ChevronLeft className="w-4 h-4" />
              Back
            </button>
          ) : (
            <div />
          )}

          {/* Salary step gets a "Skip" in the middle */}
          {step === STEP_SALARY && (
            <button
              type="button"
              onClick={skipSalary}
              className="text-sm text-slate-500 hover:text-slate-700 underline underline-offset-2"
            >
              Skip this step
            </button>
          )}

          {step < STEP_RESUME && (
            <button
              type="button"
              onClick={() => setStep((s) => s + 1)}
              disabled={!canProceed()}
              className="flex items-center gap-2 px-6 py-2.5 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
            >
              Continue
              <ChevronRight className="w-4 h-4" />
            </button>
          )}

          {step === STEP_RESUME && (
            <button
              type="button"
              onClick={handleSaveAndPreview}
              disabled={saving}
              className="flex items-center gap-2 px-6 py-2.5 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
            >
              {saving ? (
                <><Loader2 className="w-4 h-4 animate-spin" /> Saving...</>
              ) : (
                <>Review Companies <ChevronRight className="w-4 h-4" /></>
              )}
            </button>
          )}

          {step === STEP_COMPANIES && (
            <button
              type="button"
              onClick={() => setStep(STEP_FETCH)}
              disabled={companyPreviewLoading}
              className="flex items-center gap-2 px-6 py-2.5 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700 disabled:opacity-50 transition-colors"
            >
              <Rocket className="w-4 h-4" /> Find Jobs
            </button>
          )}

          {step === STEP_FETCH && fetchState.phase === 'done' && (
            <button
              type="button"
              onClick={() => router.push('/dashboard')}
              className="flex items-center gap-2 px-6 py-2.5 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors"
            >
              <Rocket className="w-4 h-4" /> Go to Dashboard
            </button>
          )}
        </div>

        {step < STEP_FETCH && (
          <p className="text-center text-xs text-slate-400 mt-4">
            You can change all preferences later in Settings.
          </p>
        )}
      </div>
    </div>
  );
}
