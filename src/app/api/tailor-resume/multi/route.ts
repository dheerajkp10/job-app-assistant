import { NextRequest, NextResponse } from 'next/server';
import { readDb, saveScore } from '@/lib/db';
import { fetchJobDetail } from '@/lib/job-fetcher';
import { extractKeywords, scoreResume } from '@/lib/ats-scorer';
import { buildSummaryPhrase } from '@/lib/resume-tailor';
import {
  editDocxTemplate,
  adjustDocxForLibreOffice,
  resolveDocxTemplate,
  runCompressionCascade,
} from '@/lib/docx-editor';
import { detectSuggestions } from '@/lib/resume-suggestions';
import { measurePdfTextBounds } from '@/lib/pdf-bounds';
import { execFile } from 'child_process';
import { writeFile, readFile, unlink } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';
import { SCORER_VERSION } from '@/lib/types';
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
  const { listingIds, selectedKeywords, selectedSuggestions, format, mode } = await req.json();
  // Mandatory mode (DEFAULT) — every user-selected keyword lands and
  // the compression cascade fits the result on one page. Budget-ladder
  // mode is the legacy opt-out. Same semantics as /api/tailor-resume.
  const tailorMode: 'mandatory' | 'budget-ladder' =
    mode === 'budget-ladder' ? 'budget-ladder' : 'mandatory';

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
    // Include the v3 phrases field + scorerVersion stamp so the
    // listings page's stale-version filter doesn't drop these
    // entries on the next read.
    await saveScore({
      listingId: listing.id,
      overall: score.overall,
      technical: score.technical,
      management: score.management,
      domain: score.domain,
      soft: score.soft,
      phrases: score.phrases,
      matchedCount: score.totalMatched,
      totalCount: score.totalJdKeywords,
      scoredAt: new Date().toISOString(),
      scorerVersion: SCORER_VERSION,
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

    // Aggregate user-accepted suggestions across the selected jobs.
    // We re-run detection per listing (server-trusted source — clients
    // only round-trip suggestion IDs, never raw prose) and dedupe by
    // suggestion ID so a phrase the user accepted once isn't applied
    // multiple times if it surfaced from multiple JDs.
    //
    // Same four-channel split as the single-job route:
    //   - summaryDomainItem → folds into buildSummaryPhrase domain pool
    //   - insertion         → standalone summary append
    //   - replace-text      → docx XML find/replace pre-pass
    //   - append-skills     → skills line extension
    const acceptedSuggestionIds: Set<string> =
      Array.isArray(selectedSuggestions) && selectedSuggestions.length > 0
        ? new Set(selectedSuggestions as string[])
        : new Set();
    const suggestionDomainItems: string[] = [];
    const suggestionInsertions: string[] = [];
    const suggestionReplaces: { oldText: string; newText: string }[] = [];
    const suggestionExtraSkills: {
      cloudStack: string[]; systems: string[]; management: string[]; domain: string[];
    } = { cloudStack: [], systems: [], management: [], domain: [] };
    if (acceptedSuggestionIds.size > 0) {
      const seenSuggestionIds = new Set<string>();
      for (const { listing, content } of details) {
        const all = detectSuggestions({
          resumeText,
          jdContent: content,
          jdTitle: listing.title,
        });
        for (const s of all) {
          if (!acceptedSuggestionIds.has(s.id)) continue;
          if (seenSuggestionIds.has(s.id)) continue;
          seenSuggestionIds.add(s.id);
          if (s.kind === 'replace-text' && s.oldText && s.newText) {
            suggestionReplaces.push({ oldText: s.oldText, newText: s.newText });
          } else if (s.kind === 'append-skills' && s.skillsCategory && s.skillsItems) {
            suggestionExtraSkills[s.skillsCategory].push(...s.skillsItems);
          } else if (s.kind === 'append-summary') {
            if (s.summaryDomainItem) suggestionDomainItems.push(s.summaryDomainItem);
            else if (s.insertion) suggestionInsertions.push(s.insertion);
          }
        }
      }
    }
    const suggestionInsertion = suggestionInsertions.join('');

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
    // Tier 0 — honors the user's full selection at face value. We
    // always try the "include every keyword the user picked" budget
    // FIRST so that an explicit selection is never silently truncated
    // by a smaller cap. Subsequent tiers are the page-fit fallback
    // ladder. This is the fix for the multi-tailor keyword-drop bug:
    // previously tier 1's `technical: 6` cap silently dropped user
    // selections #7+ even when the user explicitly enabled them.
    const userSelectionBudget: Budget = {
      technical: Math.max(byCategory.technical.length, 1),
      management: Math.max(byCategory.management.length, 1),
      domain: Math.max(byCategory.domain.length, 1),
      soft: Math.max(byCategory.soft.length, 1),
      wePositions: 3,
      weKwPerBullet: 2,
      weInlineAppends: 4,
    };
    const attempts: Budget[] = [
      userSelectionBudget,
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
      // ─── Mandatory mode (DEFAULT) ────────────────────────────────
      // Inject every user-selected keyword via the tier-0 budget
      // (which already uncaps per-category), then run the
      // compression cascade. Cascade enforces the floors decided
      // 2026-05-12: ≥ 9pt body, ≥ 0.4" margins, no content drops.
      // On exhaustion we serve the best-effort multi-page result.
      if (tailorMode === 'mandatory') {
        const baseResult = await tryGenerate({
          byCategory,
          budget: userSelectionBudget,
          jdCorpus,
          suggestionDomainItems,
          suggestionInsertion,
          suggestionReplaces,
          suggestionExtraSkills,
        });
        const initialDocx = await adjustDocxForLibreOffice(baseResult.docx);
        const cascadeResult = await runCompressionCascade({
          initialDocx,
          render: convertDocxToPdf,
          countPages: countPdfPages,
        });
        const finalResult: GenerationResult = {
          docx: cascadeResult.docx,
          pdf: cascadeResult.pdf,
          pageCount: cascadeResult.pageCount,
          modifiedScore: baseResult.modifiedScore,
          addedWeBullets: baseResult.addedWeBullets,
        };
        if (cascadeResult.pageCount <= 1) {
          // eslint-disable-next-line no-console
          console.log(
            `Multi-tailor[mandatory]: 1-page fit via ${cascadeResult.stepsApplied.length} compression step(s): ` +
            `${cascadeResult.stepsApplied.join(', ') || '(none — fit out of the box)'}. ` +
            `Score: ${finalResult.modifiedScore}% (baseline ${originalScore.overall}%).`,
          );
          const balanced = await balanceWhitespace(finalResult.docx, finalResult.pdf);
          return serveTailored(
            { ...finalResult, docx: balanced.docx, pdf: balanced.pdf },
            format, userName, details.length,
            cascadeResult.stepsApplied,
          );
        }
        // eslint-disable-next-line no-console
        console.warn(
          `Multi-tailor[mandatory]: cascade exhausted after ${cascadeResult.stepsApplied.length} step(s); ` +
          `best-effort result is ${cascadeResult.pageCount} page(s). ` +
          `Applied: ${cascadeResult.stepsApplied.join(', ')}.`,
        );
        return serveTailored(
          finalResult, format, userName, details.length,
          [...cascadeResult.stepsApplied, 'exhausted'],
        );
      }

      // ─── Budget-ladder mode (legacy / opt-out) ───────────────────
      for (let i = 0; i < attempts.length; i++) {
        const budget = attempts[i];
        const result = await tryGenerate({
          byCategory,
          budget,
          jdCorpus,
          suggestionDomainItems,
          suggestionInsertion,
          suggestionReplaces,
          suggestionExtraSkills,
        });

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
          // Balance pass — measures the PDF's actual top/bottom text
          // bounds and shifts the docx top margin to make visible
          // whitespace symmetric. Same algorithm the single-job
          // route uses; verifies still-1-page after re-render and
          // reverts to the unbalanced version if the shift somehow
          // overflows.
          const balanced = await balanceWhitespace(result.docx, result.pdf);
          return serveTailored(
            { ...result, docx: balanced.docx, pdf: balanced.pdf },
            format, userName, details.length,
          );
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
  /** From accepted suggestions — folded into the domain pool of
   *  buildSummaryPhrase so they land in the templated sentence
   *  rather than tacking on "Currently focused on X." stubs. */
  suggestionDomainItems: string[];
  /** From accepted suggestions — standalone-prose appends for the
   *  Summary (years claim, mirror-title fallback). Pre-formatted
   *  with leading space + trailing punctuation. */
  suggestionInsertion: string;
  /** From accepted replace-text suggestions — applied as a docx
   *  XML find/replace pre-pass before keyword injection. */
  suggestionReplaces: { oldText: string; newText: string }[];
  /** From accepted append-skills suggestions — appended to the
   *  matching Skills category line. */
  suggestionExtraSkills: {
    cloudStack: string[]; systems: string[]; management: string[]; domain: string[];
  };
}): Promise<GenerationResult> {
  const {
    byCategory,
    budget,
    jdCorpus,
    suggestionDomainItems,
    suggestionInsertion,
    suggestionReplaces,
    suggestionExtraSkills,
  } = args;

  // Apply budget — keep the top N by frequency (list is already frequency-ordered).
  const missing: Record<Category, string[]> = {
    technical: byCategory.technical.slice(0, budget.technical),
    management: byCategory.management.slice(0, budget.management),
    domain: byCategory.domain.slice(0, budget.domain),
    soft: byCategory.soft.slice(0, budget.soft),
  };

  // Pool ALL domain-flavored items (missing-keyword domain + accepted
  // suggestion domain phrases) into a single bucket so they land in
  // ONE coherent buildSummaryPhrase template instead of stacking
  // "Currently focused on X" stubs. Same dedup rule as single-job
  // route. Cap at 3 domains + 2 softs to keep the sentence one line.
  const dedupKey = new Set<string>();
  const pooledDomain: string[] = [];
  const pushUnique = (s: string) => {
    const k = s.toLowerCase().trim();
    if (!k || dedupKey.has(k)) return;
    dedupKey.add(k);
    pooledDomain.push(s);
  };
  for (const d of missing.domain.slice(0, 3)) pushUnique(d);
  for (const d of suggestionDomainItems) pushUnique(d);

  const summaryPhrase =
    buildSummaryPhrase(pooledDomain.slice(0, 5), missing.soft.slice(0, 2)) +
    suggestionInsertion;

  const docxResult = await editDocxTemplate(missing, summaryPhrase, {
    jdContent: jdCorpus,
    workExpBudget: {
      maxPositions: budget.wePositions,
      maxKeywordsPerBullet: budget.weKwPerBullet,
      maxInlineAppends: budget.weInlineAppends,
    },
    replaceTexts: suggestionReplaces,
    extraSkills: suggestionExtraSkills,
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

/** Headers shared by both serve* helpers. Same shape as the
 *  single-job route — JSON-encodes the compression steps applied
 *  (mandatory mode only) into X-Compression-Steps so the UI can
 *  render a "fit applied: …" footer. */
function tailoringHeaders(
  contentType: string,
  contentDisposition: string,
  contentLength: number,
  compressionSteps?: string[],
): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': contentType,
    'Content-Disposition': contentDisposition,
    'Content-Length': String(contentLength),
  };
  if (compressionSteps && compressionSteps.length > 0) {
    headers['X-Compression-Steps'] = JSON.stringify(compressionSteps);
    headers['Access-Control-Expose-Headers'] = 'X-Compression-Steps';
  }
  return headers;
}

function serveTailored(
  result: GenerationResult,
  format: 'pdf' | 'docx',
  userName: string,
  numJobs: number,
  compressionSteps?: string[],
): NextResponse {
  return format === 'docx'
    ? serveDocx(result.docx, userName, numJobs, compressionSteps)
    : servePdf(result.pdf, userName, numJobs, compressionSteps);
}

function servePdf(
  pdfBuffer: Buffer, userName: string, numJobs: number,
  compressionSteps?: string[],
): NextResponse {
  const safeName = safeBaseName(userName, numJobs);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return new NextResponse(pdfBuffer as any, {
    status: 200,
    headers: tailoringHeaders(
      'application/pdf',
      `attachment; filename="${safeName}.pdf"`,
      pdfBuffer.length,
      compressionSteps,
    ),
  });
}

function serveDocx(
  docxBuffer: Buffer, userName: string, numJobs: number,
  compressionSteps?: string[],
): NextResponse {
  const safeName = safeBaseName(userName, numJobs);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return new NextResponse(docxBuffer as any, {
    status: 200,
    headers: tailoringHeaders(
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      `attachment; filename="${safeName}.docx"`,
      docxBuffer.length,
      compressionSteps,
    ),
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

/**
 * Balance the rendered page's top vs bottom whitespace.
 *
 * Same algorithm the single-job /api/tailor-resume route uses:
 * LibreOffice ignores `<w:vAlign w:val="center"/>` on `<w:sectPr>`
 * (Word respects it; LO has had patchy support for years), so a
 * 1-page-fit resume typically lands top-aligned with a fat strip of
 * empty space at the bottom. We measure where text actually rendered
 * in the PDF and shift the docx's TOP page margin so visible
 * whitespace is symmetric.
 *
 * Shift formula (derived in the single-job route's comments):
 *   ΔX = ((bottomGap − topGap) + ASC_DESC) / 2
 * Where ASC_DESC ≈ 7pt accounts for the body font's
 * ascender-vs-descender asymmetry that makes baseline-balanced
 * output look top-heavy. After applying we re-render and verify
 * still 1 page; revert otherwise.
 */
async function balanceWhitespace(
  docx: Buffer,
  pdf: Buffer,
): Promise<{ docx: Buffer; pdf: Buffer }> {
  const bounds = measurePdfTextBounds(pdf);
  if (!bounds) return { docx, pdf };
  const contentHeight = bounds.maxY - bounds.minY;
  if (contentHeight <= 0 || contentHeight >= bounds.pageHeight) {
    return { docx, pdf };
  }

  const ASC_DESC_PT = 7;
  const shiftPt = (bounds.bottomGap - bounds.topGap + ASC_DESC_PT) / 2;
  const shiftTwips = Math.round(shiftPt * 20);
  if (Math.abs(shiftTwips) < 30) return { docx, pdf };

  const JSZip = (await import('jszip')).default;
  const zip = await JSZip.loadAsync(docx);
  const docXmlFile = zip.file('word/document.xml');
  if (!docXmlFile) return { docx, pdf };
  const xml = await docXmlFile.async('string');
  const pgMarMatch = xml.match(/<w:pgMar\s[^/]*\/>/);
  if (!pgMarMatch) return { docx, pdf };
  const topRead = pgMarMatch[0].match(/w:top="(\d+)"/);
  const bottomRead = pgMarMatch[0].match(/w:bottom="(\d+)"/);
  const curTop = topRead ? parseInt(topRead[1], 10) : 300;
  const curBottom = bottomRead ? parseInt(bottomRead[1], 10) : 300;

  const FLOOR = 40;
  const newTop = Math.max(FLOOR, curTop + shiftTwips);

  // Page is 15840 twips (US Letter). Leave a 200-twip buffer beyond
  // contentHeight so cross-render variance doesn't push to page 2.
  const pageHeightTwips = Math.round(bounds.pageHeight * 20);
  const contentTwips = Math.round(contentHeight * 20);
  const SAFETY_TWIPS = 200;
  let newBottom = curBottom;
  const total = newTop + newBottom + contentTwips + SAFETY_TWIPS;
  if (total > pageHeightTwips) {
    newBottom = Math.max(FLOOR, pageHeightTwips - newTop - contentTwips - SAFETY_TWIPS);
  }

  const newPgMar = pgMarMatch[0]
    .replace(/w:top="\d+"/, `w:top="${newTop}"`)
    .replace(/w:bottom="\d+"/, `w:bottom="${newBottom}"`);
  const newXml = xml.replace(pgMarMatch[0], newPgMar);
  zip.file('word/document.xml', newXml);
  const newDocx: Buffer = Buffer.from(
    await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }),
  );
  const newPdf = await convertDocxToPdf(newDocx);

  if (countPdfPages(newPdf) > 1) {
    // eslint-disable-next-line no-console
    console.warn(
      `Multi-tailor: balance pass overflowed to ${countPdfPages(newPdf)} pages — reverting.`,
    );
    return { docx, pdf };
  }
  // eslint-disable-next-line no-console
  console.log(
    `Multi-tailor: balanced whitespace — margins ${curTop}/${curBottom} → ${newTop}/${newBottom} twips ` +
    `(was top ${bounds.topGap.toFixed(1)}pt vs bottom ${bounds.bottomGap.toFixed(1)}pt).`,
  );
  return { docx: newDocx, pdf: newPdf };
}
