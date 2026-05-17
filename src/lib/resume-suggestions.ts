/**
 * Resume tailoring suggestions — high-impact, ATS-meaningful edits
 * the user can opt into à la carte.
 *
 * Beyond appending missing keywords (which has diminishing returns
 * once the obvious ones are landed), real ATS / recruiter-screen
 * lift comes from a handful of structural fixes:
 *
 *   1. **Mirror the JD's exact role title** in the resume's existing
 *      title prose — replacing "Software Development Manager" with
 *      "Software Engineering Manager" when the JD says the latter.
 *      This is high-yield because recruiters search for the exact
 *      title string and ATSes often weight title fields heavily.
 *   2. **Mention the JD's distinctive multi-word phrases** the resume
 *      doesn't contain (e.g. "agent foundations", "data plane").
 *   3. **Surface the explicit years-of-experience claim** the JD asks
 *      for — many ATSes parse "X years" requirements as a hard filter.
 *   4. **Mirror the JD's domain context** ("agent infrastructure",
 *      "consumer products", etc.) into the summary lede so a screener
 *      sees the relevance immediately.
 *   5. **Quantify weak bullets** (positions with no metrics).
 *
 * Application strategy
 * ────────────────────
 * Each suggestion carries enough state to be applied deterministically:
 *
 *   - kind='replace-text'  → swap an existing exact phrase for a new
 *     one (intelligent title alignment, JD-matching).
 *   - kind='append-summary' → add a short phrase to the Summary
 *     section (used when no existing phrase was a good replacement
 *     target).
 *   - kind='append-skills' → extend a Skills line with new entries.
 *
 * The tailor route reads `kind` to dispatch the right edit. The
 * detector is server-trusted (we never accept arbitrary user prose);
 * the client only sends a list of accepted suggestion IDs.
 */

import { canonicalForm, normalizeKeyword } from './keyword-dedup';

/**
 * "Does this resume already mention `keyword`?" — uses the same
 * tolerance rules the central ATS scorer applies, so suggestions don't
 * flag e.g. "high availability" as missing when the resume says
 * "High-Availability". Order of checks:
 *   1. Hyphen-flattened substring match (catches "high-availability"
 *      vs "high availability" both ways).
 *   2. Canonical-form match via the alias table (postgres/postgresql,
 *      k8s/kubernetes, js/javascript, …).
 *   3. Normalized form (strip punctuation entirely) as a last resort.
 */
function resumeMentions(resumeLower: string, keyword: string): boolean {
  const kLower = keyword.toLowerCase();
  const resumeFlat = resumeLower.replace(/-/g, ' ');
  const kFlat = kLower.replace(/-/g, ' ');
  if (resumeFlat.includes(kFlat)) return true;
  const kCanonical = canonicalForm(keyword).toLowerCase();
  if (kCanonical !== kLower && resumeFlat.includes(kCanonical.replace(/-/g, ' '))) return true;
  // Last-resort: normalize both sides (strip all non-alphanumerics)
  // and substring-match. Catches edge cases like "REST API" vs
  // "rest-api" vs "restapi".
  const resumeNorm = normalizeKeyword(resumeLower);
  const kNorm = normalizeKeyword(keyword);
  if (kNorm && resumeNorm.includes(kNorm)) return true;
  return false;
}

// ─── Types ───────────────────────────────────────────────────────────

export type SuggestionKind =
  | 'replace-text'
  | 'append-summary'
  | 'append-skills';

export interface Suggestion {
  /** Stable string ID — round-trips through the API to identify which
   *  suggestions the user accepted. */
  id: string;
  kind: SuggestionKind;
  /** Short label shown in the UI (≤ 70 chars). */
  label: string;
  /** One-line explanation of why this helps + the specific change. */
  description: string;

  // ── Payload (varies by kind) ────────────────────────────────────────
  // The route reads ONE of the following groups based on `kind`:

