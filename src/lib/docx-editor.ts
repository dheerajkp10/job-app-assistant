/**
 * Docx template editor — modifies the user's original .docx resume
 * by surgically editing the XML, preserving all formatting, fonts, and layout.
 *
 * Uses jszip to unzip, edit word/document.xml, and rezip.
 */

import { readFile } from 'fs/promises';
import { join } from 'path';
import JSZip from 'jszip';

const TEMPLATE_PATH = join(process.cwd(), 'data', 'resume', 'template.docx');

/**
 * Skills category labels as they appear in the docx.
 * We'll match these in the XML text runs.
 */
const SKILLS_LABELS: Record<string, string[]> = {
  technical: ['Cloud &amp; Stack:', 'Cloud & Stack:', 'Systems &amp; Architecture:', 'Systems & Architecture:'],
  management: ['Leadership:'],
  domain: ['AI / ML:', 'AI/ML:'],
  soft: ['Leadership:'],  // soft skills go into Leadership line too
};

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

    // Append keywords
    const addition = keywords.map(k =>
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
  const templateBytes = await readFile(TEMPLATE_PATH);
  const zip = await JSZip.loadAsync(templateBytes);

  const docXmlFile = zip.file('word/document.xml');
  if (!docXmlFile) throw new Error('Invalid docx: missing word/document.xml');

  let xml = await docXmlFile.async('string');
  const addedKeywords: string[] = [];
  const changesSummary: string[] = [];

  // 1. Append technical keywords to Cloud & Stack or Systems & Architecture line
  if (missingKeywords.technical?.length > 0) {
    const result = appendToSkillsLine(xml, SKILLS_LABELS.technical, missingKeywords.technical);
    if (result.appended) {
      xml = result.xml;
      addedKeywords.push(...missingKeywords.technical);
      changesSummary.push(`Appended ${missingKeywords.technical.length} technical keywords to Skills`);
    }
  }

  // 2. Append management keywords to Leadership line
  if (missingKeywords.management?.length > 0) {
    const result = appendToSkillsLine(xml, SKILLS_LABELS.management, missingKeywords.management);
    if (result.appended) {
      xml = result.xml;
      addedKeywords.push(...missingKeywords.management);
      changesSummary.push(`Appended ${missingKeywords.management.length} management keywords to Skills`);
    }
  }

  // 3. Append domain keywords to AI / ML line
  if (missingKeywords.domain?.length > 0) {
    const result = appendToSkillsLine(xml, SKILLS_LABELS.domain, missingKeywords.domain);
    if (result.appended) {
      xml = result.xml;
      addedKeywords.push(...missingKeywords.domain);
      changesSummary.push(`Appended ${missingKeywords.domain.length} domain keywords to AI/ML Skills`);
    }
  }

  // 4. Append summary phrase
  if (summaryPhrase) {
    xml = appendToSummary(xml, summaryPhrase);
    changesSummary.push(`Added short phrase to Summary`);
  }

  // Write modified XML back
  zip.file('word/document.xml', xml);
  const buffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });

  return { buffer, addedKeywords, changesSummary };
}
