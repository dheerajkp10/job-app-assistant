/**
 * Docx template editor — modifies the user's original .docx resume
 * by surgically editing the XML, preserving all formatting, fonts, and layout.
 *
 * Uses jszip to unzip, edit word/document.xml, and rezip.
 */

import { readFile, access } from 'fs/promises';
import { join, extname } from 'path';
import JSZip from 'jszip';
import { getSettings } from './db';
import {
  injectIntoWorkExperience,
  type WorkExperienceBudget,
} from './work-experience-injector';

/**
 * Resolve the path to the user's base .docx resume.
 *
 * Checks the file matching settings.baseResumeFileName — only returns a
 * docx path when the *active* resume is a .docx. This guards against the
 * stale-file bug: if a user uploaded a .docx once and then later
 * uploaded a .pdf, the stale .docx would be sitting on disk but would
 * be the wrong document to tailor. We refuse to use it.
 *
 * Also checks a legacy `template.docx` for backward compatibility, but
 * only when no active resume file is recorded.
 */
const RESUME_DIR = join(process.cwd(), 'data', 'resume');

export type DocxResolution =
  | { kind: 'ok'; path: string }
  | { kind: 'pdf-only'; activeName: string }
  | { kind: 'missing' };

export async function resolveDocxTemplate(): Promise<DocxResolution> {
  const settings = await getSettings();
  const activeName = settings.baseResumeFileName;

  if (activeName) {
    const ext = extname(activeName).toLowerCase();
    if (ext === '.docx') {
      const p = join(RESUME_DIR, 'base-resume.docx');
      try { await access(p); return { kind: 'ok', path: p }; } catch { /* fall through */ }
    } else if (ext === '.pdf') {
      return { kind: 'pdf-only', activeName };
    }
  }

  // Legacy fallback (pre-settings template file).
  const legacy = join(RESUME_DIR, 'template.docx');
  try { await access(legacy); return { kind: 'ok', path: legacy }; } catch { /* fall through */ }

  return { kind: 'missing' };
}

/**
 * Thin compatibility wrapper — returns the path if one is usable, or null.
 * Prefer `resolveDocxTemplate()` at call sites that need to distinguish
 * pdf-only from missing (to show a more helpful error).
 */
export async function resolveDocxTemplatePath(): Promise<string | null> {
  const r = await resolveDocxTemplate();
  return r.kind === 'ok' ? r.path : null;
}

/**
 * Skills category labels as they appear in the docx.
 * We'll match these in the XML text runs.
 */
const SKILLS_LABELS: Record<string, string[]> = {
  technical: ['Cloud &amp; Stack:', 'Cloud & Stack:', 'Systems &amp; Architecture:', 'Systems & Architecture:'],
  cloudStack: ['Cloud &amp; Stack:', 'Cloud & Stack:'],
  systems: ['Systems &amp; Architecture:', 'Systems & Architecture:'],
  management: ['Leadership:'],
  domain: ['AI / ML:', 'AI/ML:'],
  soft: ['Leadership:'],  // soft skills go into Leadership line too
};

/**
 * Classify a technical keyword into "cloud & stack" (concrete
 * tools/languages/platforms) vs "systems & architecture" (design
 * concepts/patterns). Per-keyword placement makes the skills lines read
 * naturally instead of lumping everything into one bucket.
 *
 * Heuristic: common abstract-pattern tokens route to Systems; everything
 * else routes to Cloud & Stack (the more typical bucket for concrete tech).
 */
const SYSTEMS_KEYWORDS = new Set([
  'microservices', 'monolith', 'serverless', 'event-driven', 'event-sourcing',
  'cqrs', 'saga', 'domain-driven-design', 'ddd', 'hexagonal', 'clean-architecture',
  'soa', 'api-design', 'api-gateway', 'rest', 'graphql', 'grpc', 'websockets',
  'distributed-systems', 'high-availability', 'fault-tolerance', 'resilience',
  'scalability', 'observability', 'monitoring', 'logging', 'tracing',
  'consistency', 'idempotency', 'concurrency', 'caching', 'sharding',
  'replication', 'partitioning', 'leader-election', 'consensus', 'raft',
  'paxos', 'cap-theorem', 'system-design', 'low-latency', 'throughput',
  'load-balancing', 'auto-scaling', 'circuit-breaker', 'rate-limiting',
  'pub-sub', 'message-queue', 'streaming', 'batch-processing',
  'data-modeling', 'schema-design', 'eventual-consistency',
]);

function classifyTechnical(keyword: string): 'cloudStack' | 'systems' {
  return SYSTEMS_KEYWORDS.has(keyword.toLowerCase()) ? 'systems' : 'cloudStack';
}

/**
 * Append keywords to the end of a skills text run in the XML.
 * Finds the <w:t> containing the skills text after the bold label,
 * and appends the keywords.
 */
