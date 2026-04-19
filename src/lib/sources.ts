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
  { name: 'Coinbase', slug: 'coinbase', ats: 'greenhouse', boardToken: 'coinbase', logoColor: '#0052FF' },
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
  { name: 'HashiCorp', slug: 'hashicorp', ats: 'greenhouse', boardToken: 'hashicorp', logoColor: '#000000' },
  { name: 'Instacart', slug: 'instacart', ats: 'greenhouse', boardToken: 'instacart', logoColor: '#43B02A' },
  { name: 'Lyft', slug: 'lyft', ats: 'greenhouse', boardToken: 'lyft', logoColor: '#FF00BF' },
  { name: 'Block', slug: 'block', ats: 'greenhouse', boardToken: 'block', logoColor: '#00D632' },
  { name: 'Snowflake', slug: 'snowflake', ats: 'greenhouse', boardToken: 'snowflake', logoColor: '#29B5E8' },
  { name: 'Qualtrics', slug: 'qualtrics', ats: 'greenhouse', boardToken: 'qualtrics', logoColor: '#1B2B4B', region: 'Seattle' },
  { name: 'Dropbox', slug: 'dropbox', ats: 'greenhouse', boardToken: 'dropbox', logoColor: '#0061FF' },
  { name: 'Roblox', slug: 'roblox', ats: 'greenhouse', boardToken: 'roblox', logoColor: '#E2231A' },
  { name: 'Redfin', slug: 'redfin', ats: 'greenhouse', boardToken: 'redfin', logoColor: '#A02021', region: 'Seattle' },
  { name: 'Remitly', slug: 'remitly', ats: 'greenhouse', boardToken: 'remitly', logoColor: '#FFBB41', region: 'Seattle' },
  { name: 'Nutanix', slug: 'nutanix', ats: 'greenhouse', boardToken: 'nutanix', logoColor: '#024DA1' },
  { name: 'Apptio', slug: 'apptio', ats: 'greenhouse', boardToken: 'apptio', logoColor: '#0072CE', region: 'Seattle' },
  { name: 'Atlassian', slug: 'atlassian', ats: 'greenhouse', boardToken: 'atlassian', logoColor: '#0052CC' },
  { name: 'ServiceNow', slug: 'servicenow', ats: 'greenhouse', boardToken: 'servicenow', logoColor: '#62D84E' },
  { name: 'Zillow', slug: 'zillow', ats: 'greenhouse', boardToken: 'zillow', logoColor: '#006AFF', region: 'Seattle' },
  { name: 'Walmart Global Tech', slug: 'walmart', ats: 'greenhouse', boardToken: 'walmartglobaltech', logoColor: '#0071DC' },
  { name: 'Compass', slug: 'compass', ats: 'greenhouse', boardToken: 'compass', logoColor: '#00B86B' },
  { name: 'Smartsheet', slug: 'smartsheet', ats: 'greenhouse', boardToken: 'smartsheet', logoColor: '#1F6BFF', region: 'Seattle' },
  { name: 'Asana', slug: 'asana', ats: 'greenhouse', boardToken: 'asana', logoColor: '#F06A6A' },
  { name: 'GitHub', slug: 'github', ats: 'greenhouse', boardToken: 'github', logoColor: '#181717' },
  { name: 'Shopify', slug: 'shopify', ats: 'greenhouse', boardToken: 'shopify', logoColor: '#96BF48' },
  { name: 'Square', slug: 'square', ats: 'greenhouse', boardToken: 'square', logoColor: '#3E4348' },
  { name: 'Confluent', slug: 'confluent', ats: 'greenhouse', boardToken: 'confluent', logoColor: '#38A1DB' },
  { name: 'MongoDB', slug: 'mongodb', ats: 'greenhouse', boardToken: 'mongodb', logoColor: '#47A248' },
  { name: 'Elastic', slug: 'elastic', ats: 'greenhouse', boardToken: 'elastic', logoColor: '#005571' },
  { name: 'GitLab', slug: 'gitlab', ats: 'greenhouse', boardToken: 'gitlab', logoColor: '#FC6D26' },
  { name: 'Affirm', slug: 'affirm', ats: 'greenhouse', boardToken: 'affirm', logoColor: '#0FA0EA' },
  { name: 'Chime', slug: 'chime', ats: 'greenhouse', boardToken: 'chime', logoColor: '#1EC677' },
  { name: 'Rippling', slug: 'rippling', ats: 'greenhouse', boardToken: 'rippling', logoColor: '#502EB4' },

  // ─── Lever ───
  { name: 'Netflix', slug: 'netflix', ats: 'lever', boardToken: 'netflix', logoColor: '#E50914' },
  { name: 'Highspot', slug: 'highspot', ats: 'lever', boardToken: 'highspot', logoColor: '#3361FF', region: 'Seattle' },
  { name: 'Plaid', slug: 'plaid', ats: 'lever', boardToken: 'plaid', logoColor: '#000000' },
  { name: 'Palantir', slug: 'palantir', ats: 'lever', boardToken: 'palantir', logoColor: '#000000' },
  { name: 'Docker', slug: 'docker', ats: 'lever', boardToken: 'docker', logoColor: '#2496ED' },

  // ─── Ashby ───
  { name: 'OpenAI', slug: 'openai', ats: 'ashby', boardToken: 'openai', logoColor: '#10A37F' },
  { name: 'Notion', slug: 'notion', ats: 'ashby', boardToken: 'notion', logoColor: '#000000' },
  { name: 'Ramp', slug: 'ramp', ats: 'ashby', boardToken: 'ramp', logoColor: '#F2E307' },
  { name: 'Linear', slug: 'linear', ats: 'ashby', boardToken: 'linear', logoColor: '#5E6AD2' },
  { name: 'Vercel', slug: 'vercel', ats: 'ashby', boardToken: 'vercel', logoColor: '#000000' },
  { name: 'Mercury', slug: 'mercury', ats: 'ashby', boardToken: 'mercury', logoColor: '#5B67BB' },

  // ─── Custom per-company APIs (tech giants that don't use public ATSs) ───
  { name: 'Google', slug: 'google', ats: 'google', boardToken: 'google', logoColor: '#4285F4' },
  { name: 'Apple', slug: 'apple', ats: 'apple', boardToken: 'apple', logoColor: '#000000' },
  { name: 'Microsoft', slug: 'microsoft', ats: 'microsoft', boardToken: 'microsoft', logoColor: '#00A4EF', region: 'Seattle' },
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
    name: 'Visa', slug: 'visa', ats: 'workday', boardToken: 'visa',
    workdayHost: 'visa.wd1.myworkdayjobs.com', workdaySite: 'Job_Portal',
    logoColor: '#1A1F71',
  },
  {
    name: 'Expedia', slug: 'expedia', ats: 'workday', boardToken: 'expedia',
    workdayHost: 'expedia.wd5.myworkdayjobs.com', workdaySite: 'search',
    logoColor: '#FFC72C', region: 'Seattle',
  },
  {
    name: 'DocuSign', slug: 'docusign', ats: 'workday', boardToken: 'docusign',
    workdayHost: 'docusign.wd1.myworkdayjobs.com', workdaySite: 'DocuSign',
    logoColor: '#FFCC22',
  },
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
  {
    name: 'Oracle', slug: 'oracle', ats: 'workday', boardToken: 'oracle',
    workdayHost: 'oracle.wd5.myworkdayjobs.com', workdaySite: 'Oracle',
    logoColor: '#F80000',
  },
  {
    name: 'Cisco', slug: 'cisco', ats: 'workday', boardToken: 'cisco',
    workdayHost: 'cisco.wd5.myworkdayjobs.com', workdaySite: 'External_Career',
    logoColor: '#1BA0D7',
  },
];
