import { describe, expect, it } from 'vitest';
import type { MusicTrack } from '@backspace/shared';
import { TrackQueue } from './queue.js';
import { parseYtdlpMeta, cacheKey } from './resolver.js';

const t = (id: string): MusicTrack => ({
  id, title: id, source: 'url', url: `http://x/${id}`, requestedByUserId: 'u', requestedByName: 'U', addedAt: 0,
});

describe('TrackQueue', () => {
  it('starts first track, queues the rest, ignores duplicates', () => {
    const q = new TrackQueue();
    expect(q.add(t('a'))).toBe(true);
    expect(q.add(t('b'))).toBe(false);
    expect(q.add(t('b'))).toBe(false);
    expect(q.queue.map((x) => x.id)).toEqual(['b']);
  });

  it('advances and honours preferred id', () => {
    const q = new TrackQueue();
    q.add(t('a')); q.add(t('b')); q.add(t('c'));
    expect(q.advance('c')?.id).toBe('c');
    expect(q.queue.map((x) => x.id)).toEqual(['b']);
    expect(q.advance()?.id).toBe('b');
    expect(q.advance()).toBeNull();
  });

  it('loops track and queue', () => {
    const q = new TrackQueue();
    q.add(t('a')); q.add(t('b'));
    q.loopMode = 'track';
    expect(q.onTrackEnded()?.id).toBe('a');
    q.loopMode = 'queue';
    expect(q.onTrackEnded()?.id).toBe('b');
    expect(q.queue.map((x) => x.id)).toEqual(['a']);
  });
});

describe('resolver helpers', () => {
  it('parses yt-dlp metadata', () => {
    const m = parseYtdlpMeta(JSON.stringify({ title: 'T', uploader: 'U', duration: 61.4, thumbnail: 'http://i' }));
    expect(m).toEqual({ title: 'T', artist: 'U', durationSec: 61, thumbnailUrl: 'http://i' });
    expect(parseYtdlpMeta('nope')).toBeUndefined();
  });
  it('has stable cache keys', () => {
    expect(cacheKey('x')).toBe(cacheKey('x'));
    expect(cacheKey('x')).toHaveLength(16);
  });
});
