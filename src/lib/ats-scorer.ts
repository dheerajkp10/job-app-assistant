/**
 * ATS (Applicant Tracking System) scoring engine — v2.
 *
 * What real ATSes actually do
 * ───────────────────────────
 * Greenhouse, Lever, Workday, iCIMS and Taleo — the systems that actually
 * receive resumes — don't compute a 0-100 "match score". They parse the
 * resume into structured fields and let recruiters search/filter with
 * Boolean keyword queries. The 0-100 "ATS-friendliness" score most users
 * care about comes from ranking layers built on top: Jobscan, Eightfold,
 * HireVue, Resume Worded, LinkedIn's Easy Apply ranking, etc.
 *
 * Those tools combine roughly the following signals:
 *   1. Hard-skill keyword coverage, weighted by JD frequency
 *   2. Diminishing returns on repeated mentions
 *   3. Soft-skill / domain coverage
 *   4. Title / seniority alignment
 *   5. Education + years-of-experience parsing
 *
 * v1 of this scorer used #1 only, and treated every JD keyword as binary
 * with equal weight. With small JDs (5–10 taxonomy hits) that produced
 * jarring jumps — adding 2–4 keywords to the resume could swing the
 * overall from 50% to 90%, which is what the user (correctly) flagged as
 * suspicious.
 *
 * v2 changes
 * ──────────
 * 1. **TF-weighted JD keywords**. Each JD keyword carries weight
 *    `sqrt(count)` so a term mentioned 5× counts ~2.2× a singleton —
 *    sub-linear so high-frequency terms don't dominate completely.
 * 2. **Laplace smoothing** on every per-category ratio. Adds an
 *    `ALPHA` pseudo-weight at `BASELINE` credit before the division —
 *    so a tiny category with one matched keyword can't jump from 0% to
 *    80%. Also forces `[low, high]` clamping into a realistic band.
 * 3. **Final clamp** to `[FLOOR, CEIL]` so we never display 0% or 100%
 *    — both are red flags in real-world ATS-style scorers and don't
 *    reflect reality (every resume has *some* signal; no resume is a
 *    perfect match).
 *
 * Public API is unchanged. `ATSScore` shape, `extractKeywords` (binary
 * presence map keyed by canonical), `scoreResume` and
 * `scoreResumeFromKeywords` all keep their existing signatures so no
 * caller needs to change. The internal JD pass switches from a binary
 * Map to a weighted one (private helper) so we can apply TF weights
 * without breaking the resume-side API.
 */

// ─── Keyword Taxonomy ────────────────────────────────────────────────

const TECHNICAL_SKILLS = new Set([
  // Languages
  'python', 'java', 'javascript', 'typescript', 'go', 'golang', 'rust', 'c++',
  'c#', 'ruby', 'scala', 'kotlin', 'swift', 'php', 'sql', 'r', 'bash', 'shell',
  'perl', 'lua', 'haskell', 'elixir', 'dart', 'objective-c',
  // Frontend
  'react', 'angular', 'vue', 'svelte', 'next.js', 'nextjs', 'nuxt',
  'html', 'css', 'sass', 'tailwind', 'webpack', 'vite', 'redux',
  'graphql', 'rest', 'restful',
  // Backend
  'node.js', 'nodejs', 'express', 'django', 'flask', 'fastapi', 'spring',
  'spring boot', 'rails', 'laravel', 'asp.net', 'gin', 'fiber',
  // Cloud & Infra
  'aws', 'amazon web services', 'gcp', 'google cloud', 'azure', 'ec2', 's3',
  'lambda', 'ecs', 'eks', 'fargate', 'cloudformation', 'terraform', 'pulumi',
  'docker', 'kubernetes', 'k8s', 'helm', 'istio', 'envoy',
  'jenkins', 'circleci', 'github actions', 'gitlab ci', 'argo', 'argocd',
  'datadog', 'splunk', 'grafana', 'prometheus', 'new relic', 'pagerduty',
  'cloudwatch', 'sentry',
  // Databases
  'postgresql', 'postgres', 'mysql', 'mongodb', 'dynamodb', 'redis', 'cassandra',
  'elasticsearch', 'opensearch', 'neo4j', 'cockroachdb', 'sqlite', 'oracle',
  'sql server', 'bigquery', 'redshift', 'snowflake',
  // Data & ML
  'spark', 'hadoop', 'hive', 'presto', 'trino', 'airflow', 'dagster',
  'kafka', 'kinesis', 'rabbitmq', 'sqs', 'sns', 'pubsub', 'flink',
  'tensorflow', 'pytorch', 'scikit-learn', 'pandas', 'numpy',
  'llm', 'gpt', 'bert', 'transformers', 'hugging face', 'langchain',
  'mlops', 'sagemaker', 'mlflow', 'kubeflow', 'feature store',
  // Mobile
  'ios', 'android', 'react native', 'flutter', 'swiftui',
  // DevOps / SRE
  'ci/cd', 'cicd', 'devops', 'sre', 'site reliability',
  'infrastructure as code', 'iac', 'ansible', 'puppet', 'chef',
  'linux', 'unix', 'nginx', 'load balancing',
  // Architecture
  'microservices', 'monolith', 'event-driven', 'serverless', 'api gateway',
  'service mesh', 'distributed systems', 'distributed computing',
  'high availability', 'fault tolerance', 'scalability', 'low latency',
  'real-time', 'streaming', 'batch processing', 'etl', 'data pipeline',
  'data lake', 'data warehouse', 'data mesh',
  // Security
  'oauth', 'saml', 'sso', 'jwt', 'encryption', 'tls', 'ssl',
  'iam', 'rbac', 'zero trust', 'soc2', 'hipaa', 'gdpr', 'pci',
  'security', 'compliance', 'vulnerability', 'penetration testing',
  // Other tech
  'api', 'sdk', 'grpc', 'protobuf', 'websocket', 'http', 'tcp',
  'cdn', 'caching', 'memcached', 'git', 'github', 'gitlab', 'bitbucket',
  'jira', 'confluence', 'linear', 'notion',
]);

