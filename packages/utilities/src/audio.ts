import { spawn } from 'node:child_process';
import type http from 'node:http';

export const SAMPLE_RATE = 48_000;
export const CHANNELS = 2;

/**
 * Decodifica qualquer entrada (arquivo local, cache yt-dlp ou URL/rádio) em
 * stream WAV PCM 48 kHz estéreo 16-bit direto para a resposta HTTP da WebView.
 */
export function streamWav(
  ffmpegPath: string,
  input: string,
  startSec: number,
  res: http.ServerResponse,
  onError?: (msg: string) => void,
): void {
  const args = ['-hide_banner', '-loglevel', 'error', '-nostdin'];
  if (startSec > 0) args.push('-ss', String(startSec));
  args.push('-i', input, '-vn', '-f', 'wav', '-ar', String(SAMPLE_RATE), '-ac', String(CHANNELS), 'pipe:1');

  const child = spawn(ffmpegPath, args, { stdio: ['ignore', 'pipe', 'pipe'] });
  let stderr = '';
  child.stderr.on('data', (d: Buffer) => {
    if (stderr.length < 1000) stderr += d.toString('utf8');
  });

  res.writeHead(200, {
    'Content-Type': 'audio/wav',
    'Cache-Control': 'no-store',
  });
  child.stdout.pipe(res);

  const cleanup = () => {
    if (!child.killed) child.kill('SIGKILL');
  };
  res.on('close', cleanup);
  child.on('error', (err) => {
    onError?.(`ffmpeg erro: ${err.message}`);
    if (!res.writableEnded) res.end();
  });
  child.on('close', (code) => {
    if (code && code !== 0 && !child.killed) {
      onError?.(`ffmpeg saiu com código ${code}: ${stderr.trim().split('\n').pop() ?? ''}`);
    }
    if (!res.writableEnded) res.end();
  });
}
