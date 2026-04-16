'use client';

import { useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import {
  Briefcase, MapPin, DollarSign, FileText, Upload, Check,
  ChevronRight, ChevronLeft, Loader2, X,
} from 'lucide-react';
import type { WorkMode } from '@/lib/types';

const STEPS = ['Role', 'Location', 'Salary', 'Resume'] as const;

const SUGGESTED_ROLES = [
  'Engineering Manager',
  'Software Development Manager',
  'Software Engineering Manager',
  'Director of Engineering',
  'Head of Engineering',
  'Technical Program Manager',
  'Staff Engineer',
  'Principal Engineer',
  'VP of Engineering',
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

export default function OnboardingWizard() {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [saving, setSaving] = useState(false);

  // Form state
  const [userName, setUserName] = useState('');
  const [roles, setRoles] = useState<string[]>([]);
  const [customRole, setCustomRole] = useState('');
  const [locations, setLocations] = useState<string[]>([]);
  const [customLocation, setCustomLocation] = useState('');
  const [workMode, setWorkMode] = useState<WorkMode[]>([]);
  const [salaryMin, setSalaryMin] = useState('');
  const [salaryMax, setSalaryMax] = useState('');

  // Resume
  const [resumeFile, setResumeFile] = useState<string | null>(null);
  const [resumeText, setResumeText] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

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

  function addCustomLocation() {
    const trimmed = customLocation.trim();
    if (trimmed && !locations.includes(trimmed)) {
      setLocations((prev) => [...prev, trimmed]);
      setCustomLocation('');
    }
  }

  function toggleWorkMode(mode: WorkMode) {
    setWorkMode((prev) =>
      prev.includes(mode) ? prev.filter((m) => m !== mode) : [...prev, mode]
    );
  }

  const uploadFile = useCallback(async (file: File) => {
    setUploading(true);
    setUploadError(null);
    const formData = new FormData();
    formData.append('file', file);
    try {
      const res = await fetch('/api/resume', { method: 'POST', body: formData });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setResumeFile(data.fileName);
      setResumeText(data.text);
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

  async function handleFinish() {
    setSaving(true);
    try {
      await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userName,
          preferredRoles: roles,
          preferredLocations: locations,
          workMode,
          salaryMin: salaryMin ? Number(salaryMin) : null,
          salaryMax: salaryMax ? Number(salaryMax) : null,
          onboardingComplete: true,
        }),
      });
      router.push('/listings');
    } catch {
      setSaving(false);
    }
  }

  const canProceed = () => {
    if (step === 0) return roles.length > 0;
    if (step === 1) return locations.length > 0 || workMode.length > 0;
    return true; // salary & resume are optional
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50 flex items-center justify-center p-4">
      <div className="w-full max-w-2xl">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-3 mb-4">
            <Briefcase className="w-8 h-8 text-blue-600" />
            <h1 className="text-3xl font-bold text-gray-900">Job App Assistant</h1>
          </div>
          <p className="text-gray-500">
            Let&apos;s set up your preferences to find the best jobs for you.
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
        <div className="flex items-center gap-2 mb-6">
          <span className="text-xs font-medium text-blue-600 bg-blue-50 px-2 py-1 rounded-full">
            Step {step + 1} of {STEPS.length}
          </span>
          <span className="text-sm text-gray-500">{STEPS[step]}</span>
        </div>

        {/* Card */}
        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-8">
          {/* ─── Step 0: Role preferences ─── */}
          {step === 0 && (
            <div>
              <div className="flex items-center gap-3 mb-2">
                <Briefcase className="w-5 h-5 text-blue-500" />
                <h2 className="text-xl font-semibold text-gray-900">What roles are you looking for?</h2>
              </div>
              <p className="text-sm text-gray-500 mb-6">
                Select or type the job titles you&apos;re targeting. We&apos;ll use these to find matching listings.
              </p>

              {/* Name field */}
              <div className="mb-6">
                <label className="block text-xs font-medium text-gray-500 mb-1.5">Your Name</label>
                <input
                  type="text"
                  value={userName}
                  onChange={(e) => setUserName(e.target.value)}
                  placeholder="e.g., John Doe"
                  className="w-full px-4 py-2.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                />
              </div>

              {/* Role chips */}
              <div className="mb-4">
                <label className="block text-xs font-medium text-gray-500 mb-2">
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
                            : 'bg-white text-gray-700 border-gray-200 hover:border-blue-300 hover:bg-blue-50'
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
                  className="flex-1 px-4 py-2.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                />
                <button
                  type="button"
                  onClick={addCustomRole}
                  disabled={!customRole.trim()}
                  className="px-4 py-2.5 bg-gray-100 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-200 disabled:opacity-40"
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
                        className="inline-flex items-center gap-1 px-3 py-1.5 bg-blue-100 text-blue-700 rounded-lg text-sm font-medium"
                      >
                        {r}
                        <button type="button" onClick={() => toggleRole(r)} className="hover:text-blue-900">
                          <X className="w-3 h-3" />
                        </button>
                      </span>
                    ))}
                </div>
              )}
            </div>
          )}

          {/* ─── Step 1: Location & work mode ─── */}
          {step === 1 && (
            <div>
              <div className="flex items-center gap-3 mb-2">
                <MapPin className="w-5 h-5 text-blue-500" />
                <h2 className="text-xl font-semibold text-gray-900">Where do you want to work?</h2>
              </div>
              <p className="text-sm text-gray-500 mb-6">
                Select your preferred locations and work arrangement.
              </p>

              {/* Work mode */}
              <div className="mb-6">
                <label className="block text-xs font-medium text-gray-500 mb-2">Work Arrangement</label>
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
                            ? 'border-blue-600 bg-blue-50'
                            : 'border-gray-200 hover:border-gray-300'
                        }`}
                      >
                        <span className={`block text-sm font-semibold ${on ? 'text-blue-700' : 'text-gray-900'}`}>
                          {m.label}
                        </span>
                        <span className="block text-xs text-gray-500 mt-0.5">{m.desc}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Location chips */}
              <div className="mb-4">
                <label className="block text-xs font-medium text-gray-500 mb-2">
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
                            : 'bg-white text-gray-700 border-gray-200 hover:border-blue-300 hover:bg-blue-50'
                        }`}
                      >
                        {loc}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Custom location */}
              <div className="flex gap-2">
                <input
                  type="text"
                  value={customLocation}
                  onChange={(e) => setCustomLocation(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && addCustomLocation()}
                  placeholder="Add a custom location..."
                  className="flex-1 px-4 py-2.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                />
                <button
                  type="button"
                  onClick={addCustomLocation}
                  disabled={!customLocation.trim()}
                  className="px-4 py-2.5 bg-gray-100 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-200 disabled:opacity-40"
                >
                  Add
                </button>
              </div>
            </div>
          )}

          {/* ─── Step 2: Salary ─── */}
          {step === 2 && (
            <div>
              <div className="flex items-center gap-3 mb-2">
                <DollarSign className="w-5 h-5 text-blue-500" />
                <h2 className="text-xl font-semibold text-gray-900">Salary Expectations</h2>
              </div>
              <p className="text-sm text-gray-500 mb-6">
                Optional. Set your target annual salary range. We&apos;ll highlight jobs that match.
              </p>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1.5">Minimum (annual)</label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">$</span>
                    <input
                      type="number"
                      value={salaryMin}
                      onChange={(e) => setSalaryMin(e.target.value)}
                      placeholder="e.g., 200000"
                      className="w-full pl-7 pr-4 py-2.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1.5">Maximum (annual)</label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">$</span>
                    <input
                      type="number"
                      value={salaryMax}
                      onChange={(e) => setSalaryMax(e.target.value)}
                      placeholder="e.g., 350000"
                      className="w-full pl-7 pr-4 py-2.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                    />
                  </div>
                </div>
              </div>

              <p className="text-xs text-gray-400 mt-3">
                You can skip this step if you prefer not to set a salary range.
              </p>
            </div>
          )}

          {/* ─── Step 3: Resume upload ─── */}
          {step === 3 && (
            <div>
              <div className="flex items-center gap-3 mb-2">
                <FileText className="w-5 h-5 text-blue-500" />
                <h2 className="text-xl font-semibold text-gray-900">Upload Your Resume</h2>
              </div>
              <p className="text-sm text-gray-500 mb-6">
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
                    ? 'border-blue-500 bg-blue-50'
                    : 'border-gray-300 hover:border-gray-400'
                }`}
              >
                <Upload className="w-10 h-10 text-gray-400 mx-auto mb-3" />
                <p className="text-sm text-gray-600 mb-2">
                  {uploading ? 'Uploading...' : 'Drag and drop your resume here, or'}
                </p>
                <label className="inline-block px-5 py-2.5 bg-gray-100 text-gray-700 text-sm font-medium rounded-lg cursor-pointer hover:bg-gray-200 transition-colors">
                  Browse Files
                  <input
                    type="file"
                    accept=".docx,.pdf"
                    onChange={handleFileInput}
                    className="hidden"
                  />
                </label>
                <p className="text-xs text-gray-400 mt-2">Supports .docx and .pdf</p>
              </div>

              {uploadError && (
                <p className="text-sm text-red-600 mt-3">{uploadError}</p>
              )}

              {resumeText && (
                <div className="mt-4">
                  <h3 className="text-sm font-semibold text-gray-700 mb-2">Parsed Preview</h3>
                  <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 max-h-48 overflow-y-auto">
                    <pre className="text-xs text-gray-600 whitespace-pre-wrap font-mono leading-relaxed">
                      {resumeText.slice(0, 1500)}
                      {resumeText.length > 1500 && '\n\n... (truncated)'}
                    </pre>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Navigation buttons */}
        <div className="flex items-center justify-between mt-6">
          <button
            type="button"
            onClick={() => setStep((s) => s - 1)}
            disabled={step === 0}
            className="flex items-center gap-2 px-5 py-2.5 text-sm font-medium text-gray-600 hover:text-gray-900 disabled:opacity-0"
          >
            <ChevronLeft className="w-4 h-4" />
            Back
          </button>

          {step < STEPS.length - 1 ? (
            <button
              type="button"
              onClick={() => setStep((s) => s + 1)}
              disabled={!canProceed()}
              className="flex items-center gap-2 px-6 py-2.5 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
            >
              Continue
              <ChevronRight className="w-4 h-4" />
            </button>
          ) : (
            <button
              type="button"
              onClick={handleFinish}
              disabled={saving}
              className="flex items-center gap-2 px-6 py-2.5 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700 disabled:opacity-50 transition-colors"
            >
              {saving ? (
                <><Loader2 className="w-4 h-4 animate-spin" /> Setting up...</>
              ) : (
                <><Check className="w-4 h-4" /> Get Started</>
              )}
            </button>
          )}
        </div>

        <p className="text-center text-xs text-gray-400 mt-4">
          You can change all preferences later in Settings.
        </p>
      </div>
    </div>
  );
}
