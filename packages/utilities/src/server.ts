import http from 'node:http';
import type { MusicBotCommandType } from '@backspace/shared';
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
        if (origin && !isLocalHost(origin.replace(/^https?:\/\//, ''), port)) {
          return send(res, 403, { error: 'origem inválida' });
        }
      }
      const url = (req.url ?? '/').split('?')[0] ?? '/';

      if (req.method === 'GET' && url === '/') return send(res, 200, UI_HTML, 'text/html');
      if (req.method === 'GET' && url === '/api/status') return send(res, 200, controller.status());
      if (req.method === 'GET' && url === '/api/cache') return send(res, 200, await controller.cacheStats());
      if (req.method === 'POST' && url === '/api/cache/clear') {
        return send(res, 200, { removed: await controller.clearCache() });
      }
      if (req.method === 'POST' && url === '/api/logs/clear') {
        controller.clearLogs();
        return send(res, 200, { ok: true });
      }
      if (req.method === 'GET' && url === '/api/settings') {
        const s = await loadSettings(home);
        return send(res, 200, {
          baseUrl: s.baseUrl,
          botName: s.botName,
          channelIds: s.channelIds,
          cacheMaxMb: s.cacheMaxMb,
          idleLeaveSec: s.idleLeaveSec,
          hasApiKey: !!s.apiKey,
        });
      }
      if (req.method === 'POST' && url === '/api/settings') {
        const current = await loadSettings(home);
        const next = normalizeSettings((await readJson(req)) as never, current);
        await saveSettings(next, home);
        return send(res, 200, { ok: true });
      }
      if (req.method === 'POST' && url === '/api/test') {
        const current = await loadSettings(home);
        const merged = normalizeSettings((await readJson(req)) as never, current);
        const info = await controller.test(merged);
        return send(res, 200, info);
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

      const enqueueMatch = req.method === 'POST' && url.match(/^\/api\/channels\/([^/]+)\/enqueue$/);
      if (enqueueMatch && enqueueMatch[1]) {
        const body = await readJson(req);
        await controller.enqueue(
          decodeURIComponent(enqueueMatch[1]),
          typeof body.url === 'string' ? body.url : '',
          typeof body.title === 'string' ? body.title : undefined,
        );
        return send(res, 200, { ok: true });
      }

      const joinMatch = req.method === 'POST' && url.match(/^\/api\/channels\/([^/]+)\/join$/);
      if (joinMatch && joinMatch[1]) {
        await controller.joinChannel(decodeURIComponent(joinMatch[1]));
        return send(res, 200, { ok: true });
      }

      const leaveMatch = req.method === 'POST' && url.match(/^\/api\/channels\/([^/]+)\/leave$/);
      if (leaveMatch && leaveMatch[1]) {
        await controller.leaveChannel(decodeURIComponent(leaveMatch[1]));
        return send(res, 200, { ok: true });
      }

      const controlMatch = req.method === 'POST' && url.match(/^\/api\/channels\/([^/]+)\/control$/);
      if (controlMatch && controlMatch[1]) {
        const body = await readJson(req);
        const action = body.action as MusicBotCommandType;
        const value = typeof body.value === 'number' || typeof body.value === 'string' ? body.value : undefined;
        await controller.control(decodeURIComponent(controlMatch[1]), action, value);
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
