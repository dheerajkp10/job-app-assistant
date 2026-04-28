/**
 * Work-Experience injector.
 *
 * Adds new resume-style bullets to the Work Experience section of the
 * user's .docx, placing each new bullet under the position whose
 * existing content is most relevant to the missing keyword(s).
 *
 * Design goals:
 *   1. Append-only. We NEVER rewrite or remove an existing bullet —
 *      only add new ones cloned from the position's last bullet so
 *      formatting (font, numPr, indentation) is preserved.
 *   2. Per-position relevance. A keyword is only injected under a
 *      position if its JD context overlaps materially with that
 *      position's existing bullet text. That way "Kubernetes" won't
 *      get dropped under a role that was clearly a pure-management
 *      position with no infra signal.
 *   3. Budget-aware. Callers pass `maxPositions` / `maxKeywordsPerBullet`
 *      and we cap injections accordingly. This is the knob the
 *      page-length budget ladder uses to back off when a resume
 *      overflows to page 2.
 *   4. No duplicates. Keywords already present in a position's
 *      existing text are excluded from its injection set.
 *
 * Relevance scoring is a deliberately-simple token overlap:
 *   context(K)   = tokens in a ±120-char window around each occurrence
 *                  of K in the JD (approximates "the sentence about K")
 *   position(P)  = tokens in all existing bullets of position P
 *   relevance    = |context(K) ∩ position(P)|  after stopword filter
 *
 * Simple works well here because the signal is strong: if a position
 * and a keyword's JD context share multiple non-stopword tokens, the
 * role is about the same stuff the JD talks about. If they share 0-1,
 * they're probably not related.
 */

import { buildWorkExperienceBullet } from './resume-tailor';

// ─── Tokenization ────────────────────────────────────────────────────

const STOP_WORDS = new Set([
  'the', 'and', 'for', 'with', 'this', 'that', 'these', 'those', 'will',
  'our', 'you', 'your', 'are', 'was', 'were', 'has', 'have', 'had', 'can',
  'from', 'into', 'over', 'under', 'about', 'across', 'through', 'between',
  'than', 'then', 'when', 'while', 'where', 'what', 'who', 'how', 'why',
  'all', 'any', 'some', 'each', 'every', 'most', 'more', 'many', 'much',
  'use', 'using', 'used', 'uses', 'used', 'able', 'also', 'such', 'been',
  'being', 'their', 'they', 'them', 'there', 'here', 'its', 'not',
  'but', 'yet', 'out', 'off', 'onto', 'upon', 'within', 'without',
  'very', 'just', 'only', 'same', 'other', 'another', 'including', 'include',
  'etc', 'per', 'via', 'across', 'role', 'team', 'teams', 'work', 'working',
  'new', 'new-hire', 'we', 'us', 'i', 'he', 'she', 'him', 'her', 'his', 'hers',
]);

function tokenize(text: string): Set<string> {
  const out = new Set<string>();
  const lowered = text.toLowerCase();
  // Match words of 3+ chars plus simple hyphenated/dot tokens (e.g. ci/cd, k8s, node.js).
  const re = /[a-z][a-z0-9+.\-/]{2,}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(lowered)) !== null) {
    const tok = m[0].replace(/[.\-/]+$/, '');
    if (tok.length < 3) continue;
    if (STOP_WORDS.has(tok)) continue;
    out.add(tok);
  }
  return out;
}

/** Expand a kebab-case keyword into its display-form tokens for
 *  matching against position bullet text. "distributed-systems" →
 *  ["distributed", "systems", "distributed-systems"]. */
function keywordAliases(keyword: string): string[] {
  const lower = keyword.toLowerCase();
  const parts = lower.split(/[-_/\s]+/).filter((p) => p.length >= 3);
  return [lower, ...parts];
}

// ─── Paragraph parsing ───────────────────────────────────────────────

