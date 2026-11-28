import { describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'events';
import type { ChildProcess } from 'child_process';
import {
  NativePointerOverlay,
  resolvePointerOverlayBinary,
  toPhysicalDisplayBounds,
} from './NativePointerOverlay';

function makeFakeChild() {
  const emitter = new EventEmitter();
  const written: string[] = [];
  let ended = false;
  let killed = false;
  const fake = Object.assign(emitter, {
    killed: false,
    stdin: {
      destroyed: false,
      write: (chunk: string) => {
        written.push(chunk);
        return true;
      },
      end: () => {
        ended = true;
      },
    },
    kill: () => {
      killed = true;
      fake.killed = true;
      return true;
    },
  });
  return {
    child: fake as unknown as ChildProcess,
    written,
    wasEnded: () => ended,
    wasKilled: () => killed,
  };
}

describe('NativePointerOverlay', () => {
  it('converts logical display bounds to physical pixels using DPI scaleFactor', () => {
    const physical = toPhysicalDisplayBounds({ x: 1920, y: 0, width: 1536, height: 864 }, 1.25);
    expect(physical).toEqual({
      x: 2400,
      y: 0,
      width: 1920,
      height: 1080,
      scaleFactor: 1.25,
    });
  });

  it('resolves explicit env override before fallback locations', () => {
    const found = resolvePointerOverlayBinary({
      envPath: 'C:\\custom\\balacopapo-pointer-overlay.exe',
      platform: 'win32',
      existsSync: (p) => p === 'C:\\custom\\balacopapo-pointer-overlay.exe',
    });
    expect(found).toBe('C:\\custom\\balacopapo-pointer-overlay.exe');
  });

  it('spawns lazily on first ping, sends overlay:state + pointer:ping, throttles rapid pings, and ends stdin on destroy', () => {
    const fake = makeFakeChild();
    let now = 1000;
    const spawnFn = vi.fn(() => fake.child);

    const overlay = new NativePointerOverlay({
      binPath: '/fake/balacopapo-pointer-overlay',
      spawnFn,
      nowFn: () => now,
      throttleMs: 80,
    });

    overlay.updateState(true, { x: 0, y: 0, width: 2560, height: 1440, scaleFactor: 1 });
    expect(spawnFn).not.toHaveBeenCalled();

    overlay.sendPing({ x: 0.42, y: 0.71, senderName: 'Biel', color: '#34d399' });
    expect(spawnFn).toHaveBeenCalledTimes(1);

    // Within 80ms throttle window for same sender -> dropped silently
    now += 30;
    overlay.sendPing({ x: 0.43, y: 0.72, senderName: 'Biel', color: '#34d399' });

    // After throttle window -> forwarded
    now += 90;
    overlay.sendPing({ x: 0.5, y: 0.5, senderName: 'Biel', color: '#34d399' });

    overlay.clear();

    const parsed = fake.written.map((line) => JSON.parse(line.trim()) as Record<string, unknown>);
    expect(parsed).toHaveLength(4);
    expect(parsed[0]).toMatchObject({ type: 'overlay:state', enabled: true, width: 2560, height: 1440 });
    expect(parsed[1]).toMatchObject({ type: 'pointer:ping', x: 0.42, y: 0.71, from: 'Biel' });
    expect(parsed[2]).toMatchObject({ type: 'pointer:ping', x: 0.5, y: 0.5, from: 'Biel' });
    expect(parsed[3]).toEqual({ type: 'pointer:clear' });

    overlay.destroy();
    expect(fake.wasEnded()).toBe(true);
    expect(fake.wasKilled()).toBe(true);
  });
});
