'use client';

import { useState } from 'react';
import { getCompanyLogoUrl } from '@/lib/company-logos';

/**
 * Square favicon next to a listing title. Falls back to a colored
 * initial chip on load failure (Google's favicon service occasionally
 * returns a 404 for very new / private domains, and manually-added
 * listings have no slug we can resolve).
 *
 * Props
 * ─────
 *  - companySlug: from the JobListing — e.g. "stripe", "doordashusa"
 *  - companyName: shown as the fallback initial
 *  - size: pixels (square). Default 24, the listing-card size; the
 *    expanded detail / Kanban card uses 32.
 */
export function CompanyLogo({
  companySlug,
  companyName,
  size = 24,
}: {
  companySlug: string;
  companyName: string;
  size?: number;
}) {
  const [errored, setErrored] = useState(false);
  // Manually-added listings ("manual-<uuid>") don't have a real slug
  // — go straight to the initial-chip fallback so we don't fire a
  // pointless favicon request.
  const isManual = !companySlug || companySlug.startsWith('manual-');
  const showFallback = errored || isManual;

  if (showFallback) {
    const initial = (companyName || '?').trim().charAt(0).toUpperCase();
    return (
      <span
        className="inline-flex items-center justify-center rounded-md bg-gradient-to-br from-indigo-500 to-violet-500 text-white font-bold shrink-0"
        style={{ width: size, height: size, fontSize: size * 0.55 }}
        aria-hidden
      >
        {initial}
      </span>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={getCompanyLogoUrl(companySlug)}
      alt={`${companyName} logo`}
      width={size}
      height={size}
      onError={() => setErrored(true)}
      // referrerpolicy=no-referrer keeps the URL out of analytics on
      // Google's side — no functional difference for us, just polite.
      referrerPolicy="no-referrer"
      className="rounded-md bg-white shrink-0 ring-1 ring-gray-200/60"
      style={{ width: size, height: size }}
    />
  );
}
