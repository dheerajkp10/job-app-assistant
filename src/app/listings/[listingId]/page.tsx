'use client';

import { useState, useEffect, use } from 'react';
import Link from 'next/link';
import {
  ArrowLeft, MapPin, Calendar, ExternalLink, Building2,
  DollarSign, Loader2, CheckCircle2, ClipboardList,
  Target, Download, FileText, AlertTriangle, ArrowUpRight,
  XCircle,
} from 'lucide-react';
import type { JobListingDetail, ListingFlag } from '@/lib/types';
import { LISTING_FLAGS } from '@/lib/types';
import { Tag } from 'lucide-react';

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

const ATS_LABELS: Record<string, string> = {
  greenhouse: 'Greenhouse',
  lever: 'Lever',
  ashby: 'Ashby',
};

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

export default function ListingDetailPage({
  params,
}: {
  params: Promise<{ listingId: string }>;
}) {
  const { listingId } = use(params);
  const [listing, setListing] = useState<JobListingDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // ATS Score
  const [score, setScore] = useState<ATSScore | null>(null);
  const [scoring, setScoring] = useState(false);
  const [scoreError, setScoreError] = useState<string | null>(null);

  // Tailor
  const [tailorResult, setTailorResult] = useState<TailorResult | null>(null);
  const [tailoring, setTailoring] = useState(false);
  const [downloadingFormat, setDownloadingFormat] = useState<'pdf' | 'docx' | null>(null);
  const [tailorError, setTailorError] = useState<string | null>(null);

  // Which missing keywords the user wants included in the tailoring pass.
  // Initialized to "all missing" whenever a fresh score lands.
  const [selectedKeywords, setSelectedKeywords] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (score?.missingKeywords) {
      setSelectedKeywords(new Set(score.missingKeywords));
    }
  }, [score]);

  // User flag (applied / incorrect / not-applicable)
  const [flag, setFlag] = useState<ListingFlag | null>(null);
  const flagMeta = flag ? LISTING_FLAGS.find((f) => f.key === flag) : null;

  useEffect(() => {
    fetch('/api/listing-flags')
      .then((r) => r.json())
      .then((map: Record<string, { flag: ListingFlag }>) => {
        if (map[listingId]) setFlag(map[listingId].flag);
      })
      .catch(() => {});
  }, [listingId]);

  async function updateFlag(next: ListingFlag | null) {
    setFlag(next); // optimistic
    try {
      await fetch('/api/listing-flags', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ listingId, flag: next }),
      });
    } catch {
      // Swallow — UI stays optimistic; next reload will reconcile.
    }
  }

  function toggleKeyword(k: string) {
    setSelectedKeywords((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
  }

  useEffect(() => {
    fetch(`/api/listings/${encodeURIComponent(listingId)}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.error) setError(data.error);
        else setListing(data);
        setLoading(false);
      })
      .catch(() => {
        setError('Failed to load listing details');
        setLoading(false);
      });
  }, [listingId]);

  // Auto-score when listing loads
  useEffect(() => {
    if (listing && !score && !scoring) {
      handleScore();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listing]);

  async function handleScore() {
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
      }
    } catch {
      setScoreError('Failed to calculate score');
    } finally {
      setScoring(false);
    }
  }

  async function handleTailor() {
    setTailoring(true);
    setTailorError(null);
    try {
      const res = await fetch('/api/tailor-resume', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          listingId,
          format: 'json',
          selectedKeywords: Array.from(selectedKeywords),
        }),
      });
      const data = await res.json();
      if (data.error) {
        setTailorError(data.error);
      } else {
        setTailorResult(data);
      }
    } catch {
      setTailorError('Failed to tailor resume');
    } finally {
      setTailoring(false);
    }
  }

  async function handleDownload(format: 'pdf' | 'docx') {
    if (downloadingFormat) return;
    setDownloadingFormat(format);
    setTailorError(null);
    try {
      const res = await fetch('/api/tailor-resume', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          listingId,
          format,
          selectedKeywords: Array.from(selectedKeywords),
        }),
      });
      if (!res.ok) {
        // Error responses come back as JSON (e.g. "upload a .docx") —
        // parse and surface the message instead of downloading it as a
        // broken file.
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Request failed (${res.status})`);
      }
      const blob = await res.blob();
      const disposition = res.headers.get('Content-Disposition') || '';
      const match = disposition.match(/filename="(.+?)"/);
      const fallback = format === 'docx' ? 'tailored_resume.docx' : 'tailored_resume.pdf';
      const filename = match?.[1] || fallback;

      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setTailorError(e instanceof Error ? e.message : 'Failed to download resume');
    } finally {
      setDownloadingFormat(null);
    }
  }

  if (loading) {
    return (
      <div className="p-8 flex flex-col items-center justify-center min-h-[50vh]">
        <Loader2 className="w-8 h-8 text-indigo-500 animate-spin mb-3" />
        <p className="text-sm text-slate-500">Loading job details...</p>
      </div>
    );
  }

  if (error || !listing) {
    return (
      <div className="p-8 text-center">
        <h2 className="text-lg font-semibold text-slate-800 mb-2">
          {error || 'Listing not found'}
        </h2>
        <Link href="/listings" className="text-indigo-600 hover:underline text-sm">
          Back to Listings
        </Link>
      </div>
    );
  }

  const posted = listing.postedAt
    ? new Date(listing.postedAt).toLocaleDateString('en-US', {
        year: 'numeric', month: 'long', day: 'numeric',
      })
    : null;

  return (
    <div className="p-8 max-w-6xl mx-auto">
      <Link
        href="/listings"
        className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700 mb-6"
      >
        <ArrowLeft className="w-4 h-4" />
        Back to Listings
      </Link>

      {/* Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-slate-800 mb-2">{listing.title}</h1>
        <div className="flex items-center gap-3 mb-3">
          <Building2 className="w-5 h-5 text-slate-400" />
          <span className="text-lg font-medium text-slate-700">{listing.company}</span>
          {listing.department && (
            <span className="text-sm text-slate-400">&middot; {listing.department}</span>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-4 text-sm text-slate-500">
          {listing.location && listing.location !== 'Not specified' && (
            <span className="flex items-center gap-1.5">
              <MapPin className="w-4 h-4" /> {listing.location}
            </span>
          )}
          {listing.salary && (
            <span className="flex items-center gap-1.5 text-green-600 font-semibold">
              <DollarSign className="w-4 h-4" /> {listing.salary}
            </span>
          )}
          {posted && (
            <span className="flex items-center gap-1.5">
              <Calendar className="w-4 h-4" /> Posted {posted}
            </span>
          )}
        </div>
        <div className="mt-4 flex items-center gap-3 flex-wrap">
          <a
            href={listing.url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 px-5 py-2.5 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors"
          >
            <ExternalLink className="w-4 h-4" /> Apply on {listing.company}
          </a>

          {/* Flag selector */}
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-slate-500 flex items-center gap-1 mr-1">
              <Tag className="w-3.5 h-3.5" /> Flag:
            </span>
            {LISTING_FLAGS.map((f) => {
              const on = flag === f.key;
              return (
                <button
                  key={f.key}
                  type="button"
                  onClick={() => updateFlag(on ? null : f.key)}
                  className={`px-2.5 py-1.5 rounded-md text-xs font-medium border transition-colors ${
                    on
                      ? 'text-white border-transparent'
                      : 'text-slate-600 border-slate-200 hover:bg-slate-50'
                  }`}
                  style={on ? { backgroundColor: f.color } : undefined}
                  title={on ? `Click to clear ${f.label}` : `Mark as ${f.label}`}
                >
                  {f.label}
                </button>
              );
            })}
            {flagMeta && (
              <span className="text-[11px] text-slate-400 ml-1">
                (click again to clear)
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-6">
        {/* Main content */}
        <div className="col-span-2 space-y-6">
          {/* ATS Match Score Panel */}
          <section className="bg-white rounded-xl border border-slate-200 p-6">
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
                          <button
                            type="button"
                            onClick={() => setSelectedKeywords(new Set(score.missingKeywords))}
                            className="px-1.5 py-0.5 text-red-700 hover:bg-red-100 rounded"
                          >
                            All
                          </button>
                          <button
                            type="button"
                            onClick={() => setSelectedKeywords(new Set())}
                            className="px-1.5 py-0.5 text-red-700 hover:bg-red-100 rounded"
                          >
                            None
                          </button>
                        </div>
                      )}
                    </div>
                    <p className="text-[11px] text-red-600/80 mb-2">
                      Click to include/exclude in tailoring.
                    </p>
                    <div className="flex flex-wrap gap-1">
                      {score.missingKeywords.map((k) => {
                        const on = selectedKeywords.has(k);
                        return (
                          <button
                            key={k}
                            type="button"
                            onClick={() => toggleKeyword(k)}
                            className={`px-2 py-0.5 rounded text-xs border transition-colors ${
                              on
                                ? 'bg-red-100 text-red-700 border-red-200 hover:bg-red-200'
                                : 'bg-white text-slate-400 border-slate-200 line-through hover:bg-slate-50'
                            }`}
                          >
                            {k}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </section>

          {/* Resume Tailor Panel */}
          <section className="bg-white rounded-xl border border-slate-200 p-6">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <FileText className="w-5 h-5 text-violet-500" />
                <h2 className="text-lg font-semibold text-slate-800">Resume Tailor</h2>
              </div>
              {!tailorResult && (
                <button
                  onClick={handleTailor}
                  disabled={tailoring || !score}
                  className="flex items-center gap-2 px-4 py-2 bg-violet-600 text-white text-sm font-medium rounded-lg hover:bg-purple-700 disabled:opacity-50 transition-colors"
                >
                  {tailoring ? (
                    <><Loader2 className="w-4 h-4 animate-spin" /> Tailoring...</>
                  ) : (
                    <><FileText className="w-4 h-4" /> Tailor My Resume</>
                  )}
                </button>
              )}
            </div>

            {!score && !scoring && !scoreError && (
              <p className="text-sm text-slate-400">Score will be calculated automatically...</p>
            )}

            {score && !tailorResult && !tailoring && !tailorError && (
              <p className="text-sm text-slate-500">
                Click &ldquo;Tailor My Resume&rdquo; to optimize your resume for this role.
                Keywords from the job description will be added to your Skills and Summary sections.
                <span className="block mt-1 text-xs text-slate-400">No false information will be added — only keyword optimization.</span>
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
                {/* Score improvement */}
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

                {/* Changes summary */}
                <div>
                  <h3 className="text-sm font-medium text-slate-700 mb-2">Changes Made</h3>
                  <ul className="space-y-1">
                    {tailorResult.changesSummary.map((c, i) => (
                      <li key={i} className="text-sm text-slate-600 flex gap-2">
                        <CheckCircle2 className="w-4 h-4 text-green-500 shrink-0 mt-0.5" />
                        {c}
                      </li>
                    ))}
                  </ul>
                </div>

                {/* Added keywords */}
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

                {/* Download buttons — PDF to submit, DOCX to re-upload or edit in Word */}
                <div className="flex flex-col sm:flex-row gap-2">
                  <button
                    onClick={() => handleDownload('pdf')}
                    disabled={!!downloadingFormat}
                    className="flex-1 flex items-center gap-2 px-5 py-2.5 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700 disabled:opacity-50 transition-colors justify-center"
                  >
                    {downloadingFormat === 'pdf' ? (
                      <><Loader2 className="w-4 h-4 animate-spin" /> Generating PDF...</>
                    ) : (
                      <><Download className="w-4 h-4" /> Download as PDF</>
                    )}
                  </button>
                  <button
                    onClick={() => handleDownload('docx')}
                    disabled={!!downloadingFormat}
                    className="flex-1 flex items-center gap-2 px-5 py-2.5 border border-green-600 text-green-700 bg-white text-sm font-medium rounded-lg hover:bg-green-50 disabled:opacity-50 transition-colors justify-center"
                    title="Download the editable Word document. You can re-upload this .docx in Settings to make it your new base resume, or edit it further in Word."
                  >
                    {downloadingFormat === 'docx' ? (
                      <><Loader2 className="w-4 h-4 animate-spin" /> Generating DOCX...</>
                    ) : (
                      <><Download className="w-4 h-4" /> Download as DOCX</>
                    )}
                  </button>
                </div>

                <p className="text-xs text-slate-400 text-center">
                  Only keyword additions were made — no fabricated information and no original content removed. Re-upload the .docx in Settings if you want this tailored version to become your new base resume.
                </p>
              </div>
            )}
          </section>

          {/* Job Description */}
          <section className="bg-white rounded-xl border border-slate-200 p-6">
            <h2 className="text-lg font-semibold text-slate-800 mb-4">Job Description</h2>
            <div
              className="prose prose-sm max-w-none text-slate-600 [&>ul]:list-disc [&>ul]:pl-5 [&>ol]:list-decimal [&>ol]:pl-5 [&>p]:mb-3 [&>h3]:font-semibold [&>h3]:text-slate-700 [&>h3]:mt-4 [&>h3]:mb-2"
              dangerouslySetInnerHTML={{ __html: listing.content }}
            />
          </section>
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          {/* Quick Summary */}
          <section className="bg-white rounded-xl border border-slate-200 p-6">
            <h2 className="text-sm font-semibold text-slate-800 mb-4">Quick Summary</h2>
            <div className="space-y-3 text-sm">
              <div>
                <span className="text-slate-400">Company</span>
                <p className="font-medium text-slate-800">{listing.company}</p>
              </div>
              <div>
                <span className="text-slate-400">Role</span>
                <p className="font-medium text-slate-800">{listing.title}</p>
              </div>
              <div>
                <span className="text-slate-400">Location</span>
                <p className="font-medium text-slate-800">{listing.location}</p>
              </div>
              {listing.department && (
                <div>
                  <span className="text-slate-400">Department</span>
                  <p className="font-medium text-slate-800">{listing.department}</p>
                </div>
              )}
              {listing.salary && (
                <div>
                  <span className="text-slate-400">Salary</span>
                  <p className="font-semibold text-green-600">{listing.salary}</p>
                </div>
              )}
              {posted && (
                <div>
                  <span className="text-slate-400">Posted</span>
                  <p className="font-medium text-slate-800">{posted}</p>
                </div>
              )}
              <div>
                <span className="text-slate-400">Source</span>
                <p className="font-medium text-slate-800">
                  {ATS_LABELS[listing.ats] || listing.ats}
                </p>
              </div>
            </div>
          </section>

          {/* Qualifications */}
          {listing.qualifications.length > 0 && (
            <section className="bg-white rounded-xl border border-slate-200 p-6">
              <div className="flex items-center gap-2 mb-3">
                <CheckCircle2 className="w-4 h-4 text-indigo-500" />
                <h2 className="text-sm font-semibold text-slate-800">Key Qualifications</h2>
              </div>
              <ul className="space-y-2">
                {listing.qualifications.slice(0, 8).map((q, i) => (
                  <li key={i} className="text-sm text-slate-600 flex gap-2">
                    <span className="text-blue-400 shrink-0 mt-0.5">&bull;</span>
                    <span>{q}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* Responsibilities */}
          {listing.responsibilities.length > 0 && (
            <section className="bg-white rounded-xl border border-slate-200 p-6">
              <div className="flex items-center gap-2 mb-3">
                <ClipboardList className="w-4 h-4 text-violet-500" />
                <h2 className="text-sm font-semibold text-slate-800">Key Responsibilities</h2>
              </div>
              <ul className="space-y-2">
                {listing.responsibilities.slice(0, 8).map((r, i) => (
                  <li key={i} className="text-sm text-slate-600 flex gap-2">
                    <span className="text-purple-400 shrink-0 mt-0.5">&bull;</span>
                    <span>{r}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
