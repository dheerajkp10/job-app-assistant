'use client';

import { useEffect, useState } from 'react';
import { Plus, Trash2, Loader2, CheckCircle2, AlertCircle, Globe } from 'lucide-react';
import type { CustomCompanySource, ATSType } from '@/lib/types';

/**
 * Settings panel for adding/removing custom company career sources
 * the bulk fetcher should crawl alongside the static `COMPANY_SOURCES`.
 *
 * Flow
 * ────
 *  1. User picks an ATS (greenhouse / lever / ashby / workday / …).
 *  2. Enters the company name + boardToken (and Workday host/site if
 *     applicable).
 *  3. Clicks "Test" → the /api/sources/probe endpoint hits the live
 *     ATS API and reports how many jobs are open. The user only sees
 *     "Save" enabled after a successful probe (≥ 0 jobs returned).
 *  4. Save → POST /api/sources persists in `Settings.customSources`.
 *  5. Next refresh of the listings page picks up the new source via
 *     `getAllSources()` (union of static + custom).
 */

const ATS_OPTIONS: { value: ATSType; label: string; needsWorkday?: boolean }[] = [
  { value: 'greenhouse', label: 'Greenhouse' },
  { value: 'lever', label: 'Lever' },
  { value: 'ashby', label: 'Ashby' },
  { value: 'workday', label: 'Workday', needsWorkday: true },
];

export function CustomSourcesPanel() {
  const [sources, setSources] = useState<CustomCompanySource[]>([]);
  const [loading, setLoading] = useState(true);

  // Form state
  const [name, setName] = useState('');
  const [ats, setAts] = useState<ATSType>('greenhouse');
  const [boardToken, setBoardToken] = useState('');
  const [workdayHost, setWorkdayHost] = useState('');
  const [workdaySite, setWorkdaySite] = useState('');
  const [probeState, setProbeState] = useState<
    | { phase: 'idle' }
    | { phase: 'probing' }
    | { phase: 'ok'; jobCount: number }
    | { phase: 'error'; message: string }
  >({ phase: 'idle' });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch('/api/sources')
      .then((r) => r.json())
      .then((d) => setSources(d.sources ?? []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const needsWorkday = ats === 'workday';

  async function probe() {
    if (!boardToken) return;
    setProbeState({ phase: 'probing' });
    try {
      const res = await fetch('/api/sources/probe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ats, boardToken, workdayHost, workdaySite }),
      });
      const data = await res.json();
      if (data.ok) setProbeState({ phase: 'ok', jobCount: data.jobCount ?? 0 });
      else setProbeState({ phase: 'error', message: data.error ?? 'Probe failed' });
    } catch (err) {
      setProbeState({ phase: 'error', message: err instanceof Error ? err.message : 'Network error' });
    }
  }

  async function save() {
    if (!name || !boardToken) return;
    setSaving(true);
    try {
      const res = await fetch('/api/sources', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          ats,
          boardToken,
          workdayHost: needsWorkday ? workdayHost : undefined,
          workdaySite: needsWorkday ? workdaySite : undefined,
        }),
      });
      const data = await res.json();
      if (data.error) {
        setProbeState({ phase: 'error', message: data.error });
        return;
      }
      setSources([...sources.filter((s) => s.slug !== data.source.slug), data.source]);
      // Clear form
      setName('');
      setBoardToken('');
      setWorkdayHost('');
      setWorkdaySite('');
      setProbeState({ phase: 'idle' });
    } finally {
      setSaving(false);
    }
  }

  async function remove(slug: string) {
    if (!confirm('Remove this custom source? The static company list is unaffected.')) return;
    await fetch(`/api/sources?slug=${encodeURIComponent(slug)}`, { method: 'DELETE' });
    setSources(sources.filter((s) => s.slug !== slug));
  }

  return (
    <section className="mb-6 bg-white rounded-xl border border-gray-200 p-6">
      <div className="flex items-center gap-3 mb-3">
        <Globe className="w-5 h-5 text-gray-500" />
        <h2 className="text-lg font-semibold text-gray-900">Custom Company Sources</h2>
      </div>
      <p className="text-xs text-gray-500 mb-4">
        Add your own company career boards. Test the token before saving so you don&apos;t add a dead source by mistake.
      </p>

      {/* Existing list */}
      {loading ? (
        <div className="flex items-center gap-2 text-xs text-gray-400 mb-4">
          <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading saved sources…
        </div>
      ) : sources.length === 0 ? (
        <p className="text-xs text-gray-400 italic mb-4">No custom sources yet.</p>
      ) : (
        <ul className="space-y-1.5 mb-4">
          {sources.map((s) => (
            <li
              key={s.slug}
              className="flex items-center justify-between gap-2 px-3 py-2 bg-gray-50 rounded-lg border border-gray-100 text-sm"
            >
              <div className="min-w-0">
                <div className="font-medium text-gray-800 truncate">{s.name}</div>
                <div className="text-[11px] text-gray-500">
                  {s.ats} · token: <code>{s.boardToken}</code>
                  {s.workdayHost ? ` · ${s.workdayHost}` : ''}
                </div>
              </div>
              <button
                type="button"
                onClick={() => remove(s.slug)}
                className="p-1 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded"
                title="Remove"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </li>
          ))}
        </ul>
      )}

      {/* Add form */}
      <div className="grid grid-cols-2 gap-3 mb-3">
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Company name</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Acme Corp"
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">ATS</label>
          <select
            value={ats}
            onChange={(e) => setAts(e.target.value as ATSType)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
          >
            {ATS_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>
        <div className="col-span-2">
          <label className="block text-xs font-medium text-gray-500 mb-1">Board token / slug</label>
          <input
            type="text"
            value={boardToken}
            onChange={(e) => setBoardToken(e.target.value)}
            placeholder="e.g. acme (Greenhouse), acme-corp (Lever), acme.com (Ashby)"
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
          />
        </div>
        {needsWorkday && (
          <>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Workday host</label>
              <input
                type="text"
                value={workdayHost}
                onChange={(e) => setWorkdayHost(e.target.value)}
                placeholder="e.g. acme.wd5.myworkdayjobs.com"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Workday site</label>
              <input
                type="text"
                value={workdaySite}
                onChange={(e) => setWorkdaySite(e.target.value)}
                placeholder="e.g. External_Career_Site"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
              />
            </div>
          </>
        )}
      </div>

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={probe}
          disabled={!boardToken || probeState.phase === 'probing'}
          className="inline-flex items-center gap-2 px-3 py-1.5 border border-gray-300 text-gray-700 text-xs font-medium rounded-lg hover:bg-gray-50 disabled:opacity-50"
        >
          {probeState.phase === 'probing' ? (
            <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Testing…</>
          ) : (
            <>Test connection</>
          )}
        </button>
        <button
          type="button"
          onClick={save}
          disabled={!name || !boardToken || probeState.phase !== 'ok' || saving}
          className="inline-flex items-center gap-2 px-3 py-1.5 bg-blue-600 text-white text-xs font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50"
        >
          {saving ? (
            <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Saving…</>
          ) : (
            <><Plus className="w-3.5 h-3.5" /> Add source</>
          )}
        </button>
        {probeState.phase === 'ok' && (
          <span className="inline-flex items-center gap-1 text-xs text-green-700">
            <CheckCircle2 className="w-3.5 h-3.5" /> {probeState.jobCount} open jobs
          </span>
        )}
        {probeState.phase === 'error' && (
          <span className="inline-flex items-center gap-1 text-xs text-red-700">
            <AlertCircle className="w-3.5 h-3.5" /> {probeState.message}
          </span>
        )}
      </div>
    </section>
  );
}
