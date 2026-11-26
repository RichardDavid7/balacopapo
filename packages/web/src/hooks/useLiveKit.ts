import { useState, useCallback, useRef, useEffect } from 'react';
import {
  Room,
  RoomEvent,
  Track,
  Participant,
  RemoteParticipant,
  RemoteTrackPublication,
  RemoteTrack,
  RemoteAudioTrack,
  ConnectionState,
  ConnectionQuality,
  LocalAudioTrack,
  LocalTrackPublication,
  DisconnectReason,
  TrackEvent,
  VideoQuality,
} from 'livekit-client';
import { getApiForOrigin, getChannelOrigin, getMyUserIdForOrigin, useSpaceStore } from '../stores/spaceStore';
import { homeIdentityOf } from '../utils/identity';
import { refreshStreamHostLimits, useStreamHostLimits } from '../utils/streamHostLimits';
import { wsSend } from './useWebSocket';
import { useVoiceStore, type AudioMode, type VoiceConnectionQuality } from '../stores/voiceStore';
import { selectStreamingLimits, useSettingsStore } from '../stores/settingsStore';
import { myRowForOrigin } from '../stores/authStore';
import { useUIStore } from '../stores/uiStore';
import i18n from '../i18n';
import type { User } from '@backspace/shared';
import { broadcastVoiceStatus, clearSpaceVoiceForDmCall } from '../utils/voice';
import { consumeIntentionalCameraOff, markIntentionalCameraOff } from '../utils/voiceActions';
import { dmCallChannelId, dmCallOrigin, dmCallRoomKey, voiceSessionOrigin } from '../utils/dmCall';
import { AudioManager } from '../audio/AudioManager';
import { SpeakingDetector } from '../audio/SpeakingDetector';
import { parseStreamPointer } from '../utils/streamPointerProtocol';
import { useStreamPointerStore } from '../stores/streamPointerStore';
import { useP2PStore } from '../stores/p2pStore';
import { P2PMeshManager } from '../p2p/P2PMeshManager';
import { resolveAudioPolicyHierarchy } from '../utils/audioPolicy';
import {
  CAMERA_OVERDRIVE,
  buildScreenShareOptions,
  applyOverdrive,
  scheduleScreenShareOverdrive,
  republishScreenShare,
  getRequestedPublishedScreenShareCodec,
  handleScreenShareUnpublished,
  handleScreenShareAudioUnpublished,
  settleScreenShareAfterReconnect,
  resolveNativeOverdrive,
  syncScreenShareAudio,
} from '../utils/screenShare';
import { encodeStreamWatch, parseShareSignal, parseStreamWatch, streamWatchFor, streamWatchKey } from '../utils/streamWatchProtocol';
import { decodeSoundboardPlay, isSafeSoundboardFileUrl } from '../utils/soundboardProtocol';
import { StreamRepublishTracker } from '../utils/streamRepublish';
import { StreamResumeMemory, type RememberedStream } from '../utils/streamResume';
import { getMediaStreamTrack } from '../utils/livekitInternals';
import { deactivate as deactivateHwOverdrive } from '../utils/hwOverdrive';

let _activeRoom: Room | null = null;
/**
 * The republish state of each room's remote sharers. Keyed by the room so a
 * handler, a timer or `updateParticipants` always reaches the tracker of the
 * room it belongs to, never the one that happens to be current.
 */
const _republishTrackers = new WeakMap<Room, StreamRepublishTracker>();
/** The shares each room's viewer may watch again after a full reconnect (`StreamResumeMemory`). */
const _resumeMemories = new WeakMap<Room, StreamResumeMemory>();
/**
 * Audio session lease owned by each live `Room`. Keyed by room so a late
 * `Disconnected` event or teardown on an old room can only release its own
 * lease and never consume the lease of a pending or replacement connection.
 */
const _roomAudioLeases = new WeakMap<Room, () => void>();

function releaseRoomAudioLease(room: Room | null): void {
  if (!room) return;
  const release = _roomAudioLeases.get(room);
  if (release) {
    _roomAudioLeases.delete(room);
    release();
  }
}

/** Forget a room's per-sharer stream state: the room is being left. */
function clearRoomStreamState(room: Room): void {
  _republishTrackers.get(room)?.clear();
  _resumeMemories.get(room)?.clear();
}
/**
 * Serialises screen-share / camera track updates.
 *
 * `republishScreenShare` clears the published-codec marker before it awaits the
 * swap. A second effect run landing inside that window reads no codec, decides
 * nothing changed, and skips the republish — so toggling the codec pill twice
 * quickly leaves what is actually published disagreeing with the UI until some
 * later config change happens to correct it. Chaining the runs keeps every read
 * of that marker outside the window where it is being rewritten.
 */
let _activeTrackUpdate: Promise<void> = Promise.resolve();

function toVoiceConnectionQuality(quality: ConnectionQuality): VoiceConnectionQuality {
  switch (quality) {
    case ConnectionQuality.Excellent: return 'excellent';
    case ConnectionQuality.Good: return 'good';
    case ConnectionQuality.Poor: return 'poor';
    case ConnectionQuality.Lost: return 'lost';
    case ConnectionQuality.Unknown: return 'unknown';
    default: return 'unknown';
  }
}

export function getActiveRoom(): Room | null {
  return _activeRoom;
}

export interface ParticipantInfo {
  identity: string;
  userId: string;
  username: string;
  homeUserId: string | null;
  isMuted: boolean;
  isDeafened: boolean;
  isCameraOn: boolean;
  isScreenSharing: boolean;
  isLocal: boolean;
  audioTrack: MediaStreamTrack | null;
  videoTrack: MediaStreamTrack | null;
  screenTrack: MediaStreamTrack | null;
  screenAudioTrack: MediaStreamTrack | null;
  lkVideoTrack: Track | null;   // LiveKit Track for attach/detach (adaptive stream)
  lkScreenTrack: Track | null;  // LiveKit Track for attach/detach (adaptive stream)
  cachedUser: User | null;   // Hydrated User from member lookup, carried forward across space switches
}

export interface UserTile {
  kind: 'user';
  key: string;                        // participant.identity
  participant: ParticipantInfo;
  videoTrack: MediaStreamTrack | null; // camera only
  audioTrack: MediaStreamTrack | null; // mic
  lkVideoTrack: Track | null;         // LiveKit Track for attach/detach
}

export interface StreamTile {
  kind: 'stream';
  key: string;                        // `${identity}:stream`
  participant: ParticipantInfo;
  screenTrack: MediaStreamTrack | null;
  screenAudioTrack: MediaStreamTrack | null;
  lkScreenTrack: Track | null;        // LiveKit Track for attach/detach
}

export type GridTile = UserTile | StreamTile;

export function deriveGridTiles(participants: ParticipantInfo[]): GridTile[] {
  const tiles: GridTile[] = [];
  for (const p of participants) {
    const hasLiveVideo = p.isCameraOn && p.videoTrack?.readyState === 'live';
    tiles.push({
      kind: 'user',
      key: p.identity,
      participant: p,
      videoTrack: hasLiveVideo ? p.videoTrack : null,
      audioTrack: p.audioTrack,
      lkVideoTrack: hasLiveVideo ? p.lkVideoTrack : null,
    });
    if (p.isScreenSharing) {
      tiles.push({
        kind: 'stream',
        key: `${p.identity}:stream`,
        participant: p,
        screenTrack: p.screenTrack,
        screenAudioTrack: p.screenAudioTrack,
        lkScreenTrack: p.lkScreenTrack,
      });
    }
  }
  return tiles;
}

export function setStreamSubscription(room: Room | null, targetIdentity: string, subscribed: boolean) {
  if (!room) return;
  const rp = room.remoteParticipants.get(targetIdentity);
  if (!rp) return;
  rp.trackPublications.forEach((pub) => {
    if (pub.source === Track.Source.ScreenShare || pub.source === Track.Source.ScreenShareAudio) {
      const remotePub = pub as RemoteTrackPublication;
      remotePub.setSubscribed(subscribed);
      if (subscribed && pub.source === Track.Source.ScreenShare) {
        remotePub.setVideoQuality?.(VideoQuality.HIGH);
      }
    }
  });
}

export function setCameraSubscription(room: Room | null, targetIdentity: string, subscribed: boolean) {
  if (!room) return;
  const rp = room.remoteParticipants.get(targetIdentity);
  if (!rp) return;
  rp.trackPublications.forEach((pub) => {
    if (pub.source === Track.Source.Camera) {
      (pub as RemoteTrackPublication).setSubscribed(subscribed);
    }
  });
}

export function parseIdentity(identity: string): { userId: string; username: string } {
  const parts = identity.split(':');
  return { userId: parts[0] ?? identity, username: parts[1] ?? identity };
}

/**
 * The userId this client knows a LiveKit participant by. In a federated DM call
 * the identity carries the member's home id, which is resolved to the DM
 * member's local id; otherwise it is the identity's own id. `updateParticipants`
 * lists participants under it, and stream state (`watchingStreams`, stream
 * volume and mute) is keyed by it, since `StreamTile` watches by the listed id.
 * Reads only the DM membership, never the participant list, so it still
 * resolves while a participant who is leaving has already been dropped from it.
 */
function resolveParticipantUserId(identity: string): string {
  const rawId = parseIdentity(identity).userId;
  const activeDmCall = useVoiceStore.getState().activeDmCall;
  if (!activeDmCall) return rawId;
  const dmId = dmCallChannelId(activeDmCall);
  const dmChannel = dmId ? useSpaceStore.getState().dmChannels.find((d) => d.id === dmId) : undefined;
  // The identity names the member by their row id here or by their home id.
  const origin = dmId ? getChannelOrigin(dmId) : dmCallOrigin(activeDmCall);
  const match = dmChannel?.members.find((m) => m.id === rawId || homeIdentityOf(m, origin)?.userId === rawId);
  return match?.id ?? rawId;
}

/**
 * A remote screen share ended. When this viewer was watching it, the share is
 * remembered for a while with its volume and mute (`StreamResumeMemory`), in
 * case a full reconnect ended it.
 */
