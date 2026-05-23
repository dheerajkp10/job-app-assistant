'use client';

import { useEffect, useState } from 'react';
import { Sun, Moon } from 'lucide-react';

/**
 * Dark-mode toggle. Reads / writes `localStorage.jobassist-theme`
 * and applies `data-theme="dark"` to <html> so the CSS in
 * globals.css can target it. Initial paint is handled by the inline
 * script in layout.tsx (which runs before React hydrates) so there's
 * no light-to-dark flash on reload.
 */
export default function ThemeToggle() {
  // `mounted` gate avoids hydration mismatch: SSR doesn't know the
  // user's theme, so we render a neutral icon until the client takes
  // over.
  const [mounted, setMounted] = useState(false);
  const [theme, setTheme] = useState<'light' | 'dark'>('light');

  useEffect(() => {
    setMounted(true);
    const current = document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
    setTheme(current);
  }, []);

  function toggle() {
    const next = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    if (next === 'dark') {
      document.documentElement.setAttribute('data-theme', 'dark');
    } else {
      document.documentElement.removeAttribute('data-theme');
    }
    try {
      window.localStorage.setItem('jobassist-theme', next);
    } catch {
      /* localStorage unavailable (private mode) — theme still flips
         for this session, just won't persist. */
    }
  }

  // Render-time guard: before hydration, just return a placeholder
  // sized to match so the nav doesn't reflow when we mount.
  if (!mounted) {
    return (
      <button
        aria-label="Theme toggle"
        className="w-8 h-8 rounded-full"
        tabIndex={-1}
      />
    );
  }

  return (
    <button
      type="button"
      onClick={toggle}
      // `aria-pressed` marks this as a toggle button so screen
      // readers announce "pressed" / "not pressed" state, not
      // just the click target. Paired with `aria-label` for the
      // human-readable action so the button reads as
      // "Switch to light mode, toggle, pressed" in dark mode.
      aria-pressed={theme === 'dark'}
      aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
      title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
      className="inline-flex items-center justify-center w-8 h-8 rounded-full text-slate-500 hover:text-slate-800 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 transition-all duration-200"
    >
      {theme === 'dark' ? <Sun className="w-4 h-4" aria-hidden="true" /> : <Moon className="w-4 h-4" aria-hidden="true" />}
    </button>
  );
}
