/**
 * Salary-information extractor for job description text.
 *
 * Strategy
 * ────────
 * Local-only — no external API, no scraping a third-party site. We
 * read whatever the company posted in the JD body and parse it into
 * structured fields. Pay-transparency laws in WA / CA / CO / NY /
 * MA / IL / etc. mean most US tech listings now carry an explicit
 * salary range in the body, so this catches the bulk of what users
 * see day-to-day.
 *
 * Output shape stays back-compat with all existing callers
 * (fetchers, salary-intelligence, UI): the legacy `min` / `max` /
 * `display` fields are always populated when ANY salary signal is
 * found. The new optional fields (`baseMin/Max`, `tcMin/Max`,
 * `equityHint`, `source`) carry extra structure when the JD makes
 * the distinction explicit, so callers can render "base $X – $Y
 * + TC $A – $B" without a second extraction pass.
 *
 * Detection layers (most specific first):
 *   1. Explicit base + TC split:   "Base salary: $X – $Y.
 *                                   Total compensation: $A – $B."
 *   2. OTE annotation:             "$X – $Y OTE" (sales TC)
 *   3. Plain annual range:         "$X – $Y" with k/K, USD, comma
 *                                   variants
 *   4. Single annual amount near salary keyword
 *   5. Hourly normalized to annual: "$X/hr"  → x * 2080
 *
 * Floor: any extracted annual amount < $30k is rejected (too low to
 * be a real US tech salary; almost always a misparse of stipend /
 * sign-on / monthly figure).
 */

export interface SalaryInfo {
  /** Canonical display string. Prefers base when both base + TC
   *  are detected; otherwise whatever range we found. */
  display: string;
  /** Min/max — the "main" salary signal, base-preferred. Stays
   *  here for back-compat with every existing caller. */
  min: number | null;
  max: number | null;
  /** Explicit base-salary band when separable from TC. */
  baseMin?: number | null;
  baseMax?: number | null;
  /** Explicit total-compensation band when separable from base. */
  tcMin?: number | null;
  tcMax?: number | null;
  /** Mentions of stock / equity / RSU values found nearby. Just
   *  a free-form snippet — not parsed into a number — because
   *  postings vary too much ("$200k equity grant", "stock options
   *  vesting 4 years", "RSU refresh annually"). */
  equityHint?: string;
  /** Which detection layer fired — useful for debugging and for
   *  surfacing a "source" badge in the UI. */
  source?: 'base-and-tc' | 'ote' | 'range' | 'context-amount' | 'k-range' | 'context-k' | 'hourly';
}

// ─── Public API ─────────────────────────────────────────────────────

export function extractSalary(text: string): SalaryInfo | null {
  if (!text) return null;
  // Strip HTML and collapse whitespace once up-front so every
  // sub-extractor sees the same normalized stream.
  const clean = text.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();

  // Layer 1 — explicit base + TC split. When the JD names both
  // separately we want to keep them separate downstream rather than
  // collapsing to one band.
  const split = extractBaseAndTc(clean);
  if (split) return split;

  // Layer 2 — OTE flag. Used in sales roles. Reads as TC by
  // convention since the "on-target" number includes commission.
  const ote = extractOte(clean);
  if (ote) return ote;

  // Layer 3 — plain ranges (the bulk case).
  const range = extractRange(clean);
  if (range) return decorateEquity(range, clean);

  // Layer 4 — single amount near a salary keyword.
  const singleAmount = extractSingleAmount(clean);
  if (singleAmount) return decorateEquity(singleAmount, clean);

  // Layer 5 — k/K-suffixed range without dollar sign.
  const kRange = extractKRange(clean);
  if (kRange) return decorateEquity(kRange, clean);

  // Layer 6 — hourly-rate normalized to annual.
  const hourly = extractHourly(clean);
  if (hourly) return hourly;

  return null;
}

// ─── Layer implementations ──────────────────────────────────────────

