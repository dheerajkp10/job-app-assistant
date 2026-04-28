import { NextRequest, NextResponse } from 'next/server';
import { readDb, saveScore } from '@/lib/db';
import { fetchJobDetail } from '@/lib/job-fetcher';
import { extractKeywords, scoreResume } from '@/lib/ats-scorer';
import { buildSummaryPhrase } from '@/lib/resume-tailor';
import { editDocxTemplate, adjustDocxForLibreOffice, resolveDocxTemplate } from '@/lib/docx-editor';
import { execFile } from 'child_process';
import { writeFile, readFile, unlink } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';
import type { JobListing } from '@/lib/types';

type Category = 'technical' | 'management' | 'domain' | 'soft';

interface AggregatedKeyword {
  keyword: string;
  category: Category;
  frequency: number;    // how many of the top jobs reference this keyword
  jobTitles: string[];  // titles of the jobs that mention it (truncated for UI)
}

/**
 * POST /api/tailor-resume/multi
 * Body: { listingIds: string[], selectedKeywords?: string[], format?: 'analyze' | 'pdf' | 'docx' }
 *
 * analyze (default):
 *   - Fetches each listing's detail, extracts JD keywords, diffs against the
 *     user's resume.
 *   - Returns the UNION of missing keywords across the top jobs, ranked by
 *     frequency (keywords demanded by more of the top jobs come first).
 *
 * pdf / docx:
 *   - Takes the user-selected keywords, applies a category budget so the
 *     rendered output stays on a single page, injects them into the docx
 *     template via the same editor used by /api/tailor-resume, and returns
 *     either the rendered PDF or the edited .docx source.
 *   - Page-count validation is always done against the LibreOffice PDF
 *     render regardless of the requested format, so the .docx download
 *     the user re-uploads is guaranteed to render as a 1-page document
 *     (when any budget tier fits).
 *   - Keywords are APPENDED to their appropriate skills section; no
 *     original content is ever removed.
 *   - If every budget tier overflows 1 page, we still serve the
 *     best-effort edited version (never the unedited template) so the
 *     user's selected keywords are always preserved.
 */
