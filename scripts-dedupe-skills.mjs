// Conservative cleanup of the user's Master_Resume_2026_vF.docx
// skills section. Per user feedback, the previous aggressive pass
// stripped too much; this rewrite keeps the original 4-category
// structure and ONLY removes the four true duplicates the user
// flagged:
//
//   1. "Distributed Systems" + "Distributed computing"
//        → "Distributed Computing and Systems"  (in Systems & Architecture)
//        → "Distributed computing" removed from Cloud & Stack
//   2. "High-Availability (99.999% SLA/SLO/SLI)" (Systems) + "High availability" (Cloud)
//        → "High availability" removed from Cloud & Stack
//   3. "Personalization" + "Search Personalization"  (both in AI / ML)
//        → "Search Personalization" removed
//   4. "Postgres" + "Postgresql"  (both in Cloud & Stack)
//        → "Postgresql" removed
//
// Everything else — Agile/Scrum/Sprint/Sprint planning, Hiring/
// Recruiting/Talent acquisition/Interviewing, OKRs/Kpis/Goals/
// Metrics, Tech Leadership/Tech lead/Engineering Management, all
// soft skills, all industry verticals — stays as-is.
//
// Run with:  node scripts-dedupe-skills.mjs

import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import JSZip from 'jszip';

const exec = promisify(execFile);
const HOME = process.env.HOME;
const IN = `${HOME}/Downloads/Dheeraj_Kumar_Paras_Master_Resume_2026_vF.docx`;
const OUT_DOCX = `${HOME}/Downloads/Dheeraj_Kumar_Paras_Master_Resume_2026_DEDUPED.docx`;
const OUT_PDF = `${HOME}/Downloads/Dheeraj_Kumar_Paras_Master_Resume_2026_DEDUPED.pdf`;

// Original 4 sections — only the targeted dedupes applied. Order
// preserved exactly as in the source so the docx output reads
// identically minus the four removed/renamed tokens.
const NEW_SKILLS = [
  {
    label: 'Leadership',
    items: [
      // Unchanged from source.
      'Engineering Management', 'People Management', 'Performance Management',
      'Career Development', 'Talent Development', 'OKRs', 'Technical Strategy',
      'Technical Excellence', 'Operational Excellence', 'Engineering Roadmap',
      'Headcount Planning', 'Hiring', 'Mentorship', 'Cross-functional Collaboration',
      'Stakeholder Management', 'Organizational Development', 'Agile', 'Scrum',
      'Culture', 'Inclusion', 'Goals', 'Recruiting', 'Diversity', 'Feedback',
      'Architecture review', 'Career growth', 'Vision', 'Innovation',
      'Bias for action', 'Contractor', 'Technical debt', 'Change management',
      'Executive', 'Prioritization', 'Influence', 'Tech Leadership', 'Metrics',
      'Transformation', 'Budget', 'Code quality', 'Tech lead',
      'Engineering leadership', 'Team building', 'Board', 'Code review',
      'Migration', 'Incident management', 'Escalation', 'Kpis', 'One On One',
      'Product roadmap', 'Sprint', 'Talent acquisition', 'Design review',
      'Process improvement', 'Project management', 'Team management',
      'Capacity planning', 'Interviewing', 'Org structure', 'Resource allocation',
      'Sprint planning', 'Ownership', 'Creativity', 'Decision Making', 'Empathy',
      'Judgment', 'Flexibility', 'Initiative', 'Problem Solving', 'Storytelling',
      'Accountability', 'Data Driven', 'Verbal communication', 'Adaptability',
      'Analytical', 'Teamwork', 'Strategic thinking', 'Critical thinking',
      'Customer focus', 'Results Oriented', 'Systems thinking',
      'Written communication', 'Customer obsession',
    ],
  },
  {
    label: 'Systems & Architecture',
    items: [
      // "Distributed Systems" → "Distributed Computing and Systems"
      // (collapses with the Cloud-section "Distributed computing").
      'Distributed Computing and Systems', 'Large-Scale Systems',
      'High-Availability (99.999% SLA/SLO/SLI)', 'Scalability', 'Observability',
      'Infrastructure', 'Platform Engineering', 'Microservices',
      'Event-Driven Architecture', 'Cloud-Native Design', 'System Design',
      'Fault-Tolerant Systems', 'Low-Latency Services', 'Traffic Routing',
      'Concurrency Management', 'Auto-Scaling',
      'API Design (REST, GraphQL, API Gateway)', 'Serverless', 'Streaming',
      'Caching',
    ],
  },
  {
    label: 'Cloud & Stack',
    items: [
      'AWS Lambda', 'Firecracker MicroVMs', 'Amazon ECS', 'EC2', 'SageMaker',
      'DynamoDB', 'S3', 'SQS', 'SNS', 'CloudWatch', 'CloudFormation (IaC)',
      'Docker', 'CI/CD', 'Kafka', 'Apache Spark', 'Java', 'Kotlin', 'TypeScript',
      'Python', 'SQL', 'Compliance', 'Mlflow', 'Real Time', 'Data pipeline',
      'Fault tolerance', 'Low latency', 'Security', 'Kubernetes',
      // "Distributed computing" REMOVED (moved into Systems above).
      'Javascript', 'React', 'Sre', 'Airflow', 'Spring', 'Data warehouse', 'Etl',
      'Gdpr',
      // "High availability" REMOVED (already in Systems as
      // "High-Availability (99.999% SLA/SLO/SLI)").
      'Transformers', 'Batch processing', 'Devops', 'Git', 'Load balancing',
      'Redis', 'Gcp', 'Go', 'Gpt', 'Android', 'Azure', 'Flink', 'Snowflake',
      'Ios', 'Data lake', 'Pytorch', 'Tensorflow', 'Bigquery', 'Linux', 'Mlops',
      'Rust', 'Linear', 'Postgres', 'Cassandra', 'Cdn', 'Eks', 'Elasticsearch',
      'Feature store', 'Nodejs',
      // "Postgresql" REMOVED (kept "Postgres").
      'Redshift', 'Sdk', 'Service mesh', 'Shell',
    ],
  },
  {
    label: 'AI / ML',
    items: [
      'Machine Learning', 'Recommendation Systems', 'Personalization',
      'Large Language Models (LLM)', 'LLMOps', 'Generative AI', 'Agentic AI',
      'Content Moderation', 'A/B Testing', 'Experimentation',
      // "Search Personalization" REMOVED (kept "Personalization").
      'Data Analytics', 'Communication', 'Identity', 'Growth', 'Financial',
      'Health', 'Saas', 'Autonomous', 'Devex', 'Privacy', 'Networking', 'Compute',
      'Nlp', 'Storage', 'Cloud infrastructure', 'Information retrieval', 'Ads',
      'Retention', 'Fleet', 'Marketplace', 'Dev Tools', 'Ecommerce', 'Tracing',
      'Trust and safety', 'Logistics', 'Banking', 'Healthcare', 'Authorization',
      'Payments', 'Database', 'Dl', 'Video', 'Media', 'Advertising', 'B2b',
      'Authentication', 'Consent', 'Fraud', 'Data protection', 'Developer platform',
    ],
  },
];

