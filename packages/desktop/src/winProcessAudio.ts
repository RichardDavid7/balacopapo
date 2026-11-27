import path from 'path';

/**
 * Windows per-window / process-excluded audio capture controller.
 *
 * Wraps the optional native Rust N-API addon (`wasapi_loopback.node`) built on
 * Windows 10 20348+ / Windows 11 WASAPI Process Loopback. When the addon is
 * present, it exposes a localhost HTTP stream of raw 48 kHz stereo f32le PCM
 * audio that the renderer reads into a Web Audio `MediaStreamAudioDestinationNode`.
 *
 * Outside Windows, or whenever the native binary is absent, every method
 * degrades gracefully without throwing so the renderer falls back to Chromium's
 * standard loopback capture.
 */

export interface WasapiLoopbackStartArgs {
  hwnd?: number;
  pid?: number;
  excludeSelf?: boolean;
}

export interface WasapiLoopbackModule {
  isSupported?: () => boolean;
  getPidFromHwnd?: (hwnd: number) => number | null | undefined;
  startCapture?: (opts: WasapiLoopbackStartArgs) => string | { url: string };
  start?: (opts: WasapiLoopbackStartArgs) => string | { url: string };
  stopCapture?: () => void;
  stop?: () => void;
}

export interface WinProcessAudioStartOptions {
  /** Electron desktopCapturer source id, e.g. `"window:12345:0"` or `"screen:0:0"`. */
  sourceId?: string | null;
  /** Exclude this Electron process tree from system loopback when no target window is isolated. */
  excludeSelf?: boolean;
}

export type WinProcessAudioStartResult =
  | { ok: true; url: string }
  | { ok: false; reason: string };

export interface WinProcessAudioController {
  isAvailable(): boolean;
  start(opts?: WinProcessAudioStartOptions): WinProcessAudioStartResult;
  stop(): void;
}

export interface WinProcessAudioDeps {
  platform: NodeJS.Platform;
  resourcesPath: string;
  devResourcesDir: string;
  loadAddon: (addonPath: string) => WasapiLoopbackModule;
  log?: (message: string, ...args: unknown[]) => void;
}

const WINDOW_SOURCE_RE = /^window:(\d+):/;

/**
 * Extracts the Win32 window handle (HWND) from an Electron desktopCapturer
 * source id such as `"window:123456:0"`. Returns `null` for screens or
 * malformed ids.
 */
export function parseHwndFromSourceId(sourceId: string): number | null {
  if (typeof sourceId !== 'string') return null;
  const match = WINDOW_SOURCE_RE.exec(sourceId.trim());
  if (!match) return null;
  const parsed = Number(match[1]);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) return null;
  return parsed;
}

function defaultLoadAddon(addonPath: string): WasapiLoopbackModule {
  // Dynamic require for optional native binary placed alongside packaged resources or in dev.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require(addonPath) as WasapiLoopbackModule;
}

export function createWinProcessAudioController(
  overrides: Partial<WinProcessAudioDeps> = {},
): WinProcessAudioController {
  const deps: WinProcessAudioDeps = {
    platform: process.platform,
    resourcesPath: (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath ?? '',
    devResourcesDir: path.join(__dirname, '..', 'resources'),
    loadAddon: defaultLoadAddon,
    log: (message, ...args) => console.warn('[Main:WinProcessAudio]', message, ...args),
    ...overrides,
  };

  const log = deps.log ?? (() => undefined);
  let cachedModule: WasapiLoopbackModule | null | undefined;
  let active = false;

  function loadModule(): WasapiLoopbackModule | null {
    if (cachedModule !== undefined) return cachedModule;
    if (deps.platform !== 'win32') {
      cachedModule = null;
      return null;
    }

    const candidates: string[] = [];
    if (deps.resourcesPath) {
      candidates.push(path.join(deps.resourcesPath, 'wasapi_loopback.node'));
    }
    if (deps.devResourcesDir) {
      const devPath = path.join(deps.devResourcesDir, 'wasapi_loopback.node');
      if (!candidates.includes(devPath)) candidates.push(devPath);
    }

    let lastErr: unknown;
    for (const candidate of candidates) {
      try {
        const mod = deps.loadAddon(candidate);
        if (mod && (typeof mod.startCapture === 'function' || typeof mod.start === 'function')) {
          cachedModule = mod;
          return mod;
        }
      } catch (err) {
        lastErr = err;
      }
    }

    if (lastErr) {
      log('wasapi_loopback.node could not be loaded (falling back to Chromium loopback):', lastErr);
    }
    cachedModule = null;
    return null;
  }

  function unavailableReason(): string | null {
    if (deps.platform !== 'win32') return 'unsupported-platform';
    const mod = loadModule();
    if (!mod) return 'module-missing';
    if (typeof mod.isSupported === 'function') {
      try {
        if (!mod.isSupported()) return 'unsupported-os';
      } catch (err) {
        log('isSupported probe failed:', err);
        return 'unsupported-os';
      }
    }
    return null;
  }

  function stopInternal(): void {
    if (!active) return;
    active = false;
    const mod = cachedModule;
    if (!mod) return;
    try {
      if (typeof mod.stopCapture === 'function') {
        mod.stopCapture();
      } else if (typeof mod.stop === 'function') {
        mod.stop();
      }
    } catch (err) {
      log('stop failed:', err);
    }
  }

  return {
    isAvailable(): boolean {
      return unavailableReason() === null;
    },

    start(opts?: WinProcessAudioStartOptions): WinProcessAudioStartResult {
      const reason = unavailableReason();
      if (reason) return { ok: false, reason };

      const mod = cachedModule as WasapiLoopbackModule;
      const startFn = mod.startCapture ?? mod.start;
      if (!startFn) return { ok: false, reason: 'module-missing' };

      // Ensure any previous session is torn down cleanly before starting a new one.
      stopInternal();

      const hwnd = opts?.sourceId ? parseHwndFromSourceId(opts.sourceId) : null;
      let pid: number | undefined;
      if (hwnd !== null && typeof mod.getPidFromHwnd === 'function') {
        try {
          const resolved = mod.getPidFromHwnd(hwnd);
          if (typeof resolved === 'number' && Number.isInteger(resolved) && resolved > 0) {
            pid = resolved;
          }
        } catch (err) {
          log('getPidFromHwnd failed:', err);
        }
      }

      const args: WasapiLoopbackStartArgs = {
        ...(hwnd !== null ? { hwnd } : {}),
        ...(pid !== undefined ? { pid } : {}),
        excludeSelf: opts?.excludeSelf ?? true,
      };

      try {
        const result = startFn(args);
        const url = typeof result === 'string' ? result : result?.url;
        if (typeof url !== 'string' || url.trim().length === 0) {
          return { ok: false, reason: 'invalid-url' };
        }
        active = true;
        return { ok: true, url };
      } catch (err) {
        log('start failed:', err);
        active = false;
        return { ok: false, reason: 'start-failed' };
      }
    },

    stop(): void {
      stopInternal();
    },
  };
}
