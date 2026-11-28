import { describe, it, expect } from 'vitest';
import {
  buildLastFmProfileUrl,
  maskLastFmApiKey,
  normalizeLastFmUsername,
  parseLastFmRecentTracksPayload,
} from './lastfm.js';

describe('Last.fm service helpers', () => {
  it('normalizes usernames and full Last.fm profile URLs', () => {
    expect(normalizeLastFmUsername('  richard_07  ')).toBe('richard_07');
    expect(normalizeLastFmUsername('https://www.last.fm/user/Cool-Listener/')).toBe('Cool-Listener');
    expect(normalizeLastFmUsername('http://last.fm/user/abc')).toBe('abc');
    expect(normalizeLastFmUsername('a')).toBeNull();
    expect(normalizeLastFmUsername('bad user name!')).toBeNull();
    expect(normalizeLastFmUsername('')).toBeNull();
  });

  it('builds profile URLs and masks API keys safely', () => {
    expect(buildLastFmProfileUrl('test_user')).toBe('https://www.last.fm/user/test_user');
    expect(maskLastFmApiKey('1234567890abcdef')).toBe('1234••••cdef');
    expect(maskLastFmApiKey('short')).toBe('••••••••');
    expect(maskLastFmApiKey(null)).toBeNull();
  });

  it('parses an active now-playing track and ignores generic placeholder cover', () => {
    const parsed = parseLastFmRecentTracksPayload({
      recenttracks: {
        track: [
          {
            name: 'Bohemian Rhapsody',
            artist: { '#text': 'Queen' },
            album: { '#text': 'A Night at the Opera' },
            url: 'https://www.last.fm/music/Queen/_/Bohemian+Rhapsody',
            image: [
              { size: 'medium', '#text': 'https://lastfm.freetls.fastly.net/i/u/64s/2a96cbd8b46e442fc41c2b86b821562f.png' },
              { size: 'large', '#text': 'https://lastfm.freetls.fastly.net/i/u/174s/realcover.jpg' },
            ],
            '@attr': { nowplaying: 'true' },
          },
        ],
      },
    }, 1_000);

    expect(parsed.isPlaying).toBe(true);
    expect(parsed.privateProfile).toBe(false);
    expect(parsed.track).toEqual({
      name: 'Bohemian Rhapsody',
      artist: 'Queen',
      album: 'A Night at the Opera',
      coverUrl: 'https://lastfm.freetls.fastly.net/i/u/174s/realcover.jpg',
      trackUrl: 'https://www.last.fm/music/Queen/_/Bohemian+Rhapsody',
    });
  });

  it('returns isPlaying=false when the latest track is not currently playing', () => {
    const parsed = parseLastFmRecentTracksPayload({
      recenttracks: {
        track: [
          {
            name: 'Old Song',
            artist: { '#text': 'Some Band' },
          },
        ],
      },
    }, 1_000);

    expect(parsed.isPlaying).toBe(false);
    expect(parsed.privateProfile).toBe(false);
    expect(parsed.track).toBeNull();
  });

  it('handles Last.fm error 17 (private listening history) gracefully', () => {
    const parsed = parseLastFmRecentTracksPayload({
      error: 17,
      message: 'Login: User required to be logged in',
    }, 1_000);

    expect(parsed.isPlaying).toBe(false);
    expect(parsed.privateProfile).toBe(true);
    expect(parsed.track).toBeNull();
  });
});
