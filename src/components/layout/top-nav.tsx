'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  PlusCircle,
  Settings,
  Briefcase,
  Globe,
  LayoutDashboard,
} from 'lucide-react';

const NAV_ITEMS = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/listings', label: 'Job Listings', icon: Globe },
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
    <header className="sticky top-0 z-30 backdrop-blur-md bg-white/75 border-b border-gray-200/60">
      <div className="max-w-[1500px] mx-auto px-6 h-14 flex items-center gap-6">
        <Link href="/dashboard" className="flex items-center gap-2 group shrink-0">
          <div className="relative w-7 h-7 rounded-lg bg-gradient-to-br from-blue-500 via-indigo-500 to-purple-500 flex items-center justify-center shadow-sm group-hover:shadow-md group-hover:scale-105 transition-all">
            <Briefcase className="w-4 h-4 text-white" />
          </div>
          <span className="text-sm font-bold bg-gradient-to-r from-blue-600 via-indigo-600 to-purple-600 bg-clip-text text-transparent tracking-tight">
            JobAssist
          </span>
        </Link>

        <nav className="flex items-center gap-1 flex-1">
          {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
            const isActive = pathname === href || pathname.startsWith(href + '/');
            return (
              <Link
                key={href}
                href={href}
                className={`relative flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${
                  isActive
                    ? 'text-blue-700 bg-blue-50'
                    : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'
                }`}
              >
                <Icon className="w-4 h-4" />
                {label}
                {isActive && (
                  <span className="absolute -bottom-[5px] left-3 right-3 h-0.5 bg-gradient-to-r from-blue-500 to-indigo-500 rounded-full" />
                )}
              </Link>
            );
          })}
        </nav>
      </div>
    </header>
  );
}