function appendToSkillsLine(
  xml: string,
  labelPatterns: string[],
  keywords: string[]
): { xml: string; appended: boolean } {
  if (keywords.length === 0) return { xml, appended: false };

  for (const label of labelPatterns) {
    const labelIdx = xml.indexOf(label);
    if (labelIdx < 0) continue;

    // Find the next </w:t> after the label — this closes the label run
    const labelEndTag = xml.indexOf('</w:t>', labelIdx);
    if (labelEndTag < 0) continue;

    // Find the next <w:t after the label's closing tag — this is the keywords run
    const nextTStart = xml.indexOf('<w:t', labelEndTag);
    if (nextTStart < 0) continue;

    // Find the closing </w:t> of the keywords run
    const nextTEnd = xml.indexOf('</w:t>', nextTStart);
    if (nextTEnd < 0) continue;

    // Make sure this is in the same paragraph (no </w:p> between)
    const pEnd = xml.indexOf('</w:p>', labelIdx);
    if (pEnd >= 0 && pEnd < nextTEnd) continue;

    // Get existing text content
    const tOpenEnd = xml.indexOf('>', nextTStart) + 1;
    const existingText = xml.substring(tOpenEnd, nextTEnd);

    // Dedupe: drop keywords already present in the line (case-insensitive,
    // compared on the title-cased display form and the raw kebab form).
    // This prevents "Microservices, Microservices" type duplicates that
    // would make the skills line look sloppy if the upstream filter ever
    // slips.
    const existingLower = existingText.toLowerCase();
    const toAppend = keywords.filter((k) => {
      const display = k.split(/[-_]/).map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
      return !existingLower.includes(display.toLowerCase()) &&
             !existingLower.includes(k.toLowerCase());
    });
    if (toAppend.length === 0) return { xml, appended: false };

    // Append keywords
    const addition = toAppend.map(k =>
      k.split(/[-_]/).map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
    ).join(', ');
    const newText = existingText.trimEnd().replace(/\.?\s*$/, '') + ', ' + addition;

    return {
      xml: xml.substring(0, tOpenEnd) + newText + xml.substring(nextTEnd),
      appended: true,
    };
  }

  return { xml, appended: false };
}

/**
 * Append a short phrase to the Summary paragraph.
 * Finds the SUMMARY heading, then the text in the next paragraph,
 * and appends the phrase to the last text run.
 */
function appendToSummary(xml: string, phrase: string): string {
  if (!phrase) return xml;

  // Find "SUMMARY" text
  const summaryIdx = xml.indexOf('>SUMMARY<');
  if (summaryIdx < 0) return xml;

  // Find the paragraph AFTER the summary heading
  const afterSummary = xml.indexOf('</w:p>', summaryIdx);
  if (afterSummary < 0) return xml;

  // Find the next paragraph
  const nextPStart = xml.indexOf('<w:p', afterSummary);
  if (nextPStart < 0) return xml;

  // Find the end of this paragraph
  const nextPEnd = xml.indexOf('</w:p>', nextPStart);
  if (nextPEnd < 0) return xml;

  // Find the LAST </w:t> in this paragraph — that's where we append
  const paraContent = xml.substring(nextPStart, nextPEnd);
  const lastTEndInPara = paraContent.lastIndexOf('</w:t>');
  if (lastTEndInPara < 0) return xml;

  const absolutePos = nextPStart + lastTEndInPara;
  // Find the start of this <w:t> tag
  const tContent = xml.substring(0, absolutePos);
  const tOpenStart = tContent.lastIndexOf('<w:t');
  const tOpenEnd = xml.indexOf('>', tOpenStart) + 1;

  const existingText = xml.substring(tOpenEnd, absolutePos);
  const newText = existingText.trimEnd() + ' ' + phrase;

  return xml.substring(0, tOpenEnd) + newText + xml.substring(absolutePos);
}

/**
 * Merge each position's "title" paragraph with the following "subtitle"
 * (company | location | team) paragraph into a single line, reclaiming
 * one visible line per position. For a 5-position resume that's 5
 * lines back — typically enough on its own to absorb Skills/Summary
 * additions and keep the tailored output at 1 page.
 *
 * Shape we're transforming (schematic, not literal XML):
 *
 *   BEFORE                             AFTER
 *   ──────                             ─────
 *   ┌─ title paragraph ─────────────┐  ┌─ merged paragraph ─────────────────────┐
 *   │ <tab right 10800>             │  │ <tab right 10800>                      │
 *   │  [bold] Software Dev Manager  │  │  [bold] Software Dev Manager           │
 *   │  [plain] \tJul 2025 – Present │  │  [plain italic] | Amazon | Seattle | … │
 *   └───────────────────────────────┘  │  [plain] \tJul 2025 – Present          │
 *   ┌─ subtitle paragraph ──────────┐  └────────────────────────────────────────┘
 *   │ [italic] Amazon | Seattle | … │   (subtitle paragraph removed)
 *   └───────────────────────────────┘
 *
 * Detection is deliberately narrow: we ONLY merge a paragraph when the
 * immediately-following paragraph is italic, has a single text run,
 * carries no pStyle (so bullets and headers are never touched), and
 * sits before the first bullet paragraph of the position. That matches
 * the resume template's "company | location | team" line exactly and
 * refuses to fire on anything ambiguous.
 *
 * Idempotent: runs safely multiple times because after a merge the
 * title paragraph no longer has a companion subtitle immediately
 * following it, so subsequent passes find nothing to merge.
 */
