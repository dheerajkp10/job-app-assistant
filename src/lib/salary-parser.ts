/**
 * Extract salary information from job description HTML/text.
 * Returns structured salary data if found.
 */

interface SalaryInfo {
  display: string; // e.g. "$300,000 - $400,000"
  min: number | null;
  max: number | null;
}

export function extractSalary(text: string): SalaryInfo | null {
  if (!text) return null;

  // Clean HTML tags
  const clean = text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

  // Pattern 1: "$XXX,XXX - $XXX,XXX" or "$XXXK - $XXXK"
  const rangeMatch = clean.match(
    /\$\s*([\d,]+(?:\.\d+)?)\s*[kK]?\s*(?:[-–—to]+)\s*\$\s*([\d,]+(?:\.\d+)?)\s*[kK]?/
  );
  if (rangeMatch) {
    let min = parseAmount(rangeMatch[1]);
    let max = parseAmount(rangeMatch[2]);
    // Check if K suffix
    if (clean.substring(clean.indexOf(rangeMatch[0]), clean.indexOf(rangeMatch[0]) + rangeMatch[0].length + 5).match(/[kK]/)) {
      if (min < 1000) min *= 1000;
      if (max < 1000) max *= 1000;
    }
    // Only return if it looks like annual salary (>$50K)
    if (min >= 50000 || max >= 50000) {
      return {
        display: `$${formatAmount(min)} - $${formatAmount(max)}`,
        min,
        max,
      };
    }
  }

  // Pattern 2: "$XXX,XXX" standalone near salary/compensation keywords
  const salaryContext = clean.match(
    /(?:salary|compensation|pay|base|total\s+comp|annual|range)[^$]{0,50}\$\s*([\d,]+(?:\.\d+)?)\s*[kK]?/i
  );
  if (salaryContext) {
    let amount = parseAmount(salaryContext[1]);
    if (salaryContext[0].match(/[kK]/) && amount < 1000) amount *= 1000;
    if (amount >= 50000) {
      return {
        display: `$${formatAmount(amount)}`,
        min: amount,
        max: null,
      };
    }
  }

  // Pattern 3: "XXXk" or "XXXK" near salary keywords
  const kMatch = clean.match(
    /(?:salary|compensation|pay|base|total\s+comp|annual|range)[^0-9]{0,50}(\d{2,4})\s*[kK]/i
  );
  if (kMatch) {
    const amount = parseInt(kMatch[1]) * 1000;
    if (amount >= 50000) {
      return {
        display: `$${formatAmount(amount)}`,
        min: amount,
        max: null,
      };
    }
  }

  // Pattern 4: Range with K suffix like "300K-450K" or "$300k - $450k"
  const kRangeMatch = clean.match(
    /\$?\s*(\d{2,4})\s*[kK]\s*(?:[-–—to]+)\s*\$?\s*(\d{2,4})\s*[kK]/
  );
  if (kRangeMatch) {
    const min = parseInt(kRangeMatch[1]) * 1000;
    const max = parseInt(kRangeMatch[2]) * 1000;
    if (min >= 50000 || max >= 50000) {
      return {
        display: `$${formatAmount(min)} - $${formatAmount(max)}`,
        min,
        max,
      };
    }
  }

  return null;
}

function parseAmount(str: string): number {
  return parseInt(str.replace(/[,.\s]/g, ''));
}

function formatAmount(n: number): string {
  if (n >= 1000) {
    return n.toLocaleString('en-US');
  }
  return n.toString();
}
