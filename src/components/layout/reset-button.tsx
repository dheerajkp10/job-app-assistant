'use client';

import { useEffect, useRef, useState } from 'react';
import { RotateCcw, AlertTriangle, X } from 'lucide-react';

/**
 * Resets all local app state and sends the user back through
 * onboarding. Hidden until onboarding is complete (so it doesn't
 * appear on the onboarding wizard itself).
 *
 * Layout: `inline` mode (default true) renders as a regular nav
 * button so it can live inside the TopNav alongside the theme
 * toggle. Without `inline` it falls back to the legacy fixed-
 * positioned floating chip — kept for back-compat in case any
 * caller still expects the float behavior. Previously the float
 * sat at `top-4 right-4` and overlapped the TopNav's theme
 * toggle, hiding it behind the Reset chip.
 *
 * Shows a confirmation modal because the action is irreversible —
 * db.json and the uploaded resume files are deleted.
 */
export default function ResetButton({ inline = false }: { inline?: boolean }) {
  const [showConfirm, setShowConfirm] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const cancelRef = useRef<HTMLButtonElement | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);

  // Accessibility plumbing for the confirmation dialog:
  //   1. On open: move focus to the Cancel button (safer default
  //      than the destructive "Yes" button).
  //   2. On close: restore focus to the trigger so keyboard users
  //      don't get teleported back to <body>.
  //   3. Escape dismisses (unless we're mid-reset, in which case
  //      we ignore so the user can't bail in the middle of the
  //      destructive network call).
  //   4. Focus is trapped inside the dialog with a Tab/Shift+Tab
  //      handler that cycles between the focusable controls.
  useEffect(() => {
    if (!showConfirm) return;
    // Focus the safer "Cancel" action.
    const t = setTimeout(() => cancelRef.current?.focus(), 0);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !resetting) {
        e.preventDefault();
        setShowConfirm(false);
        return;
      }
      if (e.key !== 'Tab' || !dialogRef.current) return;
      // Cycle focus within the dialog. Query each press so we pick
      // up changes (e.g. the error message gains a focusable
      // dismiss if we ever add one).
      const focusable = dialogRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      clearTimeout(t);
      document.removeEventListener('keydown', onKey);
    };
  }, [showConfirm, resetting]);

  // Restore focus to the trigger when the dialog closes — but
  // only on transitions open→closed (not on initial mount), and
  // not after a successful reset (which navigates away anyway).
  const wasOpenRef = useRef(false);
  useEffect(() => {
    if (showConfirm) {
      wasOpenRef.current = true;
      return;
    }
    if (wasOpenRef.current) {
      wasOpenRef.current = false;
      triggerRef.current?.focus({ preventScroll: true });
    }
  }, [showConfirm]);

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

  // Inline rendering: a small icon-only chip in the nav row,
  // mirroring the ThemeToggle's footprint. Mobile keeps the icon
  // only; sm: and above shows the "Reset" label.
  const inlineClasses =
    'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium text-slate-500 ' +
    'hover:bg-rose-50 hover:text-rose-700 transition-colors';
  // Legacy floating chip — kept behind the explicit `inline={false}`
  // opt-out so older callers (if any remained) still work. Pre-fix
  // this caused the overlap-with-theme-toggle bug.
  const floatingClasses =
    'fixed top-4 right-4 z-40 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full ' +
    'bg-white/90 backdrop-blur border border-slate-200 text-xs font-medium text-slate-700 ' +
    'shadow-sm hover:bg-red-50 hover:text-red-700 hover:border-red-200 transition-colors';
  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setShowConfirm(true)}
        className={inline ? inlineClasses : floatingClasses}
        aria-label="Reset app and restart onboarding"
        aria-haspopup="dialog"
        aria-expanded={showConfirm}
        title="Reset app state and restart onboarding"
      >
        <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
        <span className={inline ? 'hidden sm:inline' : ''}>Reset</span>
      </button>

      {showConfirm && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          // Click on backdrop closes — same semantics as Escape.
          // We check target===currentTarget so clicks inside the
          // dialog (which bubble up) don't trigger close.
          onClick={(e) => { if (e.target === e.currentTarget && !resetting) setShowConfirm(false); }}
        >
          <div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="reset-dialog-title"
            aria-describedby="reset-dialog-desc"
            className="bg-white rounded-xl shadow-2xl max-w-md w-full"
          >
            <div className="flex items-start justify-between p-5 border-b border-slate-200">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-red-100 flex items-center justify-center">
                  <AlertTriangle className="w-5 h-5 text-red-600" aria-hidden="true" />
                </div>
                <h2 id="reset-dialog-title" className="text-lg font-semibold text-slate-800">Reset everything?</h2>
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

            <div id="reset-dialog-desc" className="p-5 space-y-3 text-sm text-slate-700">
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
                ref={cancelRef}
                type="button"
                onClick={() => setShowConfirm(false)}
                disabled={resetting}
                className="px-4 py-2 rounded-lg text-sm font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-100 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300 focus-visible:ring-offset-2 transition-colors"
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