export function mergePositionHeaders(xml: string): { xml: string; merged: number } {
  // Split on paragraph boundaries so we can work with whole <w:p>…</w:p>
  // blocks. We split on the *closing* tag, keeping it on the preceding
  // chunk, so the array alternates naturally between paragraphs.
  const parts = xml.split(/(<\/w:p>)/);
  // Rejoin pairs back into whole paragraphs so parts[i] is one full
  // paragraph (including its closing tag), except parts[0] which is
  // everything before the first <w:p> (the styles/settings preamble).
  const paragraphs: string[] = [];
  let preamble = '';
  let buf = '';
  let seenFirstParagraph = false;
  for (let i = 0; i < parts.length; i++) {
    buf += parts[i];
    if (parts[i] === '</w:p>') {
      if (!seenFirstParagraph) {
        // The buf up to the first <w:p> tag is preamble; the rest is
        // the first paragraph.
        const firstPStart = buf.indexOf('<w:p');
        preamble = buf.substring(0, firstPStart);
        paragraphs.push(buf.substring(firstPStart));
        seenFirstParagraph = true;
      } else {
        paragraphs.push(buf);
      }
      buf = '';
    }
  }
  // Anything left in buf after the last </w:p> is the document tail
  // (sectPr + closing body tag). Keep it to re-append at the end.
  const tail = buf;

  const isTitleParagraph = (p: string): boolean => {
    // Title paragraphs have a right-aligned tab stop at 10800 twips.
    // No other paragraph type in the template uses that construct.
    return /<w:tab\s+w:val="right"\s+w:pos="10800"/.test(p);
  };

  const isSubtitleParagraph = (p: string): boolean => {
    // Italic, no list style, no border, exactly one text run.
    if (!/<w:i\/>/.test(p) && !/<w:i\s+w:val="true"\/>/.test(p)) return false;
    if (/<w:pStyle\s+w:val="ListParagraph"/.test(p)) return false;
    if (/<w:pBdr>/.test(p)) return false;
    // Must not itself carry a right-tab (that would make it a title).
    if (/<w:tab\s+w:val="right"/.test(p)) return false;
    return true;
  };

  // Extract the italic run(s) from the subtitle so we can inject them
  // as-is into the title paragraph, preserving the italic styling.
  //
  // Also normalize interior separators "  |  " (double space each side)
  // → " | " (single space). Long titles — e.g. "Software Development
  // Manager & Engineering Lead" + company + location + team — are on
  // the edge of the page width; tightening the separators buys ~6
  // chars per merge, which is the difference between "fits in one
  // line" and "the date wraps onto a second line."
  const extractRuns = (paragraph: string): string => {
    const pTagEnd = paragraph.indexOf('>') + 1; // after <w:p> opening
    let inner = paragraph.substring(pTagEnd, paragraph.length - '</w:p>'.length);
    inner = inner.replace(/^<w:pPr>[\s\S]*?<\/w:pPr>/, '');
    // Normalize spacing only inside <w:t> text content, not in
    // attribute values, so we never touch XML structure.
    inner = inner.replace(/(<w:t[^>]*>)([\s\S]*?)(<\/w:t>)/g, (_m, open, text, close) => {
      const normalized = text.replace(/ {2,}\|\s+/g, ' | ').replace(/\s+\|\s{2,}/g, ' | ');
      return open + normalized + close;
    });
    return inner;
  };

  let mergedCount = 0;
  const out: string[] = [];
  for (let i = 0; i < paragraphs.length; i++) {
    const p = paragraphs[i];
    const next = paragraphs[i + 1];
    if (isTitleParagraph(p) && next && isSubtitleParagraph(next)) {
      const subtitleRuns = extractRuns(next);
      // Inject " | " separator + subtitle italic runs BEFORE the
      // tab+date run. The tab+date run is the LAST run in the title
      // paragraph (it starts with a \t inside its <w:t>). We find the
      // last <w:r> in the paragraph and splice before it.
      const lastRunStart = p.lastIndexOf('<w:r>');
      const lastRunStartAlt = p.lastIndexOf('<w:r ');
      const insertAt = Math.max(lastRunStart, lastRunStartAlt);
      if (insertAt > 0) {
        // A plain separator run in the same register as the surrounding
        // copy — color 444444, size 16 — keeps it visually consistent
        // with the italic subtitle.
        // " | " (single spaces) matches the tightened subtitle
        // separators normalized in extractRuns() above, and keeps
        // long titles on one line.
        const separator =
          '<w:r><w:rPr><w:rFonts w:ascii="Calibri" w:cs="Calibri" w:eastAsia="Calibri" w:hAnsi="Calibri"/>' +
          '<w:color w:val="444444"/><w:sz w:val="16"/><w:szCs w:val="16"/></w:rPr>' +
          '<w:t xml:space="preserve"> | </w:t></w:r>';
        const mergedTitle = p.substring(0, insertAt) + separator + subtitleRuns + p.substring(insertAt);
        out.push(mergedTitle);
        // Skip the subtitle paragraph
        i++;
        mergedCount++;
        continue;
      }
    }
    out.push(p);
  }

  return { xml: preamble + out.join('') + tail, merged: mergedCount };
}

