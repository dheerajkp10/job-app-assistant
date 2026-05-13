import { NextRequest, NextResponse } from 'next/server';
import { writeFile, mkdir, unlink } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import mammoth from 'mammoth';
import { getSettings, updateSettings, clearScoreCache } from '@/lib/db';

const RESUME_DIR = path.join(process.cwd(), 'data', 'resume');

export async function GET() {
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

    // Parse text FIRST — if parsing fails, don't save a bad file
    let text = '';
    if (ext === '.docx') {
      try {
        const result = await mammoth.extractRawText({ buffer });
        text = result.value;
      } catch (err) {
        console.error('DOCX parse error:', err);
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
        // Import pdf-parse's internal module directly to bypass the index.js
        // debug-mode code path that tries to read a non-existent test fixture
        // file on require() (a known issue with pdf-parse@1.1.1).
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
        console.error('PDF parse error:', err);
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

    // Save the file (only after successful parse)
    if (!existsSync(RESUME_DIR)) {
      await mkdir(RESUME_DIR, { recursive: true });
    }
    const filePath = path.join(RESUME_DIR, `base-resume${ext}`);
    await writeFile(filePath, buffer);

    // Delete any file of the OTHER extension so on-disk state matches the
    // active resume. Without this, a prior `.docx` upload would be left
    // stranded after a later `.pdf` upload (or vice versa), and the
    // tailoring editor would silently use the stale doc — producing
    // tailored output that doesn't match the user's current resume.
    const otherExt = ext === '.docx' ? '.pdf' : '.docx';
    const staleFilePath = path.join(RESUME_DIR, `base-resume${otherExt}`);
    await unlink(staleFilePath).catch(() => { /* absent is fine */ });

    // If the resume text actually changed, every cached ATS score is
    // now computed against a stale baseResumeText and no longer
    // represents the user's real fit. Wipe the cache so the dashboard
    // doesn't keep displaying the OLD score (the bug the user hit
    // after running Generate Master Resume → uploading the result:
    // dashboard still showed 57% because cached scores were against
    // the pre-update resume). The listings page auto-scorer re-fills
    // the cache lazily as the user views listings; the response
    // returns `clearedScores` so the UI can show a rescore banner.
    const prevSettings = await getSettings();
    const changed = (prevSettings.baseResumeText ?? '') !== text;
    let clearedScores = 0;
    if (changed) {
      clearedScores = await clearScoreCache();
    }

    await updateSettings({
      baseResumeFileName: file.name,
      baseResumeText: text,
    });

    return NextResponse.json({ fileName: file.name, text, clearedScores });
  } catch (err) {
    console.error('Resume upload unexpected error:', err);
    return NextResponse.json(
      {
        error: 'Unexpected error while uploading resume.',
        details: err instanceof Error ? err.message : String(err),
      },
      { status: 500 }
    );
  }
}
