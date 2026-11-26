import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import type { MusicTrack } from '@backspace/shared';
import type { AudioCache } from './cache.js';
import type { UtilitiesConfig } from './config.js';

export interface ResolvedAudio {
  /** Caminho local (cache) ou URL direta para o ffmpeg. */
  input: string;
  /** Metadados descobertos (só yt-dlp). */
  meta?: Partial<Pick<MusicTrack, 'title' | 'artist' | 'durationSec' | 'thumbnailUrl'>>;
}

export function cacheKey(url: string): string {
  return crypto.createHash('sha1').update(url).digest('hex').slice(0, 16);
}

function run(cmd: string, args: string[], signal?: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], signal });
    let out = '';
    let err = '';
    child.stdout.on('data', (d: Buffer) => (out += d.toString('utf8')));
    child.stderr.on('data', (d: Buffer) => (err += d.toString('utf8')));
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve(out);
      else reject(new Error(`${cmd} saiu com código ${code}: ${err.trim().split('\n').pop() ?? ''}`));
    });
  });
}

export function parseYtdlpMeta(json: string): ResolvedAudio['meta'] {
  try {
    const j = JSON.parse(json) as Record<string, unknown>;
    const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);
    return {
      title: str(j.track) ?? str(j.title) ?? undefined,
      artist: str(j.artist) ?? str(j.uploader) ?? str(j.channel),
      durationSec: typeof j.duration === 'number' ? Math.round(j.duration) : null,
      thumbnailUrl: str(j.thumbnail),
    };
  } catch {
    return undefined;
  }
}

export class TrackResolver {
  private readonly inflight = new Map<string, Promise<ResolvedAudio>>();

  constructor(
    private readonly cfg: UtilitiesConfig,
    private readonly cache: AudioCache,
  ) {}

  resolve(track: MusicTrack, signal?: AbortSignal): Promise<ResolvedAudio> {
    if (track.source !== 'youtube') return Promise.resolve({ input: track.url });

    const key = cacheKey(track.url);
    let p = this.inflight.get(key);
    if (!p) {
      p = this.download(track.url, key, signal).finally(() => this.inflight.delete(key));
      this.inflight.set(key, p);
    }
    return p;
  }

  /** Pré-baixa em segundo plano (ex.: próxima da fila). Erros são ignorados. */
  prefetch(track: MusicTrack): void {
    void this.resolve(track).catch(() => undefined);
  }

  private async download(url: string, key: string, signal?: AbortSignal): Promise<ResolvedAudio> {
    const cached = await this.cache.find(key);
    if (cached) return { input: cached };

    const json = await run(
      this.cfg.ytdlpPath,
      [
        '--no-playlist',
        '--no-progress',
        '--no-warnings',
        '-f', 'bestaudio/best',
        '-o', `${this.cache.dir}/${key}.%(ext)s`,
        '--no-simulate',
        '-J',
        url,
      ],
      signal,
    );
    const file = await this.cache.find(key);
    if (!file) throw new Error('yt-dlp não gerou arquivo de áudio');
    void this.cache.prune();
    return { input: file, meta: parseYtdlpMeta(json) };
  }
}