export async function POST(req: NextRequest) {
  const { listingIds, selectedKeywords, format } = await req.json();

  if (!Array.isArray(listingIds) || listingIds.length === 0) {
    return NextResponse.json({ error: 'listingIds array is required' }, { status: 400 });
  }
  if (listingIds.length > 25) {
    return NextResponse.json({ error: 'At most 25 listings can be tailored at once' }, { status: 400 });
  }

  // Single DB read — settings + listings + score cache come from one 14MB parse.
  const db = await readDb();
  if (!db.settings.baseResumeText) {
    return NextResponse.json(
      { error: 'No resume uploaded. Please upload your resume in Settings first.' },
      { status: 400 }
    );
  }

  const resumeText = db.settings.baseResumeText;
  const userName = db.settings.userName || 'Resume';

  const listingIndex = new Map<string, JobListing>();
  for (const l of db.listingsCache.listings) listingIndex.set(l.id, l);

  const resumeKeywordSet = extractKeywords(resumeText);

  // Fetch each listing's full description in parallel (small batches to avoid hammering).
  const details: { listing: JobListing; content: string }[] = [];
  const errors: string[] = [];
  const BATCH = 5;
  for (let i = 0; i < listingIds.length; i += BATCH) {
    const chunk = listingIds.slice(i, i + BATCH);
    const results = await Promise.allSettled(
      chunk.map(async (id: string) => {
        const listing = listingIndex.get(id);
        if (!listing) { errors.push(`${id}: not found`); return null; }
        const detail = await fetchJobDetail(listing);
        if (!detail) { errors.push(`${id}: could not fetch details`); return null; }
        return { listing, content: detail.content };
      })
    );
    for (const r of results) {
      if (r.status === 'fulfilled' && r.value) details.push(r.value);
      else if (r.status === 'rejected') errors.push(r.reason?.message || 'Unknown error');
    }
  }

  if (details.length === 0) {
    return NextResponse.json(
      { error: 'Could not fetch any of the selected listings', errors },
      { status: 500 }
    );
  }

  // Aggregate missing keywords across the jobs.
  const aggregated = new Map<string, AggregatedKeyword>();
  const perJobScores: number[] = [];

  for (const { listing, content } of details) {
    const score = scoreResume(resumeText, content);
    perJobScores.push(score.overall);

    // Persist each job's score so the dashboard cache stays warm.
    await saveScore({
      listingId: listing.id,
      overall: score.overall,
      technical: score.technical,
      management: score.management,
      domain: score.domain,
      soft: score.soft,
      matchedCount: score.totalMatched,
      totalCount: score.totalJdKeywords,
      scoredAt: new Date().toISOString(),
    }).catch(() => {});

    const jdKeywords = extractKeywords(content);
    for (const [keyword, category] of jdKeywords) {
      if (resumeKeywordSet.has(keyword)) continue; // already in resume — not missing
      const existing = aggregated.get(keyword);
      if (existing) {
        existing.frequency += 1;
        if (existing.jobTitles.length < 5) existing.jobTitles.push(listing.title);
      } else {
        aggregated.set(keyword, {
          keyword,
          category,
          frequency: 1,
          jobTitles: [listing.title],
        });
      }
    }
  }

  const missingKeywords = Array.from(aggregated.values()).sort((a, b) => {
    if (b.frequency !== a.frequency) return b.frequency - a.frequency;
    const pri: Record<Category, number> = { technical: 0, management: 1, domain: 2, soft: 3 };
    if (pri[a.category] !== pri[b.category]) return pri[a.category] - pri[b.category];
    return a.keyword.localeCompare(b.keyword);
  });

  const avgOriginalScore = perJobScores.length
    ? Math.round(perJobScores.reduce((a, b) => a + b, 0) / perJobScores.length)
    : 0;

  // ─── Analyze mode: just return the aggregated data ──────────────────
  if (!format || format === 'analyze') {
    return NextResponse.json({
      missingKeywords,
      avgOriginalScore,
      jobsAnalyzed: details.length,
      jobsRequested: listingIds.length,
      errors,
    });
  }

  // ─── PDF / DOCX mode ────────────────────────────────────────────────
  if (format === 'pdf' || format === 'docx') {
    if (!Array.isArray(selectedKeywords) || selectedKeywords.length === 0) {
      return NextResponse.json({ error: 'selectedKeywords is required for pdf format' }, { status: 400 });
    }

    // Upfront check: we need a .docx of the *active* resume (the one
    // shown in Settings). The Word-XML editor can't operate on a PDF,
    // and we must not silently use a stale docx left over from a prior
    // upload — that would produce a tailored output whose content
    // differs from the user's real resume.
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

    // Keep the selected keywords in frequency order, then split by category.
    // freq ordering is important because if the page-length check trips we
    // start trimming from the tail (lowest frequency), so the highest-impact
    // keywords survive.
    const selectedSet = new Set(selectedKeywords as string[]);
    const byCategory: Record<Category, string[]> = { technical: [], management: [], domain: [], soft: [] };
    for (const kw of missingKeywords) {
      if (!selectedSet.has(kw.keyword)) continue;
      byCategory[kw.category].push(kw.keyword);
    }

    // Budget ladder for one-page fit. Each tier specifies both Skills
    // caps and work-experience injector caps (wePositions, weKwPerBullet).
    //
    // Ordering is WE-forward: the top tiers keep work-experience
    // injection on at the expense of max-Skills stuffing, because WE
    // injection is the primary new feature we're trying to land — an
    // uber-packed Skills line with no WE bullet is worse than a
    // moderately-packed Skills line with a new WE bullet under a
    // relevant position.
    //
    // Only the tail tiers drop WE entirely — they exist so the 1-page
    // hard guarantee still holds on resumes that are already near the
    // page limit before tailoring.
    type Budget = Record<Category, number> & {
      wePositions: number;
      weKwPerBullet: number;
      /** Inline-append pass: attaches short keyword clauses to
       *  existing bullets whose final rendered line has trailing
       *  whitespace. Costs 0 lines, so we enable it on every tier. */
      weInlineAppends: number;
    };
    const attempts: Budget[] = [
      // ── WE-enabled tiers ──────────────────────────────────
      // Tier 1 — up to 3 new bullets (2 kw each), moderate Skills
      { technical: 6, management: 4, domain: 3, soft: 2, wePositions: 3, weKwPerBullet: 2, weInlineAppends: 4 },
      // Tier 2 — up to 2 new bullets (2 kw each), moderate Skills
      { technical: 5, management: 3, domain: 2, soft: 2, wePositions: 2, weKwPerBullet: 2, weInlineAppends: 3 },
      // Tier 3 — up to 2 new bullets (1 kw each), tighter Skills
      { technical: 4, management: 3, domain: 2, soft: 1, wePositions: 2, weKwPerBullet: 1, weInlineAppends: 3 },
      // Tier 4 — 1 new bullet (2 kw), tight Skills
      { technical: 3, management: 2, domain: 2, soft: 1, wePositions: 1, weKwPerBullet: 2, weInlineAppends: 3 },
      // Tier 5 — 1 new bullet (1 kw), tight Skills
      { technical: 3, management: 2, domain: 1, soft: 1, wePositions: 1, weKwPerBullet: 1, weInlineAppends: 2 },
      // ── No-WE fallback tiers (inline-append still on — it's free) ─
      { technical: 8, management: 5, domain: 3, soft: 2, wePositions: 0, weKwPerBullet: 0, weInlineAppends: 4 },
      { technical: 5, management: 3, domain: 2, soft: 1, wePositions: 0, weKwPerBullet: 0, weInlineAppends: 3 },
      { technical: 3, management: 2, domain: 1, soft: 1, wePositions: 0, weKwPerBullet: 0, weInlineAppends: 2 },
      { technical: 2, management: 1, domain: 1, soft: 0, wePositions: 0, weKwPerBullet: 0, weInlineAppends: 2 },
    ];

    // Apples-to-apples baseline: score the ORIGINAL docx text (same
    // extraction path modifiedScore will use). Previously we compared
    // against settings.baseResumeText, but that comes from whichever file
    // the user last uploaded (possibly the PDF), while the modified text
    // comes from the docx extraction — two different documents producing
    // two incompatible numbers. That false regression was causing every
    // attempt to "fail" and the route to fall back to the unedited
    // template, which looked to the user like the selected keywords were
    // silently dropped AND that content went missing from the resume.
    const origDocxBytes = await readFile(templatePath);
    const origDocxText = await extractDocxText(origDocxBytes);
    const jdCorpus = allJobsCorpus(details);
    const originalScore = scoreResume(origDocxText, jdCorpus);

    let bestResult: GenerationResult | null = null;

    try {
      for (let i = 0; i < attempts.length; i++) {
        const budget = attempts[i];
        const result = await tryGenerate({ byCategory, budget, jdCorpus });

        // Track the best-so-far: prefer a version that fits on 1 page, and
        // among those (or among overflow candidates), the one with the
        // highest score. This guarantees we never serve worse than our
        // best attempt, even if every attempt overflows 1 page.
        if (!bestResult || isBetter(result, bestResult)) bestResult = result;

        // Accept the first attempt that fits in 1 page. Because we only
        // APPEND (never remove) content, modifiedScore is always >=
        // originalScore when measured consistently — so no score-regression
        // gate is needed here.
        if (result.pageCount <= 1) {
          // eslint-disable-next-line no-console
          console.log(
            `Multi-tailor: tier ${i + 1}/${attempts.length} fit 1 page. ` +
            `Budget: tech=${budget.technical} mgmt=${budget.management} dom=${budget.domain} soft=${budget.soft} ` +
            `WE=${budget.wePositions}pos×${budget.weKwPerBullet}kw. ` +
            `Added: ${result.addedWeBullets} new work-experience bullet(s). ` +
            `Score: ${result.modifiedScore}% (baseline ${originalScore.overall}%)`
          );
          return serveTailored(result, format, userName, details.length);
        }
      }

      // Every attempt overflowed 1 page. Serving the unedited baseline
      // here would silently drop every keyword the user selected —
      // which the user explicitly flagged as a CRITICAL bug. The
      // 1-page constraint is now best-effort: we always serve the
      // edited version closest to 1 page with the highest ATS score
      // (see isBetter()), never the untouched baseline.
      if (!bestResult) {
        // Defensive fallback — attempts is non-empty, so bestResult
        // should always be populated here.
        if (format === 'docx') return serveDocx(origDocxBytes, userName, details.length);
        const adjustedOrig = await adjustDocxForLibreOffice(origDocxBytes);
        const origPdf = await convertDocxToPdf(adjustedOrig);
        return servePdf(origPdf, userName, details.length);
      }
      // eslint-disable-next-line no-console
      console.warn(
        `Multi-tailor: no budget tier fit 1 page after ${attempts.length} tries. ` +
        `Serving best-effort edited: ${bestResult.pageCount} pages, ` +
        `score ${bestResult.modifiedScore}% vs original ${originalScore.overall}%.`
      );
      return serveTailored(bestResult, format, userName, details.length);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('Multi-tailor generation failed:', err);
      return NextResponse.json(
        {
          error:
            err instanceof Error
              ? `Couldn't generate tailored resume: ${err.message}`
              : 'Couldn\'t generate tailored resume.',
        },
        { status: 500 }
      );
    }
  }

  return NextResponse.json({ error: `Unknown format: ${format}` }, { status: 400 });
}

