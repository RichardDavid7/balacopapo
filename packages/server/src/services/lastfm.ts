import { eq } from 'drizzle-orm';
import type { LastFmNowPlayingResponse, LastFmNowPlayingTrack } from '@backspace/shared';
import { getDb, schema } from '../db/index.js';
import { config } from '../config.js';

const LASTFM_ENDPOINT = 'https://ws.audioscrobbler.com/2.0/';
const CACHE_TTL_MS = 25_000;
const REQUEST_TIMEOUT_MS = 5_000;
const LASTFM_USERNAME_RE = /^[a-zA-Z0-9_-]{2,32}$/;
// Last.fm returns this generic gray star image when an album has no artwork.
const LASTFM_PLACEHOLDER_HASH = '2a96cbd8b46e442fc41c2b86b821562f';

interface CacheEntry {
  expiresAt: number;
  isPlaying: boolean;
  privateProfile: boolean;
  track: LastFmNowPlayingTrack | null;
  cachedAt: number;
}

const recentTracksCache = new Map<string, CacheEntry>();
const inFlightRequests = new Map<string, Promise<CacheEntry>>();

export function normalizeLastFmUsername(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const trimmed = input.trim();
  if (!trimmed) return null;
  // Also allow pasting a full profile URL like https://www.last.fm/user/name
  const urlMatch = trimmed.match(/^https?:\/\/(?:www\.)?last\.fm\/user\/([a-zA-Z0-9_-]{2,32})\/?$/i);
  const candidate = urlMatch ? urlMatch[1]! : trimmed;
  return LASTFM_USERNAME_RE.test(candidate) ? candidate : null;
}

export function buildLastFmProfileUrl(username: string): string {
  return `https://www.last.fm/user/${encodeURIComponent(username)}`;
}

export function resolveLastFmApiKey(): { key: string | null; source: 'database' | 'env' | 'none' } {
  const db = getDb();
  const row = db
    .select({ lastfmApiKey: schema.instanceSettings.lastfmApiKey })
    .from(schema.instanceSettings)
    .where(eq(schema.instanceSettings.id, 1))
    .get();
  const dbKey = row?.lastfmApiKey?.trim() || null;
  if (dbKey) return { key: dbKey, source: 'database' };
  if (config.lastfmApiKey) return { key: config.lastfmApiKey, source: 'env' };
  return { key: null, source: 'none' };
}

export function maskLastFmApiKey(key: string | null): string | null {
  if (!key) return null;
  if (key.length <= 8) return '••••••••';
  return `${key.slice(0, 4)}••••${key.slice(-4)}`;
}

export function clearLastFmCache(username?: string): void {
  if (username) {
    recentTracksCache.delete(username.toLowerCase());
    return;
  }
  recentTracksCache.clear();
}

interface LastFmApiTrack {
  name?: string;
  url?: string;
  artist?: { '#text'?: string; name?: string };
  album?: { '#text'?: string };
  image?: Array<{ '#text'?: string; size?: string }>;
  '@attr'?: { nowplaying?: string };
}

interface LastFmApiResponse {
  error?: number;
  message?: string;
  recenttracks?: {
    track?: LastFmApiTrack | LastFmApiTrack[];
  };
}

function pickCoverUrl(images?: Array<{ '#text'?: string; size?: string }>): string | null {
  if (!Array.isArray(images) || images.length === 0) return null;
  const preferredSizes = ['large', 'extralarge', 'medium', 'small'];
  for (const size of preferredSizes) {
    const found = images.find((img) => img.size === size && typeof img['#text'] === 'string' && img['#text'].trim());
    if (found && found['#text'] && !found['#text'].includes(LASTFM_PLACEHOLDER_HASH)) {
      return found['#text'].trim();
    }
  }
  for (let i = images.length - 1; i >= 0; i--) {
    const url = images[i]?.['#text']?.trim();
    if (url && !url.includes(LASTFM_PLACEHOLDER_HASH)) return url;
  }
  return null;
}

