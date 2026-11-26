import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { SpaceApiKeyScope, SpaceApiKeySummary } from '@backspace/shared';
import { useFormatters } from '../../../i18n/formatters';
import { describeError } from '../../../i18n/errors';
import { getApiForOrigin } from '../../../utils/crossStoreResolvers';
import { useUIStore } from '../../../stores/uiStore';

interface SpaceApiKeysPanelProps {
  spaceId: string;
  origin: string;
}

const ALL_SCOPES: readonly SpaceApiKeyScope[] = ['music', 'voice_bridge'];

export function SpaceApiKeysPanel({ spaceId, origin }: SpaceApiKeysPanelProps) {
  const { t } = useTranslation(['spaces', 'common']);
  const { formatDateTime } = useFormatters();
  const addToast = useUIStore((s) => s.addToast);
  const client = getApiForOrigin(origin);

  const [keys, setKeys] = useState<SpaceApiKeySummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [name, setName] = useState('');
  const [scopes, setScopes] = useState<SpaceApiKeyScope[]>(['music']);
  const [creating, setCreating] = useState(false);
  const [createdSecret, setCreatedSecret] = useState<{ name: string; secret: string } | null>(null);
  const [copiedSecret, setCopiedSecret] = useState(false);
  const [revokingId, setRevokingId] = useState<string | null>(null);

  const instanceBaseUrl = origin || (typeof window !== 'undefined' ? window.location.origin : '');
  const connectSnippet = [
    instanceBaseUrl,
    'X-Api-Key: bp_...',
    'GET /api/spaces/bot/info',
  ].join('\n');

  const loadKeys = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await client.spaceApiKeys.list(spaceId);
      setKeys(res.apiKeys);
    } catch (err) {
      setError(describeError(err));
    } finally {
      setLoading(false);
    }
  }, [client, spaceId]);

  useEffect(() => {
    void loadKeys();
  }, [loadKeys]);

  const toggleScope = (scope: SpaceApiKeyScope) => {
    setScopes((prev) => {
      if (prev.includes(scope)) {
        return prev.length > 1 ? prev.filter((s) => s !== scope) : prev;
      }
      return [...prev, scope];
    });
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    setCreating(true);
    setError('');
    try {
      const res = await client.spaceApiKeys.create(spaceId, { name: trimmed, scopes });
      setKeys((prev) => [res.apiKey, ...prev]);
      setCreatedSecret({ name: res.apiKey.name, secret: res.secret });
      setCopiedSecret(false);
      setName('');
    } catch (err) {
      setError(describeError(err));
    } finally {
      setCreating(false);
    }
  };

  const handleCopySecret = async () => {
    if (!createdSecret) return;
    try {
      await navigator.clipboard.writeText(createdSecret.secret);
      setCopiedSecret(true);
      addToast(t('spaces:settings.apiKeys.copied'), 'success');
    } catch {
      addToast(t('spaces:settings.apiKeys.copyFailed'), 'warning');
    }
  };

  const handleRevoke = async (keyId: string) => {
    setRevokingId(keyId);
    setError('');
    try {
      await client.spaceApiKeys.revoke(spaceId, keyId);
      setKeys((prev) => prev.filter((k) => k.id !== keyId));
      addToast(t('spaces:settings.apiKeys.revoked'), 'success');
    } catch (err) {
      setError(describeError(err));
    } finally {
      setRevokingId(null);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-txt-primary">{t('spaces:settings.apiKeys.title')}</h2>
        <p className="text-sm text-txt-tertiary mt-1">{t('spaces:settings.apiKeys.subtitle')}</p>
      </div>

      {error && (
        <div className="rounded-lg border border-accent-rose/30 bg-accent-rose/10 px-3.5 py-2.5 text-sm text-accent-rose">
          {error}
        </div>
      )}

      {/* One-time secret display banner */}
      {createdSecret && (
        <div className="rounded-lg border border-accent-mint/30 bg-accent-mint/10 p-4 space-y-2.5">
          <div className="flex items-center justify-between gap-2">
            <div className="text-sm font-semibold text-accent-mint">
              {t('spaces:settings.apiKeys.createdTitle', { name: createdSecret.name })}
            </div>
            <button
              type="button"
              onClick={() => setCreatedSecret(null)}
              className="text-xs text-txt-tertiary hover:text-txt-primary"
            >
              {t('common:actions.close')}
            </button>
          </div>
          <p className="text-xs text-txt-secondary">{t('spaces:settings.apiKeys.createdHint')}</p>
          <div className="flex items-center gap-2">
            <code className="flex-1 min-w-0 truncate rounded bg-surface-base border border-border-soft px-2.5 py-1.5 text-xs font-mono text-txt-primary select-all">
              {createdSecret.secret}
            </code>
            <button
              type="button"
              onClick={() => { void handleCopySecret(); }}
              className="px-3 py-1.5 rounded bg-accent-primary hover:bg-accent-primary-hover text-white text-xs font-semibold shrink-0 transition-colors"
            >
              {copiedSecret ? t('spaces:settings.apiKeys.copiedShort') : t('spaces:settings.apiKeys.copy')}
            </button>
          </div>
        </div>
      )}

      {/* Create new API key form */}
      <form onSubmit={(e) => { void handleCreate(e); }} className="glass-bubble rounded-lg p-4 space-y-4">
        <div className="text-sm font-semibold text-txt-primary">{t('spaces:settings.apiKeys.createHeading')}</div>
        <div className="space-y-1.5">
          <label className="block text-xs font-medium text-txt-secondary" htmlFor="space-api-key-name">
            {t('spaces:settings.apiKeys.nameLabel')}
          </label>
          <input
            id="space-api-key-name"
            type="text"
            maxLength={64}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t('spaces:settings.apiKeys.namePlaceholder')}
            className="w-full px-3 py-2 rounded-md bg-surface-base border border-border-soft text-sm text-txt-primary placeholder:text-txt-tertiary focus:outline-none focus:border-accent-primary"
          />
        </div>

        <div className="space-y-1.5">
          <div className="text-xs font-medium text-txt-secondary">{t('spaces:settings.apiKeys.scopesLabel')}</div>
          <div className="flex flex-wrap gap-2">
            {ALL_SCOPES.map((scope) => {
              const checked = scopes.includes(scope);
              return (
                <label
                  key={scope}
                  className={`flex items-center gap-2 px-3 py-1.5 rounded-md border text-xs cursor-pointer transition-colors ${
                    checked
                      ? 'border-accent-primary bg-accent-primary/15 text-txt-primary font-medium'
                      : 'border-border-soft bg-surface-base text-txt-secondary hover:text-txt-primary'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleScope(scope)}
                    className="accent-accent-primary"
                  />
                  <span>{t(`spaces:settings.apiKeys.scopes.${scope}`)}</span>
                </label>
              );
            })}
          </div>
        </div>

        <div className="flex justify-end">
          <button
            type="submit"
            disabled={creating || !name.trim()}
            className="px-4 py-2 rounded-md bg-accent-primary hover:bg-accent-primary-hover text-white text-sm font-medium transition-colors disabled:opacity-40"
          >
            {creating ? t('common:states.loading') : t('spaces:settings.apiKeys.createButton')}
          </button>
        </div>
      </form>

      {/* Active keys list */}
      <div className="space-y-2.5">
        <div className="text-xs font-semibold uppercase tracking-wider text-txt-tertiary">
          {t('spaces:settings.apiKeys.listHeading', { total: keys.length })}
        </div>

        {loading ? (
          <div className="text-sm text-txt-tertiary py-4">{t('common:states.loading')}</div>
        ) : keys.length === 0 ? (
          <div className="glass-bubble rounded-lg p-4 text-sm text-txt-tertiary">
            {t('spaces:settings.apiKeys.empty')}
          </div>
        ) : (
          <div className="space-y-2">
            {keys.map((item) => (
              <div
                key={item.id}
                className="glass-bubble rounded-lg p-3.5 flex items-center justify-between gap-3"
              >
                <div className="min-w-0 space-y-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium text-txt-primary truncate">{item.name}</span>
                    <code className="text-[11px] font-mono px-1.5 py-0.5 rounded bg-surface-base text-txt-secondary">
                      {item.keyPrefix}…
                    </code>
                    {item.scopes.map((scope) => (
                      <span
                        key={scope}
                        className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-accent-primary/15 text-accent-primary"
                      >
                        {t(`spaces:settings.apiKeys.scopes.${scope}`)}
                      </span>
                    ))}
                  </div>
                  <div className="text-[11px] text-txt-tertiary flex flex-wrap gap-x-3 gap-y-0.5">
                    <span>{t('spaces:settings.apiKeys.createdAt', { date: formatDateTime(item.createdAt) })}</span>
                    <span>
                      {item.lastUsedAt
                        ? t('spaces:settings.apiKeys.lastUsed', { date: formatDateTime(item.lastUsedAt) })
                        : t('spaces:settings.apiKeys.neverUsed')}
                    </span>
                  </div>
                </div>

                <button
                  type="button"
                  disabled={revokingId === item.id}
                  onClick={() => { void handleRevoke(item.id); }}
                  className="px-2.5 py-1.5 rounded-md bg-accent-rose/15 hover:bg-accent-rose/25 text-accent-rose text-xs font-semibold shrink-0 transition-colors disabled:opacity-40"
                >
                  {t('spaces:settings.apiKeys.revoke')}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Quick connection info for Balacopapo Utilidades */}
      <div className="glass-bubble rounded-lg p-4 space-y-2 text-xs text-txt-tertiary">
        <div className="font-semibold text-txt-secondary">{t('spaces:settings.apiKeys.connectHeading')}</div>
        <p>{t('spaces:settings.apiKeys.connectDesc')}</p>
        <pre className="rounded bg-surface-base border border-border-soft p-2.5 font-mono text-[11px] text-txt-secondary overflow-x-auto whitespace-pre-wrap">
          {connectSnippet}
        </pre>
      </div>
    </div>
  );
}
