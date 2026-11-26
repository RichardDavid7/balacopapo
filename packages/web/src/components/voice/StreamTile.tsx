import React, { useRef, useEffect, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useFormatters } from '../../i18n/formatters';
import { Avatar } from '../ui/Avatar';
import { useVoiceStore } from '../../stores/voiceStore';
import { useContextMenuStore, type ContextMenuItem } from '../../stores/contextMenuStore';
import { applyStreamBufferToRoom, getActiveRoom, setStreamSubscription } from '../../hooks/useLiveKit';
import { stopScreenShare, changeScreenShare, effectiveScreenShareConfig } from '../../utils/screenShare';
import { useStreamHostLimits } from '../../utils/streamHostLimits';
import { DEFAULT_STREAMING_LIMITS } from '../../stores/settingsStore';
import { encodeStreamWatch, streamWatchFor, type StreamWatchTarget } from '../../utils/streamWatchProtocol';
import {
  clientPointToNormalizedVideo,
  computeVideoContentBox,
  encodeStreamPointer,
  pointerColorForIdentity,
  type StreamPointerMode,
} from '../../utils/streamPointerProtocol';
import { useStreamPointerStore } from '../../stores/streamPointerStore';
import { useAuthStore } from '../../stores/authStore';
import { AudioManager } from '../../audio/AudioManager';
import { getSfxVolume } from '../../utils/sfx';
import { ScreenShareSettingsPopover } from './ScreenShareSettingsPopover';
import { useVoiceParticipantMeta } from '../../hooks/useVoiceParticipantMeta';
import type { StreamTile as StreamTileType } from '../../hooks/useLiveKit';
import type { TrackStatsSnapshot } from '../../hooks/useTrackStats';
import {
  classifyStreamHealth,
  useStreamHealthWarning,
} from '../../hooks/useStreamHealthWarning';

interface StreamTileProps {
  tile: StreamTileType;
  large?: boolean;
  edgeToEdge?: boolean;
  chromeVisible?: boolean;
  stats: TrackStatsSnapshot | null;
}

const STREAM_HEALTH_KEYS = {
  publisherNetwork: 'voice:streamDiagnostics.publisherNetwork',
  publisherCpu: 'voice:streamDiagnostics.publisherCpu',
  viewerNetwork: 'voice:streamDiagnostics.viewerNetwork',
  reconnecting: 'voice:streamDiagnostics.reconnecting',
  unknown: 'voice:streamDiagnostics.unknown',
} as const;

function finitePositiveRounded(value: number | undefined): number | null {
  if (value === undefined || !Number.isFinite(value) || value <= 0) return null;
  return Math.round(value);
}

/** Wrapper component for stream quality settings — needs its own state + close guard. */
function StreamQualityItem() {
  const { t } = useTranslation(['voice', 'common']);
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const setCloseGuard = useContextMenuStore((s) => s.setCloseGuard);
  const savedConfig = useVoiceStore((s) => s.screenShareConfig);
  const { limits } = useStreamHostLimits();
  // The label names what the stream uses, not the saved choice a host may cap.
  const screenShareConfig = effectiveScreenShareConfig(savedConfig, limits ?? DEFAULT_STREAMING_LIMITS);

  return (
    <div className="p-3">
      <div className="text-xs text-txt-tertiary mb-2 font-medium uppercase tracking-wider">
        {t('voice:stream.quality')}
      </div>
      <div className="relative">
        <button
          ref={btnRef}
          onClick={() => {
            const n = !open;
            setOpen(n);
            setCloseGuard(n);
          }}
          className="w-full flex items-center justify-between px-2 py-1.5 text-sm text-txt-secondary hover:bg-interactive-hover rounded transition-colors"
        >
          <span>{t('voice:stream.qualityValue', { height: screenShareConfig.height, fps: screenShareConfig.fps })}</span>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
            <path d="M7 10l5 5 5-5z" />
          </svg>
        </button>
        {open && (
          <ScreenShareSettingsPopover
            open={open}
            onClose={() => {
              setOpen(false);
              setCloseGuard(false);
            }}
            anchorRef={btnRef}
          />
        )}
      </div>
    </div>
  );
}

/** Wrapper component for stream volume slider — needs store subscription. */
function StreamVolumeItem({ userId }: { userId: string }) {
  const { t } = useTranslation(['voice', 'common']);
  const f = useFormatters();
  const streamVolume = useVoiceStore((s) => s.streamVolumes.get(userId) ?? 100);
  const setStreamVolume = useVoiceStore((s) => s.setStreamVolume);

  return (
    <div className="p-3">
      <div className="text-xs text-txt-tertiary mb-2 font-medium uppercase tracking-wider">
        {t('voice:stream.volume')}
      </div>
      <div className="flex items-center gap-2">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" className="text-txt-tertiary flex-shrink-0">
          <path d="M3 9v6h4l5 5V4L7 9H3z" />
        </svg>
        <input
          type="range"
          min="0"
          max="200"
          value={streamVolume}
          onChange={(e) => setStreamVolume(userId, parseInt(e.target.value))}
          className="flex-1 min-w-0 accent-accent-primary h-1"
        />
        <span className="text-xs text-txt-secondary min-w-[32px] flex-shrink-0 text-right">
          {f.formatPercent(streamVolume)}
        </span>
      </div>
    </div>
  );
}

