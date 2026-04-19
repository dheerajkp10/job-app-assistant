import Link from 'next/link';
import { LayoutDashboard, Settings as SettingsIcon, ChevronRight } from 'lucide-react';

/**
 * Top-level quick nav shown on sub-pages (listings, jobs/add, settings, etc.)
 * so the user can jump back to Dashboard or Settings from anywhere.
 */
export function PageHeaderNav({ current }: { current: string }) {
  return (
    <nav className="mb-4 flex items-center gap-2 text-xs text-gray-500">
      <Link
        href="/dashboard"
        className="inline-flex items-center gap-1 px-2 py-1 rounded hover:bg-gray-100 hover:text-blue-600 transition-colors"
      >
        <LayoutDashboard className="w-3.5 h-3.5" />
        Dashboard
      </Link>
      <Link
        href="/settings"
        className="inline-flex items-center gap-1 px-2 py-1 rounded hover:bg-gray-100 hover:text-blue-600 transition-colors"
      >
        <SettingsIcon className="w-3.5 h-3.5" />
        Settings
      </Link>
      <ChevronRight className="w-3 h-3 text-gray-300" />
      <span className="font-medium text-gray-700">{current}</span>
    </nav>
  );
}
