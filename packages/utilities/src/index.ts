import { spawn } from 'node:child_process';
import { Controller } from './controller.js';
import { appDataDir } from './paths.js';
import { startUiServer } from './server.js';
import { loadSettings } from './settings.js';

const PORT = Number(process.env.BALACOPAPO_UTIL_PORT) || 47821;

function openBrowser(url: string): void {
  const [cmd, args] =
    process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]]
    : process.platform === 'darwin' ? ['open', [url]]
    : ['xdg-open', [url]];
  spawn(cmd, args, { stdio: 'ignore', detached: true }).on('error', () => undefined).unref();
}

async function main(): Promise<void> {
  const home = appDataDir();
  const controller = new Controller(home);
  await startUiServer(controller, home, PORT);
  const url = `http://127.0.0.1:${PORT}`;
  console.log(`Balacopapo Utilidades — interface em ${url}`);

  const settings = await loadSettings(home);
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
