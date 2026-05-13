import { NextRequest, NextResponse } from 'next/server';
import { getSettings, getListingById } from '@/lib/db';
import { fetchJobDetail } from '@/lib/job-fetcher';
import { tailorResume, buildSummaryPhrase } from '@/lib/resume-tailor';
import {
  editDocxTemplate,
  adjustDocxForLibreOffice,
  resolveDocxTemplate,
  removeAdditionalSection,
  runCompressionCascade,
} from '@/lib/docx-editor';
import { measurePdfTextBounds } from '@/lib/pdf-bounds';
import { detectSuggestions } from '@/lib/resume-suggestions';
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
 * selectedSuggestions → optional list of suggestion IDs to apply (each
 *                       returns from /api/ats-score with an `id` field;
 *                       the user-accepted subset is round-tripped here).
 */
export async function POST(req: NextRequest) {
  const {
    listingId, format, selectedKeywords, selectedSuggestions,
    // 'mandatory' (DEFAULT, since 2026-05-12): inject every
    // user-selected keyword AND run a compression cascade to fit on
    // one page. 'budget-ladder': legacy behavior — shrink keyword
    // injection until one-page fit, even if user picks get dropped.
    // The UI exposes a checkbox in the tailor section to toggle this
    // back to budget-ladder if needed.
    mode,
  } = await req.json();
  const tailorMode: 'mandatory' | 'budget-ladder' =
    mode === 'budget-ladder' ? 'budget-ladder' : 'mandatory';

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

  // 1. Identify missing keywords by category, filtered by user selection.
  //    Two passes so user-selected keywords land at the FRONT of each
  //    category list — that way per-tier `slice(0, N)` budgets never
  //    truncate an explicit user pick before they truncate an
  //    auto-included one. (This was the bug behind keywords like
  //    "retention"/"ecommerce" silently disappearing on tight resumes.)
  const jdKeywords = extractKeywords(detail.content);
  const resumeKeywords = extractKeywords(settings.baseResumeText);
  const missing: Record<string, string[]> = { technical: [], management: [], domain: [], soft: [] };
  const userSet = selectedKeywords && Array.isArray(selectedKeywords)
    ? new Set(selectedKeywords as string[])
    : null;
  // Pass 1: user-selected keywords (front of each list).
  if (userSet) {
    for (const [keyword, category] of jdKeywords) {
      if (!resumeKeywords.has(keyword) && userSet.has(keyword)) {
        missing[category].push(keyword);
      }
    }
  } else {
    // No explicit selection — include every missing JD keyword.
    for (const [keyword, category] of jdKeywords) {
      if (!resumeKeywords.has(keyword)) {
        missing[category].push(keyword);
      }
    }
  }
  // Track the user's selection size per category so each budget tier can
  // expand its cap to never truncate an explicit pick.
  const selectedByCat: Record<string, number> = {
    technical: missing.technical.length,
    management: missing.management.length,
    domain: missing.domain.length,
    soft: missing.soft.length,
  };
  // Pass 2: when the user did NOT supply an explicit selection, the
  // first pass already populated `missing[]` with everything. When they
  // DID, we still want auto-discovered keywords to be available for the
  // editor (Skills line, etc.) — they just go AFTER the user's picks so
  // tight tiers truncate them first.
  if (userSet) {
    for (const [keyword, category] of jdKeywords) {
      if (resumeKeywords.has(keyword)) continue;
      if (userSet.has(keyword)) continue; // already added in pass 1
      missing[category].push(keyword);
    }
  }

  // 2. Budget ladder — iterate from aggressive (max injection) to
  //    conservative (Summary+Skills only) and accept the first tier
  //    that renders to 1 page. The user's hard requirement is that the
  //    tailored resume NEVER exceeds 1 page, so we gate every candidate
  //    through a LibreOffice render + page count before serving.
  const origDocxBytes = await readFile(templatePath);
  const origDocxText = await extractDocxText(origDocxBytes);
  const originalScore = scoreResume(origDocxText, detail.content);

  type Budget = {
    technical: number; management: number; domain: number; soft: number;
    wePositions: number; weKwPerBullet: number; weInlineAppends: number;
    summaryDomain: number; summarySoft: number;
  };
  // Budget ladder (single-job variant). Mirrors the multi-route ladder:
  // WE-enabled tiers first (WE injection is the primary new feature we
  // want to land), then no-WE fallback tiers as a last-resort so the
  // 1-page guarantee still holds on tight resumes.
  //
  // weInlineAppends: post-pass that appends short keyword clauses to
  // existing bullets that have trailing whitespace on their final
  // rendered line. Costs 0 vertical lines (no new paragraphs), so we
  // enable it on every tier — it's a free way to push ATS score up
  // and compensates when new-bullet placement gets clipped by the
  // page budget.
  const attempts: Budget[] = [
    // ── WE-enabled tiers ──────────────────────────────────
    { technical: 6, management: 4, domain: 3, soft: 2, wePositions: 3, weKwPerBullet: 2, weInlineAppends: 4, summaryDomain: 3, summarySoft: 2 },
    { technical: 5, management: 3, domain: 2, soft: 2, wePositions: 2, weKwPerBullet: 2, weInlineAppends: 3, summaryDomain: 3, summarySoft: 1 },
    { technical: 4, management: 3, domain: 2, soft: 1, wePositions: 2, weKwPerBullet: 1, weInlineAppends: 3, summaryDomain: 2, summarySoft: 1 },
    { technical: 3, management: 2, domain: 2, soft: 1, wePositions: 1, weKwPerBullet: 2, weInlineAppends: 3, summaryDomain: 2, summarySoft: 1 },
    { technical: 3, management: 2, domain: 1, soft: 1, wePositions: 1, weKwPerBullet: 1, weInlineAppends: 2, summaryDomain: 2, summarySoft: 1 },
    // ── No-WE fallback tiers (inline-append still on — it's free) ──
    { technical: 8, management: 5, domain: 3, soft: 2, wePositions: 0, weKwPerBullet: 0, weInlineAppends: 4, summaryDomain: 3, summarySoft: 1 },
    { technical: 5, management: 3, domain: 2, soft: 1, wePositions: 0, weKwPerBullet: 0, weInlineAppends: 3, summaryDomain: 2, summarySoft: 1 },
    { technical: 3, management: 2, domain: 1, soft: 1, wePositions: 0, weKwPerBullet: 0, weInlineAppends: 2, summaryDomain: 1, summarySoft: 1 },
    { technical: 2, management: 1, domain: 1, soft: 0, wePositions: 0, weKwPerBullet: 0, weInlineAppends: 2, summaryDomain: 1, summarySoft: 0 },
  ];

  const userName = settings.userName || 'Resume';

  // For docx output we still want to verify 1-page fit via LibreOffice,
  // so we generate the PDF regardless and only serve docx if PDF confirms.
  interface Attempt {
    docxBuffer: Buffer;
    pdfBuffer: Buffer;
    pageCount: number;
    modifiedScore: number;
  }
  let bestAttempt: Attempt | null = null;

  // Helper: try a single budget tier against the supplied docx bytes
  // (the original template OR a slimmed variant — e.g. ADDITIONAL
  // section stripped). Returns the rendered Attempt; never serves a
  // response itself, so the caller can decide whether the tier's
  // page-count + score profile is good enough or whether to keep
  // walking the ladder.
  const totalSelected =
    selectedByCat.technical + selectedByCat.management +
    selectedByCat.domain + selectedByCat.soft;
  // Cache after the null-guard above so TS narrowing carries into the
  // closure (the inner async function would otherwise re-widen `detail`).
  const jdText = detail.content;

  // Pre-compute the suggestion edits the user accepted. We re-run
  // detection here (not just trust the client's strings) so a malicious
  // / stale client can't inject arbitrary prose — applied prose is
  // always sourced from our deterministic detector. Suggestions are
  // dispatched by `kind`:
  //   - append-summary → concat to summaryPhrase (one source of prose)
  //   - replace-text   → docx-XML find/replace pre-pass
  //   - append-skills  → extend the appropriate Skills line
  //
  // Empty `selectedSuggestions` array means user explicitly opted out
  // of every suggestion — apply NONE. Missing/undefined means the
  // legacy callers that don't know about suggestions yet — also NONE.
  const acceptedIds: Set<string> = Array.isArray(selectedSuggestions)
    ? new Set(selectedSuggestions as string[])
    : new Set();
  const allSuggestions = detectSuggestions({
    resumeText: settings.baseResumeText,
    jdContent: jdText,
    jdTitle: listing.title,
  });
  const accepted = allSuggestions.filter((s) => acceptedIds.has(s.id));

  // Suggestions split into three transport channels (one per kind):
  //
  //   1. summaryDomainItem  → folds into the same domain pool that
  //      missing-keyword detection produces, so EVERYTHING the user
  //      accepted that's "domain-flavored" (niche phrases, domain
  //      context words, domain keywords from the taxonomy) lands in
  //      ONE coherent buildSummaryPhrase template. Replaces the old
  //      "Currently focused on X. Currently focused on Y." pattern.
  //   2. insertion          → standalone short prose, used only for
  //      content that doesn't fit the domain template (years claim,
  //      mirror-title fallback). At most 1-2 such sentences ever.
  //   3. replace-text / append-skills → docx-XML edits, no prose.
  const suggestionDomainItems: string[] = [];
  const suggestionInsertions: string[] = [];
  const suggestionReplaces: { oldText: string; newText: string }[] = [];
  const suggestionExtraSkills: {
    cloudStack: string[]; systems: string[]; management: string[]; domain: string[];
  } = { cloudStack: [], systems: [], management: [], domain: [] };
  for (const s of accepted) {
    if (s.kind === 'replace-text' && s.oldText && s.newText) {
      suggestionReplaces.push({ oldText: s.oldText, newText: s.newText });
    } else if (s.kind === 'append-skills' && s.skillsCategory && s.skillsItems) {
      suggestionExtraSkills[s.skillsCategory].push(...s.skillsItems);
    } else if (s.kind === 'append-summary') {
      // Prefer the structured field — it folds into the template.
      // Fall back to free-form insertion for years claim / title
      // fallback / anything that doesn't fit the template engine.
      if (s.summaryDomainItem) suggestionDomainItems.push(s.summaryDomainItem);
      else if (s.insertion) suggestionInsertions.push(s.insertion);
    }
  }
  const suggestionInsertion = suggestionInsertions.join('');

  async function tryBudget(b: Budget, docxBytes: Buffer): Promise<Attempt> {
    // Per-tier slice caps, EXPANDED to never truncate an explicit user
    // pick. If the user selected 5 domain keywords, every tier passes
    // all 5 to the editor regardless of `b.domain` — that knob still
    // governs how many AUTO-included extras the tier accepts on top.
    const cap = (kind: keyof typeof selectedByCat, n: number) =>
      Math.max(n, selectedByCat[kind]);
    const budgetedMissing: Record<string, string[]> = {
      technical: missing.technical.slice(0, cap('technical', b.technical)),
      management: missing.management.slice(0, cap('management', b.management)),
      domain: missing.domain.slice(0, cap('domain', b.domain)),
      soft: missing.soft.slice(0, cap('soft', b.soft)),
    };
    // Pool ALL domain-flavored items into a single bucket before
    // calling buildSummaryPhrase, so accepted niche-phrase /
    // domain-context suggestions land inside the SAME templated
    // sentence as the missing-keyword domain terms — one coherent
    // line ("Experience spans Agent Foundations, Data Plane,
    // Communication, and Identity domains, applying Judgment …")
    // instead of a templated sentence + several "Currently focused
    // on X." stubs.
    //
    // De-dupe (case-insensitive) so a suggestion that mentions a
    // word the missing-keyword detector also surfaced doesn't get
    // listed twice. Cap at b.summaryDomain so the resulting sentence
    // stays readable on tight tiers.
    const dedupKey = new Set<string>();
    const pooledDomain: string[] = [];
    const pushUnique = (s: string) => {
      const k = s.toLowerCase().trim();
      if (!k || dedupKey.has(k)) return;
      dedupKey.add(k);
      pooledDomain.push(s);
    };
    for (const d of budgetedMissing.domain.slice(0, b.summaryDomain)) pushUnique(d);
    for (const d of suggestionDomainItems) pushUnique(d);
    const cappedDomainPool = pooledDomain.slice(0, Math.max(b.summaryDomain, suggestionDomainItems.length));
    // Free-form insertions (years claim, mirror-title fallback) are
    // appended AFTER the templated sentence — there are at most 1-2
    // and they don't repeat domain content.
    const summaryPhrase =
      buildSummaryPhrase(
        cappedDomainPool,
        budgetedMissing.soft.slice(0, b.summarySoft),
      ) + suggestionInsertion;
    const docxResult = await editDocxTemplate(budgetedMissing, summaryPhrase, {
      jdContent: jdText,
      workExpBudget: {
        maxPositions: b.wePositions,
        maxKeywordsPerBullet: b.weKwPerBullet,
        // Bump inline-append budget to fit every selected keyword that
        // didn't make it into Summary or new bullets — inline appends
        // cost zero new lines (they fill trailing whitespace on the
        // last rendered line of an existing bullet) so they're the
        // safest place to land overflow without breaking 1-page fit.
        maxInlineAppends: Math.max(b.weInlineAppends, totalSelected),
      },
      baseDocxBytes: docxBytes,
      replaceTexts: suggestionReplaces,
      extraSkills: suggestionExtraSkills,
    });
    const modifiedText = await extractDocxText(docxResult.buffer);
    const modifiedScore = scoreResume(modifiedText, jdText).overall;
    const adjustedDocx = await adjustDocxForLibreOffice(docxResult.buffer);
    const pdfBuffer = await convertDocxToPdf(adjustedDocx);
    const pageCount = countPdfPages(pdfBuffer);
    return { docxBuffer: docxResult.buffer, pdfBuffer, pageCount, modifiedScore };
  }

  // Walk the ladder, twice if needed:
  //   Pass A — full template (ADDITIONAL section retained).
  //   Pass B — ADDITIONAL section stripped (last-resort space recovery).
  // First 1-page fit wins.
  const ladderPasses: { label: string; bytes: Buffer }[] = [
    { label: 'standard', bytes: origDocxBytes },
  ];
  const stripped = removeAdditionalSection(
    await extractDocumentXml(origDocxBytes)
  );
  if (stripped.removed) {
    // Re-pack the stripped XML into a docx so all subsequent edits
    // operate on the slimmer template.
    const slimmer = await replaceDocumentXml(origDocxBytes, stripped.xml);
    ladderPasses.push({ label: 'no-additional', bytes: slimmer });
  }

  /**
   * Balance the rendered page's top vs bottom whitespace.
   *
   * LibreOffice ignores `<w:vAlign w:val="center"/>` on `<w:sectPr>`
   * (Microsoft Word respects it; LO has had patchy support for
   * years), so a 1-page-fit resume typically lands top-aligned with a
   * fat strip of empty space at the bottom. We measure where text
   * actually rendered in the PDF and shift the docx's TOP page margin
   * so visible whitespace is symmetric.
   *
   * Why only the top margin
   * ───────────────────────
   * Empirically (and verifiable with two test renders), LibreOffice
   * top-aligns content within the section's margin frame and ignores
   * the bottom margin for layout purposes — only the top margin moves
   * content. Concretely, when we increase `top_margin` by ΔX:
   *   topGap    += ΔX
   *   bottomGap −= ΔX
   * The bottom margin only constrains how much content fits before
   * overflowing to page 2 (it doesn't shift content vertically).
   *
   * So the shift formula is direct. We want:
   *   new_topGap − new_bottomGap = ASC_DESC   (≈ 7pt — body font's
   *   ascender vs descender, the systematic baseline-to-visible
   *   asymmetry that makes baseline-balanced output look top-heavy)
   *
   * Solving with the linear shift relations:
   *   ΔX = ((bottomGap − topGap) + ASC_DESC) / 2
   *
   * After applying ΔX twips to the top margin we re-render, then
   * verify still 1 page; if not (rare — would require ΔX to push
   * content area below contentHeight), revert.
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

    // Empirical body-font asymmetry. 11pt fonts on resume templates
    // typically have ASC ≈ 9pt, DESC ≈ 2pt → diff ≈ 7pt. Aiming for
    // baseline imbalance of +7 (top baseline gap larger than bottom)
    // produces ≈ zero VISIBLE imbalance. If a font has wildly
    // different metrics the residual is still small (<5pt).
    const ASC_DESC_PT = 7;
    const shiftPt = (bounds.bottomGap - bounds.topGap + ASC_DESC_PT) / 2;
    const shiftTwips = Math.round(shiftPt * 20);
    if (Math.abs(shiftTwips) < 30) return { docx, pdf }; // already balanced

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

    // Apply the shift, with a 40-twip floor to keep margins sane.
    const FLOOR = 40;
    const newTop = Math.max(FLOOR, curTop + shiftTwips);

    // Adjust bottom margin so total content area is still big enough.
    // contentHeight × 20 = contentHeight in twips. Page is 15840 twips
    // (US Letter) — leave a 200-twip safety buffer beyond contentHeight.
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

    // Verify the balance pass didn't push content to a 2nd page.
    if (countPdfPages(newPdf) > 1) {
      // eslint-disable-next-line no-console
      console.warn(
        `Tailor: balance pass overflowed to ${countPdfPages(newPdf)} pages — reverting to top-aligned layout.`,
      );
      return { docx, pdf };
    }

    // eslint-disable-next-line no-console
    console.log(
      `Tailor: balanced whitespace — margins (top/bottom) ${curTop}/${curBottom} → ${newTop}/${newBottom} twips ` +
      `(was top ${bounds.topGap.toFixed(1)}pt vs bottom ${bounds.bottomGap.toFixed(1)}pt; ` +
      `contentHeight ${contentHeight.toFixed(1)}pt; shift ${shiftTwips} twips).`,
    );
    return { docx: newDocx, pdf: newPdf };
  }

  // ─── Mandatory mode (DEFAULT) ──────────────────────────────────────
  // Inject every user-selected keyword unconditionally, then run a
  // compression cascade (margin/spacing/line-height/font tweaks) to
  // fit on one page. This is the "no keyword left behind" path —
  // the budget ladder below is only used when the user explicitly
  // opts back into 'budget-ladder' mode.
  //
  // Compression floors enforced in buildCompressionCascade():
  //   - body font ≥ 9pt
  //   - margins   ≥ 0.4"
  //   - destructive content drops NOT performed (per user direction)
  // On final overflow we still serve the closest-to-1-page result
  // (best-effort) so user-selected keywords never silently disappear.
  if (tailorMode === 'mandatory') {
    // First budget tier (the WE-enabled max) — its slice caps are
    // already expanded by `cap()` so every user-selected keyword
    // lands. The 'standard' pass keeps the ADDITIONAL section
    // intact; the cascade will drop it as a late-stage step if
    // needed.
    const initialBudget = attempts[0];
    const baseAttempt = await tryBudget(initialBudget, origDocxBytes);
    // Render through adjustDocxForLibreOffice so the docx we feed
    // the cascade matches the rendered geometry. (Same pattern the
    // budget-ladder path uses below.)
    const initialDocx = await adjustDocxForLibreOffice(baseAttempt.docxBuffer);
    const cascadeResult = await runCompressionCascade({
      initialDocx,
      render: convertDocxToPdf,
      countPages: countPdfPages,
    });
    if (cascadeResult.pageCount <= 1) {
      // 1-page fit achieved. Run the whitespace-balance pass on
      // top so top/bottom margins look symmetric. Balance pass is
      // a no-op on exact-fit pages and reverts if it overflows.
      const balanced = await balanceWhitespace(cascadeResult.docx, cascadeResult.pdf);
      // eslint-disable-next-line no-console
      console.log(
        `Tailor[mandatory]: 1-page fit via ${cascadeResult.stepsApplied.length} compression step(s): ` +
        `${cascadeResult.stepsApplied.join(', ') || '(none — fit out of the box)'}.`,
      );
      if (format === 'docx') {
        return serveDocx(
          balanced.docx, userName, listing.company, listing.title,
          cascadeResult.stepsApplied,
        );
      }
      return servePdf(
        balanced.pdf, userName, listing.company, listing.title,
        cascadeResult.stepsApplied,
      );
    }
    // Cascade exhausted — still > 1 page. Per user direction we
    // serve the best-effort multi-page anyway rather than hard-
    // failing. The X-Compression-Steps header tells the UI what
    // was attempted, plus a marker that we exhausted the cascade.
    // eslint-disable-next-line no-console
    console.warn(
      `Tailor[mandatory]: cascade exhausted after ${cascadeResult.stepsApplied.length} step(s); ` +
      `best-effort result is ${cascadeResult.pageCount} page(s). ` +
      `Applied: ${cascadeResult.stepsApplied.join(', ')}.`,
    );
    const exhaustedSteps = [...cascadeResult.stepsApplied, 'exhausted'];
    if (format === 'docx') {
      return serveDocx(
        cascadeResult.docx, userName, listing.company, listing.title,
        exhaustedSteps,
      );
    }
    return servePdf(
      cascadeResult.pdf, userName, listing.company, listing.title,
      exhaustedSteps,
    );
  }

  // ─── Budget-ladder mode (legacy / opt-out) ────────────────────────
  for (const pass of ladderPasses) {
    for (let tierIdx = 0; tierIdx < attempts.length; tierIdx++) {
      const b = attempts[tierIdx];
      const attempt = await tryBudget(b, pass.bytes);
      if (!bestAttempt || attemptIsBetter(attempt, bestAttempt)) bestAttempt = attempt;
      if (attempt.pageCount <= 1) {
        // eslint-disable-next-line no-console
        console.log(
          `Tailor[${pass.label}]: tier ${tierIdx + 1}/${attempts.length} fit 1 page. ` +
          `Budget: tech=${b.technical} mgmt=${b.management} dom=${b.domain} soft=${b.soft} ` +
          `WE=${b.wePositions}pos×${b.weKwPerBullet}kw. ` +
          `Score: ${attempt.modifiedScore}% (baseline ${originalScore.overall}%)`,
        );
        // Balance pass: measure where content actually landed and
        // shift the top margin to make visible top/bottom whitespace
        // equal. The adjusted docx + pdf are what we ship.
        // Note: `attempt.pdfBuffer` was rendered through
        // adjustDocxForLibreOffice, so the docx we measure-and-shift
        // is the LO-adjusted variant (matches the rendered geometry).
        const adjustedDocx = await adjustDocxForLibreOffice(attempt.docxBuffer);
        const balanced = await balanceWhitespace(adjustedDocx, attempt.pdfBuffer);
        if (format === 'docx') {
          return serveDocx(balanced.docx, userName, listing.company, listing.title);
        }
        return servePdf(balanced.pdf, userName, listing.company, listing.title);
      }
    }
  }

  // Every tier overflowed 1 page. Serving the unedited baseline here
  // would silently discard the user's selected keywords — the user
  // explicitly flagged "no changes at all" as a CRITICAL bug. So the
  // 1-page constraint is now best-effort: we always serve the edited
  // version closest to 1 page with the highest ATS score
  // (see attemptIsBetter()), never the untouched baseline.
  if (!bestAttempt) {
    // Shouldn't happen — attempts is non-empty — but guard defensively.
    if (format === 'docx') {
      return serveDocx(origDocxBytes, userName, listing.company, listing.title);
    }
    const adjustedOrig = await adjustDocxForLibreOffice(origDocxBytes);
    const origPdf = await convertDocxToPdf(adjustedOrig);
    return servePdf(origPdf, userName, listing.company, listing.title);
  }
  console.warn(
    `Tailor: no budget tier fit 1 page after ${attempts.length} tries. ` +
    `Serving best-effort edited: ${bestAttempt.pageCount} pages, ` +
    `score ${bestAttempt.modifiedScore}% vs original ${originalScore.overall}%.`,
  );
  if (format === 'docx') {
    return serveDocx(bestAttempt.docxBuffer, userName, listing.company, listing.title);
  }
  return servePdf(bestAttempt.pdfBuffer, userName, listing.company, listing.title);
}

/** Prefer 1-page fit, then fewer pages, then higher score. */
function attemptIsBetter(
  a: { pageCount: number; modifiedScore: number },
  b: { pageCount: number; modifiedScore: number },
): boolean {
  const aFits = a.pageCount <= 1;
  const bFits = b.pageCount <= 1;
  if (aFits !== bFits) return aFits;
  if (a.pageCount !== b.pageCount) return a.pageCount < b.pageCount;
  return a.modifiedScore > b.modifiedScore;
}

// ─── Helpers: serve PDF / DOCX responses ────────────────────────────

function safeBaseName(userName: string, company: string, title: string): string {
  return `${userName}_${company}_${title}`
    .replace(/[^a-zA-Z0-9_\- ]/g, '')
    .replace(/\s+/g, '_')
    .slice(0, 80);
}

/** Build the headers shared by servePdf/serveDocx. The optional
 *  `compressionSteps` array (mandatory-mode only) is JSON-encoded
 *  into `X-Compression-Steps` so the client can render a "fit
 *  applied" footer without us baking it into the binary itself.
 *  `Access-Control-Expose-Headers` is needed for the browser to
 *  surface custom headers to `fetch().response.headers.get()`. */
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
    // HTTP headers are ISO-8859-1 only — any code point > 255 throws
    // "Cannot convert argument to a ByteString" inside NextResponse.
    // We URI-encode the JSON so any non-ASCII (em-dashes, minus signs,
    // smart quotes, future translations) survives transport. The
    // client decodes via decodeURIComponent.
    headers['X-Compression-Steps'] = encodeURIComponent(JSON.stringify(compressionSteps));
    headers['Access-Control-Expose-Headers'] = 'X-Compression-Steps';
  }
  return headers;
}

