/**
 * ATS (Applicant Tracking System) scoring engine.
 * Compares resume text against a job description using keyword matching.
 * No AI required — purely deterministic keyword extraction & comparison.
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
  technical: 0.40,
  management: 0.25,
  domain: 0.20,
  soft: 0.15,
};

// ─── Core Functions ──────────────────────────────────────────────────

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

/**
 * Extract meaningful keywords/phrases from text,
 * matched against our taxonomy.
 */
export function extractKeywords(text: string): Map<string, 'technical' | 'management' | 'domain' | 'soft'> {
  const normalized = normalizeText(text);
  const found = new Map<string, 'technical' | 'management' | 'domain' | 'soft'>();

  const checkSet = (
    set: Set<string>,
    category: 'technical' | 'management' | 'domain' | 'soft'
  ) => {
    for (const keyword of set) {
      const canonical = canonicalize(keyword);
      if (found.has(canonical)) continue;

      // Use word boundary matching for short keywords, substring for multi-word
      const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const pattern = keyword.includes(' ')
        ? new RegExp(escaped, 'i')
        : new RegExp(`\\b${escaped}\\b`, 'i');

      if (pattern.test(normalized)) {
        found.set(canonical, category);
      }
    }
  };

  checkSet(TECHNICAL_SKILLS, 'technical');
  checkSet(MANAGEMENT_SKILLS, 'management');
  checkSet(DOMAIN_KEYWORDS, 'domain');
  checkSet(SOFT_SKILLS, 'soft');

  return found;
}

/**
 * Score a resume against a job description.
 */
export function scoreResume(resumeText: string, jobDescription: string): ATSScore {
  const jdKeywords = extractKeywords(jobDescription);
  const resumeKeywords = extractKeywords(resumeText);

  const details: KeywordMatch[] = [];
  const matched: string[] = [];
  const missing: string[] = [];

  const categoryStats = {
    technical: { total: 0, matched: 0 },
    management: { total: 0, matched: 0 },
    domain: { total: 0, matched: 0 },
    soft: { total: 0, matched: 0 },
  };

  for (const [keyword, category] of jdKeywords) {
    categoryStats[category].total++;
    const isFound = resumeKeywords.has(keyword);

    details.push({ keyword, category, found: isFound });

    if (isFound) {
      matched.push(keyword);
      categoryStats[category].matched++;
    } else {
      missing.push(keyword);
    }
  }

  const calcPercent = (cat: { total: number; matched: number }) =>
    cat.total === 0 ? 100 : Math.round((cat.matched / cat.total) * 100);

  const technical = calcPercent(categoryStats.technical);
  const management = calcPercent(categoryStats.management);
  const domain = calcPercent(categoryStats.domain);
  const soft = calcPercent(categoryStats.soft);

  // Weighted overall score
  let overall = 0;
  let totalWeight = 0;
  if (categoryStats.technical.total > 0) { overall += technical * WEIGHTS.technical; totalWeight += WEIGHTS.technical; }
  if (categoryStats.management.total > 0) { overall += management * WEIGHTS.management; totalWeight += WEIGHTS.management; }
  if (categoryStats.domain.total > 0) { overall += domain * WEIGHTS.domain; totalWeight += WEIGHTS.domain; }
  if (categoryStats.soft.total > 0) { overall += soft * WEIGHTS.soft; totalWeight += WEIGHTS.soft; }
  overall = totalWeight > 0 ? Math.round(overall / totalWeight) : 0;

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