function rememberWatchedShare(memory: StreamResumeMemory, identity: string): void {
  const userId = resolveParticipantUserId(identity);
  const state = useVoiceStore.getState();
  if (!state.watchingStreams.has(userId)) return;
  memory.rememberEnded(identity, { volume: state.streamVolumes.get(userId), muted: state.streamMutes.get(userId) });
}

/**
 * Watch a remembered share again once it is published: the watch, its volume
 * and mute, the subscription, and the `stream_watch` ping that puts this
 * viewer back in the sharer's watcher set (a full reconnect on either side
 * dropped it there). No cue plays here: nobody clicked anything.
 */
function resumeRemoteStream(room: Room, identity: string, stream: RememberedStream): void {
  const userId = resolveParticipantUserId(identity);
  const state = useVoiceStore.getState();
  state.watchStream(userId);
  if (stream.volume !== undefined) state.setStreamVolume(userId, stream.volume);
  if (stream.muted !== undefined) state.setStreamMute(userId, stream.muted);
  setStreamSubscription(room, identity, true);
  room.localParticipant
    .publishData(encodeStreamWatch(streamWatchFor({ userId, identity }, true)), { reliable: true })
    .catch((err: unknown) => console.warn('[LiveKit] Could not tell the sharer the watch resumed:', err));
}

/** Resume the remembered share of `identity` when it is published now. */
function resumeIfPublished(room: Room, memory: StreamResumeMemory, identity: string): void {
  const participant = room.remoteParticipants.get(identity);
  if (!participant) return;
  const published = [...participant.trackPublications.values()].some((pub) => pub.source === Track.Source.ScreenShare);
  if (!published) return;
  const stream = memory.takeOnPublication(identity);
  if (stream) resumeRemoteStream(room, identity, stream);
}

/** A remote screen share ended: drop the watch and the per-stream audio settings. */
function endRemoteStream(identity: string): void {
  const userId = resolveParticipantUserId(identity);
  const state = useVoiceStore.getState();
  state.unwatchStream(userId);
  state.clearStreamVolume(userId);
  state.clearStreamMute(userId);
}

let _connectGeneration = 0;

/** Null-safe Room.disconnect() wrapper — lets the SDK tear down its own internals cleanly. */
function destroyRoom(room: Room | null): Promise<void> | void {
  if (!room) return;
  return room.disconnect();
}

export interface AudioPublishConfig {
  audioMode: AudioMode;
  audioStereo: boolean;
  audioBitrate: number;
}

export interface EffectiveAudioInputs {
  audioMode: AudioMode;
  audioStereo: boolean;
  audioBitrateAuto: boolean;
  audioBitrate: number;
  spaceAudioBitrateKbps?: number | null;
  spaceMaxAudioBitrateKbps?: number | null;
  spaceAllowMusicMode?: boolean | null;
  spaceAllowStereoAudio?: boolean | null;
  categoryAudioBitrateKbps?: number | null;
  categoryMaxAudioBitrateKbps?: number | null;
  categoryAllowMusicMode?: boolean | null;
  categoryAllowStereoAudio?: boolean | null;
  channelAudioBitrateKbps?: number | null;
  channelMaxAudioBitrateKbps?: number | null;
  channelAllowMusicMode?: boolean | null;
  channelAllowStereoAudio?: boolean | null;
  instanceDefaultAudioBitrateKbps?: number;
  instanceMaxAudioBitrateKbps?: number;
  instanceAllowMusicMode?: boolean;
  instanceAllowStereoAudio?: boolean;
}

/**
 * Resolves the effective Opus encoding settings for the current voice room
 * across the full hierarchy:
 *   Instance → Space → Category (Subcategory) → Channel → User
 *
 * - Automatic bitrate follows the most specific configured default
 *   (Channel > Category > Space > Instance), clamped to the effective cap.
 * - Manual bitrate is capped at `min(instanceMax, spaceMax, categoryMax, channelMax)`.
 * - Music mode and Stereo are permitted only when every level in the hierarchy allows them.
 */
export function resolveEffectiveAudioConfig(input: EffectiveAudioInputs): AudioPublishConfig {
  const policy = resolveAudioPolicyHierarchy({
    instance: {
      defaultAudioBitrateKbps: input.instanceDefaultAudioBitrateKbps,
      maxAudioBitrateKbps: input.instanceMaxAudioBitrateKbps,
      allowMusicMode: input.instanceAllowMusicMode,
      allowStereoAudio: input.instanceAllowStereoAudio,
    },
    space: {
      audioBitrateKbps: input.spaceAudioBitrateKbps,
      maxAudioBitrateKbps: input.spaceMaxAudioBitrateKbps,
      allowMusicMode: input.spaceAllowMusicMode,
      allowStereoAudio: input.spaceAllowStereoAudio,
    },
    category: {
      audioBitrateKbps: input.categoryAudioBitrateKbps,
      maxAudioBitrateKbps: input.categoryMaxAudioBitrateKbps,
      allowMusicMode: input.categoryAllowMusicMode,
      allowStereoAudio: input.categoryAllowStereoAudio,
    },
    channel: {
      audioBitrateKbps: input.channelAudioBitrateKbps,
      maxAudioBitrateKbps: input.channelMaxAudioBitrateKbps,
      allowMusicMode: input.channelAllowMusicMode,
      allowStereoAudio: input.channelAllowStereoAudio,
    },
  });

  const effectiveBitrate = input.audioBitrateAuto
    ? policy.defaultBitrateKbps
    : Math.max(8, Math.min(policy.maxBitrateKbps, input.audioBitrate));

  const effectiveMode: AudioMode = input.audioMode === 'music' && policy.allowMusicMode ? 'music' : 'voice';
  const effectiveStereo = input.audioStereo && policy.allowStereoAudio;

  return {
    audioMode: effectiveMode,
    audioStereo: effectiveStereo,
    audioBitrate: effectiveBitrate,
  };
}

/**
 * Builds LiveKit `publishTrack` options for the microphone track from the
 * resolved Opus audio settings:
 * - `audioMode === 'voice'`: DTX enabled (bandwidth savings on silence), RED
 *   enabled when mono for packet-loss resilience.
 * - `audioMode === 'music'`: DTX and RED disabled so full bitrate goes to
 *   uncolored, continuous audio without silence gating.
 * - `audioStereo`: sets `forceStereo` (and disables RED, which is mono-only).
 * - `audioBitrate`: target Opus max bitrate in kbps, converted to bps.
 */
/** Minimum jitter buffer (ms) for screen-share audio so video keyframe bursts never starve playback. */
export const SCREEN_SHARE_AUDIO_MIN_JITTER_MS = 120;

export function effectiveJitterBufferMs(targetMs: number, source?: Track.Source): number {
  if (source === Track.Source.ScreenShareAudio) {
    return Math.max(SCREEN_SHARE_AUDIO_MIN_JITTER_MS, targetMs);
  }
  return targetMs;
}

export function applyReceiverJitterBuffer(
  track: { receiver?: RTCRtpReceiver } | RemoteAudioTrack | RemoteTrack,
  effectiveMs: number,
): void {
  const receiver = (track as unknown as { receiver?: RTCRtpReceiver }).receiver;
  if (!receiver) return;
  try {
    const r = receiver as RTCRtpReceiver & {
      jitterBufferTarget?: number | null;
      playoutDelayHint?: number | null;
    };
    if ('jitterBufferTarget' in r) {
      r.jitterBufferTarget = effectiveMs > 0 ? effectiveMs : null;
    }
    if ('playoutDelayHint' in r) {
      r.playoutDelayHint = effectiveMs > 0 ? effectiveMs / 1000 : null;
    }
  } catch {
    // Non-fatal on browsers that restrict jitterBufferTarget writes
  }
}

export function applyAudioReceiverJitterBuffer(
  track: RemoteAudioTrack,
  targetMs: number,
  source?: Track.Source,
): void {
  const effectiveMs = effectiveJitterBufferMs(targetMs, source ?? track.source);
  applyReceiverJitterBuffer(track, effectiveMs);
}

/**
 * Applies the synchronized A/V stream buffer (`streamBufferMs`) to every remote
 * screen-share video and screen-share audio receiver in the active room so
 * video keyframes and stream audio share the same playout delay target.
 */
export function applyStreamBufferToRoom(room: Room | null, streamBufferMs: number): void {
  if (!room) return;
  room.remoteParticipants.forEach((rp) => {
    rp.trackPublications.forEach((pub) => {
      if (!pub.track) return;
      if (pub.source === Track.Source.ScreenShare || pub.source === Track.Source.ScreenShareAudio) {
        // Apply the exact same playout delay target to both stream video & stream audio so A/V stays synchronized.
        applyReceiverJitterBuffer(pub.track as RemoteTrack, streamBufferMs);
      }
    });
  });
}

export function buildAudioPublishOptions(cfg: AudioPublishConfig) {
  const isVoice = cfg.audioMode === 'voice';
  return {
    name: 'microphone',
    source: Track.Source.Microphone,
    audioPreset: { maxBitrate: cfg.audioBitrate * 1000 },
    dtx: isVoice,
    red: isVoice && !cfg.audioStereo,
    forceStereo: cfg.audioStereo,
  } as const;
}