const MANAGEMENT_SKILLS = new Set([
  'engineering management', 'people management', 'team management',
  'technical leadership', 'tech lead', 'engineering leadership',
  'agile', 'scrum', 'kanban', 'sprint', 'sprint planning', 'retrospective',
  'roadmap', 'product roadmap', 'technical roadmap', 'strategy',
  'okr', 'okrs', 'kpi', 'kpis', 'metrics', 'goals',
  'hiring', 'recruiting', 'interviewing', 'talent acquisition',
  'mentoring', 'coaching', 'career development', 'career growth',
  'performance review', 'performance management', 'feedback',
  '1:1', 'one-on-one', '1-on-1', 'skip level',
  'cross-functional', 'cross functional', 'stakeholder management',
  'stakeholder', 'executive', 'c-suite', 'board',
  'budget', 'resource allocation', 'headcount', 'capacity planning',
  'team building', 'culture', 'diversity', 'inclusion', 'dei',
  'organizational design', 'org design', 'org structure',
  'vendor management', 'outsourcing', 'contractor',
  'project management', 'program management', 'delivery',
  'incident management', 'on-call', 'oncall', 'escalation',
  'process improvement', 'operational excellence', 'toil reduction',
  'change management', 'transformation', 'migration',
  'technical debt', 'tech debt', 'code quality',
  'architecture review', 'design review', 'code review',
]);

const DOMAIN_KEYWORDS = new Set([
  'machine learning', 'ml', 'artificial intelligence', 'ai',
  'deep learning', 'nlp', 'natural language processing',
  'computer vision', 'recommendation', 'personalization',
  'search', 'ranking', 'information retrieval',
  'payments', 'fintech', 'financial', 'banking', 'trading',
  'e-commerce', 'ecommerce', 'marketplace', 'advertising', 'ads',
  'social media', 'messaging', 'communication', 'collaboration',
  'healthcare', 'health', 'biotech', 'genomics',
  'autonomous', 'self-driving', 'robotics', 'iot',
  'gaming', 'video', 'streaming', 'media', 'content',
  'enterprise', 'saas', 'b2b', 'b2c', 'platform',
  'developer tools', 'developer experience', 'developer platform',
  'infrastructure', 'cloud infrastructure', 'edge computing',
  'networking', 'storage', 'compute', 'database',
  'observability', 'monitoring', 'logging', 'tracing',
  'trust and safety', 'trust & safety', 'fraud', 'abuse',
  'privacy', 'data protection', 'consent',
  'supply chain', 'logistics', 'delivery', 'fleet',
  'growth', 'engagement', 'retention', 'activation',
  'identity', 'authentication', 'authorization',
]);

