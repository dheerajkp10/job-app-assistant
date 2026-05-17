/**
 * Resume tailoring engine.
 * Conservative keyword optimization — injects missing JD keywords into the existing
 * Skills lines and Summary without changing the resume structure or length significantly.
 *
 * GUARDRAIL: The tailored resume is re-scored and MUST score >= original. If it doesn't,
 * the engine falls back to the original text (should never happen since we only add).
 */

import { extractKeywords, scoreResume, type ATSScore } from './ats-scorer';
import { tokenizeSkillsLine, mergeSkillsTokens } from './keyword-dedup';

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

/**
 * Append new keywords to a skills line in the form "Label: a, b, c"
 * while running them through the alias-aware dedup (keyword-dedup
 * module). Preserves the leading "Label:" prefix and any trailing
 * punctuation so the line still reads naturally.
 */
function appendKeywordsToSkillsLine(line: string, newKeywords: string[]): string {
  // Split off an optional "Label:" prefix so we only dedup the values.
  const colonIdx = line.indexOf(':');
  const prefix = colonIdx >= 0 ? line.slice(0, colonIdx + 1) + ' ' : '';
  const body = colonIdx >= 0 ? line.slice(colonIdx + 1) : line;

  const trimmed = body.trim();
  const trailingPunct = trimmed.match(/[.,;]\s*$/)?.[0] ?? '';
  const trimmedBody = trimmed.replace(/[.,;]\s*$/, '');

  const existingTokens = tokenizeSkillsLine(trimmedBody);
  const merged = mergeSkillsTokens(existingTokens, newKeywords);
  return prefix + merged.join(', ') + trailingPunct;
}

function joinNatural(items: string[]): string {
  if (items.length === 0) return '';
  if (items.length === 1) return items[0];
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return items.slice(0, -1).join(', ') + ', and ' + items[items.length - 1];
}

// ─── Summary phrase templates ────────────────────────────────────────
//
// Rather than always emitting a single stock sentence ("Proven track
// record of driving engineering impact across X, Y and Z…"), we keep a
// palette of formal resume-style sentence patterns and pick one
// deterministically based on the keyword set. This gives variety
// across jobs while staying idempotent for any given JD (same
// keywords → same phrase), which matters because `tailorResume()`
// re-scores the output and bails if the score regresses — a
// non-deterministic summary could flap between runs.
//
// All templates meet three constraints:
//  1. They are complete, grammatical sentences.
//  2. They embed the keyword tokens verbatim (ATS parsers match
//     exact substrings; paraphrasing the keywords would drop ATS
//     credit even if it reads nicely).
//  3. They sound like prose a recruiter would expect in a Summary
//     / Profile section — no marketing fluff, no first-person voice.

type TemplateFn = (phrase: string) => string;

// Sentence patterns used when we have BOTH domain expertise and soft
// skills to inject. `${D}` is a natural-language list of domain
// keywords; `${S}` is the same for soft skills.
//
// IMPORTANT: every template wraps ${d} with a noun suffix like
// "domains" / "areas" / "workstreams". Domain keywords coming out of
// extractKeywords() can be bare adjectives ("Autonomous",
// "Financial") — inserting them verbatim into phrases like
// "Career spans Autonomous, operating across…" reads as a broken
// fragment. A noun-suffix wrapper ("Autonomous domains",
// "Financial areas") keeps the sentence grammatical for any
// adjective/noun shape without having to filter the keyword list.
const DOMAIN_AND_SOFT_TEMPLATES: ((d: string, s: string) => string)[] = [
  (d, s) => `Delivers measurable outcomes across ${d} domains, applying ${s} to move programs from strategy to execution.`,
  (d, s) => `Brings hands-on experience in ${d} areas, paired with ${s} that scale teams and accelerate delivery.`,
  (d, s) => `Leads cross-functional initiatives across ${d} domains, drawing on ${s} to align organizations and ship complex work.`,
  (d, s) => `Combines deep expertise in ${d} domains with ${s} to raise the engineering bar and unblock high-stakes delivery.`,
  (d, s) => `Recognized for driving outcomes across ${d} domains; operates with ${s} in fast-moving, ambiguous environments.`,
  (d, s) => `Experience spans ${d} domains, underpinned by ${s} that translate vision into durable, production-grade systems.`,
  (d, s) => `Track record of owning initiatives in ${d} workstreams, applying ${s} to partner with stakeholders and deliver at scale.`,
  (d, s) => `Shipping leadership across ${d} domains, reinforced by ${s} that build lasting velocity across teams.`,
];

