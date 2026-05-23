'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  PlusCircle,
  Settings,
  Briefcase,
  Globe,
  LayoutDashboard,
  Kanban,
  Users,
} from 'lucide-react';
import ThemeToggle from './theme-toggle';
import ResetButton from './reset-button';

const NAV_ITEMS = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/listings', label: 'Job Listings', icon: Globe },
  { href: '/pipeline', label: 'Pipeline', icon: Kanban },
  { href: '/network', label: 'Network', icon: Users },
  { href: '/jobs/add', label: 'Add Job', icon: PlusCircle },
  { href: '/settings', label: 'Settings', icon: Settings },
];

/**
 * Slim top navigation bar shown on all pages after onboarding.
 * Replaces the previous left-side rail. Sticks to the top, frosted-glass
 * background, gradient brand mark — gives a more modern, "new-age" feel
 * while reclaiming the full horizontal width for page content.
 */
export default function TopNav() {
  const pathname = usePathname();

  return (
    <header className="sticky top-0 z-30 backdrop-blur-md bg-white/70 border-b border-slate-100">
      {/* Skip link — invisible until focused via Tab from the URL
          bar. Keyboard users can jump past the nav directly to the
          page content without tabbing through every nav link.
          Requires the page-level <main> wrapper in layout.tsx
          to carry id="main" (added there).  */}
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:px-3 focus:py-1.5 focus:rounded-md focus:bg-indigo-600 focus:text-white focus:text-sm focus:font-semibold focus:shadow-lg focus:outline-none focus:ring-2 focus:ring-indigo-300"
      >
        Skip to main content
      </a>
      <div className="max-w-[1400px] mx-auto px-3 sm:px-6 h-14 flex items-center gap-3 sm:gap-6">
        <Link
          href="/dashboard"
          aria-label="JobAssist — go to dashboard"
          className="flex items-center gap-2 group shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300 focus-visible:ring-offset-2 rounded-xl"
        >
          <div className="relative w-8 h-8 rounded-xl bg-gradient-to-br from-indigo-500 to-violet-500 flex items-center justify-center shadow-md shadow-indigo-500/25 group-hover:shadow-lg group-hover:shadow-indigo-500/35 group-hover:-translate-y-0.5 transition-all duration-200">
            <Briefcase className="w-4 h-4 text-white" aria-hidden="true" />
          </div>
          <span className="hidden sm:inline text-sm font-bold bg-gradient-to-r from-indigo-600 to-violet-600 bg-clip-text text-transparent tracking-tight">
            JobAssist
          </span>
        </Link>

        {/* Mobile-friendly nav: labels collapse to icon-only below
            sm. Horizontal scroll preserves access to every link on
            very narrow screens without a hamburger menu. */}
        <nav className="flex items-center gap-1 flex-1 overflow-x-auto no-scrollbar">
          {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
            const isActive = pathname === href || pathname.startsWith(href + '/');
            return (
              <Link
                key={href}
                href={href}
                title={label}
                className={`relative flex items-center gap-2 px-2.5 sm:px-3 py-1.5 rounded-full text-sm font-medium transition-all duration-200 shrink-0 ${
                  isActive
                    ? 'text-indigo-700 bg-indigo-50 shadow-sm shadow-indigo-500/10'
                    : 'text-slate-500 hover:text-slate-800 hover:bg-slate-100'
                }`}
              >
                <Icon className="w-4 h-4" />
                <span className="hidden md:inline">{label}</span>
              </Link>
            );
          })}
        </nav>
        {/* Trailing controls — theme toggle + reset chip. Both
            live inside the nav row so they share the same vertical
            anchor and never overlap (the old floating Reset chip
            sat at top-4 right-4 and hid the theme toggle on top
            of it). Right-side divider keeps them visually grouped
            apart from the nav links. */}
        <div className="flex items-center gap-1 sm:gap-2 pl-2 sm:pl-3 sm:border-l border-slate-100 shrink-0">
          <ThemeToggle />
          <ResetButton inline />
        </div>
      </div>
    </header>
  );
}
