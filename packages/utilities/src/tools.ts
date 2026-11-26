import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createWriteStream } from 'node:fs';
import { appDataDir, binDir } from './paths.js';

export interface ToolPaths {
  ytdlpPath: string;
  ffmpegPath: string;
}

const isWin = process.platform === 'win32';
const exe = (n: string) => (isWin ? `${n}.exe` : n);

export function ytdlpAssetName(platform = process.platform, arch = process.arch): string {
  if (platform === 'win32') return 'yt-dlp.exe';
  if (platform === 'linux') return arch === 'arm64' ? 'yt-dlp_linux_aarch64' : 'yt-dlp_linux';
  if (platform === 'darwin') return 'yt-dlp_macos';
  throw new Error(`Plataforma não suportada: ${platform}`);
}

export function ffmpegAsset(platform = process.platform, arch = process.arch): string {
  const base = 'https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-';
  if (platform === 'win32') return `${base}${arch === 'arm64' ? 'winarm64' : 'win64'}-gpl.zip`;
  if (platform === 'linux') return `${base}${arch === 'arm64' ? 'linuxarm64' : 'linux64'}-gpl.tar.xz`;
  throw new Error(`Baixe o ffmpeg manualmente (plataforma ${platform})`);
}

function works(cmd: string, args: string[]): Promise<boolean> {
  return new Promise((resolve) => {
    const c = spawn(cmd, args, { stdio: 'ignore' });
    c.on('error', () => resolve(false));
    c.on('close', (code) => resolve(code === 0));
  });
}

async function download(url: string, dest: string): Promise<void> {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok || !res.body) throw new Error(`Download falhou (${res.status}): ${url}`);
  await fs.mkdir(path.dirname(dest), { recursive: true });
  await pipeline(Readable.fromWeb(res.body as never), createWriteStream(dest));
}

function run(cmd: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const c = spawn(cmd, args, { stdio: 'ignore' });
    c.on('error', reject);
    c.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} saiu com código ${code}`))));
  });
}

async function findFile(dir: string, name: string): Promise<string | null> {
  for (const e of await fs.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      const hit = await findFile(full, name);
      if (hit) return hit;
    } else if (e.name === name) return full;
  }
  return null;
}

/**
 * Garante yt-dlp e ffmpeg: usa o que estiver no PATH; senão baixa para a pasta de dados do app.
 */
export async function ensureTools(
  home = appDataDir(),
  log: (msg: string) => void = console.log,
): Promise<ToolPaths> {
  const dir = binDir(home);

  let ytdlpPath = 'yt-dlp';
  if (!(await works(ytdlpPath, ['--version']))) {
    ytdlpPath = path.join(dir, exe('yt-dlp'));
    if (!(await works(ytdlpPath, ['--version']))) {
      log('Baixando yt-dlp...');
      await download(`https://github.com/yt-dlp/yt-dlp/releases/latest/download/${ytdlpAssetName()}`, ytdlpPath);
      if (!isWin) await fs.chmod(ytdlpPath, 0o755);
    } else {
      // Cópia própria: tenta atualizar em segundo plano (YouTube muda com frequência).
      void run(ytdlpPath, ['-U']).catch(() => undefined);
    }
  }

  let ffmpegPath = 'ffmpeg';
  if (!(await works(ffmpegPath, ['-version']))) {
    ffmpegPath = path.join(dir, exe('ffmpeg'));
    if (!(await works(ffmpegPath, ['-version']))) {
      log('Baixando ffmpeg (pode levar um tempo)...');
      const url = ffmpegAsset();
      const archive = path.join(dir, path.basename(url));
      const tmp = path.join(dir, 'ffmpeg-extract');
      await download(url, archive);
      await fs.rm(tmp, { recursive: true, force: true });
      await fs.mkdir(tmp, { recursive: true });
      await run('tar', ['-xf', archive, '-C', tmp]);
      const found = await findFile(tmp, exe('ffmpeg'));
      if (!found) throw new Error('ffmpeg não encontrado no pacote baixado');
      await fs.copyFile(found, ffmpegPath);
      if (!isWin) await fs.chmod(ffmpegPath, 0o755);
      await fs.rm(tmp, { recursive: true, force: true });
      await fs.rm(archive, { force: true });
    }
  }

  return { ytdlpPath, ffmpegPath };
}
