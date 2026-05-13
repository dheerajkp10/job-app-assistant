'use client';

import { useState } from 'react';
import { RotateCcw, AlertTriangle, X } from 'lucide-react';

/**
 * Fixed top-right button that wipes all local app state and sends the user
 * back through onboarding. Hidden until onboarding is complete (so it doesn't
 * appear on the onboarding wizard itself).
 *
 * Shows a confirmation modal because the action is irreversible — db.json and
 * the uploaded resume files are deleted.
 */
export default function ResetButton() {
  const [showConfirm, setShowConfirm] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleReset() {
    setResetting(true);
    setError(null);
    try {
      const res = await fetch('/api/reset', { method: 'POST' });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Reset failed (${res.status})`);
      }
      // Hard-navigate to the root so the server layout re-reads settings
      // and renders the onboarding wizard. Using router.refresh() isn't
      // enough here because the sidebar visibility is a server-rendered
      // decision and we want a clean slate.
      window.location.href = '/';
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Reset failed');
      setResetting(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setShowConfirm(true)}
        className="fixed top-4 right-4 z-40 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/90 backdrop-blur border border-slate-200 text-xs font-medium text-slate-700 shadow-sm hover:bg-red-50 hover:text-red-700 hover:border-red-200 transition-colors"
        aria-label="Reset app and restart onboarding"
        title="Reset app state and restart onboarding"
      >
        <RotateCcw className="w-3.5 h-3.5" />
        Reset
      </button>

      {showConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-md w-full">
            <div className="flex items-start justify-between p-5 border-b border-slate-200">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-red-100 flex items-center justify-center">
                  <AlertTriangle className="w-5 h-5 text-red-600" />
                </div>
                <h2 className="text-lg font-semibold text-slate-800">Reset everything?</h2>
              </div>
              <button
                type="button"
                onClick={() => !resetting && setShowConfirm(false)}
                className="text-slate-400 hover:text-slate-600"
                aria-label="Close"
                disabled={resetting}
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-5 space-y-3 text-sm text-slate-700">
              <p>This will permanently delete:</p>
              <ul className="list-disc pl-5 space-y-1 text-slate-600">
                <li>Your uploaded resume (.docx / .pdf)</li>
                <li>All saved preferences (roles, levels, locations, salary, excluded companies)</li>
                <li>All added jobs and their notes</li>
                <li>Cached job listings and match scores</li>
              </ul>
              <p className="text-slate-600">
                You&apos;ll be taken back to the onboarding flow to set everything up from scratch.
                This cannot be undone.
              </p>
              {error && (
                <div className="rounded-md bg-red-50 border border-red-200 p-2.5 text-red-700 text-xs">
                  {error}
                </div>
              )}
            </div>

            <div className="flex gap-2 justify-end p-5 border-t border-slate-200 bg-slate-50 rounded-b-xl">
              <button
                type="button"
                onClick={() => setShowConfirm(false)}
                disabled={resetting}
                className="px-4 py-2 rounded-lg text-sm font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-100 disabled:opacity-50 transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleReset}
                disabled={resetting}
                className="px-4 py-2 rounded-lg text-sm font-medium text-white bg-red-600 hover:bg-red-700 disabled:opacity-50 transition-colors"
              >
                {resetting ? 'Resetting…' : 'Yes, reset everything'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
