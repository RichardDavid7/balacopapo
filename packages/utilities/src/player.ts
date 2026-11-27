import type http from 'node:http';
import type { MusicBotCommand, MusicLoopMode, MusicPlaybackStatus, MusicTrack } from '@backspace/shared';
import type { BalacopapoApi, LivekitCredentials } from './api.js';
import { streamWav } from './audio.js';
import type { UtilitiesConfig } from './config.js';
import { TrackQueue } from './queue.js';
import type { TrackResolver } from './resolver.js';

/**
 * Um player por canal de voz: gerencia fila, resolve áudio (yt-dlp/local/URL),
 * entrega o stream WAV estéreo para a WebView (que publica via livekit-client com forceStereo)
 * e reporta o estado ao servidor Balacopapo.
 */
export class ChannelPlayer {
  readonly queue = new TrackQueue();
  private status: MusicPlaybackStatus = 'idle';
  private volume = 80;
  private positionSec = 0;
  private startSec = 0;
  private generation = 0;
  private resolvedInput: string | null = null;
  private wantConnected = false;
  private connected = false;
  private idleTimer: NodeJS.Timeout | null = null;
  private reportTimer: NodeJS.Timeout | null = null;
  lastError: string | null = null;

  constructor(
    readonly channelId: string,
    private readonly cfg: UtilitiesConfig,
    private readonly api: BalacopapoApi,
    private readonly resolver: TrackResolver,
    private readonly log: (msg: string) => void = console.log,
  ) {}

  snapshot() {
    return {
      channelId: this.channelId,
      wantConnected: this.wantConnected,
      connected: this.connected,
      status: this.status,
      generation: this.generation,
      hasInput: this.resolvedInput !== null,
      startSec: this.startSec,
      currentTrack: this.queue.current,
      title: this.queue.current?.title ?? null,
      artist: this.queue.current?.artist ?? null,
      thumbnailUrl: this.queue.current?.thumbnailUrl ?? null,
      positionSec: Math.floor(this.positionSec),
      durationSec: this.queue.current?.durationSec ?? null,
      queueLength: this.queue.queue.length,
      queue: this.queue.queue,
      volume: this.volume,
      loopMode: this.queue.loopMode,
      lastError: this.lastError,
    };
  }

  // ─── Comandos vindos do servidor ou da UI ────────────────────────────────

  async handleCommand(cmd: MusicBotCommand): Promise<void> {
    const p = cmd.payload ?? {};
    switch (cmd.type) {
      case 'play': {
        const track = p.track as MusicTrack | undefined;
        if (!track?.url) return;
        if (this.queue.add(track)) this.startCurrent(0);
        else this.prefetchNext();
        break;
      }
      case 'pause':
        if (this.queue.current && this.status === 'playing') {
          this.status = 'paused';
        }
        break;
      case 'resume':
        if (this.queue.current && this.status === 'paused') {
          this.status = 'playing';
        }
        break;
      case 'skip': {
        const next = this.queue.advance(typeof p.nextTrackId === 'string' ? p.nextTrackId : undefined);
        if (next) this.startCurrent(0);
        else this.stopPlayback();
        break;
      }
      case 'stop':
        this.queue.stop();
        this.stopPlayback();
        break;
      case 'volume':
        if (typeof p.volume === 'number') this.volume = Math.max(0, Math.min(100, p.volume));
        break;
      case 'loop': {
        const m = p.loopMode;
        this.queue.loopMode = (m === 'track' || m === 'queue' ? m : 'off') as MusicLoopMode;
        break;
      }
      case 'seek':
        if (this.queue.current && typeof p.positionSec === 'number') this.startCurrent(p.positionSec);
        break;
      case 'queue_remove':
        if (typeof p.trackId === 'string') this.queue.remove(p.trackId);
        break;
      case 'queue_clear':
        this.queue.clear();
        break;
    }
    await this.report();
  }

  // ─── Ponte com o WebVoiceEngine (livekit-client na WebView) ──────────────

  async getCredentials(): Promise<LivekitCredentials> {
    return this.api.getLivekitCredentials(this.channelId);
  }

  async onVoiceState(connected: boolean, info?: string): Promise<void> {
    this.connected = connected;
    if (info) this.log(`[${this.channelId}] ${info}`);
    await this.report(connected);
  }

  onPosition(gen: number, sec: number): void {
    if (gen !== this.generation) return;
    if (Number.isFinite(sec) && sec >= 0) this.positionSec = sec;
  }