/**
 * Increase vertical breathing room AROUND each bordered section
 * header (SUMMARY, WORK EXPERIENCE, EDUCATION, SKILLS, ADDITIONAL).
 *
 * The template ships with `w:before="36"` (1.8pt) / `w:after="14"`
 * (0.7pt) on section headers, which is tight enough that the next
 * section's first line visually butts up against the blue divider
 * and sections don't read as clearly separated.
 *
 * - `w:before` 36 → 160 twips (1.8pt → 8pt): opens a gap between
 *   the previous section's tail and the next section's divider.
 * - `w:after` 14 → 80 twips (0.7pt → 4pt): opens a gap between the
 *   divider line and the first content paragraph underneath it
 *   (e.g. the first position header under WORK EXPERIENCE, the
 *   summary paragraph under SUMMARY, the degree line under
 *   EDUCATION).
 *
 * Combined cost is ~1.5 lines across 5 section headers — easily
 * absorbed by the 5 lines reclaimed via mergePositionHeaders().
 *
 * Only touches section-header paragraphs (detected by the blue
 * `<w:pBdr>` border) — bullets, summary body, and position headers
 * are left alone. Idempotent: the regexes only fire on the stock
 * template values, so re-running is a no-op.
 */
export function increaseSectionSpacing(xml: string): string {
  return xml.replace(/<w:p[ >][\s\S]*?<\/w:p>/g, (para) => {
    if (!para.includes('<w:pBdr>')) return para;
    let p = para.replace(
      /(<w:spacing\b[^/>]*?\s)w:before="36"/,
      '$1w:before="160"',
    );
    p = p.replace(
      /(<w:spacing\b[^/>]*?\s)w:after="14"/,
      '$1w:after="80"',
    );
    return p;
  });
}

/**
 * Replace every occurrence of `oldText` with `newText` in the body
 * text of the docx, even when the source text is split across multiple
 * `<w:t>` runs (which Word does freely whenever runs differ in
 * formatting — bold/italic/font-size boundaries).
 *
 * Strategy:
 *   1. Walk all `<w:t>…</w:t>` runs in document order, building a flat
 *      string of their concatenated text + a parallel index from text
 *      position back to (run-index, offset-in-run).
 *   2. Find every occurrence of `oldText` in the flat string.
 *   3. For each match, edit the runs it spans: keep the first run's
 *      prefix, swap in `newText` at the boundary, keep the last run's
 *      suffix, and clear the runs that the match fully consumed.
 *   4. Re-emit the runs back into the XML in place of the originals.
 *
 * Used for "replace-text" suggestions (e.g. align an existing role
 * title to the JD's exact wording — "Software Development Manager" →
 * "Software Engineering Manager"). Comparison is case-insensitive
 * but we preserve `newText` casing verbatim.
 *
 * Returns the edited XML and a count of replacements made (for
 * logging / telemetry).
 */