interface Paragraph {
  /** Start index of `<w:p...>` in the source XML. */
  start: number;
  /** End index (exclusive) — one past `</w:p>`. */
  end: number;
  /** Full paragraph XML including tags. */
  xml: string;
  /** Extracted plain text of all `<w:t>` runs in the paragraph. */
  text: string;
  /** True if the paragraph has a `<w:numPr>` list-marker (i.e. a bullet). */
  isBullet: boolean;
  /** True if the paragraph looks like a position/role header. */
  isPositionHeader: boolean;
}

function extractTextFromParagraph(paraXml: string): string {
  const out: string[] = [];
  const re = /<w:t[^>]*>([\s\S]*?)<\/w:t>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(paraXml)) !== null) {
    out.push(
      m[1]
        .replace(/&amp;/g, '&')
        .replace(/&apos;/g, "'")
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"'),
    );
  }
  return out.join(' ').replace(/\s+/g, ' ').trim();
}

/** Parse every `<w:p>...</w:p>` within [start, end). */
function parseParagraphs(xml: string, start: number, end: number): Paragraph[] {
  const paras: Paragraph[] = [];
  const pOpen = /<w:p(?:\s[^>]*)?>/g;
  pOpen.lastIndex = start;
  while (true) {
    const openMatch = pOpen.exec(xml);
    if (!openMatch || openMatch.index >= end) break;
    const pStart = openMatch.index;
    const pEnd = xml.indexOf('</w:p>', pStart);
    if (pEnd < 0 || pEnd >= end) break;
    const paraEnd = pEnd + '</w:p>'.length;
    const paraXml = xml.substring(pStart, paraEnd);
    const text = extractTextFromParagraph(paraXml);
    const isBullet = /<w:numPr\b/.test(paraXml);
    // Position header heuristic: NOT a bullet, contains bold (<w:b/> or
    // <w:b w:val="true"/>), has a tab (dates are tab-aligned to the
    // right margin), and has non-trivial text.
    const hasBold =
      /<w:b\s*\/>/.test(paraXml) || /<w:b\s+w:val="(?:1|true)"\s*\/?>/.test(paraXml);
    const hasTab = /<w:tab\b/.test(paraXml) || text.includes('\t');
    const isPositionHeader =
      !isBullet && hasBold && hasTab && text.length > 4 && text.length < 200;
    paras.push({ start: pStart, end: paraEnd, xml: paraXml, text, isBullet, isPositionHeader });
    pOpen.lastIndex = paraEnd;
  }
  return paras;
}

// ─── Work Experience section discovery ───────────────────────────────

const SECTION_END_MARKERS = [
  '>EDUCATION<', '>SKILLS<', '>CORE COMPETENCIES<',
  '>CERTIFICATIONS<', '>PROJECTS<', '>PUBLICATIONS<',
  '>AWARDS<', '>VOLUNTEER<', '>INTERESTS<',
];

/** Find the XML range of the Work Experience section (content only —
 *  after the heading paragraph's `</w:p>`, before the next section's
 *  heading). Returns null if the heading isn't found. */
function findWorkExperienceRange(xml: string): { start: number; end: number } | null {
  // Match any common variant of the heading text.
  const headingRegex = />\s*(?:WORK EXPERIENCE|PROFESSIONAL EXPERIENCE|EXPERIENCE|EMPLOYMENT|WORK HISTORY)\s*</i;
  const headingMatch = headingRegex.exec(xml);
  if (!headingMatch) return null;
  // Walk forward to the `</w:p>` that closes the heading paragraph.
  const afterHeading = xml.indexOf('</w:p>', headingMatch.index);
  if (afterHeading < 0) return null;
  const sectionStart = afterHeading + '</w:p>'.length;

  // Section ends at the next major heading OR end of body.
  let sectionEnd = xml.length;
  for (const marker of SECTION_END_MARKERS) {
    const idx = xml.indexOf(marker, sectionStart);
    if (idx > 0 && idx < sectionEnd) sectionEnd = idx;
  }
  return { start: sectionStart, end: sectionEnd };
}

// ─── Position grouping ───────────────────────────────────────────────