/** "Base salary range: $X – $Y. Total compensation: $A – $B." */
function extractBaseAndTc(text: string): SalaryInfo | null {
  // Look for both signals within the same paragraph so we don't
  // confuse one role's base with another role's TC.
  const baseRe = /\b(?:base\s+(?:salary|pay|compensation)|annual\s+base)\b[^$0-9k]{0,60}(\$?\s*[\d,]+(?:\.\d+)?\s*[kK]?\s*(?:[-–—]|to)\s*\$?\s*[\d,]+(?:\.\d+)?\s*[kK]?)/i;
  const tcRe = /\b(?:total\s+(?:compensation|comp)|total\s+target\s+compensation|all[\s-]in|target\s+earnings|ote)\b[^$0-9k]{0,60}(\$?\s*[\d,]+(?:\.\d+)?\s*[kK]?\s*(?:[-–—]|to)\s*\$?\s*[\d,]+(?:\.\d+)?\s*[kK]?)/i;

  const base = text.match(baseRe);
  const tc = text.match(tcRe);
  if (!base && !tc) return null;
  if (!base || !tc) return null;       // need both for this layer

  const baseRange = parseRange(base[1]);
  const tcRange = parseRange(tc[1]);
  if (!baseRange || !tcRange) return null;
  if (!isPlausibleAnnual(baseRange.min) && !isPlausibleAnnual(baseRange.max)) return null;
  if (!isPlausibleAnnual(tcRange.min) && !isPlausibleAnnual(tcRange.max)) return null;

  return {
    display: `Base $${formatK(baseRange.min)}–$${formatK(baseRange.max)} · TC $${formatK(tcRange.min)}–$${formatK(tcRange.max)}`,
    min: baseRange.min,
    max: baseRange.max,
    baseMin: baseRange.min,
    baseMax: baseRange.max,
    tcMin: tcRange.min,
    tcMax: tcRange.max,
    equityHint: detectEquityHint(text),
    source: 'base-and-tc',
  };
}

/** "$X – $Y OTE" — sales roles. We treat OTE as total comp. */
function extractOte(text: string): SalaryInfo | null {
  // Two orderings: "$X – $Y OTE" and "OTE: $X – $Y"
  const m = text.match(
    /(\$?\s*[\d,]+(?:\.\d+)?\s*[kK]?\s*(?:[-–—]|to)\s*\$?\s*[\d,]+(?:\.\d+)?\s*[kK]?)\s*(?:OTE|on[\s-]target\s+earnings)/i,
  ) || text.match(
    /(?:OTE|on[\s-]target\s+earnings)[^$0-9k]{0,40}(\$?\s*[\d,]+(?:\.\d+)?\s*[kK]?\s*(?:[-–—]|to)\s*\$?\s*[\d,]+(?:\.\d+)?\s*[kK]?)/i,
  );
  if (!m) return null;
  const r = parseRange(m[1]);
  if (!r || (!isPlausibleAnnual(r.min) && !isPlausibleAnnual(r.max))) return null;
  return {
    display: `$${formatK(r.min)}–$${formatK(r.max)} OTE`,
    min: r.min,
    max: r.max,
    tcMin: r.min,
    tcMax: r.max,
    source: 'ote',
  };
}

/** "$X – $Y" with k / K / USD / comma variants. The main case. */
function extractRange(text: string): SalaryInfo | null {
  // Allow optional USD prefix; spaces; en/em dash or hyphen or "to";
  // optional K suffix; optional decimals; optional thousands commas.
  const re = /(?:USD\s*)?\$\s*([\d,]+(?:\.\d+)?)\s*([kK])?\s*(?:[-–—]|to)\s*(?:USD\s*)?\$?\s*([\d,]+(?:\.\d+)?)\s*([kK])?/;
  const m = text.match(re);
  if (!m) return null;
  const min = applyK(parseAmount(m[1]), !!m[2]);
  const max = applyK(parseAmount(m[3]), !!m[4]);
  if (!isPlausibleAnnual(min) && !isPlausibleAnnual(max)) return null;
  return {
    display: `$${formatK(min)}–$${formatK(max)}`,
    min, max,
    source: 'range',
  };
}

/** Single dollar amount appearing near a salary keyword. */
function extractSingleAmount(text: string): SalaryInfo | null {
  const m = text.match(
    /(?:salary|compensation|pay|base|annual|target)[^$]{0,40}\$\s*([\d,]+(?:\.\d+)?)\s*([kK])?/i,
  );
  if (!m) return null;
  const amount = applyK(parseAmount(m[1]), !!m[2]);
  if (!isPlausibleAnnual(amount)) return null;
  return {
    display: `$${formatK(amount)}`,
    min: amount,
    max: amount,
    source: 'context-amount',
  };
}