// Patterns used when only domain keywords are missing. See the
// DOMAIN_AND_SOFT_TEMPLATES comment above — same noun-suffix rule
// applies so single-adjective keywords ("Autonomous") don't produce
// broken fragments like "Career spans Autonomous, …".
const DOMAIN_ONLY_TEMPLATES: TemplateFn[] = [
  (d) => `Deep experience delivering across ${d} domains.`,
  (d) => `Hands-on expertise spans ${d} areas, with a bias toward measurable outcomes.`,
  (d) => `Track record of shipping impactful work across ${d} domains.`,
  (d) => `Leads initiatives across ${d} workstreams, owning technical direction end-to-end.`,
  (d) => `Experienced across ${d} domains, with a focus on durable, production-grade systems.`,
  (d) => `Career spans ${d} domains, operating across full delivery lifecycles.`,
];

// Patterns used when only soft / leadership keywords are missing.
const SOFT_ONLY_TEMPLATES: TemplateFn[] = [
  (s) => `Operates with ${s} to align teams and deliver outcomes at scale.`,
  (s) => `Known for ${s} in ambiguous, fast-moving environments.`,
  (s) => `Leverages ${s} to partner across functions and execute with precision.`,
  (s) => `Applies ${s} to unblock teams and translate strategy into execution.`,
  (s) => `Brings ${s} to organizations navigating rapid growth and change.`,
];

/**
 * Stable, order-independent hash used to pick a template. We sort the
 * keyword list first so the choice depends on the SET of keywords (not
 * the order they arrived in), and mix in category flags so a
 * domain-only call and a soft-only call with the same strings don't
 * collide on the same template index.
 */
function pickIndex(keywords: string[], bucket: string, modulo: number): number {
  const sorted = [...keywords].sort();
  const seed = `${bucket}|${sorted.join(',')}`;
  // djb2 — fast, well-distributed, and pure (no deps).
  let hash = 5381;
  for (let i = 0; i < seed.length; i++) {
    hash = ((hash << 5) + hash + seed.charCodeAt(i)) | 0;
  }
  // Force positive in case of int32 overflow.
  return Math.abs(hash) % modulo;
}

/**
 * Build a natural, cohesive summary phrase from domain and soft skill
 * keywords. The output reads as a continuation of the existing summary
 * paragraph and packs every keyword verbatim for ATS matching.
 *
 * The returned sentence is chosen from a palette of formal
 * resume-style patterns; the choice is deterministic (same keyword set
 * → same sentence) so the re-score guardrail in `tailorResume()` stays
 * stable across runs.
 */
export function buildSummaryPhrase(domainKeywords: string[], softKeywords: string[]): string {
  const domains = domainKeywords.map(displayName);
  const softs = softKeywords.map(displayName);

  if (domains.length > 0 && softs.length > 0) {
    const idx = pickIndex([...domains, ...softs], 'both', DOMAIN_AND_SOFT_TEMPLATES.length);
    return DOMAIN_AND_SOFT_TEMPLATES[idx](joinNatural(domains), joinNatural(softs));
  }
  if (domains.length > 0) {
    const idx = pickIndex(domains, 'domain', DOMAIN_ONLY_TEMPLATES.length);
    return DOMAIN_ONLY_TEMPLATES[idx](joinNatural(domains));
  }
  if (softs.length > 0) {
    const idx = pickIndex(softs, 'soft', SOFT_ONLY_TEMPLATES.length);
    return SOFT_ONLY_TEMPLATES[idx](joinNatural(softs));
  }
  return '';
}