export function replaceTextInDocx(
  xml: string,
  oldText: string,
  newText: string,
): { xml: string; replacements: number } {
  if (!oldText || oldText === newText) return { xml, replacements: 0 };
  // Runs and their positions in the flat text stream.
  interface Run {
    /** Index of the first char of this run's text in the flat stream. */
    flatStart: number;
    /** Index of the last char + 1 in the flat stream. */
    flatEnd: number;
    /** Index in `xml` where this run's `<w:t>` text contents begin. */
    xmlOpenEnd: number;
    /** Index in `xml` where this run's `</w:t>` begins. */
    xmlCloseStart: number;
    /** The decoded text content (entities resolved). */
    text: string;
  }
  const runs: Run[] = [];
  // `<w:t>…</w:t>` and `<w:t xml:space="preserve">…</w:t>` both supported.
  const re = /<w:t\b([^>]*)>([\s\S]*?)<\/w:t>/g;
  let flatPos = 0;
  let flat = '';
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    const openTag = m[0].slice(0, m[0].indexOf('>') + 1);
    const closeTag = '</w:t>';
    const inner = m[2];
    const xmlOpenEnd = m.index + openTag.length;
    const xmlCloseStart = m.index + m[0].length - closeTag.length;
    // Decode entities into a plain string for matching.
    const decoded = inner
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'");
    runs.push({
      flatStart: flatPos,
      flatEnd: flatPos + decoded.length,
      xmlOpenEnd,
      xmlCloseStart,
      text: decoded,
    });
    flat += decoded;
    flatPos += decoded.length;
  }

  // Case-insensitive match — but preserve original casing of `newText`.
  const flatLower = flat.toLowerCase();
  const oldLower = oldText.toLowerCase();
  const matches: { start: number; end: number }[] = [];
  let from = 0;
  while (true) {
    const idx = flatLower.indexOf(oldLower, from);
    if (idx < 0) break;
    matches.push({ start: idx, end: idx + oldLower.length });
    from = idx + oldLower.length;
  }
  if (matches.length === 0) return { xml, replacements: 0 };

  // For each match, build a "patch" — a per-run text override. We
  // collect overrides into a Map<runIndex, newText>, then re-emit
  // the XML by walking runs in original order.
  const runOverrides = new Map<number, string>();
  // Helper: locate which run a flat index falls into.
  const runForFlat = (p: number): number => {
    // Binary search would be O(log n) but linear is fine — runs are
    // typically a few thousand at most for a one-page resume.
    for (let i = 0; i < runs.length; i++) {
      if (p >= runs[i].flatStart && p < runs[i].flatEnd) return i;
    }
    return -1;
  };

  for (const match of matches) {
    const startRun = runForFlat(match.start);
    const endRun =
      match.end > 0 ? runForFlat(match.end - 1) : startRun;
    if (startRun < 0 || endRun < 0) continue;
    const startOff = match.start - runs[startRun].flatStart;
    const endOff = match.end - runs[endRun].flatStart;
    if (startRun === endRun) {
      const original = runOverrides.get(startRun) ?? runs[startRun].text;
      // Use the SAME casing-mapping logic in case the run was already
      // partly rewritten by an earlier match.
      const before = original.slice(0, startOff);
      const after = original.slice(endOff);
      runOverrides.set(startRun, before + newText + after);
    } else {
      // Multi-run replacement: keep the first run's prefix, set the
      // newText into the first run, and clear runs in the middle and
      // the trailing portion of the last run.
      const firstOriginal = runOverrides.get(startRun) ?? runs[startRun].text;
      const lastOriginal = runOverrides.get(endRun) ?? runs[endRun].text;
      runOverrides.set(startRun, firstOriginal.slice(0, startOff) + newText);
      for (let i = startRun + 1; i < endRun; i++) {
        runOverrides.set(i, '');
      }
      runOverrides.set(endRun, lastOriginal.slice(endOff));
    }
  }

  // Re-emit XML: walk runs in reverse order so we can splice without
  // invalidating earlier offsets.
  let result = xml;
  for (let i = runs.length - 1; i >= 0; i--) {
    if (!runOverrides.has(i)) continue;
    const updated = runOverrides.get(i)!
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
    const r = runs[i];
    result = result.slice(0, r.xmlOpenEnd) + updated + result.slice(r.xmlCloseStart);
  }

  return { xml: result, replacements: matches.length };
}

/**
 * Strip the "ADDITIONAL" / "ADDITIONAL INFORMATION" section from the
 * docx XML. Used as a last-resort space-recovery tier in the tailor
 * ladder: when no budget tier fits 1 page, we drop this section to
 * reclaim ~6-10 vertical lines and retry the most-aggressive injection
 * budget. The section is the lowest-signal block on the resume (one-off
 * mentions of conferences, hobbies, languages spoken, etc.) — losing it
 * is preferable to losing user-selected keywords or overflowing to a
 * second page.
 *
 * The function walks the XML to find a bordered section header whose
 * text starts with "ADDITIONAL". It then deletes everything from that
 * header's `<w:p ...>` opening up to (but not including) the next
 * bordered section header, OR end of body if it's the last section.
 *
 * Returns the modified XML and a boolean indicating whether a removal
 * happened. If no ADDITIONAL section is found, the original XML is
 * returned unchanged.
 */
