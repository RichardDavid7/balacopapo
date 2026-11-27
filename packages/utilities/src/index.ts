import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { Controller } from './controller.js';
import { appDataDir, settingsFile } from './paths.js';
import { startUiServer } from './server.js';
import { loadSettings } from './settings.js';

const PORT = Number(process.env.BALACOPAPO_UTIL_PORT) || 47821;
const require = createRequire(import.meta.url);

function openBrowser(url: string): void {
  const [cmd, args] =
    process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]]
    : process.platform === 'darwin' ? ['open', [url]]
    : ['xdg-open', [url]];
  spawn(cmd, args, { stdio: 'ignore', detached: true }).on('error', () => undefined).unref();
}

async function main(): Promise<void> {
  if (process.argv.includes('--check')) {
    const lkBundle = path.join(path.dirname(require.resolve('livekit-client')), 'livekit-client.umd.js');
    if (!fs.existsSync(lkBundle)) throw new Error('livekit-client.umd.js não encontrado');
    console.log('Balacopapo Utilidades: self-check OK');
    process.exit(0);
  }
  const home = appDataDir();
  const controller = new Controller(home);
  await startUiServer(controller, home, PORT);
  const url = `http://127.0.0.1:${PORT}`;
  console.log(`Balacopapo Utilidades — interface em ${url}`);

  const settings = await loadSettings(home);
  controller.log(`Configurações: ${settingsFile(home)}`);
  if (settings.baseUrl && settings.apiKey) void controller.start(settings);
  if (!process.argv.includes('--no-browser')) openBrowser(url);

  const shutdown = async () => {
    await controller.stop();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