// ─── Work-experience bullet templates ────────────────────────────────
//
// These produce a single formal resume bullet embedding the given
// keyword(s) verbatim. The work-experience injector uses these when it
// finds a position whose existing bullets are topically relevant to a
// missing keyword — e.g. "Kubernetes" lands under the role whose
// bullets already talk about infra, not under a pure-management role.
//
// Bullets are written as past-tense, action-first sentences in the
// voice a recruiter would expect in the Experience section, NOT the
// Summary voice used by buildSummaryPhrase. Templates are chosen
// deterministically (djb2-hashed over the sorted keyword set) so
// re-running tailoring on the same JD produces the same bullet.

// Mixed bucket — used when both technical and management keywords
// qualified for the same position. Produces a bullet that connects
// technical execution to people/program leadership, which is the
// common shape of a senior/staff/EM bullet.
const WE_MIXED_TEMPLATES: ((t: string, m: string) => string)[] = [
  (t, m) => `Partnered across engineering, product, and operations to drive programs leveraging ${t}, applying ${m} to scale execution and align cross-functional teams.`,
  (t, m) => `Spearheaded initiatives grounded in ${t} and ${m}, translating strategy into production outcomes and measurable business impact.`,
  (t, m) => `Owned roadmap and delivery for work spanning ${t}, reinforced by ${m} that unblocked teams and sustained predictable velocity.`,
  (t, m) => `Architected and delivered solutions across ${t}; combined with ${m} to raise quality, reliability, and team throughput.`,
  (t, m) => `Drove end-to-end execution on ${t}, pairing technical depth with ${m} to align stakeholders and ship complex work on schedule.`,
];

// Technical-only bucket — also picks up domain/soft tails when the
// primary signal is technical. Past-tense action verbs front-load the
// ATS-relevant keyword(s).
const WE_TECH_TEMPLATES: ((t: string) => string)[] = [
  (t) => `Designed, built, and operated systems across ${t}, driving measurable gains in scalability, reliability, and delivery velocity.`,
  (t) => `Led end-to-end delivery of production solutions leveraging ${t}, shipping on schedule and within quality bars.`,
  (t) => `Served as hands-on contributor and technical lead across ${t}, closing architectural gaps and hardening the platform for scale.`,
  (t) => `Delivered platform improvements spanning ${t}, reducing operational toil and accelerating downstream team velocity.`,
  (t) => `Drove technical direction on ${t}, aligning architecture with product needs and long-term maintainability goals.`,
];

// Management-heavy bucket — used when the position is a leadership
// role and the missing keywords are people/process signals.
const WE_MGMT_TEMPLATES: ((m: string) => string)[] = [
  (m) => `Applied ${m} to align stakeholders, unblock teams, and convert ambiguous strategy into shipped outcomes.`,
  (m) => `Exercised ${m} across multiple workstreams, raising team throughput and sustaining on-time delivery.`,
  (m) => `Led organizations with ${m}, cultivating a durable engineering culture and consistent execution at scale.`,
  (m) => `Scaled teams and programs through ${m}, strengthening hiring, mentorship, and cross-functional partnerships.`,
];

// Domain-heavy bucket — used when the qualifying signal is a domain
// (ML, payments, security, etc.) rather than a concrete tool. Same
// noun-suffix rule as the summary templates: bare adjective
// keywords ("Autonomous") need a noun companion to stay grammatical.
const WE_DOMAIN_TEMPLATES: ((d: string) => string)[] = [
  (d) => `Expanded domain ownership into ${d} areas, translating customer and business needs into working software.`,
  (d) => `Drove initiatives across ${d} domains, bridging technical depth with product and business outcomes.`,
  (d) => `Led efforts across ${d} workstreams, turning emerging requirements into shippable, measurable capabilities.`,
  (d) => `Owned execution of ${d} workstreams, delivering results that compounded into lasting platform capability.`,
];

