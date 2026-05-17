/**
 * Keyword deduplication for the tailor pipeline.
 *
 * Problem this solves
 * ───────────────────
 * The tailor's existing skills-injection paths
 * (`appendToSkillsLine` in docx-editor.ts, the section-append loop in
 * resume-tailor.ts) only catch case-insensitive substring duplicates.
 * That misses real-world equivalents the user already has:
 *
 *   Existing line says:   "Postgres"
 *   Tailor wants to add:  "PostgreSQL"
 *   Substring check:      "postgres" includes "postgresql"? → false
 *   Result:               both get into the skills line side-by-side.
 *
 *   Existing:  "High-Availability (99.999% SLA)"
 *   Adding:    "High availability"  (different casing + hyphen)
 *   Substring: "high-availability" includes "high availability"? → false
 *   Result:    both stack.
 *
 * Whereas legitimately-distinct terms the user wants kept apart —
 * Agile vs Scrum vs Sprint vs Sprint planning, Hiring vs Recruiting
 * vs Talent acquisition vs Interviewing, OKRs vs KPIs vs Goals vs
 * Metrics — must NOT be collapsed.
 *
 * Strategy
 * ────────
 * 1. NORMALIZE — lowercase + strip non-alphanumeric (collapses
 *    "High availability" / "High-Availability" / "high  availability"
 *    to a single comparable key).
 * 2. ALIAS TABLE — explicit small map for known cross-spelling
 *    equivalents (postgresql → Postgres, k8s → Kubernetes, nodejs →
 *    Node.js, …) where normalization alone wouldn't collapse them.
 *    Keys are normalized; values are the CANONICAL display form to
 *    keep.
 * 3. CANONICAL CHOICE — when normalization OR alias detects a dupe,
 *    keep whichever form the user already has in their resume
 *    (preserves their voice) UNLESS the alias table explicitly
 *    overrides with a canonical form known to perform better in ATS
 *    scrapes.
 *
 * The table stays small on purpose — too many entries risks
 * collapsing things the user wanted kept distinct. Add an entry
 * only when both forms semantically refer to the SAME tool/concept
 * with no nuance worth preserving.
 */

/** Lowercase + strip everything except a-z0-9. "High-Availability" /
 *  "high availability" / "HIGH  AVAILABILITY" all collapse to the
 *  same key. */
