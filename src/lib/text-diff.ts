/**
 * Lightweight line-level resume diff.
 *
 * The tailor pipeline only ADDS content (new Skills keywords,
 * new Summary phrases, new Work Experience bullets, inline appends
 * to existing bullets). Nothing is removed. So a full LCS diff is
 * overkill — we just need to surface which lines in the tailored
 * version are new or modified vs the base.
 *
 * Strategy
 *   1. Split both texts into normalized lines (trimmed, whitespace-
 *      collapsed). Empty lines are dropped — the docx editor
 *      sometimes adds/removes them inconsistently.
 *   2. For each line in the tailored text, label it as:
 *        - 'unchanged' if a verbatim match exists in the base set
 *        - 'modified' if a 70%+ token-overlap match exists (catches
 *           inline-keyword-appends to existing bullets, where a
 *           bullet got 2-3 keywords tacked on but is otherwise the
 *           same prose)
 *        - 'added' otherwise
 *   3. Return the labeled tailored lines + counts.
 *
 * The base lines that don't appear in tailored are reported as
 * 'removed' for completeness, but in practice this set is empty
 * since the pipeline doesn't delete anything. We surface the count
 * anyway as a UX safety signal.
 */

export type DiffKind = 'added' | 'modified' | 'unchanged' | 'removed';

export interface DiffLine {
  kind: DiffKind;
  text: string;
  /** When `kind` === 'modified', the closest matching line from the
   *  base. Used to show side-by-side what changed in that bullet. */
  basedOn?: string;
}

export interface DiffResult {
  /** Tailored lines in order, each labeled with how it relates to
   *  the base. */
  lines: DiffLine[];
  /** Base lines NOT found in tailored — typically empty. */
  removed: string[];
  /** Counts for the summary header. */
  counts: { added: number; modified: number; unchanged: number; removed: number };
}

/** Split into lines, trim, collapse whitespace, drop empties. */
function normalize(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim().replace(/\s+/g, ' '))
    .filter((l) => l.length > 0);
}

/** Cheap token-set overlap. Used to decide whether two lines are
 *  "approximately the same" — catches the inline-keyword-append
 *  case (same bullet + a few new keywords tacked on the end). */
function similarity(a: string, b: string): number {
  const ta = new Set(a.toLowerCase().split(/\s+/).filter((w) => w.length >= 3));
  const tb = new Set(b.toLowerCase().split(/\s+/).filter((w) => w.length >= 3));
  if (ta.size === 0 || tb.size === 0) return 0;
  let common = 0;
  for (const w of ta) if (tb.has(w)) common += 1;
  return common / Math.max(ta.size, tb.size);
}

export function diffResume(base: string, tailored: string): DiffResult {
  const baseLines = normalize(base);
  const tailoredLines = normalize(tailored);

  // O(1) lookup for verbatim matches.
  const baseSet = new Set(baseLines);

  // We use `consumed` to flag base lines we've already paired with a
  // 'modified' tailored line, so we don't double-count.
  const consumed = new Set<number>();

  const labeled: DiffLine[] = tailoredLines.map((line) => {
    if (baseSet.has(line)) return { kind: 'unchanged', text: line };
    // Approximate match — scan all unconsumed base lines for one
    // with 70%+ token overlap. The first hit wins; in practice
    // there's at most one similar bullet per tailored bullet.
    for (let i = 0; i < baseLines.length; i++) {
      if (consumed.has(i)) continue;
      if (similarity(line, baseLines[i]) >= 0.7) {
        consumed.add(i);
        return { kind: 'modified', text: line, basedOn: baseLines[i] };
      }
    }
    return { kind: 'added', text: line };
  });

  // Anything in base that didn't get matched is "removed" (rare).
  const tailoredSet = new Set(tailoredLines);
  const removed: string[] = [];
  for (let i = 0; i < baseLines.length; i++) {
    if (consumed.has(i)) continue;
    if (!tailoredSet.has(baseLines[i])) removed.push(baseLines[i]);
  }

  const counts = {
    added: labeled.filter((l) => l.kind === 'added').length,
    modified: labeled.filter((l) => l.kind === 'modified').length,
    unchanged: labeled.filter((l) => l.kind === 'unchanged').length,
    removed: removed.length,
  };

  return { lines: labeled, removed, counts };
}
