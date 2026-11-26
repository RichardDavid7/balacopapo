import type { MusicBotCommand, MusicLoopMode, MusicPlaybackStatus, MusicTrack } from '@backspace/shared';
import type { BalacopapoApi } from './api.js';
import { applyGain, decode } from './audio.js';
import type { UtilitiesConfig } from './config.js';
import type { AudioSink } from './livekit.js';
import { TrackQueue } from './queue.js';
import type { TrackResolver } from './resolver.js';

export interface VoiceConnection extends AudioSink {
  readonly connected: boolean;
  connect(url: string, token: string): Promise<void>;
  disconnect(): Promise<void>;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Um player por canal de voz: aplica comandos, toca a faixa atual e reporta o estado ao servidor. */
export class ChannelPlayer {
  readonly queue = new TrackQueue();
  private status: MusicPlaybackStatus = 'idle';
  private volume = 80;
  private positionSec = 0;
  private paused = false;
  /** Incrementa a cada (re)início/cancelamento; loops antigos se encerram sozinhos. */
  private generation = 0;
  private idleTimer: NodeJS.Timeout | null = null;
  private reportTimer: NodeJS.Timeout | null = null;
  private decoderKill: (() => void) | null = null;

  constructor(
    readonly channelId: string,
    private readonly cfg: UtilitiesConfig,
    private readonly api: BalacopapoApi,
    private readonly resolver: TrackResolver,
    private readonly voice: VoiceConnection,
    private readonly log: (msg: string) => void = console.log,
  ) {}

  lastError: string | null = null;

  snapshot() {
    return {
      channelId: this.channelId,
      connected: this.voice.connected,
      status: this.status,
      title: this.queue.current?.title ?? null,
      artist: this.queue.current?.artist ?? null,
      positionSec: Math.floor(this.positionSec),
      durationSec: this.queue.current?.durationSec ?? null,
      queueLength: this.queue.queue.length,
      volume: this.volume,
      lastError: this.lastError,
    };
  }

  // ─── Comandos vindos do servidor ─────────────────────────────────────────

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
        if (this.queue.current && !this.paused) {
          this.paused = true;
          this.status = 'paused';
          this.voice.clear();
        }
        break;
      case 'resume':
        if (this.queue.current && this.paused) {
          this.paused = false;
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

  // ─── Reprodução ──────────────────────────────────────────────────────────

  private startCurrent(startSec: number): void {
    const track = this.queue.current;
    if (!track) return;
    const gen = ++this.generation;
    this.decoderKill?.();
    this.voice.clear();
    this.paused = false;
    this.status = 'playing';
    this.positionSec = startSec;
    this.clearIdleTimer();
    void this.playLoop(gen, track, startSec);
  }

  private stopPlayback(): void {
    this.generation++;
    this.decoderKill?.();
    this.voice.clear();
    this.paused = false;
    this.status = 'idle';
    this.positionSec = 0;
    this.armIdleTimer();
  }

  private prefetchNext(): void {
    const next = this.queue.queue[0];
    if (next) this.resolver.prefetch(next);
  }

  private async playLoop(gen: number, track: MusicTrack, startSec: number): Promise<void> {
    let failed = false;
    try {
      if (!this.voice.connected) {
        const creds = await this.api.getLivekitCredentials(this.channelId);
        if (gen !== this.generation) return;
        await this.voice.connect(creds.url, creds.token);
        this.log(`[${this.channelId}] conectado à sala ${creds.room}`);
      }
      await this.report(true);

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
      this.prefetchNext();
      void this.report();
      this.startReportTimer(gen);

      const decoder = decode(this.cfg.ffmpegPath, resolved.input, startSec);
      this.decoderKill = decoder.kill;

      let sentMs = 0;
      let base = Date.now();
      for await (const frame of decoder.frames) {
        if (gen !== this.generation) return;
        if (this.paused) {
          while (this.paused && gen === this.generation) await sleep(100);
          if (gen !== this.generation) return;
          sentMs = 0;
          base = Date.now();
        }
        applyGain(frame, this.volume / 100);
        await this.voice.push(frame);
        sentMs += 10;
        this.positionSec = startSec + sentMs / 1000;
        // Segurança extra de ritmo caso o sink não aplique backpressure.
        const ahead = sentMs - (Date.now() - base);
        if (ahead > 1000) await sleep(ahead - 500);
      }
      if (gen !== this.generation) return;
      await this.voice.drain();
    } catch (err) {
      failed = true;
      this.lastError = (err as Error).message;
      this.log(`[${this.channelId}] erro ao tocar "${track.title}": ${(err as Error).message}`);
    }

    if (gen !== this.generation) return;
    // Faixa terminou (ou falhou): em caso de erro nunca repete a mesma faixa.
    const next = failed && this.queue.loopMode === 'track' ? this.queue.advance() : this.queue.onTrackEnded();
    if (next) {
      this.startCurrent(0);
    } else {
      this.stopPlayback();
    }
    await this.report();
  }

  // ─── Estado / ciclo de vida ──────────────────────────────────────────────

  private async report(connected?: boolean): Promise<void> {
    try {
      await this.api.reportState(this.channelId, {
        botConnected: connected ?? this.voice.connected,
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

  async leave(): Promise<void> {
    this.clearIdleTimer();
    if (this.reportTimer) clearInterval(this.reportTimer);
    this.reportTimer = null;
    this.generation++;
    this.decoderKill?.();
    if (this.voice.connected) await this.voice.disconnect().catch(() => undefined);
    this.status = 'idle';
    await this.report(false);
  }
}
