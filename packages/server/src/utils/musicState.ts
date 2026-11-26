import crypto from 'node:crypto';
import type {
  MusicBotCommand,
  MusicBotCommandType,
  MusicLoopMode,
  MusicPlaybackStatus,
  MusicPlayerState,
  MusicSourceKind,
  MusicTrack,
} from '@backspace/shared';

interface ChannelMusicSession {
  state: MusicPlayerState;
  commands: MusicBotCommand[];
}

const DEFAULT_VOTE_SKIP_PCT = 50;
const MAX_QUEUE_LENGTH = 100;
const MAX_PENDING_COMMANDS = 100;

const sessions = new Map<string, ChannelMusicSession>();

export function clampVoteSkipPct(pct: number): number {
  if (!Number.isFinite(pct)) return DEFAULT_VOTE_SKIP_PCT;
  return Math.max(10, Math.min(100, Math.round(pct)));
}

export function requiredSkipVotes(listenerCount: number, thresholdPct: number): number {
  const listeners = Math.max(1, Math.floor(listenerCount));
  const pct = clampVoteSkipPct(thresholdPct);
  return Math.max(1, Math.ceil((listeners * pct) / 100));
}

function getOrCreateSession(channelId: string, listenerCount: number): ChannelMusicSession {
  let session = sessions.get(channelId);
  if (!session) {
    session = {
      state: {
        channelId,
        botConnected: false,
        botName: 'Balacopapo Música',
        status: 'idle',
        currentTrack: null,
        positionSec: 0,
        updatedAt: Date.now(),
        volume: 80,
        loopMode: 'off',
        queue: [],
        voteSkipThresholdPct: DEFAULT_VOTE_SKIP_PCT,
        skipVotes: [],
        listenerCount: Math.max(0, listenerCount),
      },
      commands: [],
    };
    sessions.set(channelId, session);
  } else {
    session.state.listenerCount = Math.max(0, listenerCount);
  }
  return session;
}

function pushCommand(
  session: ChannelMusicSession,
  type: MusicBotCommandType,
  issuedByUserId: string,
  payload?: Record<string, unknown>,
): void {
  session.commands.push({
    id: crypto.randomBytes(8).toString('hex'),
    channelId: session.state.channelId,
    type,
    payload,
    issuedByUserId,
    createdAt: Date.now(),
  });
  if (session.commands.length > MAX_PENDING_COMMANDS) {
    session.commands.splice(0, session.commands.length - MAX_PENDING_COMMANDS);
  }
}

function advanceTrack(session: ChannelMusicSession, issuedByUserId: string): void {
  const { state } = session;
  const previous = state.currentTrack;
  state.skipVotes = [];
  state.positionSec = 0;

  if (state.loopMode === 'queue' && previous) {
    state.queue.push(previous);
  }

  const next = state.queue.shift() ?? null;
  state.currentTrack = next;
  state.status = next ? 'playing' : 'idle';
  state.updatedAt = Date.now();
  pushCommand(session, 'skip', issuedByUserId, next ? { nextTrackId: next.id, url: next.url } : undefined);
}

export function inferMusicSource(url: string, explicit?: MusicSourceKind): MusicSourceKind {
  if (explicit) return explicit;
  const lower = url.toLowerCase();
  if (lower.includes('youtube.com') || lower.includes('youtu.be') || lower.includes('music.youtube.com')) {
    return 'youtube';
  }
  if (lower.includes('navidrome') || lower.includes('/rest/stream')) {
    return 'navidrome';
  }
  if (lower.startsWith('dlna://') || lower.includes(':8200/')) {
    return 'dlna';
  }
  return 'url';
}

export function getMusicState(channelId: string, listenerCount: number): MusicPlayerState {
  const session = getOrCreateSession(channelId, listenerCount);
  return { ...session.state, queue: [...session.state.queue], skipVotes: [...session.state.skipVotes] };
}

