import type { CompanySource } from './types';

/**
 * Company career page sources.
 *
 * Greenhouse API: https://boards-api.greenhouse.io/v1/boards/{boardToken}/jobs
 * Lever API:      https://api.lever.co/v0/postings/{boardToken}?mode=json
 * Ashby API:      https://api.ashbyhq.com/posting-api/job-board/{boardToken}
 */
export const COMPANY_SOURCES: CompanySource[] = [
  // === Greenhouse companies ===
  // Note: several large companies (Google, Meta, Apple, Microsoft, Adobe, Salesforce)
  // don't expose a public Greenhouse/Lever/Ashby board — those entries will fail the
  // fetch and surface in the "fetch errors" panel. Tokens below are best-known guesses.
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
  { name: 'Uber', slug: 'uber', ats: 'greenhouse', boardToken: 'uber', logoColor: '#000000' },
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
  { name: 'Adobe', slug: 'adobe', ats: 'greenhouse', boardToken: 'adobe', logoColor: '#FF0000' },
  { name: 'Salesforce', slug: 'salesforce', ats: 'greenhouse', boardToken: 'salesforce', logoColor: '#00A1E0' },
  { name: 'ServiceNow', slug: 'servicenow', ats: 'greenhouse', boardToken: 'servicenow', logoColor: '#62D84E' },
  { name: 'Zillow', slug: 'zillow', ats: 'greenhouse', boardToken: 'zillow', logoColor: '#006AFF', region: 'Seattle' },
  { name: 'Walmart Global Tech', slug: 'walmart', ats: 'greenhouse', boardToken: 'walmartglobaltech', logoColor: '#0071DC' },
  { name: 'Google', slug: 'google', ats: 'greenhouse', boardToken: 'google', logoColor: '#4285F4' },
  { name: 'Meta', slug: 'meta', ats: 'greenhouse', boardToken: 'meta', logoColor: '#1877F2' },
  { name: 'Apple', slug: 'apple', ats: 'greenhouse', boardToken: 'apple', logoColor: '#000000' },
  { name: 'Microsoft', slug: 'microsoft', ats: 'greenhouse', boardToken: 'microsoft', logoColor: '#00A4EF' },

  // === Lever companies ===
  { name: 'Netflix', slug: 'netflix', ats: 'lever', boardToken: 'netflix', logoColor: '#E50914' },
  { name: 'Highspot', slug: 'highspot', ats: 'lever', boardToken: 'highspot', logoColor: '#3361FF', region: 'Seattle' },
  { name: 'Plaid', slug: 'plaid', ats: 'lever', boardToken: 'plaid', logoColor: '#000000' },
  { name: 'Palantir', slug: 'palantir', ats: 'lever', boardToken: 'palantir', logoColor: '#000000' },

  // === Ashby companies ===
  { name: 'OpenAI', slug: 'openai', ats: 'ashby', boardToken: 'openai', logoColor: '#10A37F' },
  { name: 'Notion', slug: 'notion', ats: 'ashby', boardToken: 'notion', logoColor: '#000000' },
  { name: 'Ramp', slug: 'ramp', ats: 'ashby', boardToken: 'ramp', logoColor: '#F2E307' },
];
