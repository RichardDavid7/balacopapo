import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import type { SoundboardScopeType, SoundboardSound } from '@backspace/shared';
import { getApiForOrigin } from '../../stores/spaceStore';
import { useUIStore } from '../../stores/uiStore';
import { usePortalContainer } from '../../hooks/usePortalContainer';
import { Modal } from '../ui/Modal';
import { Toggle } from '../ui/Toggle';
import {
  computeNormalizeGain,
  computeWaveformPeaks,
  softLimitSample,
  trimAndNormalizeToWav,
} from '../../utils/audioClipEditor';
import { EmojiPicker } from '../chat/EmojiPicker';
import { AudioManager } from '../../audio/AudioManager';

const MAX_CLIP_SECONDS = 10;

/**
 * Decode an audio file without opening a hardware AudioContext (avoids leaking
 * PipeWire/PulseAudio handles on Linux and iOS Safari gesture restrictions).
 */
async function decodeAudioArrayBuffer(ab: ArrayBuffer): Promise<AudioBuffer> {
  if (typeof OfflineAudioContext !== 'undefined') {
    const offline = new OfflineAudioContext(1, 1, 48000);
    return offline.decodeAudioData(ab);
  }
  const ctx = new AudioContext();
  try {
    return await ctx.decodeAudioData(ab);
  } finally {
    await ctx.close().catch(() => {});
  }
}

interface SoundboardEditorModalProps {
  isOpen: boolean;
  scopeType: SoundboardScopeType;
  scopeId: string | null;
  origin: string;
  initialSound?: SoundboardSound | null;
  defaultFolder?: string | null;
  existingFolders?: string[];
  onClose: () => void;
  onSaved: (sound: SoundboardSound) => void;
}

