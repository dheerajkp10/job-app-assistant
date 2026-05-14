import { NextRequest, NextResponse } from 'next/server';
import { setActiveResume, clearScoreCache, getSettings } from '@/lib/db';

/**
 * POST /api/resumes/active  body:{ id }
 *
 * Switches which resume the app treats as active for scoring +
 * tailoring. Wipes the ATS score cache because cached scores were
 * computed against the previously-active resume's text. The
 * dashboard surfaces a Rescore banner once the cache is empty so
 * the user can refill it against the new active resume.
 */
export async function POST(req: NextRequest) {
  const { id } = await req.json();
  if (!id || typeof id !== 'string') {
    return NextResponse.json({ error: 'id is required' }, { status: 400 });
  }
  const prev = await getSettings();
  if (prev.activeResumeId === id) {
    return NextResponse.json({ activeId: id, clearedScores: 0 });
  }
  const active = await setActiveResume(id);
  if (!active) {
    return NextResponse.json({ error: 'Resume not found' }, { status: 404 });
  }
  const clearedScores = await clearScoreCache();
  return NextResponse.json({ activeId: active.id, clearedScores });
}
