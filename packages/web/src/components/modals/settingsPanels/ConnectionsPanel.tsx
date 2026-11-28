import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  MAX_SOCIAL_CONNECTIONS,
  SOCIAL_CONNECTION_PLATFORMS,
  validateSocialConnection,
  type SocialConnectionPlatform,
  type UserSocialConnection,
} from '@backspace/shared';
import { api } from '../../../api/client';
import { useAuthStore } from '../../../stores/authStore';
import { useUIStore } from '../../../stores/uiStore';
import { describeError } from '../../../i18n/errors';
import { PlatformIcon } from '../../profile/SocialConnectionsView';
import { LastFmUserSection } from './LastFmUserSection';
import { RichPresenceEditor } from '../../presence/RichPresenceEditor';

export function ConnectionsPanel() {
  const { t } = useTranslation(['settings', 'social', 'common']);
  const user = useAuthStore((s) => s.user);
  const setUser = useAuthStore((s) => s.setUser);
  const addToast = useUIStore((s) => s.addToast);

  const [platform, setPlatform] = useState<SocialConnectionPlatform>('steam');
  const [urlInput, setUrlInput] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const connections: UserSocialConnection[] = user?.socialConnections ?? [];

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    if (connections.length >= MAX_SOCIAL_CONNECTIONS) {
      setError(t('settings:connections.social.limitReached'));
      return;
    }

    const check = validateSocialConnection(platform, urlInput);
    if (!check.ok) {
      setError(t(`settings:connections.social.errors.${check.reason}`));
      return;
    }

    const nextItem: UserSocialConnection = {
      id: typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `${platform}-${Date.now()}`,
      ...check.connection,
    };

    setSaving(true);
    setError('');
    try {
      const updated = await api.users.update({
        socialConnections: [...connections, nextItem],
      });
      setUser(updated);
      setUrlInput('');
      addToast(t('settings:connections.social.added'), 'success');
    } catch (err) {
      setError(describeError(err));
    } finally {
      setSaving(false);
    }
  };

  const handleRemove = async (id: string) => {
    if (!user) return;
    setSaving(true);
    setError('');
    try {
      const updated = await api.users.update({
        socialConnections: connections.filter((c) => c.id !== id),
      });
      setUser(updated);
      addToast(t('settings:connections.social.removed'), 'success');
    } catch (err) {
      setError(describeError(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-txt-primary">{t('settings:connections.title')}</h2>
        <p className="text-xs text-txt-tertiary mt-1">{t('settings:connections.subtitle')}</p>
      </div>

      {/* Rich Presence (Playing / Looking to play / Watching / Listening) */}
      <RichPresenceEditor />

      {/* Last.fm Integration */}
      <LastFmUserSection />

      {/* Personal Social Accounts */}
      <div className="space-y-3">
        <div className="text-[11px] font-semibold text-txt-tertiary uppercase tracking-wider">
          {t('settings:connections.social.heading')}
        </div>

        <form onSubmit={(e) => { void handleAdd(e); }} className="rounded-lg bg-white/[0.03] border border-white/[0.06] p-4 space-y-3">
          <p className="text-xs text-txt-tertiary">{t('settings:connections.social.description')}</p>

          {error && (
            <div className="rounded-md border border-accent-rose/30 bg-accent-rose/10 px-3 py-2 text-xs text-accent-rose">
              {error}
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <select
              value={platform}
              onChange={(e) => { setPlatform(e.target.value as SocialConnectionPlatform); setError(''); }}
              aria-label={t('settings:connections.social.platformLabel')}
              className="input-standard appearance-none"
            >
              {SOCIAL_CONNECTION_PLATFORMS.map((p) => (
                <option key={p} value={p}>
                  {t(`social:connections.platforms.${p}`)}
                </option>
              ))}
            </select>

            <input
              type="text"
              value={urlInput}
              onChange={(e) => { setUrlInput(e.target.value); setError(''); }}
              placeholder={t(`settings:connections.social.placeholders.${platform}`)}
              className="input-standard sm:col-span-2"
            />
          </div>

          <div className="flex justify-end">
            <button
              type="submit"
              disabled={saving || !urlInput.trim()}
              className="px-4 py-1.5 rounded-md bg-accent-primary hover:bg-accent-primary-hover text-white text-xs font-semibold transition-colors disabled:opacity-40"
            >
              {saving ? t('common:states.loading') : t('settings:connections.social.addButton')}
            </button>
          </div>
        </form>

        {connections.length > 0 && (
          <div className="space-y-2">
            {connections.map((conn) => (
              <div
                key={conn.id}
                className="rounded-lg bg-white/[0.03] border border-white/[0.06] px-3.5 py-2.5 flex items-center justify-between gap-3"
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <span className="w-7 h-7 rounded-md bg-white/[0.06] text-txt-primary flex items-center justify-center shrink-0">
                    <PlatformIcon platform={conn.platform} size={15} />
                  </span>
                  <div className="min-w-0">
                    <div className="text-xs font-semibold text-txt-primary truncate">{conn.displayLabel}</div>
                    <div className="text-[10px] text-txt-tertiary truncate">
                      {t(`social:connections.platforms.${conn.platform}`)}
                      {conn.url ? ` · ${conn.url}` : ''}
                    </div>
                  </div>
                </div>

                <button
                  type="button"
                  disabled={saving}
                  onClick={() => { void handleRemove(conn.id); }}
                  className="px-2.5 py-1 rounded bg-accent-rose/15 hover:bg-accent-rose/25 text-accent-rose text-[11px] font-semibold shrink-0 transition-colors disabled:opacity-40"
                >
                  {t('common:actions.delete')}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
