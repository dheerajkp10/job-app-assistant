import type { JobPortal } from './types';

export function detectPortal(url: string): JobPortal {
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    if (hostname.includes('linkedin.com')) return 'linkedin';
    if (hostname.includes('glassdoor.com') || hostname.includes('glassdoor.co')) return 'glassdoor';
    if (hostname.includes('indeed.com')) return 'indeed';
    return 'company';
  } catch {
    return 'company';
  }
}
