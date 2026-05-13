/**
 * Company-logo plumbing — turns a `companySlug` into a usable
 * favicon URL.
 *
 * Approach
 * ────────
 *  1. Map the slug to a domain (most slugs ARE the domain stem;
 *     overrides below cover the cases where they aren't).
 *  2. Hand the domain to Google's `s2/favicons` service which
 *     returns a real PNG of the company's favicon. No API key, no
 *     rate limits we hit at this scale, no need to store anything
 *     locally.
 *  3. The component layer falls back to a colored initial chip when
 *     the favicon fails to load.
 *
 * Why Google's service
 * ─────────────────────
 * It does the right "follow redirects → resolve favicon.ico vs
 * apple-touch-icon → cache" work for us. Self-hosting would mean
 * a per-domain HEAD + parse + cache pipeline; not worth it for a
 * cosmetic feature in a local-first app.
 */

/**
 * Slug → web domain. Add an entry only when the obvious
 * `<slug>.com` is wrong (different brand, .ai/.io TLD, etc.). The
 * default rule is good enough for ~85% of companies in our source
 * list, so the override list stays small and easy to maintain.
 */
const SLUG_DOMAIN_OVERRIDES: Record<string, string> = {
  // The slug doesn't match the stem
  'doordashusa': 'doordash.com',
  'walmartglobaltech': 'walmart.com',
  'unity3d': 'unity.com',
  'pitchbookdata': 'pitchbook.com',
  'aws': 'aws.amazon.com',
  // .ai / .io / non-.com TLDs
  'scaleai': 'scale.com',
  'mistral': 'mistral.ai',
  'cohere': 'cohere.com',
  'perplexity': 'perplexity.ai',
  'elevenlabs': 'elevenlabs.io',
  'deepgram': 'deepgram.com',
  'supabase': 'supabase.com',
  'block': 'block.xyz',
  'linear': 'linear.app',
  'vercel': 'vercel.com',
  'notion': 'notion.so',
  'figma': 'figma.com',
  // Disambiguation (common-word slugs that resolve to a different brand)
  'compass': 'compass.com',
  'mercury': 'mercury.com',
  'ramp': 'ramp.com',
  'valon': 'valon.com',
  'circle': 'circle.com',
  'unity': 'unity.com',
  // Multi-word lowercased slugs that look weird as `.com`
  'github': 'github.com',
  'gitlab': 'gitlab.com',
  'planetscale': 'planetscale.com',
};

export function getCompanyDomain(companySlug: string): string {
  const normalized = companySlug.toLowerCase().trim();
  return SLUG_DOMAIN_OVERRIDES[normalized] ?? `${normalized}.com`;
}

/**
 * 64px favicon URL for the company. Used by the <CompanyLogo>
 * component; safe to call repeatedly with the same slug — the
 * component layer handles caching via the browser's image cache.
 */
export function getCompanyLogoUrl(companySlug: string): string {
  const domain = getCompanyDomain(companySlug);
  return `https://www.google.com/s2/favicons?domain=${domain}&sz=64`;
}
