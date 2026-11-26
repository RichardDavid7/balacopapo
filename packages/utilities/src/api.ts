import type { MusicBotCommand, MusicPlayerState, MusicTrack, MusicLoopMode, MusicPlaybackStatus } from '@backspace/shared';
import type { UtilitiesConfig } from './config.js';

export interface BotInfo {
  space: { id: string; name: string };
  key: { id: string; name: string; scopes: string[] };
  voiceChannels: { id: string; name: string }[];
}

export interface LivekitCredentials {
  token: string;
  url: string;
  room: string;
}

export interface BotStateReport {
  botConnected?: boolean;
  botName?: string;
  status?: MusicPlaybackStatus;
  currentTrack?: MusicTrack | null;
  positionSec?: number;
  volume?: number;
  loopMode?: MusicLoopMode;
  queue?: MusicTrack[];
}

export class RateLimitError extends Error {
  constructor(readonly retryAfterSec: number, message: string) {
    super(message);
    this.name = 'RateLimitError';
  }
}

export class BalacopapoApi {
  constructor(private readonly cfg: UtilitiesConfig) {}

  private async request<T>(method: string, route: string, body?: unknown): Promise<T> {
    const fullUrl = `${this.cfg.baseUrl}${route}`;
    const res = await fetch(fullUrl, {
      method,
      headers: {
        'X-Api-Key': this.cfg.apiKey,
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(15_000),
    });
    const text = await res.text();
    if (res.status === 429) {
      let retryAfter = Number(res.headers.get('retry-after')) || 10;
      try {
        const parsed = JSON.parse(text) as { retryAfter?: number };
        if (typeof parsed.retryAfter === 'number' && parsed.retryAfter > 0) retryAfter = parsed.retryAfter;
      } catch {
        /* ignore */
      }
      throw new RateLimitError(retryAfter, `Rate limit (429) — aguardando ${retryAfter}s`);
    }
    if (!res.ok) {
      throw new Error(`${method} ${route} → HTTP ${res.status}${text && !text.startsWith('<') ? `: ${text.slice(0, 120)}` : ''}`);
    }
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new Error(
        `A instância respondeu HTML em vez de JSON em ${route} — verifique se a URL (${this.cfg.baseUrl}) está correta e se o servidor Balacopapo está atualizado com a API de música.`,
      );
    }
  }

  getInfo(): Promise<BotInfo> {
    return this.request('GET', '/api/spaces/bot/info');
  }

  async fetchCommands(channelId: string): Promise<MusicBotCommand[]> {
    const r = await this.request<{ commands: MusicBotCommand[] }>('GET', `/api/music/bot/${channelId}/commands`);
    return r.commands;
  }

  reportState(channelId: string, report: BotStateReport): Promise<MusicPlayerState> {
    return this.request('POST', `/api/music/bot/${channelId}/state`, report);
  }

  getLivekitCredentials(channelId: string): Promise<LivekitCredentials> {
    return this.request('POST', `/api/music/bot/${channelId}/livekit-token`, { botName: this.cfg.botName });
  }
}
