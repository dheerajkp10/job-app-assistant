/**
 * Outreach email drafter — quick recruiter / referral email
 * templates seeded with the listing's specifics. Sibling to the
 * cover-letter generator but ~3 paragraphs short instead of a full
 * letter.
 *
 * Templates
 * ─────────
 *  - `recruiter-intro`     — "I just applied" follow-up to a
 *                            recruiter at the company.
 *  - `referral-request`    — ask a 1st/2nd-degree contact for a
 *                            referral.
 *  - `recruiter-followup`  — "haven't heard back" check-in 7 days
 *                            after applying.
 *  - `hiring-mgr-intro`    — direct message to a hiring manager
 *                            with a brief case for fit.
 *
 * All four take the same input (listing + resume) and return
 * Subject + Body strings ready to paste into the user's email
 * client.
 */

import type { JobListing } from './types';
import { extractKeywords } from './ats-scorer';

export type OutreachTemplate =
  | 'recruiter-intro'
  | 'referral-request'
  | 'recruiter-followup'
  | 'hiring-mgr-intro';

export interface OutreachInput {
  listing: JobListing;
  resumeText: string;
  userName: string;
  template: OutreachTemplate;
  /** Optional: contact's name to address the email to. */
  contactName?: string;
}

export interface OutreachOutput {
  subject: string;
  body: string;
}

function topMatchedKeywords(resumeText: string, jdContent: string, max = 3): string[] {
  // Out of scope here — we don't have the JD body in this lib (it's
  // wired through the API). The route can call this with the resume
  // text only; for the body we use whatever signals exist in the
  // resume itself. We only use the keyword extractor on the resume
  // to find 2-3 high-signal proof phrases the user can paste.
  void jdContent;
  const kw = extractKeywords(resumeText);
  const ordered: string[] = [];
  for (const [k, cat] of kw) {
    if (cat === 'technical' || cat === 'domain') ordered.push(k);
    if (ordered.length >= max) break;
  }
  return ordered.map((k) =>
    k.split(/[-_]/).map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' '),
  );
}

function joinNatural(items: string[]): string {
  if (items.length === 0) return '';
  if (items.length === 1) return items[0];
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(', ')}, and ${items[items.length - 1]}`;
}

export function generateOutreachEmail(input: OutreachInput): OutreachOutput {
  const { listing, resumeText, userName, template, contactName } = input;
  const greetingName = contactName || 'there';
  const proofKws = topMatchedKeywords(resumeText, '');

  switch (template) {
    case 'recruiter-intro':
      return {
        subject: `Application for ${listing.title} at ${listing.company}`,
        body: [
          `Hi ${greetingName},`,
          ``,
          `I applied to the ${listing.title} role at ${listing.company} earlier today and wanted to send a short note in case it helps your screen.`,
          ``,
          `My background spans ${joinNatural(proofKws) || 'directly relevant systems and team-leading work'}, all areas the role calls out. I'd welcome the chance to walk through how that maps to what your team is taking on.`,
          ``,
          `Happy to share my resume, references, or specific writeups if useful — let me know what's most helpful.`,
          ``,
          `Thanks,`,
          userName,
        ].join('\n'),
      };

    case 'referral-request':
      return {
        subject: `Quick question — ${listing.title} at ${listing.company}`,
        body: [
          `Hi ${greetingName},`,
          ``,
          `I saw a ${listing.title} role open at ${listing.company} that lines up well with what I've been doing in ${joinNatural(proofKws) || 'recent roles'}, and I wanted to ask if you'd be open to referring me.`,
          ``,
          `Happy to share a tailored resume or jump on 15 minutes so you can decide whether it's a fit. No pressure either way — and if not, I'd love your read on the team or anyone else there who might be the right person to talk to.`,
          ``,
          `Thanks for considering,`,
          userName,
        ].join('\n'),
      };

    case 'recruiter-followup':
      return {
        subject: `Following up — ${listing.title} at ${listing.company}`,
        body: [
          `Hi ${greetingName},`,
          ``,
          `I wanted to follow up on my application for the ${listing.title} role at ${listing.company} from last week. I'm still very interested and happy to provide anything that would help your screen — additional context, references, or a quick call.`,
          ``,
          `Thanks again for your time,`,
          userName,
        ].join('\n'),
      };

    case 'hiring-mgr-intro':
      return {
        subject: `${listing.title} — quick intro`,
        body: [
          `Hi ${greetingName},`,
          ``,
          `I came across the ${listing.title} opening on your team at ${listing.company} and wanted to reach out directly. ${proofKws.length > 0 ? `I've been working in ${joinNatural(proofKws)} for the last several years and the problem space the team is tackling is exactly where I want to spend the next chapter.` : `The problem space your team is tackling is exactly where I want to spend the next chapter.`}`,
          ``,
          `Would you be open to a 20-minute conversation to share where I am and learn more about what the team needs? I'm happy to send my resume ahead so you can decide whether it's worth the time.`,
          ``,
          `Thanks for considering,`,
          userName,
        ].join('\n'),
      };
  }
}
