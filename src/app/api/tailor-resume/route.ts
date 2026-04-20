import { NextRequest, NextResponse } from 'next/server';
import { getSettings, getListingById } from '@/lib/db';
import { fetchJobDetail } from '@/lib/job-fetcher';
import { tailorResume, buildSummaryPhrase } from '@/lib/resume-tailor';
import { editDocxTemplate, adjustDocxForLibreOffice, resolveDocxTemplate } from '@/lib/docx-editor';
import { extractKeywords, scoreResume } from '@/lib/ats-scorer';
import { execFile } from 'child_process';
import { writeFile, readFile, unlink } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';

/**
 * POST /api/tailor-resume
 * Body: { listingId: string, format?: 'json' | 'pdf' | 'docx', selectedKeywords?: string[] }
 * Tailors the user's resume for a specific job listing.
 * format=json  → returns analysis + tailored text
 * format=pdf   → returns downloadable PDF (via docx template editing + LibreOffice conversion)
 * format=docx  → returns the edited .docx (so the user can re-upload it to Settings,
 *                edit it further in Word, or feed it through their own tooling)
 * selectedKeywords → optional list of keywords to use (user can deselect some)
 */
export async function POST(req: NextRequest) {
  const { listingId, format, selectedKeywords } = await req.json();

  if (!listingId) {
    return NextResponse.json({ error: 'listingId is required' }, { status: 400 });
  }

  const settings = await getSettings();
  if (!settings.baseResumeText) {
    return NextResponse.json(
      { error: 'No resume uploaded. Please upload your resume in Settings first.' },
      { status: 400 }
    );
  }

  const listing = await getListingById(listingId);
  if (!listing) {
    return NextResponse.json({ error: 'Listing not found' }, { status: 404 });
  }

  const detail = await fetchJobDetail(listing);
  if (!detail) {
    return NextResponse.json({ error: 'Could not fetch job details' }, { status: 500 });
  }

  // Run text-based tailoring analysis (keyword extraction + scoring)
  const result = tailorResume(
    settings.baseResumeText,
    detail.content,
    listing.title,
    listing.company,
    selectedKeywords as string[] | undefined
  );

  // If format=json, return analysis (for preview)
  if (format === 'json') {
    return NextResponse.json({
      addedKeywords: result.addedKeywords,
      originalScore: result.originalScore,
      tailoredScore: result.tailoredScore,
      changesSummary: result.changesSummary,
      tailoredText: result.text,
    });
  }

  // ─── PDF / DOCX generation: edit the original docx template, optionally render PDF via LibreOffice ───

  // Upfront: we need a .docx of the *active* resume. We must never
  // silently use a stale docx from a prior upload — that would produce
  // output whose content doesn't match the user's real resume.
  const resolution = await resolveDocxTemplate();
  if (resolution.kind === 'pdf-only') {
    return NextResponse.json(
      {
        error:
          `Your current resume (“${resolution.activeName}”) is a PDF. Tailoring requires a Word (.docx) ` +
          `version because the editor modifies Word document XML directly. ` +
          `Please upload a .docx version of this same resume in Settings and try again.`,
      },
      { status: 400 }
    );
  }
  if (resolution.kind === 'missing') {
    return NextResponse.json(
      {
        error:
          'No resume found. Please upload a .docx version of your resume in Settings and try again.',
      },
      { status: 400 }
    );
  }
  const templatePath = resolution.path;

  // 1. Identify missing keywords by category, filtered by user selection
  const jdKeywords = extractKeywords(detail.content);
  const resumeKeywords = extractKeywords(settings.baseResumeText);
  const missing: Record<string, string[]> = { technical: [], management: [], domain: [], soft: [] };
  for (const [keyword, category] of jdKeywords) {
    if (!resumeKeywords.has(keyword)) {
      if (selectedKeywords && !selectedKeywords.includes(keyword)) continue;
      missing[category].push(keyword);
    }
  }

  // Build a cohesive summary phrase (max 4 domain + 2 soft)
  const domainMissing = missing.domain.slice(0, 4);
  const softMissing = missing.soft.slice(0, 2);
  const summaryPhrase = buildSummaryPhrase(domainMissing, softMissing);

  // 2. Edit the docx template (append-only; never removes content)
  const docxResult = await editDocxTemplate(missing, summaryPhrase);

  // 3. Apples-to-apples score check: baseline is the ORIGINAL docx text
  //    (same extraction path as modifiedText), not settings.baseResumeText
  //    which may have come from a PDF and produce incompatible numbers.
  const origDocxBytes = await readFile(templatePath);
  const origDocxText = await extractDocxText(origDocxBytes);
  const modifiedText = await extractDocxText(docxResult.buffer);
  const modifiedScore = scoreResume(modifiedText, detail.content);
  const originalScore = scoreResume(origDocxText, detail.content);

  // 4. Log score/page info (but do NOT fall back to unedited template) —
  //    the editor only appends, so the edited version always contains
  //    the original content plus the selected keywords. Falling back
  //    would silently drop the user's selections.
  if (modifiedScore.overall < originalScore.overall) {
    console.warn(
      `Tailored docx scored lower (${modifiedScore.overall}% vs ${originalScore.overall}%) — ` +
      `serving edited version anyway since content is append-only.`
    );
  }

  // 5. Serve the format the user asked for.
  const userName = settings.userName || 'Resume';
  if (format === 'docx') {
    // The raw edited docx (not the LibreOffice-adjusted version — those
    // spacing tweaks are a LibreOffice-rendering workaround and would
    // look wrong when the user re-opens the docx in Word).
    return serveDocx(docxResult.buffer, userName, listing.company, listing.title);
  }

  // PDF path: apply LibreOffice rendering tweaks, convert, and serve.
  const adjustedDocx = await adjustDocxForLibreOffice(docxResult.buffer);
  const pdfBuffer = await convertDocxToPdf(adjustedDocx);
  const pageCount = countPdfPages(pdfBuffer);
  if (pageCount > 1) {
    console.warn(`Tailored PDF has ${pageCount} pages — serving edited version anyway.`);
  }
  return servePdf(pdfBuffer, userName, listing.company, listing.title);
}