  /** For `append-summary` STANDALONE additions (years claim, mirror
   *  title fallback). Already-formatted prose with leading space +
   *  trailing punctuation. Only set when the suggestion's content
   *  doesn't fold into the buildSummaryPhrase template engine. */
  insertion?: string;
  /** For `append-summary` additions that should fold into
   *  `buildSummaryPhrase`'s domain bucket (niche phrases, domain
   *  context words). The route adds these to the same pool as
   *  missing-keyword domain terms, so all "domain content" the user
   *  accepted lands in ONE coherent templated sentence rather than
   *  several "Currently focused on …" stubs. */
  summaryDomainItem?: string;
  /** For `replace-text` kind: the exact existing phrase to find. */
  oldText?: string;
  /** For `replace-text` kind: the new phrase to substitute. */
  newText?: string;
  /** For `append-skills` kind: the skill-line label to extend
   *  (matches `SKILLS_LABELS` in docx-editor.ts). */
  skillsCategory?: 'cloudStack' | 'systems' | 'management' | 'domain';
  /** For `append-skills` kind: the keywords to add. */
  skillsItems?: string[];
}

export interface SuggestionInput {
  resumeText: string;
  jdContent: string;
  jdTitle: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────

const TITLE_NORMALIZE_RE = /[^a-z0-9 ]/g;
function normalize(s: string): string {
  return s.toLowerCase().replace(TITLE_NORMALIZE_RE, ' ').replace(/\s+/g, ' ').trim();
}

function tokenize(s: string): Set<string> {
  return new Set(normalize(s).split(' ').filter((t) => t.length > 2));
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return inter / (a.size + b.size - inter);
}

/**
 * Reduce a posting title to its hireable role family. Drops seniority
 * prefixes ("Senior", "Staff", "Lead"), trailing scope ("— Routing &
 * Concurrency"), and parenthetical context. So "Senior Software
 * Engineer, Agent Foundations" → "Software Engineer".
 *
 * If the title is already a clean role family (rare), returns as-is.
 */
function canonicalizeJdRoleFamily(title: string): string {
  let t = title;
  // Strip everything after the first delimiter.
  t = t.split(/[—–|,]/)[0];
  t = t.replace(/\s*\([^)]*\)\s*/g, ' ');
  // Strip seniority prefixes.
  t = t.replace(
    /\b(senior|staff|principal|lead|sr\.?|jr\.?|junior|entry[-\s]level|associate|distinguished|head of|vp of|director of)\b/gi,
    ' ',
  );
  return t.replace(/\s+/g, ' ').trim();
}

/**
 * Pull plausible role-title phrases out of the resume text. We look
 * for short (3-7 token) sequences that contain a role-noun and
 * minimal stop-words — the kind of phrase that appears as a position
 * header in WORK EXPERIENCE.
 */
const ROLE_NOUNS = new Set([
  'manager', 'engineer', 'developer', 'lead', 'architect', 'director',
  'scientist', 'analyst', 'designer', 'specialist', 'consultant',
  'administrator', 'researcher',
]);

function extractResumeTitles(text: string): string[] {
  const lines = text.split(/[\n\r]+/);
  const titles = new Set<string>();
  // Resume lines that are likely titles tend to be short and have a
  // role noun. Cap to ~12 words so we don't grab a sentence.
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (line.length === 0 || line.length > 200) continue;
    const words = line.split(/\s+/);
    if (words.length > 12) continue;
    // Find a role noun in the line.
    const lowered = line.toLowerCase();
    let nounIdx = -1;
    for (let i = 0; i < words.length; i++) {
      const cleaned = words[i].toLowerCase().replace(/[^a-z]/g, '');
      if (ROLE_NOUNS.has(cleaned)) {
        nounIdx = i;
        break;
      }
    }
    if (nounIdx < 0) continue;
    // Take up to 4 tokens before the noun + the noun itself, dropping
    // anything past the next delimiter (pipe, dash, comma).
    const start = Math.max(0, nounIdx - 4);
    let end = nounIdx + 1;
    // Allow one trailing word if it's not a delimiter.
    if (
      end < words.length &&
      !/[|—–\-,]/.test(words[end]) &&
      words[end].length > 1
    ) {
      end++;
    }
    const phrase = words.slice(start, end).join(' ').replace(/[|—–,].*/g, '').trim();
    if (phrase.length < 5 || phrase.length > 60) continue;
    if (!/[A-Z]/.test(phrase[0])) continue; // titles start capitalized
    titles.add(phrase);
    void lowered;
  }
  return Array.from(titles);
}

// ─── Detectors ───────────────────────────────────────────────────────

/**
 * Detect the highest-yield title alignment opportunity. If there's a
 * resume title that's CLOSE to but not EXACTLY the JD's role family,
 * propose a replace-edit. Only when nothing close exists do we fall
 * back to appending a generic mirror-sentence to the Summary.
 */
