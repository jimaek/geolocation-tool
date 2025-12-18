import { WebSocketServer, WebSocket } from 'ws';
import { Globalping } from 'globalping';
import { Jimp } from 'jimp';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { runMeasurements, Writer, ProbeResult } from '../../src/measure.js';
import { getCountryName, getCountryContinent, getStateName } from '../../src/countries.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const PORT = Number(process.env.PORT) || 8080;
const TOKEN = process.env.GLOBALPING_TOKEN || '';
const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 250;

const LOGO_PATH = join(__dirname, '../../assets/logo.png');
const LOGO_WIDTH = 60;
const BG_COLOR = { r: 15, g: 15, b: 26 }; // Match terminal background

let logoArt = '';

async function renderLogo(): Promise<string> {
  try {
    const image = await Jimp.read(LOGO_PATH);
    image.resize({ w: LOGO_WIDTH });

    const width = image.width;
    const height = image.height;
    let output = '\r\n';

    for (let y = 0; y < height; y += 2) {
      for (let x = 0; x < width; x++) {
        const topColor = image.getPixelColor(x, y);
        const botColor = (y + 1 < height) ? image.getPixelColor(x, y + 1) : 0x00000000;

        const top = {
          r: (topColor >> 24) & 0xFF,
          g: (topColor >> 16) & 0xFF,
          b: (topColor >> 8) & 0xFF,
          a: topColor & 0xFF
        };
        const bot = {
          r: (botColor >> 24) & 0xFF,
          g: (botColor >> 16) & 0xFF,
          b: (botColor >> 8) & 0xFF,
          a: botColor & 0xFF
        };

        const blend = (c: typeof top) => {
          const alpha = c.a / 255;
          return {
            r: Math.round(c.r * alpha + BG_COLOR.r * (1 - alpha)),
            g: Math.round(c.g * alpha + BG_COLOR.g * (1 - alpha)),
            b: Math.round(c.b * alpha + BG_COLOR.b * (1 - alpha))
          };
        };

        const fg = blend(top);
        const bg = blend(bot);

        output += `\x1b[38;2;${fg.r};${fg.g};${fg.b}m\x1b[48;2;${bg.r};${bg.g};${bg.b}m▀`;
      }
      output += '\x1b[0m\r\n';
    }

    return output;
  } catch (err) {
    console.error('Failed to render logo:', err);
    return '';
  }
}

const WELCOME = `
IP Geolocation Tool
───────────────────────────────────────────────────
Locate any IP address using global latency measurements.

Usage: <IP_ADDRESS> [-L <limit>]
  -L, --limit   Number of probes (default: ${DEFAULT_LIMIT}, max: ${MAX_LIMIT})

Examples:
  8.8.8.8
  1.1.1.1 -L 200

Type an IP address to begin.
───────────────────────────────────────────────────

`;

const PROMPT = 'geolocate> ';

function isValidIp(ip: string): boolean {
  const ipv4 = /^(\d{1,3}\.){3}\d{1,3}$/;
  const ipv6 = /^([0-9a-fA-F]{0,4}:){2,7}[0-9a-fA-F]{0,4}$/;
  return ipv4.test(ip) || ipv6.test(ip);
}

function formatLocation(result: ProbeResult): string {
  const city = result.city || 'Unknown';
  if (result.country === 'US') {
    const stateName = getStateName(result.state || 'Unknown');
    return `${city}, ${stateName}, USA`;
  }
  const countryName = getCountryName(result.country);
  return `${city}, ${countryName}`;
}

