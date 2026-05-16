'use client';

import { useState, useEffect, use } from 'react';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft,
  MapPin,
  Calendar,
  ExternalLink,
  Trash2,
  Save,
  Loader2,
} from 'lucide-react';
import Link from 'next/link';
import { PORTALS, JOB_STATUSES, type Job, type JobStatus } from '@/lib/types';
import { Button } from '@/components/ui/button';

export default function JobDetailPage({ params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = use(params);
  const router = useRouter();
  const [job, setJob] = useState<Job | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [notes, setNotes] = useState('');
  const [status, setStatus] = useState<JobStatus>('new');
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    fetch(`/api/jobs/${jobId}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.job) {
          setJob(data.job);
          setNotes(data.job.notes);
          setStatus(data.job.status);
        }
        setLoading(false);
      });
  }, [jobId]);

  const saveChanges = async () => {
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/jobs/${jobId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notes, status }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setJob(data.job);
      setMessage({ type: 'success', text: 'Changes saved!' });
      setTimeout(() => setMessage(null), 2000);
    } catch (err) {
      setMessage({ type: 'error', text: err instanceof Error ? err.message : 'Save failed' });
    } finally {
      setSaving(false);
    }
  };

  const deleteJobAction = async () => {
    if (!confirm('Are you sure you want to delete this job?')) return;
    setDeleting(true);
    try {
      await fetch(`/api/jobs/${jobId}`, { method: 'DELETE' });
      router.push('/listings');
    } catch {
      setDeleting(false);
    }
  };

  if (loading) {
    return (
      <div className="p-8">
        <div className="animate-pulse space-y-4">
          <div className="h-6 w-32 bg-slate-200 rounded" />
          <div className="h-8 w-64 bg-slate-200 rounded" />
          <div className="h-96 bg-slate-200 rounded-xl" />
        </div>
      </div>
    );
  }

  if (!job) {
    return (
      <div className="p-8 text-center">
        <h2 className="text-lg font-semibold text-slate-800 mb-2">Job not found</h2>
        <Link href="/listings" className="text-indigo-600 hover:underline text-sm">
          Back to Job Listings
        </Link>
      </div>
    );
  }

  const portal = PORTALS.find((p) => p.key === job.portal);

  return (
    <div className="p-8 max-w-5xl mx-auto">
      {/* Header */}
      <div className="mb-6">
        <Link
          href="/listings"
          className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700 mb-4"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Job Listings
        </Link>

        {message && (
          <div
            className={`mb-4 p-3 rounded-lg text-sm font-medium ${
              message.type === 'success'
                ? 'bg-green-50 text-green-700 border border-green-200'
                : 'bg-red-50 text-red-700 border border-red-200'
            }`}
          >
            {message.text}
          </div>
        )}

        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-3 mb-1">
              <h1 className="text-2xl font-bold text-slate-800">{job.jobTitle}</h1>
              {portal && (
                <span
                  className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium text-white"
                  style={{ backgroundColor: portal.color }}
                >
                  {portal.label}
                </span>
              )}
            </div>
            <p className="text-lg text-slate-600 font-medium">{job.companyName}</p>
            <div className="flex items-center gap-4 mt-2 text-sm text-slate-400">
              {job.location && (
                <span className="flex items-center gap-1">
                  <MapPin className="w-4 h-4" />
                  {job.location}
                </span>
              )}
              <span className="flex items-center gap-1">
                <Calendar className="w-4 h-4" />
                Added {new Date(job.dateAdded).toLocaleDateString()}
              </span>
              {job.jobUrl && (
                <a
                  href={job.jobUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1 text-indigo-500 hover:text-indigo-600"
                >
                  <ExternalLink className="w-4 h-4" />
                  View Original
                </a>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              onClick={saveChanges}
              isLoading={saving}
              leftIcon={<Save className="w-4 h-4" />}
            >
              Save
            </Button>
            <button
              onClick={deleteJobAction}
              disabled={deleting}
              className="flex items-center gap-2 px-4 py-2 bg-red-50 text-red-600 text-sm font-medium rounded-lg hover:bg-red-100 disabled:opacity-50 transition-colors"
            >
              <Trash2 className="w-4 h-4" />
              Delete
            </button>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-6">
        {/* Left: Job Description */}
        <div className="col-span-2 bg-white rounded-xl border border-slate-200 p-6">
          <h2 className="text-lg font-semibold text-slate-800 mb-4">Job Description</h2>
          <div className="prose prose-sm max-w-none text-slate-600">
            <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed">
              {job.description}
            </pre>
          </div>
        </div>

        {/* Right: Status and Notes */}
        <div className="space-y-6">
          {/* Status */}
          <div className="bg-white rounded-xl border border-slate-200 p-6">
            <h2 className="text-sm font-semibold text-slate-800 mb-3">Status</h2>
            <div className="space-y-2">
              {JOB_STATUSES.map((s) => (
                <button
                  key={s.key}
                  onClick={() => setStatus(s.key)}
                  className={`w-full text-left px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                    status === s.key
                      ? 'text-white'
                      : 'text-slate-600 hover:bg-slate-50'
                  }`}
                  style={status === s.key ? { backgroundColor: s.color } : undefined}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>

          {/* Notes */}
          <div className="bg-white rounded-xl border border-slate-200 p-6">
            <h2 className="text-sm font-semibold text-slate-800 mb-3">Notes</h2>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Add your notes about this role..."
              rows={6}
              className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-indigo-200 focus:border-indigo-300 outline-none resize-y"
            />
          </div>
        </div>
      </div>
    </div>
  );
}
