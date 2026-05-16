const PRIMARY_COUNTRY_SET = new Set(['US', 'UK', 'CA', 'AU']);
const SECONDARY_COUNTRY_SET = new Set(['DE', 'IE', 'NL', 'NZ', 'SG']);

export function scoreCountryTargets(countryTargets: string[]): number {
  let score = 0;
  for (const country of countryTargets) {
    if (PRIMARY_COUNTRY_SET.has(country)) {
      score += 5;
      continue;
    }

    if (SECONDARY_COUNTRY_SET.has(country)) {
      score += 3;
    }
  }

  return Math.min(24, score);
}