export function enqueueMusicTrack(
  channelId: string,
  input: {
    url: string;
    title?: string;
    artist?: string | null;
    source?: MusicSourceKind;
    durationSec?: number | null;
    thumbnailUrl?: string | null;
    requestedByUserId: string;
    requestedByName: string;
  },
  listenerCount: number,
): MusicPlayerState {
  const session = getOrCreateSession(channelId, listenerCount);
  const { state } = session;

  const trimmedUrl = input.url.trim();
  const track: MusicTrack = {
    id: crypto.randomBytes(8).toString('hex'),
    title: (input.title?.trim() || trimmedUrl).slice(0, 140),
    artist: input.artist?.trim() ? input.artist.trim().slice(0, 100) : null,
    source: inferMusicSource(trimmedUrl, input.source),
    url: trimmedUrl,
    durationSec: typeof input.durationSec === 'number' && Number.isFinite(input.durationSec) && input.durationSec > 0
      ? Math.round(input.durationSec)
      : null,
    thumbnailUrl: input.thumbnailUrl?.trim() || null,
    requestedByUserId: input.requestedByUserId,
    requestedByName: input.requestedByName.slice(0, 64),
    addedAt: Date.now(),
  };

  if (!state.currentTrack) {
    state.currentTrack = track;
    state.status = 'playing';
    state.positionSec = 0;
    state.skipVotes = [];
  } else if (state.queue.length < MAX_QUEUE_LENGTH) {
    state.queue.push(track);
  }
  state.updatedAt = Date.now();
  pushCommand(session, 'play', input.requestedByUserId, { track });

  return getMusicState(channelId, listenerCount);
}

export function toggleVoteSkip(
  channelId: string,
  userId: string,
  listenerCount: number,
): { state: MusicPlayerState; skipped: boolean; requiredVotes: number } {
  const session = getOrCreateSession(channelId, listenerCount);
  const { state } = session;
  const required = requiredSkipVotes(listenerCount, state.voteSkipThresholdPct);

  if (!state.currentTrack) {
    return { state: getMusicState(channelId, listenerCount), skipped: false, requiredVotes: required };
  }

  const idx = state.skipVotes.indexOf(userId);
  if (idx >= 0) {
    state.skipVotes.splice(idx, 1);
  } else {
    state.skipVotes.push(userId);
  }
  state.updatedAt = Date.now();

  if (state.skipVotes.length >= required) {
    advanceTrack(session, userId);
    return { state: getMusicState(channelId, listenerCount), skipped: true, requiredVotes: required };
  }

  return { state: getMusicState(channelId, listenerCount), skipped: false, requiredVotes: required };
}

export function updateMusicSettings(
  channelId: string,
  voteSkipThresholdPct: number,
  issuedByUserId: string,
  listenerCount: number,
): { state: MusicPlayerState; skipped: boolean } {
  const session = getOrCreateSession(channelId, listenerCount);
  const { state } = session;
  state.voteSkipThresholdPct = clampVoteSkipPct(voteSkipThresholdPct);
  state.updatedAt = Date.now();

  let skipped = false;
  if (state.currentTrack) {
    const required = requiredSkipVotes(listenerCount, state.voteSkipThresholdPct);
    if (state.skipVotes.length >= required) {
      advanceTrack(session, issuedByUserId);
      skipped = true;
    }
  }

  return { state: getMusicState(channelId, listenerCount), skipped };
}

