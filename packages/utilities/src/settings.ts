import fs from 'node:fs/promises';
import path from 'node:path';
import { appDataDir, cacheDir, settingsFile } from './paths.js';

export interface Settings {
  baseUrl: string;
  apiKey: string;
  /** Vazio = todos os canais de voz do Grupo. */
  channelIds: string[];
  botName: string;
  cacheMaxMb: number;
  idleLeaveSec: number;
}

export const DEFAULT_SETTINGS: Settings = {
  baseUrl: '',
  apiKey: '',
  channelIds: [],
  botName: 'Balacopapo Música',
  cacheMaxMb: 2048,
  idleLeaveSec: 300,
};

export function normalizeSettings(input: Partial<Settings>, base: Settings = DEFAULT_SETTINGS): Settings {
  const num = (v: unknown, def: number) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : def);
  let baseUrl = typeof input.baseUrl === 'string' ? input.baseUrl.trim().replace(/\/+$/, '') : base.baseUrl;
  if (baseUrl) {
    if (!/^https?:\/\//i.test(baseUrl)) throw new Error('A URL deve começar com http:// ou https://');
    try {
      baseUrl = new URL(baseUrl).origin;
    } catch {
      throw new Error('URL da instância inválida');
    }
  }
  return {
    baseUrl,
    apiKey: typeof input.apiKey === 'string' && input.apiKey.trim() ? input.apiKey.trim() : base.apiKey,
    channelIds: Array.isArray(input.channelIds)
      ? input.channelIds.filter((c): c is string => typeof c === 'string' && c.length > 0)
      : base.channelIds,
    botName: (typeof input.botName === 'string' && input.botName.trim() ? input.botName.trim() : base.botName).slice(0, 48),
    cacheMaxMb: num(input.cacheMaxMb, base.cacheMaxMb),
    idleLeaveSec: num(input.idleLeaveSec, base.idleLeaveSec),
  };
}

export async function loadSettings(home = appDataDir(), env: NodeJS.ProcessEnv = process.env): Promise<Settings> {
  let s = DEFAULT_SETTINGS;
  try {
    s = normalizeSettings(JSON.parse(await fs.readFile(settingsFile(home), 'utf8')) as Partial<Settings>);
  } catch {
    /* sem arquivo ainda */
  }
  // Variáveis de ambiente (modo headless) preenchem o que faltar.
  if (!s.baseUrl && env.BALACOPAPO_URL) s = { ...s, baseUrl: env.BALACOPAPO_URL.trim().replace(/\/+$/, '') };
  if (!s.apiKey && env.BALACOPAPO_API_KEY) s = { ...s, apiKey: env.BALACOPAPO_API_KEY.trim() };
  return s;
}

export async function saveSettings(s: Settings, home = appDataDir()): Promise<void> {
  await fs.mkdir(path.dirname(settingsFile(home)), { recursive: true });
  await fs.writeFile(settingsFile(home), JSON.stringify(s, null, 2), { mode: 0o600 });
}

export interface UtilitiesConfig {
  baseUrl: string;
  apiKey: string;
  channelIds: string[];
  botName: string;
  ytdlpPath: string;
  ffmpegPath: string;
  cacheDir: string;
  cacheMaxBytes: number;
  pollIntervalMs: number;
  idleLeaveSec: number;
}

export function buildConfig(
  s: Settings,
  tools: { ytdlpPath: string; ffmpegPath: string },
  home = appDataDir(),
): UtilitiesConfig {
  if (!s.baseUrl) throw new Error('Informe a URL da instância');
  if (!s.apiKey) throw new Error('Informe a chave de API do Grupo');
  return {
    baseUrl: s.baseUrl,
    apiKey: s.apiKey,
    channelIds: s.channelIds,
    botName: s.botName,
    ytdlpPath: tools.ytdlpPath,
    ffmpegPath: tools.ffmpegPath,
    cacheDir: cacheDir(home),
    cacheMaxBytes: s.cacheMaxMb * 1024 * 1024,
    pollIntervalMs: 1000,
    idleLeaveSec: s.idleLeaveSec,
  };
}