export interface Position {
  /** Position header paragraph (role/company line). */
  header: Paragraph;
  /** All non-header paragraphs that belong to this position, in order. */
  bodyParas: Paragraph[];
  /** Subset of bodyParas that are actual bullets. */
  bullets: Paragraph[];
  /** Concatenated plain text of header + body. */
  combinedText: string;
  /** Tokenized set of combinedText (lowercased, stopword-filtered). */
  tokens: Set<string>;
}

function groupIntoPositions(paras: Paragraph[]): Position[] {
  const positions: Position[] = [];
  let current: Position | null = null;
  for (const p of paras) {
    if (p.isPositionHeader) {
      if (current) positions.push(finalizePosition(current));
      current = { header: p, bodyParas: [], bullets: [], combinedText: '', tokens: new Set() };
    } else if (current) {
      current.bodyParas.push(p);
      if (p.isBullet) current.bullets.push(p);
    }
    // paragraphs before the first header are skipped (shouldn't happen
    // in a typical resume but we tolerate it gracefully).
  }
  if (current) positions.push(finalizePosition(current));
  return positions;
}

function finalizePosition(p: Position): Position {
  const combined = [p.header.text, ...p.bodyParas.map((b) => b.text)]
    .filter(Boolean)
    .join(' ');
  p.combinedText = combined;
  p.tokens = tokenize(combined);
  return p;
}

// ─── Relevance scoring ───────────────────────────────────────────────

/**
 * Compute the token set of the JD's local context around every
 * occurrence of `keyword`. The "context" is a ±120-char window around
 * each hit, which on typical JDs corresponds to the sentence (or two)
 * that mentions the keyword.
 */
function keywordContextTokens(jdContent: string, keyword: string): Set<string> {
  if (!jdContent) return new Set();
  const ctx = new Set<string>();
  const lowerJd = jdContent.toLowerCase();
  for (const alias of keywordAliases(keyword)) {
    let idx = 0;
    while (true) {
      const hit = lowerJd.indexOf(alias, idx);
      if (hit < 0) break;
      const from = Math.max(0, hit - 120);
      const to = Math.min(lowerJd.length, hit + alias.length + 120);
      const windowTokens = tokenize(jdContent.substring(from, to));
      for (const t of windowTokens) ctx.add(t);
      idx = hit + alias.length;
    }
  }
  return ctx;
}

/**
 * Relevance of a missing keyword to a position. Returns 0 when the
 * keyword is already present in the position text (we don't re-inject
 * something the position already mentions) or when the JD context and
 * position share no signal.
 */
function scoreRelevance(
  position: Position,
  keyword: string,
  jdContent: string,
): { score: number; overlap: string[] } {
  // Skip keywords already present in the position's existing bullets.
  const posTextLower = position.combinedText.toLowerCase();
  for (const alias of keywordAliases(keyword)) {
    if (posTextLower.includes(alias)) return { score: 0, overlap: [] };
  }
  const ctxTokens = keywordContextTokens(jdContent, keyword);
  if (ctxTokens.size === 0) return { score: 0, overlap: [] };
  const overlap: string[] = [];
  for (const t of ctxTokens) {
    if (position.tokens.has(t)) overlap.push(t);
  }
  // Floor at 2 shared non-stopword tokens so we don't inject keywords
  // on the strength of a single weak match.
  if (overlap.length < 2) return { score: 0, overlap };
  return { score: overlap.length, overlap };
}

// ─── Injection planning ──────────────────────────────────────────────

export interface WorkExperienceBudget {
  /** Maximum number of positions we'll add a new bullet to. */
  maxPositions: number;
  /** Maximum missing keywords packed into each new bullet. */
  maxKeywordsPerBullet: number;
  /** Max keywords to inline-append onto existing bullets that have
   *  trailing whitespace room on their final rendered line. This is
   *  the cheapest way to add keywords (no new line at all), so we run
   *  it as a post-pass after new-bullet injection. Defaults to 0
   *  (disabled) to preserve legacy callers. */
  maxInlineAppends?: number;
}