function printResults(results: ProbeResult[], out: Writer) {
  if (results.length === 0) {
    out.writeLine('No results to display');
    return;
  }

  const best = results[0];
  const isUS = best.country === 'US';

  out.writeLine('Top 3 Locations:');
  out.writeLine('─────────────────────────────────────────────────');

  const topCount = Math.min(3, results.length);
  for (let i = 0; i < topCount; i++) {
    const r = results[i];
    const num = `${i + 1}.`;
    const location = formatLocation(r).padEnd(40);
    const latency = `${r.minRtt.toFixed(2)} ms`;
    out.writeLine(`  ${num} ${location} ${latency}`);
  }

  out.writeLine('');
  out.writeLine('═══════════════════════════════════════════════════');
  out.writeLine('                      SUMMARY');
  out.writeLine('═══════════════════════════════════════════════════');

  const location = formatLocation(best);
  if (isUS) {
    out.writeLine(`  Location: ${location}`);
  } else {
    const continent = getCountryContinent(best.country) || 'Unknown';
    out.writeLine(`  Location: ${location}, ${continent}`);
  }

  out.writeLine(`  Minimum Latency: ${best.minRtt.toFixed(2)} ms`);

  if (best.minRtt < 1) {
    out.writeLine('  Confidence: Very High');
  } else if (best.minRtt < 5) {
    out.writeLine('  Confidence: High');
  } else if (best.minRtt < 20) {
    out.writeLine('  Confidence: Medium');
  } else {
    out.writeLine('  Confidence: Low');
  }

  out.writeLine('═══════════════════════════════════════════════════');
}

function parseInput(input: string): { ip: string; limit: number } | { error: string } {
  const parts = input.trim().split(/\s+/);
  if (parts.length === 0 || !parts[0]) {
    return { error: 'Please enter an IP address' };
  }

  const ip = parts[0];
  if (!isValidIp(ip)) {
    return { error: `Invalid IP address: ${ip}` };
  }

  let limit = DEFAULT_LIMIT;
  for (let i = 1; i < parts.length; i++) {
    if (parts[i] === '-L' || parts[i] === '--limit') {
      const val = Number(parts[i + 1]);
      if (isNaN(val) || val < 1) {
        return { error: 'Invalid limit value' };
      }
      limit = Math.min(val, MAX_LIMIT);
      i++;
    }
  }

  return { ip, limit };
}

function createWriter(ws: WebSocket): Writer {
  return {
    write: (text) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(text);
      }
    },
    writeLine: (text) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(text + '\r\n');
      }
    }
  };
}

async function handleCommand(ws: WebSocket, input: string) {
  const out = createWriter(ws);
  const parsed = parseInput(input);

  if ('error' in parsed) {
    out.writeLine(`Error: ${parsed.error}`);
    out.write(PROMPT);
    return;
  }

  const { ip, limit } = parsed;
  out.writeLine(`Geolocating ${ip}...\n`);

  const client = new Globalping({
    auth: TOKEN || undefined,
    timeout: 60000
  });

  try {
    const results = await runMeasurements(client, ip, limit, false, out);
    if (results.length > 0 && !results[0].isAnycast) {
      printResults(results, out);
    }
  } catch (err: any) {
    out.writeLine(`\nError: ${err.message}`);
  }

  out.writeLine('');
  out.write(PROMPT);
}

async function startServer() {
  logoArt = await renderLogo();
  console.log('Logo rendered');

  const wss = new WebSocketServer({ port: PORT });

  wss.on('connection', (ws) => {
    let inputBuffer = '';
    let busy = false;

    if (logoArt) {
      ws.send(logoArt);
    }
    ws.send(WELCOME);
    ws.send(PROMPT);

    ws.on('message', async (data) => {
      if (busy) return;

      const chunk = data.toString();

      for (const char of chunk) {
        if (char === '\r' || char === '\n') {
          if (inputBuffer.trim()) {
            busy = true;
            const cmd = inputBuffer;
            inputBuffer = '';
            await handleCommand(ws, cmd);
            busy = false;
          } else {
            ws.send('\r\n' + PROMPT);
          }
        } else if (char === '\x7f' || char === '\b') {
          if (inputBuffer.length > 0) {
            inputBuffer = inputBuffer.slice(0, -1);
            ws.send('\b \b');
          }
        } else if (char >= ' ') {
          inputBuffer += char;
          ws.send(char);
        }
      }
    });

    ws.on('close', () => {
      inputBuffer = '';
    });
  });

  console.log(`WebSocket server listening on port ${PORT}`);
}

startServer();
