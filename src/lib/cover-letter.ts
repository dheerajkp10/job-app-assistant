/**
 * Cover-letter generator — deterministic, no LLM.
 *
 * Pulls the highest-signal pieces we already extract for the resume
 * tailoring flow (matched JD keywords, top-scoring work-experience
 * positions, company name, role title) and assembles a 3-paragraph
 * cover letter that reads naturally without sounding like a Mad
 * Libs template.
 *
 * Why no LLM
 * ──────────
 * The same constraint as resume tailoring: this app is local-first
 * and works without an API key. A future iteration can layer an
 * opt-in Claude API rewrite on top of the deterministic output, the
 * same way the AI-tailoring feature is planned. The deterministic
 * baseline is meaningfully better than starting from a blank page,
 * and each paragraph composes cleanly enough to edit by hand.
 *
 * Output shape
 * ────────────
 * Returns plain text with paragraph separators. The caller decides
 * whether to render as Markdown, ship as a downloadable .txt, or
 * pipe into a future PDF generator. Plain text is the most useful
 * intermediate — every email client / Word / Google Docs accepts it.
 */

import { extractKeywords } from './ats-scorer';
import type { JobListing } from './types';

export interface CoverLetterInput {
  resumeText: string;
  jdContent: string;
  listing: JobListing;
  userName: string;
}

