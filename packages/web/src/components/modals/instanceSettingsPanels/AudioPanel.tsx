import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { describeError } from '../../../i18n/errors';
import { useSettingsStore } from '../../../stores/settingsStore';
import { useUIStore } from '../../../stores/uiStore';
import type { InstanceStreamingLimits } from '@backspace/shared';
import { Toggle } from '../../ui/Toggle';
import { SoundboardManagerPanel } from '../../voice/SoundboardManagerPanel';

export function AudioPanel() {
  const { t } = useTranslation(['admin', 'common', 'voice']);
  const limits = useSettingsStore((s) => s.streamingLimits);
  const updateStreamingLimits = useSettingsStore((s) => s.updateStreamingLimits);
  const fetchStreamingLimits = useSettingsStore((s) => s.fetchStreamingLimits);
  const addToast = useUIStore((s) => s.addToast);

  const [draft, setDraft] = useState<InstanceStreamingLimits | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [loadFailed, setLoadFailed] = useState(false);
  const [loading, setLoading] = useState(false);

  const loadLimits = useCallback(async () => {
    setLoading(true);
    await fetchStreamingLimits();
    setLoadFailed(useSettingsStore.getState().streamingLimits === null);
    setLoading(false);
  }, [fetchStreamingLimits]);

  useEffect(() => {
    void loadLimits();
  }, [loadLimits]);

  useEffect(() => {
    if (limits) setDraft({ ...limits });
  }, [limits]);

  const hasChanges = Boolean(
    draft && limits && (
      draft.allowMusicMode !== limits.allowMusicMode
      || draft.allowStereoAudio !== limits.allowStereoAudio
      || draft.defaultAudioBitrateKbps !== limits.defaultAudioBitrateKbps
      || draft.maxAudioBitrateKbps !== limits.maxAudioBitrateKbps
      || (draft.soundboardEnabled ?? true) !== (limits.soundboardEnabled ?? true)
      || (draft.maxSoundboardSoundsPerScope ?? 32) !== (limits.maxSoundboardSoundsPerScope ?? 32)
      || (draft.maxConcurrentSoundboardSounds ?? 3) !== (limits.maxConcurrentSoundboardSounds ?? 3)
    ),
  );

  const handleSave = async () => {
    if (!draft) return;
    setSaving(true);
    setSaveError('');
    try {
      await updateStreamingLimits(draft);
      addToast(t('common:states.settingsSaved'), 'success', 2000);
    } catch (err) {
      setSaveError(err instanceof Error ? describeError(err) : t('common:states.saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  const handleReset = () => {
    if (limits) setDraft({ ...limits });
    setSaveError('');
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-txt-primary">{t('admin:audio.title')}</h2>
        <div className="text-xs text-txt-tertiary mt-0.5">{t('admin:audio.description')}</div>
      </div>

      {/* Voice Audio (Opus) */}
      <div>
        <div className="text-[11px] font-semibold text-txt-tertiary uppercase tracking-wider mb-1.5">
          {t('admin:streaming.voiceAudio.label')}
        </div>
        <p className="text-xs text-txt-tertiary mb-2">{t('admin:streaming.voiceAudio.description')}</p>

        {!draft ? (
          loadFailed ? (
            <div className="p-2 bg-accent-rose/10 border border-accent-rose/30 rounded text-txt-danger text-sm flex flex-wrap items-center gap-3">
              <span>{t('common:states.loadSettingsFailed')}</span>
              <button
                type="button"
                onClick={() => { void loadLimits(); }}
                disabled={loading}
                className="font-medium underline underline-offset-2 hover:no-underline transition-all disabled:no-underline disabled:opacity-60 disabled:cursor-default"
              >
                {t('common:actions.retry')}
              </button>
            </div>
          ) : (
            <div className="text-sm text-txt-tertiary">{t('common:states.loadingSettings')}</div>
          )
        ) : (
          <div className="rounded-lg bg-white/[0.02] p-3.5 space-y-4">
            {/* Allow Music Mode */}
            <div className="flex items-center justify-between">
              <div className="pr-4">
                <div className="text-sm text-txt-primary">{t('admin:streaming.voiceAudio.allowMusicMode.label')}</div>
                <div className="text-xs text-txt-tertiary">{t('admin:streaming.voiceAudio.allowMusicMode.description')}</div>
              </div>
              <Toggle
                enabled={draft.allowMusicMode ?? true}
                onChange={(enabled) => setDraft({ ...draft, allowMusicMode: enabled })}
              />
            </div>

            {/* Allow Stereo Audio */}
            <div className="flex items-center justify-between">
              <div className="pr-4">
                <div className="text-sm text-txt-primary">{t('admin:streaming.voiceAudio.allowStereoAudio.label')}</div>
                <div className="text-xs text-txt-tertiary">{t('admin:streaming.voiceAudio.allowStereoAudio.description')}</div>
              </div>
              <Toggle
                enabled={draft.allowStereoAudio ?? true}
                onChange={(enabled) => setDraft({ ...draft, allowStereoAudio: enabled })}
              />
            </div>

            {/* Default & Max Voice Audio Bitrate */}
            <div className="grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-4 pt-1">
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-xs text-txt-secondary">{t('admin:streaming.voiceAudio.defaultBitrate')}</label>
                  <span className="text-xs text-txt-primary font-medium tabular-nums">
                    {/* i18n-check: allow-literal "kbps" is an SI audio bitrate unit */}
                    {draft.defaultAudioBitrateKbps ?? 64} kbps
                  </span>
                </div>
                <input
                  type="range"
                  min={8}
                  max={draft.maxAudioBitrateKbps ?? 512}
                  step={8}
                  value={Math.min(draft.defaultAudioBitrateKbps ?? 64, draft.maxAudioBitrateKbps ?? 512)}
                  onChange={(e) => setDraft({ ...draft, defaultAudioBitrateKbps: Number(e.target.value) })}
                  className="w-full h-1.5 rounded-full appearance-none cursor-pointer bg-surface-base
                    [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3
                    [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:shadow-md
                    [&::-webkit-slider-thumb]:cursor-pointer [&::-webkit-slider-thumb]:border-0"
                  style={{
                    background: (() => {
                      const maxVal = draft.maxAudioBitrateKbps ?? 512;
                      const val = Math.min(draft.defaultAudioBitrateKbps ?? 64, maxVal);
                      const pct = maxVal > 8 ? ((val - 8) / (maxVal - 8)) * 100 : 100;
                      return `linear-gradient(to right, rgb(var(--accent-primary)) 0%, rgb(var(--accent-primary)) ${pct}%, rgb(var(--interactive-muted)) ${pct}%, rgb(var(--interactive-muted)) 100%)`;
                    })(),
                  }}
                />
              </div>

              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-xs text-txt-secondary">{t('admin:streaming.voiceAudio.maxBitrate')}</label>
                  <span className="text-xs text-txt-primary font-medium tabular-nums">
                    {/* i18n-check: allow-literal "kbps" is an SI audio bitrate unit */}
                    {draft.maxAudioBitrateKbps ?? 512} kbps
                  </span>
                </div>
                <input
                  type="range"
                  min={8}
                  max={512}
                  step={8}
                  value={draft.maxAudioBitrateKbps ?? 512}
                  onChange={(e) => {
                    const nextMax = Number(e.target.value);
                    const nextDefault = Math.min(draft.defaultAudioBitrateKbps ?? 64, nextMax);
                    setDraft({ ...draft, maxAudioBitrateKbps: nextMax, defaultAudioBitrateKbps: nextDefault });
                  }}
                  className="w-full h-1.5 rounded-full appearance-none cursor-pointer bg-surface-base
                    [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3
                    [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:shadow-md
                    [&::-webkit-slider-thumb]:cursor-pointer [&::-webkit-slider-thumb]:border-0"
                  style={{
                    background: (() => {
                      const val = draft.maxAudioBitrateKbps ?? 512;
                      const pct = ((val - 8) / (512 - 8)) * 100;
                      return `linear-gradient(to right, rgb(var(--accent-primary)) 0%, rgb(var(--accent-primary)) ${pct}%, rgb(var(--interactive-muted)) ${pct}%, rgb(var(--interactive-muted)) 100%)`;
                    })(),
                  }}
                />
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Instance Soundboard Defaults & Limits */}
      <div className="border-t border-white/[0.04] pt-5 space-y-4">
        {draft && (
          <div className="rounded-lg bg-white/[0.02] p-3.5 space-y-4">
            <div className="flex items-center justify-between gap-4">
              <div className="flex-1 min-w-0">
                <div className="text-sm text-txt-primary">{t('admin:audio.soundboardEnabled.label')}</div>
                <div className="text-xs text-txt-tertiary">{t('admin:audio.soundboardEnabled.description')}</div>
              </div>
              <Toggle
                enabled={draft.soundboardEnabled ?? true}
                onChange={(enabled) => setDraft({ ...draft, soundboardEnabled: enabled })}
              />
            </div>

            {(draft.soundboardEnabled ?? true) && (
              <>
            <div className="border-t border-white/[0.04] pt-4 space-y-2.5">
              <div className="flex items-center justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-txt-primary">{t('admin:audio.maxSoundboardPerScope.label')}</div>
                  <div className="text-xs text-txt-tertiary">{t('admin:audio.maxSoundboardPerScope.description')}</div>
                </div>
                <input
                  type="number"
                  min={0}
                  max={200}
                  step={1}
                  value={draft.maxSoundboardSoundsPerScope ?? 32}
                  onChange={(e) => {
                    const val = Math.max(0, Math.min(200, Math.round(Number(e.target.value) || 0)));
                    setDraft({ ...draft, maxSoundboardSoundsPerScope: val });
                  }}
                  className="input-standard w-20 px-2.5 py-1 text-xs text-center tabular-nums shrink-0"
                />
              </div>
              <input
                type="range"
                min={0}
                max={200}
                step={1}
                value={draft.maxSoundboardSoundsPerScope ?? 32}
                onChange={(e) => setDraft({ ...draft, maxSoundboardSoundsPerScope: Number(e.target.value) })}
                className="w-full h-1.5 rounded-full appearance-none cursor-pointer bg-surface-base
                  [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3
                  [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:shadow-md
                  [&::-webkit-slider-thumb]:cursor-pointer [&::-webkit-slider-thumb]:border-0"
                style={{
                  background: (() => {
                    const val = draft.maxSoundboardSoundsPerScope ?? 32;
                    const pct = (val / 200) * 100;
                    return `linear-gradient(to right, rgb(var(--accent-primary)) 0%, rgb(var(--accent-primary)) ${pct}%, rgb(var(--interactive-muted)) ${pct}%, rgb(var(--interactive-muted)) 100%)`;
                  })(),
                }}
              />
            </div>

            <div className="border-t border-white/[0.04] pt-4 space-y-2.5">
              <div className="flex items-center justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-txt-primary">{t('admin:audio.maxConcurrentSoundboard.label')}</div>
                  <div className="text-xs text-txt-tertiary">{t('admin:audio.maxConcurrentSoundboard.description')}</div>
                </div>
                <input
                  type="number"
                  min={1}
                  max={10}
                  step={1}
                  value={draft.maxConcurrentSoundboardSounds ?? 3}
                  onChange={(e) => {
                    const val = Math.max(1, Math.min(10, Math.round(Number(e.target.value) || 1)));
                    setDraft({ ...draft, maxConcurrentSoundboardSounds: val });
                  }}
                  className="input-standard w-20 px-2.5 py-1 text-xs text-center tabular-nums shrink-0"
                />
              </div>
              <input
                type="range"
                min={1}
                max={10}
                step={1}
                value={draft.maxConcurrentSoundboardSounds ?? 3}
                onChange={(e) => setDraft({ ...draft, maxConcurrentSoundboardSounds: Number(e.target.value) })}
                className="w-full h-1.5 rounded-full appearance-none cursor-pointer bg-surface-base
                  [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3
                  [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:shadow-md
                  [&::-webkit-slider-thumb]:cursor-pointer [&::-webkit-slider-thumb]:border-0"
                style={{
                  background: (() => {
                    const val = draft.maxConcurrentSoundboardSounds ?? 3;
                    const pct = ((val - 1) / 9) * 100;
                    return `linear-gradient(to right, rgb(var(--accent-primary)) 0%, rgb(var(--accent-primary)) ${pct}%, rgb(var(--interactive-muted)) ${pct}%, rgb(var(--interactive-muted)) 100%)`;
                  })(),
                }}
              />
            </div>
              </>
            )}
          </div>
        )}
        {(draft?.soundboardEnabled ?? true) && (
          <SoundboardManagerPanel scopeType="instance" scopeId={null} origin="" embedded />
        )}
      </div>

      {/* Save / Reset for Opus settings */}
      {saveError && (
        <div className="p-2 bg-accent-rose/10 border border-accent-rose/30 rounded text-txt-danger text-sm">{saveError}</div>
      )}
      {hasChanges && (
        <div className="sticky bottom-0 z-10 pointer-events-none">
          <div className="flex justify-center pt-3 pb-1">
            <div className="glass-bubble rounded-full px-4 py-2 flex items-center gap-2 animate-slide-up pointer-events-auto">
              <button
                type="button"
                onClick={handleReset}
                className="px-3 py-1 text-sm text-txt-tertiary hover:text-txt-secondary transition-colors"
              >
                {t('common:actions.reset')}
              </button>
              <button
                type="button"
                onClick={() => void handleSave()}
                disabled={saving}
                className="px-3 py-1.5 bg-accent-primary hover:bg-accent-primary/80 text-white text-sm font-medium rounded-full transition-colors disabled:opacity-50"
              >
                {saving ? t('common:states.saving') : t('common:actions.save')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