export function removeAdditionalSection(xml: string): { xml: string; removed: boolean } {
  // The Word XML wraps section header text inside a paragraph that
  // also has a bottom border (`<w:pBdr>`). Searching for a paragraph
  // with both signals — a `<w:pBdr>` AND a `<w:t>` whose content begins
  // with "ADDITIONAL" — is precise enough to avoid false positives like
  // a bullet that happens to mention the word "additional".
  const re = /<w:p\b[\s\S]*?<\/w:p>/g;
  let match: RegExpExecArray | null;
  let headerStart = -1;
  let nextHeaderStart = -1;
  const bordered: { start: number; end: number; isAdditional: boolean }[] = [];
  while ((match = re.exec(xml)) !== null) {
    const para = match[0];
    if (!para.includes('<w:pBdr>')) continue;
    const start = match.index;
    const end = start + para.length;
    // Extract concatenated text of the paragraph for the heading-name
    // match. Strip XML, keep alpha + space.
    const text = para
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .toUpperCase();
    const isAdditional = /^ADDITIONAL\b/.test(text);
    bordered.push({ start, end, isAdditional });
  }
  for (let i = 0; i < bordered.length; i++) {
    if (!bordered[i].isAdditional) continue;
    headerStart = bordered[i].start;
    // The section we're stripping runs from `headerStart` up to the
    // start of the NEXT bordered section header — or end-of-body.
    nextHeaderStart = i + 1 < bordered.length ? bordered[i + 1].start : -1;
    break;
  }
  if (headerStart < 0) return { xml, removed: false };

  // Find the body close tag to bound the strip on the "last section" path.
  const bodyClose = xml.lastIndexOf('</w:body>');
  const cutEnd = nextHeaderStart > 0 ? nextHeaderStart : bodyClose >= 0 ? bodyClose : xml.length;

  return {
    xml: xml.substring(0, headerStart) + xml.substring(cutEnd),
    removed: true,
  };
}

/**
 * Adjust docx XML spacing to compensate for LibreOffice rendering
 * differences vs Microsoft Word AND to make the rendered page look
 * visually balanced (equal whitespace at the top, before the name,
 * and at the bottom, after the SKILLS section).
 *
 * 1. **Balanced margins.** Both top and bottom page margins set to
 *    300 twips (~0.21"). Original was 420/420; an earlier iteration
 *    tightened top to 260 to recover space, which left an
 *    asymmetric ~0.18" top vs ~0.29" bottom. Setting both to 300
 *    actually gives MORE content room than the asymmetric variant
 *    (600 vs 680 total), so any budget tier that fit before still
 *    fits — and the visible whitespace is now symmetric.
 *
 * 2. **Vertical-center the section.** `<w:vAlign w:val="center"/>`
 *    on the sectPr tells Word/LibreOffice to center content between
 *    the top and bottom margins. With balanced margins (#1), any
 *    free space at the bottom of a short page splits evenly above
 *    and below the content — eliminating the "tight top, fat bottom
 *    whitespace" look the user flagged.
 *
 * 3. **Bordered-header `w:after` legacy bump.** Kept as a safety net
 *    for any docx path that bypasses editDocxTemplate() and still
 *    ships `w:after=14`. The main pipeline already bumps this to 80
 *    via increaseSectionSpacing().
 */
export async function adjustDocxForLibreOffice(docxBuffer: Buffer): Promise<Buffer> {
  const zip = await JSZip.loadAsync(docxBuffer);
  const docXmlFile = zip.file('word/document.xml');
  if (!docXmlFile) return docxBuffer;

  let xml = await docXmlFile.async('string');

  // 1. Force balanced top + bottom margins to 300 twips each (~0.21").
  //    Whatever the source docx had (we've seen 420 and 836 in the
  //    wild), normalize so the rendered page has symmetric whitespace.
  //    Total margins (600 twips) are tighter than typical defaults so
  //    1-page fits from the budget ladder don't regress.
  xml = xml.replace(
    /(<w:pgMar\s[^>]*?)w:top="\d+"/,
    '$1w:top="300"'
  );
  xml = xml.replace(
    /(<w:pgMar\s[^>]*?)w:bottom="\d+"/,
    '$1w:bottom="300"'
  );

  // 2. Vertical-center the section. Insert `<w:vAlign w:val="center"/>`
  //    into the existing <w:sectPr> if it isn't already there. Word
  //    accepts the element anywhere inside sectPr; we inject just
  //    before the closing tag to avoid disturbing element ordering.
  if (!/<w:vAlign\s+w:val=/.test(xml)) {
    xml = xml.replace(
      /<\/w:sectPr>/,
      '<w:vAlign w:val="center"/></w:sectPr>',
    );
  }

  // 3. Legacy w:after bump 14→25 for bordered section headers (see
  //    docstring above — main pipeline supersedes this for tailored
  //    docs but the safety net stays for direct-passthrough callers).
  xml = xml.replace(/<w:p[ >].*?<\/w:p>/gs, (para) => {
    if (!para.includes('<w:pBdr>')) return para;
    return para.replace(
      /(<w:spacing\s+)w:after="14"/,
      '$1w:after="25"'
    );
  });

  zip.file('word/document.xml', xml);
  return Buffer.from(await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }));
}