const SOFT_SKILLS = new Set([
  'communication', 'written communication', 'verbal communication',
  'presentation', 'public speaking', 'storytelling',
  'collaboration', 'teamwork', 'partnership',
  'problem solving', 'problem-solving', 'critical thinking',
  'decision making', 'decision-making', 'judgment',
  'leadership', 'influence', 'vision',
  'accountability', 'ownership', 'initiative',
  'adaptability', 'flexibility', 'resilience',
  'empathy', 'emotional intelligence',
  'negotiation', 'conflict resolution',
  'time management', 'prioritization',
  'innovation', 'creativity',
  'customer focus', 'customer obsession', 'user focus',
  'data-driven', 'data driven', 'analytical',
  'results-oriented', 'results oriented', 'bias for action',
  'strategic thinking', 'systems thinking',
]);

// Synonym map: maps common variations to a canonical form
const SYNONYMS: Record<string, string> = {
  'amazon web services': 'aws',
  'google cloud platform': 'gcp',
  'google cloud': 'gcp',
  'microsoft azure': 'azure',
  'node.js': 'nodejs',
  'next.js': 'nextjs',
  'react.js': 'react',
  'vue.js': 'vue',
  'c#': 'csharp',
  'c++': 'cpp',
  'objective-c': 'objc',
  'spring boot': 'spring',
  'asp.net': 'aspnet',
  'github actions': 'github-actions',
  'gitlab ci': 'gitlab-ci',
  'sci-kit learn': 'scikit-learn',
  'k8s': 'kubernetes',
  'ci/cd': 'cicd',
  '1:1': 'one-on-one',
  '1-on-1': 'one-on-one',
  'one on one': 'one-on-one',
  'cross functional': 'cross-functional',
  'problem solving': 'problem-solving',
  'decision making': 'decision-making',
  'data driven': 'data-driven',
  'results oriented': 'results-oriented',
  'e-commerce': 'ecommerce',
  'machine learning': 'ml',
  'artificial intelligence': 'ai',
  'natural language processing': 'nlp',
  'deep learning': 'dl',
  'site reliability': 'sre',
  'infrastructure as code': 'iac',
  'engineering management': 'eng-management',
  'people management': 'people-mgmt',
  'technical leadership': 'tech-leadership',
  'developer experience': 'devex',
  'developer tools': 'dev-tools',
};

// ─── Types ───────────────────────────────────────────────────────────

type Category = 'technical' | 'management' | 'domain' | 'soft';

export interface KeywordMatch {
  keyword: string;
  category: 'technical' | 'management' | 'domain' | 'soft';
  found: boolean;
}

export interface ATSScore {
  overall: number; // 0-100
  technical: number;
  management: number;
  domain: number;
  soft: number;
  matchedKeywords: string[];
  missingKeywords: string[];
  keywordDetails: KeywordMatch[];
  totalJdKeywords: number;
  totalMatched: number;
}

// ─── Scoring Weights ─────────────────────────────────────────────────

const WEIGHTS = {
  technical: 0.45,
  management: 0.22,
  domain: 0.18,
  soft: 0.15,
};

/**
 * Laplace smoothing — applied to every per-category ratio to soften the
 * jumps that small JDs produce. Without it, 4 matches out of a 5-keyword
 * category swings 0% → 80% which is exactly what made v1 feel gameable.
 *
 * Picture each ratio as `(matched_weight + ALPHA*BASELINE) / (total_weight + ALPHA)`:
 *   - ALPHA acts like an additional pseudo-keyword pulling the score
 *     toward the BASELINE credit (~55% — "average resume baseline").
 *   - As `total_weight` grows, ALPHA's influence shrinks naturally —
 *     so a JD with 30 keywords behaves close to a true ratio while a
 *     JD with 4 keywords stays anchored near the baseline.
 *
 * Tuning:
 *   - ALPHA = 6  → noticeable damping; 4-of-5 keyword JD scores ≈ 66%
 *                  instead of 80%, 0-of-5 ≈ 30% instead of 0%
 *   - BASELINE = 0.55 → matches the empirical "average industry score"
 *                  Jobscan/RW report (their default sample resume against
 *                  arbitrary JDs lands in the mid-50s).
 */
const SMOOTH_ALPHA = 6;
const SMOOTH_BASELINE = 0.55;

/**
 * Final clamp window. Real industry scorers never display 0% (every
 * resume has *some* relevance — at minimum the language matches, the
 * format parses) and never 100% (a perfect match is treated as
 * suspicious by hiring teams — implies copy-paste). Floor and ceiling
 * keep the displayed score honest.
 */
const SCORE_FLOOR = 25;
const SCORE_CEIL = 95;

// ─── Core helpers ────────────────────────────────────────────────────

