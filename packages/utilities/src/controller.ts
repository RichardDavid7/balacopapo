import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { MusicBotCommandType, MusicSourceKind, MusicTrack } from '@backspace/shared';
import { BalacopapoApi, RateLimitError, type BotInfo } from './api.js';
import { AudioCache } from './cache.js';
import { LiveKitVoice } from './livekit.js';
import { ChannelPlayer } from './player.js';
import { TrackResolver } from './resolver.js';
import { appDataDir, cacheDir } from './paths.js';
import { buildConfig, type Settings } from './settings.js';
import { ensureTools, type ToolPaths } from './tools.js';

export type RunState = 'stopped' | 'starting' | 'running' | 'error';

function inferSource(url: string): MusicSourceKind {
  const lower = url.toLowerCase();
  if (lower.includes('youtube.com') || lower.includes('youtu.be') || lower.includes('music.youtube.com')) return 'youtube';
  if (lower.includes('navidrome') || lower.includes('/rest/stream')) return 'navidrome';
  if (lower.startsWith('dlna://') || lower.includes(':8200/')) return 'dlna';
  return 'url';
}

/** Ciclo de vida do worker: prepara ferramentas, conecta ao Espaço e mantém o polling dos canais. */
export class Controller {
  state: RunState = 'stopped';
  error: string | null = null;
  info: BotInfo | null = null;
  tools: ToolPaths | null = null;
  readonly logs: string[] = [];
  private players = new Map<string, ChannelPlayer>();
  private cache: AudioCache;
  private loopToken = 0;

  constructor(private readonly home = appDataDir()) {
    this.cache = new AudioCache(cacheDir(home), 2048 * 1024 * 1024);
  }

  log = (msg: string): void => {
    const line = `${new Date().toLocaleTimeString()} ${msg}`;
    this.logs.push(line);
    if (this.logs.length > 200) this.logs.shift();
    console.log(line);
  };

  status() {
    return {
      state: this.state,
      error: this.error,
      space: this.info?.space.name ?? null,
      tools: this.tools,
      channels: (this.info?.voiceChannels ?? []).map((c) => ({
        ...c,
        active: this.players.has(c.id),
        player: this.players.get(c.id)?.snapshot() ?? null,
      })),
      logs: this.logs.slice(-60),
    };
  }

  clearLogs(): void {
    this.logs.length = 0;
  }

  cacheStats(): Promise<{ files: number; bytes: number }> {
    return this.cache.stats();
  }

  async clearCache(): Promise<number> {
    const n = await this.cache.clear();
    this.log(`Cache limpo (${n} arquivo(s) removido(s))`);
    return n;
  }

  /** Testa URL + chave sem iniciar o worker. */
  async test(settings: Settings): Promise<BotInfo> {
    const cfg = buildConfig(settings, { ytdlpPath: '', ffmpegPath: '' }, this.home);
    const info = await new BalacopapoApi(cfg).getInfo();
    if (!info.key.scopes.includes('music')) throw new Error('A chave de API não possui o escopo "music"');
    return info;
  }

  async start(settings: Settings): Promise<void> {
    if (this.state === 'starting' || this.state === 'running') return;
    this.state = 'starting';
    this.error = null;
    try {
      this.tools = await ensureTools(this.home, this.log);
      const cfg = buildConfig(settings, this.tools, this.home);
      const api = new BalacopapoApi(cfg);
      this.cache = new AudioCache(cfg.cacheDir, cfg.cacheMaxBytes);
      await this.cache.init();
      await this.cache.prune();
      const resolver = new TrackResolver(cfg, this.cache);

      this.info = await this.test(settings);
      const channels = this.info.voiceChannels.filter(
        (c) => cfg.channelIds.length === 0 || cfg.channelIds.includes(c.id),
      );
      this.players = new Map(
        channels.map((c) => [c.id, new ChannelPlayer(c.id, cfg, api, resolver, new LiveKitVoice(), this.log)]),
      );
      this.log(`Conectado ao Espaço "${this.info.space.name}" — ${channels.length} canal(is) de voz`);
      this.state = 'running';

      const token = ++this.loopToken;
      void this.pollLoop(token, api);
    } catch (err) {
      this.state = 'error';
      this.error = (err as Error).message;
      this.log(`Erro ao iniciar: ${this.error}`);
    }
  }

  async stop(): Promise<void> {
    this.loopToken++;
    const players = [...this.players.values()];
    this.players = new Map();
    await Promise.allSettled(players.map((p) => p.leave()));
    this.state = 'stopped';
  }

