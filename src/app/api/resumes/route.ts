import { NextRequest, NextResponse } from 'next/server';
import { unlink } from 'fs/promises';
import { join } from 'path';
import {
  listResumes,
  setActiveResume,
  deleteResume,
  updateResumeMeta,
  clearScoreCache,
  getSettings,
} from '@/lib/db';

const RESUME_DIR = join(process.cwd(), 'data', 'resume');

/**
 * Resume library management.
 *
 *   GET    /api/resumes                       → { resumes, activeId }
 *   PATCH  /api/resumes  body:{ id, name }    → rename a resume
 *   POST   /api/resumes/active  body:{ id }   → switch the active resume
 *   DELETE /api/resumes?id=<id>               → delete a resume + its
 *                                                on-disk files
 *
 * (The actual upload lives at /api/resume — singular — to match the
 *  pre-existing endpoint shape.)
 */
export async function GET() {
  const { resumes, activeId } = await listResumes();
  return NextResponse.json({ resumes, activeId });
}

export async function PATCH(req: NextRequest) {
  const { id, name } = await req.json();
  if (!id || typeof id !== 'string') {
    return NextResponse.json({ error: 'id is required' }, { status: 400 });
  }
  if (typeof name !== 'string' || !name.trim()) {
    return NextResponse.json({ error: 'name is required' }, { status: 400 });
  }
  const updated = await updateResumeMeta(id, { name: name.trim() });
  if (!updated) return NextResponse.json({ error: 'Resume not found' }, { status: 404 });
  return NextResponse.json({ resume: updated });
}

export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id query param is required' }, { status: 400 });
  // Safety: refuse to delete the only resume — leaves the app in
  // an inconsistent state (active points at nothing + tailor flows
  // start surfacing 'no resume' errors). User can re-upload to
  // replace.
  const before = await listResumes();
  if (before.resumes.length <= 1) {
    return NextResponse.json(
      {
        error:
          'Cannot delete your only resume. Upload another one first, then delete this one.',
      },
      { status: 400 },
    );
  }
  const wasActive = before.activeId === id;
  const ok = await deleteResume(id);
  if (!ok) return NextResponse.json({ error: 'Resume not found' }, { status: 404 });
  // Drop on-disk files. Both .docx and .pdf to cover either path.
  await unlink(join(RESUME_DIR, `${id}.docx`)).catch(() => {});
  await unlink(join(RESUME_DIR, `${id}.pdf`)).catch(() => {});
  // Removing the active resume changes the active resume — wipe the
  // score cache since scores were computed against the deleted one.
  let clearedScores = 0;
  if (wasActive) clearedScores = await clearScoreCache();
  const after = await listResumes();
  return NextResponse.json({
    deleted: id,
    activeId: after.activeId,
    clearedScores,
  });
}