export function normalizeKeyword(kw: string): string {
  return kw.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Known alias → canonical display form. Keys are the NORMALIZED form
 * (post-`normalizeKeyword`); values are the preferred display string
 * to use when this concept needs to appear in the resume.
 *
 * Canonical choices favor the form more commonly seen in 2025 JD
 * scrapes / ATS keyword lists. Where there's no strong signal, the
 * canonical is whichever form reads more natural in resume prose.
 *
 * KEEP THIS LIST SHORT. False positives here cause damage —
 * collapsing keywords the user wanted kept distinct is worse than
 * letting a few near-dupes slip through.
 */
const KEYWORD_ALIASES: Record<string, string> = {
  // Databases
  postgresql: 'Postgres',
  postgre: 'Postgres',

  // Runtime / language ecosystem
  nodejs: 'Node.js',
  'node.js': 'Node.js',         // normalize strips the dot — included for clarity
  // ↑ Note: 'node.js'.replace(/[^a-z0-9]/g, '') === 'nodejs' so the
  // entry above is redundant; left in for documentation. The
  // normalizer collapses both to 'nodejs'.

  // Orchestration
  k8s: 'Kubernetes',

  // Cloud aliases
  amazonwebservices: 'AWS',
  googlecloud: 'GCP',
  googlecloudplatform: 'GCP',

  // CI/CD spellings
  cicd: 'CI/CD',

  // API styles
  restapi: 'REST API',
  restful: 'REST API',
  restfulapi: 'REST API',

  // JavaScript ↔ JS — the user explicitly wants JavaScript + TypeScript
  // kept DISTINCT, but JS and JavaScript are the SAME language. Treat
  // those two as aliases of each other; TypeScript is a separate
  // entry and gets its own slot.
  js: 'JavaScript',

  // LLM long-forms collapsed to the short form most JDs scan for.
  largelanguagemodels: 'LLMs',
  largelanguagemodel: 'LLMs',
  llm: 'LLMs',
};

/** Returns the canonical display form for a keyword. Falls back to
 *  the input string when no alias is known — that's the common case
 *  for non-alias tokens. Preserves the input's original casing /
 *  punctuation when no alias intervenes. */
export function canonicalForm(kw: string): string {
  const n = normalizeKeyword(kw);
  return KEYWORD_ALIASES[n] ?? kw;
}

/**
 * "Does this resume text already mention `keyword`?" — applies the
 * same tolerance the central ATS scorer uses (hyphen ↔ space flatten,
 * alias-table canonicalization, last-resort full-normalization). The
 * single source of truth for "is X already on the resume" checks
 * across the app: dashboard catalog popovers, suggestion detectors,
 * tailor pre-flight, etc.
 *
 * Order of checks (cheapest first):
 *   1. Hyphen-flattened substring match — catches "high-availability"
 *      vs "high availability" both ways.
 *   2. Canonical-form match via the alias table (postgres/postgresql,
 *      k8s/kubernetes, js/javascript, …) so the catalog item's
 *      canonical name resolves whichever surface form is in the
 *      resume.
 *   3. Strip-all-punctuation normalization as a last resort. Catches
 *      "REST API" vs "rest-api" vs "restapi".
 */
export function resumeMentions(resumeText: string, keyword: string): boolean {
  const resumeLower = resumeText.toLowerCase();
  const kLower = keyword.toLowerCase();
  const resumeFlat = resumeLower.replace(/-/g, ' ');
  const kFlat = kLower.replace(/-/g, ' ');
  if (resumeFlat.includes(kFlat)) return true;
  const kCanonical = canonicalForm(keyword).toLowerCase();
  if (kCanonical !== kLower && resumeFlat.includes(kCanonical.replace(/-/g, ' '))) return true;
  const resumeNorm = normalizeKeyword(resumeLower);
  const kNorm = normalizeKeyword(keyword);
  if (kNorm && resumeNorm.includes(kNorm)) return true;

  // Distributive-parens match. Resume writers commonly factor out a
  // shared word and list variants in parens:
  //   "API (REST, GraphQL, API Gateway)"       covers "REST API",
  //                                              "GraphQL API", etc.
  //   "AWS (Lambda, S3, EC2)"                   covers "AWS Lambda",
  //                                              "S3", "EC2", etc.
  //   "Cloud (GCP, Azure)"                      covers "GCP Cloud",
  //                                              "Azure Cloud".
  //
  // For a multi-token catalog keyword, take every pair of its tokens
  // (lead, inside) and look for the pattern
  //   lead<non-paren-chars>(<paren content with `inside`>)
  // in the resume. If either ordering hits, treat as matched.
  //
  // Word-boundary + the negated-paren bridge keeps the lead anchored
  // OUTSIDE any earlier paren group so we don't false-positive on
  // "(api ... (rest ...)" style nesting. Cap the bridge at 20 chars
  // so we don't drift across unrelated content.
  const kTokens = kLower.split(/\s+/).filter((t) => t.length >= 2);
  if (kTokens.length >= 2) {
    const esc = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    for (const lead of kTokens) {
      for (const inside of kTokens) {
        if (lead === inside) continue;
        const re = new RegExp(
          `\\b${esc(lead)}\\b[^(]{0,20}\\([^)]*\\b${esc(inside)}\\b`,
          'i',
        );
        if (re.test(resumeLower)) return true;
      }
    }
  }

  return false;
}

/** Returns true when two keywords would render duplicate in the
 *  user's skills line. Two keywords match if either:
 *    a. Their normalized forms are identical (catches casing /
 *       hyphenation / whitespace variants).
 *    b. Their canonical forms (alias-resolved) are identical
 *       (catches postgres/postgresql, k8s/kubernetes, etc.).
 */
export function isSameKeyword(a: string, b: string): boolean {
  if (normalizeKeyword(a) === normalizeKeyword(b)) return true;
  if (normalizeKeyword(canonicalForm(a)) === normalizeKeyword(canonicalForm(b))) return true;
  return false;
}

/**
 * Tokenize a comma-separated skills line into individual keyword
 * entries. Tolerates the variations the user's resumes use:
 *   "A, B, C"            → ["A", "B", "C"]
 *   "A, B (note), C; D"  → ["A", "B (note)", "C", "D"]
 *
 * Splits on commas and semicolons. Does NOT split on parentheses
 * because some entries legitimately contain comma-separated detail
 * inside parens (e.g. "AWS (Lambda, S3, EC2)") — handled below by
 * paren-aware splitting.
 */
export function tokenizeSkillsLine(line: string): string[] {
  const out: string[] = [];
  let buf = '';
  let paren = 0;
  for (const ch of line) {
    if (ch === '(' || ch === '[' || ch === '{') paren++;
    else if (ch === ')' || ch === ']' || ch === '}') paren = Math.max(0, paren - 1);
    if (paren === 0 && (ch === ',' || ch === ';')) {
      const t = buf.trim();
      if (t) out.push(t);
      buf = '';
    } else {
      buf += ch;
    }
  }
  const t = buf.trim();
  if (t) out.push(t);
  return out;
}

/**
 * Filter `newKeywords` to only those NOT already represented in
 * `existingTokens` (via normalized + alias-aware comparison).
 *
 * Returns the new keywords that should actually be appended.
 * Preserves the input order so the upstream display ordering
 * (frequency-ranked, etc.) is respected.
 */
export function filterNewKeywords(
  existingTokens: string[],
  newKeywords: string[],
): string[] {
  const seen = new Set(existingTokens.map((t) => normalizeKeyword(canonicalForm(t))));
  const out: string[] = [];
  for (const kw of newKeywords) {
    const key = normalizeKeyword(canonicalForm(kw));
    if (seen.has(key)) continue;
    seen.add(key);                // also dedupe within newKeywords itself
    out.push(canonicalForm(kw));  // store the canonical, not the alias
  }
  return out;
}

/**
 * Merge an existing skills line with new keywords, returning the
 * full updated keyword list (existing + filtered new). This is the
 * single entry point the tailor pipeline should call when appending
 * to an existing skills line — handles both "drop dupes" and
 * "canonicalize aliases already in the line".
 *
 * Canonicalization of existing tokens is conservative: if the
 * existing token has a known alias-table canonical that differs from
 * its current form, the existing token is REPLACED with the
 * canonical. This stops the user's resume from accumulating
 * "Postgres" plus "PostgreSQL" plus "postgresql" across many tailor
 * runs.
 */
export function mergeSkillsTokens(
  existingTokens: string[],
  newKeywords: string[],
): string[] {
  // Normalize the existing tokens to their canonical form first,
  // dedupe within them (the user may already have collected dupes
  // from prior runs). Preserve order and original casing for non-
  // alias tokens.
  const cleanedExisting: string[] = [];
  const seen = new Set<string>();
  for (const tok of existingTokens) {
    const canonical = canonicalForm(tok);
    const key = normalizeKeyword(canonical);
    if (seen.has(key)) continue;
    seen.add(key);
    cleanedExisting.push(canonical);
  }
  // Now append new keywords, filtered against the cleaned existing.
  for (const kw of newKeywords) {
    const canonical = canonicalForm(kw);
    const key = normalizeKeyword(canonical);
    if (seen.has(key)) continue;
    seen.add(key);
    cleanedExisting.push(canonical);
  }
  return cleanedExisting;
}
