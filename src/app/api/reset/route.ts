import { NextResponse } from 'next/server';
import { rm } from 'fs/promises';
import path from 'path';

const DATA_DIR = path.join(process.cwd(), 'data');
const DB_PATH = path.join(DATA_DIR, 'db.json');
const RESUME_DIR = path.join(DATA_DIR, 'resume');

/**
 * POST /api/reset
 *
 * Wipes local app state so the user gets a fresh onboarding flow:
 *   - Deletes data/db.json  (next read re-creates it from DEFAULT_DB in lib/db.ts,
 *     which has onboardingComplete: false, no listings, no jobs, no settings).
 *   - Deletes data/resume/  (removes uploaded base-resume.docx / base-resume.pdf
 *     and any tailored outputs that happened to be written there).
 *
 * Client should reload the page after this so the root layout re-evaluates
 * onboardingComplete and hides the sidebar + renders the onboarding wizard at /.
 */
export async function POST() {
  try {
    // `rm` with force:true is a no-op when the path is missing, so we don't
    // need to pre-check existence.
    await rm(DB_PATH, { force: true });
    await rm(RESUME_DIR, { recursive: true, force: true });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('Reset failed:', err);
    return NextResponse.json(
      {
        error: 'Failed to reset app state.',
        details: err instanceof Error ? err.message : String(err),
      },
      { status: 500 }
    );
  }
}