  async onTrackEnded(gen: number, failed = false): Promise<void> {
    if (gen !== this.generation) return;
    const next = failed && this.queue.loopMode === 'track' ? this.queue.advance() : this.queue.onTrackEnded();
    if (next) {
      this.startCurrent(0);
    } else {
      this.stopPlayback();
    }
    await this.report();
  }

  streamAudio(gen: number, res: http.ServerResponse): void {
    if (gen !== this.generation || !this.resolvedInput) {
      res.writeHead(404);
      res.end();
      return;
    }
    streamWav(this.cfg.ffmpegPath, this.resolvedInput, this.startSec, res, (msg) => {
      this.lastError = msg;
      this.log(`[${this.channelId}] ${msg}`);
    });
  }

  // ─── Reprodução ──────────────────────────────────────────────────────────

  private startCurrent(startSec: number): void {
    const track = this.queue.current;
    if (!track) return;
    const gen = ++this.generation;
    this.resolvedInput = null;
    this.wantConnected = true;
    this.status = 'playing';
    this.startSec = Math.max(0, Math.floor(startSec));
    this.positionSec = this.startSec;
    this.lastError = null;
    this.clearIdleTimer();
    void this.prepareTrack(gen, track);
  }

  private stopPlayback(): void {
    this.generation++;
    this.resolvedInput = null;
    this.status = 'idle';
    this.startSec = 0;
    this.positionSec = 0;
    this.armIdleTimer();
  }

  private prefetchNext(): void {
    const next = this.queue.queue[0];
    if (next) this.resolver.prefetch(next);
  }

  private async prepareTrack(gen: number, track: MusicTrack): Promise<void> {
    try {
      this.log(`[${this.channelId}] resolvendo faixa (${track.source}): ${track.url}`);
      const resolved = await this.resolver.resolve(track);
      if (gen !== this.generation) return;
      if (resolved.meta && this.queue.current?.id === track.id) {
        Object.assign(this.queue.current, {
          title: resolved.meta.title ?? track.title,
          artist: resolved.meta.artist ?? track.artist,
          durationSec: resolved.meta.durationSec ?? track.durationSec,
          thumbnailUrl: resolved.meta.thumbnailUrl ?? track.thumbnailUrl,
        });
      }
      this.resolvedInput = resolved.input;
      this.log(`[${this.channelId}] tocando (48 kHz estéreo): ${this.queue.current?.title ?? track.title}`);
      this.prefetchNext();
      this.startReportTimer(gen);
      await this.report();
    } catch (err) {
      if (gen !== this.generation) return;
      this.lastError = (err as Error).message;
      this.log(`[${this.channelId}] erro ao preparar "${track.title}": ${this.lastError}`);
      await this.onTrackEnded(gen, true);
    }
  }

  // ─── Estado / ciclo de vida ──────────────────────────────────────────────

  private async report(connected?: boolean): Promise<void> {
    try {
      await this.api.reportState(this.channelId, {
        botConnected: connected ?? this.connected,
        botName: this.cfg.botName,
        status: this.status,
        currentTrack: this.queue.current,
        positionSec: Math.floor(this.positionSec),
        volume: this.volume,
        loopMode: this.queue.loopMode,
        queue: this.queue.queue,
      });
    } catch (err) {
      this.log(`[${this.channelId}] falha ao reportar estado: ${(err as Error).message}`);
    }
  }

  private startReportTimer(gen: number): void {
    if (this.reportTimer) clearInterval(this.reportTimer);
    this.reportTimer = setInterval(() => {
      if (gen !== this.generation) {
        if (this.reportTimer) clearInterval(this.reportTimer);
        this.reportTimer = null;
        return;
      }
      void this.report();
    }, 5000);
  }

  private clearIdleTimer(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = null;
  }

  private armIdleTimer(): void {
    this.clearIdleTimer();
    this.idleTimer = setTimeout(() => {
      void this.leave();
    }, this.cfg.idleLeaveSec * 1000);
  }

  async join(): Promise<void> {
    this.lastError = null;
    this.wantConnected = true;
    this.armIdleTimer();
    await this.report(this.connected);
  }

  async leave(): Promise<void> {
    this.clearIdleTimer();
    if (this.reportTimer) clearInterval(this.reportTimer);
    this.reportTimer = null;
    this.generation++;
    this.resolvedInput = null;
    this.wantConnected = false;
    this.connected = false;
    this.status = 'idle';
    await this.report(false);
  }
}