function getEffectiveAudioConfigForCurrentRoom(): AudioPublishConfig {
  const vs = useVoiceStore.getState();
  const cvId = vs.currentVoiceChannelId;
  const spaceState = useSpaceStore.getState();
  const channel = cvId ? spaceState.channels?.find((c) => c.id === cvId) : undefined;
  const category = channel?.categoryId
    ? spaceState.categories?.find((cat) => cat.id === channel.categoryId)
    : undefined;
  const space = channel?.spaceId
    ? spaceState.spaces?.find((sp) => sp.id === channel.spaceId)
    : undefined;
  const origin = cvId ? getChannelOrigin(cvId) : '';
  const settingsState = useSettingsStore.getState();
  const limits = (origin ? settingsState.streamingLimitsByOrigin[origin] : settingsState.streamingLimits)
    ?? settingsState.streamingLimits;
  return resolveEffectiveAudioConfig({
    audioMode: vs.audioMode,
    audioStereo: vs.audioStereo,
    audioBitrateAuto: vs.audioBitrateAuto,
    audioBitrate: vs.audioBitrate,
    spaceAudioBitrateKbps: space?.audioBitrateKbps ?? null,
    spaceMaxAudioBitrateKbps: space?.maxAudioBitrateKbps ?? null,
    spaceAllowMusicMode: space?.allowMusicMode ?? null,
    spaceAllowStereoAudio: space?.allowStereoAudio ?? null,
    categoryAudioBitrateKbps: category?.audioBitrateKbps ?? null,
    categoryMaxAudioBitrateKbps: category?.maxAudioBitrateKbps ?? null,
    categoryAllowMusicMode: category?.allowMusicMode ?? null,
    categoryAllowStereoAudio: category?.allowStereoAudio ?? null,
    channelAudioBitrateKbps: channel?.audioBitrateKbps ?? null,
    channelMaxAudioBitrateKbps: channel?.maxAudioBitrateKbps ?? null,
    channelAllowMusicMode: channel?.allowMusicMode ?? null,
    channelAllowStereoAudio: channel?.allowStereoAudio ?? null,
    instanceDefaultAudioBitrateKbps: limits?.defaultAudioBitrateKbps,
    instanceMaxAudioBitrateKbps: limits?.maxAudioBitrateKbps,
    instanceAllowMusicMode: limits?.allowMusicMode,
    instanceAllowStereoAudio: limits?.allowStereoAudio,
  });
}

/**
 * Ensures a fresh microphone track from the AudioManager pipeline is published
 * to the supplied room. If the existing publication is already current (live
 * MediaStreamTrack matching the latest AudioManager streamGeneration and Opus
 * publish signature), this is a no-op apart from un-muting. Otherwise the stale
 * track is unpublished and a cloned destination-node track is published in its
 * place with the current Opus encoding options.
 */
async function republishMicrophone(
  r: Room,
  lastMicGenRef: { current: number },
  lastPublishSigRef?: { current: string },
): Promise<void> {
  const audioManager = AudioManager.getInstance();
  const currentGen = audioManager.getStreamGeneration();
  const effective = getEffectiveAudioConfigForCurrentRoom();
  const publishSig = `${effective.audioMode}:${effective.audioStereo}:${effective.audioBitrate}`;

  const micPub = r.localParticipant.getTrackPublications()
    .find(p => p.source === Track.Source.Microphone);

  if (micPub?.track) {
    // Track already published — check if it's still current
    const sameOpus = !lastPublishSigRef || lastPublishSigRef.current === publishSig;
    if (micPub.track.mediaStreamTrack?.readyState === 'live' && lastMicGenRef.current === currentGen && sameOpus) {
      // Current and live — just unmute if needed
      if (micPub.isMuted) {
        await r.localParticipant.setMicrophoneEnabled(true);
      }
      return;
    }
    // Track is stale (device, constraint, or Opus config change) — replace it
    await r.localParticipant.unpublishTrack(micPub.track as LocalAudioTrack);
  }

  // Publish fresh track from AudioManager pipeline
  const audioTrack = audioManager.getFreshTrack();
  if (!audioTrack) return;

  const publishOpts = buildAudioPublishOptions(effective);
  console.log('[LiveKit] Publishing fresh microphone track (gen:', currentGen, 'opus:', publishSig, ')');
  await r.localParticipant.publishTrack(audioTrack, publishOpts);
  lastMicGenRef.current = currentGen;
  if (lastPublishSigRef) lastPublishSigRef.current = publishSig;
}