export function applyMusicControl(
  channelId: string,
  issuedByUserId: string,
  action: 'pause' | 'resume' | 'skip' | 'stop' | 'volume' | 'loop' | 'seek' | 'queue_remove' | 'queue_clear',
  value: number | string | undefined,
  listenerCount: number,
): MusicPlayerState {
  const session = getOrCreateSession(channelId, listenerCount);
  const { state } = session;

  switch (action) {
    case 'pause':
      if (state.currentTrack) state.status = 'paused';
      pushCommand(session, 'pause', issuedByUserId);
      break;
    case 'resume':
      if (state.currentTrack) state.status = 'playing';
      pushCommand(session, 'resume', issuedByUserId);
      break;
    case 'skip':
      advanceTrack(session, issuedByUserId);
      return getMusicState(channelId, listenerCount);
    case 'stop':
      state.currentTrack = null;
      state.queue = [];
      state.skipVotes = [];
      state.positionSec = 0;
      state.status = 'idle';
      pushCommand(session, 'stop', issuedByUserId);
      break;
    case 'volume': {
      const vol = typeof value === 'number' && Number.isFinite(value)
        ? Math.max(0, Math.min(100, Math.round(value)))
        : state.volume;
      state.volume = vol;
      pushCommand(session, 'volume', issuedByUserId, { volume: vol });
      break;
    }
    case 'loop': {
      const mode: MusicLoopMode = value === 'track' || value === 'queue' || value === 'off' ? value : 'off';
      state.loopMode = mode;
      pushCommand(session, 'loop', issuedByUserId, { loopMode: mode });
      break;
    }
    case 'seek': {
      const sec = typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
      state.positionSec = sec;
      pushCommand(session, 'seek', issuedByUserId, { positionSec: sec });
      break;
    }
    case 'queue_remove': {
      if (typeof value === 'string') {
        state.queue = state.queue.filter((t) => t.id !== value);
        pushCommand(session, 'queue_remove', issuedByUserId, { trackId: value });
      }
      break;
    }
    case 'queue_clear':
      state.queue = [];
      pushCommand(session, 'queue_clear', issuedByUserId);
      break;
  }

  state.updatedAt = Date.now();
  return getMusicState(channelId, listenerCount);
}

export function applyBotStateReport(
  channelId: string,
  patch: Partial<{
    botConnected: boolean;
    botName: string;
    status: MusicPlaybackStatus;
    currentTrack: MusicTrack | null;
    positionSec: number;
    volume: number;
    loopMode: MusicLoopMode;
    queue: MusicTrack[];
  }>,
  listenerCount: number,
): MusicPlayerState {
  const session = getOrCreateSession(channelId, listenerCount);
  const { state } = session;
  const prevTrackId = state.currentTrack?.id ?? null;

  if (typeof patch.botConnected === 'boolean') state.botConnected = patch.botConnected;
  if (typeof patch.botName === 'string' && patch.botName.trim()) state.botName = patch.botName.trim().slice(0, 64);
  if (patch.status === 'idle' || patch.status === 'playing' || patch.status === 'paused') state.status = patch.status;
  if (patch.currentTrack !== undefined) state.currentTrack = patch.currentTrack;
  if (typeof patch.positionSec === 'number' && Number.isFinite(patch.positionSec)) {
    state.positionSec = Math.max(0, Math.floor(patch.positionSec));
  }
  if (typeof patch.volume === 'number' && Number.isFinite(patch.volume)) {
    state.volume = Math.max(0, Math.min(100, Math.round(patch.volume)));
  }
  if (patch.loopMode === 'off' || patch.loopMode === 'track' || patch.loopMode === 'queue') {
    state.loopMode = patch.loopMode;
  }
  if (Array.isArray(patch.queue)) {
    state.queue = patch.queue.slice(0, MAX_QUEUE_LENGTH);
  }

  // Clear skip votes automatically whenever the current track changes.
  if ((state.currentTrack?.id ?? null) !== prevTrackId) {
    state.skipVotes = [];
  }
  state.updatedAt = Date.now();
  return getMusicState(channelId, listenerCount);
}

export function drainBotCommands(channelId: string): MusicBotCommand[] {
  const session = sessions.get(channelId);
  if (!session || session.commands.length === 0) return [];
  return session.commands.splice(0);
}

export function resetMusicSessionsForTests(): void {
  sessions.clear();
}