/** "300k – 450k" without a leading $ sign. */
function extractKRange(text: string): SalaryInfo | null {
  // Be strict: require both numbers to carry k/K, otherwise we'll
  // grab generic numeric ranges (e.g. years, headcount).
  const m = text.match(/\b(\d{2,4})\s*[kK]\s*(?:[-–—]|to)\s*(\d{2,4})\s*[kK]\b/);
  if (!m) return null;
  const min = parseInt(m[1], 10) * 1000;
  const max = parseInt(m[2], 10) * 1000;
  if (!isPlausibleAnnual(min) && !isPlausibleAnnual(max)) return null;
  return {
    display: `$${formatK(min)}–$${formatK(max)}`,
    min, max,
    source: 'k-range',
  };
}

/** "$X / hour" or "$X-$Y per hour" — normalize to annual via 2080. */
function extractHourly(text: string): SalaryInfo | null {
  const range = text.match(
    /\$\s*([\d.]+)\s*(?:[-–—]|to)\s*\$?\s*([\d.]+)\s*(?:per\s+hour|\/\s*hr|hourly)/i,
  );
  if (range) {
    const min = Math.round(parseFloat(range[1]) * 2080);
    const max = Math.round(parseFloat(range[2]) * 2080);
    if (isPlausibleAnnual(min) || isPlausibleAnnual(max)) {
      return {
        display: `$${formatK(min)}–$${formatK(max)} (annualized from $${range[1]}–$${range[2]}/hr)`,
        min, max,
        source: 'hourly',
      };
    }
  }
  const single = text.match(/\$\s*([\d.]+)\s*(?:per\s+hour|\/\s*hr|hourly)/i);
  if (single) {
    const amount = Math.round(parseFloat(single[1]) * 2080);
    if (isPlausibleAnnual(amount)) {
      return {
        display: `$${formatK(amount)} (annualized from $${single[1]}/hr)`,
        min: amount,
        max: amount,
        source: 'hourly',
      };
    }
  }
  return null;
}

// ─── Helpers ────────────────────────────────────────────────────────

/** Parse a "$X – $Y" / "X K to Y K" fragment into {min,max}. */
function parseRange(fragment: string): { min: number; max: number } | null {
  const m = fragment.match(/\$?\s*([\d,]+(?:\.\d+)?)\s*([kK])?\s*(?:[-–—]|to)\s*\$?\s*([\d,]+(?:\.\d+)?)\s*([kK])?/);
  if (!m) return null;
  const min = applyK(parseAmount(m[1]), !!m[2]);
  const max = applyK(parseAmount(m[3]), !!m[4]);
  return { min, max };
}

function parseAmount(str: string): number {
  return parseInt(str.replace(/[,.\s]/g, ''), 10);
}

/** Multiply by 1000 if k/K suffix present AND the raw value is small
 *  enough that the multiplication is plausibly correct (< 1000 means
 *  "300k" → 300000; ≥ 1000 means the value already includes thousands
 *  digits so we leave it alone). */
function applyK(amount: number, hasK: boolean): number {
  if (hasK && amount < 1000) return amount * 1000;
  return amount;
}

/** Plausibility floor: > $30k annual. Filters out stipends / sign-on
 *  bonuses / monthly figures misparsed as annual. */
function isPlausibleAnnual(amount: number): boolean {
  return amount >= 30000 && amount <= 2_000_000;
}

/** "$300,000" → "300k", "$1,250,000" → "1.25M". Used for the
 *  canonical display string. */
function formatK(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2).replace(/\.?0+$/, '')}M`;
  if (n >= 1_000) return `${Math.round(n / 1000)}k`;
  return n.toLocaleString('en-US');
}

/** Skim the document for an equity hint — phrase + nearby dollar
 *  value if one is in the same sentence. Best-effort. */
function detectEquityHint(text: string): string | undefined {
  const m = text.match(
    /(equity|stock\s+options?|RSUs?|stock\s+grant|sign[\s-]on\s+bonus|annual\s+refresh)\b[^.!?]{0,80}/i,
  );
  return m ? m[0].trim() : undefined;
}

/** If a range/context-amount extraction succeeded, see if the same
 *  paragraph also mentions equity — attach as a hint without
 *  affecting the numeric output. */
function decorateEquity(info: SalaryInfo, text: string): SalaryInfo {
  const eq = detectEquityHint(text);
  if (eq) info.equityHint = eq;
  return info;
}