// ─── Generation attempt ─────────────────────────────────────────────

interface GenerationResult {
  /** The edited .docx buffer (the user downloads this if format=docx). */
  docx: Buffer;
  /** The LibreOffice-rendered PDF of the edited .docx. Always generated
   *  so we can validate page count even when the user asked for docx. */
  pdf: Buffer;
  pageCount: number;
  modifiedScore: number;
  /** Number of new bullets added to the Work Experience section at
   *  this budget tier. Included in the tier-win log so we can confirm
   *  at-a-glance that WE injection is happening. */
  addedWeBullets: number;
}

type BudgetWithWE = Record<Category, number> & {
  wePositions: number;
  weKwPerBullet: number;
  weInlineAppends: number;
};

async function tryGenerate(args: {
  byCategory: Record<Category, string[]>;
  budget: BudgetWithWE;
  jdCorpus: string;
}): Promise<GenerationResult> {
  const { byCategory, budget, jdCorpus } = args;

  // Apply budget — keep the top N by frequency (list is already frequency-ordered).
  const missing: Record<Category, string[]> = {
    technical: byCategory.technical.slice(0, budget.technical),
    management: byCategory.management.slice(0, budget.management),
    domain: byCategory.domain.slice(0, budget.domain),
    soft: byCategory.soft.slice(0, budget.soft),
  };

  // Build a natural summary phrase from a tight set of domain + soft keywords.
  // Max 3 domains + 2 softs keeps the phrase to one sentence — prevents the
  // summary paragraph from wrapping and pushing the resume to 2 pages.
  const summaryPhrase = buildSummaryPhrase(
    missing.domain.slice(0, 3),
    missing.soft.slice(0, 2)
  );

  const docxResult = await editDocxTemplate(missing, summaryPhrase, {
    jdContent: jdCorpus,
    workExpBudget: {
      maxPositions: budget.wePositions,
      maxKeywordsPerBullet: budget.weKwPerBullet,
      maxInlineAppends: budget.weInlineAppends,
    },
  });

  // Count WE bullets we actually inserted at this tier — the editor
  // reports each injection as one "Added bullet under ..." line in
  // changesSummary, so counting those gives us the exact number
  // without making the editor return it as structured data.
  const addedWeBullets = docxResult.changesSummary.filter((s) =>
    s.startsWith('Added bullet under'),
  ).length;

  // Re-extract the edited docx text and score it (same extraction path used
  // for the baseline, so comparison is apples-to-apples).
  const modifiedText = await extractDocxText(docxResult.buffer);
  const modifiedScore = scoreResume(modifiedText, jdCorpus).overall;

  // Generate PDF. The edited .docx that we ship to the user does NOT
  // include the LibreOffice-specific spacing adjustments — those tweak
  // the docx to compensate for LibreOffice's font metrics when we
  // convert it to PDF on the server, and would look wrong if the user
  // re-opened the docx in Word.
  const adjusted = await adjustDocxForLibreOffice(docxResult.buffer);
  const pdf = await convertDocxToPdf(adjusted);
  const pageCount = countPdfPages(pdf);

  return { docx: docxResult.buffer, pdf, pageCount, modifiedScore, addedWeBullets };
}