interface PlannedInjection {
  position: Position;
  keywords: string[];
  bulletText: string;
}

/** Flat list of every (position, keyword, relevance) triple that
 *  scored above the relevance floor. Used to pick which positions get
 *  an injection and which keywords they receive. */
interface Pairing {
  positionIndex: number;
  keyword: string;
  category: string;
  score: number;
}

function planInjections(
  positions: Position[],
  missingByCategory: Record<string, string[]>,
  jdContent: string,
  budget: WorkExperienceBudget,
): PlannedInjection[] {
  if (positions.length === 0 || budget.maxPositions <= 0) return [];

  const pairings: Pairing[] = [];
  for (const [category, keywords] of Object.entries(missingByCategory)) {
    for (const kw of keywords) {
      for (let i = 0; i < positions.length; i++) {
        const { score } = scoreRelevance(positions[i], kw, jdContent);
        if (score > 0) pairings.push({ positionIndex: i, keyword: kw, category, score });
      }
    }
  }
  if (pairings.length === 0) return [];

  // Highest-scoring pairings first. When scores tie, prefer technical
  // keywords — they carry the most ATS weight.
  const categoryPriority: Record<string, number> = {
    technical: 0, management: 1, domain: 2, soft: 3,
  };
  pairings.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    const pa = categoryPriority[a.category] ?? 99;
    const pb = categoryPriority[b.category] ?? 99;
    if (pa !== pb) return pa - pb;
    return a.keyword.localeCompare(b.keyword);
  });

  // Greedy fill: walk pairings in priority order; assign each keyword
  // to its chosen position unless that position is full or we've
  // already used it for this keyword (dedup by (pos, kw)).
  const positionKeywords = new Map<number, { keyword: string; category: string }[]>();
  const usedKeywordsGlobally = new Set<string>();
  for (const p of pairings) {
    // Only allow each keyword to be injected under ONE position.
    if (usedKeywordsGlobally.has(p.keyword)) continue;
    const assigned = positionKeywords.get(p.positionIndex) ?? [];
    if (assigned.length >= budget.maxKeywordsPerBullet) continue;
    assigned.push({ keyword: p.keyword, category: p.category });
    positionKeywords.set(p.positionIndex, assigned);
    usedKeywordsGlobally.add(p.keyword);
  }

  // Keep only the top `maxPositions` positions by total assigned keywords.
  const rankedPositions = Array.from(positionKeywords.entries())
    .sort((a, b) => b[1].length - a[1].length)
    .slice(0, budget.maxPositions);

  const plans: PlannedInjection[] = [];
  for (const [posIndex, kws] of rankedPositions) {
    const keywords = kws.map((k) => k.keyword);
    const categories = kws.map((k) => k.category);
    const bulletText = buildWorkExperienceBullet(keywords, categories);
    if (!bulletText) continue;
    plans.push({ position: positions[posIndex], keywords, bulletText });
  }
  return plans;
}

// ─── XML injection ───────────────────────────────────────────────────

function xmlEscape(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Build a new `<w:p>` cloned from `template` but with its text
 * replaced by `newText`. Keeps `<w:pPr>` (which carries the bullet
 * `<w:numPr>` and spacing) and the first run's `<w:rPr>` (font,
 * size, color) so the new bullet visually matches its neighbors.
 */
