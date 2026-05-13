'use client';

import { useState, useEffect, useCallback } from 'react';
import { Upload, FileText, Check, User, Briefcase, MapPin, DollarSign, X, RefreshCw } from 'lucide-react';
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
  const [dragOver, setDragOver] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Preferences
  const [preferredRoles, setPreferredRoles] = useState<string[]>([]);
  const [customRole, setCustomRole] = useState('');
  const [preferredLevels, setPreferredLevels] = useState<string[]>([]);
  const [preferredLocations, setPreferredLocations] = useState<string[]>([]);
  const [workMode, setWorkMode] = useState<WorkMode[]>([]);
  const [workAuthCountries, setWorkAuthCountries] = useState<string[]>(['US']);
  // Auto-refresh — when enabled, the listings page kicks off a
  // streaming refresh on mount whenever the cache is older than
  // `autoRefreshHours`. Default disabled so first-time users never
  // get surprised by network activity.
  const [autoRefreshEnabled, setAutoRefreshEnabled] = useState(false);
  const [autoRefreshHours, setAutoRefreshHours] = useState(24);
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
    fetch('/api/settings')
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
        setAutoRefreshEnabled(!!s.autoRefreshEnabled);
        setAutoRefreshHours(s.autoRefreshHours && s.autoRefreshHours > 0 ? s.autoRefreshHours : 24);
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
    fetch('/api/resume')
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
      setResumeFileName(data.fileName || null);
      setResumeText(data.text || '');
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
          autoRefreshEnabled,
          autoRefreshHours,
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
    <div className="p-8 max-w-3xl mx-auto">
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

      <CustomSourcesPanel />

      <NetworkImportPanel />

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
            <div className="grid grid-cols-2 gap-4">
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
  );
}