export function useLiveKit() {
  const [room, setRoom] = useState<Room | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [connectionState, setConnectionState] = useState<ConnectionState>(ConnectionState.Disconnected);
  const [connectedChannelId, setConnectedChannelId] = useState<string | null>(null);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const roomRef = useRef<Room | null>(null);
  const connectedChannelRef = useRef<string | null>(null);
  const switchCameraGenRef = useRef(0);
  
  const isMuted = useVoiceStore((s) => s.isMuted);
  const isDeafened = useVoiceStore((s) => s.isDeafened);
  const isCameraOn = useVoiceStore((s) => s.isCameraOn);
  const isScreenSharing = useVoiceStore((s) => s.isScreenSharing);
  const screenShareConfig = useVoiceStore((s) => s.screenShareConfig);
  // The host's limits shape the effective config, so a document that arrives
  // after the share started must reach the running encoder too.
  const { limits: streamHostLimits } = useStreamHostLimits();
  const streamWatcherCount = useVoiceStore((s) => s.streamWatchers.size);
  const remoteStreamCount = useVoiceStore(
    (s) => s.participants.filter((p) => !p.isLocal && p.isScreenSharing).length,
  );

  // Dynamically re-adjust local screen-share bitrate ceiling when watchers,
  // simultaneous streams, or the instance upload budget change.
  useEffect(() => {
    const r = roomRef.current;
    if (!r || !isScreenSharing) return;
    if (!streamHostLimits?.streamBandwidthBudgetKbps) return;
    scheduleScreenShareOverdrive(r);
  }, [isScreenSharing, streamWatcherCount, remoteStreamCount, streamHostLimits?.streamBandwidthBudgetKbps]);
  const voiceUserStates = useVoiceStore((s) => s.voiceUserStates);
  const spaceMutedUserIds = useVoiceStore((s) => s.spaceMutedUserIds);
  const spaceDeafenedUserIds = useVoiceStore((s) => s.spaceDeafenedUserIds);
  const permissionMutedUserIds = useVoiceStore((s) => s.permissionMutedUserIds);
  const inputVolume = useVoiceStore((s) => s.inputVolume);
  const inputDeviceId = useVoiceStore((s) => s.inputDeviceId);
  const cameraDeviceId = useVoiceStore((s) => s.cameraDeviceId);
  const micPermissionDenied = useVoiceStore((s) => s.micPermissionDenied);
  const echoCancellation = useVoiceStore((s) => s.echoCancellation);
  const noiseSuppression = useVoiceStore((s) => s.noiseSuppression);
  const autoGainControl = useVoiceStore((s) => s.autoGainControl);
  const rnnoiseEnabled = useVoiceStore((s) => s.rnnoiseEnabled);
  const audioMode = useVoiceStore((s) => s.audioMode);
  const audioStereo = useVoiceStore((s) => s.audioStereo);
  const audioBitrateAuto = useVoiceStore((s) => s.audioBitrateAuto);
  const audioBitrate = useVoiceStore((s) => s.audioBitrate);
  const currentVoiceChannelId = useVoiceStore((s) => s.currentVoiceChannelId);
  const [activeChannelAudio, setActiveChannelAudio] = useState<{
    bitrate: number | null;
    maxBitrate: number | null;
    allowMusic: boolean | null;
    allowStereo: boolean | null;
  }>(() => {
    const ch = currentVoiceChannelId
      ? useSpaceStore.getState().channels?.find((c) => c.id === currentVoiceChannelId)
      : undefined;
    return {
      bitrate: ch?.audioBitrateKbps ?? null,
      maxBitrate: ch?.maxAudioBitrateKbps ?? null,
      allowMusic: ch?.allowMusicMode ?? null,
      allowStereo: ch?.allowStereoAudio ?? null,
    };
  });
  useEffect(() => {
    const syncChannelAudio = () => {
      const spaceState = useSpaceStore.getState();
      const ch = currentVoiceChannelId
        ? spaceState.channels?.find((c) => c.id === currentVoiceChannelId)
        : undefined;
      const cat = ch?.categoryId
        ? spaceState.categories?.find((c) => c.id === ch.categoryId)
        : undefined;
      const sp = ch?.spaceId
        ? spaceState.spaces?.find((s) => s.id === ch.spaceId)
        : undefined;
      // Resolve space → category → channel (independent of instance limits,
      // which are tracked separately via `streamHostLimits`).
      const resolved = resolveAudioPolicyHierarchy({
        space: sp,
        category: cat,
        channel: ch,
      });
      const hasAnyDefault = ch?.audioBitrateKbps != null || cat?.audioBitrateKbps != null || sp?.audioBitrateKbps != null;
      const hasAnyMax = ch?.maxAudioBitrateKbps != null || cat?.maxAudioBitrateKbps != null || sp?.maxAudioBitrateKbps != null;
      const nextBitrate = hasAnyDefault ? resolved.defaultBitrateKbps : null;
      const nextMaxBitrate = hasAnyMax ? resolved.maxBitrateKbps : null;
      const nextAllowMusic = resolved.allowMusicMode ? null : false;
      const nextAllowStereo = resolved.allowStereoAudio ? null : false;
      setActiveChannelAudio((prev) => (
        prev.bitrate === nextBitrate
        && prev.maxBitrate === nextMaxBitrate
        && prev.allowMusic === nextAllowMusic
        && prev.allowStereo === nextAllowStereo
          ? prev
          : { bitrate: nextBitrate, maxBitrate: nextMaxBitrate, allowMusic: nextAllowMusic, allowStereo: nextAllowStereo }
      ));
    };
    syncChannelAudio();
    if (typeof useSpaceStore.subscribe !== 'function') return;
    return useSpaceStore.subscribe(syncChannelAudio);
  }, [currentVoiceChannelId]);
  const activeChannelAudioBitrate = activeChannelAudio.bitrate;
  const activeChannelMaxAudioBitrate = activeChannelAudio.maxBitrate;
  const activeChannelAllowMusic = activeChannelAudio.allowMusic;
  const activeChannelAllowStereo = activeChannelAudio.allowStereo;

  const lastMicGenRef = useRef(0);
  const lastPublishSigRef = useRef('');
  // Holds the audio session lease of an in-flight `connect()` until ownership
  // transfers to the newly created `Room` in `_roomAudioLeases`.
  const pendingAudioLeaseRef = useRef<{ gen: number; release: () => void } | null>(null);
  const releasePendingAudioLease = useCallback((expectedGen?: number) => {
    const pending = pendingAudioLeaseRef.current;
    if (!pending) return;
    if (expectedGen !== undefined && pending.gen !== expectedGen) return;
    pendingAudioLeaseRef.current = null;
    pending.release();
  }, []);

  const updateParticipants = useCallback(() => {
    const r = roomRef.current;
    if (!r) return;
    const republish = _republishTrackers.get(r);
    // The local share's lifecycle, owned by utils/screenShare: true from a
    // successful publish until the share stops, and so across a republish.
    const localShareLive = useVoiceStore.getState().isScreenSharing;

    // Carry-forward: snapshot previous participants for cachedUser preservation
    const prevParticipants = useVoiceStore.getState().participants;
    const prevCacheMap = new Map<string, User | null>();
    for (const prev of prevParticipants) {
      prevCacheMap.set(prev.identity, prev.cachedUser);
    }

    const allParticipants: ParticipantInfo[] = [];
    const processParticipant = (p: Participant, isLocal: boolean) => {
      if (!p.identity) return;
      const { username } = parseIdentity(p.identity);
      const userId = resolveParticipantUserId(p.identity);

      const memberMatch = useSpaceStore.getState().members.find(m => m.userId === userId);
      let cachedUser: User | null;
      let homeUserId: string | null;

      if (memberMatch) {
        // Fresh data available — use and update cache
        cachedUser = memberMatch.user as User;
        homeUserId = memberMatch.user.homeUserId ?? null;
      } else if (isLocal) {
        // Local user safety net: the user's row as the instance hosting the
        // call issues it, the origin `useVoiceParticipantMeta` reads it with.
        cachedUser = myRowForOrigin(voiceSessionOrigin(useVoiceStore.getState()));
        homeUserId = cachedUser?.homeUserId ?? null;
      } else {
        // Companion bot metadata (e.g. Balacopapo Utilidades music bot) or space-switch carry-forward
        let botUser: User | null = null;
        if (p.metadata) {
          try {
            const meta = JSON.parse(p.metadata) as { bot?: boolean; displayName?: string; avatar?: string | null };
            if (meta?.bot) {
              const label = meta.displayName || p.name || username;
              botUser = {
                id: userId,
                username: label,
                displayName: label,
                avatar: meta.avatar ?? null,
                avatarColor: '#7c5cff',
                status: 'online',
              } as User;
            }
          } catch {
            /* non-JSON metadata */
          }
        }
        cachedUser = botUser ?? prevCacheMap.get(p.identity) ?? null;
        homeUserId = cachedUser?.homeUserId ?? null;
      }
      let audioTrack: MediaStreamTrack | null = null;
      let videoTrack: MediaStreamTrack | null = null;
      let screenTrack: MediaStreamTrack | null = null;
      let screenAudioTrack: MediaStreamTrack | null = null;
      let lkVideoTrack: Track | null = null;
      let lkScreenTrack: Track | null = null;
      let hasScreenSharePublication = false;
      let hasCameraPublication = false;
      p.trackPublications.forEach((pub) => {
        // Detect screen share publication even if unsubscribed
        if (pub.source === Track.Source.ScreenShare) hasScreenSharePublication = true;
        // Detect camera publication even if unsubscribed (for unwatched cameras)
        if (pub.source === Track.Source.Camera) hasCameraPublication = true;

        const track = pub.track;
        if (!track) return;
        // Strict check: Track must be subscribed AND not muted to be considered "active"
        if (pub.isMuted) return;
        if (!isLocal && !pub.isSubscribed) return;

        const mt = track.mediaStreamTrack;
        if (!mt || mt.readyState !== 'live') return;

        if (pub.source === Track.Source.Microphone) audioTrack = mt;
        else if (pub.source === Track.Source.Camera && p.isCameraEnabled) { videoTrack = mt; lkVideoTrack = track; }
        else if (pub.source === Track.Source.ScreenShare) { screenTrack = mt; lkScreenTrack = track; }
        else if (pub.source === Track.Source.ScreenShareAudio) screenAudioTrack = mt;
      });

      const userState = useVoiceStore.getState().voiceUserStates.get(userId);
      let isPartDeafened = false;
      let isPartMuted = !p.isMicrophoneEnabled;

      if (isLocal) {
        // Compute effective state: user intent || server enforcement
        const vs = useVoiceStore.getState();
        const cvId = vs.currentVoiceChannelId;
        const localOrigin = cvId ? getChannelOrigin(cvId) : '';
        const localMyId = cvId ? getMyUserIdForOrigin(localOrigin) : undefined;
        const localSpaceId = cvId ? useSpaceStore.getState().channelToSpaceMap.get(cvId) : null;
        const localKey = (localSpaceId && localMyId) ? `${localSpaceId}:${localMyId}` : '';
        isPartMuted = vs.isMuted || vs.spaceMutedUserIds.has(localKey) || vs.permissionMutedUserIds.has(localKey);
        isPartDeafened = vs.isDeafened || vs.spaceDeafenedUserIds.has(localKey);
      } else {
        isPartDeafened = userState?.isDeafened ?? useVoiceStore.getState().deafenedUserIds.has(userId);
        if (userState) isPartMuted = userState.isMuted;
      }

      allParticipants.push({
        identity: p.identity,
        userId,
        username,
        homeUserId,
        cachedUser,
        isMuted: isPartMuted,
        isDeafened: isPartDeafened,
        isCameraOn: hasCameraPublication && p.isCameraEnabled, // True even when unsubscribed
        // The share, not its current publication: a republish's gap between
        // two publications is not a share ending and starting again (no tile
        // loss, no stream_ended/started cue, no watcher reset). A remote share
        // is live while published (even unsubscribed) or bridged by its
        // sharer's announcement; our own is the lifecycle screenShare keeps.
        isScreenSharing: isLocal
          ? localShareLive
          : hasScreenSharePublication || (republish?.isBridging(p.identity) ?? false),
        isLocal,
        audioTrack,
        videoTrack,
        screenTrack,
        screenAudioTrack,
        lkVideoTrack,
        lkScreenTrack,
      });
    };
    processParticipant(r.localParticipant, true);
    r.remoteParticipants.forEach((p) => processParticipant(p, false));
    useVoiceStore.getState().setParticipants(allParticipants);
    SpeakingDetector.getInstance().syncTracks(allParticipants);
  }, []);

  const handleDataReceived = useCallback((
    room: Room,
    payload: Uint8Array,
    participant: RemoteParticipant | undefined,
    republish: StreamRepublishTracker,
    resume: StreamResumeMemory,
  ) => {
    // Try the stream_watch protocol first (typed parser; returns null on non-matches).
    if (participant) {
      const sw = parseStreamWatch(payload);
      if (sw) {
        // Both sides of the watcher set are LiveKit identities: the sharer's
        // (the one string every client in the room shares, where its user id
        // is per instance) and the viewer's, so ParticipantDisconnected can
        // evict cleanly. An older viewer's ping is placed through the
        // participant it names by user id, or dropped when none matches.
        const sharerIdentity = streamWatchKey(sw, useVoiceStore.getState().participants);
        if (sharerIdentity) {
          useVoiceStore.getState().recordStreamWatch(sharerIdentity, participant.identity, sw.watching);
        }
        return;
      }
      const signal = parseShareSignal(payload);
      if (signal === 'stream_republish') {
        // The sender's next screen-share unpublish is a codec swap, not the end.
        republish.announce(participant.identity);
        return;
      }
      if (signal === 'stream_resume') {
        // The sender's full reconnect brought its share back.
        if (resume.resumeAnnounced(participant.identity)) resumeIfPublished(room, resume, participant.identity);
        return;
      }
      if (signal === 'stream_stop') {
        resume.stopAnnounced(participant.identity);
        return;
      }
      const ptr = parseStreamPointer(payload);
      if (ptr) {
        const { userId: senderUserId } = parseIdentity(participant.identity);
        const spaceState = useSpaceStore.getState();
        const memberMatch = spaceState.members.find((m) => m.userId === senderUserId);
        let dmUserMatch: { displayName?: string | null; username: string } | undefined;
        if (!memberMatch) {
          for (const dm of spaceState.dmChannels) {
            const u = dm.members?.find((m) => m.id === senderUserId);
            if (u) { dmUserMatch = u; break; }
          }
        }
        const livekitName = participant.name && participant.name !== participant.identity ? participant.name : '';
        const senderName =
          memberMatch?.nickname
          || memberMatch?.user.displayName
          || memberMatch?.user.username
          || dmUserMatch?.displayName
          || dmUserMatch?.username
          || livekitName
          || senderUserId;

        useStreamPointerStore.getState().upsertPointer({
          streamIdentity: ptr.streamIdentity,
          senderIdentity: participant.identity,
          senderName,
          x: ptr.x,
          y: ptr.y,
          mode: ptr.mode,
          color: ptr.color,
        });
        // Draw directly on the streamer's real OS monitor via the isolated OS overlay (Desktop app)
        const localIdentity = roomRef.current?.localParticipant?.identity;
        if (
          localIdentity
          && ptr.streamIdentity === localIdentity
          && useVoiceStore.getState().streamPointerOverlayEnabled
        ) {
          const pingPayload = {
            x: ptr.x,
            y: ptr.y,
            senderName,
            color: ptr.color ?? '#7c3aed',
          };
          if (window.backspace?.dispatchOverlayEvent) {
            window.backspace.dispatchOverlayEvent({ kind: 'pointer_ping', ...pingPayload });
          } else if (window.backspace?.showStreamPointerOverlay) {
            window.backspace.showStreamPointerOverlay(pingPayload);
          }
        }
        return;
      }
      const sb = decodeSoundboardPlay(payload);
      if (sb) {
        if (!isSafeSoundboardFileUrl(sb.fileUrl)) return;
        const vs = useVoiceStore.getState();
        const origin = voiceSessionOrigin(vs);
        const limits = selectStreamingLimits(useSettingsStore.getState(), origin);
        if (limits?.soundboardEnabled === false) return;
        // Server-signed token attribute: `sb=0` means the sender lacks USE_SOUNDBOARD.
        if (participant?.attributes?.sb === '0') return;
        const senderUserId = resolveParticipantUserId(participant.identity);
        if (vs.soundboardMuted || vs.soundboardMutedUserIds.has(senderUserId)) {
          return;
        }
        if (vs.isDeafened || vs.soundboardVolume <= 0) {
          vs.markUserPlayingSoundboard(senderUserId, sb.emoji, sb.name, sb.durationMs);
          return;
        }
        const maxConcurrent = limits?.maxConcurrentSoundboardSounds ?? 3;
        if (!vs.tryStartSoundboardClip(sb.soundId, sb.durationMs, maxConcurrent)) {
          return;
        }
        vs.markUserPlayingSoundboard(senderUserId, sb.emoji, sb.name, sb.durationMs);
        const resolvedUrl = origin ? `${origin}${sb.fileUrl}` : sb.fileUrl;
        const clipScale = sb.volumeScale ?? 1;
        const audioManager = AudioManager.getInstance();
        audioManager.setSoundboardVolume(vs.soundboardVolume, vs.soundboardMuted);
        void audioManager
          .playSoundUrl(resolvedUrl, { volume: clipScale })
          .then((res) => {
            if (!res) {
              useVoiceStore.getState().finishSoundboardClip(sb.soundId);
              return;
            }
            res.source.addEventListener('ended', () => {
              useVoiceStore.getState().finishSoundboardClip(sb.soundId);
            });
          })
          .catch(() => {
            useVoiceStore.getState().finishSoundboardClip(sb.soundId);
          });
        return;
      }
    }
    try {
      const text = new TextDecoder().decode(payload);
      const msg = JSON.parse(text);
      if (msg.type === 'deafen' && participant) {
        const { userId } = parseIdentity(participant.identity);
        useVoiceStore.getState().setUserDeafened(userId, msg.deafened === true);
        updateParticipants();
      }
    } catch { }
  }, [updateParticipants]);

  // Handle Input Device & Mute Logic via AudioManager
  // Mute uses setMicrophoneEnabled(false) to keep the track published (silence frames)
  // instead of unpublishTrack() which tears down the WebRTC transport.
  // This preserves the Web Audio pipeline for future AudioWorklet nodes (e.g. RNNoise).
  useEffect(() => {
    const r = roomRef.current;
    if (!r || !isConnected) return;

    let cancelled = false;
    const isCurrentRoom = () => !cancelled && roomRef.current === r;

    // Compute effective mute/deafen: user intent || server enforcement
    const vs = useVoiceStore.getState();
    const cvId = vs.currentVoiceChannelId;
    const effOrigin = cvId ? getChannelOrigin(cvId) : '';
    const effMyId = cvId ? getMyUserIdForOrigin(effOrigin) : undefined;
    const effSpaceId = cvId ? useSpaceStore.getState().channelToSpaceMap.get(cvId) : null;
    const effKey = (effSpaceId && effMyId) ? `${effSpaceId}:${effMyId}` : '';
    const effectiveMuted = isMuted || spaceMutedUserIds.has(effKey) || permissionMutedUserIds.has(effKey);
    const effectiveDeafened = isDeafened || spaceDeafenedUserIds.has(effKey);

    const syncMic = async () => {
      try {
        if (!isCurrentRoom()) return;
        const audioManager = AudioManager.getInstance();

        // Sync voice processing & Opus capture settings to AudioManager.
        // Music mode bypasses speech DSP (AEC/NS/AGC/RNNoise) so full-range
        // audio passes uncolored; Stereo mode also bypasses mono RNNoise.
        const effectiveOpus = getEffectiveAudioConfigForCurrentRoom();
        const isMusic = effectiveOpus.audioMode === 'music';
        audioManager.setVoiceProcessing({
          echoCancellation: isMusic ? false : echoCancellation,
          noiseSuppression: isMusic ? false : noiseSuppression,
          autoGainControl: isMusic ? false : autoGainControl,
          stereo: effectiveOpus.audioStereo,
        });
        await audioManager.setRnnoiseEnabled(isMusic || effectiveOpus.audioStereo ? false : rnnoiseEnabled);
        if (!isCurrentRoom()) return;

        const micPub = r.localParticipant.getTrackPublications()
          .find(p => p.source === Track.Source.Microphone);

        // Mic permission denied — user joined as a listener. Tear down any
        // stale publication (defensive: should not exist on first join, but
        // covers the edge where permission was revoked mid-call) and skip
        // the publish branch entirely. Re-attempt is gated behind the
        // `requestMicPermission` user-gesture path which clears the flag
        // and triggers this effect to re-run via its dep.
        if (micPermissionDenied) {
          if (micPub?.track) {
            await r.localParticipant.unpublishTrack(micPub.track as LocalAudioTrack).catch(() => {});
          }
          return;
        }

        // If effectively muted or deafened, mute the track in-place (keep it published)
        if (effectiveMuted || effectiveDeafened) {
          if (micPub?.track && !micPub.isMuted) {
            await r.localParticipant.setMicrophoneEnabled(false);
          }
          return;
        }

        // Not muted — ensure the AudioManager pipeline is on the right device
        // and at the right volume, then republish if the published track is
        // stale or missing.
        try {
          await audioManager.setInputDevice(inputDeviceId);
        } catch (err: any) {
          if (!isCurrentRoom()) return;
          // Late denial (e.g. iOS standalone PWA where the pre-arm in
          // `joinVoiceChannel` ran inside the gesture but the prompt is
          // delivered out-of-band; the user denies after `room.connect()`
          // has already succeeded). Promote to the listener-mode flag so
          // we don't loop forever trying to re-acquire.
          if (err?.name === 'NotAllowedError') {
            useVoiceStore.getState().setMicPermissionDenied(true);
            useUIStore.getState().addToast(i18n.t('voice:micPrearm.denied'), 'warning');
            return;
          }
          throw err;
        }
        if (!isCurrentRoom()) return;
        audioManager.setInputVolume(inputVolume);
        await republishMicrophone(r, lastMicGenRef, lastPublishSigRef);
      } catch (err) {
        console.error('[LiveKit] Failed to sync mic state:', err);
      }
    };

    syncMic();

    // Re-sync when AudioManager resumes
    const unsubscribeResume = AudioManager.getInstance().onResumed(() => {
      syncMic();
    });

    return () => {
      cancelled = true;
      unsubscribeResume();
    };
  }, [isMuted, isDeafened, spaceMutedUserIds, spaceDeafenedUserIds, permissionMutedUserIds, inputDeviceId, inputVolume, isConnected, echoCancellation, noiseSuppression, autoGainControl, rnnoiseEnabled, audioMode, audioStereo, audioBitrateAuto, audioBitrate, activeChannelAudioBitrate, activeChannelMaxAudioBitrate, activeChannelAllowMusic, activeChannelAllowStereo, streamHostLimits, micPermissionDenied]);

  // Subscribe to upstream-input-track-end events from AudioManager whenever a
  // room is connected. The published mic track is a clone of a WebAudio
  // destination node and never ends on hardware loss; only the upstream
  // getUserMedia track does. AudioManager owns that signal — we react to it.
  useEffect(() => {
    if (!isConnected) return;
    const am = AudioManager.getInstance();
    const subscriberRoom = roomRef.current;

    const unsubscribe = am.onInputTrackEnded(async () => {
      // Room was replaced or torn down between event emission and handler run.
      if (roomRef.current !== subscriberRoom || !subscriberRoom) return;

      const deviceId = useVoiceStore.getState().inputDeviceId;
      let copy = i18n.t('voice:deviceAlerts.micRestoreFailed');

      try {
        // Probe is intentionally constraint-free — we want to know whether the
        // device is reachable, not whether full voice constraints succeed. Adding
        // constraints here would create probe-vs-acquire skew (probe might fail
        // for a constraint that AudioManager would have negotiated around).
        const probe = await navigator.mediaDevices.getUserMedia({
          audio: deviceId === 'default' ? true : { deviceId: { exact: deviceId } },
        });
        probe.getTracks().forEach(t => t.stop());

        // Probe succeeded — device is back. Re-acquire and force a republish.
        if (roomRef.current !== subscriberRoom) return;
        try {
          await am.setInputDevice(deviceId);
          if (roomRef.current !== subscriberRoom) return;
          await republishMicrophone(subscriberRoom, lastMicGenRef, lastPublishSigRef);
          return;
        } catch {
          // copy already holds micRestoreFailed
        }
      } catch (err: any) {
        if (err?.name === 'NotAllowedError') {
          copy = i18n.t('voice:deviceAlerts.micPermissionRevoked');
        } else if (err?.name === 'NotFoundError') {
          if (deviceId !== 'default') {
            // The configured device disappeared. Fall back to default — the
            // store update triggers syncMic via its dep array, which calls
            // republishMicrophone with the freshly acquired default stream.
            useVoiceStore.getState().setInputDevice('default');
            copy = i18n.t('voice:deviceAlerts.micDisconnectedFallback');
          } else {
            copy = i18n.t('voice:deviceAlerts.micDisconnected');
          }
        } else {
          copy = i18n.t('voice:deviceAlerts.micRestoreFailed');
        }
      }

      if (roomRef.current !== subscriberRoom) return;
      useUIStore.getState().addToast(copy, 'warning');
    });

    return () => { unsubscribe(); };
  }, [isConnected]);

  // Hot-swap the camera source when cameraDeviceId changes mid-call.
  // Compares against the published track's actual deviceId (getSettings().deviceId)
  // rather than a memoised previous store value, so the null → explicit-same-device
  // transition is a correct no-op.
  useEffect(() => {
    const r = roomRef.current;
    if (!r || !isConnected || !isCameraOn) return;

    const camPub = r.localParticipant.getTrackPublications()
      .find(p => p.source === Track.Source.Camera);
    if (!camPub?.track) return;

    const currentDeviceId = camPub.track.mediaStreamTrack?.getSettings().deviceId;
    const target = cameraDeviceId;

    if (target === null) return;            // "Auto" never force-switches a live publication
    if (currentDeviceId === target) return; // already on target

    const myGen = ++switchCameraGenRef.current;

    // Race semantics: if the effect re-fires while this IIFE is in flight
    // (rapid dropdown changes), the newer firing will increment the gen.
    // This IIFE's catch then no-ops its store rollback — the newer attempt
    // owns the canonical store state.
    (async () => {
      const prev = currentDeviceId ?? null;
      try {
        await r.switchActiveDevice('videoinput', target);
      } catch (err) {
        console.error('[LiveKit] Camera hot-swap failed:', err);
        // A newer device-switch attempt has superseded ours. Don't write stale
        // rollback state; let the newer attempt's outcome stand.
        if (myGen !== switchCameraGenRef.current) {
          useUIStore.getState().addToast(i18n.t('voice:deviceAlerts.cameraSwitchFailed'), 'warning');
          return;
        }
        const stillLive = camPub.track?.mediaStreamTrack?.readyState === 'live';
        if (stillLive && prev) {
          useVoiceStore.getState().setCameraDeviceId(prev);
        } else if (stillLive) {
          useVoiceStore.getState().setCameraDeviceId(null);
        } else {
          // Track is dead — disable the camera entirely. Mark the flag now to
          // suppress the already-queued `ended` event on the dead track.
          markIntentionalCameraOff();
          // Re-mark immediately before the disable: LiveKit may synthesize a
          // second `ended` event during teardown, and the flag is consumed once.
          // markIntentionalCameraOff is idempotent.
          markIntentionalCameraOff();
          await r.localParticipant.setCameraEnabled(false).catch(() => {});
          useVoiceStore.setState({ isCameraOn: false });
          broadcastVoiceStatus();
        }
        useUIStore.getState().addToast(i18n.t('voice:deviceAlerts.cameraSwitchFailed'), 'warning');
      }
    })();
  }, [cameraDeviceId, isCameraOn, isConnected]);

  const connect = useCallback(async (channelId: string, isDm?: boolean) => {
    const storedId = isDm ? `dm-${channelId}` : channelId;
    if (connectedChannelRef.current === storedId && roomRef.current?.state === ConnectionState.Connected) return;

    // Entering a DM call: drop any space voice channel we're still "in" on the
    // client. Done synchronously (before any await) so the sidebar updates
    // immediately. See clearSpaceVoiceForDmCall for why currentVoiceChannelId
    // must be cleared here — otherwise the DM call's participants render against
    // the old space channel and we appear to still be sitting in it.
    if (isDm) clearSpaceVoiceForDmCall();

    // Register voice state with the WS server after LiveKit connects (not for DM calls)
    const registerWithServer = () => {
      if (isDm) return;
      const origin = getChannelOrigin(channelId);
      wsSend({ type: 'voice_join', channelId }, origin);
      broadcastVoiceStatus(origin);
    };
    const gen = ++_connectGeneration;

    // Hold a dedicated audio session lease for this connection attempt. It stays
    // scoped to `gen` until transferred to `newRoom`, so a late Disconnected
    // from an older room cannot consume this pending join's lease.
    releasePendingAudioLease();
    const joinAudioLease = AudioManager.getInstance().acquireAudioSession();
    pendingAudioLeaseRef.current = { gen, release: joinAudioLease };

    // Ensure AudioContext is created and resumed before tracks arrive
    await AudioManager.getInstance().resumeContext();
    if (gen !== _connectGeneration) {
      releasePendingAudioLease(gen);
      return;
    }

    // 1. Reset state immediately to reflect "Loading/Switching" in UI
    SpeakingDetector.getInstance().clear();
    setRoom(null);
    useVoiceStore.getState().setParticipants([]);
    useVoiceStore.getState().setSpeakingParticipants(new Set());
    // Camera and screen share belong to the room being left: nothing of either
    // is published in the next one until the user starts it there.
    useVoiceStore.setState({ isCameraOn: false, isScreenSharing: false });
    setIsConnected(false);
    setIsConnecting(true);
    setConnectionState(ConnectionState.Connecting);
    useVoiceStore.getState().setVoiceConnectionStatus('connecting');
    setConnectionError(null);
    setConnectedChannelId(null); // Clear this so AppLayout knows we are transitioning

    useVoiceStore.getState().setConnectionError(null);
    useVoiceStore.getState().setIsLiveKitConnected(false);
    useVoiceStore.getState().setConnectionQuality('unknown');

    // 2. Strictly disconnect previous room (Local Ref OR Global Ref)
    // This handles cases where AppLayout might have remounted, losing roomRef but leaving _activeRoom alive.
    const roomToDisconnect = roomRef.current || _activeRoom;
    
    if (roomToDisconnect) {
      // A channel switch retains pre-armed capture. Ignore the old room's
      // terminal events before starting asynchronous SDK teardown, and release
      // only the old room's own audio lease.
      roomRef.current = null;
      _activeRoom = null;
      releaseRoomAudioLease(roomToDisconnect);
      clearRoomStreamState(roomToDisconnect);
      try {
        console.log('[LiveKit] Destroying previous room:', roomToDisconnect.name);
        await destroyRoom(roomToDisconnect);
      } catch (err) {
        console.warn('Error disconnecting from previous room:', err);
      }
    }
    if (gen !== _connectGeneration) {
      releasePendingAudioLease(gen);
      return;
    }
    
    let createdRoom: Room | null = null;
    try {
      let token: string;
      let url: string;
      // The instance that issues the token hosts the LiveKit room, so its
      // streaming limits are the ones a screen share here obeys. Null when the
      // token was relayed from a host this client has no session with.
      let hostOrigin: string | null;

      // A call hosted on another instance connects with the credentials its
      // ring brought, once, and only for the call they came with.
      const { activeDmCall } = useVoiceStore.getState();
      const credentials = isDm && activeDmCall && dmCallRoomKey(activeDmCall) === channelId
        ? activeDmCall.livekit
        : null;
      if (activeDmCall && credentials) {
        token = credentials.token;
        url = credentials.url;
        hostOrigin = null;
        useVoiceStore.setState({ activeDmCall: { ...activeDmCall, livekit: null } });
      } else {
        hostOrigin = getChannelOrigin(channelId);
        const client = getApiForOrigin(hostOrigin);
        const resp = isDm ? await client.livekit.dmToken(channelId) : await client.livekit.token(channelId);
        token = resp.token;
        url = resp.url;
      }
      if (gen !== _connectGeneration) {
        releasePendingAudioLease(gen);
        return;
      }
      useVoiceStore.setState({ livekitHostOrigin: hostOrigin });
      // Refreshed per join; home's document arrives with every home `ready`.
      if (hostOrigin) void refreshStreamHostLimits(hostOrigin);
      const newRoom = new Room({
        adaptiveStream: { pixelDensity: 'screen' },
        dynacast: true,
        publishDefaults: { videoCodec: 'h264', simulcast: true },
      });
      createdRoom = newRoom;
      // Transfer lease ownership from the pending join to this Room instance.
      if (pendingAudioLeaseRef.current?.gen === gen) {
        pendingAudioLeaseRef.current = null;
      }
      _roomAudioLeases.set(newRoom, joinAudioLease);
      roomRef.current = newRoom;
      // This room's own tracker. Its handlers use it directly, and act only
      // while the room is current: a replaced room's late events belong to
      // nothing the user still sees.
      const republish = new StreamRepublishTracker((identity) => {
        // The announced republish never produced a new track: the share ended.
        if (roomRef.current !== newRoom) return;
        endRemoteStream(identity);
        updateParticipants();
      });
      _republishTrackers.set(newRoom, republish);
      const resume = new StreamResumeMemory();
      _resumeMemories.set(newRoom, resume);
      // Set when the room goes Reconnecting, which is a full reconnect: a
      // signal resume only goes SignalReconnecting.
      let fullReconnect = false;
      let initialConnectPending = true;

      const isCurrent = () => roomRef.current === newRoom;
      const guardedUpdate = () => { if (isCurrent()) updateParticipants(); };
      newRoom.on(RoomEvent.ParticipantConnected, (participant) => {
        guardedUpdate();
        // Notify new participant of our effective deafen state
        const vsConn = useVoiceStore.getState();
        const cvIdConn = vsConn.currentVoiceChannelId;
        const connOrigin = cvIdConn ? getChannelOrigin(cvIdConn) : '';
        const connMyId = cvIdConn ? getMyUserIdForOrigin(connOrigin) : undefined;
        const connSpaceId = cvIdConn ? useSpaceStore.getState().channelToSpaceMap.get(cvIdConn) : null;
        const connKey = (connSpaceId && connMyId) ? `${connSpaceId}:${connMyId}` : '';
        const effDeaf = vsConn.isDeafened || vsConn.spaceDeafenedUserIds.has(connKey);
        if (effDeaf) {
          const encoder = new TextEncoder();
          newRoom.localParticipant.publishData(
            encoder.encode(JSON.stringify({ type: 'deafen', deafened: true })),
            { reliable: true }
          ).catch(() => { });
        }
      });
      newRoom.on(RoomEvent.ParticipantDisconnected, (participant: RemoteParticipant) => {
        // Left between a republish's two publications: its share ends with it.
        const bridgedShareEnded = republish.cancel(participant.identity);
        if (!isCurrent()) return;
        // While the room is not Connected the leave may be this room's own
        // full reconnect dropping every participant (Room.handleRestarting),
        // so a viewer stays in the watcher set. Every return to Connected
        // keeps only the viewers present then (`retainWatchers` below), which
        // also catches a viewer that really left in that window.
        if (newRoom.state === ConnectionState.Connected) {
          useVoiceStore.getState().evictWatcher(participant.identity);
        }
        if (bridgedShareEnded) {
          rememberWatchedShare(resume, participant.identity);
          endRemoteStream(participant.identity);
        }
        updateParticipants();
        // Clean up stale WS-based voice status for the departed participant
        const { userId } = parseIdentity(participant.identity);
        useVoiceStore.getState().clearVoiceUserStatus(userId);
      });
      newRoom.on(RoomEvent.TrackSubscribed, (track, publication, participant) => {
        // LiveKit auto-attaches a hidden <audio> element for subscribed audio tracks.
        // GlobalAudioRenderer is the sole audio playback path with volume/attenuation/boost.
        // Detach LiveKit's internal element to prevent double-playback.
        if (track.kind === Track.Kind.Audio) {
          const audioTrack = track as RemoteAudioTrack;
          audioTrack.detach();
          const voiceState = useVoiceStore.getState();
          if (publication.source === Track.Source.ScreenShareAudio) {
            applyReceiverJitterBuffer(audioTrack, voiceState.streamBufferMs);
          } else {
            applyAudioReceiverJitterBuffer(audioTrack, voiceState.jitterBufferMs, publication.source);
          }
        } else if (track.kind === Track.Kind.Video && publication.source === Track.Source.ScreenShare) {
          publication.setVideoQuality?.(VideoQuality.HIGH);
          applyReceiverJitterBuffer(track as RemoteTrack, useVoiceStore.getState().streamBufferMs);
        }
        guardedUpdate();
      });
      newRoom.on(RoomEvent.TrackUnsubscribed, (track) => {
        if (track.kind === Track.Kind.Audio) {
          (track as RemoteAudioTrack).detach();
        }
        guardedUpdate();
      });
      newRoom.on(RoomEvent.LocalTrackPublished, (publication: LocalTrackPublication) => {
        if (publication.source === Track.Source.ScreenShare) {
          const { userId } = parseIdentity(newRoom.localParticipant.identity);
          useVoiceStore.getState().watchStream(userId);
          publication.track?.on(TrackEvent.Restarted, () => {
            scheduleScreenShareOverdrive(newRoom);
          });
        }
        if (publication.source === Track.Source.Camera) {
          const mst = publication.track?.mediaStreamTrack;
          if (mst) {
            // Replace any prior listener — on a re-publish the underlying track is new.
            mst.onended = async () => {
              // User-initiated camera-off → skip the probe + toast entirely.
              if (consumeIntentionalCameraOff()) return;
              // Room is tearing down or has been replaced → skip.
              if (roomRef.current !== newRoom) return;

              // Re-probe getUserMedia to distinguish hardware unplug from
              // OS-level permission revoke. Keep the probe short and tolerant.
              const deviceId = useVoiceStore.getState().cameraDeviceId;
              let copy = i18n.t('voice:deviceAlerts.cameraUnavailable');
              try {
                const probe = await navigator.mediaDevices.getUserMedia({
                  video: deviceId ? { deviceId: { exact: deviceId } } : true,
                });
                probe.getTracks().forEach(t => t.stop());
                // Probe succeeded — reason is unknown; keep generic copy.
              } catch (err: any) {
                if (err?.name === 'NotAllowedError') copy = i18n.t('voice:deviceAlerts.cameraPermissionRevoked');
                else if (err?.name === 'NotFoundError') copy = i18n.t('voice:deviceAlerts.cameraDisconnected');
                // Any other error → keep generic copy.
              }

              // The probe is async and may have taken time (especially if the
              // browser surfaced a permission prompt). If the user disconnected
              // while the probe was in flight, `roomRef.current` is no longer
              // `newRoom` — silently no-op so we don't mutate state or surface
              // a toast for a session the user has already left.
              if (roomRef.current !== newRoom) return;

              // Tear down camera state via the unified path. Mark intentional so
              // the disable's own track-end doesn't recurse into this handler.
              markIntentionalCameraOff();
              await roomRef.current.localParticipant.setCameraEnabled(false).catch(() => {});
              useVoiceStore.setState({ isCameraOn: false });
              broadcastVoiceStatus();
              useUIStore.getState().addToast(copy, 'warning');
            };
          }
        }
        // NOTE: Microphone track-loss is handled at the AudioManager layer via
        // `onInputTrackEnded`, NOT here. The published mic track is a clone of
        // a WebAudio destination node and does not end on hardware loss — only
        // the upstream getUserMedia track does. See the `useEffect` that
        // subscribes to `AudioManager.onInputTrackEnded` above.
        guardedUpdate();
      });
      newRoom.on(RoomEvent.LocalTrackUnpublished, (publication: LocalTrackPublication) => {
        if (publication.source === Track.Source.ScreenShare) {
          // screenShare decides whether the share is over: a stop (ours, the
          // OS stop bar, the source ending) or a republish of the same share
          // (a codec change, a full reconnect). Only an end drops our own
          // stream from the watched set; a republish keeps it, or the local
          // tile would flicker until LocalTrackPublished puts it back.
          if (handleScreenShareUnpublished(newRoom)) {
            const { userId } = parseIdentity(newRoom.localParticipant.identity);
            useVoiceStore.getState().unwatchStream(userId);
          }
        }
        if (publication.source === Track.Source.ScreenShareAudio) {
          handleScreenShareAudioUnpublished(newRoom);
        }
        guardedUpdate();
      });
      newRoom.on(RoomEvent.TrackMuted, guardedUpdate);
      newRoom.on(RoomEvent.TrackUnmuted, guardedUpdate);
      newRoom.on(RoomEvent.ParticipantMetadataChanged, guardedUpdate);
      newRoom.on(RoomEvent.TrackPublished, (publication: RemoteTrackPublication, participant: RemoteParticipant) => {
        if (!isCurrent()) return;
        if (
          publication.source !== Track.Source.ScreenShare &&
          publication.source !== Track.Source.ScreenShareAudio
        ) {
          publication.setSubscribed(true);
        } else if (publication.source === Track.Source.ScreenShareAudio) {
          // Stream tracks follow the watch state, and the watch click only
          // subscribed what was published then. System Audio can be turned on
          // mid-stream, so audio arriving for a stream being watched joins it.
          if (useVoiceStore.getState().watchingStreams.has(resolveParticipantUserId(participant.identity))) {
            publication.setSubscribed(true);
          }
        } else if (republish.completeWithPublication(participant.identity)) {
          // The new track of an announced republish: a viewer who was watching
          // keeps watching without clicking Watch again. Its audio, published
          // after the video, is picked up by the branch above.
          if (useVoiceStore.getState().watchingStreams.has(resolveParticipantUserId(participant.identity))) {
            publication.setSubscribed(true);
          }
        } else {
          // A share this viewer watched before a full reconnect, back.
          const stream = resume.takeOnPublication(participant.identity);
          if (stream) resumeRemoteStream(newRoom, participant.identity, stream);
        }
        updateParticipants();
      });
      newRoom.on(RoomEvent.TrackUnpublished, (publication: RemoteTrackPublication, participant: RemoteParticipant) => {
        if (!isCurrent()) return;
        // An announced republish keeps the watch and the stream's audio
        // settings for the next publication; anything else ends the share.
        if (
          publication.source === Track.Source.ScreenShare
          && !republish.bridgeRemoval(participant.identity)
        ) {
          rememberWatchedShare(resume, participant.identity);
          endRemoteStream(participant.identity);
        }
        updateParticipants();
      });
      newRoom.on(RoomEvent.DataReceived, (payload: Uint8Array, participant?: RemoteParticipant) => {
        if (isCurrent()) handleDataReceived(newRoom, payload, participant, republish, resume);
      });
      newRoom.on(RoomEvent.ConnectionQualityChanged, (quality: ConnectionQuality, participant: Participant) => {
        const normalizedQuality = toVoiceConnectionQuality(quality);
        useVoiceStore.getState().setConnectionQuality(normalizedQuality, participant.identity);
        if (participant.identity === newRoom.localParticipant.identity) {
          useVoiceStore.getState().setConnectionQuality(normalizedQuality);
        }
      });
      newRoom.on(RoomEvent.SignalReconnecting, () => {
        if (roomRef.current === newRoom) {
          useVoiceStore.getState().setVoiceConnectionStatus('reconnecting');
        }
      });
      newRoom.on(RoomEvent.ConnectionStateChanged, (state) => {
        if (roomRef.current === newRoom) {
          setConnectionState(state);
          const connected = state === ConnectionState.Connected;
          const connecting = state === ConnectionState.Connecting || state === ConnectionState.Reconnecting;

          setIsConnected(connected);
          setIsConnecting(connecting);

          // One update, so no subscriber sees the room disconnected but not
          // yet reconnecting (SoundController would play a leave). Both kinds
          // of reconnect count: a signal resume and a full reconnect.
          const reconnecting = state === ConnectionState.Reconnecting || state === ConnectionState.SignalReconnecting;
          useVoiceStore.setState({
            isLiveKitConnected: connected,
            voiceConnectionStatus: connected ? 'connected' : reconnecting ? 'reconnecting' : 'connecting',
          });

          if (state === ConnectionState.Reconnecting) {
            fullReconnect = true;
            resume.hold();
          }

          if (connected) {
            // A full reconnect republished every local track: the share goes
            // on if its publication came back, and ends here if not.
            settleScreenShareAfterReconnect(newRoom);
            // Viewers kept while the room was not Connected stay only if they
            // are here. A signal resume counts too: its signal is live again
            // (SignalResumed) before the room is Connected (Resumed, after the
            // ICE restart), so a viewer can really leave in between.
            useVoiceStore.getState().retainWatchers(new Set(newRoom.remoteParticipants.keys()));
            if (fullReconnect) {
              fullReconnect = false;
              // The shares this viewer was watching come back as they are
              // published again (the rest through TrackPublished).
              for (const identity of resume.selfReconnected()) resumeIfPublished(newRoom, resume, identity);
            }
            // On LiveKit reconnect, re-register with WS server (server may have restarted)
            if (connectedChannelRef.current) {
              registerWithServer();
            }
            // Re-sync voice status, AudioContext/sinkId, and receiver jitter buffers after reconnect
            broadcastVoiceStatus();
            void AudioManager.getInstance().recoverFromWake?.();
            const voiceState = useVoiceStore.getState();
            newRoom.remoteParticipants.forEach((rp) => {
              rp.trackPublications.forEach((pub) => {
                if (!pub.track) return;
                if (pub.track.kind === Track.Kind.Audio) {
                  if (pub.source === Track.Source.ScreenShareAudio) {
                    applyReceiverJitterBuffer(pub.track as RemoteAudioTrack, voiceState.streamBufferMs);
                  } else {
                    applyAudioReceiverJitterBuffer(pub.track as RemoteAudioTrack, voiceState.jitterBufferMs, pub.source);
                  }
                } else if (pub.track.kind === Track.Kind.Video && pub.source === Track.Source.ScreenShare) {
                  applyReceiverJitterBuffer(pub.track as RemoteTrack, voiceState.streamBufferMs);
                }
              });
            });
            updateParticipants();
            if (useVoiceStore.getState().isScreenSharing) {
              scheduleScreenShareOverdrive(newRoom);
            }
          }
        }
      });
      newRoom.on(RoomEvent.Disconnected, (reason?: DisconnectReason) => {
        // A full reconnect that gave up: a share it had withdrawn ends here.
        settleScreenShareAfterReconnect(newRoom);
        if (roomRef.current !== newRoom) return;
        republish.clear();
        resume.clear();
        // Release ONLY this room's own audio lease.
        releaseRoomAudioLease(newRoom);
        // If a newer connect() is already in flight (e.g. switching rooms while
        // awaiting resumeContext()), do NOT bump _connectGeneration or tear down
        // the incoming connection's pre-armed capture / pending state.
        const supersededByNewConnect = gen !== _connectGeneration;
        roomRef.current = null; _activeRoom = null;
        if (supersededByNewConnect) return;
        // The SDK emits Disconnected before rejecting an initial connect.
        // Keep that attempt current so its catch can report the failure.
        if (!initialConnectPending) _connectGeneration++;

        const terminal = reason === DisconnectReason.DUPLICATE_IDENTITY
          || reason === DisconnectReason.PARTICIPANT_REMOVED
          || reason === DisconnectReason.ROOM_DELETED;

        // Server-outage P2P Survival Mode: if the server restarted/dropped unexpectedly
        // while we have connected direct P2P peers, keep the local microphone stream
        // alive so peers keep talking uninterrupted until the server comes back online.
        const keepMicForP2PSurvival = !terminal
          && reason !== DisconnectReason.CLIENT_INITIATED
          && useP2PStore.getState().enabled
          && P2PMeshManager.getInstance().hasSurvivingVoicePeer();

        if (keepMicForP2PSurvival) {
          P2PMeshManager.getInstance().setServerOnline(false);
        } else {
          AudioManager.getInstance().releaseInputStream();
        }
        useStreamPointerStore.getState().reset();
        SpeakingDetector.getInstance().clear();
        setConnectionState(ConnectionState.Disconnected);
        setIsConnecting(false);
        setConnectedChannelId(null);
        setIsConnected(false); setRoom(null);
        // Batch participants + connected into one setState to prevent SoundController
        // from seeing intermediate states (e.g., participants empty but still "connected"
        // → triggers user_leave sound before the disconnect sound).
        useVoiceStore.getState().setSpeakingParticipants(new Set());
        useVoiceStore.setState({ participants: [], isLiveKitConnected: false });
        useVoiceStore.getState().setVoiceConnectionStatus('disconnected');

        // Semantic terminal reasons must never auto-retry. An exhausted network
        // reconnect keeps voice intent so VoiceControls can offer a user retry.
        if (terminal) {
          useVoiceStore.getState().handleForceDisconnect();
        } else if (reason !== DisconnectReason.CLIENT_INITIATED) {
          setConnectionError('network_disconnect');
          useVoiceStore.getState().setConnectionError('network_disconnect');
        }
      });

      await newRoom.connect(url, token, { autoSubscribe: false });
      initialConnectPending = false;
      if (gen !== _connectGeneration) {
        releaseRoomAudioLease(newRoom);
        destroyRoom(newRoom);
        return;
      }
      _activeRoom = newRoom;
      connectedChannelRef.current = storedId;
      setConnectedChannelId(storedId);
      setRoom(newRoom);
      setIsConnected(true);
      useVoiceStore.getState().setIsLiveKitConnected(true);
      useVoiceStore.getState().setVoiceConnectionStatus('connected');

      // Tell WS server we're in the voice channel now that LiveKit is connected
      registerWithServer();

      updateParticipants();

      // Subscribe to non-screen-share tracks from existing participants (safety net)
      newRoom.remoteParticipants.forEach((rp) => {
        rp.trackPublications.forEach((pub) => {
          if (
            pub.source !== Track.Source.ScreenShare &&
            pub.source !== Track.Source.ScreenShareAudio
          ) {
            (pub as RemoteTrackPublication).setSubscribed(true);
          }
        });
      });

      // Initial mute state check
      const { isDeafened: wasDeafened } = useVoiceStore.getState();

      if (wasDeafened) {
        newRoom.remoteParticipants.forEach((p) => p.setVolume(0));
      }
      
      updateParticipants();
    } catch (err) {
      releasePendingAudioLease(gen);
      releaseRoomAudioLease(createdRoom);
      if (gen === _connectGeneration) {
        AudioManager.getInstance().releaseInputStream();
    useStreamPointerStore.getState().reset();
        setConnectionError('connect_failed');
        useVoiceStore.getState().leaveVoice();
        useVoiceStore.getState().setConnectionError('connect_failed');
      }
    }
    finally { if (gen === _connectGeneration) setIsConnecting(false); }
  }, [updateParticipants, handleDataReceived, releasePendingAudioLease]);

  const disconnect = useCallback(async () => {
    const gen = ++_connectGeneration;
    // Release before SDK teardown, even if token fetching has not made a Room
    // yet. A late teardown must never stop a subsequent call's fresh capture.
    AudioManager.getInstance().releaseInputStream();
    useStreamPointerStore.getState().reset();
    releasePendingAudioLease();
    releaseRoomAudioLease(roomRef.current || _activeRoom);
    SpeakingDetector.getInstance().clear();
    deactivateHwOverdrive();
    connectedChannelRef.current = null;
    setConnectedChannelId(null);
    if (roomRef.current) {
      // Null out roomRef BEFORE destroying so that guardedUpdate() skips
      // during teardown. Without this, ParticipantDisconnected events fire
      // before RoomEvent.Disconnected, calling updateParticipants while
      // isLiveKitConnected is still true — SoundController plays user_leave
      // for departing participants alongside the disconnect sound.
      const roomToDestroy = roomRef.current;
      roomRef.current = null;
      _activeRoom = null;
      clearRoomStreamState(roomToDestroy);
      await destroyRoom(roomToDestroy);
      if (gen !== _connectGeneration) return;
    }
    setRoom(null);
    setIsConnected(false);
    setIsConnecting(false);
    setConnectionState(ConnectionState.Disconnected);
    useVoiceStore.getState().setVoiceConnectionStatus('disconnected');
    useVoiceStore.getState().setSpeakingParticipants(new Set());
    useVoiceStore.setState({ participants: [], isLiveKitConnected: false });
  }, [releasePendingAudioLease]);

  const toggleMic = useCallback(async () => { 
    await AudioManager.getInstance().resumeContext();
    useVoiceStore.getState().toggleMic();
  }, []);

  useEffect(() => {
    updateParticipants();
  }, [voiceUserStates, isMuted, isDeafened, isScreenSharing, spaceMutedUserIds, spaceDeafenedUserIds, permissionMutedUserIds, updateParticipants]);

  useEffect(() => {
    if (!room) return;
    // Superseded by a newer run (config changed again, or the room went away)
    // while this one was still queued behind an in-flight update.
    let superseded = false;
    const updateActiveTracks = async () => {
      if (superseded) return;
      if (isScreenSharing) {
        // System Audio first: a toggle change publishes or withdraws only the
        // audio track, never the video.
        await syncScreenShareAudio(room);
        const opts = buildScreenShareOptions(screenShareConfig);
        // Codec changed mid-stream — the codec is baked into SDP negotiation,
        // so republish the same track under the new options (no re-capture).
        const publishedCodec = getRequestedPublishedScreenShareCodec();
        if (publishedCodec && publishedCodec !== opts.publish.videoCodec) {
          await republishScreenShare(room);
          return;
        }

        const screenPub = room.localParticipant.getTrackPublications().find(p => p.source === Track.Source.ScreenShare);
        if (screenPub?.videoTrack) {
          const mediaTrack = getMediaStreamTrack(screenPub.videoTrack);
          if (mediaTrack) {
            if (opts.capture.width > 0 && opts.capture.height > 0) {
              // Standard mode: apply resolution + frameRate together
              await mediaTrack.applyConstraints({ width: { ideal: opts.capture.width }, height: { ideal: opts.capture.height }, frameRate: { ideal: opts.capture.frameRate, min: 15 } });
            } else {
              // Native mode: apply frameRate only — never pass 0 to width/height
              await mediaTrack.applyConstraints({ frameRate: { ideal: opts.capture.frameRate, min: 15 } });
            }
            mediaTrack.contentHint = opts.contentHint;
          }
          // For native mode, recompute overdrive bitrate from actual track dimensions
          resolveNativeOverdrive(mediaTrack ?? null, screenShareConfig, opts);
          await applyOverdrive(room, Track.Source.ScreenShare, opts.overdrive);
        }
      }
      if (isCameraOn) { await applyOverdrive(room, Track.Source.Camera, CAMERA_OVERDRIVE); }
    };
    _activeTrackUpdate = _activeTrackUpdate.then(updateActiveTracks).catch(() => {});
    return () => { superseded = true; };
  }, [room, screenShareConfig, streamHostLimits, isScreenSharing, isCameraOn]);

  useEffect(() => {
    return () => {
      _connectGeneration++;
      SpeakingDetector.getInstance().clear();
      deactivateHwOverdrive();
      AudioManager.getInstance().releaseInputStream();
    useStreamPointerStore.getState().reset();
      releasePendingAudioLease();
      const roomToDestroy = roomRef.current;
      roomRef.current = null;
      _activeRoom = null;
      releaseRoomAudioLease(roomToDestroy);
      if (roomToDestroy) {
        clearRoomStreamState(roomToDestroy);
        void destroyRoom(roomToDestroy);
      }
    };
  }, [releasePendingAudioLease]);


  return { room, isConnected, isConnecting, connectionState, connectedChannelId, connectionError, connect, disconnect, toggleMic };
}
