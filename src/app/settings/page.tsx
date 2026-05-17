'use client';

import { useState, useEffect, useCallback } from 'react';
import { Upload, FileText, Check, User, Briefcase, MapPin, DollarSign, X, RefreshCw, Loader2, Trash2 } from 'lucide-react';
import { CustomSourcesPanel } from '@/components/settings/custom-sources';
import { NetworkImportPanel } from '@/components/settings/network-import';
import type { WorkMode } from '@/lib/types';
import { LEVEL_TIERS, WORK_AUTH_COUNTRIES } from '@/lib/types';
import { LocationAutocomplete } from '@/components/location-autocomplete';

const WORK_MODES: { key: WorkMode; label: string }[] = [
  { key: 'remote', label: 'Remote' },
  { key: 'hybrid', label: 'Hybrid' },
  { key: 'onsite', label: 'On-site' },
];

export default function SettingsPage() {
  const [userName, setUserName] = useState('');
  const [resumeFileName, setResumeFileName] = useState<string | null>(null);
  const [resumeText, setResumeText] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  // Bumped after every successful upload so the embedded
  // ResumeLibrary re-fetches /api/resumes and shows the new file
  // immediately — previously the library only reloaded on its own
  // mount, so a fresh upload only appeared after the user clicked
  // Save AND refreshed.
  const [libraryRefreshKey, setLibraryRefreshKey] = useState(0);
  const [dragOver, setDragOver] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Preferences
  const [preferredRoles, setPreferredRoles] = useState<string[]>([]);
  const [customRole, setCustomRole] = useState('');
  const [preferredLevels, setPreferredLevels] = useState<string[]>([]);
  const [preferredLocations, setPreferredLocations] = useState<string[]>([]);
  const [workMode, setWorkMode] = useState<WorkMode[]>([]);
  const [workAuthCountries, setWorkAuthCountries] = useState<string[]>(['US']);
  const [needsVisaSponsorship, setNeedsVisaSponsorship] = useState(false);
  // Auto-refresh — when enabled, the listings page kicks off a
  // streaming refresh on mount whenever the cache is older than
  // `autoRefreshHours`. Default disabled so first-time users never
  // get surprised by network activity.
  const [autoRefreshEnabled, setAutoRefreshEnabled] = useState(false);
  const [autoRefreshHours, setAutoRefreshHours] = useState(24);
  // Auto follow-up reminder interval. Days after flagging a listing
  // as Applied that a reminder is scheduled. 0 disables.
  const [applyFollowupDays, setApplyFollowupDays] = useState(14);
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

  useEffect(() => {
    fetch('/api/settings', { cache: 'no-store' })
      .then((r) => r.json())
      .then((data) => {
        const s = data.settings;
        if (!s.onboardingComplete) {
          window.location.href = '/';
          return;
        }
        setUserName(s.userName || '');
        setPreferredRoles(s.preferredRoles || []);
        setPreferredLevels(s.preferredLevels || []);
        setPreferredLocations(s.preferredLocations || []);
        setWorkMode(s.workMode || []);
        setWorkAuthCountries(
          s.workAuthCountries && s.workAuthCountries.length > 0 ? s.workAuthCountries : ['US']
        );
        setNeedsVisaSponsorship(!!s.needsVisaSponsorship);
        setAutoRefreshEnabled(!!s.autoRefreshEnabled);
        setAutoRefreshHours(s.autoRefreshHours && s.autoRefreshHours > 0 ? s.autoRefreshHours : 24);
        setApplyFollowupDays(
          typeof s.applyFollowupDays === 'number' ? Math.max(0, s.applyFollowupDays) : 14,
        );
        setSalaryMin(s.salaryMin ? String(s.salaryMin) : '');
        setSalaryMax(s.salaryMax ? String(s.salaryMax) : '');
        setSalaryBaseMin(s.salaryBaseMin ? String(s.salaryBaseMin) : '');
        setSalaryBaseMax(s.salaryBaseMax ? String(s.salaryBaseMax) : '');
        setSalaryBonusMin(s.salaryBonusMin ? String(s.salaryBonusMin) : '');
        setSalaryBonusMax(s.salaryBonusMax ? String(s.salaryBonusMax) : '');
        setSalaryEquityMin(s.salaryEquityMin ? String(s.salaryEquityMin) : '');
        setSalaryEquityMax(s.salaryEquityMax ? String(s.salaryEquityMax) : '');
        setSalarySkipped(!!s.salarySkipped);
        setShowSalaryBreakdown(Boolean(s.salaryBaseMin || s.salaryBonusMin || s.salaryEquityMin || s.salaryBaseMax || s.salaryBonusMax || s.salaryEquityMax));
      });
    fetch('/api/resume', { cache: 'no-store' })
      .then((r) => r.json())
      .then((data) => {
        setResumeFileName(data.fileName);
        setResumeText(data.text);
      });
  }, []);

  const uploadFile = useCallback(async (file: File) => {
    setUploading(true);
    setMessage(null);
    const formData = new FormData();
    formData.append('file', file);
    try {
      const res = await fetch('/api/resume', {
        method: 'POST',
        cache: 'no-store',
        body: formData,
      });
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
      setResumeFileName(data.fileName || null);
      setResumeText(data.text || '');
      setLibraryRefreshKey((k) => k + 1);
      // Cross-tab broadcast: tell the dashboard (and anyone else
      // listening on this channel) to refetch state — the active
      // resume just changed, so cached score lists, resume-keyword
      // probes, and ⚠ popovers are all stale. Channel listener
      // lives in src/app/dashboard/page.tsx.
      try {
        const bc = new BroadcastChannel('job-app-assistant');
        bc.postMessage({ type: 'resume-updated' });
        bc.close();
      } catch { /* not supported — no-op */ }
      setMessage({ type: 'success', text: 'Resume uploaded and parsed successfully!' });
    } catch (err) {
      setMessage({ type: 'error', text: err instanceof Error ? err.message : 'Upload failed' });
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

  function addRole() {
    const trimmed = customRole.trim();
    if (trimmed && !preferredRoles.includes(trimmed)) {
      setPreferredRoles((prev) => [...prev, trimmed]);
      setCustomRole('');
    }
  }

  function removeRole(role: string) {
    setPreferredRoles((prev) => prev.filter((r) => r !== role));
  }


  function removeLocation(loc: string) {
    setPreferredLocations((prev) => prev.filter((l) => l !== loc));
  }

  function toggleWorkMode(mode: WorkMode) {
    setWorkMode((prev) =>
      prev.includes(mode) ? prev.filter((m) => m !== mode) : [...prev, mode]
    );
  }

  function toggleLevel(key: string) {
    setPreferredLevels((prev) =>
      prev.includes(key) ? prev.filter((l) => l !== key) : [...prev, key]
    );
  }

  const saveAll = async () => {
    setSaving(true);
    setMessage(null);
    try {
      await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userName,
          preferredRoles,
          preferredLevels,
          preferredLocations,
          workMode,
          workAuthCountries,
          needsVisaSponsorship,
          autoRefreshEnabled,
          autoRefreshHours,
          applyFollowupDays,
          salaryMin: salaryMin ? Number(salaryMin) : null,
          salaryMax: salaryMax ? Number(salaryMax) : null,
          salaryBaseMin: salaryBaseMin ? Number(salaryBaseMin) : null,
          salaryBaseMax: salaryBaseMax ? Number(salaryBaseMax) : null,
          salaryBonusMin: salaryBonusMin ? Number(salaryBonusMin) : null,
          salaryBonusMax: salaryBonusMax ? Number(salaryBonusMax) : null,
          salaryEquityMin: salaryEquityMin ? Number(salaryEquityMin) : null,
          salaryEquityMax: salaryEquityMax ? Number(salaryEquityMax) : null,
          salarySkipped,
        }),
      });
      setMessage({ type: 'success', text: 'Settings saved!' });
      setTimeout(() => setMessage(null), 3000);
    } catch {
      setMessage({ type: 'error', text: 'Failed to save settings' });
    } finally {
      setSaving(false);
    }
  };

  return (
    // Outer wrapper matches the rest of the app (1400px); inner column
    // keeps the form readable (input fields shouldn't stretch the full
    // width of the page). Same pattern on /jobs/add.
    <div className="p-4 sm:p-6 max-w-[1400px] mx-auto">
     <div className="max-w-3xl mx-auto">
      <div className="flex items-center justify-between mb-8">
        <h1 className="text-2xl font-bold text-slate-800">Settings</h1>
        <button
          onClick={saveAll}
          disabled={saving}
          className="px-5 py-2.5 bg-gradient-to-r from-indigo-500 to-violet-500 text-white text-sm font-semibold rounded-xl shadow-btn-primary hover:from-indigo-600 hover:to-violet-600 hover:shadow-btn-primary-hover hover:-translate-y-0.5 active:translate-y-0 transition-all duration-200 disabled:opacity-50 disabled:translate-y-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-200 focus-visible:ring-offset-2"
        >
          {saving ? 'Saving...' : 'Save All'}
        </button>
      </div>

      {message && (
        <div
          className={`mb-6 p-4 rounded-lg text-sm font-medium ${
            message.type === 'success'
              ? 'bg-green-50 text-green-700 border border-green-200'
              : 'bg-red-50 text-red-700 border border-red-200'
          }`}
        >
          {message.text}
        </div>
      )}

      {/* User Name */}
      <section className="mb-6 bg-white rounded-xl border border-slate-200 p-6">
        <div className="flex items-center gap-3 mb-4">
          <User className="w-5 h-5 text-slate-500" />
          <h2 className="text-lg font-semibold text-slate-800">Your Name</h2>
        </div>
        <input
          type="text"
          value={userName}
          onChange={(e) => setUserName(e.target.value)}
          placeholder="Enter your name"
          className="w-full px-4 py-2.5 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-indigo-200 focus:border-indigo-300 outline-none"
        />
      </section>

      {/* Preferred Roles */}
      <section className="mb-6 bg-white rounded-xl border border-slate-200 p-6">
        <div className="flex items-center gap-3 mb-4">
          <Briefcase className="w-5 h-5 text-slate-500" />
          <h2 className="text-lg font-semibold text-slate-800">Preferred Roles</h2>
        </div>
        <p className="text-xs text-slate-500 mb-3">
          Job listings will be filtered to match these role titles.
        </p>
        <div className="flex flex-wrap gap-2 mb-3">
          {preferredRoles.map((r) => (
            <span key={r} className="inline-flex items-center gap-1 px-3 py-1.5 bg-blue-100 text-indigo-700 rounded-lg text-sm font-medium">
              {r}
              <button type="button" onClick={() => removeRole(r)} className="hover:text-indigo-900">
                <X className="w-3 h-3" />
              </button>
            </span>
          ))}
          {preferredRoles.length === 0 && (
            <span className="text-xs text-slate-400">
              No roles set — all common tech roles will be shown by default.
            </span>
          )}
        </div>
        <div className="flex gap-2">
          <input
            type="text"
            value={customRole}
            onChange={(e) => setCustomRole(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && addRole()}
            placeholder="Add a role title..."
            className="flex-1 px-4 py-2.5 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-indigo-200 outline-none"
          />
          <button type="button" onClick={addRole} disabled={!customRole.trim()}
            className="px-4 py-2.5 bg-slate-100 text-slate-700 text-sm font-medium rounded-lg hover:bg-slate-200 disabled:opacity-40">
            Add
          </button>
        </div>

        {/* Desired levels */}
        <div className="mt-6 pt-5 border-t border-slate-100">
          <label className="block text-xs font-medium text-slate-500 mb-1.5">
            Desired Level{preferredLevels.length > 0 && ` (${preferredLevels.length} selected)`}
          </label>
          <p className="text-xs text-slate-400 mb-3">
            Optional. Listings will be scored higher if they match these seniority tiers.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {LEVEL_TIERS.map((tier) => {
              const on = preferredLevels.includes(tier.key);
              return (
                <button
                  key={tier.key}
                  type="button"
                  onClick={() => toggleLevel(tier.key)}
                  className={`text-left p-3 rounded-lg border transition-colors ${
                    on
                      ? 'border-blue-600 bg-indigo-50'
                      : 'border-slate-200 hover:border-indigo-300 hover:bg-slate-50'
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
      </section>

      {/* Preferred Locations + Work Mode */}
      <section className="mb-6 bg-white rounded-xl border border-slate-200 p-6">
        <div className="flex items-center gap-3 mb-4">
          <MapPin className="w-5 h-5 text-slate-500" />
          <h2 className="text-lg font-semibold text-slate-800">Location &amp; Work Mode</h2>
        </div>

        {/* Work mode */}
        <div className="mb-4">
          <label className="block text-xs font-medium text-slate-500 mb-2">Work Arrangement</label>
          <div className="flex gap-2">
            {WORK_MODES.map((m) => {
              const on = workMode.includes(m.key);
              return (
                <button key={m.key} type="button" onClick={() => toggleWorkMode(m.key)}
                  className={`px-4 py-2 rounded-lg text-sm font-medium border transition-colors ${
                    on ? 'bg-indigo-500 text-white border-indigo-500' : 'bg-white text-slate-600 border-slate-200 hover:border-indigo-300'
                  }`}>
                  {m.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Locations */}
        <div className="flex flex-wrap gap-2 mb-3">
          {preferredLocations.map((loc) => (
            <span key={loc} className="inline-flex items-center gap-1 px-3 py-1.5 bg-blue-100 text-indigo-700 rounded-lg text-sm font-medium">
              {loc}
              <button type="button" onClick={() => removeLocation(loc)} className="hover:text-indigo-900">
                <X className="w-3 h-3" />
              </button>
            </span>
          ))}
        </div>
        <LocationAutocomplete
          existing={preferredLocations}
          onSelect={(loc) => {
            if (!preferredLocations.includes(loc)) {
              setPreferredLocations((prev) => [...prev, loc]);
            }
          }}
        />

        {/* Work authorization. Drives the listings filter — jobs in countries
            outside this list are hidden so the user only sees roles they could
            legally take. Defaults to US for legacy users. */}
        <div className="mt-6 pt-6 border-t border-slate-100">
          <label className="block text-xs font-medium text-slate-500 mb-1">
            Work Authorization
          </label>
          <p className="text-xs text-slate-400 mb-2">
            Job listings outside these countries (e.g. <em>Remote — Canada</em> for a US-only worker) are hidden.
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
                      ? 'bg-indigo-500 text-white border-indigo-500'
                      : 'bg-white text-slate-700 border-slate-200 hover:border-indigo-300 hover:bg-indigo-50'
                  }`}
                >
                  {on && <Check className="inline w-3 h-3 mr-1" />}
                  {c.label}
                </button>
              );
            })}
          </div>
          {/* Visa sponsorship sub-toggle — when on, listings whose JD
              body explicitly says "we don't sponsor" are filtered out
              (the detection runs on detail-page open, so only previously-
              viewed listings get flagged on the first pass). */}
          <div className="mt-4 pt-4 border-t border-slate-200">
            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={needsVisaSponsorship}
                onChange={(e) => setNeedsVisaSponsorship(e.target.checked)}
                className="mt-0.5 w-4 h-4"
              />
              <div>
                <div className="text-sm font-medium text-slate-800">
                  I need visa sponsorship
                </div>
                <p className="text-xs text-slate-500 mt-0.5">
                  Hide listings whose JD says &ldquo;we don&apos;t sponsor visas&rdquo;.
                  Only listings you&apos;ve opened get scanned for this phrase;
                  newly fetched ones are filtered on subsequent passes.
                </p>
              </div>
            </label>
          </div>
        </div>
      </section>

      {/* Auto-refresh — kicks off a background streaming refresh on
          the next listings-page load when the cache is older than
          the chosen window. Off by default. */}
      <section className="mb-6 bg-white rounded-xl border border-slate-200 p-6">
        <div className="flex items-center gap-3 mb-3">
          <RefreshCw className="w-5 h-5 text-slate-500" />
          <h2 className="text-lg font-semibold text-slate-800">Auto-refresh listings</h2>
        </div>
        <label className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer mb-3">
          <input
            type="checkbox"
            checked={autoRefreshEnabled}
            onChange={(e) => setAutoRefreshEnabled(e.target.checked)}
            className="rounded"
          />
          Refresh listings automatically when stale
        </label>
        {autoRefreshEnabled && (
          <div className="flex items-center gap-2 text-sm text-slate-600">
            <span>Consider listings stale after</span>
            <input
              type="number"
              min={1}
              max={168}
              value={autoRefreshHours}
              onChange={(e) => setAutoRefreshHours(Math.max(1, Number(e.target.value) || 24))}
              className="w-16 px-2 py-1 border border-slate-200 rounded text-sm focus:ring-2 focus:ring-indigo-200 outline-none"
            />
            <span>hours</span>
          </div>
        )}
        <p className="text-xs text-slate-400 mt-2">
          When enabled, opening the Listings page after the configured window automatically streams a fresh fetch from all 70+ careers boards. You can keep browsing the existing data while it runs.
        </p>
      </section>

      {/* Auto follow-up reminders when a listing is flagged Applied.
          0 disables the feature. */}
      <section className="mb-6 bg-white rounded-xl border border-slate-200 p-6">
        <div className="flex items-center gap-3 mb-3">
          <RefreshCw className="w-5 h-5 text-slate-500" />
          <h2 className="text-lg font-semibold text-slate-800">Auto follow-up reminders</h2>
        </div>
        <div className="flex items-center gap-2 text-sm text-slate-600 flex-wrap">
          <span>When I flag a listing as Applied, schedule a follow-up reminder</span>
          <input
            type="number"
            min={0}
            max={90}
            value={applyFollowupDays}
            onChange={(e) => setApplyFollowupDays(Math.max(0, Math.min(90, Number(e.target.value) || 0)))}
            className="w-16 px-2 py-1 border border-slate-200 rounded text-sm focus:ring-2 focus:ring-indigo-200 outline-none"
          />
          <span>days later.</span>
        </div>
        <p className="text-xs text-slate-400 mt-2">
          Set to <strong>0</strong> to disable. Reminders show up under the bell badge in the top nav and on the Pipeline page. Re-flagging the same listing as Applied won&apos;t create duplicates.
        </p>
      </section>

      <CustomSourcesPanel />

      <NetworkImportPanel />

      <SalaryReprocessPanel />

      {/* Salary Range (optional) */}
      <section className="mb-6 bg-white rounded-xl border border-slate-200 p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <DollarSign className="w-5 h-5 text-slate-500" />
            <h2 className="text-lg font-semibold text-slate-800">Salary Range (optional)</h2>
          </div>
          <label className="flex items-center gap-2 text-xs text-slate-500 cursor-pointer">
            <input
              type="checkbox"
              checked={salarySkipped}
              onChange={(e) => {
                setSalarySkipped(e.target.checked);
                if (e.target.checked) {
                  setSalaryMin('');
                  setSalaryMax('');
                  setSalaryBaseMin('');
                  setSalaryBaseMax('');
                  setSalaryBonusMin('');
                  setSalaryBonusMax('');
                  setSalaryEquityMin('');
                  setSalaryEquityMax('');
                }
              }}
            />
            Skip salary preferences
          </label>
        </div>

        {!salarySkipped && (
          <>
            <p className="text-xs text-slate-500 mb-3">
              Enter only a minimum, only a maximum, or both &mdash; all optional.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1.5">Min total comp (annual)</label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm">$</span>
                  <input type="number" value={salaryMin} onChange={(e) => setSalaryMin(e.target.value)}
                    placeholder="200000"
                    className="w-full pl-7 pr-4 py-2.5 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-indigo-200 outline-none" />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1.5">Max total comp (annual)</label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm">$</span>
                  <input type="number" value={salaryMax} onChange={(e) => setSalaryMax(e.target.value)}
                    placeholder="350000"
                    className="w-full pl-7 pr-4 py-2.5 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-indigo-200 outline-none" />
                </div>
              </div>
            </div>

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
                  <div key={row.label} className="grid grid-cols-[160px_1fr_1fr] items-center gap-2">
                    <label className="text-xs text-slate-600">{row.label}</label>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-xs">$</span>
                      <input type="number" value={row.min} onChange={(e) => row.setMin(e.target.value)}
                        placeholder={`min ${row.ph}`}
                        className="w-full pl-6 pr-2 py-1.5 border border-slate-200 rounded text-xs focus:ring-2 focus:ring-indigo-200 outline-none" />
                    </div>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-xs">$</span>
                      <input type="number" value={row.max} onChange={(e) => row.setMax(e.target.value)}
                        placeholder={`max ${row.ph}`}
                        className="w-full pl-6 pr-2 py-1.5 border border-slate-200 rounded text-xs focus:ring-2 focus:ring-indigo-200 outline-none" />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        {salarySkipped && (
          <p className="text-xs text-slate-400 italic">
            Salary preferences are set to skip. Uncheck above to set a target range.
          </p>
        )}
      </section>

      {/* Resume Upload */}
      <section className="bg-white rounded-xl border border-slate-200 p-6">
        <div className="flex items-center gap-3 mb-4">
          <FileText className="w-5 h-5 text-slate-500" />
          <h2 className="text-lg font-semibold text-slate-800">Resume</h2>
        </div>

        {resumeFileName && (
          <div className="flex items-center gap-2 mb-4 p-3 bg-green-50 border border-green-200 rounded-lg">
            <Check className="w-4 h-4 text-green-600" />
            <span className="text-sm text-green-700 font-medium">Current: {resumeFileName}</span>
          </div>
        )}

        <ResumeLibrary refreshKey={libraryRefreshKey} />
        <CoverLetterTemplateLibrary />


        <div
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
          className={`border-2 border-dashed rounded-xl p-10 text-center transition-colors ${
            dragOver ? 'border-indigo-400 bg-indigo-50' : 'border-slate-200 hover:border-slate-300'
          }`}
        >
          <Upload className="w-10 h-10 text-slate-400 mx-auto mb-3" />
          <p className="text-sm text-slate-600 mb-2">
            {uploading ? 'Uploading...' : 'Drag and drop your resume here, or'}
          </p>
          <label className="inline-block px-5 py-2.5 bg-indigo-50 text-indigo-700 border border-indigo-100 text-sm font-semibold rounded-xl cursor-pointer shadow-sm shadow-indigo-500/10 hover:bg-indigo-100 hover:border-indigo-200 hover:shadow-md hover:shadow-indigo-500/15 transition-all duration-200">
            Browse Files
            <input type="file" accept=".docx,.pdf" onChange={handleFileInput} className="hidden" />
          </label>
          <p className="text-xs text-slate-400 mt-2">Supports .docx and .pdf</p>
        </div>

        {resumeText && (
          <div className="mt-6">
            <h3 className="text-sm font-semibold text-slate-700 mb-2">Parsed Resume Preview</h3>
            <div className="bg-slate-50 border border-slate-200 rounded-lg p-4 max-h-80 overflow-y-auto">
              <pre className="text-xs text-slate-600 whitespace-pre-wrap font-mono leading-relaxed">
                {resumeText.slice(0, 3000)}
                {resumeText.length > 3000 && '\n\n... (truncated)'}
              </pre>
            </div>
          </div>
        )}
      </section>
     </div>
    </div>
  );
}

// ─── Salary Reprocess panel ──────────────────────────────────────────
// Backfill action that re-runs the (now smarter) salary extractor
// across every cached listing — picks up base/TC splits, OTE,
// hourly-rate normalization, equity hints that older fetches
// missed. Listings without on-disk JD HTML are skipped silently.

function SalaryReprocessPanel() {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{
    scanned: number;
    updated: number;
    baseTcSplits: number;
    equityHints: number;
    hourlyNormalized: number;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch('/api/salary-intel/reprocess', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setResult({
        scanned: data.scanned ?? 0,
        updated: data.updated ?? 0,
        baseTcSplits: data.baseTcSplits ?? 0,
        equityHints: data.equityHints ?? 0,
        hourlyNormalized: data.hourlyNormalized ?? 0,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Reprocess failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mb-6 bg-white rounded-2xl border border-slate-100 p-6 shadow-card">
      <div className="flex items-center gap-3 mb-3">
        <DollarSign className="w-5 h-5 text-slate-500" />
        <h2 className="text-lg font-semibold text-slate-800">Salary data backfill</h2>
      </div>
      <p className="text-xs text-slate-500 mb-3">
        Re-runs the salary extractor across every cached listing using the latest parser
        rules — picks up <strong>Base vs Total Comp</strong> splits, <strong>OTE</strong> for
        sales roles, <strong>hourly rates</strong> normalized to annual, and equity / RSU
        mentions. Listings open faster afterwards because the breakdown is already in cache.
      </p>
      {result && (
        <div className="mb-3 px-3 py-2 bg-indigo-50 border border-indigo-100 rounded-xl text-xs text-indigo-800">
          Scanned <strong>{result.scanned.toLocaleString()}</strong> listings · updated{' '}
          <strong>{result.updated.toLocaleString()}</strong>
          {result.baseTcSplits > 0 && (
            <> · {result.baseTcSplits} new Base/TC splits</>
          )}
          {result.equityHints > 0 && (
            <> · {result.equityHints} equity hints</>
          )}
          {result.hourlyNormalized > 0 && (
            <> · {result.hourlyNormalized} hourly rates normalized</>
          )}
        </div>
      )}
      {error && (
        <div className="mb-3 px-3 py-2 bg-rose-50 border border-rose-100 rounded-xl text-xs text-rose-700">
          {error}
        </div>
      )}
      <button
        type="button"
        onClick={run}
        disabled={busy}
        className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-50 text-indigo-700 border border-indigo-100 text-sm font-semibold rounded-xl shadow-sm shadow-indigo-500/10 hover:bg-indigo-100 hover:border-indigo-200 hover:shadow-md hover:shadow-indigo-500/15 transition-all duration-200 disabled:opacity-50"
      >
        {busy ? (
          <><RefreshCw className="w-4 h-4 animate-spin" /> Reprocessing…</>
        ) : (
          <><RefreshCw className="w-4 h-4" /> Reprocess salary data</>
        )}
      </button>
    </section>
  );
}

// ─── Resume Library panel ────────────────────────────────────────────
// Surfaces the user's resume variants in a list with switch / rename
// / delete controls. The actual upload + "add another resume" flow
// still goes through the drag-and-drop zone above this panel — that
// path now adds new entries to the library instead of replacing the
// single base resume.

interface LibraryResume {
  id: string;
  name: string;
  fileName: string;
  text: string;
  addedAt: string;
}

function ResumeLibrary({ refreshKey = 0 }: { refreshKey?: number }) {
  const [resumes, setResumes] = useState<LibraryResume[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function reload() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/resumes', { cache: 'no-store' });
      const data = await res.json();
      setResumes(Array.isArray(data.resumes) ? data.resumes : []);
      setActiveId(data.activeId ?? null);
    } catch {
      setError('Failed to load resume library');
    } finally {
      setLoading(false);
    }
  }

  // Refetch when the parent signals a change (e.g. upload completed).
  // Without this the library was only loaded on mount, so new uploads
  // didn't appear until the user navigated away + back.
  useEffect(() => {
    reload();
  }, [refreshKey]);

  async function setActive(id: string) {
    setBusyId(id);
    setError(null);
    try {
      const res = await fetch('/api/resumes/active', {
        method: 'POST',
        cache: 'no-store',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || `Failed (${res.status})`);
      }
      await reload();
      // Also broadcast — switching the active resume invalidates
      // dashboard scores + ⚠ popover state.
      try {
        const bc = new BroadcastChannel('job-app-assistant');
        bc.postMessage({ type: 'resume-updated' });
        bc.close();
      } catch { /* not supported */ }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Switch failed');
    } finally {
      setBusyId(null);
    }
  }

  async function rename(id: string, current: string) {
    const next = window.prompt('Rename resume', current);
    if (!next || next.trim() === current) return;
    setBusyId(id);
    try {
      await fetch('/api/resumes', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, name: next.trim() }),
      });
      await reload();
    } finally {
      setBusyId(null);
    }
  }

  async function remove(id: string, name: string) {
    if (!window.confirm(`Delete "${name}"? This removes the on-disk files too.`)) return;
    setBusyId(id);
    setError(null);
    try {
      const res = await fetch(`/api/resumes?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || `Delete failed (${res.status})`);
      }
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Delete failed');
    } finally {
      setBusyId(null);
    }
  }

  if (loading) return null;
  if (resumes.length === 0) return null;

  return (
    <div className="mb-4 bg-white border border-slate-100 rounded-2xl shadow-card overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 bg-slate-50/60">
        <div className="text-sm font-semibold text-slate-800">Resume library</div>
        <div className="text-xs text-slate-500">
          {resumes.length} {resumes.length === 1 ? 'resume' : 'resumes'} · active = currently used
          for scoring + tailoring
        </div>
      </div>
      {error && (
        <div className="px-4 py-2 bg-rose-50 border-b border-rose-100 text-xs text-rose-700">{error}</div>
      )}
      <ul className="divide-y divide-slate-100">
        {resumes.map((r) => {
          const isActive = r.id === activeId;
          return (
            <li key={r.id} className="px-4 py-3 flex items-center gap-3">
              <FileText className={`w-4 h-4 shrink-0 ${isActive ? 'text-indigo-500' : 'text-slate-400'}`} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className={`text-sm font-medium ${isActive ? 'text-slate-800' : 'text-slate-700'}`}>
                    {r.name}
                  </span>
                  {isActive && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-indigo-50 text-indigo-700 border border-indigo-100">
                      Active
                    </span>
                  )}
                </div>
                <div className="text-xs text-slate-500 truncate">
                  {r.fileName} · added {new Date(r.addedAt).toLocaleDateString()} ·{' '}
                  {r.text.length.toLocaleString()} chars parsed
                </div>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                {!isActive && (
                  <button
                    type="button"
                    onClick={() => setActive(r.id)}
                    disabled={!!busyId}
                    className="inline-flex items-center gap-1 px-3 py-1 rounded-lg text-xs font-semibold bg-indigo-50 text-indigo-700 border border-indigo-100 hover:bg-indigo-100 hover:border-indigo-200 transition-all disabled:opacity-50"
                    title="Make this resume the active one — wipes the score cache because cached scores were computed against a different resume"
                  >
                    {busyId === r.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
                    Make active
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => rename(r.id, r.name)}
                  disabled={!!busyId}
                  className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium text-slate-500 hover:bg-slate-100 hover:text-slate-700 transition-all disabled:opacity-50"
                >
                  Rename
                </button>
                <button
                  type="button"
                  onClick={() => remove(r.id, r.name)}
                  disabled={!!busyId || resumes.length <= 1}
                  className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium text-rose-600 hover:bg-rose-50 hover:text-rose-700 transition-all disabled:opacity-30 disabled:cursor-not-allowed"
                  title={resumes.length <= 1 ? 'You need at least one resume — upload another before deleting this one' : 'Delete this resume + its on-disk files'}
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
            </li>
          );
        })}
      </ul>
      <div className="px-4 py-2 border-t border-slate-100 bg-slate-50/60 text-[11px] text-slate-500">
        Use the upload box below to add another resume variant. New uploads add to the library; click <strong>Make active</strong> on any entry to switch which one the app uses.
      </div>
    </div>
  );
}

// ─── Cover-letter template library ──────────────────────────────────
// Saved cover-letter templates are loadable from the per-listing
// cover-letter pane. This panel lists, renames, and deletes them.
// Empty state hides the whole panel — no UI clutter until the user
// saves their first template.

interface CLTemplate {
  id: string;
  name: string;
  text: string;
  createdAt: string;
  updatedAt?: string;
}

function CoverLetterTemplateLibrary() {
  const [templates, setTemplates] = useState<CLTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  async function reload() {
    setLoading(true);
    try {
      const res = await fetch('/api/cover-letter-templates');
      const data = await res.json();
      setTemplates(Array.isArray(data.templates) ? data.templates : []);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { reload(); }, []);

  async function rename(t: CLTemplate) {
    const next = window.prompt('Rename template', t.name);
    if (!next || !next.trim() || next.trim() === t.name) return;
    setBusyId(t.id);
    try {
      await fetch('/api/cover-letter-templates', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: t.id, name: next.trim() }),
      });
      await reload();
    } finally {
      setBusyId(null);
    }
  }

  async function remove(t: CLTemplate) {
    if (!window.confirm(`Delete template "${t.name}"?`)) return;
    setBusyId(t.id);
    try {
      await fetch(`/api/cover-letter-templates?id=${encodeURIComponent(t.id)}`, {
        method: 'DELETE',
      });
      await reload();
    } finally {
      setBusyId(null);
    }
  }

  if (loading) return null;
  if (templates.length === 0) return null;

  return (
    <div className="mb-4 bg-white border border-slate-100 rounded-2xl shadow-card overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 bg-slate-50/60">
        <div className="text-sm font-semibold text-slate-800">Cover-letter templates</div>
        <div className="text-xs text-slate-500">
          {templates.length} saved · loadable from any listing&apos;s cover-letter pane
        </div>
      </div>
      <ul className="divide-y divide-slate-100">
        {templates.map((t) => {
          const open = expanded === t.id;
          return (
            <li key={t.id} className="px-4 py-3">
              <div className="flex items-center gap-3">
                <FileText className="w-4 h-4 shrink-0 text-indigo-500" />
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium text-slate-800 truncate">{t.name}</div>
                  <div className="text-xs text-slate-500 truncate">
                    {t.text.length.toLocaleString()} chars · created {new Date(t.createdAt).toLocaleDateString()}
                    {t.updatedAt && ` · edited ${new Date(t.updatedAt).toLocaleDateString()}`}
                  </div>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    type="button"
                    onClick={() => setExpanded(open ? null : t.id)}
                    className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-800 transition-all"
                  >
                    {open ? 'Hide' : 'Preview'}
                  </button>
                  <button
                    type="button"
                    onClick={() => rename(t)}
                    disabled={busyId === t.id}
                    className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium text-slate-500 hover:bg-slate-100 hover:text-slate-700 transition-all disabled:opacity-50"
                  >
                    Rename
                  </button>
                  <button
                    type="button"
                    onClick={() => remove(t)}
                    disabled={busyId === t.id}
                    className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium text-rose-600 hover:bg-rose-50 hover:text-rose-700 transition-all disabled:opacity-50"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              </div>
              {open && (
                <pre className="mt-2 p-3 bg-slate-50 border border-slate-100 rounded-lg text-[11px] text-slate-600 whitespace-pre-wrap font-mono leading-relaxed max-h-72 overflow-y-auto">
                  {t.text}
                </pre>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
