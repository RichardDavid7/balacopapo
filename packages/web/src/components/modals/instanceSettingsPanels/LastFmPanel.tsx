import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { AdminLastFmConfigResponse } from '@backspace/shared';
import { api } from '../../../api/client';
import { describeError } from '../../../i18n/errors';
import { useUIStore } from '../../../stores/uiStore';

const LASTFM_API_DOCS_URL = 'https://www.last.fm/api/account/create';
const LASTFM_API_DOCS_LABEL = 'last.fm/api/account/create';

export function LastFmPanel() {
  const { t } = useTranslation(['settings', 'common']);
  const addToast = useUIStore((s) => s.addToast);

  const [config, setConfig] = useState<AdminLastFmConfigResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [apiKeyInput, setApiKeyInput] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const loadConfig = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await api.admin.lastfm.getConfig();
      setConfig(res);
    } catch (err) {
      setError(describeError(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadConfig();
  }, [loadConfig]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = apiKeyInput.trim();
    if (!trimmed) return;
    setSaving(true);
    setError('');
    try {
      const updated = await api.admin.lastfm.updateConfig({ apiKey: trimmed });
      setConfig(updated);
      setApiKeyInput('');
      addToast(t('settings:instance.lastfm.saved'), 'success');
    } catch (err) {
      setError(describeError(err));
    } finally {
      setSaving(false);
    }
  };

  const handleClear = async () => {
    setSaving(true);
    setError('');
    try {
      const updated = await api.admin.lastfm.updateConfig({ apiKey: null });
      setConfig(updated);
      addToast(t('settings:instance.lastfm.cleared'), 'success');
    } catch (err) {
      setError(describeError(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-base font-semibold text-txt-primary">{t('settings:instance.lastfm.title')}</h3>
        <p className="text-xs text-txt-tertiary mt-1">{t('settings:instance.lastfm.subtitle')}</p>
      </div>

      {error && (
        <div className="rounded-lg border border-accent-rose/30 bg-accent-rose/10 px-3.5 py-2.5 text-xs text-accent-rose">
          {error}
        </div>
      )}

      {/* Status card */}
      <div className="rounded-lg bg-white/[0.03] border border-white/[0.06] p-4 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-medium text-txt-secondary">{t('settings:instance.lastfm.statusLabel')}</span>
          {loading ? (
            <span className="text-xs text-txt-tertiary">{t('common:states.loading')}</span>
          ) : config?.configured ? (
            <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-accent-mint/15 text-accent-mint">
              {t(`settings:instance.lastfm.sources.${config.source}`)}
            </span>
          ) : (
            <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-white/[0.08] text-txt-tertiary">
              {t('settings:instance.lastfm.sources.none')}
            </span>
          )}
        </div>

        {config?.keyPreview && (
          <div className="flex items-center justify-between gap-2 text-xs text-txt-tertiary">
            <span>{t('settings:instance.lastfm.currentKey')}</span>
            <code className="font-mono px-2 py-0.5 rounded bg-surface-base text-txt-secondary">
              {config.keyPreview}
            </code>
          </div>
        )}
      </div>

      {/* Update key form */}
      <form onSubmit={(e) => { void handleSave(e); }} className="rounded-lg bg-white/[0.03] border border-white/[0.06] p-4 space-y-3">
        <label htmlFor="instance-lastfm-api-key" className="block text-xs font-medium text-txt-secondary">
          {t('settings:instance.lastfm.apiKeyLabel')}
        </label>
        <input
          id="instance-lastfm-api-key"
          type="password"
          autoComplete="off"
          value={apiKeyInput}
          onChange={(e) => setApiKeyInput(e.target.value)}
          placeholder={t('settings:instance.lastfm.apiKeyPlaceholder')}
          className="input-standard w-full"
        />
        <p className="text-[11px] text-txt-tertiary">
          {t('settings:instance.lastfm.helpText')}{' '}
          <a
            href={LASTFM_API_DOCS_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="text-accent-primary hover:underline"
          >
            {LASTFM_API_DOCS_LABEL}
          </a>
        </p>

        <div className="flex items-center justify-end gap-2 pt-1">
          {config?.source === 'database' && (
            <button
              type="button"
              disabled={saving}
              onClick={() => { void handleClear(); }}
              className="px-3 py-1.5 rounded-md bg-accent-rose/15 hover:bg-accent-rose/25 text-accent-rose text-xs font-semibold transition-colors disabled:opacity-40"
            >
              {t('settings:instance.lastfm.removeButton')}
            </button>
          )}
          <button
            type="submit"
            disabled={saving || !apiKeyInput.trim()}
            className="px-4 py-1.5 rounded-md bg-accent-primary hover:bg-accent-primary-hover text-white text-xs font-semibold transition-colors disabled:opacity-40"
          >
            {saving ? t('common:states.loading') : t('settings:instance.lastfm.saveButton')}
          </button>
        </div>
      </form>
    </div>
  );
}
