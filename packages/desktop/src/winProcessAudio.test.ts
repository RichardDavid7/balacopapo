import path from 'path';
import { describe, it, expect, vi } from 'vitest';
import {
  parseHwndFromSourceId,
  createWinProcessAudioController,
  type WasapiLoopbackModule,
} from './winProcessAudio';

describe('parseHwndFromSourceId', () => {
  it('extracts a positive integer HWND from Electron window source ids', () => {
    expect(parseHwndFromSourceId('window:123456:0')).toBe(123456);
    expect(parseHwndFromSourceId('window:42:1')).toBe(42);
    expect(parseHwndFromSourceId('  window:987654:0  ')).toBe(987654);
  });

  it('returns null for screen sources, zero, or malformed ids', () => {
    expect(parseHwndFromSourceId('screen:0:0')).toBeNull();
    expect(parseHwndFromSourceId('window:0:0')).toBeNull();
    expect(parseHwndFromSourceId('window:-5:0')).toBeNull();
    expect(parseHwndFromSourceId('window:abc:0')).toBeNull();
    expect(parseHwndFromSourceId('window:123')).toBeNull();
    expect(parseHwndFromSourceId('')).toBeNull();
  });
});

describe('createWinProcessAudioController', () => {
  it('is unavailable off Windows without attempting to load the native addon', () => {
    const loadAddon = vi.fn();
    const ctl = createWinProcessAudioController({
      platform: 'linux',
      resourcesPath: '/app/resources',
      devResourcesDir: '/dev/resources',
      loadAddon,
    });

    expect(ctl.isAvailable()).toBe(false);
    expect(ctl.start({ sourceId: 'window:100:0' })).toEqual({
      ok: false,
      reason: 'unsupported-platform',
    });
    expect(loadAddon).not.toHaveBeenCalled();
  });

  it('degrades gracefully when wasapi_loopback.node is missing', () => {
    const log = vi.fn();
    const loadAddon = vi.fn(() => {
      throw new Error('Cannot find module');
    });
    const ctl = createWinProcessAudioController({
      platform: 'win32',
      resourcesPath: 'C:\\Program Files\\Backspace\\resources',
      devResourcesDir: 'C:\\repo\\packages\\desktop\\resources',
      loadAddon,
      log,
    });

    expect(ctl.isAvailable()).toBe(false);
    expect(ctl.start({ sourceId: 'window:100:0' })).toEqual({
      ok: false,
      reason: 'module-missing',
    });
    expect(loadAddon).toHaveBeenCalledTimes(2);
    expect(loadAddon).toHaveBeenNthCalledWith(
      1,
      path.join('C:\\Program Files\\Backspace\\resources', 'wasapi_loopback.node'),
    );
    expect(loadAddon).toHaveBeenNthCalledWith(
      2,
      path.join('C:\\repo\\packages\\desktop\\resources', 'wasapi_loopback.node'),
    );
    expect(() => ctl.stop()).not.toThrow();
  });

  it('starts window-isolated capture, resolves PID from HWND, and stops cleanly', () => {
    const startCapture = vi.fn(() => ({ url: 'http://127.0.0.1:49152/pcm' }));
    const stopCapture = vi.fn();
    const getPidFromHwnd = vi.fn(() => 7777);
    const fakeMod: WasapiLoopbackModule = {
      isSupported: () => true,
      getPidFromHwnd,
      startCapture,
      stopCapture,
    };

    const ctl = createWinProcessAudioController({
      platform: 'win32',
      resourcesPath: 'C:\\App\\resources',
      devResourcesDir: 'C:\\Dev\\resources',
      loadAddon: () => fakeMod,
    });

    expect(ctl.isAvailable()).toBe(true);
    expect(ctl.start({ sourceId: 'window:55555:0', excludeSelf: true })).toEqual({
      ok: true,
      url: 'http://127.0.0.1:49152/pcm',
    });
    expect(getPidFromHwnd).toHaveBeenCalledWith(55555);
    expect(startCapture).toHaveBeenCalledWith({
      hwnd: 55555,
      pid: 7777,
      excludeSelf: true,
    });

    ctl.stop();
    ctl.stop(); // idempotent
    expect(stopCapture).toHaveBeenCalledTimes(1);
  });

  it('falls back to dev resources path when packaged path fails', () => {
    const start = vi.fn(() => 'http://127.0.0.1:50000/audio');
    const stop = vi.fn();
    const loadAddon = vi.fn((addonPath: string): WasapiLoopbackModule => {
      if (addonPath.includes('Packaged')) throw new Error('ENOENT');
      return { start, stop };
    });

    const ctl = createWinProcessAudioController({
      platform: 'win32',
      resourcesPath: 'C:\\Packaged\\resources',
      devResourcesDir: 'C:\\Dev\\resources',
      loadAddon,
    });

    expect(ctl.start({ sourceId: 'screen:0:0', excludeSelf: true })).toEqual({
      ok: true,
      url: 'http://127.0.0.1:50000/audio',
    });
    expect(start).toHaveBeenCalledWith({ excludeSelf: true });
    ctl.stop();
    expect(stop).toHaveBeenCalledTimes(1);
  });

  it('returns unsupported-os when addon reports unsupported Windows build', () => {
    const ctl = createWinProcessAudioController({
      platform: 'win32',
      resourcesPath: 'C:\\App\\resources',
      loadAddon: () => ({
        isSupported: () => false,
        startCapture: vi.fn(),
        stopCapture: vi.fn(),
      }),
    });

    expect(ctl.isAvailable()).toBe(false);
    expect(ctl.start()).toEqual({ ok: false, reason: 'unsupported-os' });
  });
});