function cloneBulletWithText(template: string, newText: string): string {
  // Preserve the outer `<w:p ...>` opening attributes EXCEPT the unique
  // w14:paraId / w14:textId — duplicating those confuses Word when the
  // file is reopened.
  const openMatch = template.match(/^<w:p(?:\s[^>]*)?>/);
  let pOpen = openMatch ? openMatch[0] : '<w:p>';
  pOpen = pOpen.replace(/\sw14:paraId="[^"]*"/g, '').replace(/\sw14:textId="[^"]*"/g, '');

  const pPrMatch = template.match(/<w:pPr>[\s\S]*?<\/w:pPr>/);
  const pPr = pPrMatch ? pPrMatch[0] : '';

  // Find the rPr of the FIRST text run (normal-weight run, not a
  // mid-sentence bold emphasis) so the whole new bullet reads in the
  // same body font. We look for the first `<w:r>` that owns a `<w:t>`.
  let rPr = '';
  const firstRunMatch = template.match(/<w:r\b[^>]*>\s*(?:<w:rPr>([\s\S]*?)<\/w:rPr>)?[\s\S]*?<w:t\b/);
  if (firstRunMatch && firstRunMatch[1]) rPr = `<w:rPr>${firstRunMatch[1]}</w:rPr>`;

  return `${pOpen}${pPr}<w:r>${rPr}<w:t xml:space="preserve">${xmlEscape(newText)}</w:t></w:r></w:p>`;
}

function insertNewBullets(xml: string, plans: PlannedInjection[]): string {
  // Insert from the BACK of the document forward. That way earlier
  // insertions don't shift the offsets of later ones.
  const sortedPlans = plans
    .map((p) => {
      // Anchor the insertion at the END of the position's last bullet
      // (or the last body paragraph if the position has no bullets).
      const anchorPara =
        p.position.bullets.length > 0
          ? p.position.bullets[p.position.bullets.length - 1]
          : p.position.bodyParas[p.position.bodyParas.length - 1];
      return { plan: p, insertAt: anchorPara.end, template: anchorPara.xml };
    })
    .sort((a, b) => b.insertAt - a.insertAt);

  let result = xml;
  for (const { plan, insertAt, template } of sortedPlans) {
    const newBulletXml = cloneBulletWithText(template, plan.bulletText);
    result = result.substring(0, insertAt) + newBulletXml + result.substring(insertAt);
  }
  return result;
}

// ─── Inline-append (fill trailing whitespace) ────────────────────────
//
// Some bullets render with their final text line ending well short of
// the right margin — visible whitespace the eye can see but the
// budget ladder can't "measure" because it only counts pages. When
// that's true, we can append a short keyword clause to the bullet's
// last text run without adding any new rendered line. This is the
// cheapest place to land a missing keyword (0 lines of cost), so we
// run it as a post-pass after new-bullet injection lands its picks.
//
// Estimation is deliberately coarse — we can't run Word's layout
// engine in Node. Empirically, body bullets at this template's font
// (Calibri 8pt / sz 16) wrap at ~170 chars per rendered line. If the
// remainder of (textLen % lineWidth) is under ~130 chars, the last
// line has room for a ~30-40 char keyword tail without pushing to a
// new line. We also require the bullet to mention a topically-related
// token so the append reads as connected prose, not a bolted-on tag.

const INLINE_LINE_WIDTH = 170;
const INLINE_MIN_TAIL_ROOM = 40; // chars free on last line to bother
const INLINE_MAX_TAIL_CHARS = 45; // longest clause we'll append

/** Does this bullet's last rendered line have room for ~`needed` chars? */
function bulletHasTailRoom(text: string, needed: number): boolean {
  if (text.length < 20) return false; // near-empty bullets don't look right padded
  const remainder = text.length % INLINE_LINE_WIDTH;
  const free = INLINE_LINE_WIDTH - remainder;
  return free >= needed + 5; // 5-char safety margin
}

/** Find the last `<w:t>…</w:t>` node in a bullet paragraph and append
 *  `clause` to its text. Returns the modified paragraph XML. */
function appendInlineToBullet(paraXml: string, clause: string): string {
  const lastTEnd = paraXml.lastIndexOf('</w:t>');
  if (lastTEnd < 0) return paraXml;
  const tContent = paraXml.substring(0, lastTEnd);
  const tOpenStart = tContent.lastIndexOf('<w:t');
  if (tOpenStart < 0) return paraXml;
  const tOpenEnd = paraXml.indexOf('>', tOpenStart) + 1;
  const existing = paraXml.substring(tOpenEnd, lastTEnd);
  // Don't stack appends on top of one another; if the last run already
  // ends mid-sentence with our marker, skip.
  const existingLower = existing.toLowerCase();
  const clauseCore = clause.replace(/^[\s;,.]+/, '').toLowerCase();
  if (existingLower.endsWith(clauseCore)) return paraXml;
  const newText = existing.replace(/\s+$/, '') + xmlEscape(clause);
  return paraXml.substring(0, tOpenEnd) + newText + paraXml.substring(lastTEnd);
}

