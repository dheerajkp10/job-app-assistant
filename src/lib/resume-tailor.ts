/**
 * Resume tailoring engine.
 * Conservative keyword optimization — injects missing JD keywords into the existing
 * Skills lines and Summary without changing the resume structure or length significantly.
 *
 * GUARDRAIL: The tailored resume is re-scored and MUST score >= original. If it doesn't,
 * the engine falls back to the original text (should never happen since we only add).
 */

import { extractKeywords, scoreResume, type ATSScore } from './ats-scorer';

// ─── Resume Section Parsing ──────────────────────────────────────────

interface ResumeSection {
  header: string;
  content: string;
  type: 'summary' | 'experience' | 'skills' | 'education' | 'certifications' | 'other';
}

const SECTION_PATTERNS: { type: ResumeSection['type']; pattern: RegExp }[] = [
  { type: 'summary', pattern: /^(summary|professional summary|profile|objective|about|overview)\b/i },
  { type: 'experience', pattern: /^(experience|work experience|professional experience|employment|work history)\b/i },
  { type: 'skills', pattern: /^(skills|technical skills|core competencies|competencies|technologies|tech stack|tools & technologies|areas of expertise)\b/i },
  { type: 'education', pattern: /^(education|academic|degrees|qualifications)\b/i },
  { type: 'certifications', pattern: /^(certifications?|licenses?|credentials)\b/i },
];

function parseResumeSections(text: string): ResumeSection[] {
  const lines = text.split('\n');
  const sections: ResumeSection[] = [];
  let currentSection: ResumeSection | null = null;
  let contentLines: string[] = [];

  const flushSection = () => {
    if (currentSection) {
      currentSection.content = contentLines.join('\n').trim();
      if (currentSection.content) sections.push(currentSection);
    }
  };

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) { contentLines.push(''); continue; }

    const isHeader = trimmed.length < 60 && (
      SECTION_PATTERNS.some(sp => sp.pattern.test(trimmed)) ||
      (trimmed === trimmed.toUpperCase() && trimmed.length > 3 && /^[A-Z\s&/]+$/.test(trimmed))
    );

    if (isHeader) {
      flushSection();
      const matchedType = SECTION_PATTERNS.find(sp => sp.pattern.test(trimmed));
      currentSection = { header: trimmed, content: '', type: matchedType?.type || 'other' };
      contentLines = [];
    } else {
      if (!currentSection) currentSection = { header: '', content: '', type: 'summary' };
      contentLines.push(line);
    }
  }
  flushSection();
  return sections;
}

// ─── Types ───────────────────────────────────────────────────────────

export interface TailoredResume {
  text: string;
  addedKeywords: string[];
  originalScore: ATSScore;
  tailoredScore: ATSScore;
  changesSummary: string[];
}

