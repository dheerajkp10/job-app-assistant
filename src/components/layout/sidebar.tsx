'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { PlusCircle, Settings, Briefcase, Globe } from 'lucide-react';

const NAV_ITEMS = [
  { href: '/listings', label: 'Job Listings', icon: Globe },
  { href: '/jobs/add', label: 'Add Job', icon: PlusCircle },
  { href: '/settings', label: 'Settings', icon: Settings },
];

export default function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="w-64 bg-gray-900 text-white flex flex-col min-h-screen">
      <div className="p-6 border-b border-gray-800">
        <Link href="/listings" className="flex items-center gap-3">
          <Briefcase className="w-7 h-7 text-blue-400" />
          <div>
            <h1 className="text-lg font-bold leading-tight">Job App</h1>
            <p className="text-xs text-gray-400">Assistant</p>
          </div>
        </Link>
      </div>

      <nav className="flex-1 p-4 space-y-1">
        {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
          const isActive = pathname === href || pathname.startsWith(href + '/');
          return (
            <Link
              key={href}
              href={href}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                isActive
                  ? 'bg-blue-600 text-white'
                  : 'text-gray-300 hover:bg-gray-800 hover:text-white'
              }`}
            >
              <Icon className="w-5 h-5" />
              {label}
            </Link>
          );
        })}
      </nav>

      <div className="p-4 border-t border-gray-800">
        <p className="text-xs text-gray-500 text-center">Job Application Assistant v1.0</p>
      </div>
    </aside>
  );
}
