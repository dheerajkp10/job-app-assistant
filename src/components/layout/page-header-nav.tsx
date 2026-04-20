import Link from 'next/link';
import { ChevronRight, Home } from 'lucide-react';

/**
 * Breadcrumb trail shown above the page title on sub-pages.
 * Deliberately just a breadcrumb (Dashboard › Current Page) — the sidebar
 * already provides navigation to Settings and other sections, so duplicating
 * those links here just muddied the hierarchy.
 */
export function PageHeaderNav({ current }: { current: string }) {
  return (
    <nav
      className="mb-4 flex items-center gap-1.5 text-xs text-gray-500"
      aria-label="Breadcrumb"
    >
      <Link
        href="/dashboard"
        className="inline-flex items-center gap-1 px-2 py-1 rounded-md hover:bg-gray-100 hover:text-blue-600 transition-colors"
      >
        <Home className="w-3.5 h-3.5" />
        Dashboard
      </Link>
      <ChevronRight className="w-3 h-3 text-gray-300" />
      <span className="px-2 py-1 font-semibold text-gray-800">{current}</span>
    </nav>
  );
}