function servePdf(
  pdfBuffer: Buffer, userName: string, company: string, title: string,
  compressionSteps?: string[],
) {
  const safeName = safeBaseName(userName, company, title);
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
  docxBuffer: Buffer, userName: string, company: string, title: string,
  compressionSteps?: string[],
) {
  const safeName = safeBaseName(userName, company, title);
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

// ─── Helper: extract plain text from docx for scoring ───────────────

/** Read raw word/document.xml as a string (no tag stripping). Used by
 *  the ADDITIONAL-removal pass to inspect the document structure before
 *  deciding whether to re-pack a slimmer variant. */
async function extractDocumentXml(docxBuffer: Buffer): Promise<string> {
  const JSZip = (await import('jszip')).default;
  const zip = await JSZip.loadAsync(docxBuffer);
  return (await zip.file('word/document.xml')?.async('string')) ?? '';
}

/** Re-pack a docx with a replaced word/document.xml. All other parts
 *  (rels, theme, settings, fonts, etc.) are preserved as-is. */
async function replaceDocumentXml(docxBuffer: Buffer, newXml: string): Promise<Buffer> {
  const JSZip = (await import('jszip')).default;
  const zip = await JSZip.loadAsync(docxBuffer);
  zip.file('word/document.xml', newXml);
  return Buffer.from(await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }));
}

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