function buildInlineClause(keywords: string[]): string {
  if (keywords.length === 0) return '';
  const display = keywords.map((k) =>
    k.split(/[-_]/).map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' '),
  );
  const list =
    display.length === 1
      ? display[0]
      : display.length === 2
      ? `${display[0]} and ${display[1]}`
      : display.slice(0, -1).join(', ') + ', and ' + display[display.length - 1];
  return `; leveraged ${list}.`;
}

/**
 * Plan + apply inline-appends after new-bullet injection.
 *
 * Strategy:
 *  1. Enumerate every (bullet, missing-keyword) pair and score
 *     relevance using the same ±120-char JD-context-token overlap the
 *     new-bullet planner uses. We only append keywords that share
 *     ≥2 non-stopword tokens with the bullet's existing text.
 *  2. For each bullet with room on its last rendered line, pick the
 *     highest-scoring eligible keyword (bounded by maxInlineAppends).
 *  3. Build a short clause ("; leveraged X.") and splice it onto the
 *     bullet's last `<w:t>` node. No new paragraphs, no new lines.
 *
 * Returns the modified XML, the keyword list used, and per-bullet
 * change log.
 */
function applyInlineAppends(
  xml: string,
  positions: Position[],
  missingByCategory: Record<string, string[]>,
  jdContent: string,
  budget: number,
  alreadyAddedKeywords: Set<string>,
  /** When true, drop the ≥2 overlap requirement to ≥1 (relaxed pass).
   *  Used as a fallback so user-selected keywords whose JD-context
   *  doesn't share ≥2 non-stopword tokens with any bullet still get a
   *  chance to land somewhere, instead of disappearing silently. */
  relaxed: boolean = false,
): { xml: string; added: string[]; changes: string[] } {
  if (budget <= 0) return { xml, added: [], changes: [] };

  // Flatten all still-unused keywords with their category.
  const candidates: { keyword: string; category: string }[] = [];
  for (const [category, kws] of Object.entries(missingByCategory)) {
    for (const kw of kws) {
      if (alreadyAddedKeywords.has(kw)) continue;
      candidates.push({ keyword: kw, category });
    }
  }
  if (candidates.length === 0) return { xml, added: [], changes: [] };

  // Score (bullet, keyword) pairs. A bullet "owns" a keyword if the
  // JD-context tokens around the keyword overlap the bullet's own
  // text tokens. Per-bullet scoring (not per-position) so we pin
  // each keyword to the most relevant individual bullet.
  interface Pair {
    posIdx: number;
    bulletIdx: number;
    bulletTokens: Set<string>;
    keyword: string;
    score: number;
  }
  const pairs: Pair[] = [];
  // The relaxed pass accepts a single-token overlap; the strict pass
  // (default) keeps the original ≥2 threshold so unrelated keywords
  // never get bolted onto well-targeted bullets.
  const minOverlap = relaxed ? 1 : 2;
  for (let pi = 0; pi < positions.length; pi++) {
    const pos = positions[pi];
    for (let bi = 0; bi < pos.bullets.length; bi++) {
      const b = pos.bullets[bi];
      const bTokens = tokenize(b.text);
      for (const { keyword } of candidates) {
        // Skip if already present in this bullet.
        const bLower = b.text.toLowerCase();
        let already = false;
        for (const alias of keywordAliases(keyword)) {
          if (bLower.includes(alias)) { already = true; break; }
        }
        if (already) continue;
        const ctx = keywordContextTokens(jdContent, keyword);
        if (ctx.size === 0) continue;
        let overlap = 0;
        for (const t of ctx) if (bTokens.has(t)) overlap++;
        if (overlap < minOverlap) continue;
        pairs.push({ posIdx: pi, bulletIdx: bi, bulletTokens: bTokens, keyword, score: overlap });
      }
    }
  }
  if (pairs.length === 0) return { xml, added: [], changes: [] };

  pairs.sort((a, b) => b.score - a.score || a.keyword.localeCompare(b.keyword));

  // Greedy allocation: each bullet can receive at most ONE inline
  // append (one clause), each keyword lands on at most ONE bullet.
  const bulletTaken = new Set<string>(); // `${posIdx}:${bulletIdx}`
  const kwTaken = new Set<string>();
  interface Assignment {
    posIdx: number;
    bulletIdx: number;
    keyword: string;
  }
  const assignments: Assignment[] = [];
  for (const p of pairs) {
    if (assignments.length >= budget) break;
    const bKey = `${p.posIdx}:${p.bulletIdx}`;
    if (bulletTaken.has(bKey)) continue;
    if (kwTaken.has(p.keyword)) continue;
    // Estimate whether the bullet's last line has room. Build the
    // clause now so we know exactly how many chars it adds.
    const clause = buildInlineClause([p.keyword]);
    if (clause.length > INLINE_MAX_TAIL_CHARS) continue;
    const bullet = positions[p.posIdx].bullets[p.bulletIdx];
    if (!bulletHasTailRoom(bullet.text, Math.max(clause.length, INLINE_MIN_TAIL_ROOM))) continue;
    assignments.push({ posIdx: p.posIdx, bulletIdx: p.bulletIdx, keyword: p.keyword });
    bulletTaken.add(bKey);
    kwTaken.add(p.keyword);
  }
  if (assignments.length === 0) return { xml, added: [], changes: [] };

  // Apply back-to-front so earlier edits don't invalidate later offsets.
  const sorted = [...assignments].sort((a, b) => {
    const ea = positions[b.posIdx].bullets[b.bulletIdx].end;
    const eb = positions[a.posIdx].bullets[a.bulletIdx].end;
    return ea - eb;
  });

  let result = xml;
  const added: string[] = [];
  const changes: string[] = [];
  for (const a of sorted) {
    const bullet = positions[a.posIdx].bullets[a.bulletIdx];
    const clause = buildInlineClause([a.keyword]);
    const freshParaXml = result.substring(bullet.start, bullet.end);
    const updated = appendInlineToBullet(freshParaXml, clause);
    if (updated === freshParaXml) continue;
    result = result.substring(0, bullet.start) + updated + result.substring(bullet.end);
    added.push(a.keyword);
    const role = positions[a.posIdx].header.text.split('\t')[0].trim().slice(0, 50);
    changes.push(`Inline-appended “${a.keyword}” to a bullet under “${role}”`);
  }
  return { xml: result, added, changes };
}

