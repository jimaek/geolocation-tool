import { Globalping } from 'globalping';
import { CONTINENTS, getCountryContinent } from './countries.js';

export interface ProbeResult {
  country: string;
  city: string;
  state?: string;
  minRtt: number;
  avgRtt: number;
  probeAsn: number;
  probeNetwork: string;
}

function extractLatencyFromTraceroute(result: any): number | null {
  if (result.status !== 'finished' || !result.hops) {
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

  const measurements = await Promise.all(
    CONTINENTS.map(async (continent) => {
      const result = await client.createMeasurement({
        type: 'traceroute',
        target: targetIp,
        locations: [{ magic: continent.magic, limit: 5 }]
      });

      if (!result.ok) return { continent: continent.code, avgLatency: Infinity };

      const data = await client.awaitMeasurement(result.data.id);
      if (!data.ok) return { continent: continent.code, avgLatency: Infinity };

      const latencies: number[] = [];
      for (const item of data.data.results) {
        const latency = extractLatencyFromTraceroute(item.result);
        if (latency !== null) {
          latencies.push(latency);
        }
      }

      const avgLatency = latencies.length > 0
        ? latencies.reduce((a, b) => a + b, 0) / latencies.length
        : Infinity;

      const continentInfo = CONTINENTS.find(c => c.code === continent.code);
      console.log(`  ${continentInfo?.name}: ${avgLatency === Infinity ? 'no data' : avgLatency.toFixed(2) + ' ms'}`);

      return { continent: continent.code, avgLatency };
    })
  );

  const best = measurements
    .filter(m => m.avgLatency !== Infinity)
    .sort((a, b) => a.avgLatency - b.avgLatency)[0];

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

function renderProgressBar(finished: number, total: number, bestCountry?: string, bestLatency?: number): void {
  const percentage = (finished / total) * 100;
  const barLength = 40;
  const filledLength = Math.round((finished / total) * barLength);

  const bar = '█'.repeat(filledLength) + '░'.repeat(barLength - filledLength);
  const percent = percentage.toFixed(1).padStart(5);
  const counts = `${finished}/${total}`.padStart(7);

  let line = `  [${bar}] ${percent}% ${counts}`;

  if (bestCountry && bestLatency !== undefined) {
    line += ` - Best: ${bestCountry} (${bestLatency.toFixed(2)} ms)`;
  }

  process.stdout.write('\r' + line.padEnd(100));
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

  if (!createResult.ok) {
    throw new Error(`Failed to create measurement: ${JSON.stringify(createResult.data)}`);
  }

  const measurementId = createResult.data.id;
  const expectedProbes = createResult.data.probesCount;

  console.log(`  Measuring from ${expectedProbes} probes...\n`);

  let data: any;
  let bestCountry: string | undefined;
  let bestLatency: number | undefined;

  while (true) {
    const result = await client.getMeasurement(measurementId);
    if (!result.ok) {
      throw new Error(`Failed to get measurement: ${JSON.stringify(result.data)}`);
    }

    data = result.data;
    const finishedCount = data.results.filter((r: any) => r.result.status === 'finished').length;

    const tempCountryData = new Map<string, number[]>();
    for (const item of data.results) {
      const latency = extractLatencyFromTraceroute(item.result);
      if (latency !== null) {
        const country = item.probe.country;
        if (!tempCountryData.has(country)) {
          tempCountryData.set(country, []);
        }
        tempCountryData.get(country)!.push(latency);
      }
    }

    if (tempCountryData.size > 0) {
      let minValue = Infinity;
      for (const [country, latencies] of tempCountryData.entries()) {
        const min = Math.min(...latencies);
        if (min < minValue) {
          minValue = min;
          bestCountry = country;
          bestLatency = min;
        }
      }
    }

    renderProgressBar(finishedCount, expectedProbes, bestCountry, bestLatency);

    if (data.status === 'finished') {
      process.stdout.write('\n\n');
      break;
    }

    await sleep(1000);
  }

  const countryData = new Map<string, number[]>();

  for (const item of data.results) {
    const latency = extractLatencyFromTraceroute(item.result);
    if (latency !== null) {
      const country = item.probe.country;
      if (!countryData.has(country)) {
        countryData.set(country, []);
      }
      countryData.get(country)!.push(latency);
    }
  }

  const results: ProbeResult[] = [];
  for (const [country, latencies] of countryData.entries()) {
    const avgLatency = latencies.reduce((a, b) => a + b, 0) / latencies.length;
    const minLatency = Math.min(...latencies);

    results.push({
      country,
      city: '',
      minRtt: minLatency,
      avgRtt: avgLatency,
      probeAsn: 0,
      probeNetwork: ''
    });
  }

  const sortedResults = results.sort((a, b) => a.minRtt - b.minRtt);

  const topCount = Math.min(3, sortedResults.length);
  for (let i = 0; i < topCount; i++) {
    const r = sortedResults[i];
    const { getCountryName } = await import('./countries.js');
    const countryName = getCountryName(r.country);
    console.log(`  ${countryName}: ${r.minRtt.toFixed(2)}ms`);
  }

  if (sortedResults.length > 0) {
    const best = sortedResults[0];
    const { getCountryName } = await import('./countries.js');
    const countryName = getCountryName(best.country);
    console.log(`\nBest country: ${countryName} (${best.minRtt.toFixed(2)}ms)\n`);
  }

  return sortedResults;
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

  if (!createResult.ok) {
    throw new Error(`Failed to create measurement: ${JSON.stringify(createResult.data)}`);
  }

  const measurementId = createResult.data.id;
  const expectedProbes = createResult.data.probesCount;

  console.log(`  Measuring from ${expectedProbes} probes...\n`);

  let data: any;
  let bestCity: string | undefined;
  let bestLatency: number | undefined;

  while (true) {
    const result = await client.getMeasurement(measurementId);
    if (!result.ok) {
      throw new Error(`Failed to get measurement: ${JSON.stringify(result.data)}`);
    }

    data = result.data;
    const finishedCount = data.results.filter((r: any) => r.result.status === 'finished').length;

    const tempCityData = new Map<string, number[]>();
    for (const item of data.results) {
      const latency = extractLatencyFromTraceroute(item.result);
      if (latency !== null) {
        const city = item.probe.city || 'Unknown';
        if (!tempCityData.has(city)) {
          tempCityData.set(city, []);
        }
        tempCityData.get(city)!.push(latency);
      }
    }

    if (tempCityData.size > 0) {
      let minValue = Infinity;
      for (const [city, latencies] of tempCityData.entries()) {
        const min = Math.min(...latencies);
        if (min < minValue) {
          minValue = min;
          bestCity = city;
          bestLatency = min;
        }
      }
    }

    renderProgressBar(finishedCount, expectedProbes, bestCity, bestLatency);

    if (data.status === 'finished') {
      process.stdout.write('\n\n');
      break;
    }

    await sleep(1000);
  }

  const cityData = new Map<string, number[]>();

  for (const item of data.results) {
    const latency = extractLatencyFromTraceroute(item.result);
    if (latency !== null) {
      const city = item.probe.city || 'Unknown';
      if (!cityData.has(city)) {
        cityData.set(city, []);
      }
      cityData.get(city)!.push(latency);
    }
  }

  const results: ProbeResult[] = [];
  for (const [city, latencies] of cityData.entries()) {
    const avgLatency = latencies.reduce((a, b) => a + b, 0) / latencies.length;
    const minLatency = Math.min(...latencies);

    results.push({
      country,
      city,
      minRtt: minLatency,
      avgRtt: avgLatency,
      probeAsn: 0,
      probeNetwork: ''
    });
  }

  return results.sort((a, b) => a.minRtt - b.minRtt);
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

  if (!createResult.ok) {
    throw new Error(`Failed to create measurement: ${JSON.stringify(createResult.data)}`);
  }

  const measurementId = createResult.data.id;
  const expectedProbes = createResult.data.probesCount;

  console.log(`  Measuring from ${expectedProbes} probes...\n`);

  let data: any;
  let bestState: string | undefined;
  let bestLatency: number | undefined;

  while (true) {
    const result = await client.getMeasurement(measurementId);
    if (!result.ok) {
      throw new Error(`Failed to get measurement: ${JSON.stringify(result.data)}`);
    }

    data = result.data;
    const finishedCount = data.results.filter((r: any) => r.result.status === 'finished').length;

    const tempStateData = new Map<string, number[]>();
    for (const item of data.results) {
      const latency = extractLatencyFromTraceroute(item.result);
      if (latency !== null) {
        const state = item.probe.state || 'Unknown';
        if (!tempStateData.has(state)) {
          tempStateData.set(state, []);
        }
        tempStateData.get(state)!.push(latency);
      }
    }

    if (tempStateData.size > 0) {
      let minValue = Infinity;
      for (const [state, latencies] of tempStateData.entries()) {
        const min = Math.min(...latencies);
        if (min < minValue) {
          minValue = min;
          bestState = state;
          bestLatency = min;
        }
      }
    }

    renderProgressBar(finishedCount, expectedProbes, bestState, bestLatency);

    if (data.status === 'finished') {
      process.stdout.write('\n\n');
      break;
    }

    await sleep(1000);
  }

  const stateData = new Map<string, number[]>();

  for (const item of data.results) {
    const latency = extractLatencyFromTraceroute(item.result);
    if (latency !== null) {
      const state = item.probe.state || 'Unknown';
      if (!stateData.has(state)) {
        stateData.set(state, []);
      }
      stateData.get(state)!.push(latency);
    }
  }

  const results: ProbeResult[] = [];
  for (const [state, latencies] of stateData.entries()) {
    const avgLatency = latencies.reduce((a, b) => a + b, 0) / latencies.length;
    const minLatency = Math.min(...latencies);

    results.push({
      country: 'US',
      city: '',
      state,
      minRtt: minLatency,
      avgRtt: avgLatency,
      probeAsn: 0,
      probeNetwork: ''
    });
  }

  const sortedResults = results.sort((a, b) => a.minRtt - b.minRtt);

  const topCount = Math.min(3, sortedResults.length);
  for (let i = 0; i < topCount; i++) {
    const r = sortedResults[i];
    const { getStateName } = await import('./countries.js');
    const stateName = getStateName(r.state!);
    console.log(`  ${stateName}: ${r.minRtt.toFixed(2)}ms`);
  }

  if (sortedResults.length > 0) {
    const best = sortedResults[0];
    const { getStateName } = await import('./countries.js');
    const stateName = getStateName(best.state!);
    console.log(`\nBest state: ${stateName} (${best.minRtt.toFixed(2)}ms)\n`);
  }

  return sortedResults;
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

  if (!createResult.ok) {
    throw new Error(`Failed to create measurement: ${JSON.stringify(createResult.data)}`);
  }

  const measurementId = createResult.data.id;
  const expectedProbes = createResult.data.probesCount;

  console.log(`  Measuring from ${expectedProbes} probes...\n`);

  let data: any;
  let bestCity: string | undefined;
  let bestLatency: number | undefined;

  while (true) {
    const result = await client.getMeasurement(measurementId);
    if (!result.ok) {
      throw new Error(`Failed to get measurement: ${JSON.stringify(result.data)}`);
    }

    data = result.data;
    const finishedCount = data.results.filter((r: any) => r.result.status === 'finished').length;

    const tempCityData = new Map<string, number[]>();
    for (const item of data.results) {
      const latency = extractLatencyFromTraceroute(item.result);
      if (latency !== null) {
        const city = item.probe.city || 'Unknown';
        if (!tempCityData.has(city)) {
          tempCityData.set(city, []);
        }
        tempCityData.get(city)!.push(latency);
      }
    }

    if (tempCityData.size > 0) {
      let minValue = Infinity;
      for (const [city, latencies] of tempCityData.entries()) {
        const min = Math.min(...latencies);
        if (min < minValue) {
          minValue = min;
          bestCity = city;
          bestLatency = min;
        }
      }
    }

    renderProgressBar(finishedCount, expectedProbes, bestCity, bestLatency);

    if (data.status === 'finished') {
      process.stdout.write('\n\n');
      break;
    }

    await sleep(1000);
  }

  const cityData = new Map<string, number[]>();

  for (const item of data.results) {
    const latency = extractLatencyFromTraceroute(item.result);
    if (latency !== null) {
      const city = item.probe.city || 'Unknown';
      if (!cityData.has(city)) {
        cityData.set(city, []);
      }
      cityData.get(city)!.push(latency);
    }
  }

  const results: ProbeResult[] = [];
  for (const [city, latencies] of cityData.entries()) {
    const avgLatency = latencies.reduce((a, b) => a + b, 0) / latencies.length;
    const minLatency = Math.min(...latencies);

    results.push({
      country: 'US',
      city,
      state,
      minRtt: minLatency,
      avgRtt: avgLatency,
      probeAsn: 0,
      probeNetwork: ''
    });
  }

  return results.sort((a, b) => a.minRtt - b.minRtt);
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
