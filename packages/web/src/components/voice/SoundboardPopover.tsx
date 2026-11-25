import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { SoundboardScopeType, SoundboardSound } from '@backspace/shared';
import { useVoiceStore } from '../../stores/voiceStore';
import { getApiForOrigin, getMyUserIdForOrigin, useSpaceStore } from '../../stores/spaceStore';
import { useUIStore } from '../../stores/uiStore';
import { AudioManager } from '../../audio/AudioManager';
import { getActiveRoom } from '../../hooks/useLiveKit';
import { voiceSessionOrigin } from '../../utils/dmCall';
import { encodeSoundboardPlay } from '../../utils/soundboardProtocol';

interface SoundboardPopoverProps {
  isOpen: boolean;
  onClose: () => void;
  className?: string;
}

export function SoundboardPopover({ isOpen, onClose, className = '' }: SoundboardPopoverProps) {
  const { t } = useTranslation('voice');
  const addToast = useUIStore((s) => s.addToast);

  const currentVoiceChannelId = useVoiceStore((s) => s.currentVoiceChannelId);
  const activeDmCall = useVoiceStore((s) => s.activeDmCall);
  const isDeafened = useVoiceStore((s) => s.isDeafened);
  const soundboardVolume = useVoiceStore((s) => s.soundboardVolume);
  const soundboardMuted = useVoiceStore((s) => s.soundboardMuted);
  const setSoundboardVolume = useVoiceStore((s) => s.setSoundboardVolume);
  const setSoundboardMuted = useVoiceStore((s) => s.setSoundboardMuted);
  const markUserPlayingSoundboard = useVoiceStore((s) => s.markUserPlayingSoundboard);
  const activeSoundboardClips = useVoiceStore((s) => s.activeSoundboardClips);
  const tryStartSoundboardClip = useVoiceStore((s) => s.tryStartSoundboardClip);
  const finishSoundboardClip = useVoiceStore((s) => s.finishSoundboardClip);
  const channelToSpaceMap = useSpaceStore((s) => s.channelToSpaceMap);

  const origin = voiceSessionOrigin(useVoiceStore.getState());
  const spaceId = !activeDmCall && currentVoiceChannelId
    ? (channelToSpaceMap.get(currentVoiceChannelId) ?? null)
    : null;

  const [instanceSounds, setInstanceSounds] = useState<SoundboardSound[]>([]);
  const [scopeSounds, setScopeSounds] = useState<SoundboardSound[]>([]);
  const [maxConcurrentSounds, setMaxConcurrentSounds] = useState(3);
  const [soundboardEnabledInSpace, setSoundboardEnabledInSpace] = useState(true);
  const [allowInstanceSounds, setAllowInstanceSounds] = useState(true);
  const [loading, setLoading] = useState(false);
  const [previewingId, setPreviewingId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [collapsedFolders, setCollapsedFolders] = useState<Set<string>>(() => new Set());

  const fetchSounds = useCallback(async () => {
    setLoading(true);
    try {
      const client = getApiForOrigin(origin);
      const data = await client.soundboard.list({
        spaceId: spaceId ?? undefined,
      });
      setInstanceSounds(data.instanceSounds);
      setScopeSounds(data.scopedSounds);
      setMaxConcurrentSounds(data.maxConcurrentSounds ?? 3);
      setSoundboardEnabledInSpace(data.soundboardEnabled ?? true);
      setAllowInstanceSounds(data.spaceSettings?.allowInstanceSounds ?? true);
    } catch {
      addToast(t('soundboard.loadFailed'), 'warning');
    } finally {
      setLoading(false);
    }
  }, [origin, spaceId, addToast, t]);

  useEffect(() => {
    if (!isOpen) return;
    void fetchSounds();
  }, [isOpen, fetchSounds]);

  if (!isOpen) return null;

  const totalSoundCount = instanceSounds.length + scopeSounds.length;
  const normalizedQuery = searchQuery.trim().toLowerCase();

  const toggleFolder = (folderKey: string) => {
    setCollapsedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(folderKey)) next.delete(folderKey);
      else next.add(folderKey);
      return next;
    });
  };

  const handlePlay = async (sound: SoundboardSound) => {
    if (!tryStartSoundboardClip(sound.id, sound.durationMs, maxConcurrentSounds)) {
      return;
    }

    const resolvedUrl = sound.fileUrl.startsWith('/') && origin
      ? `${origin}${sound.fileUrl}`
      : sound.fileUrl;

    const myUserId = getMyUserIdForOrigin(origin);
    if (myUserId && !soundboardMuted) {
      markUserPlayingSoundboard(myUserId, sound.emoji, sound.name, sound.durationMs);
    }

    const clipScale = Math.max(0, Math.min(1, (sound.volumeOverride ?? 100) / 100));

    if (!isDeafened && !soundboardMuted && soundboardVolume > 0) {
      AudioManager.getInstance().setSoundboardVolume(soundboardVolume, soundboardMuted);
      void AudioManager.getInstance()
        .playSoundUrl(resolvedUrl, { volume: clipScale })
        .then((res) => {
          if (!res) {
            finishSoundboardClip(sound.id);
            return;
          }
          res.source.addEventListener('ended', () => {
            finishSoundboardClip(sound.id);
          });
        })
        .catch(() => {
          finishSoundboardClip(sound.id);
        });
    } else {
      // Local audio is muted/deafened so playSoundUrl won't fire `ended`; release
      // the slot after a short cooldown instead of blocking for up to 15s.
      const releaseMs = Math.max(400, Math.min(sound.durationMs > 0 ? sound.durationMs : 1500, 3000));
      setTimeout(() => {
        finishSoundboardClip(sound.id);
      }, releaseMs);
    }

    const room = getActiveRoom();
    if (room) {
      const payload = encodeSoundboardPlay({
        soundId: sound.id,
        fileUrl: sound.fileUrl,
        emoji: sound.emoji,
        name: sound.name,
        senderUserId: myUserId ?? room.localParticipant.identity.split(':')[0] ?? '',
        durationMs: sound.durationMs,
        ...(clipScale < 1 ? { volumeScale: clipScale } : {}),
      });
      room.localParticipant.publishData(new Uint8Array(payload), { reliable: true }).catch(() => {});
    }
  };

  const handlePreviewOnly = (e: React.MouseEvent, sound: SoundboardSound) => {
    e.preventDefault();
    e.stopPropagation();
    if (previewingId === sound.id) return;

    const resolvedUrl = sound.fileUrl.startsWith('/') && origin
      ? `${origin}${sound.fileUrl}`
      : sound.fileUrl;
    const clipScale = Math.max(0, Math.min(1, (sound.volumeOverride ?? 100) / 100));

    setPreviewingId(sound.id);
    AudioManager.getInstance().setSoundboardVolume(soundboardVolume, soundboardMuted);
    void AudioManager.getInstance()
      .playSoundUrl(resolvedUrl, { volume: clipScale })
      .then((res) => {
        if (!res) {
          setPreviewingId((curr) => (curr === sound.id ? null : curr));
          return;
        }
        res.source.addEventListener('ended', () => {
          setPreviewingId((curr) => (curr === sound.id ? null : curr));
        });
      })
      .catch(() => {
        setPreviewingId((curr) => (curr === sound.id ? null : curr));
      });
  };

  const atConcurrencyLimit = activeSoundboardClips.size >= maxConcurrentSounds;

  const renderSoundGrid = (items: SoundboardSound[]) => (
    <div className="grid grid-cols-2 gap-1.5">
      {items.map((sound) => {
        const isPlaying = activeSoundboardClips.has(sound.id);
        const isPreviewing = previewingId === sound.id;
        const isBlocked = !isPlaying && atConcurrencyLimit;
        return (
          <button
            key={sound.id}
            type="button"
            disabled={isPlaying || isBlocked}
            onClick={() => void handlePlay(sound)}
            // On touch devices, ContextMenuRenderer's useGlobalLongPress synthesizes
            // `contextmenu` after 500ms with a 10px movement tolerance, so delegating
            // to onContextMenu avoids double-firing and 1px touch-move cancellations.
            onContextMenu={(e) => handlePreviewOnly(e, sound)}
            className={`w-full flex items-center gap-2 px-2.5 py-2 rounded-lg border text-left transition-colors ${
              isPlaying
                ? 'bg-accent-primary/20 border-accent-primary/60 text-txt-primary cursor-default'
                : isPreviewing
                  ? 'bg-surface-elevated border-white/25 text-txt-primary cursor-pointer'
                  : isBlocked
                    ? 'bg-surface-channel border-white/[0.04] text-txt-primary opacity-45 cursor-not-allowed'
                    : 'bg-surface-channel border-white/[0.06] hover:bg-interactive-hover hover:border-white/10 text-txt-primary cursor-pointer'
            }`}
            title={sound.name}
          >
            <span className="text-base shrink-0 leading-none">{sound.emoji}</span>
            <span className="text-xs font-medium text-txt-primary truncate flex-1">
              {sound.name}
            </span>
          </button>
        );
      })}
    </div>
  );

  const renderSection = (
    title: string,
    sounds: SoundboardSound[],
    scopeType: SoundboardScopeType,
    scopeIdVal: string | null,
  ) => {
    const filtered = normalizedQuery
      ? sounds.filter((s) =>
          s.name.toLowerCase().includes(normalizedQuery)
          || (s.folder?.toLowerCase().includes(normalizedQuery) ?? false),
        )
      : sounds;

    const ungrouped = filtered.filter((s) => !s.folder?.trim());
    const folderMap = new Map<string, SoundboardSound[]>();
    for (const s of filtered) {
      const f = s.folder?.trim();
      if (!f) continue;
      folderMap.set(f, [...(folderMap.get(f) ?? []), s]);
    }

    return (
      <div className="space-y-2">
        <div className="text-[10px] font-bold uppercase tracking-wider text-txt-tertiary">
          {title}
        </div>

        {filtered.length === 0 ? (
          <div className="text-xs text-txt-tertiary py-3 px-2 text-center rounded-lg bg-white/[0.02] border border-white/[0.05]">
            {t('soundboard.emptyScope')}
          </div>
        ) : (
          <div className="space-y-2">
            {ungrouped.length > 0 && renderSoundGrid(ungrouped)}

            {Array.from(folderMap.entries()).map(([folderName, folderSounds]) => {
              const folderKey = `${scopeType}:${scopeIdVal ?? 'instance'}:${folderName}`;
              const isCollapsed = !normalizedQuery && collapsedFolders.has(folderKey);
              return (
                <div
                  key={folderKey}
                  className="rounded-lg bg-white/[0.02] border border-white/[0.06] p-2 space-y-2"
                >
                  <button
                    type="button"
                    onClick={() => toggleFolder(folderKey)}
                    className="w-full flex items-center gap-1.5 text-left text-xs font-medium text-txt-secondary hover:text-txt-primary transition-colors cursor-pointer"
                  >
                    <svg
                      className={`w-3.5 h-3.5 shrink-0 transition-transform ${isCollapsed ? '-rotate-90' : ''}`}
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.5"
                      aria-hidden="true"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 9l6 6 6-6" />
                    </svg>
                    <svg className="w-3.5 h-3.5 shrink-0 text-accent-primary/80" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                      <path d="M10 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z" />
                    </svg>
                    <span className="truncate flex-1">{folderName}</span>
                    <span className="text-[10px] text-txt-tertiary shrink-0">
                      {folderSounds.length}
                    </span>
                  </button>

                  {!isCollapsed && renderSoundGrid(folderSounds)}
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  };

  return (
    <div
      className={`glass-bubble w-80 max-w-[calc(var(--vw)*100-2rem)] rounded-xl p-3.5 text-txt-primary shadow-2xl border border-border-soft space-y-3 ${className}`}
      onClick={(e) => e.stopPropagation()}
    >
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <svg className="w-4 h-4 text-accent-primary" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z" />
          </svg>
          <span className="text-sm font-semibold text-txt-primary">{t('soundboard.title')}</span>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="p-1 rounded-md text-txt-tertiary hover:text-txt-primary hover:bg-interactive-hover transition-colors cursor-pointer"
          aria-label={t('soundboard.close')}
        >
          <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M18 6L6 18M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Volume & Global Mute Bar */}
      <div className="flex items-center gap-2.5 px-2.5 py-2 rounded-lg bg-white/[0.03] border border-white/[0.06]">
        <button
          type="button"
          onClick={() => {
            const nextMuted = !soundboardMuted;
            setSoundboardMuted(nextMuted);
            AudioManager.getInstance().setSoundboardVolume(soundboardVolume, nextMuted);
          }}
          className={`p-1 rounded-md transition-colors cursor-pointer ${
            soundboardMuted
              ? 'text-txt-danger bg-accent-rose/15'
              : 'text-txt-secondary hover:text-txt-primary hover:bg-interactive-hover'
          }`}
          aria-label={soundboardMuted ? t('soundboard.unmuteAll') : t('soundboard.muteAll')}
          title={soundboardMuted ? t('soundboard.unmuteAll') : t('soundboard.muteAll')}
        >
          {soundboardMuted ? (
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M11 5L6 9H2v6h4l5 4V5zM23 9l-6 6M17 9l6 6" />
            </svg>
          ) : (
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M11 5L6 9H2v6h4l5 4V5zM15.54 8.46a5 5 0 0 1 0 7.07M19.07 4.93a10 10 0 0 1 0 14.14" />
            </svg>
          )}
        </button>
        <input
          type="range"
          min={0}
          max={100}
          step={1}
          value={soundboardMuted ? 0 : Math.min(100, soundboardVolume)}
          onChange={(e) => {
            const val = Number(e.target.value);
            const nextMuted = soundboardMuted && val > 0 ? false : soundboardMuted;
            if (soundboardMuted && val > 0) setSoundboardMuted(false);
            setSoundboardVolume(val);
            AudioManager.getInstance().setSoundboardVolume(val, nextMuted);
          }}
          aria-label={t('soundboard.volumeLabel')}
          className="flex-1 h-1.5 rounded-full appearance-none cursor-pointer bg-surface-base
            [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3
            [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:shadow-md
            [&::-webkit-slider-thumb]:cursor-pointer [&::-webkit-slider-thumb]:border-0"
          style={{
            background: (() => {
              const pct = soundboardMuted ? 0 : Math.max(0, Math.min(100, soundboardVolume));
              return `linear-gradient(to right, rgb(var(--accent-primary)) 0%, rgb(var(--accent-primary)) ${pct}%, rgb(var(--interactive-muted)) ${pct}%, rgb(var(--interactive-muted)) 100%)`;
            })(),
          }}
        />
        <span className="text-[11px] font-mono tabular-nums text-txt-tertiary w-9 text-right">
          {t('soundboard.volumePercent', { value: soundboardMuted ? 0 : Math.min(100, soundboardVolume) })}
        </span>
      </div>

      {/* Quick Search (shown when 5+ sounds exist) */}
      {totalSoundCount >= 5 && (
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder={t('soundboard.searchPlaceholder')}
          className="input-standard w-full h-8 px-2.5 text-xs"
        />
      )}

      {/* Sound Sections */}
      <div className="max-h-80 overflow-y-auto scrollbar-thin pr-0.5 space-y-4">
        {loading && instanceSounds.length === 0 && scopeSounds.length === 0 ? (
          <div className="py-6 text-center text-xs text-txt-tertiary">
            {t('soundboard.loading')}
          </div>
        ) : !soundboardEnabledInSpace ? (
          <div className="py-6 px-3 text-center text-xs text-txt-tertiary rounded-lg bg-white/[0.02] border border-white/[0.05]">
            {t('soundboard.disabledInSpace')}
          </div>
        ) : (
          <>
            {spaceId && renderSection(
              t('soundboard.spaceSection'),
              scopeSounds,
              'space',
              spaceId,
            )}

            {allowInstanceSounds && renderSection(
              t('soundboard.instanceSection'),
              instanceSounds,
              'instance',
              null,
            )}
          </>
        )}
      </div>

      {/* Subtle footer hint for local right-click preview */}
      {totalSoundCount > 0 && (
        <div className="pt-1.5 border-t border-white/[0.05] text-[10px] text-txt-tertiary/80 text-center select-none">
          {t('soundboard.previewHint')}
        </div>
      )}
    </div>
  );
}