// ─── Public entry point ──────────────────────────────────────────────

export interface WorkExperienceInjectionResult {
  xml: string;
  /** Keywords that were successfully placed under a position. */
  addedKeywords: string[];
  /** Human-readable one-line-per-injection summary for UI/logs. */
  changesSummary: string[];
  /** Number of bullets we added. */
  bulletsAdded: number;
}

/**
 * Plan and perform work-experience injections on the docx XML. When
 * there is nothing relevant to inject, returns the input XML unchanged
 * with `bulletsAdded: 0`.
 */
export function injectIntoWorkExperience(
  xml: string,
  missingByCategory: Record<string, string[]>,
  jdContent: string,
  budget: WorkExperienceBudget,
): WorkExperienceInjectionResult {
  const empty: WorkExperienceInjectionResult = {
    xml, addedKeywords: [], changesSummary: [], bulletsAdded: 0,
  };
  const hasNewBulletBudget = budget.maxPositions > 0 && budget.maxKeywordsPerBullet > 0;
  const hasInlineBudget = (budget.maxInlineAppends ?? 0) > 0;
  if (!hasNewBulletBudget && !hasInlineBudget) return empty;
  if (!jdContent || jdContent.length < 50) return empty;

  const range = findWorkExperienceRange(xml);
  if (!range) return empty;

  const paras = parseParagraphs(xml, range.start, range.end);
  if (paras.length === 0) return empty;

  const positions = groupIntoPositions(paras);
  if (positions.length === 0) return empty;

  // Phase 1: new-bullet injection (only when that budget is non-zero).
  let workingXml = xml;
  const addedKeywords: string[] = [];
  const changesSummary: string[] = [];
  let bulletsAdded = 0;

  if (hasNewBulletBudget) {
    const plans = planInjections(positions, missingByCategory, jdContent, budget);
    if (plans.length > 0) {
      workingXml = insertNewBullets(workingXml, plans);
      for (const plan of plans) {
        addedKeywords.push(...plan.keywords);
        const roleLabel = plan.position.header.text.split('\t')[0].trim().slice(0, 50);
        changesSummary.push(
          `Added bullet under “${roleLabel}” with ${plan.keywords.length} keyword(s)`,
        );
      }
      bulletsAdded = plans.length;
    }
  }

  // Phase 2: inline-append pass. Runs whenever the caller set a
  // maxInlineAppends budget, including alongside Phase 1 — Phase 2
  // skips anything Phase 1 already placed. The positions array still
  // references offsets into the ORIGINAL xml, so we re-parse after
  // Phase 1 to pick up the new bullets' positions. This keeps the
  // bullet-room heuristic accurate (appending onto a freshly-inserted
  // short bullet is valid) and the offset arithmetic correct.
  if (hasInlineBudget) {
    let positionsForInline = positions;
    if (workingXml !== xml) {
      const range2 = findWorkExperienceRange(workingXml);
      if (range2) {
        const paras2 = parseParagraphs(workingXml, range2.start, range2.end);
        positionsForInline = groupIntoPositions(paras2);
      }
    }
    const already = new Set(addedKeywords);
    const inline = applyInlineAppends(
      workingXml,
      positionsForInline,
      missingByCategory,
      jdContent,
      budget.maxInlineAppends ?? 0,
      already,
    );
    if (inline.added.length > 0) {
      workingXml = inline.xml;
      for (const kw of inline.added) if (!addedKeywords.includes(kw)) addedKeywords.push(kw);
      changesSummary.push(...inline.changes);
    }

    // Phase 3: relaxed-overlap fallback for any user-selected keyword
    // that didn't land in Phases 1 or 2. The keywords that reach this
    // injector are already filtered to the user's selection upstream
    // (see /api/tailor-resume), so we treat each one as a "the user
    // wants this" signal — if at least ONE token of its JD context
    // overlaps a bullet, that's enough to place it. Strict relevance
    // remains the default (Phase 2); this is the safety net that
    // prevents user-selected keywords from disappearing silently.
    const remainingBudget =
      (budget.maxInlineAppends ?? 0) - (inline.added.length || 0);
    if (remainingBudget > 0) {
      // Re-parse so we see Phase 2's appended text in bullet token sets.
      let positionsForRelaxed = positionsForInline;
      if (workingXml !== xml && inline.added.length > 0) {
        const range3 = findWorkExperienceRange(workingXml);
        if (range3) {
          const paras3 = parseParagraphs(workingXml, range3.start, range3.end);
          positionsForRelaxed = groupIntoPositions(paras3);
        }
      }
      const placed = new Set(addedKeywords);
      const relaxed = applyInlineAppends(
        workingXml,
        positionsForRelaxed,
        missingByCategory,
        jdContent,
        remainingBudget,
        placed,
        true, // relaxed mode
      );
      if (relaxed.added.length > 0) {
        workingXml = relaxed.xml;
        for (const kw of relaxed.added) if (!addedKeywords.includes(kw)) addedKeywords.push(kw);
        changesSummary.push(...relaxed.changes);
      }
    }
  }

  return { xml: workingXml, addedKeywords, changesSummary, bulletsAdded };
}
