/**
 * Curated list of global tech hubs for the location autocomplete.
 * Used on the onboarding wizard and settings page.
 *
 * Format: "City, Region" (e.g., "Bellevue, WA" or "Bengaluru, India").
 * "Remote" is a special entry handled separately by the location matcher.
 */

export const TECH_HUBS: string[] = [
  // Special
  'Remote',

  // USA — West Coast
  'Seattle, WA',
  'Bellevue, WA',
  'Redmond, WA',
  'Kirkland, WA',
  'Tacoma, WA',
  'Spokane, WA',
  'Portland, OR',
  'Beaverton, OR',
  'San Francisco, CA',
  'South San Francisco, CA',
  'Oakland, CA',
  'Berkeley, CA',
  'Palo Alto, CA',
  'Mountain View, CA',
  'Sunnyvale, CA',
  'Cupertino, CA',
  'Menlo Park, CA',
  'San Jose, CA',
  'Santa Clara, CA',
  'Los Angeles, CA',
  'Santa Monica, CA',
  'Irvine, CA',
  'San Diego, CA',
  'Los Gatos, CA',

  // USA — Mountain / Southwest
  'Denver, CO',
  'Boulder, CO',
  'Salt Lake City, UT',
  'Lehi, UT',
  'Provo, UT',
  'Phoenix, AZ',
  'Tempe, AZ',
  'Las Vegas, NV',
  'Reno, NV',

  // USA — Central / South
  'Austin, TX',
  'Dallas, TX',
  'Plano, TX',
  'Houston, TX',
  'San Antonio, TX',
  'Atlanta, GA',
  'Raleigh, NC',
  'Durham, NC',
  'Charlotte, NC',
  'Nashville, TN',
  'Miami, FL',
  'Tampa, FL',
  'Orlando, FL',
  'Chicago, IL',
  'Minneapolis, MN',
  'St. Louis, MO',
  'Kansas City, MO',
  'Detroit, MI',

  // USA — East Coast
  'New York, NY',
  'Brooklyn, NY',
  'Jersey City, NJ',
  'Newark, NJ',
  'Boston, MA',
  'Cambridge, MA',
  'Washington, DC',
  'Arlington, VA',
  'Reston, VA',
  'Herndon, VA',
  'McLean, VA',
  'Philadelphia, PA',
  'Pittsburgh, PA',
  'Baltimore, MD',
  'Bethesda, MD',

  // Canada
  'Toronto, Canada',
  'Vancouver, Canada',
  'Montreal, Canada',
  'Ottawa, Canada',
  'Waterloo, Canada',
  'Calgary, Canada',

  // India
  'Bengaluru, India',
  'Hyderabad, India',
  'Pune, India',
  'Mumbai, India',
  'Chennai, India',
  'Gurgaon, India',
  'Noida, India',
  'Delhi, India',
  'Ahmedabad, India',
  'Kolkata, India',

  // Europe — UK & Ireland
  'London, UK',
  'Cambridge, UK',
  'Manchester, UK',
  'Edinburgh, UK',
  'Dublin, Ireland',

  // Europe — Continental
  'Berlin, Germany',
  'Munich, Germany',
  'Hamburg, Germany',
  'Frankfurt, Germany',
  'Amsterdam, Netherlands',
  'Rotterdam, Netherlands',
  'Paris, France',
  'Toulouse, France',
  'Zurich, Switzerland',
  'Geneva, Switzerland',
  'Stockholm, Sweden',
  'Gothenburg, Sweden',
  'Copenhagen, Denmark',
  'Oslo, Norway',
  'Helsinki, Finland',
  'Warsaw, Poland',
  'Krakow, Poland',
  'Prague, Czech Republic',
  'Vienna, Austria',
  'Madrid, Spain',
  'Barcelona, Spain',
  'Lisbon, Portugal',
  'Milan, Italy',
  'Rome, Italy',
  'Brussels, Belgium',

  // Middle East
  'Tel Aviv, Israel',
  'Haifa, Israel',
  'Dubai, UAE',
  'Abu Dhabi, UAE',
  'Riyadh, Saudi Arabia',

  // Asia-Pacific
  'Singapore',
  'Tokyo, Japan',
  'Osaka, Japan',
  'Seoul, South Korea',
  'Hong Kong',
  'Taipei, Taiwan',
  'Sydney, Australia',
  'Melbourne, Australia',
  'Brisbane, Australia',
  'Auckland, New Zealand',
  'Beijing, China',
  'Shanghai, China',
  'Shenzhen, China',
  'Hangzhou, China',
  'Bangkok, Thailand',
  'Manila, Philippines',
  'Kuala Lumpur, Malaysia',
  'Jakarta, Indonesia',
  'Ho Chi Minh City, Vietnam',

  // Latin America
  'São Paulo, Brazil',
  'Rio de Janeiro, Brazil',
  'Mexico City, Mexico',
  'Guadalajara, Mexico',
  'Buenos Aires, Argentina',
  'Santiago, Chile',
  'Bogotá, Colombia',
  'Medellín, Colombia',
  'Lima, Peru',
];

/**
 * Fuzzy-match tech hubs against the user's input.
 * Ranks by: exact-prefix > word-prefix > substring.
 * Returns up to `limit` matches.
 */
export function searchTechHubs(query: string, limit = 8): string[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];

  type Scored = { hub: string; score: number };
  const scored: Scored[] = [];

  for (const hub of TECH_HUBS) {
    const lower = hub.toLowerCase();
    if (lower === q) {
      scored.push({ hub, score: 1000 });
      continue;
    }
    if (lower.startsWith(q)) {
      scored.push({ hub, score: 500 - hub.length });
      continue;
    }
    // word-prefix: match at the start of any word
    const words = lower.split(/[\s,]+/);
    const wordPrefix = words.some((w) => w.startsWith(q));
    if (wordPrefix) {
      scored.push({ hub, score: 200 - hub.length });
      continue;
    }
    if (lower.includes(q)) {
      scored.push({ hub, score: 50 - hub.length });
    }
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map((s) => s.hub);
}