// Soft-only bucket — fallback when the only qualifying keywords are
// leadership/communication traits.
const WE_SOFT_TEMPLATES: ((s: string) => string)[] = [
  (s) => `Operated with ${s}, building trust with partners and unblocking delivery in fast-moving environments.`,
  (s) => `Leveraged ${s} to align stakeholders across functions and accelerate complex, high-stakes execution.`,
  (s) => `Brought ${s} to ambiguous, cross-functional problems, producing clear plans and shipped outcomes.`,
];

/**
 * Build a formal resume bullet that embeds the given keywords verbatim.
 *
 * `categories` is parallel to `keywords` — each entry tells the builder
 * which bucket that keyword came from (technical/management/domain/soft)
 * so the resulting sentence can be framed in the register that fits.
 *
 * The choice of template is deterministic (djb2 hash over the sorted
 * keyword set) so two runs against the same JD produce identical
 * output — important because the re-score guardrail in the tailoring
 * flow compares scores across runs and shouldn't see template flapping.
 *
 * Returns an empty string when `keywords` is empty.
 */
export function buildWorkExperienceBullet(
  keywords: string[],
  categories: string[],
): string {
  if (keywords.length === 0) return '';

  // Bucket keywords by their paired category. When `categories` is
  // under-populated we default the rest to "technical" — that bucket's
  // templates are the most general-purpose.
  const tech: string[] = [];
  const mgmt: string[] = [];
  const dom: string[] = [];
  const soft: string[] = [];
  for (let i = 0; i < keywords.length; i++) {
    const cat = categories[i] ?? 'technical';
    const label = displayName(keywords[i]);
    if (cat === 'technical') tech.push(label);
    else if (cat === 'management') mgmt.push(label);
    else if (cat === 'domain') dom.push(label);
    else if (cat === 'soft') soft.push(label);
    else tech.push(label);
  }

  if (tech.length > 0 && mgmt.length > 0) {
    const idx = pickIndex([...tech, ...mgmt], 'we-mixed', WE_MIXED_TEMPLATES.length);
    return WE_MIXED_TEMPLATES[idx](joinNatural(tech), joinNatural(mgmt));
  }
  if (tech.length > 0) {
    // Fold any trailing domain/soft keywords into the technical list so
    // they still land in the bullet verbatim for ATS matching.
    const merged = [...tech, ...dom, ...soft];
    const idx = pickIndex(merged, 'we-tech', WE_TECH_TEMPLATES.length);
    return WE_TECH_TEMPLATES[idx](joinNatural(merged));
  }
  if (mgmt.length > 0) {
    const merged = [...mgmt, ...soft];
    const idx = pickIndex(merged, 'we-mgmt', WE_MGMT_TEMPLATES.length);
    return WE_MGMT_TEMPLATES[idx](joinNatural(merged));
  }
  if (dom.length > 0) {
    const merged = [...dom, ...soft];
    const idx = pickIndex(merged, 'we-domain', WE_DOMAIN_TEMPLATES.length);
    return WE_DOMAIN_TEMPLATES[idx](joinNatural(merged));
  }
  if (soft.length > 0) {
    const idx = pickIndex(soft, 'we-soft', WE_SOFT_TEMPLATES.length);
    return WE_SOFT_TEMPLATES[idx](joinNatural(soft));
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
        lines[i] = appendKeywordsToSkillsLine(lines[i], techMissing.map(displayName));
        addedKeywords.push(...techMissing);
        techAppended = true;
        changesSummary.push(`Appended ${techMissing.length} technical keywords to existing skills line`);
      }
      // Append management keywords to lines containing mgmt-related labels
      if (!mgmtAppended && mgmtMissing.length > 0 && (
        /^(management|leadership|people|process|agile)/i.test(lower.trim()) ||
        lower.includes('agile') || lower.includes('mentoring') || lower.includes('hiring')
      )) {
        lines[i] = appendKeywordsToSkillsLine(lines[i], mgmtMissing.map(displayName));
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
