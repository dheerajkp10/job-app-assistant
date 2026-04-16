'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Link2, FileText, Loader2 } from 'lucide-react';
import { PORTALS, type JobPortal } from '@/lib/types';

type Tab = 'url' | 'manual';

export default function AddJobPage() {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>('url');
  const [url, setUrl] = useState('');
  const [extracting, setExtracting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Form fields
  const [portal, setPortal] = useState<JobPortal>('company');
  const [companyName, setCompanyName] = useState('');
  const [jobTitle, setJobTitle] = useState('');
  const [location, setLocation] = useState('');
  const [description, setDescription] = useState('');
  const [notes, setNotes] = useState('');

  const extractFromUrl = async () => {
    if (!url.trim()) return;
    setExtracting(true);
    setError(null);
    try {
      const res = await fetch('/api/extract-job', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: url.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setPortal(data.portal);
      setCompanyName(data.companyName || '');
      setJobTitle(data.jobTitle || '');
      setDescription(data.description || '');
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Failed to extract. Try pasting the description manually.'
      );
    } finally {
      setExtracting(false);
    }
  };

  const saveJob = async () => {
    if (!companyName.trim() || !jobTitle.trim() || !description.trim()) {
      setError('Company name, job title, and description are required.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch('/api/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          portal,
          companyName: companyName.trim(),
          jobTitle: jobTitle.trim(),
          location: location.trim(),
          jobUrl: url.trim() || null,
          description: description.trim(),
          notes: notes.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      router.push(`/jobs/${data.job.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save job');
      setSaving(false);
    }
  };

  return (
    <div className="p-8 max-w-3xl mx-auto">
      <h1 className="text-2xl font-bold text-gray-900 mb-8">Add Job</h1>

      {error && (
        <div className="mb-6 p-4 bg-red-50 text-red-700 border border-red-200 rounded-lg text-sm">
          {error}
        </div>
      )}

      {/* Tab Switcher */}
      <div className="flex gap-1 mb-6 bg-gray-100 rounded-lg p-1 w-fit">
        <button
          onClick={() => setTab('url')}
          className={`flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-md transition-colors ${
            tab === 'url'
              ? 'bg-white text-gray-900 shadow-sm'
              : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          <Link2 className="w-4 h-4" />
          Paste URL
        </button>
        <button
          onClick={() => setTab('manual')}
          className={`flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-md transition-colors ${
            tab === 'manual'
              ? 'bg-white text-gray-900 shadow-sm'
              : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          <FileText className="w-4 h-4" />
          Paste Description
        </button>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-5">
        {/* URL extraction */}
        {tab === 'url' && (
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              Job URL
            </label>
            <div className="flex gap-3">
              <input
                type="url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://www.linkedin.com/jobs/view/..."
                className="flex-1 px-4 py-2.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
              />
              <button
                onClick={extractFromUrl}
                disabled={extracting || !url.trim()}
                className="px-5 py-2.5 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors flex items-center gap-2"
              >
                {extracting && <Loader2 className="w-4 h-4 animate-spin" />}
                {extracting ? 'Extracting...' : 'Extract'}
              </button>
            </div>
            <p className="text-xs text-gray-400 mt-1.5">
              Works best with Indeed and company sites. LinkedIn/Glassdoor may need manual paste.
            </p>
          </div>
        )}

        {/* Portal */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">
            Portal
          </label>
          <div className="flex gap-2">
            {PORTALS.map((p) => (
              <button
                key={p.key}
                onClick={() => setPortal(p.key)}
                className={`px-4 py-2 text-sm font-medium rounded-lg border transition-colors ${
                  portal === p.key
                    ? 'text-white border-transparent'
                    : 'text-gray-600 border-gray-300 hover:border-gray-400'
                }`}
                style={portal === p.key ? { backgroundColor: p.color } : undefined}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>

        {/* Company and Title */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              Company Name *
            </label>
            <input
              type="text"
              value={companyName}
              onChange={(e) => setCompanyName(e.target.value)}
              placeholder="e.g. Google"
              className="w-full px-4 py-2.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              Job Title *
            </label>
            <input
              type="text"
              value={jobTitle}
              onChange={(e) => setJobTitle(e.target.value)}
              placeholder="e.g. Senior Engineering Manager"
              className="w-full px-4 py-2.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
            />
          </div>
        </div>

        {/* Location */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">
            Location
          </label>
          <input
            type="text"
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            placeholder="e.g. San Francisco, CA (Remote)"
            className="w-full px-4 py-2.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
          />
        </div>

        {/* Description */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">
            Job Description *
          </label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Paste the full job description here..."
            rows={12}
            className="w-full px-4 py-2.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none resize-y"
          />
        </div>

        {/* Notes */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">
            Notes (optional)
          </label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Any personal notes about this role..."
            rows={3}
            className="w-full px-4 py-2.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none resize-y"
          />
        </div>

        {/* Submit */}
        <div className="pt-2">
          <button
            onClick={saveJob}
            disabled={saving}
            className="w-full px-6 py-3 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors flex items-center justify-center gap-2"
          >
            {saving && <Loader2 className="w-4 h-4 animate-spin" />}
            {saving ? 'Saving...' : 'Save Job'}
          </button>
        </div>
      </div>
    </div>
  );
}
