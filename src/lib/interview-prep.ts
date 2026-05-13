/**
 * Interview prep — deterministic question + STAR-prompt generator.
 *
 * For each listing the user picks, we synthesize a small set of
 * likely interview questions in three buckets, plus STAR-format
 * prompts the user can use to draft answers ahead of time.
 *
 * No LLM. The questions are derived from the JD's distinctive
 * surface area (top keywords, top bigrams, role-noun in the title)
 * combined with template patterns recruiters and EMs actually use
 * in screens. This isn't a substitute for real prep but it's a
 * 30-second jump-start that beats staring at a blank doc.
 *
 * Buckets
 * ───────
 *  - **Behavioral**   — leadership / conflict / influence prompts
 *                       seeded with the JD's role-noun.
 *  - **Technical**    — system-design / depth-of-X prompts seeded
 *                       with the top JD keywords + bigrams.
 *  - **Company-fit**  — "why us" / "tell me about a time" prompts
 *                       seeded with the JD's mission sentence.
 *
 * STAR prompts use the same JD signals to pre-fill the
 * Situation / Task / Action / Result skeleton with the right
 * keyword for ATS-friendly drafting.
 */

import { extractKeywords } from './ats-scorer';
import type { JobListing } from './types';

export interface InterviewPrepInput {
  jdContent: string;
  listing: JobListing;
}

export interface InterviewQuestion {
  bucket: 'behavioral' | 'technical' | 'company-fit';
  question: string;
  starPrompt?: string;
}

export interface InterviewPrepOutput {
  questions: InterviewQuestion[];
  topKeywords: string[];
}

const ROLE_NOUNS = /\b(engineer|manager|director|lead|architect|scientist|developer|analyst|designer)\b/i;

function extractTopKeywords(jdContent: string, max = 6): string[] {
  const kw = extractKeywords(jdContent);
  // Prefer technical + domain bucket entries — those are the ones
  // most likely to drive a "depth-of-X" interview question.
  const ordered: string[] = [];
  for (const [k, cat] of kw) {
    if (cat === 'technical' || cat === 'domain') ordered.push(k);
    if (ordered.length >= max) break;
  }
  // Pretty-print: kebab-case → Title Case.
  return ordered.map((k) =>
    k.split(/[-_]/).map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' '),
  );
}

function extractMission(jdContent: string): string | null {
  const plain = jdContent
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z]+;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const sentences = plain.split(/(?<=[.!])\s+/).slice(0, 30);
  for (const s of sentences) {
    if (s.length < 40 || s.length > 240) continue;
    if (/\b(we|our team|the team|you'?ll|you will|join us)\b/i.test(s)) return s.trim();
  }
  return null;
}

function extractRoleNoun(title: string): string {
  const m = title.match(ROLE_NOUNS);
  return m ? m[0].toLowerCase() : 'role';
}

export function generateInterviewPrep(input: InterviewPrepInput): InterviewPrepOutput {
  const { jdContent, listing } = input;
  const topKw = extractTopKeywords(jdContent, 6);
  const roleNoun = extractRoleNoun(listing.title);
  const mission = extractMission(jdContent);

  const questions: InterviewQuestion[] = [];

  // ─── Behavioral ────────────────────────────────────────────────
  questions.push({
    bucket: 'behavioral',
    question: `Tell me about a time you led a high-stakes ${roleNoun} initiative through ambiguity.`,
    starPrompt:
      'Situation: scope the ambiguity (team / org / external).\n' +
      'Task: what was at stake and what did the org need from you?\n' +
      'Action: 2-3 specific decisions (with named technologies / processes if relevant).\n' +
      'Result: quantified outcome + lasting org impact.',
  });
  questions.push({
    bucket: 'behavioral',
    question: 'Walk me through a time you had to push back on a senior stakeholder. How did you frame it?',
    starPrompt:
      'Situation: who, what they wanted, why you disagreed.\n' +
      'Task: the responsibility you owned that made the pushback necessary.\n' +
      'Action: how you communicated (data, alternatives, timing).\n' +
      'Result: the decision, the relationship after, the long-term outcome.',
  });
  questions.push({
    bucket: 'behavioral',
    question: 'Describe a hire (or a fire) that didn\'t go the way you expected. What did you learn?',
  });

  // ─── Technical ──────────────────────────────────────────────────
  if (topKw.length > 0) {
    const primary = topKw[0];
    questions.push({
      bucket: 'technical',
      question: `Walk me through a system you designed or extended that uses ${primary}. What were the trade-offs?`,
      starPrompt:
        `Situation: the problem ${primary} was solving (scale, latency, reliability).\n` +
        `Task: your specific design responsibility.\n` +
        `Action: 2-3 concrete trade-offs (consistency vs availability, build vs buy, …).\n` +
        `Result: measurable production outcome.`,
    });
  }
  if (topKw.length > 1) {
    questions.push({
      bucket: 'technical',
      question: `If we asked you to design a ${topKw[1]} system from scratch this week, where would you start?`,
    });
  }
  if (topKw.length > 2) {
    questions.push({
      bucket: 'technical',
      question: `What's the most surprising failure mode you've seen in production with ${topKw[2]}?`,
    });
  }
  questions.push({
    bucket: 'technical',
    question: 'Tell me about an architectural decision you made that you would do differently today.',
    starPrompt:
      'Situation: the constraints when you decided.\n' +
      'Task: the system requirement.\n' +
      'Action: what you chose + why at the time.\n' +
      'Result: what the world taught you and what you would change.',
  });

  // ─── Company / Role fit ─────────────────────────────────────────
  questions.push({
    bucket: 'company-fit',
    question: `Why ${listing.company}, and why this team specifically?`,
    starPrompt: mission
      ? `Anchor on this line from the JD: "${mission}" — explain why that problem space is where you want to spend the next chapter, with one specific example from your past that maps to it.`
      : 'Anchor on the team mission. Connect to a specific example from your past that maps to it.',
  });
  questions.push({
    bucket: 'company-fit',
    question: `What are the first 90 days as a ${roleNoun} on this team look like to you?`,
  });
  if (topKw.length >= 3) {
    questions.push({
      bucket: 'company-fit',
      question: `The JD emphasizes ${topKw.slice(0, 3).join(', ')}. Which of those is a strength you'd lead with, and which would you grow into?`,
    });
  }

  return { questions, topKeywords: topKw };
}
