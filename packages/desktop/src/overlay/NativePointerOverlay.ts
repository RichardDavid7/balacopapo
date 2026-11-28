import { spawn, type ChildProcess } from 'child_process';
import fs from 'fs';
import path from 'path';

export interface PhysicalDisplayBounds {
  x: number;
  y: number;
  width: number;
  height: number;
  scaleFactor: number;
}

export interface PointerPingInput {
  x: number;
  y: number;
  senderName: string;
  color: string;
  ttlMs?: number;
}

export type SpawnOverlayFn = (binPath: string) => ChildProcess;

const DEFAULT_THROTTLE_MS = 80;
const MAX_RESTARTS = 3;
const RESTART_BACKOFF_MS = 600;

export function resolvePointerOverlayBinary(opts?: {
  envPath?: string;
  resourcesPath?: string;
  cwd?: string;
  platform?: NodeJS.Platform;
  existsSync?: (p: string) => boolean;
}): string | null {
  const exists = opts?.existsSync ?? fs.existsSync;
  const platform = opts?.platform ?? process.platform;
  const exeName = platform === 'win32' ? 'balacopapo-pointer-overlay.exe' : 'balacopapo-pointer-overlay';

  const candidates: string[] = [];
  const envPath = opts?.envPath ?? process.env.BALACOPAPO_POINTER_OVERLAY_BIN;
  if (envPath && envPath.trim()) {
    candidates.push(envPath.trim());
  }

  const resPath = opts?.resourcesPath ?? (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
  if (resPath) {
    candidates.push(path.join(resPath, 'bin', exeName));
    candidates.push(path.join(resPath, exeName));
  }

  const cwd = opts?.cwd ?? process.cwd();
  candidates.push(path.resolve(cwd, 'clients', 'pointer-overlay', 'target', 'release', exeName));
  candidates.push(path.resolve(cwd, 'clients', 'pointer-overlay', 'target', 'debug', exeName));
  candidates.push(path.resolve(cwd, '..', '..', 'clients', 'pointer-overlay', 'target', 'release', exeName));
  candidates.push(path.resolve(cwd, '..', '..', 'clients', 'pointer-overlay', 'target', 'debug', exeName));

  for (const candidate of candidates) {
    if (exists(candidate)) {
      return candidate;
    }
  }
  return null;
}

export function toPhysicalDisplayBounds(
  logicalBounds: { x: number; y: number; width: number; height: number },
  scaleFactor: number,
): PhysicalDisplayBounds {
  const sf = Number.isFinite(scaleFactor) && scaleFactor > 0 ? scaleFactor : 1;
  return {
    x: Math.round(logicalBounds.x * sf),
    y: Math.round(logicalBounds.y * sf),
    width: Math.max(1, Math.round(logicalBounds.width * sf)),
    height: Math.max(1, Math.round(logicalBounds.height * sf)),
    scaleFactor: sf,
  };
}

/**
 * Ponte NDJSON (via `stdin`) + watchdog entre o Electron Main e o binário nativo
 * `balacopapo-pointer-overlay` (janela transparente click-through sem WebView).
 */
export class NativePointerOverlay {
  private child: ChildProcess | null = null;
  private binPath: string | null;
  private enabled = true;
  private bounds: PhysicalDisplayBounds = { x: 0, y: 0, width: 1920, height: 1080, scaleFactor: 1 };
  private lastPingBySender = new Map<string, number>();
  private restartCount = 0;
  private restartTimer: ReturnType<typeof setTimeout> | null = null;
  private destroyed = false;
  private readonly spawnFn: SpawnOverlayFn;
  private readonly nowFn: () => number;
  private readonly throttleMs: number;

  constructor(opts?: {
    binPath?: string | null;
    spawnFn?: SpawnOverlayFn;
    nowFn?: () => number;
    throttleMs?: number;
  }) {
    this.binPath = opts?.binPath !== undefined ? opts.binPath : resolvePointerOverlayBinary();
    this.spawnFn =
      opts?.spawnFn ??
      ((bin) =>
        spawn(bin, [], {
          stdio: ['pipe', 'ignore', 'pipe'],
          windowsHide: true,
        }));
    this.nowFn = opts?.nowFn ?? Date.now;
    this.throttleMs = opts?.throttleMs ?? DEFAULT_THROTTLE_MS;
  }

  isAvailable(): boolean {
    return this.binPath !== null;
  }

  updateState(enabled: boolean, bounds: PhysicalDisplayBounds): void {
    this.enabled = enabled;
    this.bounds = bounds;
    if (!this.isAvailable()) return;
    if (!enabled) {
      if (this.child && !this.child.killed) {
        this.writeCommand({
          type: 'overlay:state',
          enabled: false,
          ...bounds,
        });
      }
      return;
    }
    if (this.child && !this.child.killed) {
      this.writeCommand({
        type: 'overlay:state',
        enabled: true,
        ...bounds,
      });
    }
  }

  sendPing(ping: PointerPingInput): boolean {
    if (!this.isAvailable() || !this.enabled || this.destroyed) return false;

    const senderKey = (ping.senderName || 'anon').slice(0, 32);
    const now = this.nowFn();
    const prev = this.lastPingBySender.get(senderKey) ?? 0;
    if (now - prev < this.throttleMs) {
      return true;
    }
    this.lastPingBySender.set(senderKey, now);

    if (!this.ensureSpawned()) return false;

    return this.writeCommand({
      type: 'pointer:ping',
      x: Math.max(0, Math.min(1, ping.x)),
      y: Math.max(0, Math.min(1, ping.y)),
      from: senderKey,
      color: ping.color,
      ttlMs: ping.ttlMs ?? 2500,
    });
  }

  clear(): boolean {
    if (!this.isAvailable() || !this.child || this.child.killed) return false;
    return this.writeCommand({ type: 'pointer:clear' });
  }

  destroy(): void {
    this.destroyed = true;
    if (this.restartTimer) {
      clearTimeout(this.restartTimer);
      this.restartTimer = null;
    }
    this.lastPingBySender.clear();
    if (this.child) {
      try {
        this.child.stdin?.end();
      } catch {
        // ignore
      }
      try {
        if (!this.child.killed) {
          this.child.kill();
        }
      } catch {
        // ignore
      }
      this.child = null;
    }
  }

  private ensureSpawned(): boolean {
    if (this.child && !this.child.killed) return true;
    if (!this.binPath || this.destroyed) return false;

    try {
      const child = this.spawnFn(this.binPath);
      this.child = child;
      child.once('exit', () => {
        if (this.child === child) {
          this.child = null;
        }
        if (!this.destroyed && this.enabled && this.restartCount < MAX_RESTARTS) {
          this.restartCount += 1;
          this.restartTimer = setTimeout(() => {
            this.restartTimer = null;
            if (!this.destroyed && this.enabled) {
              this.ensureSpawned();
            }
          }, RESTART_BACKOFF_MS * this.restartCount);
        }
      });
      child.on('error', () => {
        if (this.child === child) {
          this.child = null;
        }
      });

      this.writeCommand({
        type: 'overlay:state',
        enabled: this.enabled,
        ...this.bounds,
      });
      return true;
    } catch {
      this.child = null;
      return false;
    }
  }

  private writeCommand(payload: Record<string, unknown>): boolean {
    if (!this.child?.stdin || this.child.stdin.destroyed) return false;
    try {
      this.child.stdin.write(`${JSON.stringify(payload)}\n`);
      return true;
    } catch {
      return false;
    }
  }
}
