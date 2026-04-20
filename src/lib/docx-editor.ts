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
 * Adjust docx XML spacing to compensate for LibreOffice rendering
 * differences vs Microsoft Word.
 *
 * 1. Top margin +42 twips aligns all section headers to Word positions.
 * 2. Increase w:after on bordered section headers (SUMMARY, WORK EXPERIENCE,
 *    etc.) to add a little more padding below the blue divider line,
 *    matching the visual spacing of the Word-exported original.
 */
export async function adjustDocxForLibreOffice(docxBuffer: Buffer): Promise<Buffer> {
  const zip = await JSZip.loadAsync(docxBuffer);
  const docXmlFile = zip.file('word/document.xml');
  if (!docXmlFile) return docxBuffer;

  let xml = await docXmlFile.async('string');

  // 1. Increase top margin by 42 twips (2.1pt)
  xml = xml.replace(
    /(<w:pgMar\s[^>]*?)w:top="420"/,
    '$1w:top="462"'
  );

  // 2. Increase w:after on bordered section headers from 14→25.
  //    Adds a small amount of padding below the blue divider line
  //    to match the visual spacing of the Word-exported original.
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

/**
 * Edit the docx template with the keyword changes from the tailor engine.
 *
 * @param missingKeywords - Map of category → keyword list
 * @param summaryPhrase - Short phrase to append to Summary (or empty)
 */
export async function editDocxTemplate(
  missingKeywords: Record<string, string[]>,
  summaryPhrase: string
): Promise<DocxEditResult> {
  const templatePath = await resolveDocxTemplatePath();
  if (!templatePath) {
    throw new Error(
      'No .docx resume found. PDF-only resumes cannot be tailored because the editor works at the Word-XML level. ' +
      'Please upload a .docx version of your resume in Settings.'
    );
  }
  const templateBytes = await readFile(templatePath);
  const zip = await JSZip.loadAsync(templateBytes);

  const docXmlFile = zip.file('word/document.xml');
  if (!docXmlFile) throw new Error('Invalid docx: missing word/document.xml');

  let xml = await docXmlFile.async('string');
  const addedKeywords: string[] = [];
  const changesSummary: string[] = [];

  // 1. Technical keywords — split per-keyword between Cloud & Stack
  //    (concrete tools/platforms/languages) and Systems & Architecture
  //    (design concepts/patterns) so each lands where it reads naturally.
  if (missingKeywords.technical?.length > 0) {
    const cloudBucket: string[] = [];
    const systemsBucket: string[] = [];
    for (const kw of missingKeywords.technical) {
      (classifyTechnical(kw) === 'systems' ? systemsBucket : cloudBucket).push(kw);
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
  }

  // 2. Management + soft keywords → Leadership line. Merging keeps all
  //    people/leadership signals in one place and leaves the dedicated
  //    technical lines uncluttered.
  const leadershipBucket = [
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

  // 3. Append domain keywords to AI / ML line
  if (missingKeywords.domain?.length > 0) {
    const result = appendToSkillsLine(xml, SKILLS_LABELS.domain, missingKeywords.domain);
    if (result.appended) {
      xml = result.xml;
      addedKeywords.push(...missingKeywords.domain);
      changesSummary.push(`Appended ${missingKeywords.domain.length} keyword(s) to AI / ML`);
    }
  }

  // 4. Append a short, complete-sentence phrase to the Summary. This is
  //    the only place where we add prose (not a keyword list); the phrase
  //    is constructed by buildSummaryPhrase() to read as a natural
  //    sentence continuation.
  if (summaryPhrase) {
    xml = appendToSummary(xml, summaryPhrase);
    changesSummary.push(`Added short phrase to Summary`);
  }

  // Write modified XML back
  zip.file('word/document.xml', xml);
  const buffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });

  return { buffer, addedKeywords, changesSummary };
}