function buildSkillParagraph({ label, items }) {
  const body = items.join(', ');
  const esc = (s) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return (
    `<w:p>` +
    `<w:r><w:rPr><w:b/><w:bCs/></w:rPr><w:t xml:space="preserve">${esc(label)}: </w:t></w:r>` +
    `<w:r><w:t xml:space="preserve">${esc(body)}</w:t></w:r>` +
    `</w:p>`
  );
}

const newParagraphs = NEW_SKILLS.map(buildSkillParagraph).join('');

const inBuf = readFileSync(IN);
const zip = await JSZip.loadAsync(inBuf);
const docXml = await zip.file('word/document.xml').async('string');

function findParagraphRange(xml, startMarker, endMarker) {
  const startTextIdx = xml.indexOf(startMarker);
  if (startTextIdx === -1) throw new Error(`startMarker not found: ${startMarker}`);
  const startPIdx = xml.lastIndexOf('<w:p ', startTextIdx);
  const startPIdx2 = xml.lastIndexOf('<w:p>', startTextIdx);
  const startP = Math.max(startPIdx, startPIdx2);
  if (startP === -1) throw new Error('opening <w:p> not found before startMarker');
  const endTextIdx = xml.indexOf(endMarker);
  if (endTextIdx === -1) throw new Error(`endMarker not found: ${endMarker}`);
  const endCloseIdx = xml.indexOf('</w:p>', endTextIdx);
  if (endCloseIdx === -1) throw new Error('closing </w:p> not found after endMarker');
  return { start: startP, end: endCloseIdx + '</w:p>'.length };
}

const range = findParagraphRange(docXml, 'Leadership:', 'AI / ML');
const newDocXml = docXml.slice(0, range.start) + newParagraphs + docXml.slice(range.end);

console.log(`Old skills block: ${range.end - range.start} chars`);
console.log(`New skills block: ${newParagraphs.length} chars`);
console.log(`Trim: ${range.end - range.start - newParagraphs.length} chars saved`);

zip.file('word/document.xml', newDocXml);
const outBuf = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
writeFileSync(OUT_DOCX, outBuf);
console.log(`\n✓ Wrote ${OUT_DOCX}`);

async function convertToPdf(docxPath, outPath) {
  const tmp = mkdtempSync(join(tmpdir(), 'resume-pdf-'));
  try {
    await exec(
      '/Applications/LibreOffice.app/Contents/MacOS/soffice',
      ['--headless', '--convert-to', 'pdf', '--outdir', tmp, docxPath],
      { timeout: 60_000 },
    );
    const base = docxPath.split('/').pop().replace(/\.docx$/, '.pdf');
    const tmpPdf = join(tmp, base);
    const pdf = readFileSync(tmpPdf);
    writeFileSync(outPath, pdf);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

try {
  await convertToPdf(OUT_DOCX, OUT_PDF);
  console.log(`✓ Wrote ${OUT_PDF}`);
} catch (e) {
  console.error('PDF conversion failed:', e.message);
  process.exit(1);
}
