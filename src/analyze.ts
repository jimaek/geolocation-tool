import { ProbeResult } from './measure.js';

export interface GeolocationResult {
  detectedCountry: string;
  detectedCity: string;
  confidence: 'high' | 'medium' | 'low';
  minRtt: number;
  allResults: ProbeResult[];
}

export function analyzeResults(results: ProbeResult[]): GeolocationResult {
  if (results.length === 0) {
    throw new Error('No measurement results to analyze');
  }

  const sorted = [...results].sort((a, b) => a.minRtt - b.minRtt);
  const best = sorted[0];

  let confidence: 'high' | 'medium' | 'low';
  if (best.minRtt < 1) {
    confidence = 'high';
  } else if (best.minRtt < 10) {
    confidence = 'medium';
  } else {
    confidence = 'low';
  }

  return {
    detectedCountry: best.country,
    detectedCity: best.city,
    confidence,
    minRtt: best.minRtt,
    allResults: sorted
  };
}

export function getBestPerCountry(results: ProbeResult[]): Map<string, ProbeResult> {
  const byCountry = new Map<string, ProbeResult>();

  for (const r of results) {
    const existing = byCountry.get(r.country);
    if (!existing || r.minRtt < existing.minRtt) {
      byCountry.set(r.country, r);
    }
  }

  return byCountry;
}

export function checkVirtualLocation(
  results: ProbeResult[],
  claimedCountry: string
): { isVirtual: boolean; actualCountry: string; distance: string } {
  const sorted = [...results].sort((a, b) => a.minRtt - b.minRtt);
  const best = sorted[0];

  const claimedResult = results.find(r => r.country === claimedCountry);

  if (best.country === claimedCountry && best.minRtt < 5) {
    return { isVirtual: false, actualCountry: claimedCountry, distance: 'N/A' };
  }

  if (best.country !== claimedCountry && claimedResult) {
    const rttDiff = claimedResult.minRtt - best.minRtt;
    if (rttDiff > 20) {
      return {
        isVirtual: true,
        actualCountry: best.country,
        distance: `~${Math.round(rttDiff * 100)}km`
      };
    }
  }

  return { isVirtual: false, actualCountry: best.country, distance: 'N/A' };
}
