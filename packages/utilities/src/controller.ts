import { BalacopapoApi, type BotInfo } from './api.js';
import { AudioCache } from './cache.js';
import { LiveKitVoice } from './livekit.js';
import { ChannelPlayer } from './player.js';
import { TrackResolver } from './resolver.js';
import { appDataDir } from './paths.js';
import { buildConfig, type Settings } from './settings.js';
import { ensureTools } from './tools.js';

export type RunState = 'stopped' | 'starting' | 'running' | 'error';

/** Ciclo de vida do worker: prepara ferramentas, conecta ao Grupo e mantém o polling dos canais. */
export class Controller {
  state: RunState = 'stopped';
  error: string | null = null;
  info: BotInfo | null = null;
  readonly logs: string[] = [];
  private players = new Map<string, ChannelPlayer>();
  private loopToken = 0;

  constructor(private readonly home = appDataDir()) {}

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
      group: this.info?.space.name ?? null,
      channels: (this.info?.voiceChannels ?? []).map((c) => ({
        ...c,
        player: this.players.get(c.id)?.snapshot() ?? null,
      })),
      logs: this.logs.slice(-40),
    };
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
      const tools = await ensureTools(this.home, this.log);
      const cfg = buildConfig(settings, tools, this.home);
      const api = new BalacopapoApi(cfg);
      const cache = new AudioCache(cfg.cacheDir, cfg.cacheMaxBytes);
      await cache.init();
      await cache.prune();
      const resolver = new TrackResolver(cfg, cache);

      this.info = await this.test(settings);
      const channels = this.info.voiceChannels.filter(
        (c) => cfg.channelIds.length === 0 || cfg.channelIds.includes(c.id),
      );
      this.players = new Map(
        channels.map((c) => [c.id, new ChannelPlayer(c.id, cfg, api, resolver, new LiveKitVoice(), this.log)]),
      );
      this.log(`Conectado ao Grupo "${this.info.space.name}" — ${channels.length} canal(is) de voz`);
      this.state = 'running';

      const token = ++this.loopToken;
      void this.pollLoop(token, api, cfg.pollIntervalMs);
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

  private async pollLoop(token: number, api: BalacopapoApi, intervalMs: number): Promise<void> {
    while (token === this.loopToken) {
      await Promise.all(
        [...this.players.values()].map(async (player) => {
          try {
            for (const cmd of await api.fetchCommands(player.channelId)) await player.handleCommand(cmd);
          } catch (err) {
            player.lastError = (err as Error).message;
          }
        }),
      );
      await new Promise((r) => setTimeout(r, intervalMs));
    }
  }
}
