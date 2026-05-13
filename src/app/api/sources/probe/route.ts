import { NextRequest, NextResponse } from 'next/server';
import type { ATSType } from '@/lib/types';

/**
 * POST /api/sources/probe
 * Body: { ats, boardToken, workdayHost?, workdaySite? }
 *
 * Verifies that the supplied (ats, boardToken) actually returns
 * jobs from the live ATS API. Used by the Settings → Add Source UI
 * before persisting — saves users from typing a bogus token and
 * then quietly getting zero listings on the next refresh.
 *
 * Returns: { ok: boolean, jobCount?: number, error?: string }
 */

interface ProbeBody {
  ats: ATSType;
  boardToken: string;
  workdayHost?: string;
  workdaySite?: string;
}

async function probeJobCount(body: ProbeBody): Promise<{ ok: true; jobCount: number } | { ok: false; error: string }> {
  const ctrl = AbortSignal.timeout(8000);
  try {
    if (body.ats === 'greenhouse') {
      const url = `https://boards-api.greenhouse.io/v1/boards/${body.boardToken}/jobs`;
      const res = await fetch(url, { signal: ctrl });
      if (!res.ok) return { ok: false, error: `Greenhouse: HTTP ${res.status}` };
      const data = await res.json();
      return { ok: true, jobCount: Array.isArray(data.jobs) ? data.jobs.length : 0 };
    }
    if (body.ats === 'lever') {
      const url = `https://api.lever.co/v0/postings/${body.boardToken}?mode=json`;
      const res = await fetch(url, { signal: ctrl });
      if (!res.ok) return { ok: false, error: `Lever: HTTP ${res.status}` };
      const data = await res.json();
      return { ok: true, jobCount: Array.isArray(data) ? data.length : 0 };
    }
    if (body.ats === 'ashby') {
      const url = `https://api.ashbyhq.com/posting-api/job-board/${body.boardToken}`;
      const res = await fetch(url, { signal: ctrl });
      if (!res.ok) return { ok: false, error: `Ashby: HTTP ${res.status}` };
      const data = await res.json();
      const count = Array.isArray(data.jobs) ? data.jobs.length :
        Array.isArray(data.postings) ? data.postings.length : 0;
      return { ok: true, jobCount: count };
    }
    if (body.ats === 'workday') {
      if (!body.workdayHost || !body.workdaySite) {
        return { ok: false, error: 'Workday requires both workdayHost and workdaySite.' };
      }
      const url = `https://${body.workdayHost}/wday/cxs/${body.boardToken}/${body.workdaySite}/jobs`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ appliedFacets: {}, limit: 10, offset: 0, searchText: '' }),
        signal: ctrl,
      });
      if (!res.ok) return { ok: false, error: `Workday: HTTP ${res.status}` };
      const data = await res.json();
      return { ok: true, jobCount: data?.total ?? data?.jobPostings?.length ?? 0 };
    }
    // Custom-fetcher ATSes (apple/google/microsoft/amazon/meta/uber/eightfold)
    // don't have a stable single-URL probe — we accept them on faith
    // since the user must already know the company has a careers
    // API of that shape, and surface a "best-effort" message.
    return { ok: true, jobCount: 0 };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Network error' };
  }
}

export async function POST(req: NextRequest) {
  const body = (await req.json()) as ProbeBody;
  if (!body.ats || !body.boardToken) {
    return NextResponse.json({ ok: false, error: 'ats and boardToken are required' }, { status: 400 });
  }
  const result = await probeJobCount(body);
  return NextResponse.json(result);
}
