import os from 'node:os';
import path from 'node:path';

/** Pasta de dados do app (config, cache e binários baixados). */
export function appDataDir(env: NodeJS.ProcessEnv = process.env): string {
  if (env.BALACOPAPO_UTIL_HOME) return path.resolve(env.BALACOPAPO_UTIL_HOME);
  if (process.platform === 'win32') {
    return path.join(env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'Balacopapo Utilidades');
  }
  return path.join(env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'balacopapo-utilidades');
}

export const binDir = (home = appDataDir()) => path.join(home, 'bin');
export const cacheDir = (home = appDataDir()) => path.join(home, 'cache');
export const settingsFile = (home = appDataDir()) => path.join(home, 'settings.json');