export interface DocxEditResult {
  buffer: Buffer;
  addedKeywords: string[];
  changesSummary: string[];
}

export interface DocxEditOptions {
  /** Full JD text. When supplied (together with `workExpBudget`), the
   *  editor will also inject relevant missing keywords as NEW bullets
   *  into the Work Experience section of the resume. Without the JD we
   *  can't score per-position relevance, so the injector is disabled. */
  jdContent?: string;
  /** Budget for work-experience injection. When omitted or set to zero
   *  positions/keywords, the editor skips work-experience injection
   *  and only edits Summary + Skills (legacy behavior). */
  workExpBudget?: WorkExperienceBudget;
  /** Override the source docx bytes. When omitted, the editor resolves
   *  the user's active resume via `resolveDocxTemplatePath()`. The
   *  override is used by the tailor route's "remove ADDITIONAL section
   *  and retry" tier — it pre-strips the section from the template and
   *  passes the slimmer buffer here so all downstream edits operate on
   *  the same bytes the LibreOffice page-count gate ultimately checks. */
  baseDocxBytes?: Buffer;
  /** Find/replace pairs to apply across the body text BEFORE any other
   *  edit. Used by `replace-text` suggestions (e.g. align an existing
   *  role title to the JD's verbatim form). Replacement happens across
   *  formatting-run boundaries via `replaceTextInDocx`. */
  replaceTexts?: { oldText: string; newText: string }[];
  /** Extra Skills entries to append to specific Skills lines, beyond
   *  what the missing-keywords flow would add. Used by `append-skills`
   *  suggestions. */
  extraSkills?: {
    cloudStack?: string[];
    systems?: string[];
    management?: string[];
    domain?: string[];
  };
}

/**
 * Edit the docx template with the keyword changes from the tailor engine.
 *
 * @param missingKeywords - Map of category → keyword list
 * @param summaryPhrase - Short phrase to append to Summary (or empty)
 * @param opts - Optional: JD content + work-experience budget. When
 *               both are supplied, the editor also adds one new bullet
 *               under each topically-relevant position. Fully optional
 *               for backward compat — existing callers get the original
 *               Summary+Skills-only behavior.
 */