/** Quick synchronized A/V stream buffer slider in the remote stream context menu. */
function StreamBufferItem() {
  const { t } = useTranslation(['voice', 'common']);
  const streamBufferMs = useVoiceStore((s) => s.streamBufferMs);
  const setStreamBufferMs = useVoiceStore((s) => s.setStreamBufferMs);

  const handleChange = (ms: number) => {
    setStreamBufferMs(ms);
    applyStreamBufferToRoom(getActiveRoom(), ms);
  };

  return (
    <div className="px-3 pb-3 pt-1">
      <div className="flex items-center justify-between text-xs text-txt-tertiary mb-1.5 font-medium uppercase tracking-wider">
        <span>{t('voice:stream.buffer')}</span>
        <span className="text-txt-secondary tabular-nums normal-case">
          {streamBufferMs === 0 ? t('voice:stream.bufferAuto') : t('common:units.ms', { value: streamBufferMs })}
        </span>
      </div>
      <input
        type="range"
        min="0"
        max="2000"
        step="20"
        value={streamBufferMs}
        onChange={(e) => handleChange(parseInt(e.target.value, 10))}
        className="w-full accent-accent-primary h-1"
      />
    </div>
  );
}

/** Wrapper component for stream attenuation controls — needs store subscription. */
function StreamAttenuationItem() {
  const { t } = useTranslation(['voice', 'common']);
  const f = useFormatters();
  const streamAttenuationEnabled = useVoiceStore((s) => s.streamAttenuationEnabled);
  const streamAttenuationStrength = useVoiceStore((s) => s.streamAttenuationStrength);
  const setAttenuationEnabled = useVoiceStore((s) => s.setStreamAttenuationEnabled);
  const setAttenuationStrength = useVoiceStore((s) => s.setStreamAttenuationStrength);

  return (
    <div>
      <div className="py-1.5">
        <button
          onClick={() => setAttenuationEnabled(!streamAttenuationEnabled)}
          className="w-full text-left px-2 py-1.5 mx-1.5 text-sm rounded-sm flex items-center gap-2 text-txt-secondary hover:bg-accent-primary hover:text-white"
          style={{ width: 'calc(100% - 12px)' }}
        >
          <span className="flex-1">{t('voice:stream.attenuation')}</span>
          <div
            className={`w-4 h-4 rounded border flex items-center justify-center transition-colors ${
              streamAttenuationEnabled
                ? 'bg-accent-primary border-accent-primary'
                : 'border-txt-tertiary'
            }`}
          >
            {streamAttenuationEnabled && (
              <svg width="10" height="10" viewBox="0 0 24 24" fill="white">
                <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" />
              </svg>
            )}
          </div>
        </button>
      </div>
      {streamAttenuationEnabled && (
        <div className="p-3 pt-0">
          <div className="text-xs text-txt-tertiary mb-2 font-medium uppercase tracking-wider">
            {t('voice:stream.attenuationStrength')}
          </div>
          <div className="flex items-center gap-2">
            <input
              type="range"
              min="0"
              max="100"
              value={streamAttenuationStrength}
              onChange={(e) => setAttenuationStrength(parseInt(e.target.value))}
              className="flex-1 min-w-0 accent-accent-primary h-1"
            />
            <span className="text-xs text-txt-secondary min-w-[32px] flex-shrink-0 text-right">
              {f.formatPercent(streamAttenuationStrength)}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Handles a deliberate viewer watch / stop-watch action: plays the local
 * feedback cue on the viewer's OWN machine and notifies the streamer so their
 * streamer-side watcher set updates.
 *
 * Called only from explicit user-action sites (the "Watch Stream" button and
 * the watch/stop context-menu items) — never from automatic teardown paths
 * (streamer stops sharing, participant disconnect), which must stay silent on
 * the viewer side. The local cue is played directly rather than derived from a
 * `watchingStreams` diff precisely so those teardown paths don't trigger it.
 *
 * The cue plays unconditionally (independent of the data-channel round-trip to
 * the streamer), so the viewer gets identical feedback on every platform —
 * Safari and the Electron desktop app alike.
 */
function handleViewerWatchToggle(sharer: StreamWatchTarget, watching: boolean): void {
  AudioManager.getInstance().playSound(
    watching ? 'stream_user_joined' : 'stream_user_left',
    { volume: getSfxVolume() },
  );
  const room = getActiveRoom();
  if (!room) return;
  const payload = encodeStreamWatch(streamWatchFor(sharer, watching));
  // Reliable delivery; data channels are room-scoped and small (under 1KB).
  void room.localParticipant.publishData(payload, { reliable: true });
}

export function StreamTile({ tile, large, edgeToEdge = false, chromeVisible = true, stats }: StreamTileProps) {
  const { t } = useTranslation(['voice', 'common']);
  const videoRef = useRef<HTMLVideoElement>(null);

  const watchingStreams = useVoiceStore((s) => s.watchingStreams);

  const { participant } = tile;
  const isLocal = participant.isLocal;
  const userId = participant.userId;
  const avatarUserId = participant.homeUserId ?? userId;
  const { displayName, avatar, user } = useVoiceParticipantMeta(participant);

  const isWatching = watchingStreams.has(userId);
  const voiceConnectionStatus = useVoiceStore((s) => s.voiceConnectionStatus);
  const localConnectionQuality = useVoiceStore((s) => s.connectionQuality);
  const publisherConnectionQuality = useVoiceStore((s) => s.connectionQualities.get(participant.identity) ?? 'unknown');

  const liveScreenTrack = tile.screenTrack?.readyState === 'live' ? tile.screenTrack : null;
  const liveLkScreenTrack = liveScreenTrack ? tile.lkScreenTrack : null;

  // Quality badge state: the raw dimensions, rendered through the catalog so a language switch relabels them.
  const [qualityBadge, setQualityBadge] = useState<{ height: number; fps: number | null } | null>(null);

  // Zoom & Pan (1x–6x) for focused screen shares so viewers can read small text easily.
  const containerRef = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const panStartRef = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null);

  // Point-on-stream state:
  // - Desktop: Shift+click (or click when pointMode is active) sends an immediate ping.
  // - Touch / mobile: dragging the floating aim button moves a crosshair offset 64px
  //   above the finger so the finger never covers the target; releasing sends the ping.
  const [pointMode, setPointMode] = useState(false);
  const [touchAim, setTouchAim] = useState<{ fingerX: number; fingerY: number; targetX: number; targetY: number } | null>(null);
  const touchAimActiveRef = useRef(false);
  const [boxDims, setBoxDims] = useState({ w: 0, h: 0, vw: 0, vh: 0 });

  const TOUCH_AIM_OFFSET_Y = 64;

  const localUser = useAuthStore((s) => s.user);
  const allPointers = useStreamPointerStore((s) => s.pointers);
  const activePointers = Object.values(allPointers).filter((p) => p.streamIdentity === participant.identity);
  const contentBox = computeVideoContentBox(boxDims.w, boxDims.h, boxDims.vw, boxDims.vh);

  const clampPan = useCallback((x: number, y: number, scale: number) => {
    const el = containerRef.current;
    if (!el || scale <= 1) return { x: 0, y: 0 };
    const maxX = ((scale - 1) * el.clientWidth) / 2;
    const maxY = ((scale - 1) * el.clientHeight) / 2;
    return {
      x: Math.max(-maxX, Math.min(maxX, x)),
      y: Math.max(-maxY, Math.min(maxY, y)),
    };
  }, []);

  const resetZoom = useCallback(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
    setIsPanning(false);
    panStartRef.current = null;
  }, []);

  useEffect(() => {
    if (!large || !liveScreenTrack || !isWatching) {
      resetZoom();
      setPointMode(false);
    }
  }, [large, liveScreenTrack, isWatching, participant.identity, resetZoom]);

  // Track container + video natural dimensions so normalized pointers map exactly onto the object-contain video box
  useEffect(() => {
    const el = containerRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const sync = () => {
      const v = videoRef.current;
      setBoxDims({
        w: el.clientWidth,
        h: el.clientHeight,
        vw: v?.videoWidth ?? 0,
        vh: v?.videoHeight ?? 0,
      });
    };
    sync();
    const ro = new ResizeObserver(sync);
    ro.observe(el);
    return () => ro.disconnect();
  }, [large, liveScreenTrack, isWatching]);

  const sendStreamPointer = useCallback(
    (x: number, y: number, mode: StreamPointerMode) => {
      const room = getActiveRoom();
      const senderIdentity = room?.localParticipant?.identity ?? localUser?.id ?? 'local';
      const senderName = localUser?.displayName || localUser?.username || room?.localParticipant?.name || 'You';
      const color = pointerColorForIdentity(senderIdentity);

      useStreamPointerStore.getState().upsertPointer({
        streamIdentity: participant.identity,
        senderIdentity,
        senderName,
        x,
        y,
        mode,
        color,
      });

      if (room?.localParticipant) {
        const bytes = encodeStreamPointer({
          type: 'stream_pointer',
          streamIdentity: participant.identity,
          x,
          y,
          mode,
          color,
        });
        room.localParticipant.publishData(bytes, { reliable: mode !== 'drag' }).catch(() => { /* ignore transient send errors */ });
      }
    },
    [participant.identity, localUser?.id, localUser?.displayName, localUser?.username],
  );

  const handleWheel = useCallback(
    (e: React.WheelEvent<HTMLDivElement>) => {
      if (!large || !liveScreenTrack || !isWatching) return;
      e.preventDefault();
      const el = containerRef.current;
      if (!el) return;
      const factor = e.deltaY < 0 ? 1.2 : 1 / 1.2;
      setZoom((prevZoom) => {
        const nextZoom = Math.max(1, Math.min(6, Number((prevZoom * factor).toFixed(2))));
        if (nextZoom <= 1.02) {
          setPan({ x: 0, y: 0 });
          return 1;
        }
        const rect = el.getBoundingClientRect();
        const cursorX = e.clientX - rect.left - rect.width / 2;
        const cursorY = e.clientY - rect.top - rect.height / 2;
        const ratio = nextZoom / prevZoom;
        setPan((prevPan) =>
          clampPan(
            cursorX - (cursorX - prevPan.x) * ratio,
            cursorY - (cursorY - prevPan.y) * ratio,
            nextZoom,
          ),
        );
        return nextZoom;
      });
    },
    [large, liveScreenTrack, isWatching, clampPan],
  );

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!large || !liveScreenTrack || !isWatching) return;
      if (e.pointerType === 'mouse' && e.button !== 0) return;

      // Ignore clicks on overlay buttons
      if ((e.target as HTMLElement | null)?.closest('button')) return;

      // Desktop Shift+click or active Point Mode: send ping immediately
      if (pointMode || e.shiftKey) {
        const videoEl = videoRef.current;
        if (!videoEl) return;
        const norm = clientPointToNormalizedVideo(
          e.clientX,
          e.clientY,
          videoEl.getBoundingClientRect(),
          videoEl.videoWidth,
          videoEl.videoHeight,
        );
        if (!norm) return;
        e.preventDefault();
        e.stopPropagation();
        sendStreamPointer(norm.x, norm.y, 'ping');
        return;
      }

      if (zoom <= 1) return;
      e.currentTarget.setPointerCapture(e.pointerId);
      setIsPanning(true);
      panStartRef.current = { x: e.clientX, y: e.clientY, panX: pan.x, panY: pan.y };
    },
    [large, liveScreenTrack, isWatching, pointMode, zoom, pan.x, pan.y, sendStreamPointer],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!isPanning || !panStartRef.current) return;
      const dx = e.clientX - panStartRef.current.x;
      const dy = e.clientY - panStartRef.current.y;
      setPan(clampPan(panStartRef.current.panX + dx, panStartRef.current.panY + dy, zoom));
    },
    [isPanning, zoom, clampPan],
  );

  const handlePointerUp = useCallback(() => {
    setIsPanning(false);
    panStartRef.current = null;
  }, []);

  // Mobile / touch draggable crosshair handle: offset 64px above the finger, fires ping on release
  const updateTouchAimFromClient = useCallback((clientX: number, clientY: number) => {
    const el = containerRef.current;
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    const fingerX = Math.max(0, Math.min(rect.width, clientX - rect.left));
    const fingerY = Math.max(0, Math.min(rect.height, clientY - rect.top));
    const targetX = fingerX;
    const targetY = Math.max(8, fingerY - TOUCH_AIM_OFFSET_Y);
    const next = { fingerX, fingerY, targetX, targetY };
    setTouchAim(next);
    return { clientTargetX: rect.left + targetX, clientTargetY: rect.top + targetY };
  }, []);

  const handleAimButtonPointerDown = useCallback(
    (e: React.PointerEvent<HTMLButtonElement>) => {
      if (!large || !liveScreenTrack || !isWatching) return;
      e.stopPropagation();
      e.preventDefault();
      e.currentTarget.setPointerCapture(e.pointerId);
      touchAimActiveRef.current = true;
      updateTouchAimFromClient(e.clientX, e.clientY);
    },
    [large, liveScreenTrack, isWatching, updateTouchAimFromClient],
  );

  const handleAimButtonPointerMove = useCallback(
    (e: React.PointerEvent<HTMLButtonElement>) => {
      if (!touchAimActiveRef.current) return;
      e.stopPropagation();
      updateTouchAimFromClient(e.clientX, e.clientY);
    },
    [updateTouchAimFromClient],
  );

  const handleAimButtonPointerUp = useCallback(
    (e: React.PointerEvent<HTMLButtonElement>) => {
      if (!touchAimActiveRef.current) return;
      e.stopPropagation();
      touchAimActiveRef.current = false;
      const pos = updateTouchAimFromClient(e.clientX, e.clientY);
      setTouchAim(null);
      if (!pos) return;
      const videoEl = videoRef.current;
      if (!videoEl) return;
      const norm = clientPointToNormalizedVideo(
        pos.clientTargetX,
        pos.clientTargetY,
        videoEl.getBoundingClientRect(),
        videoEl.videoWidth,
        videoEl.videoHeight,
      );
      if (norm) {
        sendStreamPointer(norm.x, norm.y, 'ping');
      }
    },
    [updateTouchAimFromClient, sendStreamPointer],
  );

  const openContextMenu = useContextMenuStore((s) => s.open);

  const screenStat = stats?.videoTracks.find((track) =>
    track.source === 'screen_share'
    && (isLocal
      ? track.direction === 'send'
      // Matched on LiveKit identity, never on username: a replicated federated
      // user can share a username with a local one, and matching by name would
      // attribute one participant's degradation to the other.
      : track.direction === 'recv' && track.participantIdentity === participant.identity),
  );
  const healthCandidate = classifyStreamHealth({
    reconnecting: voiceConnectionStatus === 'reconnecting',
    isLocal,
    publisherConnectionQuality,
    localConnectionQuality,
    outboundReason: isLocal ? screenStat?.qualityLimitation ?? null : null,
    packetLoss: screenStat?.packetLoss ?? null,
    jitter: screenStat?.jitter ?? null,
    freezeCountDelta: screenStat?.freezeCountDelta ?? null,
  });
  const healthWarning = useStreamHealthWarning(healthCandidate, stats);

  // --- VIDEO --- use LiveKit's track.attach() to register the element
  // with the adaptive stream observer (enables SFU layer switching by viewport size)
  useEffect(() => {
    const videoEl = videoRef.current;
    if (!videoEl) return;
    if (liveLkScreenTrack) {
      liveLkScreenTrack.attach(videoEl);
      return () => { liveLkScreenTrack.detach(videoEl); };
    } else {
      videoEl.srcObject = null;
    }
  }, [liveLkScreenTrack]);

  // Quality badge (poll every 3s)
  useEffect(() => {
    if (!liveScreenTrack) {
      setQualityBadge(null);
      return;
    }
    const update = () => {
      const settings = liveScreenTrack.getSettings();
      const h = finitePositiveRounded(settings.height);
      const fps = finitePositiveRounded(settings.frameRate);
      if (h !== null && fps !== null) {
        setQualityBadge({ height: h, fps });
      } else if (h !== null) {
        setQualityBadge({ height: h, fps: null });
      } else {
        setQualityBadge(null);
      }
    };
    update();
    const interval = setInterval(update, 3000);
    return () => clearInterval(interval);
  }, [liveScreenTrack]);

  // Force re-render on track end
  const [, forceUpdate] = useState(0);
  useEffect(() => {
    if (!tile.screenTrack) return;
    const onEnded = () => forceUpdate((n) => n + 1);
    tile.screenTrack.addEventListener('ended', onEnded);
    return () => tile.screenTrack?.removeEventListener('ended', onEnded);
  }, [tile.screenTrack]);

  // --- CONTEXT MENU ---
  const handleContextMenu = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();

      const items: ContextMenuItem[] = [];

      if (isLocal) {
        // Local stream: stop, change, quality
        items.push({
          key: 'stop-streaming',
          type: 'action',
          label: t('voice:stream.stop'),
          danger: true,
          icon: React.createElement('svg', { width: 14, height: 14, viewBox: '0 0 24 24', fill: 'currentColor', className: 'flex-shrink-0' },
            React.createElement('path', { d: 'M21 3H3c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h7v2H8v2h8v-2h-2v-2h7c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 14H3V5h18v12z' }),
            React.createElement('line', { x1: 4, y1: 4, x2: 20, y2: 20, stroke: 'currentColor', strokeWidth: 2 }),
          ),
          onClick: async () => {
            const room = getActiveRoom();
            if (room) {
              await stopScreenShare(room);
            }
          },
        });
        items.push({
          key: 'change-stream',
          type: 'action',
          label: t('voice:stream.change'),
          icon: React.createElement('svg', { width: 14, height: 14, viewBox: '0 0 24 24', fill: 'currentColor', className: 'flex-shrink-0' },
            React.createElement('path', { d: 'M17.65 6.35C16.2 4.9 14.21 4 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08c-.82 2.33-3.04 4-5.65 4-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z' }),
          ),
          onClick: async () => {
            const room = getActiveRoom();
            if (room) {
              await changeScreenShare(room);
            }
          },
        });
        items.push({ key: 'quality-sep', type: 'separator' });
        items.push({
          key: 'stream-quality',
          type: 'custom',
          render: () => React.createElement(StreamQualityItem),
        });
      } else {
        // Remote stream: watch/unwatch, mute, volume, attenuation
        const currentIsWatching = useVoiceStore.getState().watchingStreams.has(userId);
        const identity = participant.identity;

        if (currentIsWatching) {
          items.push({
            key: 'stop-watching',
            type: 'action',
            label: t('voice:stream.stopWatching'),
            icon: React.createElement('svg', { width: 14, height: 14, viewBox: '0 0 24 24', fill: 'currentColor', className: 'flex-shrink-0' },
              React.createElement('path', { d: 'M12 7c2.76 0 5 2.24 5 5 0 .65-.13 1.26-.36 1.83l2.92 2.92c1.51-1.26 2.7-2.89 3.43-4.75-1.73-4.39-6-7.5-11-7.5-1.4 0-2.74.25-3.98.7l2.16 2.16C10.74 7.13 11.35 7 12 7zM2 4.27l2.28 2.28.46.46C3.08 8.3 1.78 10.02 1 12c1.73 4.39 6 7.5 11 7.5 1.55 0 3.03-.3 4.38-.84l.42.42L19.73 22 21 20.73 3.27 3 2 4.27zM7.53 9.8l1.55 1.55c-.05.21-.08.43-.08.65 0 1.66 1.34 3 3 3 .22 0 .44-.03.65-.08l1.55 1.55c-.67.33-1.41.53-2.2.53-2.76 0-5-2.24-5-5 0-.79.2-1.53.53-2.2zm4.31-.78l3.15 3.15.02-.16c0-1.66-1.34-3-3-3l-.17.01z' }),
            ),
            onClick: () => {
              useVoiceStore.getState().unwatchStream(userId);
              setStreamSubscription(getActiveRoom(), identity, false);
              handleViewerWatchToggle({ userId, identity }, false);
            },
          });
        } else {
          items.push({
            key: 'watch-stream',
            type: 'action',
            label: t('voice:stream.watch'),
            icon: React.createElement('svg', { width: 14, height: 14, viewBox: '0 0 24 24', fill: 'currentColor', className: 'flex-shrink-0' },
              React.createElement('path', { d: 'M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z' }),
            ),
            onClick: () => {
              useVoiceStore.getState().watchStream(userId);
              setStreamSubscription(getActiveRoom(), identity, true);
              handleViewerWatchToggle({ userId, identity }, true);
            },
          });
        }

        items.push({ key: 'watch-sep', type: 'separator' });

        // Mute Stream checkbox
        items.push({
          key: 'mute-stream',
          type: 'checkbox',
          label: t('voice:stream.mute'),
          subscribe: useVoiceStore.subscribe,
          getChecked: () => useVoiceStore.getState().streamMutes.get(userId) ?? false,
          onChange: (checked) => useVoiceStore.getState().setStreamMute(userId, checked),
        });

        items.push({ key: 'vol-sep', type: 'separator' });

        // Stream volume slider
        items.push({
          key: 'stream-volume',
          type: 'custom',
          render: () => React.createElement(StreamVolumeItem, { userId }),
        });

        // Synchronized A/V stream buffer slider
        items.push({
          key: 'stream-buffer',
          type: 'custom',
          render: () => React.createElement(StreamBufferItem),
        });

        items.push({ key: 'attenuation-sep', type: 'separator' });

        // Stream attenuation controls
        items.push({
          key: 'stream-attenuation',
          type: 'custom',
          render: () => React.createElement(StreamAttenuationItem),
        });
      }

      openContextMenu({ x: e.clientX, y: e.clientY }, items);
    },
    [isLocal, userId, participant.identity, openContextMenu, t],
  );

  const handleWatch = useCallback(() => {
    useVoiceStore.getState().watchStream(userId);
    setStreamSubscription(getActiveRoom(), participant.identity, true);
    handleViewerWatchToggle({ userId, identity: participant.identity }, true);
  }, [userId, participant.identity]);

  const hasVideo = liveScreenTrack !== null;

  const overlayFade = chromeVisible ? 'opacity-100' : 'opacity-0 pointer-events-none';

  return (
    <div
      ref={containerRef}
      data-context-menu
      className={`relative overflow-hidden flex items-center justify-center group transition-all duration-200 h-full w-full ${
        edgeToEdge
          ? 'bg-black rounded-none ring-0'
          : 'bg-surface-base rounded-xl ring-1 ring-white/[0.06] hover:ring-white/10'
      } ${
        large && hasVideo && isWatching
          ? pointMode
            ? 'cursor-crosshair select-none touch-none'
            : zoom > 1
              ? (isPanning ? 'cursor-grabbing select-none' : 'cursor-grab select-none')
              : ''
          : ''
      }`}
      onContextMenu={handleContextMenu}
      onClick={(e) => {
        if (e.shiftKey || pointMode) {
          e.stopPropagation();
          e.preventDefault();
        }
      }}
      onWheel={handleWheel}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onDoubleClick={() => { if (large && !pointMode && zoom > 1) resetZoom(); }}
    >
      {hasVideo && isWatching ? (
        <div
          style={
            large && zoom > 1
              ? {
                  transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
                  transformOrigin: 'center center',
                  transition: isPanning ? 'none' : 'transform 80ms ease-out',
                }
              : undefined
          }
          className="relative w-full h-full"
        >
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            onLoadedMetadata={(e) => {
              const v = e.currentTarget;
              const el = containerRef.current;
              if (el) setBoxDims({ w: el.clientWidth, h: el.clientHeight, vw: v.videoWidth, vh: v.videoHeight });
            }}
            onResize={(e) => {
              const v = e.currentTarget;
              const el = containerRef.current;
              if (el) setBoxDims({ w: el.clientWidth, h: el.clientHeight, vw: v.videoWidth, vh: v.videoHeight });
            }}
            className="w-full h-full object-contain bg-black"
          />

          {/* Temporary point-on-stream markers (synced via LiveKit DataChannel) */}
          {activePointers.length > 0 && contentBox.width > 0 && contentBox.height > 0 && (
            <div className="absolute inset-0 pointer-events-none overflow-hidden">
              {activePointers.map((ptr) => {
                const leftPx = contentBox.left + ptr.x * contentBox.width;
                const topPx = contentBox.top + ptr.y * contentBox.height;
                const isClearing = ptr.mode === 'clear';
                return (
                  <div
                    key={`${ptr.id}-${ptr.pulseKey}`}
                    style={{ left: `${leftPx}px`, top: `${topPx}px` }}
                    className={`absolute -translate-x-1/2 -translate-y-1/2 transition-opacity duration-300 ${
                      isClearing ? 'opacity-0' : 'opacity-100'
                    }`}
                  >
                    {/* Animated ping ring */}
                    <span
                      style={{ borderColor: ptr.color }}
                      className="absolute inset-0 -m-3 rounded-full border-2 animate-ping opacity-75"
                    />
                    {/* Target reticle */}
                    <span
                      style={{ borderColor: ptr.color, backgroundColor: `${ptr.color}33` }}
                      className="relative flex items-center justify-center w-6 h-6 rounded-full border-2 shadow-lg"
                    >
                      <span
                        style={{ backgroundColor: ptr.color }}
                        className="w-2 h-2 rounded-full"
                      />
                    </span>
                    {/* Sender label */}
                    <span
                      style={{ borderColor: `${ptr.color}88` }}
                      className="absolute left-1/2 top-full mt-1.5 -translate-x-1/2 whitespace-nowrap px-1.5 py-0.5 rounded bg-black/80 border text-[10px] font-semibold text-white shadow"
                    >
                      {ptr.senderName}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      ) : (
        <div data-testid="stream-tile-placeholder" className={`w-full h-full min-h-0 flex items-center justify-center bg-surface-channel ${large ? 'px-4 py-6' : 'px-4 pt-9 pb-3'}`}>
          <div className={large ? 'flex flex-col items-center gap-3 min-w-0' : 'flex w-full max-w-[280px] min-w-0 items-center gap-3'}>
            <div className="relative flex-shrink-0">
              <Avatar src={avatar} name={displayName} size={large ? 80 : 44} userId={avatarUserId} user={user ?? undefined} />
            </div>
            <div className={`${large ? 'text-center' : 'text-left flex-1'} min-w-0`}>
              <p className={`text-txt-primary font-semibold ${large ? 'text-sm' : 'text-xs leading-tight line-clamp-2'}`}>
                {t('voice:stream.isStreaming', { name: displayName })}
              </p>
              {!isLocal && (
                <button
                  onClick={handleWatch}
                  aria-label={t('voice:stream.watch')}
                  className={`${large ? 'mt-2 px-4 py-1.5' : 'mt-2 w-full min-h-7 px-3 py-1 text-[11px]'} whitespace-nowrap bg-accent-primary hover:bg-accent-primary/80 rounded text-white font-semibold transition-colors`}
                >
                  {t(large ? 'voice:stream.watch' : 'voice:stream.watchShort')}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* LIVE badge + Point-on-stream toggle + Zoom reset pill — top left */}
      <div className={`absolute top-2 left-2 flex items-center gap-1.5 transition-opacity duration-300 ease-out ${overlayFade}`}>
        <div className="px-1.5 py-0.5 bg-accent-rose rounded text-[11px] font-bold text-white uppercase tracking-wide">
          {t('voice:badges.live')}
        </div>
        {large && hasVideo && isWatching && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); setPointMode((prev) => !prev); }}
            title={t('voice:stream.pointModeHint')}
            aria-pressed={pointMode}
            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold border transition-colors ${
              pointMode
                ? 'bg-accent-primary border-accent-primary text-white'
                : 'bg-black/75 hover:bg-black/90 border-white/15 text-white/90'
            }`}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
              <circle cx="12" cy="12" r="7" />
              <circle cx="12" cy="12" r="2" fill="currentColor" />
              <path strokeLinecap="round" d="M12 2v3M12 19v3M2 12h3M19 12h3" />
            </svg>
            <span>{t('voice:stream.pointMode')}</span>
          </button>
        )}
        {large && hasVideo && isWatching && zoom > 1 && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); resetZoom(); }}
            title={t('voice:stream.resetZoom')}
            className="px-2 py-0.5 bg-black/75 hover:bg-black/90 border border-white/15 rounded text-[11px] font-semibold text-white tabular-nums transition-colors"
          >
            {/* i18n-check: allow-literal "2.0x" is a numeric zoom factor */}
            {zoom.toFixed(1)}x
          </button>
        )}
      </div>

      {/* Stream status — in focus mode this is the visual peer of the Grid
          action: same top edge, height, radius, and surface treatment. */}
      {(healthWarning || (qualityBadge && hasVideo)) && (
        <div className={`absolute top-2 left-20 ${large ? 'right-24' : 'right-2'} flex items-start justify-end gap-1.5 pointer-events-none transition-opacity duration-300 ease-out ${overlayFade}`}>
          {healthWarning && (
            <div className={`${large ? 'h-7 rounded-lg' : 'rounded'} min-w-0 max-w-full px-2 bg-black/75 border border-status-idle/40 flex items-center text-[10px] leading-[15px] text-white/90 truncate`}>
              {t(STREAM_HEALTH_KEYS[healthWarning])}
            </div>
          )}
          {qualityBadge && hasVideo && (
            <div data-testid="stream-quality-badge" className={`${large ? 'h-7 px-3 rounded-lg' : 'px-1.5 py-0.5 rounded'} flex-shrink-0 bg-black/60 flex items-center text-[10px] font-bold text-white/70 uppercase tracking-wide`}>
              {qualityBadge.fps !== null
                ? t('voice:stream.qualityValue', { height: qualityBadge.height, fps: qualityBadge.fps })
                // i18n-check: allow-literal "720p" is the format's name and reads the same in every language
                : <>{qualityBadge.height}p</>}
            </div>
          )}
        </div>
      )}

      {/* Draggable offset-crosshair aim overlay while dragging from the mobile aim handle */}
      {touchAim && (
        <div className="absolute inset-0 pointer-events-none z-20">
          <svg className="absolute inset-0 w-full h-full">
            <line
              x1={touchAim.fingerX}
              y1={touchAim.fingerY}
              x2={touchAim.targetX}
              y2={touchAim.targetY}
              stroke="#a78bfa"
              strokeWidth="2"
              strokeDasharray="4 3"
            />
          </svg>
          {/* Crosshair target (64px above the finger) */}
          <div
            style={{ left: `${touchAim.targetX}px`, top: `${touchAim.targetY}px` }}
            className="absolute -translate-x-1/2 -translate-y-1/2 w-8 h-8 rounded-full border-2 border-accent-primary bg-accent-primary/20 flex items-center justify-center shadow-lg"
          >
            <span className="w-2 h-2 rounded-full bg-accent-primary" />
          </div>
          {/* Finger grip indicator */}
          <div
            style={{ left: `${touchAim.fingerX}px`, top: `${touchAim.fingerY}px` }}
            className="absolute -translate-x-1/2 -translate-y-1/2 w-5 h-5 rounded-full border border-white/60 bg-black/50"
          />
        </div>
      )}

      {/* Draggable mobile/touch aim handle — bottom right (offset crosshair fires ping on release) */}
      {large && hasVideo && isWatching && (
        <button
          type="button"
          onPointerDown={handleAimButtonPointerDown}
          onPointerMove={handleAimButtonPointerMove}
          onPointerUp={handleAimButtonPointerUp}
          onPointerCancel={handleAimButtonPointerUp}
          title={t('voice:stream.dragAimHint')}
          aria-label={t('voice:stream.dragAimHint')}
          className={`absolute bottom-12 right-3 z-20 touch-none select-none w-11 h-11 rounded-full border flex items-center justify-center shadow-lg transition-all duration-200 ${
            touchAim
              ? 'bg-accent-primary border-accent-primary text-white scale-110 opacity-100'
              : `bg-black/75 hover:bg-black/90 border-white/20 text-white/90 ${overlayFade}`
          }`}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
            <circle cx="12" cy="12" r="7" />
            <circle cx="12" cy="12" r="2" fill="currentColor" />
            <path strokeLinecap="round" d="M12 2v3M12 19v3M2 12h3M19 12h3" />
          </svg>
        </button>
      )}

      {/* Bottom overlay */}
      {hasVideo && isWatching && <div data-testid="stream-tile-caption" className={`absolute bottom-0 left-0 right-0 px-3 py-2 bg-gradient-to-t from-black/70 via-black/30 to-transparent transition-opacity duration-300 ease-out ${overlayFade}`}>
        <div className="flex items-center gap-1.5 min-w-0">
          {/* Screen icon */}
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="currentColor"
            className="text-white/70 flex-shrink-0"
          >
            <path d="M21 3H3c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h7v2H8v2h8v-2h-2v-2h7c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 14H3V5h18v12z" />
          </svg>
          <span
            className={`font-semibold text-white truncate ${large ? 'text-base' : 'text-[13px]'}`}
          >
            {displayName}
          </span>
          {isLocal && (
            <span className="text-[10px] text-white/40 font-medium">{t('voice:badges.you')}</span>
          )}
        </div>
      </div>}
    </div>
  );
}
