import { Container, getContainer } from '@cloudflare/containers';

export class GeolocateContainer extends Container {
  defaultPort = 8080;
  sleepAfter = '15m';

  override getEnv() {
    return {
      GLOBALPING_TOKEN: this.ctx.env.GLOBALPING_TOKEN || ''
    };
  }
}

export class RateLimiter {
  state: DurableObjectState;
  sessions: Map<string, { timestamp: number; id: string }>;

  constructor(state: DurableObjectState) {
    this.state = state;
    this.sessions = new Map();
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const ip = url.searchParams.get('ip') || 'unknown';
    const action = url.searchParams.get('action');
    const sessionId = url.searchParams.get('session') || '';

    if (action === 'acquire') {
      const existing = this.sessions.get(ip);
      const now = Date.now();

      if (existing) {
        if (now - existing.timestamp < 30000 && existing.id !== sessionId) {
          return new Response('rate_limited', { status: 429 });
        }
      }

      this.sessions.set(ip, { timestamp: now, id: sessionId });
      return new Response('ok');
    }

    if (action === 'release') {
      const existing = this.sessions.get(ip);
      if (!existing || existing.id === sessionId) {
        this.sessions.delete(ip);
      }
      return new Response('ok');
    }

    return new Response('invalid action', { status: 400 });
  }
}

interface Env {
  GEOLOCATE_CONTAINER: DurableObjectNamespace;
  RATE_LIMITER: DurableObjectNamespace;
  GLOBALPING_TOKEN: string;
}

async function checkRateLimit(env: Env, ip: string, sessionId: string): Promise<boolean> {
  const id = env.RATE_LIMITER.idFromName('global');
  const stub = env.RATE_LIMITER.get(id);
  const response = await stub.fetch(`http://rate-limiter/?ip=${encodeURIComponent(ip)}&session=${encodeURIComponent(sessionId)}&action=acquire`);
  return response.status === 200;
}

async function releaseRateLimit(env: Env, ip: string, sessionId: string): Promise<void> {
  const id = env.RATE_LIMITER.idFromName('global');
  const stub = env.RATE_LIMITER.get(id);
  await stub.fetch(`http://rate-limiter/?ip=${encodeURIComponent(ip)}&session=${encodeURIComponent(sessionId)}&action=release`);
}

function getClientIp(request: Request): string {
  return request.headers.get('cf-connecting-ip') ||
         request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
         'unknown';
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/' || url.pathname === '/index.html') {
      return new Response(HTML_PAGE, {
        headers: { 'Content-Type': 'text/html' }
      });
    }

    if (url.pathname === '/ws') {
      const upgradeHeader = request.headers.get('Upgrade');
      if (upgradeHeader !== 'websocket') {
        return new Response('Expected WebSocket', { status: 426 });
      }

      const ip = getClientIp(request);
      const sessionId = url.searchParams.get('session') || '';

      if (!sessionId) {
        return new Response('Session ID required', { status: 400 });
      }

      const allowed = await checkRateLimit(env, ip, sessionId);

      if (!allowed) {
        return new Response('Rate limited: only one active session per IP allowed', { status: 429 });
      }

      const container = getContainer(env.GEOLOCATE_CONTAINER);
      const response = await container.fetch(request);

      if (response.status !== 101) {
        await releaseRateLimit(env, ip, sessionId);
      }

      return response;
    }

    if (url.pathname === '/release') {
      const ip = getClientIp(request);
      const sessionId = url.searchParams.get('session') || '';
      if (sessionId) {
        await releaseRateLimit(env, ip, sessionId);
      }
      return new Response('ok');
    }

    return new Response('Not found', { status: 404 });
  }
};

const HTML_PAGE = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>IP Geolocation Tool</title>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@xterm/xterm@5.5.0/css/xterm.min.css">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      background: #1a1a2e;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      font-family: system-ui, sans-serif;
      padding: 20px;
    }
    h1 {
      color: #eee;
      margin-bottom: 20px;
      font-weight: 400;
    }
    #terminal-container {
      width: 100%;
      max-width: 900px;
      height: 600px;
      background: #0f0f1a;
      border-radius: 8px;
      padding: 10px;
      box-shadow: 0 4px 20px rgba(0,0,0,0.5);
    }
    #terminal { height: 100%; }
    .status {
      color: #888;
      margin-top: 10px;
      font-size: 14px;
    }
  </style>
</head>
<body>
  <h1>IP Geolocation Tool</h1>
  <div id="terminal-container">
    <div id="terminal"></div>
  </div>
  <p class="status" id="status">Connecting...</p>

  <script src="https://cdn.jsdelivr.net/npm/@xterm/xterm@5.5.0/lib/xterm.min.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/@xterm/addon-fit@0.10.0/lib/addon-fit.min.js"></script>
  <script>
    const sessionId = Math.random().toString(36).substring(2) + Date.now().toString(36);

    const term = new Terminal({
      cursorBlink: true,
      fontSize: 14,
      fontFamily: 'Menlo, Monaco, "Courier New", monospace',
      theme: {
        background: '#0f0f1a',
        foreground: '#e0e0e0',
        cursor: '#e0e0e0'
      }
    });

    const fitAddon = new FitAddon.FitAddon();
    term.loadAddon(fitAddon);
    term.open(document.getElementById('terminal'));
    fitAddon.fit();

    window.addEventListener('resize', () => fitAddon.fit());

    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(protocol + '//' + location.host + '/ws?session=' + sessionId);
    const status = document.getElementById('status');

    ws.onopen = () => {
      status.textContent = 'Connected';
      status.style.color = '#4a4';
    };

    ws.onmessage = (event) => {
      term.write(event.data);
    };

    ws.onclose = () => {
      status.textContent = 'Disconnected';
      status.style.color = '#a44';
      term.write('\\r\\n\\r\\n[Connection closed]\\r\\n');
      releaseSession();
    };

    ws.onerror = () => {
      status.textContent = 'Connection error';
      status.style.color = '#a44';
    };

    term.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(data);
      }
    });

    function releaseSession() {
      if (navigator.sendBeacon) {
        navigator.sendBeacon('/release?session=' + sessionId);
      } else {
        fetch('/release?session=' + sessionId, { method: 'POST', keepalive: true }).catch(() => {});
      }
    }

    window.addEventListener('beforeunload', releaseSession);
  </script>
</body>
</html>`;
