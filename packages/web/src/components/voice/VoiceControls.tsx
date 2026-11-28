import React, { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { useVoiceStore } from '../../stores/voiceStore';
import { useSpaceStore } from '../../stores/spaceStore';
import { selectStreamingLimits, useSettingsStore } from '../../stores/settingsStore';
import { voiceSessionOrigin } from '../../utils/dmCall';
import { ScreenShareSettingsPopover } from './ScreenShareSettingsPopover';
import { ConnectionInfoPopover } from './ConnectionInfoPopover';
import { SoundboardPopover } from './SoundboardPopover';
import { P2PStatusButton, P2PMeshModal } from './P2PMeshModal';
import { usePortalContainer } from '../../hooks/usePortalContainer';
import { layoutPixels, layoutRect } from '../../platform/interfaceScale';
import { hasPermissionBit, PermissionBits } from '../../utils/permissions';
import { requestCameraToggle, handleDisconnectAction, handleScreenShareAction, reconnectVoice } from '../../utils/voiceActions';

/**
 * VoiceControls renders the voice status + button rows.
 * It has NO wrapper/card styling — the parent provides the container.
 */
export function VoiceControls() {
  const { t } = useTranslation(['voice', 'common']);
  const currentVoiceChannelId = useVoiceStore((s) => s.currentVoiceChannelId);
  const isCameraOn = useVoiceStore((s) => s.isCameraOn);
  const isScreenSharing = useVoiceStore((s) => s.isScreenSharing);
  const rnnoiseEnabled = useVoiceStore((s) => s.rnnoiseEnabled);
  const setRnnoiseEnabled = useVoiceStore((s) => s.setRnnoiseEnabled);
  const connectionError = useVoiceStore((s) => s.connectionError);
  const isLiveKitConnected = useVoiceStore((s) => s.isLiveKitConnected);
  const voiceConnectionStatus = useVoiceStore((s) => s.voiceConnectionStatus);
  const connectionQuality = useVoiceStore((s) => s.connectionQuality);
  const channels = useSpaceStore((s) => s.channels);
  // Screen-share button: idle → source picker; live → settings + stop menu.
  const [showShareMenu, setShowShareMenu] = useState(false);
  const [showConnectionInfo, setShowConnectionInfo] = useState(false);
  const [showSoundboard, setShowSoundboard] = useState(false);
  const [soundboardAnchor, setSoundboardAnchor] = useState<{ left: number; bottom: number } | null>(null);
  const soundboardMuted = useVoiceStore((s) => s.soundboardMuted);
  const connectionBtnRef = useRef<HTMLButtonElement>(null);
  const shareBtnRef = useRef<HTMLButtonElement>(null);
  const soundboardBtnRef = useRef<HTMLButtonElement>(null);
  const soundboardPopoverRef = useRef<HTMLDivElement>(null);

  const activeDmCall = useVoiceStore((s) => s.activeDmCall);
  const channelPerms = useSpaceStore((s) => currentVoiceChannelId ? s.channelPermissions.get(currentVoiceChannelId) : undefined);

  // In DM calls, all permissions are granted; in space channels, check SPEAK, STREAM and USE_SOUNDBOARD
  const isDmCall = !!activeDmCall;
  const canSpeak = isDmCall || hasPermissionBit(channelPerms, PermissionBits.SPEAK);
  const canStream = isDmCall || hasPermissionBit(channelPerms, PermissionBits.STREAM);
  const voiceOrigin = useVoiceStore(voiceSessionOrigin);
  const soundboardEnabled = useSettingsStore((s) => selectStreamingLimits(s, voiceOrigin)?.soundboardEnabled ?? true);
  const canUseSoundboard = soundboardEnabled && (isDmCall || hasPermissionBit(channelPerms, PermissionBits.USE_SOUNDBOARD));

  // A share that ends outside the menu (OS "Stop sharing" bar, track loss,
  // keybind) must not leave a stale settings popover anchored to the button.
  useEffect(() => {
    if (!isScreenSharing) setShowShareMenu(false);
  }, [isScreenSharing]);

  useEffect(() => {
    if (!currentVoiceChannelId && !activeDmCall) setShowSoundboard(false);
  }, [currentVoiceChannelId, activeDmCall]);

  const portalContainer = usePortalContainer();

  useEffect(() => {
    if (!showSoundboard) {
      setSoundboardAnchor(null);
      return;
    }
    const updateAnchor = () => {
      const btn = soundboardBtnRef.current;
      if (!btn) return;
      const rect = layoutRect(btn.getBoundingClientRect());
      const vw = layoutPixels(window.innerWidth);
      const vh = layoutPixels(window.innerHeight);
      setSoundboardAnchor({
        left: Math.max(8, Math.min(rect.left, vw - 336)),
        bottom: vh - rect.top + 8,
      });
    };
    updateAnchor();
    const onPointerDown = (e: MouseEvent | TouchEvent) => {
      const target = e.target as Node;
      if (soundboardBtnRef.current?.contains(target)) return;
      if (soundboardPopoverRef.current?.contains(target)) return;
      setShowSoundboard(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setShowSoundboard(false);
    };
    window.addEventListener('resize', updateAnchor);
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('touchstart', onPointerDown, { passive: true });
    document.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('resize', updateAnchor);
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('touchstart', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [showSoundboard]);

  if (!currentVoiceChannelId && !activeDmCall) return null;

  const channel = channels.find(c => c.id === currentVoiceChannelId);
  const channelName = channel?.name ?? (activeDmCall ? t('voice:status.dmCall') : t('voice:status.voiceChannel'));

  const handleScreenShare = () => {
    if (isScreenSharing) {
      const next = !showShareMenu;
      setShowShareMenu(next);
      if (next) setShowConnectionInfo(false);
      return;
    }
    handleScreenShareAction();
  };

  const handleStopSharing = () => {
    setShowShareMenu(false);
    handleScreenShareAction();
  };

  const handleDisconnect = handleDisconnectAction;
  const handleRetry = reconnectVoice;

  const connectionDetail = connectionError === 'network_disconnect'
    ? t('voice:status.connectionLost')
    : connectionError === 'connect_failed'
      ? t('voice:status.connectionFailed')
      : connectionError;

  const statusLabel = voiceConnectionStatus === 'reconnecting'
    ? t('voice:status.reconnecting')
    : connectionError === 'network_disconnect'
      ? t('voice:status.disconnected')
      : connectionError
        ? t('voice:status.connectionFailed')
        : isLiveKitConnected
          ? t('voice:status.connected')
          : t('voice:status.connecting');
  const detailLabel = connectionDetail ?? channelName;

  const statusColor = connectionError
    ? 'text-txt-danger'
    : isLiveKitConnected
      ? 'text-status-online'
      : 'text-status-idle';

  const statusBgColor = connectionError
    ? 'bg-accent-rose/20'
    : isLiveKitConnected
      ? 'bg-status-online/20'
      : 'bg-status-idle/20';

  const qualityColor =
    connectionQuality === 'excellent' || connectionQuality === 'good'
      ? 'text-status-online'
      : connectionQuality === 'poor'
        ? 'text-status-idle'
        : connectionQuality === 'lost'
          ? 'text-txt-danger'
          : statusColor; // 'unknown' falls back to connection-state color

  const btnBase = 'flex-1 h-[34px] flex items-center justify-center rounded-[4px] transition-colors';
  const btnDefaultStyle = 'bg-surface-base text-txt-tertiary hover:bg-surface-channel hover:text-txt-secondary';

  return (
    <>
      {/* Row 1: Signal icon + status text + disconnect */}
      <div className="relative flex items-center gap-2 px-3 pt-3 pb-1">
        <button
          ref={connectionBtnRef}
          onClick={() => {
            setShowConnectionInfo(!showConnectionInfo);
            if (!showConnectionInfo) setShowShareMenu(false);
          }}
          className={`w-8 h-8 rounded-lg ${statusBgColor} flex items-center justify-center flex-shrink-0 hover:brightness-125 transition-all`}
          title={t('voice:controls.connectionInfo')}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" className={qualityColor}>
            <path d="M1 9l2 2c4.97-4.97 13.03-4.97 18 0l2-2C16.93 2.93 7.08 2.93 1 9zm8 8l3 3 3-3c-1.65-1.66-4.34-1.66-6 0zm-4-4l2 2c2.76-2.76 7.24-2.76 10 0l2-2C15.14 9.14 8.87 9.14 5 13z" />
          </svg>
        </button>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 min-w-0">
            <div title={statusLabel} className={`truncate text-[13px] font-semibold leading-[18px] ${statusColor}`}>
              {statusLabel}
            </div>
            <P2PStatusButton />
          </div>
          <div title={detailLabel} className="text-[12px] text-txt-tertiary truncate leading-[16px]">
            {detailLabel}
          </div>
        </div>
        <P2PMeshModal />

        <div className="flex items-center gap-0.5 flex-shrink-0">
          {voiceConnectionStatus === 'disconnected' && connectionError && (
            <button
              onClick={handleRetry}
              className="px-2 h-7 text-[12px] text-accent-primary hover:bg-interactive-hover rounded"
            >
              {t('voice:status.retry')}
            </button>
          )}
          <button
            onClick={handleDisconnect}
            className="w-7 h-7 flex items-center justify-center text-txt-tertiary hover:text-txt-primary hover:bg-interactive-hover transition-colors rounded"
            title={t('voice:controls.disconnect')}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 9C10.4 9 8.85 9.25 7.4 9.72V12.82C7.4 13.22 7.17 13.56 6.84 13.72C5.86 14.21 4.97 14.84 4.18 15.57C4 15.75 3.75 15.85 3.48 15.85C3.2 15.85 2.95 15.74 2.77 15.56L0.29 13.08C0.11 12.9 0 12.65 0 12.38C0 12.1 0.11 11.85 0.29 11.67C3.34 8.78 7.46 7 12 7S20.66 8.78 23.71 11.67C23.89 11.85 24 12.1 24 12.38C24 12.65 23.89 12.9 23.71 13.08L21.23 15.56C21.05 15.74 20.8 15.85 20.52 15.85C20.25 15.85 20 15.75 19.82 15.57C19.03 14.84 18.14 14.21 17.16 13.72C16.83 13.56 16.6 13.22 16.6 12.82V9.72C15.15 9.25 13.6 9 12 9Z" />
            </svg>
          </button>
        </div>

        {/* Connection Info Popover */}
        <ConnectionInfoPopover
          open={showConnectionInfo}
          onClose={() => setShowConnectionInfo(false)}
          anchorRef={connectionBtnRef}
        />
      </div>

      {/* Row 2: Camera, Screen Share, Noise Suppression, Soundboard */}
      <div className="relative flex items-center gap-1 px-3 pb-2 pt-1">
        {canSpeak && (
          <button
            onClick={requestCameraToggle}
            className={`${btnBase} ${
              isCameraOn
                ? 'bg-surface-base text-status-online hover:bg-surface-channel'
                : btnDefaultStyle
            }`}
            title={isCameraOn ? t('voice:controls.cameraOff') : t('voice:controls.cameraOn')}
          >
            {isCameraOn ? (
              <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                <path d="M17 10.5V7C17 6.45 16.55 6 16 6H4C3.45 6 3 6.45 3 7V17C3 17.55 3.45 18 4 18H16C16.55 18 17 17.55 17 17V13.5L21 17.5V6.5L17 10.5Z" />
              </svg>
            ) : (
              <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                <path d="M17 10.5V7C17 6.45 16.55 6 16 6H4C3.45 6 3 6.45 3 7V17C3 17.55 3.45 18 4 18H16C16.55 18 17 17.55 17 17V13.5L21 17.5V6.5L17 10.5Z" />
                <line x1="2" y1="2" x2="22" y2="22" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
              </svg>
            )}
          </button>
        )}

        {canStream && (
          <button
            ref={shareBtnRef}
            onClick={handleScreenShare}
            // Idle the button starts a share; live it toggles a menu, so it
            // only claims a popup in the state where it actually opens one.
            aria-haspopup={isScreenSharing ? 'dialog' : undefined}
            aria-expanded={isScreenSharing ? showShareMenu : undefined}
            className={`${btnBase} ${
              isScreenSharing
                ? 'bg-surface-base text-status-online hover:bg-surface-channel'
                : btnDefaultStyle
            }`}
            title={isScreenSharing ? t('voice:controls.shareOptions') : t('voice:controls.shareScreen')}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
              <path d="M20 18C21.1 18 22 17.1 22 16V6C22 4.9 21.1 4 20 4H4C2.9 4 2 4.9 2 6V16C2 17.1 2.9 18 4 18H0V20H24V18H20ZM4 6H20V16H4V6Z" />
              <path d="M15 11L11 14V12H9V10H11V8L15 11Z" />
            </svg>
          </button>
        )}

        {/* AI Noise Suppression (RNNoise) */}
        <button
          onClick={() => setRnnoiseEnabled(!rnnoiseEnabled)}
          className={`${btnBase} ${
            rnnoiseEnabled
              ? 'bg-surface-base text-status-online hover:bg-surface-channel'
              : btnDefaultStyle
          }`}
          title={rnnoiseEnabled ? t('voice:controls.noiseSuppressionOff') : t('voice:controls.noiseSuppressionOn')}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2z" opacity={rnnoiseEnabled ? 0.15 : 0.08} />
            <path d="M12 1a2 2 0 012 2v1a2 2 0 01-4 0V3a2 2 0 012-2z" />
            <path d="M12 7c-1.66 0-3 1.34-3 3v2c0 1.66 1.34 3 3 3s3-1.34 3-3v-2c0-1.66-1.34-3-3-3z" />
            <path d="M17 11v1c0 2.76-2.24 5-5 5s-5-2.24-5-5v-1H5v1c0 3.53 2.61 6.43 6 6.92V21h2v-2.08c3.39-.49 6-3.39 6-6.92v-1h-2z" />
            {rnnoiseEnabled ? (
              <>
                <circle cx="18" cy="5" r="1.2" fill="currentColor" />
                <circle cx="20" cy="8" r="0.9" fill="currentColor" opacity="0.7" />
                <circle cx="6" cy="5" r="1.2" fill="currentColor" />
                <circle cx="4" cy="8" r="0.9" fill="currentColor" opacity="0.7" />
              </>
            ) : (
              <line x1="4" y1="4" x2="20" y2="20" stroke="currentColor" strokeWidth="2" strokeLinecap="round" opacity="0.4" />
            )}
          </svg>
        </button>

        {/* Soundboard */}
        {canUseSoundboard && (
          <button
            ref={soundboardBtnRef}
            onClick={() => {
              setShowSoundboard((open) => {
                const next = !open;
                if (next) {
                  setShowConnectionInfo(false);
                  setShowShareMenu(false);
                }
                return next;
              });
            }}
            className={`${btnBase} ${
              showSoundboard
                ? 'bg-surface-base text-accent-primary hover:bg-surface-channel'
                : soundboardMuted
                  ? `${btnDefaultStyle} opacity-60`
                  : btnDefaultStyle
            }`}
            title={t('voice:soundboard.title')}
            aria-haspopup="dialog"
            aria-expanded={showSoundboard}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z" />
            </svg>
          </button>
        )}

        {/* Soundboard Popover (portaled above the sidebar) */}
        {canUseSoundboard && showSoundboard && soundboardAnchor && createPortal(
          <div
            ref={soundboardPopoverRef}
            className="fixed z-[200]"
            style={{ left: soundboardAnchor.left, bottom: soundboardAnchor.bottom }}
          >
            <SoundboardPopover
              isOpen={showSoundboard}
              onClose={() => setShowSoundboard(false)}
            />
          </div>,
          portalContainer,
        )}

        {/* Screen share menu — quality settings + stop, anchored to the share button */}
        <ScreenShareSettingsPopover
          open={showShareMenu && isScreenSharing}
          onClose={() => setShowShareMenu(false)}
          anchorRef={shareBtnRef}
          onStopSharing={handleStopSharing}
        />
      </div>
    </>
  );
}