function detectTitleAlignment(input: SuggestionInput): Suggestion | null {
  const family = canonicalizeJdRoleFamily(input.jdTitle);
  if (family.length < 5) return null;
  const familyTokens = tokenize(family);
  const resumeTitles = extractResumeTitles(input.resumeText);

  // Already mirrored verbatim somewhere? Skip — nothing to suggest.
  const familyNorm = normalize(family);
  for (const t of resumeTitles) {
    if (normalize(t) === familyNorm) return null;
  }

  // Find the closest existing title. We require at least 50% Jaccard
  // overlap to suggest a replacement — too low and the swap reads as
  // a fabrication. Above 90% (e.g. just one synonym swap) is the
  // sweet spot for an honest "use the JD's wording" replacement.
  let best: { phrase: string; sim: number } | null = null;
  for (const phrase of resumeTitles) {
    const sim = jaccard(tokenize(phrase), familyTokens);
    if (!best || sim > best.sim) best = { phrase, sim };
  }
  if (best && best.sim >= 0.5 && best.sim < 1) {
    // Replace the matching phrase with the JD's verbatim form. We
    // keep the user's existing capitalization style by title-casing
    // each token of the replacement.
    const newText = family.replace(/\b\w/g, (c) => c.toUpperCase());
    return {
      id: 'replace-title',
      kind: 'replace-text',
      label: `Use "${newText}" as your title (instead of "${best.phrase}")`,
      description:
        `Recruiters and ATS keyword filters search for the JD's exact title. ` +
        `Replaces every occurrence of "${best.phrase}" in your resume with "${newText}".`,
      oldText: best.phrase,
      newText,
    };
  }

  // Fallback: nothing close enough — propose a mirror sentence in
  // the summary so the title at least appears once.
  const summarySnippet = input.resumeText.slice(0, 800).toLowerCase();
  if (summarySnippet.includes(familyNorm)) return null;
  return {
    id: 'mirror-title',
    kind: 'append-summary',
    label: `Mirror "${family}" in your Summary`,
    description:
      `Adds "Aligned to ${family} responsibilities at scale." to your Summary so the JD's exact title appears at least once.`,
    insertion: ` Aligned to ${family} responsibilities at scale.`,
  };
}

// Stopwords for phrase extraction — common English + boilerplate JD
// fillers ("requirements", "qualifications", etc.).
const PHRASE_STOP_WORDS = new Set([
  'the', 'and', 'for', 'with', 'this', 'that', 'are', 'will', 'our', 'you',
  'your', 'into', 'over', 'about', 'their', 'they', 'them', 'has', 'have',
  'had', 'was', 'were', 'been', 'being', 'all', 'any', 'such', 'one', 'two',
  'new', 'use', 'used', 'using', 'team', 'work', 'role', 'job', 'we', 'us',
  'in', 'on', 'of', 'to', 'a', 'an', 'is', 'be', 'or', 'as', 'at', 'by', 'it',
  'if', 'so', 'do', 'its', 'who', 'how', 'what', 'when', 'where', 'why',
  'company', 'requirements', 'qualifications', 'experience', 'must',
  'should', 'these', 'those', 'including', 'across', 'without', 'each',
  'every', 'most', 'more', 'many', 'some', 'much', 'few', 'than', 'while',
  'because', 'looking', 'looking-for', 'years', 'year', 'plus', 'role-of',
]);

/** Bigram noun-phrases that occur frequently in the JD — these are
 *  the JD's distinctive signatures. */
