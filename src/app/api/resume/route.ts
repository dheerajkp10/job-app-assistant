import { NextRequest, NextResponse } from 'next/server';
import { writeFile, mkdir, unlink } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import mammoth from 'mammoth';
import {
  getSettings,
  updateSettings,
  clearScoreCache,
  addResume,
  updateResumeMeta,
  setActiveResume,
  listResumes,
} from '@/lib/db';

const RESUME_DIR = path.join(process.cwd(), 'data', 'resume');

/**
 * POST /api/resume
 *
 * Modes:
 *   1. No `resumeId` query param → adds a NEW resume to the
 *      library. First resume of all time also becomes the active.
 *   2. `?resumeId=<id>` → REPLACES the file + extracted text on the
 *      existing resume keyed by that id (e.g. user re-uploads an
 *      improved version of their EM resume). If the replaced resume
 *      is the active one, the score cache is wiped.
 *
 * Body: multipart/form-data with `file` (.docx or .pdf). Optional
 * `name` form field to override the resume's display label.
 *
 * Response includes `{ resumeId, fileName, text, isActive, clearedScores }`.
 */
export async function GET() {
  // Back-compat: legacy clients want fileName + text of the active.
  const settings = await getSettings();
  return NextResponse.json({
    fileName: settings.baseResumeFileName,
    text: settings.baseResumeText,
  });
}

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get('file') as File | null;
    const explicitName = (formData.get('name') as string | null)?.trim() ?? null;
    const replaceId = req.nextUrl.searchParams.get('resumeId');

    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const ext = path.extname(file.name).toLowerCase();
    if (ext !== '.docx' && ext !== '.pdf') {
      return NextResponse.json(
        { error: 'Only .docx and .pdf files are supported' },
        { status: 400 }
      );
    }

    // Parse text FIRST — if parsing fails, don't save a bad file.
    let text = '';
    if (ext === '.docx') {
      try {
        const result = await mammoth.extractRawText({ buffer });
        text = result.value;
      } catch (err) {
        return NextResponse.json(
          {
            error: 'Failed to parse DOCX file. It may be corrupt or password-protected.',
            details: err instanceof Error ? err.message : String(err),
          },
          { status: 400 }
        );
      }
    } else {
      try {
        // Bypass pdf-parse's index.js debug code path (known issue
        // with pdf-parse@1.1.1 trying to read a missing test
        // fixture on require()).
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const pdfParse = require('pdf-parse/lib/pdf-parse.js');
        const data = await pdfParse(buffer);
        text = data.text || '';
        if (!text.trim()) {
          return NextResponse.json(
            {
              error:
                'No text could be extracted from the PDF. It may be a scanned/image-only PDF. Please upload a text-based PDF or a .docx file instead.',
            },
            { status: 400 }
          );
        }
      } catch (err) {
        return NextResponse.json(
          {
            error:
              'Failed to parse PDF file. It may be corrupt, encrypted, or an image-only scan. Try exporting as .docx instead.',
            details: err instanceof Error ? err.message : String(err),
          },
          { status: 400 }
        );
      }
    }

    if (!existsSync(RESUME_DIR)) await mkdir(RESUME_DIR, { recursive: true });

    // Resolve the resume id (existing for replace, new for add).
    let resumeId: string;
    let isReplace = false;
    const existing = await listResumes();
    if (replaceId && existing.resumes.some((r) => r.id === replaceId)) {
      resumeId = replaceId;
      isReplace = true;
    } else {
      // New resume id — short timestamp-based prefix is plenty unique
      // for a single-user local app.
      resumeId = `r-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    }

    const filePath = path.join(RESUME_DIR, `${resumeId}${ext}`);
    await writeFile(filePath, buffer);

    // Remove any file of the OTHER extension for this id so the
    // tailor pipeline doesn't pick up a stale doc when the user
    // swaps a .pdf for a .docx (or vice versa) under the same id.
    const otherExt = ext === '.docx' ? '.pdf' : '.docx';
    await unlink(path.join(RESUME_DIR, `${resumeId}${otherExt}`)).catch(() => { /* ok */ });
    // Also remove any leftover legacy single-file artifact when this
    // is the FIRST upload on a fresh install (before the legacy file
    // ever existed) — no-op in normal cases.
    await unlink(path.join(RESUME_DIR, `base-resume${otherExt}`)).catch(() => { /* ok */ });

    // Decide whether the score cache should be cleared. Caches are
    // keyed by listingId and were computed against the previously-
    // active resume's text — clear if the new upload BECOMES the
    // active resume AND its text differs from the previous active.
    const prevSettings = await getSettings();
    const prevActiveText = prevSettings.baseResumeText ?? '';
    const willBecomeActive =
      isReplace
        ? prevSettings.activeResumeId === resumeId
        // First-ever resume becomes active by default (see addResume);
        // subsequent additions don't auto-switch.
        : !prevSettings.activeResumeId;
    let clearedScores = 0;
    if (willBecomeActive && prevActiveText !== text) {
      clearedScores = await clearScoreCache();
    }

    // Persist the library entry.
    const friendlyName = explicitName || (isReplace
      ? existing.resumes.find((r) => r.id === resumeId)!.name
      : `Resume ${(existing.resumes.length + 1)}`);

    if (isReplace) {
      await updateResumeMeta(resumeId, { fileName: file.name, text });
    } else {
      await addResume({
        id: resumeId,
        name: friendlyName,
        fileName: file.name,
        text,
        addedAt: new Date().toISOString(),
      });
    }

    // Mirror the active-resume legacy fields when needed.
    if (willBecomeActive) {
      // addResume already sets active for the first-ever upload,
      // but call setActiveResume defensively to keep legacy fields
      // in sync for replace-into-active flows.
      await setActiveResume(resumeId);
    } else if (isReplace && prevSettings.activeResumeId === resumeId) {
      // Replacing the active one but text unchanged — still sync.
      await updateSettings({ baseResumeText: text, baseResumeFileName: file.name });
    }

    return NextResponse.json({
      resumeId,
      fileName: file.name,
      text,
      name: friendlyName,
      isActive: willBecomeActive || prevSettings.activeResumeId === resumeId,
      clearedScores,
    });
  } catch (err) {
    return NextResponse.json(
      {
        error: 'Unexpected error while uploading resume.',
        details: err instanceof Error ? err.message : String(err),
      },
      { status: 500 }
    );
  }
}