/**
 * Pick the best of two attempts: prefer 1-page fit, then highest score.
 * Used when every attempt overflows — we still need to serve *something*.
 */
function isBetter(a: GenerationResult, b: GenerationResult): boolean {
  const aFits = a.pageCount <= 1;
  const bFits = b.pageCount <= 1;
  if (aFits !== bFits) return aFits;            // 1-pager wins
  if (a.pageCount !== b.pageCount) return a.pageCount < b.pageCount; // fewer pages
  return a.modifiedScore > b.modifiedScore;     // higher score
}

/**
 * Concatenate every top-job JD into one corpus. Used for the score-regression
 * guardrail so we can check "did we improve against the jobs the user is
 * actually targeting" rather than against any single listing.
 */
function allJobsCorpus(details: { content: string }[]): string {
  return details.map((d) => d.content).join('\n\n');
}

// ─── Helpers ────────────────────────────────────────────────────────

function safeBaseName(userName: string, numJobs: number): string {
  return `${userName}_Top${numJobs}Jobs_Tailored`
    .replace(/[^a-zA-Z0-9_\- ]/g, '')
    .replace(/\s+/g, '_')
    .slice(0, 80);
}

function serveTailored(
  result: GenerationResult,
  format: 'pdf' | 'docx',
  userName: string,
  numJobs: number
): NextResponse {
  return format === 'docx'
    ? serveDocx(result.docx, userName, numJobs)
    : servePdf(result.pdf, userName, numJobs);
}