function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .replace(/<[^>]+>/g, ' ')       // strip HTML tags
    .replace(/&[a-z]+;/g, ' ')      // strip HTML entities
    .replace(/['']/g, "'")           // normalize quotes
    .replace(/[""]/g, '"')
    .replace(/[\n\r\t]+/g, ' ')
    .replace(/[^\w\s\-./+#@&:]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function canonicalize(keyword: string): string {
  const lower = keyword.toLowerCase().trim();
  return SYNONYMS[lower] || lower;
}

// ─── Precompiled regex tables ─────────────────────────────────────────
//
// `extractKeywords` is called once per resume AND once per JD, and the
// taxonomy above has hundreds of entries. We compile each pattern once
// at module load and reuse the RegExp objects forever. v2 also exposes
// a global-flag variant per keyword so the JD pass can count occurrences
// (TF weighting) — the legacy non-global pattern stays available for the
// binary resume-side check used by callers via `extractKeywords`.

interface CompiledKeyword {
  keyword: string;
  canonical: string;
  patternBinary: RegExp;
  patternCount: RegExp;
}

function compileTable(set: Set<string>): CompiledKeyword[] {
  const out: CompiledKeyword[] = [];
  for (const keyword of set) {
    const canonical = canonicalize(keyword);
    const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // Phrase keywords (containing a space) match plain substrings with
    // case-insensitive flag — same as v1, preserves identical detection
    // behavior. Single tokens use word boundaries.
    const binarySrc = keyword.includes(' ') ? escaped : `\\b${escaped}\\b`;
    const patternBinary = new RegExp(binarySrc, 'i');
    const patternCount = new RegExp(binarySrc, 'gi');
    out.push({ keyword, canonical, patternBinary, patternCount });
  }
  return out;
}

const TECHNICAL_COMPILED = compileTable(TECHNICAL_SKILLS);
const MANAGEMENT_COMPILED = compileTable(MANAGEMENT_SKILLS);
const DOMAIN_COMPILED = compileTable(DOMAIN_KEYWORDS);
const SOFT_COMPILED = compileTable(SOFT_SKILLS);

/**
 * Extract meaningful keywords/phrases from text, matched against the
 * taxonomy. **Binary presence** — Map<canonical, category>. Same shape
 * v1 exposed; callers (resume side + cache key building) keep working.
 */
export function extractKeywords(text: string): Map<string, Category> {
  const normalized = normalizeText(text);
  const found = new Map<string, Category>();

  const checkTable = (table: CompiledKeyword[], category: Category) => {
    for (const { canonical, patternBinary } of table) {
      if (found.has(canonical)) continue;
      if (patternBinary.test(normalized)) {
        found.set(canonical, category);
      }
    }
  };

  checkTable(TECHNICAL_COMPILED, 'technical');
  checkTable(MANAGEMENT_COMPILED, 'management');
  checkTable(DOMAIN_COMPILED, 'domain');
  checkTable(SOFT_COMPILED, 'soft');

  return found;
}

/**
 * Same scan as `extractKeywords`, but returns the JD's per-keyword
 * occurrence COUNT instead of a binary presence flag. Used internally
 * by the scorer to weight repeated terms (sqrt of count for sub-linear
 * diminishing returns).
 *
 * Multiple keywords can collapse to the same canonical (e.g. "amazon
 * web services" and "aws") — counts are summed under the canonical so
 * we don't double-charge a single concept.
 */
interface WeightedJdKeyword {
  category: Category;
  count: number;
  weight: number;
}

function extractKeywordsWithCounts(text: string): Map<string, WeightedJdKeyword> {
  const normalized = normalizeText(text);
  const found = new Map<string, WeightedJdKeyword>();

  const tally = (table: CompiledKeyword[], category: Category) => {
    for (const { canonical, patternCount } of table) {
      // `match()` with a /g pattern returns all hits or null.
      const hits = normalized.match(patternCount);
      if (!hits || hits.length === 0) continue;
      const existing = found.get(canonical);
      if (existing) {
        // Synonym collapse: two surface forms map to the same canonical
        // — merge their counts and recompute the sub-linear weight.
        existing.count += hits.length;
        existing.weight = Math.sqrt(existing.count);
      } else {
        found.set(canonical, {
          category,
          count: hits.length,
          weight: Math.sqrt(hits.length),
        });
      }
    }
  };

  tally(TECHNICAL_COMPILED, 'technical');
  tally(MANAGEMENT_COMPILED, 'management');
  tally(DOMAIN_COMPILED, 'domain');
  tally(SOFT_COMPILED, 'soft');

  return found;
}

/**
 * Per-category Laplace-smoothed coverage ratio expressed as 0-100.
 * Treats each JD keyword as carrying its TF-derived weight, then adds
 * an `ALPHA` pseudo-keyword pulling toward `BASELINE` so tiny categories
 * can't swing wildly. Returns the smoothed percent (rounded).
 */
function smoothedPercent(matchedWeight: number, totalWeight: number): number {
  if (totalWeight === 0) {
    // Nothing to score in this category — display the baseline so
    // tiny-or-empty categories don't display 0% or 100% (both lie).
    return Math.round(SMOOTH_BASELINE * 100);
  }
  const ratio =
    (matchedWeight + SMOOTH_ALPHA * SMOOTH_BASELINE) /
    (totalWeight + SMOOTH_ALPHA);
  return Math.round(Math.max(0, Math.min(1, ratio)) * 100);
}

/**
 * Score a resume against a job description.
 */
export function scoreResume(resumeText: string, jobDescription: string): ATSScore {
  // Thin wrapper — factored so batch callers can extract the resume's
  // keyword map once and reuse it across many JDs. Output is identical to
  // calling `scoreResumeFromKeywords(extractKeywords(resumeText), jd)`.
  return scoreResumeFromKeywords(extractKeywords(resumeText), jobDescription);
}

/**
 * Same scoring as `scoreResume`, but takes the resume's already-extracted
 * keyword map so batch callers can avoid re-running `extractKeywords` on
 * the same resume for every listing. Results are bit-for-bit identical to
 * `scoreResume(resumeText, jobDescription)` when called with
 * `extractKeywords(resumeText)`.
 */
export function scoreResumeFromKeywords(
  resumeKeywords: Map<string, Category>,
  jobDescription: string
): ATSScore {
  // v2: use TF-weighted JD keywords. Resume side stays binary — that's
  // appropriate (we just want to know whether the resume mentions a term,
  // not how often). Weighting on the JD side captures importance.
  const jdKeywords = extractKeywordsWithCounts(jobDescription);

  const details: KeywordMatch[] = [];
  const matched: string[] = [];
  const missing: string[] = [];

  // Per-category running totals for matched and total *weight* (not raw
  // counts). The weighted ratio is what feeds the smoother below.
  const stats = {
    technical: { matchedW: 0, totalW: 0 },
    management: { matchedW: 0, totalW: 0 },
    domain: { matchedW: 0, totalW: 0 },
    soft: { matchedW: 0, totalW: 0 },
  };

  for (const [canonical, info] of jdKeywords) {
    stats[info.category].totalW += info.weight;
    const isFound = resumeKeywords.has(canonical);
    details.push({ keyword: canonical, category: info.category, found: isFound });
    if (isFound) {
      stats[info.category].matchedW += info.weight;
      matched.push(canonical);
    } else {
      missing.push(canonical);
    }
  }

  const technical = smoothedPercent(stats.technical.matchedW, stats.technical.totalW);
  const management = smoothedPercent(stats.management.matchedW, stats.management.totalW);
  const domain = smoothedPercent(stats.domain.matchedW, stats.domain.totalW);
  const soft = smoothedPercent(stats.soft.matchedW, stats.soft.totalW);

  // Weighted overall — only categories with at least one JD keyword
  // contribute to the average (so a JD that never mentions soft skills
  // doesn't pull the score toward 55% via the smoothing baseline).
  let overallNumer = 0;
  let overallDenom = 0;
  if (stats.technical.totalW > 0) {
    overallNumer += technical * WEIGHTS.technical;
    overallDenom += WEIGHTS.technical;
  }
  if (stats.management.totalW > 0) {
    overallNumer += management * WEIGHTS.management;
    overallDenom += WEIGHTS.management;
  }
  if (stats.domain.totalW > 0) {
    overallNumer += domain * WEIGHTS.domain;
    overallDenom += WEIGHTS.domain;
  }
  if (stats.soft.totalW > 0) {
    overallNumer += soft * WEIGHTS.soft;
    overallDenom += WEIGHTS.soft;
  }
  const rawOverall = overallDenom > 0 ? overallNumer / overallDenom : SMOOTH_BASELINE * 100;

  // Final clamp into a believable display window.
  const overall = Math.round(Math.max(SCORE_FLOOR, Math.min(SCORE_CEIL, rawOverall)));

  return {
    overall,
    technical,
    management,
    domain,
    soft,
    matchedKeywords: matched.sort(),
    missingKeywords: missing.sort(),
    keywordDetails: details,
    totalJdKeywords: jdKeywords.size,
    totalMatched: matched.length,
  };
}
