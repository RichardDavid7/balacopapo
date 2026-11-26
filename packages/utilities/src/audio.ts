import { spawn, type ChildProcess } from 'node:child_process';

export const SAMPLE_RATE = 48_000;
export const CHANNELS = 2;
/** 10 ms de áudio por frame. */
export const SAMPLES_PER_FRAME = SAMPLE_RATE / 100;
export const BYTES_PER_FRAME = SAMPLES_PER_FRAME * CHANNELS * 2;

export interface Decoder {
  frames: AsyncGenerator<Int16Array>;
  kill(): void;
}

/** Decodifica qualquer entrada (arquivo/URL) em PCM s16le 48 kHz estéreo, em frames de 10 ms. */
export function decode(ffmpegPath: string, input: string, startSec = 0): Decoder {
  const args = ['-hide_banner', '-loglevel', 'error', '-nostdin'];
  if (startSec > 0) args.push('-ss', String(startSec));
  args.push('-i', input, '-vn', '-f', 's16le', '-ar', String(SAMPLE_RATE), '-ac', String(CHANNELS), 'pipe:1');

  const child: ChildProcess = spawn(ffmpegPath, args, { stdio: ['ignore', 'pipe', 'pipe'] });
  let stderr = '';
  child.stderr?.on('data', (d: Buffer) => {
    if (stderr.length < 2000) stderr += d.toString('utf8');
  });
  const exited = new Promise<number | null>((resolve, reject) => {
    child.on('error', reject);
    child.on('close', (code) => resolve(code));
  });
  // Evita unhandledRejection caso ninguém consuma `exited` (ex.: kill precoce).
  exited.catch(() => undefined);

  async function* generate(): AsyncGenerator<Int16Array> {
    let pending: Buffer = Buffer.alloc(0);
    for await (const chunk of child.stdout as AsyncIterable<Buffer>) {
      pending = pending.length ? Buffer.concat([pending, chunk]) : chunk;
      while (pending.length >= BYTES_PER_FRAME) {
        const frame = new Int16Array(SAMPLES_PER_FRAME * CHANNELS);
        const view = pending.subarray(0, BYTES_PER_FRAME);
        for (let i = 0; i < frame.length; i++) frame[i] = view.readInt16LE(i * 2);
        pending = pending.subarray(BYTES_PER_FRAME);
        yield frame;
      }
    }
    const code = await exited;
    if (code !== 0 && code !== null && !child.killed) {
      throw new Error(`ffmpeg falhou (${code}): ${stderr.trim().split('\n').pop() ?? ''}`);
    }
  }

  return {
    frames: generate(),
    kill: () => {
      if (!child.killed) child.kill('SIGKILL');
    },
  };
}

/** Aplica ganho (0..1) in-place. */
export function applyGain(frame: Int16Array, gain: number): void {
  if (gain >= 0.999) return;
  for (let i = 0; i < frame.length; i++) {
    frame[i] = Math.max(-32768, Math.min(32767, Math.round((frame[i] ?? 0) * gain)));
  }
}