// ─── Helpers: serve PDF / DOCX responses ────────────────────────────

function safeBaseName(userName: string, company: string, title: string): string {
  return `${userName}_${company}_${title}`
    .replace(/[^a-zA-Z0-9_\- ]/g, '')
    .replace(/\s+/g, '_')
    .slice(0, 80);
}

function servePdf(pdfBuffer: Buffer, userName: string, company: string, title: string) {
  const safeName = safeBaseName(userName, company, title);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return new NextResponse(pdfBuffer as any, {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${safeName}.pdf"`,
      'Content-Length': String(pdfBuffer.length),
    },
  });
}

function serveDocx(docxBuffer: Buffer, userName: string, company: string, title: string) {
  const safeName = safeBaseName(userName, company, title);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return new NextResponse(docxBuffer as any, {
    status: 200,
    headers: {
      'Content-Type':
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'Content-Disposition': `attachment; filename="${safeName}.docx"`,
      'Content-Length': String(docxBuffer.length),
    },
  });
}

// ─── Helper: extract plain text from docx for scoring ───────────────

async function extractDocxText(docxBuffer: Buffer): Promise<string> {
  const JSZip = (await import('jszip')).default;
  const zip = await JSZip.loadAsync(docxBuffer);
  const docXml = await zip.file('word/document.xml')?.async('string');
  if (!docXml) return '';
  // Strip XML tags, decode entities
  return docXml
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

// ─── Helper: convert docx to PDF via LibreOffice headless ───────────

async function convertDocxToPdf(docxBuffer: Buffer): Promise<Buffer> {
  const id = randomUUID();
  const tmpDir = join(tmpdir(), `resume_${id}`);
  const docxPath = join(tmpDir, 'resume.docx');
  const pdfPath = join(tmpDir, 'resume.pdf');

  const { mkdir } = await import('fs/promises');
  await mkdir(tmpDir, { recursive: true });

  try {
    await writeFile(docxPath, docxBuffer);

    await new Promise<void>((resolve, reject) => {
      execFile(
        'soffice',
        ['--headless', '--convert-to', 'pdf', '--outdir', tmpDir, docxPath],
        { timeout: 30000 },
        (err) => {
          if (err) reject(new Error(`LibreOffice conversion failed: ${err.message}`));
          else resolve();
        }
      );
    });

    const pdfBuffer = await readFile(pdfPath);
    return pdfBuffer;
  } finally {
    await unlink(docxPath).catch(() => {});
    await unlink(pdfPath).catch(() => {});
    const { rmdir } = await import('fs/promises');
    await rmdir(tmpDir).catch(() => {});
  }
}

// ─── Helper: count PDF pages (from the /Type /Page entries) ─────────

function countPdfPages(pdfBuffer: Buffer): number {
  const text = pdfBuffer.toString('latin1');
  // Count /Type /Page entries (not /Type /Pages)
  const matches = text.match(/\/Type\s*\/Page[^s]/g);
  return matches ? matches.length : 1;
}