function extractTopPhrases(jd: string, max: number): { phrase: string; count: number }[] {
  const cleaned = jd
    .toLowerCase()
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z]+;/g, ' ')
    .replace(/[^a-z0-9\s'-]/g, ' ');
  const tokens = cleaned.split(/\s+/).filter(Boolean);
  const counts = new Map<string, number>();
  for (let i = 0; i < tokens.length - 1; i++) {
    const a = tokens[i];
    const b = tokens[i + 1];
    if (a.length < 4 || b.length < 4) continue;
    if (PHRASE_STOP_WORDS.has(a) || PHRASE_STOP_WORDS.has(b)) continue;
    if (/^\d/.test(a) || /^\d/.test(b)) continue;
    const phrase = `${a} ${b}`;
    counts.set(phrase, (counts.get(phrase) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .map(([phrase, count]) => ({ phrase, count }))
    .filter((x) => x.count >= 3)
    .sort((a, b) => b.count - a.count)
    .slice(0, max);
}

function detectNichePhrases(input: SuggestionInput, max = 2): Suggestion[] {
  const top = extractTopPhrases(input.jdContent, 6);
  const resumeLower = input.resumeText.toLowerCase();
  const out: Suggestion[] = [];
  for (const { phrase, count } of top) {
    if (resumeMentions(resumeLower, phrase)) continue;
    const display = phrase.replace(/\b\w/g, (c) => c.toUpperCase());
    out.push({
      id: `add-niche-${phrase.replace(/\s+/g, '-')}`,
      kind: 'append-summary',
      label: `Mention "${display}" in Summary`,
      description:
        `"${display}" appears ${count}× in the JD but isn't on your resume. ` +
        `Folds it into the Summary's existing "domains" sentence (no new stub paragraph).`,
      // Folded into the buildSummaryPhrase domain pool — the result
      // reads e.g. "Career spans Agent Foundations, Data Plane …
      // domains" rather than tacking on another "Currently focused
      // on X." sentence.
      summaryDomainItem: display,
    });
    if (out.length >= max) break;
  }
  return out;
}

/**
 * Parse "X years" or "X+ years" requirements from the JD; if the
 * resume's Summary doesn't already make a years-of-experience claim,
 * suggest mirroring it.
 */
function detectExperienceClaim(input: SuggestionInput): Suggestion | null {
  const m = input.jdContent.match(/(\d{1,2})\s*\+?\s*years?\b/i);
  if (!m) return null;
  const years = parseInt(m[1], 10);
  if (!years || years < 2 || years > 25) return null;
  // Resume already mentions years explicitly?
  if (/\d{1,2}\s*\+?\s*years?\b/i.test(input.resumeText.slice(0, 1500))) return null;
  return {
    id: 'add-experience-claim',
    kind: 'append-summary',
    label: `State "${years}+ years" of experience explicitly`,
    description:
      `The JD asks for ${years}+ years; your Summary doesn't currently make that claim explicitly. ` +
      `Adds "${years}+ years of relevant experience." so ATS years-filters match.`,
    insertion: ` ${years}+ years of relevant experience.`,
  };
}

/**
 * "Skills gap" detector. We look at the JD's top noun-phrases that
 * are CLEARLY technical/process keywords (single-token: "kubernetes",
 * "terraform", "react", or two-token like "machine learning"); for any
 * group of related ones the resume doesn't mention, suggest extending
 * the relevant Skills line.
 *
 * This is intentionally conservative — it only fires when ≥2 related
 * keywords are missing AND clustering hits a recognizable category,
 * to keep "skills gap" from being a noisy synonym for "more keywords".
 */
const SKILLS_CATEGORIES: {
  category: 'cloudStack' | 'systems' | 'management' | 'domain';
  label: string;
  keywords: Set<string>;
}[] = [
  {
    category: 'cloudStack',
    label: 'Cloud & Stack',
    keywords: new Set([
      'kubernetes', 'k8s', 'docker', 'terraform', 'pulumi', 'helm',
      'istio', 'envoy', 'argo', 'argocd', 'ec2', 'lambda', 'ecs', 'eks',
      'fargate', 'cloudformation', 'jenkins', 'circleci', 'datadog',
      'prometheus', 'grafana', 'pagerduty', 'kafka', 'kinesis',
      'redis', 'cassandra', 'elasticsearch', 'snowflake', 'bigquery',
      'airflow', 'spark', 'dagster', 'sagemaker', 'mlflow',
      'tensorflow', 'pytorch', 'rust', 'golang',
    ]),
  },
  {
    category: 'systems',
    label: 'Systems & Architecture',
    keywords: new Set([
      'microservices', 'event-driven', 'serverless', 'distributed',
      'observability', 'load-balancing', 'rate-limiting', 'caching',
      'sharding', 'replication', 'graphql', 'grpc', 'streaming',
      'low-latency', 'high-availability', 'fault-tolerance',
    ]),
  },
  {
    category: 'management',
    label: 'Leadership',
    keywords: new Set([
      'mentoring', 'coaching', 'hiring', 'okrs', 'kpis', 'roadmap',
      'agile', 'scrum', 'kanban', 'stakeholder', 'cross-functional',
      'incident', 'on-call', 'oncall',
    ]),
  },
  {
    category: 'domain',
    label: 'AI / ML',
    keywords: new Set([
      'llm', 'gpt', 'transformers', 'embeddings', 'rag', 'agentic',
      'recommendation', 'personalization', 'ranking', 'fine-tuning',
      'inference', 'model-serving', 'vector', 'retrieval',
    ]),
  },
];

function detectSkillsGap(input: SuggestionInput): Suggestion | null {
  const jdLower = input.jdContent.toLowerCase();
  const resumeLower = input.resumeText.toLowerCase();
  for (const cat of SKILLS_CATEGORIES) {
    const missing: string[] = [];
    for (const k of cat.keywords) {
      // JD presence: tolerant on hyphens (JD might say "high
      // availability" while taxonomy stores "high-availability" or
      // vice versa). Resume absence: full alias-aware check via
      // resumeMentions so we don't flag "k8s" missing when the
      // resume has "Kubernetes".
      const jdFlat = jdLower.replace(/-/g, ' ');
      const kFlat = k.replace(/-/g, ' ');
      const inJd = jdFlat.includes(kFlat) || jdLower.includes(k);
      if (inJd && !resumeMentions(resumeLower, k)) {
        missing.push(k);
      }
    }
    if (missing.length >= 2) {
      const display = missing.slice(0, 4).map((k) =>
        k.split(/[-_]/).map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' '),
      );
      return {
        id: `fill-skills-${cat.category}`,
        kind: 'append-skills',
        label: `Extend ${cat.label} skills with: ${display.join(', ')}`,
        description:
          `Your ${cat.label} line is missing ${missing.length} keywords the JD repeats: ${display.join(', ')}. ` +
          `Adds them to the Skills section.`,
        skillsCategory: cat.category,
        skillsItems: missing.slice(0, 4),
      };
    }
  }
  return null;
}

/**
 * "Domain context" detector. Pulls the most distinctive single-word
 * domain noun from the JD's intro paragraph and suggests mirroring
 * it in the Summary as the user's focus area. Only fires when no
 * other niche suggestion already covered that word.
 */
function detectDomainContext(
  input: SuggestionInput,
  alreadyAddedPhrases: string,
): Suggestion | null {
  // Take the first ~600 chars of JD as the "intro" — usually
  // contains the company / mission framing.
  const intro = input.jdContent.slice(0, 600).toLowerCase();
  const distinctive = [
    'infrastructure', 'platform', 'agentic', 'inference', 'observability',
    'security', 'fintech', 'healthcare', 'ranking', 'personalization',
    'consumer', 'enterprise', 'autonomous', 'robotics',
  ];
  for (const word of distinctive) {
    if (!intro.includes(word)) continue;
    if (input.resumeText.toLowerCase().includes(word)) continue;
    if (alreadyAddedPhrases.includes(word)) continue;
    const display = word.charAt(0).toUpperCase() + word.slice(1);
    return {
      id: `add-domain-context-${word}`,
      kind: 'append-summary',
      label: `Highlight your ${word} background in Summary`,
      description:
        `The JD's framing centers on "${word}" — folds it into the Summary's existing "domains" sentence so the recruiter sees the alignment immediately.`,
      // Same folding strategy as niche phrases — joins the domain
      // pool rather than appending a separate sentence.
      summaryDomainItem: display,
    };
  }
  return null;
}

// ─── Public API ──────────────────────────────────────────────────────

export function detectSuggestions(input: SuggestionInput): Suggestion[] {
  const out: Suggestion[] = [];

  // Order matters — highest-yield first so the UI shows them up top.
  const titleSuggestion = detectTitleAlignment(input);
  if (titleSuggestion) out.push(titleSuggestion);

  const skillsSuggestion = detectSkillsGap(input);
  if (skillsSuggestion) out.push(skillsSuggestion);

  const expClaim = detectExperienceClaim(input);
  if (expClaim) out.push(expClaim);

  const niche = detectNichePhrases(input, 2);
  out.push(...niche);

  const domain = detectDomainContext(
    input,
    niche.map((s) => s.insertion ?? '').join(' ').toLowerCase(),
  );
  if (domain) out.push(domain);

  return out;
}
