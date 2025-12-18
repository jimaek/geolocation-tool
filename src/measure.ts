import { Globalping } from 'globalping';
import { CONTINENTS, getCountryContinent, getCountryName, getStateName } from './countries.js';

export interface ProbeResult {
  country: string;
  city: string;
  state?: string;
  minRtt: number;
  avgRtt: number;
  probeAsn: number;
  probeNetwork: string;
}

function checkRateLimitError(result: any): void {
  if (!result.ok && result.response?.status === 429) {
    throw new Error('You have run out of credits for this session. You can wait for the rate limit to reset or get higher limits by sponsoring us or hosting probes. Learn more at https://dash.globalping.io?view=add-credits');
  }
}

function extractLatencyFromTraceroute(result: any): number | null {
  if (result.status !== 'finished' || !result.hops) {
    return null;
  }

  let hasValidHopAtThreeOrHigher = false;
  for (let i = 2; i < result.hops.length; i++) {
    const hop = result.hops[i];
    if (hop.timings && hop.timings.length > 0) {
      const rtts = hop.timings.map((t: any) => t.rtt).filter((rtt: number) => rtt > 0);
      if (rtts.length > 0) {
        hasValidHopAtThreeOrHigher = true;
        break;
      }
    }
  }

  if (!hasValidHopAtThreeOrHigher) {
    return null;
  }

  for (let i = result.hops.length - 1; i >= 0; i--) {
    const hop = result.hops[i];
    if (hop.timings && hop.timings.length > 0) {
      const rtts = hop.timings.map((t: any) => t.rtt).filter((rtt: number) => rtt > 0);
      if (rtts.length > 0) {
        return Math.min(...rtts);
      }
    }
  }

  return null;
}

