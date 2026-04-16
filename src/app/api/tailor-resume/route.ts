import { NextRequest, NextResponse } from 'next/server';
import { getSettings, getListingById } from '@/lib/db';
import { fetchJobDetail } from '@/lib/job-fetcher';
import { tailorResume, buildSummaryPhrase } from '@/lib/resume-tailor';
import { editDocxTemplate, adjustDocxForLibreOffice } from '@/lib/docx-editor';
import { extractKeywords, scoreResume } from '@/lib/ats-scorer';
import { execFile } from 'child_process';
import { writeFile, readFile, unlink } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';

/**
 * POST /api/tailor-resume
 * Body: { listingId: string, format?: 'json' | 'pdf', selectedKeywords?: string[] }
 * Tailors the user's resume for a specific job listing.
 * format=json  → returns analysis + tailored text
 * format=pdf   → returns downloadable PDF (via docx template editing + LibreOffice conversion)
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

  // ─── PDF generation: edit the original docx template, convert via LibreOffice ───

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

  // 2. Edit the docx template
  const docxResult = await editDocxTemplate(missing, summaryPhrase);

  // 3. Validate: extract text from modified docx and re-score
  const modifiedText = await extractDocxText(docxResult.buffer);
  const modifiedScore = scoreResume(modifiedText, detail.content);
  const originalScore = scoreResume(settings.baseResumeText, detail.content);

  if (modifiedScore.overall < originalScore.overall) {
    // Guardrail failed — serve original template as PDF instead
    console.warn('Tailored docx scored lower — serving original template');
    const origTemplate = await readFile(join(process.cwd(), 'data', 'resume', 'template.docx'));
    const adjusted = await adjustDocxForLibreOffice(origTemplate);
    const pdfBuffer = await convertDocxToPdf(adjusted);
    return servePdf(pdfBuffer, settings.userName || 'Resume', listing.company, listing.title);
  }

  // 4. Adjust margins for LibreOffice rendering, then convert to PDF
  const adjustedDocx = await adjustDocxForLibreOffice(docxResult.buffer);
  const pdfBuffer = await convertDocxToPdf(adjustedDocx);

  // 5. Validate PDF page count (must be 1 page)
  const pageCount = countPdfPages(pdfBuffer);
  if (pageCount > 1) {
    console.warn(`Tailored PDF has ${pageCount} pages — serving original template`);
    const origTemplate = await readFile(join(process.cwd(), 'data', 'resume', 'template.docx'));
    const adjustedOrig = await adjustDocxForLibreOffice(origTemplate);
    const origPdf = await convertDocxToPdf(adjustedOrig);
    return servePdf(origPdf, settings.userName || 'Resume', listing.company, listing.title);
  }

  return servePdf(pdfBuffer, settings.userName || 'Resume', listing.company, listing.title);
}

// ─── Helper: serve PDF response ─────────────────────────────────────

function servePdf(pdfBuffer: Buffer, userName: string, company: string, title: string) {
  const safeName = `${userName}_${company}_${title}`
    .replace(/[^a-zA-Z0-9_\- ]/g, '')
    .replace(/\s+/g, '_')
    .slice(0, 80);

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