  /** Adiciona uma faixa (URL ou caminho de arquivo local MP3/FLAC/WAV/OGG) pela interface do app. */
  async enqueue(channelId: string, rawUrl: string, title?: string): Promise<void> {
    const player = this.players.get(channelId);
    if (!player) throw new Error('Canal não está ativo no bot');
    const input = rawUrl.trim().replace(/^"(.*)"$/, '$1');
    if (!input) throw new Error('Informe uma URL ou caminho de arquivo');

    const isHttp = /^https?:\/\//i.test(input);
    let resolvedTitle = title?.trim();
    if (!isHttp) {
      const st = await fs.stat(input).catch(() => null);
      if (!st?.isFile()) throw new Error('URL inválida ou arquivo local não encontrado');
      resolvedTitle ||= path.basename(input, path.extname(input));
    }

    const track: MusicTrack = {
      id: crypto.randomBytes(8).toString('hex'),
      title: (resolvedTitle || input).slice(0, 140),
      artist: isHttp ? null : 'Arquivo local',
      source: isHttp ? inferSource(input) : 'url',
      url: input,
      durationSec: null,
      thumbnailUrl: null,
      requestedByUserId: 'local-app',
      requestedByName: 'Balacopapo Utilidades',
      addedAt: Date.now(),
    };

    await player.handleCommand({
      id: crypto.randomBytes(6).toString('hex'),
      channelId,
      type: 'play',
      payload: { track },
      issuedByUserId: 'local-app',
      createdAt: Date.now(),
    });
  }

  /** Salva um arquivo enviado pela UI local (MP3/FLAC/WAV/OGG/OPUS/M4A) no cache e coloca na fila. */
  async enqueueLocalBuffer(channelId: string, filename: string, data: Buffer): Promise<void> {
    const ext = path.extname(filename).toLowerCase().replace(/[^.a-z0-9]/g, '') || '.audio';
    const id = crypto.randomBytes(8).toString('hex');
    await this.cache.init();
    const dest = path.join(this.cache.dir, `local-${id}${ext}`);
    await fs.writeFile(dest, data);
    void this.cache.prune();
    const cleanTitle = path.basename(filename, path.extname(filename)) || filename;
    await this.enqueue(channelId, dest, cleanTitle);
  }

  /** Executa um controle (pause/resume/skip/stop/volume/loop/seek/queue_remove/queue_clear) pela UI local. */
  async control(channelId: string, action: MusicBotCommandType, value?: number | string): Promise<void> {
    const player = this.players.get(channelId);
    if (!player) throw new Error('Canal não está ativo no bot');

    const payload: Record<string, unknown> = {};
    if (action === 'volume' && typeof value === 'number') payload.volume = value;
    if (action === 'loop' && typeof value === 'string') payload.loopMode = value;
    if (action === 'seek' && typeof value === 'number') payload.positionSec = value;
    if (action === 'queue_remove' && typeof value === 'string') payload.trackId = value;

    await player.handleCommand({
      id: crypto.randomBytes(6).toString('hex'),
      channelId,
      type: action,
      payload,
      issuedByUserId: 'local-app',
      createdAt: Date.now(),
    });
  }

  async joinChannel(channelId: string): Promise<void> {
    const player = this.players.get(channelId);
    if (!player) throw new Error('Canal não está ativo no bot');
    await player.join();
  }

  async leaveChannel(channelId: string): Promise<void> {
    const player = this.players.get(channelId);
    if (!player) throw new Error('Canal não está ativo no bot');
    await player.leave();
  }

  private async pollLoop(token: number, api: BalacopapoApi): Promise<void> {
    while (token === this.loopToken) {
      const list = [...this.players.values()];
      let backoffMs = 0;

      for (const player of list) {
        if (token !== this.loopToken) return;
        try {
          const cmds = await api.fetchCommands(player.channelId);
          for (const cmd of cmds) await player.handleCommand(cmd);
          if (player.lastError?.includes('429')) player.lastError = null;
        } catch (err) {
          if (err instanceof RateLimitError) {
            backoffMs = Math.max(backoffMs, (err.retryAfterSec + 1) * 1000);
            this.log(err.message);
            break;
          }
          player.lastError = (err as Error).message;
        }
      }

      if (backoffMs > 0) {
        await new Promise((r) => setTimeout(r, backoffMs));
        continue;
      }

      // Ritmo seguro para não estourar o limite de 200 req/min do IP (compartilhado com o cliente web)
      const anyActive = list.some((p) => p.snapshot().connected);
      const baseMs = anyActive ? 2500 : 4500;
      const waitMs = Math.max(baseMs, list.length * 1500);
      await new Promise((r) => setTimeout(r, waitMs));
    }
  }
}
