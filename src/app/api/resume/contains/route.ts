/**
 * POST /api/resume/contains
 *
 * Body: { keywords: string[] }
 * Returns: { present: string[] }  — subset of `keywords` already
 *           mentioned in the active resume.
 *
 * Powers the dashboard's per-category "Improve" popover. Each catalog
 * group (Cloud + Infra, Frameworks, Data infrastructure, …) ships a
 * curated list of keywords; the popover used to show every item as
 * "missing" even when the user's resume already had Postgres / Kafka /
 * Airflow / etc. This endpoint lets the client filter the catalog
 * against the live resume using the *same* tolerant + alias-aware
 * comparison the scorer uses, so chips for keywords already on the
 * resume render as "✓ on resume" instead of staging targets.
 *
 * Why server-side: the resume text lives in settings.baseResumeText.
 * Shipping it to the client would mean every dashboard load downloads
 * ~50KB of resume prose. POSTing a small keyword list and getting a
 * small present-list back is cheaper and keeps the canonical
 * resumeMentions logic on one side of the wire.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getSettings } from '@/lib/db';
import { resumeMentions } from '@/lib/keyword-dedup';

export async function POST(req: NextRequest) {
  let body: { keywords?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  const keywords = Array.isArray(body.keywords)
    ? body.keywords.filter((k): k is string => typeof k === 'string')
    : null;
  if (!keywords) {
    return NextResponse.json({ error: 'Missing keywords[] in body' }, { status: 400 });
  }

  const settings = await getSettings();
  const resumeText = settings.baseResumeText ?? '';
  if (!resumeText) {
    // No active resume — nothing is present. Return empty rather than
    // erroring so the client can render the catalog as "all missing".
    return NextResponse.json({ present: [] });
  }

  const present = keywords.filter((k) => resumeMentions(resumeText, k));
  return NextResponse.json({ present });
}