export async function editDocxTemplate(
  missingKeywords: Record<string, string[]>,
  summaryPhrase: string,
  opts: DocxEditOptions = {},
): Promise<DocxEditResult> {
  // When the caller supplies pre-loaded bytes (e.g. ADDITIONAL section
  // already stripped), use those; otherwise fall back to the user's
  // active resume on disk.
  let templateBytes: Buffer;
  if (opts.baseDocxBytes) {
    templateBytes = opts.baseDocxBytes;
  } else {
    const templatePath = await resolveDocxTemplatePath();
    if (!templatePath) {
      throw new Error(
        'No .docx resume found. PDF-only resumes cannot be tailored because the editor works at the Word-XML level. ' +
        'Please upload a .docx version of your resume in Settings.'
      );
    }
    templateBytes = await readFile(templatePath);
  }
  const zip = await JSZip.loadAsync(templateBytes);

  const docXmlFile = zip.file('word/document.xml');
  if (!docXmlFile) throw new Error('Invalid docx: missing word/document.xml');

  let xml = await docXmlFile.async('string');
  const addedKeywords: string[] = [];
  const changesSummary: string[] = [];

  // -1. Apply find/replace operations from `replace-text` suggestions
  //     (e.g. align an existing role title to the JD's wording). We
  //     run this BEFORE merging position headers so cross-run text
  //     swaps see the original run boundaries and aren't confused by
  //     the merged-header rewrite.
  if (opts.replaceTexts && opts.replaceTexts.length > 0) {
    for (const { oldText, newText } of opts.replaceTexts) {
      const r = replaceTextInDocx(xml, oldText, newText);
      if (r.replacements > 0) {
        xml = r.xml;
        changesSummary.push(
          `Replaced "${oldText}" → "${newText}" (${r.replacements} occurrence${r.replacements === 1 ? '' : 's'})`,
        );
      }
    }
  }

  // 0. Merge each position's title + subtitle paragraphs into one line.
  //    Reclaims ~1 line per position (5 lines on this template) — that
  //    headroom is what lets subsequent Skills/Summary/Work-Experience
  //    additions stay on one page. Runs first so later XML edits don't
  //    have to work around stale paragraph boundaries.
  const mergeResult = mergePositionHeaders(xml);
  if (mergeResult.merged > 0) {
    xml = mergeResult.xml;
    changesSummary.push(`Merged ${mergeResult.merged} position header line(s) into one-line format`);
  }

  // 0.5. Increase vertical padding before each bordered section header
  //      (SUMMARY, WORK EXPERIENCE, EDUCATION, SKILLS, ADDITIONAL) so
  //      the reader sees a clear visual break between sections.
  xml = increaseSectionSpacing(xml);

  // 1. Technical keywords — split per-keyword between Cloud & Stack
  //    (concrete tools/platforms/languages) and Systems & Architecture
  //    (design concepts/patterns) so each lands where it reads naturally.
  //    Suggestion-driven extras for these two lines are merged in here
  //    so they share the same de-dupe path inside `appendToSkillsLine`.
  const cloudBucket: string[] = [...(opts.extraSkills?.cloudStack ?? [])];
  const systemsBucket: string[] = [...(opts.extraSkills?.systems ?? [])];
  if (missingKeywords.technical?.length > 0) {
    for (const kw of missingKeywords.technical) {
      (classifyTechnical(kw) === 'systems' ? systemsBucket : cloudBucket).push(kw);
    }
  }
  if (cloudBucket.length > 0) {
    const r = appendToSkillsLine(xml, SKILLS_LABELS.cloudStack, cloudBucket);
    if (r.appended) {
      xml = r.xml;
      addedKeywords.push(...cloudBucket);
      changesSummary.push(`Appended ${cloudBucket.length} keyword(s) to Cloud & Stack`);
    }
  }
  if (systemsBucket.length > 0) {
    const r = appendToSkillsLine(xml, SKILLS_LABELS.systems, systemsBucket);
    if (r.appended) {
      xml = r.xml;
      addedKeywords.push(...systemsBucket);
      changesSummary.push(`Appended ${systemsBucket.length} keyword(s) to Systems & Architecture`);
    }
  }

  // 2. Management + soft keywords → Leadership line. Merging keeps all
  //    people/leadership signals in one place and leaves the dedicated
  //    technical lines uncluttered. Suggestion-driven extras land here
  //    too.
  const leadershipBucket = [
    ...(opts.extraSkills?.management ?? []),
    ...(missingKeywords.management ?? []),
    ...(missingKeywords.soft ?? []),
  ];
  if (leadershipBucket.length > 0) {
    const r = appendToSkillsLine(xml, SKILLS_LABELS.management, leadershipBucket);
    if (r.appended) {
      xml = r.xml;
      addedKeywords.push(...leadershipBucket);
      changesSummary.push(`Appended ${leadershipBucket.length} keyword(s) to Leadership`);
    }
  }

  // 3. Append domain keywords (incl. suggestion-driven extras) to AI / ML line.
  const domainBucket = [
    ...(opts.extraSkills?.domain ?? []),
    ...(missingKeywords.domain ?? []),
  ];
  if (domainBucket.length > 0) {
    const result = appendToSkillsLine(xml, SKILLS_LABELS.domain, domainBucket);
    if (result.appended) {
      xml = result.xml;
      addedKeywords.push(...domainBucket);
      changesSummary.push(`Appended ${domainBucket.length} keyword(s) to AI / ML`);
    }
  }

  // 4. Append a short, complete-sentence phrase to the Summary. This is
  //    one of two places where we add prose (not a keyword list); the
  //    phrase is constructed by buildSummaryPhrase() to read as a
  //    natural sentence continuation.
  if (summaryPhrase) {
    xml = appendToSummary(xml, summaryPhrase);
    changesSummary.push(`Added short phrase to Summary`);
  }

  // 5. (Optional) Inject new bullets into the Work Experience section.
  //    Only runs when the caller supplies BOTH the JD content (for
  //    per-position relevance scoring) and a non-zero budget. Keywords
  //    already appended to Summary/Skills stay eligible here because
  //    the injector independently scores relevance per position and
  //    will skip keywords already present in the bullet text. This is
  //    the last XML edit we do so its offset bookkeeping doesn't have
  //    to worry about later edits invalidating its insertion points.
  if (opts.jdContent && opts.workExpBudget && opts.workExpBudget.maxPositions > 0) {
    const injection = injectIntoWorkExperience(
      xml,
      missingKeywords,
      opts.jdContent,
      opts.workExpBudget,
    );
    if (injection.bulletsAdded > 0) {
      xml = injection.xml;
      // Dedupe against what we already appended elsewhere — a keyword
      // could have landed in both Skills AND a Work Experience bullet,
      // which is the intended behavior (Skills for scanability, a
      // bullet for context) but we don't want to double-count it in
      // the addedKeywords list returned to the UI.
      for (const kw of injection.addedKeywords) {
        if (!addedKeywords.includes(kw)) addedKeywords.push(kw);
      }
      changesSummary.push(...injection.changesSummary);
    }
  }

  // Write modified XML back
  zip.file('word/document.xml', xml);
  const buffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });

  return { buffer, addedKeywords, changesSummary };
}