export function SoundboardEditorModal({
  isOpen,
  scopeType,
  scopeId,
  origin,
  initialSound,
  defaultFolder = null,
  existingFolders = [],
  onClose,
  onSaved,
}: SoundboardEditorModalProps) {
  const { t } = useTranslation('voice');
  const addToast = useUIStore((s) => s.addToast);
  const isMobile = useUIStore((s) => s.isMobile);
  const portalContainer = usePortalContainer();

  const [name, setName] = useState('');
  const [emoji, setEmoji] = useState('🔊');
  const [emojiPickerOpen, setEmojiPickerOpen] = useState(false);
  const [folder, setFolder] = useState('');
  const [normalize, setNormalize] = useState(true);
  const [audioBuffer, setAudioBuffer] = useState<AudioBuffer | null>(null);
  const [startSec, setStartSec] = useState(0);
  const [endSec, setEndSec] = useState(0);
  const [audioDirty, setAudioDirty] = useState(false);
  const [loadingAudio, setLoadingAudio] = useState(false);
  const [isPlayingPreview, setIsPlayingPreview] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const previewSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const releasePreviewSessionRef = useRef<(() => void) | null>(null);

  const stopPreview = () => {
    try {
      previewSourceRef.current?.stop();
    } catch {
      // ignore already-stopped source
    }
    previewSourceRef.current = null;
    releasePreviewSessionRef.current?.();
    releasePreviewSessionRef.current = null;
    setIsPlayingPreview(false);
  };

  useEffect(() => {
    if (!isOpen) {
      stopPreview();
      return;
    }

    setError(null);
    setSaving(false);
    setAudioDirty(false);
    setEmojiPickerOpen(false);

    if (initialSound) {
      setName(initialSound.name);
      setEmoji(initialSound.emoji || '🔊');
      setFolder(initialSound.folder ?? '');
      setNormalize(false);
      setAudioBuffer(null);
      setStartSec(0);
      setEndSec(0);

      let cancelled = false;
      setLoadingAudio(true);
      const url = initialSound.fileUrl.startsWith('/') && origin
        ? `${origin}${initialSound.fileUrl}`
        : initialSound.fileUrl;

      void (async () => {
        try {
          const resp = await fetch(url);
          if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
          const ab = await resp.arrayBuffer();
          const decoded = await decodeAudioArrayBuffer(ab);
          if (cancelled) return;
          setAudioBuffer(decoded);
          setStartSec(0);
          setEndSec(Math.min(decoded.duration, MAX_CLIP_SECONDS));
        } catch {
          if (!cancelled) {
            setError(t('soundboard.loadAudioFailed'));
          }
        } finally {
          if (!cancelled) setLoadingAudio(false);
        }
      })();

      return () => {
        cancelled = true;
      };
    } else {
      setName('');
      setEmoji('🔊');
      setFolder(defaultFolder ?? '');
      setNormalize(true);
      setAudioBuffer(null);
      setStartSec(0);
      setEndSec(0);
    }
  }, [isOpen, initialSound, defaultFolder, origin, t]);

  useEffect(() => {
    return () => {
      stopPreview();
    };
  }, []);

  const peaks = useMemo(() => {
    if (!audioBuffer) return [];
    return computeWaveformPeaks(audioBuffer, 64);
  }, [audioBuffer]);

  const duration = audioBuffer?.duration ?? 0;
  const trimDuration = Math.max(0, endSec - startSec);

  const handleFileChange = async (file: File | null) => {
    if (!file) return;
    stopPreview();
    setError(null);
    setLoadingAudio(true);
    try {
      const arrayBuffer = await file.arrayBuffer();
      const decoded = await decodeAudioArrayBuffer(arrayBuffer);

      setAudioBuffer(decoded);
      setStartSec(0);
      setEndSec(Math.min(decoded.duration, MAX_CLIP_SECONDS));
      setAudioDirty(true);
      if (!name.trim()) {
        const baseName = file.name.replace(/\.[^/.]+$/, '').slice(0, 32);
        setName(baseName);
      }
    } catch {
      setError(t('soundboard.decodeFailed'));
    } finally {
      setLoadingAudio(false);
    }
  };

  const handleStartChange = (nextStart: number) => {
    const clampedStart = Math.max(0, Math.min(nextStart, Math.max(0, endSec - 0.1)));
    setStartSec(clampedStart);
    if (endSec - clampedStart > MAX_CLIP_SECONDS) {
      setEndSec(Math.min(duration, clampedStart + MAX_CLIP_SECONDS));
    }
    setAudioDirty(true);
  };

  const handleEndChange = (nextEnd: number) => {
    const clampedEnd = Math.min(duration, Math.max(nextEnd, startSec + 0.1));
    if (clampedEnd - startSec > MAX_CLIP_SECONDS) {
      setStartSec(Math.max(0, clampedEnd - MAX_CLIP_SECONDS));
    }
    setEndSec(clampedEnd);
    setAudioDirty(true);
  };

  const normalizeGain = useMemo(() => {
    if (!audioBuffer) return 1;
    const startSample = Math.max(0, Math.min(audioBuffer.length - 1, Math.floor(startSec * audioBuffer.sampleRate)));
    const endSample = Math.max(startSample + 1, Math.min(audioBuffer.length, Math.ceil(endSec * audioBuffer.sampleRate)));
    return computeNormalizeGain(audioBuffer, startSample, endSample);
  }, [audioBuffer, startSec, endSec]);

  const normalizeDb = useMemo(() => 20 * Math.log10(Math.max(1e-4, normalizeGain)), [normalizeGain]);

  const handlePreview = async () => {
    if (!audioBuffer) return;
    if (isPlayingPreview) {
      stopPreview();
      return;
    }

    try {
      const audioManager = AudioManager.getInstance();
      releasePreviewSessionRef.current?.();
      releasePreviewSessionRef.current = audioManager.acquireAudioSession();
      await audioManager.resumeContext();
      const ctx = audioManager.ensureContext();

      const source = ctx.createBufferSource();
      let startOffset = startSec;
      let playDuration = Math.max(0.05, endSec - startSec);

      if (normalize) {
        const sr = audioBuffer.sampleRate;
        const startSample = Math.max(0, Math.min(audioBuffer.length - 1, Math.floor(startSec * sr)));
        const endSample = Math.max(startSample + 1, Math.min(audioBuffer.length, Math.ceil(endSec * sr)));
        const frameCount = endSample - startSample;
        const numCh = Math.min(2, Math.max(1, audioBuffer.numberOfChannels));
        const processed = ctx.createBuffer(numCh, frameCount, sr);
        for (let ch = 0; ch < numCh; ch++) {
          const src = audioBuffer.getChannelData(ch);
          const dst = processed.getChannelData(ch);
          for (let i = 0; i < frameCount; i++) {
            dst[i] = softLimitSample((src[startSample + i] ?? 0) * normalizeGain);
          }
        }
        source.buffer = processed;
        startOffset = 0;
        playDuration = frameCount / sr;
      } else {
        source.buffer = audioBuffer;
      }

      const gain = ctx.createGain();
      gain.gain.value = 0.85;

      source.connect(gain);
      gain.connect(audioManager.getMasterOutput());
      source.onended = () => {
        source.disconnect();
        gain.disconnect();
        if (previewSourceRef.current === source) {
          previewSourceRef.current = null;
          releasePreviewSessionRef.current?.();
          releasePreviewSessionRef.current = null;
          setIsPlayingPreview(false);
        }
      };

      previewSourceRef.current = source;
      setIsPlayingPreview(true);
      source.start(0, startOffset, playDuration);
    } catch {
      releasePreviewSessionRef.current?.();
      releasePreviewSessionRef.current = null;
      setIsPlayingPreview(false);
    }
  };

  const handleSave = async () => {
    const trimmedName = name.trim();
    if (!trimmedName) {
      setError(t('soundboard.nameRequired'));
      return;
    }
    if (!initialSound && !audioBuffer) {
      setError(t('soundboard.audioRequired'));
      return;
    }

    stopPreview();
    setSaving(true);
    setError(null);

    try {
      const client = getApiForOrigin(origin);
      const safeEmoji = emoji.trim() || '🔊';
      const normalizedFolder = folder.trim().slice(0, 32) || null;

      if (initialSound && !audioDirty) {
        const updated = await client.soundboard.update(initialSound.id, {
          name: trimmedName,
          emoji: safeEmoji,
          folder: normalizedFolder,
        });
        onSaved(updated);
        onClose();
        return;
      }

      if (!audioBuffer) {
        setError(t('soundboard.audioRequired'));
        setSaving(false);
        return;
      }

      const { blob, durationMs } = trimAndNormalizeToWav(
        audioBuffer,
        startSec,
        endSec,
        normalize,
      );

      const formData = new FormData();
      formData.append('name', trimmedName);
      formData.append('emoji', safeEmoji);
      formData.append('folder', normalizedFolder ?? '');
      formData.append('durationMs', String(durationMs));
      if (!initialSound) {
        formData.append('scopeType', scopeType);
        if (scopeId) formData.append('scopeId', scopeId);
      }
      formData.append('file', blob, 'clip.wav');

      const saved = initialSound
        ? await client.soundboard.update(initialSound.id, formData)
        : await client.soundboard.create(formData);

      addToast(
        initialSound ? t('soundboard.savedToast') : t('soundboard.uploadedToast'),
        'success',
      );
      onSaved(saved);
      onClose();
    } catch (err) {
      const msg = err instanceof Error ? err.message : t('soundboard.saveFailed');
      setError(msg);
    } finally {
      setSaving(false);
    }
  };

  const startPct = duration > 0 ? (startSec / duration) * 100 : 0;
  const endPct = duration > 0 ? (endSec / duration) * 100 : 100;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={initialSound ? t('soundboard.editTitle') : t('soundboard.addTitle')}
      maxWidth="max-w-lg"
    >
      <div
        className="space-y-4"
        onClick={() => {
          if (emojiPickerOpen) setEmojiPickerOpen(false);
        }}
      >
        {/* Name & Emoji */}
        <div className="grid grid-cols-[68px_1fr] gap-3">
          <div className="relative" onClick={(e) => e.stopPropagation()}>
            <label className="block text-[11px] font-semibold uppercase tracking-wider text-txt-tertiary mb-1.5">
              {t('soundboard.emojiLabel')}
            </label>
            <button
              type="button"
              onClick={() => setEmojiPickerOpen((v) => !v)}
              className="w-full h-10 rounded-lg bg-surface-channel border border-white/[0.08] hover:bg-interactive-hover hover:border-white/15 flex items-center justify-center text-xl transition-colors cursor-pointer"
              title={t('soundboard.emojiLabel')}
            >
              {emoji}
            </button>
            {emojiPickerOpen && !isMobile && (
              <div
                className="absolute left-0 top-full mt-2 z-[250] rounded-xl overflow-hidden shadow-2xl border border-border-soft"
                onClick={(e) => e.stopPropagation()}
              >
                <EmojiPicker
                  stickers={false}
                  onEmojiSelect={(selected) => {
                    setEmoji(selected.native);
                    setEmojiPickerOpen(false);
                  }}
                />
              </div>
            )}
            {emojiPickerOpen &&
              isMobile &&
              createPortal(
                <div
                  className="fixed inset-0 z-[260] flex items-end justify-center animate-fade-in"
                  onClick={() => setEmojiPickerOpen(false)}
                >
                  <div className="absolute inset-0 bg-black/50" />
                  <div
                    className="relative w-full h-[calc(var(--vh)*65)] max-h-[520px] flex flex-col glass-modal rounded-t-2xl overflow-hidden animate-slide-up"
                    style={{ paddingBottom: 'var(--safe-bottom)' }}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <EmojiPicker
                      mobile
                      stickers={false}
                      onEmojiSelect={(selected) => {
                        setEmoji(selected.native);
                        setEmojiPickerOpen(false);
                      }}
                    />
                  </div>
                </div>,
                portalContainer,
              )}
          </div>
          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-wider text-txt-tertiary mb-1.5">
              {t('soundboard.nameLabel')}
            </label>
            <input
              type="text"
              value={name}
              maxLength={32}
              placeholder={t('soundboard.namePlaceholder')}
              onChange={(e) => setName(e.target.value)}
              className="input-standard w-full h-10 px-3 text-sm"
            />
          </div>
        </div>

        {/* Folder (optional) */}
        <div className="space-y-1.5">
          <label className="block text-[11px] font-semibold uppercase tracking-wider text-txt-tertiary">
            {t('soundboard.folderLabel')}
          </label>
          <input
            type="text"
            value={folder}
            maxLength={32}
            placeholder={t('soundboard.folderPlaceholder')}
            onChange={(e) => setFolder(e.target.value)}
            className="input-standard w-full h-9 px-3 text-xs"
          />
          {existingFolders.length > 0 && (
            <div className="flex flex-wrap gap-1.5 pt-0.5">
              <button
                type="button"
                onClick={() => setFolder('')}
                className={`px-2.5 py-1 rounded text-[11px] font-medium transition-colors cursor-pointer ${
                  folder.trim() === ''
                    ? 'bg-accent-primary text-white'
                    : 'bg-surface-elevated text-txt-secondary hover:bg-interactive-hover'
                }`}
              >
                {t('soundboard.noFolder')}
              </button>
              {existingFolders.map((f) => (
                <button
                  key={f}
                  type="button"
                  onClick={() => setFolder(f)}
                  className={`px-2.5 py-1 rounded text-[11px] font-medium transition-colors cursor-pointer ${
                    folder.trim() === f
                      ? 'bg-accent-primary text-white'
                      : 'bg-surface-elevated text-txt-secondary hover:bg-interactive-hover'
                  }`}
                >
                  {f}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Audio File Picker */}
        <div>
          <input
            ref={fileInputRef}
            type="file"
            accept="audio/*,.wav,.mp3,.ogg,.webm,.m4a,.aac,.flac,.opus"
            className="hidden"
            onChange={(e) => void handleFileChange(e.target.files?.[0] ?? null)}
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="w-full flex items-center justify-center gap-2 py-2.5 px-3 rounded-lg border border-dashed border-white/15 hover:border-accent-primary/70 bg-white/[0.02] hover:bg-interactive-hover text-sm text-txt-secondary hover:text-txt-primary transition-colors cursor-pointer"
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12" />
            </svg>
            <span>
              {audioBuffer ? t('soundboard.replaceAudio') : t('soundboard.chooseAudio')}
            </span>
          </button>
        </div>

        {/* Mini Waveform Trim Editor */}
        {loadingAudio && (
          <div className="py-6 text-center text-xs text-txt-tertiary">
            {t('soundboard.loadingAudio')}
          </div>
        )}

        {audioBuffer && !loadingAudio && (
          <div className="space-y-3 p-3.5 rounded-lg bg-white/[0.02] border border-white/[0.06]">
            <div className="flex items-center justify-between text-xs text-txt-secondary">
              <span className="inline-flex items-center gap-1.5 font-medium">
                <svg className="w-3.5 h-3.5 text-accent-primary" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                  <circle cx="6" cy="6" r="3" />
                  <circle cx="6" cy="18" r="3" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M20 4L8.12 15.88M14.47 14.48L20 20M8.12 8.12L12 12" />
                </svg>
                {t('soundboard.trimEditor')}
              </span>
              <span className="font-mono tabular-nums text-[11px] text-txt-tertiary">
                {t('soundboard.trimRange', {
                  start: startSec.toFixed(2),
                  end: endSec.toFixed(2),
                  duration: trimDuration.toFixed(2),
                })}
              </span>
            </div>

            {/* Waveform Bars */}
            <div className="relative h-16 flex items-center gap-[2px] px-1.5 rounded-lg bg-surface-base/80 border border-white/[0.04] overflow-hidden">
              {peaks.map((peak, idx) => {
                const pct = ((idx + 0.5) / peaks.length) * 100;
                const inRange = pct >= startPct && pct <= endPct;
                const displayPeak = normalize && inRange
                  ? Math.abs(softLimitSample(peak * normalizeGain))
                  : peak;
                const heightPct = Math.max(8, Math.min(100, Math.round(displayPeak * 100)));
                return (
                  <div
                    key={idx}
                    className={`flex-1 rounded-full transition-[height,background-color] duration-150 ${
                      inRange ? 'bg-accent-primary' : 'bg-white/15'
                    }`}
                    style={{ height: `${heightPct}%` }}
                  />
                );
              })}
            </div>

            {/* Start / End Range Sliders */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <div className="flex justify-between text-[11px] text-txt-tertiary mb-1.5">
                  <span>{t('soundboard.trimStart')}</span>
                  <span className="font-mono tabular-nums">{t('soundboard.seconds', { value: startSec.toFixed(2) })}</span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={Math.max(0.1, duration - 0.1)}
                  step={0.05}
                  value={startSec}
                  onChange={(e) => handleStartChange(Number(e.target.value))}
                  className="w-full h-1.5 rounded-full appearance-none cursor-pointer bg-surface-base
                    [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3
                    [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:shadow-md
                    [&::-webkit-slider-thumb]:cursor-pointer [&::-webkit-slider-thumb]:border-0"
                  style={{
                    background: (() => {
                      const maxStart = Math.max(0.1, duration - 0.1);
                      const pct = Math.max(0, Math.min(100, (startSec / maxStart) * 100));
                      return `linear-gradient(to right, rgb(var(--accent-primary)) 0%, rgb(var(--accent-primary)) ${pct}%, rgb(var(--interactive-muted)) ${pct}%, rgb(var(--interactive-muted)) 100%)`;
                    })(),
                  }}
                />
              </div>
              <div>
                <div className="flex justify-between text-[11px] text-txt-tertiary mb-1.5">
                  <span>{t('soundboard.trimEnd')}</span>
                  <span className="font-mono tabular-nums">{t('soundboard.seconds', { value: endSec.toFixed(2) })}</span>
                </div>
                <input
                  type="range"
                  min={0.1}
                  max={duration}
                  step={0.05}
                  value={endSec}
                  onChange={(e) => handleEndChange(Number(e.target.value))}
                  className="w-full h-1.5 rounded-full appearance-none cursor-pointer bg-surface-base
                    [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3
                    [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:shadow-md
                    [&::-webkit-slider-thumb]:cursor-pointer [&::-webkit-slider-thumb]:border-0"
                  style={{
                    background: (() => {
                      const span = Math.max(0.01, duration - 0.1);
                      const pct = Math.max(0, Math.min(100, ((endSec - 0.1) / span) * 100));
                      return `linear-gradient(to right, rgb(var(--accent-primary)) 0%, rgb(var(--accent-primary)) ${pct}%, rgb(var(--interactive-muted)) ${pct}%, rgb(var(--interactive-muted)) 100%)`;
                    })(),
                  }}
                />
              </div>
            </div>

            {/* Preview + Normalize Row */}
            <div className="flex items-center justify-between gap-2 pt-1 border-t border-white/[0.04]">
              <button
                type="button"
                onClick={() => void handlePreview()}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-surface-elevated hover:bg-interactive-hover text-txt-primary text-xs font-medium transition-colors cursor-pointer"
              >
                {isPlayingPreview ? (
                  <>
                    <svg className="w-3.5 h-3.5 fill-current text-accent-primary" viewBox="0 0 24 24" aria-hidden="true">
                      <rect x="6" y="6" width="12" height="12" rx="1.5" />
                    </svg>
                    <span>{t('soundboard.stopPreview')}</span>
                  </>
                ) : (
                  <>
                    <svg className="w-3.5 h-3.5 fill-current text-accent-primary" viewBox="0 0 24 24" aria-hidden="true">
                      <path d="M8 5v14l11-7z" />
                    </svg>
                    <span>{t('soundboard.preview')}</span>
                  </>
                )}
              </button>

              <div className="inline-flex items-center gap-2 text-xs text-txt-secondary">
                <span>{t('soundboard.normalizeVolume')}</span>
                {normalize && Math.abs(normalizeDb) >= 0.2 && (
                  <span
                    className={`px-1.5 py-0.5 rounded text-[10px] font-mono tabular-nums ${
                      normalizeDb < 0
                        ? 'bg-accent-amber/15 text-accent-amber'
                        : 'bg-accent-primary/15 text-accent-primary'
                    }`}
                  >
                    {t('soundboard.decibels', {
                      value: `${normalizeDb > 0 ? '+' : ''}${normalizeDb.toFixed(1)}`,
                    })}
                  </span>
                )}
                <Toggle
                  enabled={normalize}
                  onChange={(enabled) => {
                    stopPreview();
                    setNormalize(enabled);
                    setAudioDirty(true);
                  }}
                />
              </div>
            </div>
          </div>
        )}

        {error && (
          <div className="p-2 bg-accent-rose/10 border border-accent-rose/30 rounded text-txt-danger text-xs">
            {error}
          </div>
        )}

        {/* Footer Actions */}
        <div className="flex items-center justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 text-sm text-txt-tertiary hover:text-txt-secondary transition-colors cursor-pointer"
          >
            {t('soundboard.cancel')}
          </button>
          <button
            type="button"
            disabled={saving || loadingAudio}
            onClick={() => void handleSave()}
            className="px-4 py-1.5 rounded-full text-sm font-medium bg-accent-primary hover:bg-accent-primary/80 text-white disabled:opacity-50 transition-colors cursor-pointer"
          >
            {saving ? t('soundboard.saving') : t('soundboard.save')}
          </button>
        </div>
      </div>
    </Modal>
  );
}