export interface CoverLetterOutput {
  text: string;
  // Surfaces the bits we drew on so the UI can show "we used these
  // signals" — useful when the user edits and wants to know which
  // claims came from the resume vs the JD.
  matchedKeywords: string[];
  signature: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────

/** Pluck the resume's most-recent role title — the line that follows
 *  "WORK EXPERIENCE" (or similar) or, failing that, the first line
 *  with a "Manager / Engineer / Director" noun. Best-effort. */
function extractMostRecentTitle(resumeText: string): string | null {
  const lines = resumeText.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  // Look in the first 50 lines — Summary / first WE position lives
  // there in any standard layout.
  const ROLE_NOUNS = /\b(manager|engineer|developer|lead|architect|director|scientist|analyst|designer)\b/i;
  for (let i = 0; i < Math.min(50, lines.length); i++) {
    const line = lines[i];
    if (line.length < 5 || line.length > 120) continue;
    if (!/[A-Z]/.test(line[0])) continue;
    if (!ROLE_NOUNS.test(line)) continue;
    // Drop trailing dates / locations after a delimiter.
    return line.split(/[|—–]/)[0].trim();
  }
  return null;
}

/** Pluck the user's most prominent quantified achievement — any
 *  sentence in the resume that contains a number or % or $ value
 *  alongside a strong verb. Used as the "social proof" sentence in
 *  paragraph 2. */
function extractAchievement(resumeText: string): string | null {
  const sentences = resumeText
    .replace(/\r?\n/g, ' ')
    .split(/(?<=[.!])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 30 && s.length < 240);
  const STRONG_VERBS = /\b(led|drove|owned|delivered|launched|architected|built|grew|scaled|reduced|cut|increased|improved|shipped|spearheaded)\b/i;
  const QUANT = /\b\d{1,3}([,.]?\d{3})*(%|\+| ?(million|billion|years?|x))?\b|\$\d/;
  // Prefer the first sentence that has BOTH a strong verb and a quantification.
  for (const s of sentences) {
    if (STRONG_VERBS.test(s) && QUANT.test(s)) {
      return stripBullet(s);
    }
  }
  // Fallback: any quantified sentence.
  for (const s of sentences) {
    if (QUANT.test(s)) return stripBullet(s);
  }
  return null;
}

function stripBullet(s: string): string {
  return s.replace(/^[-•·●▪️\s]+/, '').trim();
}

/** Extract years-of-experience claim from the resume Summary. Looks
 *  for patterns like "12+ years", "over 10 years", "decade of". */
function extractYearsOfExperience(resumeText: string): string | null {
  const head = resumeText.slice(0, 2000); // Summary lives near the top
  const patterns: RegExp[] = [
    /\b(\d{1,2})\+?\s*(?:years?|yrs?)\b/i,
    /\bover\s+(\d{1,2})\s*(?:years?|yrs?)\b/i,
    /\bnearly\s+(\d{1,2})\s*(?:years?|yrs?)\b/i,
  ];
  for (const re of patterns) {
    const m = head.match(re);
    if (m) {
      const n = parseInt(m[1], 10);
      if (n >= 2 && n <= 50) return `${n}+ years`;
    }
  }
  if (/\bdecade(s)?\s+of\b/i.test(head)) return 'over a decade';
  return null;
}

/** Extract the user's current employer — the company name on the
 *  first work-experience entry. Heuristic: the line right after the
 *  most-recent title that looks like a company name (capitalized,
 *  short, optionally followed by a location). */
function extractCurrentCompany(resumeText: string, recentTitle: string | null): string | null {
  if (!recentTitle) return null;
  const lines = resumeText.split(/\r?\n/).map((l) => l.trim());
  const idx = lines.findIndex((l) => l.includes(recentTitle));
  if (idx === -1) return null;
  // Title line often contains "Title — Company, Location, dates"
  const sameLineParts = lines[idx].split(/\s*[|—–·•]\s*/).map((p) => p.trim()).filter(Boolean);
  if (sameLineParts.length >= 2) {
    const candidate = sameLineParts[1].split(',')[0].trim();
    if (candidate.length > 1 && candidate.length < 60 && /[A-Z]/.test(candidate)) {
      return candidate;
    }
  }
  // Otherwise the next non-empty line is usually the company.
  for (let i = idx + 1; i < Math.min(idx + 4, lines.length); i++) {
    const l = lines[i];
    if (!l) continue;
    if (l.length > 80) continue;
    if (!/[A-Z]/.test(l[0])) continue;
    // Strip trailing location / dates.
    const company = l.split(/[,|—–·•]/)[0].trim();
    if (company.length > 1) return company;
  }
  return null;
}

/** Extract a team/scale signal from the resume — "team of N",
 *  "managing N engineers", etc. Used for EM/Director cover letters. */
function extractScaleSignal(resumeText: string): string | null {
  const RE = /\b(team|org|organi[sz]ation)s?\s+of\s+(\d{1,3})\b/i;
  const m = resumeText.match(RE);
  if (m) return `${m[1].toLowerCase()} of ${m[2]}`;
  const RE2 = /\b(?:managed|led|leading|grew)\s+(?:teams?\s+of\s+)?(\d{1,3})\s+(engineers?|reports|developers?|leads?)\b/i;
  const m2 = resumeText.match(RE2);
  if (m2) return `${m2[1]} ${m2[2].toLowerCase()}`;
  return null;
}

/** Pull the JD's "what the team does" sentence. We look for the JD's
 *  first sentence containing "team" / "we" / "you'll" — typically
 *  the company's framing of the role's mission. Falls back to the
 *  JD's first non-trivial sentence. */
function extractMissionSentence(jdContent: string): string | null {
  const plain = jdContent
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z]+;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const sentences = plain.split(/(?<=[.!])\s+/).slice(0, 30);
  const MISSION_RE = /\b(we|our team|the team|you'?ll|you will|join us)\b/i;
  for (const s of sentences) {
    if (s.length < 40 || s.length > 260) continue;
    if (MISSION_RE.test(s)) return s.trim();
  }
  // Fallback: first reasonable-length sentence.
  for (const s of sentences) {
    if (s.length >= 50 && s.length <= 260) return s.trim();
  }
  return null;
}

/** Top N JD keywords that appear in the resume — the strongest
 *  signal that the user actually has the experience the JD asks for. */
function topMatchedKeywords(resumeText: string, jdContent: string, max = 4): string[] {
  const resumeKw = extractKeywords(resumeText);
  const jdKw = extractKeywords(jdContent);
  const matched: string[] = [];
  for (const [k, _cat] of jdKw) {
    void _cat;
    if (resumeKw.has(k)) matched.push(k);
    if (matched.length >= max) break;
  }
  // Display-form: "distributed-systems" → "Distributed Systems"
  return matched.map((k) =>
    k.split(/[-_]/).map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' '),
  );
}

