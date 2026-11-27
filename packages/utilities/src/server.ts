import fs from 'node:fs/promises';
import http from 'node:http';
import { createRequire } from 'node:module';
import path from 'node:path';
import type { MusicBotCommandType } from '@backspace/shared';
import type { Controller } from './controller.js';
import { loadSettings, normalizeSettings, saveSettings } from './settings.js';
import { UI_HTML } from './ui.js';

const require = createRequire(import.meta.url);
let livekitBundleCache: string | null = null;

async function getLivekitBundle(): Promise<string> {
  if (!livekitBundleCache) {
    const p = path.join(path.dirname(require.resolve('livekit-client')), 'livekit-client.umd.js');
    livekitBundleCache = await fs.readFile(p, 'utf8');
  }
  return livekitBundleCache;
}

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
      const parsedUrl = new URL(req.url ?? '/', `http://127.0.0.1:${port}`);
      const url = parsedUrl.pathname;

      if (req.method === 'GET' && url === '/') return send(res, 200, UI_HTML, 'text/html');
      if (req.method === 'GET' && url === '/livekit-client.js') {
        return send(res, 200, await getLivekitBundle(), 'application/javascript');
      }
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
          botAvatarUrl: s.botAvatarUrl,
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

      // ─── Streaming WAV estéreo + bridge WebView ↔ LiveKit ────────────────
      const streamMatch = req.method === 'GET' && url.match(/^\/api\/channels\/([^/]+)\/stream$/);
      if (streamMatch && streamMatch[1]) {
        const gen = Number(parsedUrl.searchParams.get('gen')) || 0;
        controller.streamAudio(decodeURIComponent(streamMatch[1]), gen, res);
        return;
      }

      const lkTokenMatch = req.method === 'POST' && url.match(/^\/api\/channels\/([^/]+)\/lk-token$/);
      if (lkTokenMatch && lkTokenMatch[1]) {
        const creds = await controller.getCredentials(decodeURIComponent(lkTokenMatch[1]));
        return send(res, 200, creds);
      }

      const voiceStateMatch = req.method === 'POST' && url.match(/^\/api\/channels\/([^/]+)\/voice-state$/);
      if (voiceStateMatch && voiceStateMatch[1]) {
        const body = await readJson(req);
        await controller.setVoiceState(
          decodeURIComponent(voiceStateMatch[1]),
          Boolean(body.connected),
          typeof body.info === 'string' ? body.info : undefined,
        );
        return send(res, 200, { ok: true });
      }

      const endedMatch = req.method === 'POST' && url.match(/^\/api\/channels\/([^/]+)\/ended$/);
      if (endedMatch && endedMatch[1]) {
        const body = await readJson(req);
        await controller.onTrackEnded(
          decodeURIComponent(endedMatch[1]),
          Number(body.gen) || 0,
          Boolean(body.failed),
        );
        return send(res, 200, { ok: true });
      }

      const posMatch = req.method === 'POST' && url.match(/^\/api\/channels\/([^/]+)\/position$/);
      if (posMatch && posMatch[1]) {
        const body = await readJson(req);
        controller.onPosition(decodeURIComponent(posMatch[1]), Number(body.gen) || 0, Number(body.positionSec) || 0);
        return send(res, 200, { ok: true });
      }

      const uploadMatch = req.method === 'POST' && url.match(/^\/api\/channels\/([^/]+)\/upload$/);
      if (uploadMatch && uploadMatch[1]) {
        const rawName = req.headers['x-file-name'];
        const filename = typeof rawName === 'string' && rawName ? decodeURIComponent(rawName) : 'audio.bin';
        const chunks: Buffer[] = [];
        let total = 0;
        const maxBytes = 250 * 1024 * 1024;
        for await (const chunk of req) {
          const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          total += buf.length;
          if (total > maxBytes) throw new Error('Arquivo muito grande (máx. 250 MB)');
          chunks.push(buf);
        }
        await controller.enqueueLocalBuffer(decodeURIComponent(uploadMatch[1]), filename, Buffer.concat(chunks));
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