export function parseLastFmRecentTracksPayload(
  payload: unknown,
  nowMs = Date.now(),
): CacheEntry {
  const data = (payload && typeof payload === 'object' ? payload : {}) as LastFmApiResponse;

  // Error 17: "Login: User required to be logged in" (user hid recent listening info).
  if (data.error === 17) {
    return {
      expiresAt: nowMs + CACHE_TTL_MS,
      isPlaying: false,
      privateProfile: true,
      track: null,
      cachedAt: nowMs,
    };
  }

  if (typeof data.error === 'number') {
    return {
      expiresAt: nowMs + CACHE_TTL_MS,
      isPlaying: false,
      privateProfile: false,
      track: null,
      cachedAt: nowMs,
    };
  }

  const rawTracks = data.recenttracks?.track;
  const firstTrack = Array.isArray(rawTracks) ? rawTracks[0] : rawTracks;
  if (!firstTrack || firstTrack['@attr']?.nowplaying !== 'true') {
    return {
      expiresAt: nowMs + CACHE_TTL_MS,
      isPlaying: false,
      privateProfile: false,
      track: null,
      cachedAt: nowMs,
    };
  }

  const name = typeof firstTrack.name === 'string' ? firstTrack.name.trim() : '';
  const artist = (firstTrack.artist?.['#text'] ?? firstTrack.artist?.name ?? '').trim();
  if (!name || !artist) {
    return {
      expiresAt: nowMs + CACHE_TTL_MS,
      isPlaying: false,
      privateProfile: false,
      track: null,
      cachedAt: nowMs,
    };
  }

  const album = firstTrack.album?.['#text']?.trim() || null;
  const trackUrl = typeof firstTrack.url === 'string' && firstTrack.url.startsWith('https://')
    ? firstTrack.url.trim()
    : null;

  return {
    expiresAt: nowMs + CACHE_TTL_MS,
    isPlaying: true,
    privateProfile: false,
    track: {
      name,
      artist,
      album,
      coverUrl: pickCoverUrl(firstTrack.image),
      trackUrl,
    },
    cachedAt: nowMs,
  };
}

async function fetchRecentTrackUncached(
  username: string,
  apiKey: string,
  fetchImpl: typeof fetch = fetch,
): Promise<CacheEntry> {
  const url = new URL(LASTFM_ENDPOINT);
  url.searchParams.set('method', 'user.getrecenttracks');
  url.searchParams.set('user', username);
  url.searchParams.set('api_key', apiKey);
  url.searchParams.set('format', 'json');
  url.searchParams.set('limit', '1');

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetchImpl(url.toString(), {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });
    const json = (await res.json().catch(() => ({}))) as unknown;
    return parseLastFmRecentTracksPayload(json);
  } catch {
    const now = Date.now();
    return {
      expiresAt: now + CACHE_TTL_MS,
      isPlaying: false,
      privateProfile: false,
      track: null,
      cachedAt: now,
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function getLastFmNowPlaying(
  username: string | null,
  showNowPlaying: boolean,
  fetchImpl: typeof fetch = fetch,
): Promise<LastFmNowPlayingResponse> {
  const { key: apiKey } = resolveLastFmApiKey();
  const configured = Boolean(apiKey);

  if (!username) {
    return {
      configured,
      username: null,
      profileUrl: null,
      showNowPlaying,
      isPlaying: false,
      privateProfile: false,
      track: null,
      cachedAt: null,
    };
  }

  const profileUrl = buildLastFmProfileUrl(username);
  if (!showNowPlaying || !apiKey) {
    return {
      configured,
      username,
      profileUrl,
      showNowPlaying,
      isPlaying: false,
      privateProfile: false,
      track: null,
      cachedAt: null,
    };
  }

  const cacheKey = username.toLowerCase();
  const now = Date.now();
  const cached = recentTracksCache.get(cacheKey);
  if (cached && cached.expiresAt > now) {
    return {
      configured,
      username,
      profileUrl,
      showNowPlaying,
      isPlaying: cached.isPlaying,
      privateProfile: cached.privateProfile,
      track: cached.track,
      cachedAt: cached.cachedAt,
    };
  }

  let pending = inFlightRequests.get(cacheKey);
  if (!pending) {
    pending = fetchRecentTrackUncached(username, apiKey, fetchImpl).then((entry) => {
      recentTracksCache.set(cacheKey, entry);
      return entry;
    }).finally(() => {
      inFlightRequests.delete(cacheKey);
    });
    inFlightRequests.set(cacheKey, pending);
  }

  const entry = await pending;
  return {
    configured,
    username,
    profileUrl,
    showNowPlaying,
    isPlaying: entry.isPlaying,
    privateProfile: entry.privateProfile,
    track: entry.track,
    cachedAt: entry.cachedAt,
  };
}
