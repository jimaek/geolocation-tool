#!/usr/bin/env node

import { Globalping } from 'globalping';
import { runMeasurements } from './measure.js';
import { analyzeResults } from './analyze.js';
import { getCountryName, getCountryContinent, getStateName } from './countries.js';

function printUsage() {
  console.log('Usage: geolocate <IP_ADDRESS> [OPTIONS]');
  console.log('\nGeolocate an IP address using latency measurements from probes worldwide.');
  console.log('\nOptions:');
  console.log('  -L, --limit <number>  Number of probes per measurement (default: 50)');
  console.log('\nEnvironment Variables:');
  console.log('  GLOBALPING_TOKEN      Optional token for higher rate limits');
  console.log('                        Get your token at: https://dash.globalping.io');
}

function isValidIp(ip: string): boolean {
  const ipv4 = /^(\d{1,3}\.){3}\d{1,3}$/;
  const ipv6 = /^([0-9a-fA-F]{0,4}:){2,7}[0-9a-fA-F]{0,4}$/;
  return ipv4.test(ip) || ipv6.test(ip);
}

function printResults(results: any[]) {
  if (results.length === 0) {
    console.log('No results to display');
    return;
  }

  const best = results[0];
  const isUS = best.country === 'US';

  console.log('Top 3 Locations:');
  console.log('─────────────────────────────────────────────────');

  const topCount = Math.min(3, results.length);
  for (let i = 0; i < topCount; i++) {
    const r = results[i];
    const num = `${i + 1}.`;

    let location;
    if (isUS) {
      const city = r.city || 'Unknown';
      const stateName = getStateName(r.state || 'Unknown');
      location = `${city}, ${stateName}, USA`.padEnd(40);
    } else {
      const city = r.city || 'Unknown';
      const countryName = getCountryName(r.country);
      location = `${city}, ${countryName}`.padEnd(40);
    }

    const latency = `${r.minRtt.toFixed(2)} ms`;
    console.log(`  ${num} ${location} ${latency}`);
  }

  console.log('\n═══════════════════════════════════════════════════');
  console.log('                      SUMMARY');
  console.log('═══════════════════════════════════════════════════');

  if (isUS) {
    const city = best.city || 'Unknown';
    const stateName = getStateName(best.state);
    console.log(`  Location: ${city}, ${stateName}, United States`);
  } else {
    const city = best.city || 'Unknown';
    const countryName = getCountryName(best.country);
    const continent = getCountryContinent(best.country) || 'Unknown';
    console.log(`  Location: ${city}, ${countryName}, ${continent}`);
  }

  console.log(`  Minimum Latency: ${best.minRtt.toFixed(2)} ms`);

  if (best.minRtt < 1) {
    console.log(`  Confidence: Very High`);
  } else if (best.minRtt < 5) {
    console.log(`  Confidence: High`);
  } else if (best.minRtt < 20) {
    console.log(`  Confidence: Medium`);
  } else {
    console.log(`  Confidence: Low`);
  }

  console.log('═══════════════════════════════════════════════════');
}

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    printUsage();
    process.exit(args.length > 0 ? 0 : 1);
  }

  let ip = '';
  let limit = 50;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === '-L' || arg === '--limit') {
      const limitValue = args[i + 1];
      if (!limitValue || isNaN(Number(limitValue))) {
        console.error('Error: --limit requires a numeric value');
        process.exit(1);
      }
      limit = Number(limitValue);
      i++;
    } else if (!arg.startsWith('-')) {
      ip = arg;
    }
  }

  if (!ip) {
    console.error('Error: IP address is required');
    printUsage();
    process.exit(1);
  }

  if (!isValidIp(ip)) {
    console.error(`Error: Invalid IP address: ${ip}`);
    process.exit(1);
  }

  const token = process.env.GLOBALPING_TOKEN;
  const client = new Globalping({
    auth: token,
    timeout: 60000
  });

  console.log(`Geolocating ${ip}...\n`);

  try {
    const results = await runMeasurements(client, ip, limit);
    printResults(results);
    process.exit(0);
  } catch (error: any) {
    console.error(`\nError: ${error.message}`);
    process.exit(1);
  }
}

main();
