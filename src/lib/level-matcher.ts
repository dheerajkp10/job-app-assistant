/**
 * Infer which LEVEL_TIERS (see src/lib/types.ts) a job title corresponds
 * to. Returns the set of tier keys that plausibly match — a single title
 * may map to several (e.g. "Senior Engineering Manager" → both `senior`
 * and `em2`).
 *
 * Used by the listings page to filter by the user's preferredLevels.
 */

export function inferLevelTiers(title: string): Set<string> {
  const t = title.toLowerCase();
  const tiers = new Set<string>();

  // --- VP / GM ---
  if (/\bvp\b|vice\s+president|general\s+manager\b/.test(t)) tiers.add('vp');

  // --- Director ladder ---
  if (/\b(sr\.?|senior)\s+director\b/.test(t)) tiers.add('sr-director');
  else if (/\bdirector\b/.test(t)) tiers.add('director');

  // --- Manager ladder ---
  if (/\b(sr\.?|senior)\s+(engineering\s+)?manager\b|\bem2\b|\bm2\b/.test(t)) {
    tiers.add('em2');
  } else if (
    /\bmanager\b|\bem1\b|\bm1\b|software\s+development\s+manager|engineering\s+manager|software\s+engineering\s+manager|eng\s+manager/.test(
      t,
    )
  ) {
    tiers.add('em1');
  }

  // --- IC ladder ---
  if (/\bdistinguished\b|\b(sr\.?|senior)\s+principal\b|\bl8\b|\bl9\b/.test(t)) {
    tiers.add('distinguished');
  }
  if (/\bstaff\b|\bprincipal\b|\bl6\b|\bl7\b|\be6\b|\be7\b/.test(t)) {
    tiers.add('staff');
  }
  if (/\b(sr\.?|senior)\b|\bl5\b|\be5\b/.test(t)) {
    tiers.add('senior');
  }
  if (/\b(ii|2)\b|\bsde\s*2\b|\bl4\b|\be4\b|engineer\s+ii|developer\s+ii|mid[-\s]level/.test(t)) {
    tiers.add('mid');
  }
  if (
    /\b(i|1)\b|\bsde\s*1\b|\bl3\b|\be3\b|entry[-\s]level|new\s+grad|\bassociate\b|\bjunior\b|\bjr\.?\b/.test(
      t,
    )
  ) {
    tiers.add('entry');
  }

  return tiers;
}

/**
 * True when the listing's title matches any of the user's selected level tiers.
 * If no levels are selected, returns true (no filtering).
 *
 * When a title is too ambiguous to infer any tier, we INCLUDE the listing
 * (better to over-show than to drop potentially relevant roles).
 */
export function matchesLevelPreference(title: string, preferredLevels: string[]): boolean {
  if (!preferredLevels || preferredLevels.length === 0) return true;
  const inferred = inferLevelTiers(title);
  if (inferred.size === 0) return true; // ambiguous → include
  return preferredLevels.some((l) => inferred.has(l));
}