function displayName(keyword: string): string {
  return keyword.split(/[-_]/).map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

function joinNatural(items: string[]): string {
  if (items.length === 0) return '';
  if (items.length === 1) return items[0];
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return items.slice(0, -1).join(', ') + ', and ' + items[items.length - 1];
}

/**
 * Build a natural, cohesive summary phrase from domain and soft skill keywords.
 * The phrase reads as a continuation of the existing summary paragraph.
 */
export function buildSummaryPhrase(domainKeywords: string[], softKeywords: string[]): string {
  const domains = domainKeywords.map(displayName);
  const softs = softKeywords.map(displayName);

  if (domains.length > 0 && softs.length > 0) {
    return `Proven track record of driving engineering impact across ${joinNatural(domains)}, with demonstrated strength in ${joinNatural(softs)}.`;
  }
  if (domains.length > 0) {
    return `Proven track record of driving engineering impact across ${joinNatural(domains)}.`;
  }
  if (softs.length > 0) {
    return `Demonstrated strength in ${joinNatural(softs)}.`;
  }
  return '';
}

// ─── Core Tailoring ──────────────────────────────────────────────────

/**
 * Tailor a resume for a specific job description.
 *
 * Conservative strategy:
 * 1. Identify missing keywords (in JD but not in resume)
 * 2. SKILLS SECTION: Append missing keywords to existing skill lines, keeping the
 *    same line structure. If a "Technical:" or "Cloud:" line exists, append to it.
 *    Otherwise add a minimal comma-separated line.
 * 3. SUMMARY: Append a natural, cohesive phrase with top missing domain/soft keywords.
 *    Keep it concise to avoid changing resume length significantly.
 * 4. DO NOT touch Experience, Education, or any other section.
 * 5. GUARDRAIL: Re-score. If tailored score < original, return original unchanged.
 *
 * @param selectedKeywords - If provided, only use these keywords (user deselected some)
 */
export function tailorResume(
  resumeText: string,
  jobDescription: string,
  jobTitle: string,
  company: string,
  selectedKeywords?: string[]
): TailoredResume {
  const originalScore = scoreResume(resumeText, jobDescription);
  const jdKeywords = extractKeywords(jobDescription);
  const resumeKeywords = extractKeywords(resumeText);

  // Find missing keywords by category
  const missing: Record<string, string[]> = { technical: [], management: [], domain: [], soft: [] };
  for (const [keyword, category] of jdKeywords) {
    if (!resumeKeywords.has(keyword)) {
      // If selectedKeywords provided, only include those the user selected
      if (selectedKeywords && !selectedKeywords.includes(keyword)) continue;
      missing[category].push(keyword);
    }
  }

  const sections = parseResumeSections(resumeText);
  const addedKeywords: string[] = [];
  const changesSummary: string[] = [];

  // ─── 1. Enhance Skills Section (conservative append) ─────────
  const skillsSection = sections.find(s => s.type === 'skills');
  const techMissing = missing.technical;
  const mgmtMissing = missing.management;

  if (skillsSection && (techMissing.length > 0 || mgmtMissing.length > 0)) {
    const lines = skillsSection.content.split('\n');

    // Try to find existing category lines and append to them
    let techAppended = false;
    let mgmtAppended = false;

    for (let i = 0; i < lines.length; i++) {
      const lower = lines[i].toLowerCase();
      // Append tech keywords to lines containing tech-related labels
      if (!techAppended && techMissing.length > 0 && (
        /^(technical|cloud|infrastructure|languages|frameworks|tools|platform|data|backend|frontend)/i.test(lower.trim()) ||
        lower.includes('aws') || lower.includes('python') || lower.includes('java')
      )) {
        const addition = techMissing.map(displayName).join(', ');
        lines[i] = lines[i].trimEnd().replace(/\.?\s*$/, '') + ', ' + addition;
        addedKeywords.push(...techMissing);
        techAppended = true;
        changesSummary.push(`Appended ${techMissing.length} technical keywords to existing skills line`);
      }
      // Append management keywords to lines containing mgmt-related labels
      if (!mgmtAppended && mgmtMissing.length > 0 && (
        /^(management|leadership|people|process|agile)/i.test(lower.trim()) ||
        lower.includes('agile') || lower.includes('mentoring') || lower.includes('hiring')
      )) {
        const addition = mgmtMissing.map(displayName).join(', ');
        lines[i] = lines[i].trimEnd().replace(/\.?\s*$/, '') + ', ' + addition;
        addedKeywords.push(...mgmtMissing);
        mgmtAppended = true;
        changesSummary.push(`Appended ${mgmtMissing.length} management keywords to existing skills line`);
      }
    }

    // If we couldn't find matching lines, append new lines at end
    if (!techAppended && techMissing.length > 0) {
      lines.push(`Additional Technical: ${techMissing.map(displayName).join(', ')}`);
      addedKeywords.push(...techMissing);
      changesSummary.push(`Added ${techMissing.length} technical keywords to Skills`);
    }
    if (!mgmtAppended && mgmtMissing.length > 0) {
      lines.push(`Additional Management: ${mgmtMissing.map(displayName).join(', ')}`);
      addedKeywords.push(...mgmtMissing);
      changesSummary.push(`Added ${mgmtMissing.length} management keywords to Skills`);
    }

    skillsSection.content = lines.join('\n');
  }

  // ─── 2. Enhance Summary (cohesive, natural phrase) ────────────
  const summarySection = sections.find(s => s.type === 'summary');
  const domainMissing = missing.domain.slice(0, 4); // max 4 keywords
  const softMissing = missing.soft.slice(0, 2);      // max 2 soft skills

  if (summarySection && (domainMissing.length > 0 || softMissing.length > 0)) {
    const phrase = buildSummaryPhrase(domainMissing, softMissing);
    if (phrase) {
      summarySection.content = summarySection.content.trimEnd() + ' ' + phrase;
      addedKeywords.push(...domainMissing, ...softMissing);
      changesSummary.push(`Added ${domainMissing.length + softMissing.length} keywords to Summary`);
    }
  }

  // ─── 3. Reassemble (preserve original structure) ──────────────
  const tailoredText = sections
    .map(s => s.header ? `${s.header}\n${s.content}` : s.content)
    .join('\n\n');

  // ─── 4. GUARDRAIL: Re-score and validate improvement ──────────
  const tailoredScore = scoreResume(tailoredText, jobDescription);

  // CRITICAL: Score must NEVER degrade. If it does, return original unchanged.
  if (tailoredScore.overall < originalScore.overall) {
    return {
      text: resumeText,
      addedKeywords: [],
      originalScore,
      tailoredScore: originalScore,
      changesSummary: ['Resume already well-optimized — no changes needed to improve score.'],
    };
  }

  if (changesSummary.length === 0) {
    changesSummary.push('Resume already well-optimized for this job description');
  }

  return { text: tailoredText, addedKeywords, originalScore, tailoredScore, changesSummary };
}
