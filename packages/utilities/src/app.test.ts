import { describe, expect, it } from 'vitest';
import { normalizeSettings, DEFAULT_SETTINGS } from './settings.js';
import { ffmpegAsset, ytdlpAssetName } from './tools.js';
import { isLocalHost } from './server.js';

describe('settings', () => {
  it('normalizes url and keeps existing key when empty', () => {
    const base = { ...DEFAULT_SETTINGS, apiKey: 'bp_old' };
    const s = normalizeSettings({ baseUrl: ' https://x.com/// ', apiKey: '' }, base);
    expect(s.baseUrl).toBe('https://x.com');
    expect(s.apiKey).toBe('bp_old');
  });
  it('rejects non-http url', () => {
    expect(() => normalizeSettings({ baseUrl: 'ftp://x' })).toThrow();
  });
});

describe('tools', () => {
  it('picks assets per platform', () => {
    expect(ytdlpAssetName('win32', 'x64')).toBe('yt-dlp.exe');
    expect(ytdlpAssetName('linux', 'arm64')).toBe('yt-dlp_linux_aarch64');
    expect(ffmpegAsset('linux', 'x64')).toContain('linux64-gpl.tar.xz');
    expect(ffmpegAsset('win32', 'x64')).toContain('win64-gpl.zip');
  });
});

describe('ui server', () => {
  it('only accepts local hosts', () => {
    expect(isLocalHost('127.0.0.1:47821', 47821)).toBe(true);
    expect(isLocalHost('evil.com:47821', 47821)).toBe(false);
  });
});