function joinNatural(items: string[]): string {
  if (items.length === 0) return '';
  if (items.length === 1) return items[0];
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(', ')}, and ${items[items.length - 1]}`;
}

// ─── Main builder ────────────────────────────────────────────────────

export function generateCoverLetter(input: CoverLetterInput): CoverLetterOutput {
  const { resumeText, jdContent, listing, userName } = input;
  const recentTitle = extractMostRecentTitle(resumeText);
  const achievement = extractAchievement(resumeText);
  const mission = extractMissionSentence(jdContent);
  const matched = topMatchedKeywords(resumeText, jdContent, 4);
  const years = extractYearsOfExperience(resumeText);
  const currentCompany = extractCurrentCompany(resumeText, recentTitle);
  const scale = extractScaleSignal(resumeText);

  const today = new Date().toLocaleDateString('en-US', {
    year: 'numeric', month: 'long', day: 'numeric',
  });

  // Paragraph 1 — opening hook tying the user's current role to the
  // posted role. Mentions the company by name and the JD title
  // verbatim so ATS keyword filters in the cover-letter tier hit.
  // Title + (optional) current-company + (optional) years-of-experience
  // claim, woven into one natural opening sentence so the reader sees
  // the strongest single-line credential up top.
  const credentialBits: string[] = [];
  if (years) credentialBits.push(`with ${years} of experience`);
  if (currentCompany) credentialBits.push(`currently at ${currentCompany}`);
  const credentialClause = credentialBits.length > 0 ? `, ${credentialBits.join(' ')},` : '';
  const p1 = recentTitle
    ? `I'm writing to express my interest in the ${listing.title} role at ${listing.company}. As a ${recentTitle}${credentialClause} I bring directly relevant experience to the problems your team is taking on.`
    : `I'm writing to express my interest in the ${listing.title} role at ${listing.company}${years ? `. With ${years} of experience` : ''}, the work your team is doing aligns closely with the systems and outcomes I've focused on throughout my career.`;

  // Paragraph 2 — proof-of-fit. Combines a quantified achievement
  // (when we found one) with the top matched JD keywords so the
  // reader sees a concrete result PLUS the technical surface area
  // they care about.
  const keywordPhrase = matched.length > 0
    ? `My background spans ${joinNatural(matched)}, all areas the role specifically calls out.`
    : '';
  const scaleSentence = scale
    ? ` I've operated at scale (${scale}) and know what's needed to sustain delivery as that footprint grows.`
    : '';
  const proofPara = (achievement
    ? `In my most recent work, ${achievement.charAt(0).toLowerCase()}${achievement.slice(1)} ${keywordPhrase}`.trim()
    : keywordPhrase
      ? keywordPhrase
      : `I've consistently delivered measurable engineering impact in fast-moving, ambiguous environments — precisely the kind of operating mode this role demands.`)
    + scaleSentence;

  // Paragraph 3 — connect to the JD's mission sentence. This is the
  // "why this team specifically" beat that distinguishes a real cover
  // letter from a templated one.
  const p3 = mission
    ? `What drew me to this opening is the specific framing in the posting: "${mission}" That problem space — and the bar implied by it — is where I want to spend the next chapter of my career.`
    : `What drew me to this opening is the team's explicit focus on building durable systems at scale. That's the kind of work I want to spend the next chapter of my career on.`;

  // Closing — short, action-oriented, no fluff.
  const closing = `I'd welcome the opportunity to discuss how my background lines up with what your team needs. Thank you for your time and consideration.`;

  const greeting = `Dear ${listing.company} Hiring Team,`;
  const signature = `Sincerely,\n${userName}`;

  const text = [
    today,
    '',
    greeting,
    '',
    p1,
    '',
    proofPara,
    '',
    p3,
    '',
    closing,
    '',
    signature,
  ].join('\n');

  return {
    text,
    matchedKeywords: matched,
    signature,
  };
}