function servePdf(pdfBuffer: Buffer, userName: string, numJobs: number): NextResponse {
  const safeName = safeBaseName(userName, numJobs);
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

function serveDocx(docxBuffer: Buffer, userName: string, numJobs: number): NextResponse {
  const safeName = safeBaseName(userName, numJobs);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return new NextResponse(docxBuffer as any, {
    status: 200,
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'Content-Disposition': `attachment; filename="${safeName}.docx"`,
      'Content-Length': String(docxBuffer.length),
    },
  });
}

async function extractDocxText(docxBuffer: Buffer): Promise<string> {
  const JSZip = (await import('jszip')).default;
  const zip = await JSZip.loadAsync(docxBuffer);
  const docXml = await zip.file('word/document.xml')?.async('string');
  if (!docXml) return '';
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

function countPdfPages(pdfBuffer: Buffer): number {
  const text = pdfBuffer.toString('latin1');
  const matches = text.match(/\/Type\s*\/Page[^s]/g);
  return matches ? matches.length : 1;
}

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
    return await readFile(pdfPath);
  } finally {
    await unlink(docxPath).catch(() => {});
    await unlink(pdfPath).catch(() => {});
    const { rmdir } = await import('fs/promises');
    await rmdir(tmpDir).catch(() => {});
  }
}
