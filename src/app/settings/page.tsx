'use client';

import { useState, useEffect, useCallback } from 'react';
import { Upload, FileText, Check, User, Briefcase, MapPin, DollarSign, X } from 'lucide-react';
import type { WorkMode } from '@/lib/types';

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
  const [preferredLocations, setPreferredLocations] = useState<string[]>([]);
  const [customLocation, setCustomLocation] = useState('');
  const [workMode, setWorkMode] = useState<WorkMode[]>([]);
  const [salaryMin, setSalaryMin] = useState('');
  const [salaryMax, setSalaryMax] = useState('');

  useEffect(() => {
    fetch('/api/settings')
      .then((r) => r.json())
      .then((data) => {
        const s = data.settings;
        setUserName(s.userName || '');
        setPreferredRoles(s.preferredRoles || []);
        setPreferredLocations(s.preferredLocations || []);
        setWorkMode(s.workMode || []);
        setSalaryMin(s.salaryMin ? String(s.salaryMin) : '');
        setSalaryMax(s.salaryMax ? String(s.salaryMax) : '');
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
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setResumeFileName(data.fileName);
      setResumeText(data.text);
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

  function addLocation() {
    const trimmed = customLocation.trim();
    if (trimmed && !preferredLocations.includes(trimmed)) {
      setPreferredLocations((prev) => [...prev, trimmed]);
      setCustomLocation('');
    }
  }

  function removeLocation(loc: string) {
    setPreferredLocations((prev) => prev.filter((l) => l !== loc));
  }

  function toggleWorkMode(mode: WorkMode) {
    setWorkMode((prev) =>
      prev.includes(mode) ? prev.filter((m) => m !== mode) : [...prev, mode]
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
          preferredLocations,
          workMode,
          salaryMin: salaryMin ? Number(salaryMin) : null,
          salaryMax: salaryMax ? Number(salaryMax) : null,
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
        <h1 className="text-2xl font-bold text-gray-900">Settings</h1>
        <button
          onClick={saveAll}
          disabled={saving}
          className="px-5 py-2.5 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
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
      <section className="mb-6 bg-white rounded-xl border border-gray-200 p-6">
        <div className="flex items-center gap-3 mb-4">
          <User className="w-5 h-5 text-gray-500" />
          <h2 className="text-lg font-semibold text-gray-900">Your Name</h2>
        </div>
        <input
          type="text"
          value={userName}
          onChange={(e) => setUserName(e.target.value)}
          placeholder="Enter your name"
          className="w-full px-4 py-2.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
        />
      </section>

      {/* Preferred Roles */}
      <section className="mb-6 bg-white rounded-xl border border-gray-200 p-6">
        <div className="flex items-center gap-3 mb-4">
          <Briefcase className="w-5 h-5 text-gray-500" />
          <h2 className="text-lg font-semibold text-gray-900">Preferred Roles</h2>
        </div>
        <p className="text-xs text-gray-500 mb-3">
          Job listings will be filtered to match these role titles.
        </p>
        <div className="flex flex-wrap gap-2 mb-3">
          {preferredRoles.map((r) => (
            <span key={r} className="inline-flex items-center gap-1 px-3 py-1.5 bg-blue-100 text-blue-700 rounded-lg text-sm font-medium">
              {r}
              <button type="button" onClick={() => removeRole(r)} className="hover:text-blue-900">
                <X className="w-3 h-3" />
              </button>
            </span>
          ))}
          {preferredRoles.length === 0 && (
            <span className="text-xs text-gray-400">
              No roles set — all Engineering Manager roles will be shown by default.
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
            className="flex-1 px-4 py-2.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
          />
          <button type="button" onClick={addRole} disabled={!customRole.trim()}
            className="px-4 py-2.5 bg-gray-100 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-200 disabled:opacity-40">
            Add
          </button>
        </div>
      </section>

      {/* Preferred Locations + Work Mode */}
      <section className="mb-6 bg-white rounded-xl border border-gray-200 p-6">
        <div className="flex items-center gap-3 mb-4">
          <MapPin className="w-5 h-5 text-gray-500" />
          <h2 className="text-lg font-semibold text-gray-900">Location &amp; Work Mode</h2>
        </div>

        {/* Work mode */}
        <div className="mb-4">
          <label className="block text-xs font-medium text-gray-500 mb-2">Work Arrangement</label>
          <div className="flex gap-2">
            {WORK_MODES.map((m) => {
              const on = workMode.includes(m.key);
              return (
                <button key={m.key} type="button" onClick={() => toggleWorkMode(m.key)}
                  className={`px-4 py-2 rounded-lg text-sm font-medium border transition-colors ${
                    on ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-600 border-gray-200 hover:border-blue-300'
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
            <span key={loc} className="inline-flex items-center gap-1 px-3 py-1.5 bg-blue-100 text-blue-700 rounded-lg text-sm font-medium">
              {loc}
              <button type="button" onClick={() => removeLocation(loc)} className="hover:text-blue-900">
                <X className="w-3 h-3" />
              </button>
            </span>
          ))}
        </div>
        <div className="flex gap-2">
          <input type="text" value={customLocation} onChange={(e) => setCustomLocation(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && addLocation()}
            placeholder="Add a location (e.g., Seattle, WA)..."
            className="flex-1 px-4 py-2.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
          <button type="button" onClick={addLocation} disabled={!customLocation.trim()}
            className="px-4 py-2.5 bg-gray-100 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-200 disabled:opacity-40">
            Add
          </button>
        </div>
      </section>

      {/* Salary Range */}
      <section className="mb-6 bg-white rounded-xl border border-gray-200 p-6">
        <div className="flex items-center gap-3 mb-4">
          <DollarSign className="w-5 h-5 text-gray-500" />
          <h2 className="text-lg font-semibold text-gray-900">Salary Range</h2>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1.5">Minimum (annual)</label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">$</span>
              <input type="number" value={salaryMin} onChange={(e) => setSalaryMin(e.target.value)}
                placeholder="200000"
                className="w-full pl-7 pr-4 py-2.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1.5">Maximum (annual)</label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">$</span>
              <input type="number" value={salaryMax} onChange={(e) => setSalaryMax(e.target.value)}
                placeholder="350000"
                className="w-full pl-7 pr-4 py-2.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
            </div>
          </div>
        </div>
      </section>

      {/* Resume Upload */}
      <section className="bg-white rounded-xl border border-gray-200 p-6">
        <div className="flex items-center gap-3 mb-4">
          <FileText className="w-5 h-5 text-gray-500" />
          <h2 className="text-lg font-semibold text-gray-900">Resume</h2>
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
            dragOver ? 'border-blue-500 bg-blue-50' : 'border-gray-300 hover:border-gray-400'
          }`}
        >
          <Upload className="w-10 h-10 text-gray-400 mx-auto mb-3" />
          <p className="text-sm text-gray-600 mb-2">
            {uploading ? 'Uploading...' : 'Drag and drop your resume here, or'}
          </p>
          <label className="inline-block px-5 py-2.5 bg-gray-100 text-gray-700 text-sm font-medium rounded-lg cursor-pointer hover:bg-gray-200 transition-colors">
            Browse Files
            <input type="file" accept=".docx,.pdf" onChange={handleFileInput} className="hidden" />
          </label>
          <p className="text-xs text-gray-400 mt-2">Supports .docx and .pdf</p>
        </div>

        {resumeText && (
          <div className="mt-6">
            <h3 className="text-sm font-semibold text-gray-700 mb-2">Parsed Resume Preview</h3>
            <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 max-h-80 overflow-y-auto">
              <pre className="text-xs text-gray-600 whitespace-pre-wrap font-mono leading-relaxed">
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
