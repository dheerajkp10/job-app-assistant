'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import {
  Link2, FileText, Loader2, Target, CheckCircle2, XCircle,
  Download, AlertTriangle, ArrowUpRight,
} from 'lucide-react';
import { PORTALS, type JobPortal } from '@/lib/types';

type Tab = 'url' | 'manual';

// ─── Score display helpers ────────────────────────────────────────

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
          <circle cx={size / 2} cy={size / 2} r={radius} stroke={color} strokeWidth="6" fill="none"
            strokeDasharray={circumference} strokeDashoffset={offset} strokeLinecap="round" className="transition-all duration-700" />
        </svg>
        <span className="absolute inset-0 flex items-center justify-center text-lg font-bold" style={{ color }}>
          {score}%
        </span>
      </div>
      {label && <span className="text-xs text-slate-500 mt-1">{label}</span>}
    </div>
  );
}

function CategoryBar({ label, score }: { label: string; score: number }) {
  const color = score >= 75 ? 'bg-green-500' : score >= 50 ? 'bg-yellow-500' : 'bg-red-400';
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

// ─── Main page ──────────────────────────────────────────────────

export default function AddJobPage() {
  useEffect(() => {
    fetch('/api/settings')
      .then((r) => r.json())
      .then((d) => {
        if (!d.settings?.onboardingComplete) {
          window.location.href = '/';
        }
      })
      .catch(() => {});
  }, []);

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

  // Post-save state
  const [savedJobId, setSavedJobId] = useState<string | null>(null);
  const [savedListingId, setSavedListingId] = useState<string | null>(null);

  // ATS Score
  const [score, setScore] = useState<ATSScore | null>(null);
  const [scoring, setScoring] = useState(false);
  const [scoreError, setScoreError] = useState<string | null>(null);

  // Tailor
  const [tailorResult, setTailorResult] = useState<TailorResult | null>(null);
  const [tailoring, setTailoring] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [tailorError, setTailorError] = useState<string | null>(null);

  // Selected keywords
  const [selectedKeywords, setSelectedKeywords] = useState<Set<string>>(new Set());

  function toggleKeyword(k: string) {
    setSelectedKeywords((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k); else next.add(k);
      return next;
    });
  }

  // When extract-job detects the URL is already in our listings cache
  // it returns `{ match: { listingId, company, title, ... } }` instead
  // of `{ portal, companyName, ... }`. We surface a friendly "this job
  // is already on your Listings page" notice with a link so the user
  // can jump straight to it instead of creating a duplicate.
  const [duplicateMatch, setDuplicateMatch] = useState<{
    listingId: string;
    company: string;
    title: string;
    location: string;
  } | null>(null);

  const extractFromUrl = async () => {
    if (!url.trim()) return;
    setExtracting(true);
    setError(null);
    setDuplicateMatch(null);
    try {
      const res = await fetch('/api/extract-job', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: url.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      // Dedup branch: server found this URL already in the listings
      // cache. Surface a notice + link rather than overwriting the
      // form fields with extracted data.
      if (data.match) {
        setDuplicateMatch(data.match);
        return;
      }
      setPortal(data.portal);
      setCompanyName(data.companyName || '');
      setJobTitle(data.jobTitle || '');
      setLocation(data.location || '');
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
      // 1. Save as a Job (manual tracker entry)
      const jobRes = await fetch('/api/jobs', {
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
      const jobData = await jobRes.json();
      if (!jobRes.ok) throw new Error(jobData.error);
      setSavedJobId(jobData.job.id);

      // 2. Also create a JobListing so it shows on the listings page + enables ATS scoring
      const listingRes = await fetch('/api/listings/add', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          company: companyName.trim(),
          title: jobTitle.trim(),
          location: location.trim(),
          url: url.trim() || null,
          description: description.trim(),
          portal,
        }),
      });
      const listingData = await listingRes.json();
      if (listingRes.ok && listingData.listingId) {
        setSavedListingId(listingData.listingId);
        // 3. Auto-score immediately
        scoreJob(listingData.listingId);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save job');
    } finally {
      setSaving(false);
    }
  };

  async function scoreJob(listingId: string) {
    setScoring(true);
    setScoreError(null);
    try {
      const res = await fetch('/api/ats-score', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ listingId }),
      });
      const data = await res.json();
      if (data.error) {
        setScoreError(data.error);
      } else {
        setScore(data);
        setSelectedKeywords(new Set(data.missingKeywords || []));
      }
    } catch {
      setScoreError('Failed to calculate score');
    } finally {
      setScoring(false);
    }
  }

  async function handleTailor() {
    if (!savedListingId) return;
    setTailoring(true);
    setTailorError(null);
    try {
      const res = await fetch('/api/tailor-resume', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          listingId: savedListingId,
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
    if (!savedListingId) return;
    setDownloading(true);
    try {
      const res = await fetch('/api/tailor-resume', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          listingId: savedListingId,
          format: 'pdf',
          selectedKeywords: Array.from(selectedKeywords),
        }),
      });
      const blob = await res.blob();
      const disposition = res.headers.get('Content-Disposition') || '';
      const match = disposition.match(/filename="(.+?)"/);
      const filename = match?.[1] || 'tailored_resume.pdf';
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(blobUrl);
    } catch {
      setTailorError('Failed to download resume');
    } finally {
      setDownloading(false);
    }
  }

  // ─── After save: show ATS score + tailor panel ──────────────────

  if (savedJobId) {
    return (
      <div className="p-8 max-w-4xl mx-auto">
        {/* Success banner */}
        <div className="mb-6 p-4 bg-green-50 text-green-700 border border-green-200 rounded-lg text-sm flex items-center gap-3">
          <CheckCircle2 className="w-5 h-5 text-green-500 shrink-0" />
          <div className="flex-1">
            <span className="font-semibold">{jobTitle}</span> at <span className="font-semibold">{companyName}</span> saved!
          </div>
          <Link href={`/jobs/${savedJobId}`}
            className="text-green-700 hover:text-green-800 underline text-sm font-medium">
            View Job
          </Link>
        </div>

        {/* ATS Score Panel */}
        <section className="bg-white rounded-xl border border-slate-200 p-6 mb-6">
          <div className="flex items-center gap-2 mb-4">
            <Target className="w-5 h-5 text-indigo-500" />
            <h2 className="text-lg font-semibold text-slate-800">ATS Match Score</h2>
          </div>

          {scoring && (
            <div className="flex items-center gap-3 py-8 justify-center">
              <Loader2 className="w-5 h-5 text-indigo-500 animate-spin" />
              <span className="text-sm text-slate-500">Analyzing resume against job description...</span>
            </div>
          )}

          {scoreError && (
            <div className="flex items-start gap-3 p-4 bg-amber-50 border border-amber-200 rounded-lg">
              <AlertTriangle className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
              <div>
                <p className="text-sm text-amber-800 font-medium">{scoreError}</p>
                {scoreError.includes('resume') && (
                  <Link href="/settings" className="text-sm text-indigo-600 hover:underline mt-1 inline-flex items-center gap-1">
                    Go to Settings to upload <ArrowUpRight className="w-3 h-3" />
                  </Link>
                )}
              </div>
            </div>
          )}

          {score && (
            <div>
              <div className="flex items-start gap-8 mb-6">
                <ScoreRing score={score.overall} size={100} label="Overall" />
                <div className="flex-1 space-y-2.5 pt-2">
                  <CategoryBar label="Technical" score={score.technical} />
                  <CategoryBar label="Management" score={score.management} />
                  <CategoryBar label="Domain" score={score.domain} />
                  <CategoryBar label="Soft Skills" score={score.soft} />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4 text-sm">
                <div className="p-3 bg-green-50 rounded-lg border border-green-100">
                  <div className="flex items-center gap-1.5 mb-2">
                    <CheckCircle2 className="w-4 h-4 text-green-500" />
                    <span className="font-medium text-green-800">Matched ({score.totalMatched})</span>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {score.matchedKeywords.slice(0, 20).map((k) => (
                      <span key={k} className="px-2 py-0.5 bg-green-100 text-green-700 rounded text-xs">{k}</span>
                    ))}
                    {score.matchedKeywords.length > 20 && (
                      <span className="text-xs text-green-600">+{score.matchedKeywords.length - 20} more</span>
                    )}
                  </div>
                </div>

                <div className="p-3 bg-red-50 rounded-lg border border-red-100">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-1.5">
                      <XCircle className="w-4 h-4 text-red-400" />
                      <span className="font-medium text-red-800">
                        Missing ({selectedKeywords.size}/{score.missingKeywords.length} selected)
                      </span>
                    </div>
                    {score.missingKeywords.length > 0 && (
                      <div className="flex items-center gap-1 text-[10px]">
                        <button type="button" onClick={() => setSelectedKeywords(new Set(score.missingKeywords))}
                          className="px-1.5 py-0.5 text-red-700 hover:bg-red-100 rounded">All</button>
                        <button type="button" onClick={() => setSelectedKeywords(new Set())}
                          className="px-1.5 py-0.5 text-red-700 hover:bg-red-100 rounded">None</button>
                      </div>
                    )}
                  </div>
                  <p className="text-[11px] text-red-600/80 mb-2">Click to include/exclude in tailoring.</p>
                  <div className="flex flex-wrap gap-1">
                    {score.missingKeywords.map((k) => {
                      const on = selectedKeywords.has(k);
                      return (
                        <button key={k} type="button" onClick={() => toggleKeyword(k)}
                          className={`px-2 py-0.5 rounded text-xs border transition-colors ${
                            on ? 'bg-red-100 text-red-700 border-red-200 hover:bg-red-200'
                              : 'bg-white text-slate-400 border-slate-200 line-through hover:bg-slate-50'
                          }`}>{k}</button>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>
          )}
        </section>

        {/* Resume Tailor Panel */}
        {score && (
          <section className="bg-white rounded-xl border border-slate-200 p-6 mb-6">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <FileText className="w-5 h-5 text-violet-500" />
                <h2 className="text-lg font-semibold text-slate-800">Resume Tailor</h2>
              </div>
              {!tailorResult && (
                <button onClick={handleTailor} disabled={tailoring}
                  className="flex items-center gap-2 px-4 py-2 bg-violet-600 text-white text-sm font-medium rounded-lg hover:bg-purple-700 disabled:opacity-50 transition-colors">
                  {tailoring ? (
                    <><Loader2 className="w-4 h-4 animate-spin" /> Tailoring...</>
                  ) : (
                    <><FileText className="w-4 h-4" /> Tailor My Resume</>
                  )}
                </button>
              )}
            </div>

            {!tailorResult && !tailoring && !tailorError && (
              <p className="text-sm text-slate-500">
                Click &ldquo;Tailor My Resume&rdquo; to optimize your resume for this role.
                <span className="block mt-1 text-xs text-slate-400">
                  Only keyword optimization — no false information will be added.
                </span>
              </p>
            )}

            {tailorError && (
              <div className="flex items-start gap-3 p-4 bg-amber-50 border border-amber-200 rounded-lg">
                <AlertTriangle className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
                <p className="text-sm text-amber-800">{tailorError}</p>
              </div>
            )}

            {tailorResult && (
              <div className="space-y-4">
                <div className="flex items-center gap-6 p-4 bg-gradient-to-r from-indigo-50 to-violet-50 rounded-lg border border-indigo-100">
                  <div className="text-center">
                    <div className="text-2xl font-bold text-slate-400">{tailorResult.originalScore.overall}%</div>
                    <div className="text-xs text-slate-400">Before</div>
                  </div>
                  <div className="text-2xl text-slate-300">&rarr;</div>
                  <div className="text-center">
                    <div className="text-2xl font-bold text-green-600">{tailorResult.tailoredScore.overall}%</div>
                    <div className="text-xs text-green-600">After</div>
                  </div>
                  <div className="text-center ml-auto">
                    <div className="text-2xl font-bold text-indigo-600">
                      +{tailorResult.tailoredScore.overall - tailorResult.originalScore.overall}%
                    </div>
                    <div className="text-xs text-indigo-600">Improvement</div>
                  </div>
                </div>

                <div>
                  <h3 className="text-sm font-medium text-slate-700 mb-2">Changes Made</h3>
                  <ul className="space-y-1">
                    {tailorResult.changesSummary.map((c, i) => (
                      <li key={i} className="text-sm text-slate-600 flex gap-2">
                        <CheckCircle2 className="w-4 h-4 text-green-500 shrink-0 mt-0.5" /> {c}
                      </li>
                    ))}
                  </ul>
                </div>

                {tailorResult.addedKeywords.length > 0 && (
                  <div>
                    <h3 className="text-sm font-medium text-slate-700 mb-2">Keywords Added</h3>
                    <div className="flex flex-wrap gap-1">
                      {tailorResult.addedKeywords.map((k) => (
                        <span key={k} className="px-2 py-0.5 bg-violet-100 text-violet-700 rounded text-xs font-medium">{k}</span>
                      ))}
                    </div>
                  </div>
                )}

                <button onClick={handleDownload} disabled={downloading}
                  className="flex items-center gap-2 px-5 py-2.5 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700 disabled:opacity-50 transition-colors w-full justify-center">
                  {downloading ? (
                    <><Loader2 className="w-4 h-4 animate-spin" /> Generating PDF...</>
                  ) : (
                    <><Download className="w-4 h-4" /> Download Tailored Resume (PDF)</>
                  )}
                </button>
              </div>
            )}
          </section>
        )}

        {/* Add another job */}
        <div className="flex gap-3">
          <button onClick={() => {
            setSavedJobId(null); setSavedListingId(null); setScore(null);
            setTailorResult(null); setUrl(''); setCompanyName(''); setJobTitle('');
            setLocation(''); setDescription(''); setNotes(''); setError(null);
          }}
            className="px-5 py-2.5 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors">
            Add Another Job
          </button>
          <Link href="/listings"
            className="inline-flex items-center px-5 py-2.5 border border-slate-200 text-slate-700 text-sm font-medium rounded-lg hover:bg-slate-50 transition-colors">
            Back to Listings
          </Link>
        </div>
      </div>
    );
  }

  // ─── Normal form view ──────────────────────────────────────────

  return (
    <div className="p-8 max-w-3xl mx-auto">
      <h1 className="text-2xl font-bold text-slate-800 mb-8">Add Job</h1>

      {error && (
        <div className="mb-6 p-4 bg-red-50 text-red-700 border border-red-200 rounded-lg text-sm">{error}</div>
      )}

      {/* Tab Switcher */}
      <div className="flex gap-1 mb-6 bg-slate-100 rounded-lg p-1 w-fit">
        <button onClick={() => setTab('url')}
          className={`flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-md transition-colors ${
            tab === 'url' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'
          }`}>
          <Link2 className="w-4 h-4" /> Paste URL
        </button>
        <button onClick={() => setTab('manual')}
          className={`flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-md transition-colors ${
            tab === 'manual' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'
          }`}>
          <FileText className="w-4 h-4" /> Paste Description
        </button>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 p-6 space-y-5">
        {/* URL extraction */}
        {tab === 'url' && (
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">Job URL</label>
            <div className="flex gap-3">
              <input type="url" value={url} onChange={(e) => setUrl(e.target.value)}
                placeholder="https://www.linkedin.com/jobs/view/..."
                className="flex-1 px-4 py-2.5 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-indigo-200 focus:border-indigo-300 outline-none" />
              <button onClick={extractFromUrl} disabled={extracting || !url.trim()}
                className="px-5 py-2.5 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors flex items-center gap-2">
                {extracting && <Loader2 className="w-4 h-4 animate-spin" />}
                {extracting ? 'Extracting...' : 'Extract'}
              </button>
            </div>
            <p className="text-xs text-slate-400 mt-1.5">
              Works best with company career sites. LinkedIn / Glassdoor may need manual paste.
            </p>

            {/* Duplicate-listing notice — when extract-job recognizes
                the URL is already in our cache, the user gets a
                friendly link to the existing listing instead of
                creating a duplicate manual-* row. */}
            {duplicateMatch && (
              <div className="mt-3 rounded-xl border border-indigo-200/70 bg-gradient-to-r from-indigo-50 to-violet-50 p-3 flex items-start gap-3">
                <CheckCircle2 className="w-5 h-5 text-indigo-600 shrink-0 mt-0.5" />
                <div className="flex-1 text-sm">
                  <p className="font-semibold text-indigo-900">
                    Already on your Job Listings page
                  </p>
                  <p className="text-indigo-800/90 text-xs mt-0.5">
                    {duplicateMatch.title} · {duplicateMatch.company}
                    {duplicateMatch.location ? ` · ${duplicateMatch.location}` : ''}
                  </p>
                  <Link
                    href={`/listings/${duplicateMatch.listingId}`}
                    className="inline-flex items-center gap-1.5 mt-1.5 text-xs font-medium text-indigo-700 hover:text-indigo-900"
                  >
                    Open existing listing <ArrowUpRight className="w-3 h-3" />
                  </Link>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Portal */}
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1.5">Portal</label>
          <div className="flex gap-2">
            {PORTALS.map((p) => (
              <button key={p.key} onClick={() => setPortal(p.key)}
                className={`px-4 py-2 text-sm font-medium rounded-lg border transition-colors ${
                  portal === p.key ? 'text-white border-transparent' : 'text-slate-600 border-slate-200 hover:border-slate-300'
                }`}
                style={portal === p.key ? { backgroundColor: p.color } : undefined}>
                {p.label}
              </button>
            ))}
          </div>
        </div>

        {/* Company and Title */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">Company Name *</label>
            <input type="text" value={companyName} onChange={(e) => setCompanyName(e.target.value)}
              placeholder="e.g. Google"
              className="w-full px-4 py-2.5 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-indigo-200 focus:border-indigo-300 outline-none" />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">Job Title *</label>
            <input type="text" value={jobTitle} onChange={(e) => setJobTitle(e.target.value)}
              placeholder="e.g. Senior Engineering Manager"
              className="w-full px-4 py-2.5 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-indigo-200 focus:border-indigo-300 outline-none" />
          </div>
        </div>

        {/* Location */}
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1.5">Location</label>
          <input type="text" value={location} onChange={(e) => setLocation(e.target.value)}
            placeholder="e.g. San Francisco, CA (Remote)"
            className="w-full px-4 py-2.5 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-indigo-200 focus:border-indigo-300 outline-none" />
        </div>

        {/* Description */}
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1.5">Job Description *</label>
          <textarea value={description} onChange={(e) => setDescription(e.target.value)}
            placeholder="Paste the full job description here..." rows={12}
            className="w-full px-4 py-2.5 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-indigo-200 focus:border-indigo-300 outline-none resize-y" />
        </div>

        {/* Notes */}
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1.5">Notes (optional)</label>
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)}
            placeholder="Any personal notes about this role..." rows={3}
            className="w-full px-4 py-2.5 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-indigo-200 focus:border-indigo-300 outline-none resize-y" />
        </div>

        {/* Submit */}
        <div className="pt-2">
          <button onClick={saveJob} disabled={saving}
            className="w-full px-6 py-3 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors flex items-center justify-center gap-2">
            {saving && <Loader2 className="w-4 h-4 animate-spin" />}
            {saving ? 'Saving...' : 'Save Job & Analyze'}
          </button>
        </div>
      </div>
    </div>
  );
}
