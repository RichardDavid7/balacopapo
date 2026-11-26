import { useTranslation } from 'react-i18next';
import {
  useVoiceStore,
  MIN_AUDIO_BITRATE_KBPS,
  MAX_AUDIO_BITRATE_KBPS,
  type AudioMode,
} from '../../../stores/voiceStore';
import { useSettingsStore, selectStreamingLimits } from '../../../stores/settingsStore';
import { getChannelOrigin, useSpaceStore } from '../../../stores/spaceStore';
import { useUIStore } from '../../../stores/uiStore';
import { useFormatters } from '../../../i18n/formatters';
import { resolveAudioPolicyHierarchy } from '../../../utils/audioPolicy';
import { Toggle } from '../../ui/Toggle';
import { VideoSection } from './VideoSection';
import { AudioInputSection } from './AudioInputSection';
import { AudioOutputSection } from './AudioOutputSection';
import { Track, type RemoteAudioTrack } from 'livekit-client';
import { getActiveRoom, applyAudioReceiverJitterBuffer } from '../../../hooks/useLiveKit';

const JITTER_BUFFER_PRESETS = [0, 40, 80, 120, 250, 500, 1000] as const;
const MAX_JITTER_BUFFER_MS = 2000;

export function VoicePanel() {
  const { t } = useTranslation(['settings', 'common']);
  const f = useFormatters();
  const echoCancellation = useVoiceStore((s) => s.echoCancellation);
  const autoGainControl = useVoiceStore((s) => s.autoGainControl);
  const rnnoiseEnabled = useVoiceStore((s) => s.rnnoiseEnabled);
  const setEchoCancellation = useVoiceStore((s) => s.setEchoCancellation);
  const setAutoGainControl = useVoiceStore((s) => s.setAutoGainControl);
  const setRnnoiseEnabled = useVoiceStore((s) => s.setRnnoiseEnabled);
  const soundEffectVolume = useVoiceStore((s) => s.soundEffectVolume);
  const setSoundEffectVolume = useVoiceStore((s) => s.setSoundEffectVolume);
  const messageSoundAllChannels = useVoiceStore((s) => s.messageSoundAllChannels);
  const setMessageSoundAllChannels = useVoiceStore((s) => s.setMessageSoundAllChannels);
  const pipEnabled = useVoiceStore((s) => s.pipEnabled);
  const setPipEnabled = useVoiceStore((s) => s.setPipEnabled);
  const audioMode = useVoiceStore((s) => s.audioMode);
  const setAudioMode = useVoiceStore((s) => s.setAudioMode);
  const audioStereo = useVoiceStore((s) => s.audioStereo);
  const setAudioStereo = useVoiceStore((s) => s.setAudioStereo);
  const audioBitrateAuto = useVoiceStore((s) => s.audioBitrateAuto);
  const setAudioBitrateAuto = useVoiceStore((s) => s.setAudioBitrateAuto);
  const audioBitrate = useVoiceStore((s) => s.audioBitrate);
  const setAudioBitrate = useVoiceStore((s) => s.setAudioBitrate);
  const jitterBufferMs = useVoiceStore((s) => s.jitterBufferMs);
  const setJitterBufferMs = useVoiceStore((s) => s.setJitterBufferMs);

  const handleJitterBufferChange = (ms: number) => {
    setJitterBufferMs(ms);
    const room = getActiveRoom();
    if (!room) return;
    room.remoteParticipants.forEach((rp) => {
      rp.trackPublications.forEach((pub) => {
        if (pub.track && pub.track.kind === Track.Kind.Audio) {
          applyAudioReceiverJitterBuffer(pub.track as RemoteAudioTrack, ms, pub.source);
        }
      });
    });
  };
  const currentVoiceChannelId = useVoiceStore((s) => s.currentVoiceChannelId);
  const currentVoiceChannel = useSpaceStore((s) =>
    currentVoiceChannelId ? s.channels.find((c) => c.id === currentVoiceChannelId) : undefined,
  );
  const currentVoiceCategory = useSpaceStore((s) =>
    currentVoiceChannel?.categoryId
      ? s.categories.find((cat) => cat.id === currentVoiceChannel.categoryId)
      : undefined,
  );
  const currentVoiceSpace = useSpaceStore((s) =>
    currentVoiceChannel?.spaceId
      ? s.spaces.find((sp) => sp.id === currentVoiceChannel.spaceId)
      : undefined,
  );
  const voiceOrigin = currentVoiceChannelId ? getChannelOrigin(currentVoiceChannelId) : '';
  const streamingLimits = useSettingsStore((s) => selectStreamingLimits(s, voiceOrigin) ?? s.streamingLimits);

  const effectivePolicy = resolveAudioPolicyHierarchy({
    instance: streamingLimits,
    space: currentVoiceSpace,
    category: currentVoiceCategory,
    channel: currentVoiceChannel,
  });
  const effectiveMaxBitrate = Math.min(effectivePolicy.maxBitrateKbps, MAX_AUDIO_BITRATE_KBPS);
  const musicAllowed = effectivePolicy.allowMusicMode;
  const stereoAllowed = effectivePolicy.allowStereoAudio;
  const effectiveAutoBitrate = effectivePolicy.defaultBitrateKbps;
  const displayedBitrate = audioBitrateAuto
    ? effectiveAutoBitrate
    : Math.min(audioBitrate, effectiveMaxBitrate);

  const sliderSpan = Math.max(1, effectiveMaxBitrate - MIN_AUDIO_BITRATE_KBPS);
  const bitratePercent = ((displayedBitrate - MIN_AUDIO_BITRATE_KBPS) / sliderSpan) * 100;
  const bitrateTicks = [MIN_AUDIO_BITRATE_KBPS, 128, 256, 384, effectiveMaxBitrate]
    .filter((v, i, arr) => v >= MIN_AUDIO_BITRATE_KBPS && v <= effectiveMaxBitrate && arr.indexOf(v) === i);
  const bitrateNotice =
    displayedBitrate < 32
      ? { text: t('settings:voice.opus.bitrate.warningLow'), tone: 'text-accent-amber' }
      : displayedBitrate > 192
        ? { text: t('settings:voice.opus.bitrate.warningVeryHigh'), tone: 'text-accent-amber' }
        : displayedBitrate > 96
          ? { text: t('settings:voice.opus.bitrate.warningHigh'), tone: 'text-accent-amber/90' }
          : { text: t('settings:voice.opus.bitrate.hintDefault'), tone: 'text-txt-tertiary' };
  // The floating window is mounted only by the desktop layout (AppLayout), and
  // the mobile Voice settings screen renders this same panel, so the setting is
  // offered only where it has an effect.
  const isMobile = useUIStore((s) => s.isMobile);

  return (
    <div className="space-y-5">
      <h2 className="text-lg font-semibold text-txt-primary mb-6">{t('settings:voice.title')}</h2>

      <AudioInputSection />
      <AudioOutputSection />

      <div>
        <div className="text-[11px] font-semibold text-txt-tertiary uppercase tracking-wider mb-1.5">
          {t('settings:voice.volume.sectionTitle')}
        </div>
        <div className="rounded-lg bg-white/[0.03] border border-white/[0.04] p-3.5">
          <div className="py-1">
            <div className="flex items-center justify-between mb-2">
              <div className="text-sm text-txt-primary">{t('settings:voice.volume.soundEffects.label')}</div>
              <div className="text-xs text-txt-tertiary tabular-nums">{f.formatPercent(soundEffectVolume)}</div>
            </div>
            <input
              type="range"
              min={0}
              max={200}
              value={soundEffectVolume}
              onChange={(e) => setSoundEffectVolume(Number(e.target.value))}
              className="w-full h-1.5 rounded-full appearance-none cursor-pointer bg-surface-base [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:shadow-md"
              style={{
                background: `linear-gradient(to right, rgb(var(--accent-primary)) 0%, rgb(var(--accent-primary)) ${soundEffectVolume / 2}%, rgb(var(--interactive-muted)) ${soundEffectVolume / 2}%, rgb(var(--interactive-muted)) 100%)`,
              }}
            />
          </div>
          <div className="flex items-center justify-between py-2">
            <div className="flex-1 mr-4">
              <div className="text-sm text-txt-primary">{t('settings:voice.volume.messageSound.label')}</div>
              <div className="text-xs text-txt-tertiary">
                {t('settings:voice.volume.messageSound.description')}
              </div>
            </div>
            <Toggle enabled={messageSoundAllChannels} onChange={setMessageSoundAllChannels} />
          </div>
        </div>
      </div>

      {!isMobile && (
        <div>
          <div className="text-[11px] font-semibold text-txt-tertiary uppercase tracking-wider mb-1.5">
            {t('settings:voice.pip.sectionTitle')}
          </div>
          <div className="rounded-lg bg-white/[0.03] border border-white/[0.04] p-3.5">
            <div className="flex items-center justify-between py-2">
              <div className="flex-1 mr-4">
                <div className="text-sm text-txt-primary">{t('settings:voice.pip.showOnSwitch.label')}</div>
                <div className="text-xs text-txt-tertiary">{t('settings:voice.pip.showOnSwitch.description')}</div>
              </div>
              <Toggle
                enabled={pipEnabled}
                onChange={setPipEnabled}
                ariaLabel={t('settings:voice.pip.showOnSwitch.label')}
              />
            </div>
          </div>
        </div>
      )}

      <VideoSection />

      <div>
        <div className="text-[11px] font-semibold text-txt-tertiary uppercase tracking-wider mb-1.5">
          {t('settings:voice.opus.sectionTitle')}
        </div>
        <div className="rounded-lg bg-white/[0.03] border border-white/[0.04] p-3.5 space-y-3">
          {/* Audio Mode: Voice vs Music */}
          <div className="flex items-center justify-between gap-4 py-1">
            <div className="flex-1 min-w-0">
              <div className="text-sm text-txt-primary">{t('settings:voice.opus.mode.label')}</div>
              <div className="text-xs text-txt-tertiary">{t('settings:voice.opus.mode.description')}</div>
            </div>
            <div className="inline-flex rounded-lg bg-surface-base p-0.5 shrink-0">
              {(['voice', 'music'] as const satisfies readonly AudioMode[]).map((mode) => {
                const disabled = mode === 'music' && !musicAllowed;
                const active = (musicAllowed ? audioMode : 'voice') === mode;
                return (
                  <button
                    key={mode}
                    type="button"
                    disabled={disabled}
                    onClick={() => setAudioMode(mode)}
                    aria-pressed={active}
                    className={`px-3 py-1 rounded-md text-xs font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
                      active
                        ? 'bg-accent-primary text-white'
                        : 'text-txt-secondary hover:text-txt-primary'
                    }`}
                  >
                    {t(`settings:voice.opus.mode.${mode}`)}
                  </button>
                );
              })}
            </div>
          </div>
          {!musicAllowed && (
            <p className="text-xs text-txt-tertiary -mt-2">{t('settings:voice.opus.mode.musicDisabledByPolicy')}</p>
          )}

          {/* Stereo toggle */}
          <div className="flex items-center justify-between py-1">
            <div className="flex-1 mr-4">
              <div className="text-sm text-txt-primary">{t('settings:voice.opus.stereo.label')}</div>
              <div className="text-xs text-txt-tertiary">
                {stereoAllowed
                  ? t('settings:voice.opus.stereo.description')
                  : t('settings:voice.opus.stereo.disabledByInstance')}
              </div>
            </div>
            <Toggle
              enabled={stereoAllowed && audioStereo}
              onChange={(v) => { if (stereoAllowed) setAudioStereo(v); }}
              disabled={!stereoAllowed}
              ariaLabel={t('settings:voice.opus.stereo.label')}
            />
          </div>

          {/* Bitrate Auto toggle + manual slider with contextual warnings underneath */}
          <div className="py-1 space-y-2.5">
            <div className="flex items-center justify-between">
              <div className="flex-1 mr-4">
                <div className="text-sm text-txt-primary">{t('settings:voice.opus.bitrate.autoLabel')}</div>
                <div className="text-xs text-txt-tertiary">{t('settings:voice.opus.bitrate.autoDescription')}</div>
              </div>
              <Toggle
                enabled={audioBitrateAuto}
                onChange={setAudioBitrateAuto}
                ariaLabel={t('settings:voice.opus.bitrate.autoLabel')}
              />
            </div>

            <div className="flex items-center justify-between">
              <div className="text-sm text-txt-primary">{t('settings:voice.opus.bitrate.label')}</div>
              <div className="text-xs text-txt-secondary font-medium tabular-nums">
                {/* i18n-check: allow-literal "kbps" is an SI audio bitrate unit */}
                {audioBitrateAuto ? `${t('settings:voice.opus.bitrate.autoBadge')} (${displayedBitrate} kbps)` : `${displayedBitrate} kbps`}
              </div>
            </div>
            {!audioBitrateAuto && (
              <>
                <input
                  type="range"
                  min={MIN_AUDIO_BITRATE_KBPS}
                  max={effectiveMaxBitrate}
                  step={8}
                  value={displayedBitrate}
                  onChange={(e) => setAudioBitrate(Number(e.target.value))}
                  aria-label={t('settings:voice.opus.bitrate.label')}
                  className="w-full h-1.5 rounded-full appearance-none cursor-pointer bg-surface-base [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:shadow-md"
                  style={{
                    background: `linear-gradient(to right, rgb(var(--accent-primary)) 0%, rgb(var(--accent-primary)) ${bitratePercent}%, rgb(var(--interactive-muted)) ${bitratePercent}%, rgb(var(--interactive-muted)) 100%)`,
                  }}
                />
                <div className="relative h-4 text-[10px] text-txt-tertiary tabular-nums mt-1">
                  {bitrateTicks.map((kbps) => {
                    const pct = ((kbps - MIN_AUDIO_BITRATE_KBPS) / sliderSpan) * 100;
                    const posClass =
                      kbps === MIN_AUDIO_BITRATE_KBPS
                        ? 'left-0'
                        : kbps === effectiveMaxBitrate
                          ? 'right-0'
                          : '-translate-x-1/2';
                    const posStyle =
                      kbps === MIN_AUDIO_BITRATE_KBPS || kbps === effectiveMaxBitrate
                        ? undefined
                        : { left: `${pct}%` };
                    return (
                      <span key={kbps} className={`absolute top-0 ${posClass}`} style={posStyle}>
                        {/* i18n-check: allow-literal "kbps" is an SI audio bitrate unit */}
                        {kbps} kbps
                      </span>
                    );
                  })}
                </div>
                <p className={`text-xs mt-1 ${bitrateNotice.tone}`}>{bitrateNotice.text}</p>
              </>
            )}
          </div>

          {/* Jitter Buffer (packet-loss / jitter smoothing) */}
          <div className="space-y-2.5 pt-2 border-t border-white/[0.04]">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex-1 min-w-0">
                <div className="text-sm text-txt-primary">{t('settings:voice.opus.jitterBuffer.label')}</div>
                <div className="text-xs text-txt-tertiary">{t('settings:voice.opus.jitterBuffer.description')}</div>
              </div>
              <span className="text-xs font-semibold text-txt-primary tabular-nums px-2 py-0.5 rounded bg-surface-base border border-border-soft shrink-0">
                {jitterBufferMs === 0
                  ? t('settings:voice.opus.jitterBuffer.auto')
                  : t('common:units.ms', { value: jitterBufferMs })}
              </span>
            </div>

            <div className="flex flex-wrap gap-1 rounded-lg bg-surface-base p-1">
              {JITTER_BUFFER_PRESETS.map((ms) => {
                const active = jitterBufferMs === ms;
                return (
                  <button
                    key={ms}
                    type="button"
                    onClick={() => handleJitterBufferChange(ms)}
                    aria-pressed={active}
                    className={`px-2.5 py-1 rounded-md text-xs font-medium tabular-nums transition-colors ${
                      active
                        ? 'bg-accent-primary text-white'
                        : 'text-txt-secondary hover:text-txt-primary'
                    }`}
                  >
                    {ms === 0
                      ? t('settings:voice.opus.jitterBuffer.auto')
                      : t('common:units.ms', { value: ms })}
                  </button>
                );
              })}
            </div>

            <input
              type="range"
              min={0}
              max={MAX_JITTER_BUFFER_MS}
              step={20}
              value={jitterBufferMs}
              onChange={(e) => handleJitterBufferChange(Number(e.target.value))}
              aria-label={t('settings:voice.opus.jitterBuffer.label')}
              className="w-full h-1.5 rounded-full appearance-none cursor-pointer bg-surface-base [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:shadow-md"
              style={{
                background: `linear-gradient(to right, rgb(var(--accent-primary)) 0%, rgb(var(--accent-primary)) ${(jitterBufferMs / MAX_JITTER_BUFFER_MS) * 100}%, rgb(var(--interactive-muted)) ${(jitterBufferMs / MAX_JITTER_BUFFER_MS) * 100}%, rgb(var(--interactive-muted)) 100%)`,
              }}
            />
          </div>
        </div>
      </div>

      <div>
        <div className="text-[11px] font-semibold text-txt-tertiary uppercase tracking-wider mb-1.5">
          {t('settings:voice.processing.sectionTitle')}
        </div>
        <div className="rounded-lg bg-white/[0.03] border border-white/[0.04] p-3.5">
          {musicAllowed && audioMode === 'music' ? (
            <p className="text-xs text-accent-amber mb-2">{t('settings:voice.opus.bypassNoticeMusic')}</p>
          ) : stereoAllowed && audioStereo ? (
            <p className="text-xs text-txt-tertiary mb-2">{t('settings:voice.opus.bypassNoticeStereo')}</p>
          ) : null}
          <div className="flex items-center justify-between py-2">
            <div className="flex-1 mr-4">
              <div className="text-sm text-txt-primary">{t('settings:voice.processing.noiseSuppression.label')}</div>
              <div className="text-xs text-txt-tertiary">{t('settings:voice.processing.noiseSuppression.description')}</div>
            </div>
            <Toggle enabled={rnnoiseEnabled} onChange={setRnnoiseEnabled} />
          </div>

          <div className="flex items-center justify-between py-2">
            <div className="flex-1 mr-4">
              <div className="text-sm text-txt-primary">{t('settings:voice.processing.echoCancellation.label')}</div>
              <div className="text-xs text-txt-tertiary">{t('settings:voice.processing.echoCancellation.description')}</div>
            </div>
            <Toggle enabled={echoCancellation} onChange={setEchoCancellation} />
          </div>

          <div className="flex items-center justify-between py-2">
            <div className="flex-1 mr-4">
              <div className="text-sm text-txt-primary">{t('settings:voice.processing.autoGain.label')}</div>
              <div className="text-xs text-txt-tertiary">{t('settings:voice.processing.autoGain.description')}</div>
            </div>
            <Toggle enabled={autoGainControl} onChange={setAutoGainControl} />
          </div>
        </div>
      </div>
    </div>
  );
}
