import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../../../api/client';
import { useAuthStore } from '../../../stores/authStore';
import { useUIStore } from '../../../stores/uiStore';
import { describeError } from '../../../i18n/errors';
import { Toggle } from '../../ui/Toggle';
import { LastFmStatus } from '../../profile/LastFmStatus';

export function LastFmUserSection() {
  const { t } = useTranslation(['settings', 'common']);
  const user = useAuthStore((s) => s.user);
  const setUser = useAuthStore((s) => s.setUser);
  const addToast = useUIStore((s) => s.addToast);

  const [username, setUsername] = useState(user?.lastfmUsername ?? '');
  const [showNowPlaying, setShowNowPlaying] = useState(user?.lastfmShowNowPlaying ?? true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    setUsername(user?.lastfmUsername ?? '');
    setShowNowPlaying(user?.lastfmShowNowPlaying ?? true);
  }, [user?.lastfmUsername, user?.lastfmShowNowPlaying]);

  if (!user) return null;

  const trimmed = username.trim();
  const hasChanges =
    trimmed !== (user.lastfmUsername ?? '')
    || showNowPlaying !== (user.lastfmShowNowPlaying ?? true);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      const updated = await api.users.update({
        lastfmUsername: trimmed || null,
        lastfmShowNowPlaying: showNowPlaying,
      });
      setUser(updated);
      addToast(t('settings:connections.lastfm.saved'), 'success');
    } catch (err) {
      setError(describeError(err));
    } finally {
      setSaving(false);
    }
  };

  const handleDisconnect = async () => {
    setSaving(true);
    setError('');
    try {
      const updated = await api.users.update({ lastfmUsername: null });
      setUser(updated);
      setUsername('');
      addToast(t('settings:connections.lastfm.disconnected'), 'success');
    } catch (err) {
      setError(describeError(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="text-[11px] font-semibold text-txt-tertiary uppercase tracking-wider">
        {t('settings:connections.lastfm.heading')}
      </div>

      <form onSubmit={(e) => { void handleSave(e); }} className="rounded-lg bg-white/[0.03] border border-white/[0.06] p-4 space-y-4">
        <p className="text-xs text-txt-tertiary">{t('settings:connections.lastfm.description')}</p>

        {error && (
          <div className="rounded-md border border-accent-rose/30 bg-accent-rose/10 px-3 py-2 text-xs text-accent-rose">
            {error}
          </div>
        )}

        <div className="space-y-1.5">
          <label htmlFor="user-lastfm-username" className="block text-xs font-medium text-txt-secondary">
            {t('settings:connections.lastfm.usernameLabel')}
          </label>
          <input
            id="user-lastfm-username"
            type="text"
            maxLength={120}
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder={t('settings:connections.lastfm.usernamePlaceholder')}
            className="input-standard w-full"
          />
        </div>

        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="text-xs font-medium text-txt-primary">
              {t('settings:connections.lastfm.showNowPlayingLabel')}
            </div>
            <div className="text-[11px] text-txt-tertiary">
              {t('settings:connections.lastfm.showNowPlayingHint')}
            </div>
          </div>
          <Toggle
            enabled={showNowPlaying}
            onChange={setShowNowPlaying}
            ariaLabel={t('settings:connections.lastfm.showNowPlayingLabel')}
          />
        </div>

        <div className="flex items-center justify-end gap-2">
          {user.lastfmUsername && (
            <button
              type="button"
              disabled={saving}
              onClick={() => { void handleDisconnect(); }}
              className="px-3 py-1.5 rounded-md bg-accent-rose/15 hover:bg-accent-rose/25 text-accent-rose text-xs font-semibold transition-colors disabled:opacity-40"
            >
              {t('settings:connections.lastfm.disconnect')}
            </button>
          )}
          <button
            type="submit"
            disabled={saving || !hasChanges}
            className="px-4 py-1.5 rounded-md bg-accent-primary hover:bg-accent-primary-hover text-white text-xs font-semibold transition-colors disabled:opacity-40"
          >
            {saving ? t('common:states.loading') : t('settings:connections.lastfm.save')}
          </button>
        </div>

        {user.lastfmUsername && (
          <div className="pt-2 border-t border-white/[0.06]">
            <LastFmStatus
              userId={user.id}
              username={user.lastfmUsername}
              showNowPlaying={user.lastfmShowNowPlaying !== false}
            />
          </div>
        )}
      </form>
    </div>
  );
}