async function measureContinents(
  client: Globalping<false>,
  targetIp: string
): Promise<{ continent: string; avgLatency: number }> {
  console.log('Phase 1: Detecting continent...');

  const result = await client.createMeasurement({
    type: 'traceroute',
    target: targetIp,
    locations: CONTINENTS.map(c => ({ magic: c.magic, limit: 5 }))
  });

  checkRateLimitError(result);

  if (!result.ok) {
    throw new Error(`Failed to create measurement: ${JSON.stringify(result.data)}`);
  }

  const measurementId = result.data.id;
  const expectedProbes = result.data.probesCount;

  console.log(`  Measuring from ${expectedProbes} probes...\n`);

  const data = await pollMeasurementByAverage(
    client,
    measurementId,
    expectedProbes,
    (item) => item.probe.continent
  );

  const continentLatencies = new Map<string, number[]>();
  for (const item of data.results) {
    const latency = extractLatencyFromTraceroute(item.result);
    if (latency !== null) {
      const continent = item.probe.continent;
      if (!continentLatencies.has(continent)) {
        continentLatencies.set(continent, []);
      }
      continentLatencies.get(continent)!.push(latency);
    }
  }

  const measurements: { continent: string; avgLatency: number }[] = [];
  for (const [continent, latencies] of continentLatencies) {
    const avgLatency = latencies.reduce((a, b) => a + b, 0) / latencies.length;
    const continentInfo = CONTINENTS.find(c => c.code === continent);
    console.log(`  ${continentInfo?.name || continent}: ${avgLatency.toFixed(2)} ms`);
    measurements.push({ continent, avgLatency });
  }

  const best = measurements.sort((a, b) => a.avgLatency - b.avgLatency)[0];

  if (!best) {
    throw new Error('No successful measurements from any continent');
  }

  const continentInfo = CONTINENTS.find(c => c.code === best.continent);
  console.log(`\nBest continent: ${continentInfo?.name} (${best.avgLatency.toFixed(2)} ms)\n`);

  return best;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function aggregateLatenciesByField(
  results: any[],
  fieldExtractor: (item: any) => string
): Map<string, number[]> {
  const dataMap = new Map<string, number[]>();

  for (const item of results) {
    const latency = extractLatencyFromTraceroute(item.result);
    if (latency !== null) {
      const fieldValue = fieldExtractor(item);
      if (!dataMap.has(fieldValue)) {
        dataMap.set(fieldValue, []);
      }
      dataMap.get(fieldValue)!.push(latency);
    }
  }

  return dataMap;
}

function buildProbeResults(
  dataMap: Map<string, number[]>,
  country: string,
  city?: string,
  state?: string
): ProbeResult[] {
  const results: ProbeResult[] = [];

  for (const [key, latencies] of dataMap.entries()) {
    const avgLatency = latencies.reduce((a, b) => a + b, 0) / latencies.length;
    const minLatency = Math.min(...latencies);

    let resultCountry: string;
    let resultCity: string;
    let resultState: string | undefined;

    if (country === '') {
      resultCountry = key;
      resultCity = '';
      resultState = undefined;
    } else if (city === '' && state === '') {
      resultCountry = country;
      resultCity = '';
      resultState = key;
    } else if (city === '' && state) {
      resultCountry = country;
      resultCity = key;
      resultState = state;
    } else {
      resultCountry = country;
      resultCity = key;
      resultState = undefined;
    }

    results.push({
      country: resultCountry,
      city: resultCity,
      state: resultState,
      minRtt: minLatency,
      avgRtt: avgLatency,
      probeAsn: 0,
      probeNetwork: ''
    });
  }

  return results.sort((a, b) => a.minRtt - b.minRtt);
}

function renderProgressBar(finished: number, total: number, bestName?: string, bestLatency?: number): void {
  const percentage = (finished / total) * 100;
  const barLength = 40;
  const filledLength = Math.round((finished / total) * barLength);

  const bar = '█'.repeat(filledLength) + '░'.repeat(barLength - filledLength);
  const percent = percentage.toFixed(1).padStart(5);
  const counts = `${finished}/${total}`.padStart(7);

  let line = `  [${bar}] ${percent}% ${counts}`;

  if (bestName && bestLatency !== undefined) {
    line += ` - Best: ${bestName} (${bestLatency.toFixed(2)} ms)`;
  }

  process.stdout.write('\r' + line.padEnd(100));
}

async function pollMeasurement(
  client: Globalping<false>,
  measurementId: string,
  expectedProbes: number,
  fieldExtractor: (item: any) => string
): Promise<any> {
  let bestName: string | undefined;
  let bestLatency: number | undefined;
  let data: any;

  while (true) {
    const result = await client.getMeasurement(measurementId);
    checkRateLimitError(result);

    if (!result.ok) {
      throw new Error(`Failed to get measurement: ${JSON.stringify(result.data)}`);
    }

    data = result.data;
    const finishedCount = data.results.filter((r: any) => r.result.status === 'finished').length;

    const tempData = aggregateLatenciesByField(data.results, fieldExtractor);

    if (tempData.size > 0) {
      let minValue = Infinity;
      for (const [name, latencies] of tempData.entries()) {
        const min = Math.min(...latencies);
        if (min < minValue) {
          minValue = min;
          bestName = name;
          bestLatency = min;
        }
      }
    }

    renderProgressBar(finishedCount, expectedProbes, bestName, bestLatency);

    if (data.status !== 'in-progress') {
      process.stdout.write('\n\n');
      break;
    }

    await sleep(1000);
  }

  return data;
}

async function pollMeasurementByAverage(
  client: Globalping<false>,
  measurementId: string,
  expectedProbes: number,
  fieldExtractor: (item: any) => string
): Promise<any> {
  let bestName: string | undefined;
  let bestLatency: number | undefined;
  let data: any;

  while (true) {
    const result = await client.getMeasurement(measurementId);
    checkRateLimitError(result);

    if (!result.ok) {
      throw new Error(`Failed to get measurement: ${JSON.stringify(result.data)}`);
    }

    data = result.data;
    const finishedCount = data.results.filter((r: any) => r.result.status === 'finished').length;

    const tempData = aggregateLatenciesByField(data.results, fieldExtractor);

    if (tempData.size > 0) {
      let minAvg = Infinity;
      for (const [name, latencies] of tempData.entries()) {
        const avg = latencies.reduce((a, b) => a + b, 0) / latencies.length;
        if (avg < minAvg) {
          minAvg = avg;
          bestName = name;
          bestLatency = avg;
        }
      }
    }

    renderProgressBar(finishedCount, expectedProbes, bestName, bestLatency);

    if (data.status !== 'in-progress') {
      process.stdout.write('\n\n');
      break;
    }

    await sleep(1000);
  }

  return data;
}

async function measureCountries(
  client: Globalping<false>,
  targetIp: string,
  continent: string,
  limit: number
): Promise<ProbeResult[]> {
  console.log('Phase 2: Detecting country...');

  const continentInfo = CONTINENTS.find(c => c.code === continent);
  const createResult = await client.createMeasurement({
    type: 'traceroute',
    target: targetIp,
    locations: [{ magic: continentInfo!.magic, limit }]
  });

  checkRateLimitError(createResult);

  if (!createResult.ok) {
    throw new Error(`Failed to create measurement: ${JSON.stringify(createResult.data)}`);
  }

  const measurementId = createResult.data.id;
  const expectedProbes = createResult.data.probesCount;

  console.log(`  Measuring from ${expectedProbes} probes...\n`);

  const data = await pollMeasurement(
    client,
    measurementId,
    expectedProbes,
    (item) => item.probe.country
  );

  const countryData = aggregateLatenciesByField(data.results, (item) => item.probe.country);
  const results = buildProbeResults(countryData, '');

  const topCount = Math.min(3, results.length);
  for (let i = 0; i < topCount; i++) {
    const r = results[i];
    const countryName = getCountryName(r.country);
    console.log(`  ${countryName}: ${r.minRtt.toFixed(2)}ms`);
  }

  if (results.length > 0) {
    const best = results[0];
    const countryName = getCountryName(best.country);
    console.log(`\nBest country: ${countryName} (${best.minRtt.toFixed(2)}ms)\n`);
  }

  return results;
}

async function measureCities(
  client: Globalping<false>,
  targetIp: string,
  country: string,
  limit: number
): Promise<ProbeResult[]> {
  console.log('Phase 3: Detecting city...');

  const createResult = await client.createMeasurement({
    type: 'traceroute',
    target: targetIp,
    locations: [{ country, limit }]
  });

  checkRateLimitError(createResult);

  if (!createResult.ok) {
    throw new Error(`Failed to create measurement: ${JSON.stringify(createResult.data)}`);
  }

  const measurementId = createResult.data.id;
  const expectedProbes = createResult.data.probesCount;

  console.log(`  Measuring from ${expectedProbes} probes...\n`);

  const data = await pollMeasurement(
    client,
    measurementId,
    expectedProbes,
    (item) => item.probe.city || 'Unknown'
  );

  const cityData = aggregateLatenciesByField(data.results, (item) => item.probe.city || 'Unknown');
  const results = buildProbeResults(cityData, country);

  return results;
}

async function measureUSStates(
  client: Globalping<false>,
  targetIp: string,
  limit: number
): Promise<ProbeResult[]> {
  console.log('Phase 3: Detecting US state...');

  const createResult = await client.createMeasurement({
    type: 'traceroute',
    target: targetIp,
    locations: [{ magic: 'united states', limit }]
  });

  checkRateLimitError(createResult);

  if (!createResult.ok) {
    throw new Error(`Failed to create measurement: ${JSON.stringify(createResult.data)}`);
  }

  const measurementId = createResult.data.id;
  const expectedProbes = createResult.data.probesCount;

  console.log(`  Measuring from ${expectedProbes} probes...\n`);

  const data = await pollMeasurement(
    client,
    measurementId,
    expectedProbes,
    (item) => item.probe.state || 'Unknown'
  );

  const stateData = aggregateLatenciesByField(data.results, (item) => item.probe.state || 'Unknown');
  const results = buildProbeResults(stateData, 'US', '', '');

  const topCount = Math.min(3, results.length);
  for (let i = 0; i < topCount; i++) {
    const r = results[i];
    const stateName = getStateName(r.state!);
    console.log(`  ${stateName}: ${r.minRtt.toFixed(2)}ms`);
  }

  if (results.length > 0) {
    const best = results[0];
    const stateName = getStateName(best.state!);
    console.log(`\nBest state: ${stateName} (${best.minRtt.toFixed(2)}ms)\n`);
  }

  return results;
}

async function measureUSCities(
  client: Globalping<false>,
  targetIp: string,
  state: string,
  limit: number
): Promise<ProbeResult[]> {
  console.log('Phase 4: Detecting city...');

  const createResult = await client.createMeasurement({
    type: 'traceroute',
    target: targetIp,
    locations: [{ country: 'US', state, limit }]
  });

  checkRateLimitError(createResult);

  if (!createResult.ok) {
    throw new Error(`Failed to create measurement: ${JSON.stringify(createResult.data)}`);
  }

  const measurementId = createResult.data.id;
  const expectedProbes = createResult.data.probesCount;

  console.log(`  Measuring from ${expectedProbes} probes...\n`);

  const data = await pollMeasurement(
    client,
    measurementId,
    expectedProbes,
    (item) => item.probe.city || 'Unknown'
  );

  const cityData = aggregateLatenciesByField(data.results, (item) => item.probe.city || 'Unknown');
  const results = buildProbeResults(cityData, 'US', '', state);

  return results;
}

export async function runMeasurements(
  client: Globalping<false>,
  targetIp: string,
  limit: number = 50
): Promise<ProbeResult[]> {
  const { continent } = await measureContinents(client, targetIp);
  const countryResults = await measureCountries(client, targetIp, continent, limit);

  if (countryResults.length > 0 && countryResults[0].country === 'US') {
    const stateResults = await measureUSStates(client, targetIp, limit);
    if (stateResults.length > 0) {
      const bestState = stateResults[0].state!;
      const cityResults = await measureUSCities(client, targetIp, bestState, limit);
      return cityResults;
    }
    return stateResults;
  }

  if (countryResults.length > 0) {
    const bestCountry = countryResults[0].country;
    const cityResults = await measureCities(client, targetIp, bestCountry, limit);
    return cityResults;
  }

  return countryResults;
}
