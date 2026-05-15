import type { CompanySource } from './types';

/**
 * Company career page sources.
 *
 * Public ATSs (we just need the board token):
 *   Greenhouse: https://boards-api.greenhouse.io/v1/boards/{boardToken}/jobs
 *   Lever:      https://api.lever.co/v0/postings/{boardToken}?mode=json
 *   Ashby:      https://api.ashbyhq.com/posting-api/job-board/{boardToken}
 *
 * Custom APIs (each company has its own endpoint — see
 * src/lib/custom-fetchers.ts):
 *   google | apple | microsoft | amazon | meta | uber | workday
 *
 * For `workday`, `boardToken` is the tenant name (first path segment in
 * the URL) and `workdayHost` + `workdaySite` locate the careers site,
 * e.g. https://{workdayHost}/{workdaySite} for apply links and
 * https://{workdayHost}/wday/cxs/{boardToken}/{workdaySite}/jobs for
 * the API.
 */
export const COMPANY_SOURCES: CompanySource[] = [
  // ─── Greenhouse ───
  { name: 'Stripe', slug: 'stripe', ats: 'greenhouse', boardToken: 'stripe', logoColor: '#635BFF' },
  { name: 'Airbnb', slug: 'airbnb', ats: 'greenhouse', boardToken: 'airbnb', logoColor: '#FF5A5F' },
  { name: 'DoorDash', slug: 'doordash', ats: 'greenhouse', boardToken: 'doordashusa', logoColor: '#FF3008' },
  { name: 'Databricks', slug: 'databricks', ats: 'greenhouse', boardToken: 'databricks', logoColor: '#FF3621' },
  { name: 'Robinhood', slug: 'robinhood', ats: 'greenhouse', boardToken: 'robinhood', logoColor: '#00C805' },
  // Coinbase migrated off Greenhouse (the public Greenhouse board now
  // returns 404). Their careers site is server-rendered with no clean
  // public ATS endpoint we can fetch. Users who want Coinbase roles
  // can re-add it via custom sources once a viable token surfaces.
  { name: 'Discord', slug: 'discord', ats: 'greenhouse', boardToken: 'discord', logoColor: '#5865F2' },
  { name: 'Reddit', slug: 'reddit', ats: 'greenhouse', boardToken: 'reddit', logoColor: '#FF4500' },
  { name: 'Pinterest', slug: 'pinterest', ats: 'greenhouse', boardToken: 'pinterest', logoColor: '#E60023' },
  { name: 'Figma', slug: 'figma', ats: 'greenhouse', boardToken: 'figma', logoColor: '#F24E1E' },
  { name: 'Brex', slug: 'brex', ats: 'greenhouse', boardToken: 'brex', logoColor: '#FF5722' },
  { name: 'Scale AI', slug: 'scaleai', ats: 'greenhouse', boardToken: 'scaleai', logoColor: '#6F3AF7' },
  { name: 'Anthropic', slug: 'anthropic', ats: 'greenhouse', boardToken: 'anthropic', logoColor: '#D97757' },
  { name: 'Cloudflare', slug: 'cloudflare', ats: 'greenhouse', boardToken: 'cloudflare', logoColor: '#F48120' },
  { name: 'Datadog', slug: 'datadog', ats: 'greenhouse', boardToken: 'datadog', logoColor: '#632CA6' },
  { name: 'Twilio', slug: 'twilio', ats: 'greenhouse', boardToken: 'twilio', logoColor: '#F22F46' },
  // HashiCorp acquired by IBM in 2025; jobs are migrating to IBM
  // careers infra. Removing from the static list — users tracking
  // HashiCorp roles can re-add via Settings → Custom Sources once
  // the new ATS is known.
  { name: 'Instacart', slug: 'instacart', ats: 'greenhouse', boardToken: 'instacart', logoColor: '#43B02A' },
  { name: 'Lyft', slug: 'lyft', ats: 'greenhouse', boardToken: 'lyft', logoColor: '#FF00BF' },
  { name: 'Block', slug: 'block', ats: 'greenhouse', boardToken: 'block', logoColor: '#00D632' },
  // Snowflake moved off Greenhouse to Ashby (verified May 2026 — 419 open).
  { name: 'Snowflake', slug: 'snowflake', ats: 'ashby', boardToken: 'snowflake', logoColor: '#29B5E8' },
  { name: 'Qualtrics', slug: 'qualtrics', ats: 'greenhouse', boardToken: 'qualtrics', logoColor: '#1B2B4B', region: 'Seattle' },
  { name: 'Dropbox', slug: 'dropbox', ats: 'greenhouse', boardToken: 'dropbox', logoColor: '#0061FF' },
  { name: 'Roblox', slug: 'roblox', ats: 'greenhouse', boardToken: 'roblox', logoColor: '#E2231A' },
  // Redfin → Workday (verified — Redfin_Careers tenant).
  // Workday entries are kept inline with the rest of the static list
  // for diffability; the field shape mirrors the Workday block below.
  // Remitly removed (no public ATS endpoint as of 2026).
  // Nutanix → Ashby (verified, ~2 jobs).
  // Apptio acquired by IBM in 2023 — removed.
  // Atlassian's careers site has no public ATS endpoint we could
  // probe; smart-recruiters/atlassian returns 200 with 0 jobs (not
  // theirs). Removed.
  // ServiceNow → SmartRecruiters (verified, ~543 jobs).
  // Zillow → Workday (verified — Zillow_Group_External, ~197 jobs).
  // Walmart → Workday (verified — WalmartExternal, ~2000 jobs).
  // Compass — no public API; removed.
  // Nutanix migrated off Ashby (their old job-board token now 404s on
  // api.ashbyhq.com). Nutanix Careers currently runs on Workday but the
  // public tenant + site segments aren't easy to enumerate from the
  // careers UI. Users wanting Nutanix can re-add via custom sources
  // once the Workday host is known.
  { name: 'Smartsheet', slug: 'smartsheet', ats: 'greenhouse', boardToken: 'smartsheet', logoColor: '#1F6BFF', region: 'Seattle' },
  { name: 'Asana', slug: 'asana', ats: 'greenhouse', boardToken: 'asana', logoColor: '#F06A6A' },
  // GitHub now lives at github.careers (Microsoft careers infra) —
  // no public Greenhouse board. Removed.
  // Shopify uses shopify.com/careers (proprietary, no public API). Removed.
  // Square is the same listing set as Block (already covered) —
  // duplicate removed.
  // Confluent → Ashby (verified, ~53 jobs).
  { name: 'Confluent', slug: 'confluent', ats: 'ashby', boardToken: 'confluent', logoColor: '#38A1DB' },
  { name: 'MongoDB', slug: 'mongodb', ats: 'greenhouse', boardToken: 'mongodb', logoColor: '#47A248' },
  { name: 'Elastic', slug: 'elastic', ats: 'greenhouse', boardToken: 'elastic', logoColor: '#005571' },
  { name: 'GitLab', slug: 'gitlab', ats: 'greenhouse', boardToken: 'gitlab', logoColor: '#FC6D26' },
  { name: 'Affirm', slug: 'affirm', ats: 'greenhouse', boardToken: 'affirm', logoColor: '#0FA0EA' },
  { name: 'Chime', slug: 'chime', ats: 'greenhouse', boardToken: 'chime', logoColor: '#1EC677' },
  // Rippling — no public ATS endpoint as of 2026. Removed.
  // ─── Greenhouse (added per user request — verified non-empty boards) ───
  { name: 'Nextdoor', slug: 'nextdoor', ats: 'greenhouse', boardToken: 'nextdoor', logoColor: '#7ED957' },
  { name: 'SoFi', slug: 'sofi', ats: 'greenhouse', boardToken: 'sofi', logoColor: '#00A0DC' },
  { name: 'Unity', slug: 'unity', ats: 'greenhouse', boardToken: 'unity3d', logoColor: '#000000' },
  { name: 'PitchBook', slug: 'pitchbook', ats: 'greenhouse', boardToken: 'pitchbookdata', logoColor: '#FF6900', region: 'Seattle' },
  { name: 'Netlify', slug: 'netlify', ats: 'greenhouse', boardToken: 'netlify', logoColor: '#00C7B7' },
  { name: 'PlanetScale', slug: 'planetscale', ats: 'greenhouse', boardToken: 'planetscale', logoColor: '#000000' },
  { name: 'Checkr', slug: 'checkr', ats: 'greenhouse', boardToken: 'checkr', logoColor: '#1E6BFF' },

  // ─── Lever ───
  { name: 'Highspot', slug: 'highspot', ats: 'lever', boardToken: 'highspot', logoColor: '#3361FF', region: 'Seattle' },
  { name: 'Plaid', slug: 'plaid', ats: 'lever', boardToken: 'plaid', logoColor: '#000000' },
  { name: 'Palantir', slug: 'palantir', ats: 'lever', boardToken: 'palantir', logoColor: '#000000' },
  // Docker moved off Lever to Ashby (verified, ~43 jobs).
  { name: 'Docker', slug: 'docker', ats: 'ashby', boardToken: 'docker', logoColor: '#2496ED' },

  // ─── Ashby ───
  { name: 'OpenAI', slug: 'openai', ats: 'ashby', boardToken: 'openai', logoColor: '#10A37F' },
  { name: 'Notion', slug: 'notion', ats: 'ashby', boardToken: 'notion', logoColor: '#000000' },
  { name: 'Ramp', slug: 'ramp', ats: 'ashby', boardToken: 'ramp', logoColor: '#F2E307' },
  { name: 'Linear', slug: 'linear', ats: 'ashby', boardToken: 'linear', logoColor: '#5E6AD2' },
  { name: 'Vercel', slug: 'vercel', ats: 'ashby', boardToken: 'vercel', logoColor: '#000000' },
  { name: 'Mercury', slug: 'mercury', ats: 'ashby', boardToken: 'mercury', logoColor: '#5B67BB' },
  // ─── Ashby (added per user request — verified non-empty boards) ───
  { name: 'Deepgram', slug: 'deepgram', ats: 'ashby', boardToken: 'deepgram', logoColor: '#13EF93' },
  { name: 'Valon', slug: 'valon', ats: 'ashby', boardToken: 'valon', logoColor: '#0066FF' },
  { name: 'Ashby', slug: 'ashby', ats: 'ashby', boardToken: 'ashby', logoColor: '#000000' },
  // ─── Ashby (popular AI / dev-tools companies) ───
  { name: 'Cohere', slug: 'cohere', ats: 'ashby', boardToken: 'cohere', logoColor: '#39594D' },
  { name: 'Mistral AI', slug: 'mistral', ats: 'ashby', boardToken: 'mistral', logoColor: '#FF7000' },
  { name: 'Perplexity', slug: 'perplexity', ats: 'ashby', boardToken: 'perplexity', logoColor: '#1FB8CD' },
  { name: 'ElevenLabs', slug: 'elevenlabs', ats: 'ashby', boardToken: 'elevenlabs', logoColor: '#000000' },
  { name: 'Supabase', slug: 'supabase', ats: 'ashby', boardToken: 'supabase', logoColor: '#3ECF8E' },
  { name: 'Deel', slug: 'deel', ats: 'ashby', boardToken: 'deel', logoColor: '#15CC81' },

  // ─── Custom per-company APIs (tech giants that don't use public ATSs) ───
  { name: 'Google', slug: 'google', ats: 'google', boardToken: 'google', logoColor: '#4285F4' },
  { name: 'Apple', slug: 'apple', ats: 'apple', boardToken: 'apple', logoColor: '#000000' },
  // Microsoft retired the public gcsservices.careers.microsoft.com
  // endpoint (cert mismatch + 403). Their new careers UI at
  // apply.careers.microsoft.com is on Eightfold but every API call
  // returns 403 "Not authorized for PCSX" without server-side auth,
  // and the SSR shell embeds no jobs payload. Removed from the
  // static list pending a custom-fetcher (probably Puppeteer-driven
  // search-page scrape, like Apple/Meta).
  { name: 'Amazon', slug: 'amazon', ats: 'amazon', boardToken: 'amazon', logoColor: '#FF9900', region: 'Seattle' },
  { name: 'AWS', slug: 'aws', ats: 'amazon', boardToken: 'aws', logoColor: '#232F3E', region: 'Seattle' },
  { name: 'Meta', slug: 'meta', ats: 'meta', boardToken: 'meta', logoColor: '#1877F2' },
  { name: 'Uber', slug: 'uber', ats: 'uber', boardToken: 'uber', logoColor: '#000000' },

  // ─── Workday-hosted careers (each tenant has its own host + site) ───
  {
    name: 'Salesforce', slug: 'salesforce', ats: 'workday', boardToken: 'salesforce',
    workdayHost: 'salesforce.wd12.myworkdayjobs.com', workdaySite: 'External_Career_Site',
    logoColor: '#00A1E0',
  },
  {
    name: 'Adobe', slug: 'adobe', ats: 'workday', boardToken: 'adobe',
    workdayHost: 'adobe.wd5.myworkdayjobs.com', workdaySite: 'external_experienced',
    logoColor: '#FF0000',
  },
  {
    // Verified live (May 2026): visa.wd5/Visa returns ~926 jobs.
    // The legacy host was visa.wd1 → 422; tenant moved to wd5.
    name: 'Visa', slug: 'visa', ats: 'workday', boardToken: 'visa',
    workdayHost: 'visa.wd5.myworkdayjobs.com', workdaySite: 'Visa',
    logoColor: '#1A1F71',
  },
  {
    // Verified live: expedia.wd108/search returns ~189 jobs. The
    // legacy host was expedia.wd5 → 422; tenant moved to wd108.
    name: 'Expedia', slug: 'expedia', ats: 'workday', boardToken: 'expedia',
    workdayHost: 'expedia.wd108.myworkdayjobs.com', workdaySite: 'search',
    logoColor: '#FFC72C', region: 'Seattle',
  },
  {
    // Verified live: redfin.wd1/Redfin_Careers returns ~2 jobs (small
    // company). Was previously listed as Greenhouse → 404.
    name: 'Redfin', slug: 'redfin', ats: 'workday', boardToken: 'redfin',
    workdayHost: 'redfin.wd1.myworkdayjobs.com', workdaySite: 'Redfin_Careers',
    logoColor: '#A02021', region: 'Seattle',
  },
  {
    // Verified live: zillow.wd5/Zillow_Group_External returns ~197 jobs.
    name: 'Zillow', slug: 'zillow', ats: 'workday', boardToken: 'zillow',
    workdayHost: 'zillow.wd5.myworkdayjobs.com', workdaySite: 'Zillow_Group_External',
    logoColor: '#006AFF', region: 'Seattle',
  },
  {
    // Verified live: walmart.wd5/WalmartExternal returns ~2000 jobs.
    name: 'Walmart Global Tech', slug: 'walmart', ats: 'workday', boardToken: 'walmart',
    workdayHost: 'walmart.wd5.myworkdayjobs.com', workdaySite: 'WalmartExternal',
    logoColor: '#0071DC',
  },
  // DocuSign uses a custom JSON API at careers.docusign.com/api/jobs
  // (not Workday). Removed for now — needs a custom fetcher.
  {
    name: 'Nvidia', slug: 'nvidia', ats: 'workday', boardToken: 'nvidia',
    workdayHost: 'nvidia.wd5.myworkdayjobs.com', workdaySite: 'NVIDIAExternalCareerSite',
    logoColor: '#76B900',
  },
  {
    name: 'Intel', slug: 'intel', ats: 'workday', boardToken: 'intel',
    workdayHost: 'intel.wd1.myworkdayjobs.com', workdaySite: 'External',
    logoColor: '#0071C5',
  },
  // Oracle doesn't use Workday — they run their own Oracle
  // Recruiting Cloud (eeho.fa.us2.oraclecloud.com). Removed for
  // now; needs a custom fetcher.
  // Cisco's careers site is at careers.cisco.com (proprietary, not
  // Workday). Removed for now; needs a custom fetcher.

  // ─── SmartRecruiters Public Postings ───
  // Public + unauthenticated API at api.smartrecruiters.com/v1/companies/{slug}/postings.
  // ServiceNow has ~543 open jobs at the time of probing.
  { name: 'ServiceNow', slug: 'servicenow', ats: 'smartrecruiters', boardToken: 'ServiceNow', logoColor: '#62D84E' },

  // ─── Eightfold-powered careers portals ───
  // Netflix moved off Lever to the Eightfold AI platform at
  // explore.jobs.netflix.net. The public API exposes the full JD, so
  // these are fully scorable (unlike Apple/Meta).
  {
    name: 'Netflix', slug: 'netflix', ats: 'eightfold', boardToken: 'netflix',
    eightfoldHost: 'explore.jobs.netflix.net', eightfoldDomain: 'netflix.com',
    logoColor: '#E50914',
  },

  // ─── Bulk expansion (verified live, ≥1 open job at probe time) ───
  // Each token below was tested via curl against the corresponding
  // ATS API and returned a non-empty job list. Adding here so the
  // default Refresh All sweep covers a much wider slice of the
  // tech / fintech / AI-tools ecosystem out of the box. Users can
  // still add anything else via Settings → Custom Sources.
  //
  // Greenhouse expansions
  { name: 'CoreWeave', slug: 'coreweave', ats: 'greenhouse', boardToken: 'coreweave', logoColor: '#FF6633' },
  { name: 'Okta', slug: 'okta', ats: 'greenhouse', boardToken: 'okta', logoColor: '#007DC1' },
  { name: 'Samsara', slug: 'samsara', ats: 'greenhouse', boardToken: 'samsara', logoColor: '#1B97F0' },
  { name: 'Postman', slug: 'postman', ats: 'greenhouse', boardToken: 'postman', logoColor: '#FF6C37' },
  { name: 'New Relic', slug: 'newrelic', ats: 'greenhouse', boardToken: 'newrelic', logoColor: '#00AC69' },
  { name: 'LaunchDarkly', slug: 'launchdarkly', ats: 'greenhouse', boardToken: 'launchdarkly', logoColor: '#405BFF' },
  { name: 'Squarespace', slug: 'squarespace', ats: 'greenhouse', boardToken: 'squarespace', logoColor: '#000000' },
  { name: 'Pendo', slug: 'pendo', ats: 'greenhouse', boardToken: 'pendo', logoColor: '#FF80AA' },
  { name: 'Gusto', slug: 'gusto', ats: 'greenhouse', boardToken: 'gusto', logoColor: '#F45D48' },
  { name: 'Sumo Logic', slug: 'sumologic', ats: 'greenhouse', boardToken: 'sumologic', logoColor: '#000099' },
  { name: 'Carta', slug: 'carta', ats: 'greenhouse', boardToken: 'carta', logoColor: '#000000' },
  { name: 'Klaviyo', slug: 'klaviyo', ats: 'greenhouse', boardToken: 'klaviyo', logoColor: '#000000' },
  { name: 'Twitch', slug: 'twitch', ats: 'greenhouse', boardToken: 'twitch', logoColor: '#9146FF' },
  { name: 'Nubank', slug: 'nubank', ats: 'greenhouse', boardToken: 'nubank', logoColor: '#820AD1' },
  { name: 'Webflow', slug: 'webflow', ats: 'greenhouse', boardToken: 'webflow', logoColor: '#4353FF' },
  { name: 'Duolingo', slug: 'duolingo', ats: 'greenhouse', boardToken: 'duolingo', logoColor: '#58CC02' },
  { name: 'Attentive', slug: 'attentive', ats: 'greenhouse', boardToken: 'attentive', logoColor: '#FFD000' },
  { name: 'Monzo', slug: 'monzo', ats: 'greenhouse', boardToken: 'monzo', logoColor: '#FF4F40' },
  { name: 'xAI', slug: 'xai', ats: 'greenhouse', boardToken: 'xai', logoColor: '#000000' },
  { name: 'Waymo', slug: 'waymo', ats: 'greenhouse', boardToken: 'waymo', logoColor: '#0078FF' },
  { name: 'Epic Games', slug: 'epicgames', ats: 'greenhouse', boardToken: 'epicgames', logoColor: '#000000' },
  { name: 'Intercom', slug: 'intercom', ats: 'greenhouse', boardToken: 'intercom', logoColor: '#1F8DED' },
  { name: 'Toast', slug: 'toast', ats: 'greenhouse', boardToken: 'toast', logoColor: '#FF4C00' },
  { name: 'Abnormal Security', slug: 'abnormal', ats: 'greenhouse', boardToken: 'abnormalsecurity', logoColor: '#5F4DFF' },
  { name: 'Censys', slug: 'censys', ats: 'greenhouse', boardToken: 'censys', logoColor: '#FF6B35' },
  { name: 'Fivetran', slug: 'fivetran', ats: 'greenhouse', boardToken: 'fivetran', logoColor: '#1A2238' },
  { name: 'Roku', slug: 'roku', ats: 'greenhouse', boardToken: 'roku', logoColor: '#662D91' },
  { name: 'Peloton', slug: 'peloton', ats: 'greenhouse', boardToken: 'peloton', logoColor: '#181A1D' },
  // Lever expansions
  { name: 'Spotify', slug: 'spotify', ats: 'lever', boardToken: 'spotify', logoColor: '#1DB954' },
  { name: 'Zoox', slug: 'zoox', ats: 'lever', boardToken: 'zoox', logoColor: '#000000' },
  // Ashby expansions
  { name: 'Sentry', slug: 'sentry', ats: 'ashby', boardToken: 'sentry', logoColor: '#362D59' },
  { name: 'Replit', slug: 'replit', ats: 'ashby', boardToken: 'replit', logoColor: '#F26207' },
  { name: 'Cursor', slug: 'cursor', ats: 'ashby', boardToken: 'cursor', logoColor: '#000000' },
  { name: 'Benchling', slug: 'benchling', ats: 'ashby', boardToken: 'benchling', logoColor: '#1B4F90' },
  { name: 'Stytch', slug: 'stytch', ats: 'ashby', boardToken: 'stytch', logoColor: '#FF4D4D' },
  { name: 'Lemonade', slug: 'lemonade', ats: 'ashby', boardToken: 'lemonade', logoColor: '#FF0083' },
  { name: 'Quora', slug: 'quora', ats: 'ashby', boardToken: 'quora', logoColor: '#B92B27' },
  { name: 'Supercell', slug: 'supercell', ats: 'ashby', boardToken: 'supercell', logoColor: '#000000' },
  { name: 'Decagon', slug: 'decagon', ats: 'ashby', boardToken: 'decagon', logoColor: '#7C3AED' },
  { name: 'Harvey', slug: 'harvey', ats: 'ashby', boardToken: 'harvey', logoColor: '#000000' },
  { name: 'Sierra', slug: 'sierra', ats: 'ashby', boardToken: 'sierra', logoColor: '#000000' },
  { name: 'Zapier', slug: 'zapier', ats: 'ashby', boardToken: 'zapier', logoColor: '#FF4A00' },
  { name: 'Alchemy', slug: 'alchemy', ats: 'ashby', boardToken: 'alchemy', logoColor: '#0C0C0E' },
  { name: 'Writer', slug: 'writer', ats: 'ashby', boardToken: 'writer', logoColor: '#000000' },
  { name: 'Poolside', slug: 'poolside', ats: 'ashby', boardToken: 'poolside', logoColor: '#000000' },
  { name: 'ClickUp', slug: 'clickup', ats: 'ashby', boardToken: 'clickup', logoColor: '#7B68EE' },
];

/**
 * Union of static + user-added sources. The DB-backed
 * `Settings.customSources` array is read async; static-only callers
 * can keep using `COMPANY_SOURCES` directly. Listings fetchers (the
 * SSE stream + the bulk endpoint) call this so the user's custom
 * additions show up automatically on the next refresh.
 *
 * Dedup rule: if a custom source's `slug` collides with a static
 * one's slug, the custom version wins (lets users override e.g. a
 * stale token without forking the source list).
 */
export async function getAllSources(): Promise<CompanySource[]> {
  // Imported lazily to avoid pulling the DB module into client bundles
  // that still want the static `COMPANY_SOURCES` for previews.
  const { getSettings } = await import('./db');
  const settings = await getSettings();
  const custom = settings.customSources ?? [];
  if (custom.length === 0) return COMPANY_SOURCES;
  const customSlugs = new Set(custom.map((c) => c.slug.toLowerCase()));
  const filteredStatic = COMPANY_SOURCES.filter(
    (s) => !customSlugs.has(s.slug.toLowerCase()),
  );
  return [...filteredStatic, ...custom];
}
