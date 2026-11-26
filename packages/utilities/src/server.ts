import http from 'node:http';
import type { Controller } from './controller.js';
import { loadSettings, normalizeSettings, saveSettings } from './settings.js';
import { UI_HTML } from './ui.js';

export function isLocalHost(hostHeader: string | undefined, port: number): boolean {
  return hostHeader === `127.0.0.1:${port}` || hostHeader === `localhost:${port}`;
}

async function readJson(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  let body = '';
  for await (const chunk of req) {
    body += chunk;
    if (body.length > 64 * 1024) throw new Error('Corpo muito grande');
  }
  return body ? (JSON.parse(body) as Record<string, unknown>) : {};
}

/** UI local (somente 127.0.0.1). Valida Host/Origin contra DNS rebinding e CSRF. */
export function startUiServer(controller: Controller, home: string | undefined, port: number): Promise<http.Server> {
  const send = (res: http.ServerResponse, code: number, body: unknown, type = 'application/json') => {
    res.writeHead(code, { 'Content-Type': `${type}; charset=utf-8`, 'Cache-Control': 'no-store' });
    res.end(type === 'application/json' ? JSON.stringify(body) : String(body));
  };

  const server = http.createServer(async (req, res) => {
    try {
      if (!isLocalHost(req.headers.host, port)) return send(res, 403, { error: 'host inválido' });
      if (req.method === 'POST') {
        const origin = req.headers.origin;
        if (origin && !isLocalHost(origin.replace(/^https?:\/\//, ''), port)) return send(res, 403, { error: 'origem inválida' });
      }
      const url = req.url ?? '/';

      if (req.method === 'GET' && url === '/') return send(res, 200, UI_HTML, 'text/html');
      if (req.method === 'GET' && url === '/api/status') return send(res, 200, controller.status());
      if (req.method === 'GET' && url === '/api/settings') {
        const s = await loadSettings(home);
        return send(res, 200, { baseUrl: s.baseUrl, botName: s.botName, channelIds: s.channelIds, hasApiKey: !!s.apiKey });
      }
      if (req.method === 'POST' && url === '/api/settings') {
        const current = await loadSettings(home);
        const next = normalizeSettings((await readJson(req)) as never, current);
        await saveSettings(next, home);
        return send(res, 200, { ok: true });
      }
      if (req.method === 'POST' && url === '/api/start') {
        const s = await loadSettings(home);
        await controller.stop();
        await controller.start(s);
        return controller.state === 'error' ? send(res, 400, { error: controller.error }) : send(res, 200, { ok: true });
      }
      if (req.method === 'POST' && url === '/api/stop') {
        await controller.stop();
        return send(res, 200, { ok: true });
      }
      send(res, 404, { error: 'não encontrado' });
    } catch (err) {
      send(res, 400, { error: (err as Error).message });
    }
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolve(server));
  });
}
