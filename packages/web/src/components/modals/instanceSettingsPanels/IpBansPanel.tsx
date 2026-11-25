import React, { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import type { AdminIpBan, AdminIpBanFeedInfo } from '@backspace/shared';
import { api } from '../../../api/client';
import { describeError } from '../../../i18n/errors';
import { useFormatters } from '../../../i18n/formatters';

export function IpBansPanel() {
  const { t } = useTranslation(['admin', 'common']);
  const f = useFormatters();

  const [bans, setBans] = useState<AdminIpBan[]>([]);
  const [feedInfo, setFeedInfo] = useState<AdminIpBanFeedInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [ipInput, setIpInput] = useState('');
  const [daysInput, setDaysInput] = useState('30');
  const [reasonInput, setReasonInput] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [copiedFeed, setCopiedFeed] = useState<'opnsense' | 'nginx' | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [bansRes, infoRes] = await Promise.all([
        api.admin.ipBans.list(),
        api.admin.ipBans.getFeedInfo(),
      ]);
      setBans(bansRes.bans);
      setFeedInfo(infoRes);
    } catch (err) {
      setError(err instanceof Error ? describeError(err) : t('admin:ipBans.loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const handleAddBan = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ipInput.trim()) {
      setError(t('admin:ipBans.ipRequired'));
      return;
    }
    const parsedDays = daysInput.trim() === '' ? null : Number(daysInput.trim());
    if (parsedDays !== null && (!Number.isFinite(parsedDays) || parsedDays < 0 || parsedDays > 3650)) {
      setError(t('admin:ipBans.daysInvalid'));
      return;
    }

    setSubmitting(true);
    setError('');
    try {
      await api.admin.ipBans.create({
        ip: ipInput.trim(),
        reason: reasonInput.trim() || undefined,
        durationDays: parsedDays && parsedDays > 0 ? parsedDays : null,
      });
      setIpInput('');
      setReasonInput('');
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? describeError(err) : t('admin:ipBans.createFailed'));
    } finally {
      setSubmitting(false);
    }
  };

  const handleRemoveBan = async (id: string) => {
    setError('');
    try {
      await api.admin.ipBans.remove(id);
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? describeError(err) : t('admin:ipBans.removeFailed'));
    }
  };

  const buildFeedUrl = (kind: 'opnsense' | 'nginx') => {
    const base = typeof window !== 'undefined' ? window.location.origin : '';
    const rel = kind === 'opnsense' ? feedInfo?.opnsensePath : feedInfo?.nginxPath;
    return `${base}${rel ?? ''}&token=<IP_BAN_FEED_TOKEN>`;
  };

  const handleCopyFeed = async (kind: 'opnsense' | 'nginx') => {
    try {
      await navigator.clipboard.writeText(buildFeedUrl(kind));
      setCopiedFeed(kind);
      setTimeout(() => setCopiedFeed(null), 2000);
    } catch {
      // Clipboard blocked
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-txt-primary">{t('admin:ipBans.title')}</h2>
        <p className="text-sm text-txt-tertiary mt-1">{t('admin:ipBans.subtitle')}</p>
      </div>

      {error && (
        <div className="p-3 bg-accent-rose/10 border border-accent-rose/30 rounded text-txt-danger text-sm">
          {error}
        </div>
      )}

      {/* Add IP ban form */}
      <form onSubmit={handleAddBan} className="bg-surface-elevated border border-border-soft rounded-lg p-4 space-y-3">
        <h3 className="text-sm font-semibold text-txt-primary">{t('admin:ipBans.addTitle')}</h3>
        <div className="grid grid-cols-[repeat(auto-fit,minmax(160px,1fr))] gap-2.5">
          <div>
            <label className="block text-xs text-txt-tertiary mb-1">{t('admin:ipBans.fields.ip')}</label>
            <input
              type="text"
              value={ipInput}
              onChange={(e) => setIpInput(e.target.value)}
              placeholder={t('admin:ipBans.fields.ipPlaceholder')}
              className="input-standard w-full text-sm py-1.5 px-2.5 font-mono"
            />
          </div>
          <div>
            <label className="block text-xs text-txt-tertiary mb-1">{t('admin:ipBans.fields.days')}</label>
            <input
              type="number"
              min={0}
              max={3650}
              value={daysInput}
              onChange={(e) => setDaysInput(e.target.value)}
              placeholder={t('admin:ipBans.fields.daysPlaceholder')}
              className="input-standard w-full text-sm py-1.5 px-2.5"
            />
          </div>
          <div>
            <label className="block text-xs text-txt-tertiary mb-1">{t('admin:ipBans.fields.reason')}</label>
            <input
              type="text"
              value={reasonInput}
              onChange={(e) => setReasonInput(e.target.value)}
              placeholder={t('admin:ipBans.fields.reasonPlaceholder')}
              className="input-standard w-full text-sm py-1.5 px-2.5"
            />
          </div>
        </div>
        <div className="flex justify-end">
          <button
            type="submit"
            disabled={submitting}
            className="px-4 py-1.5 rounded text-xs font-medium bg-accent-rose text-white hover:bg-accent-rose/80 transition-colors disabled:opacity-50"
          >
            {t('admin:ipBans.actions.ban')}
          </button>
        </div>
      </form>

      {/* Active IP bans list */}
      <div className="space-y-2.5">
        <h3 className="text-sm font-semibold text-txt-primary">
          {t('admin:ipBans.listTitle', { total: bans.length })}
        </h3>
        {loading ? (
          <div className="text-sm text-txt-tertiary py-6 text-center">{t('common:states.loading')}</div>
        ) : bans.length === 0 ? (
          <div className="text-sm text-txt-tertiary py-6 text-center bg-surface-elevated border border-border-soft rounded-lg">
            {t('admin:ipBans.empty')}
          </div>
        ) : (
          <div className="divide-y divide-border-soft border border-border-soft rounded-lg overflow-hidden bg-surface-elevated">
            {bans.map((ban) => (
              <div key={ban.id} className="p-3 flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-mono font-semibold text-txt-primary">{ban.ip}</span>
                    <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-surface-overlay text-txt-secondary">
                      {ban.expiresAt
                        ? t('admin:ipBans.expiresOn', { date: f.formatMediumDate(ban.expiresAt) })
                        : t('admin:ipBans.permanent')}
                    </span>
                  </div>
                  {ban.reason && (
                    <div className="text-xs text-txt-tertiary mt-0.5 break-words">{ban.reason}</div>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => handleRemoveBan(ban.id)}
                  className="px-2.5 py-1 rounded text-xs font-medium bg-surface-overlay text-txt-primary hover:bg-surface-base border border-border-soft transition-colors"
                >
                  {t('admin:ipBans.actions.unban')}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* OPNsense / Nginx feed card */}
      <div className="bg-surface-elevated border border-border-soft rounded-lg p-4 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-semibold text-txt-primary">{t('admin:ipBans.feed.title')}</h3>
            <p className="text-xs text-txt-tertiary mt-0.5">{t('admin:ipBans.feed.description')}</p>
          </div>
          {feedInfo && (
            <span
              className={`px-2 py-0.5 rounded text-xs font-medium shrink-0 ${
                feedInfo.configured
                  ? 'bg-accent-mint/15 text-accent-mint'
                  : 'bg-surface-overlay text-txt-tertiary'
              }`}
            >
              {feedInfo.configured ? t('admin:ipBans.feed.tokenSet') : t('admin:ipBans.feed.tokenMissing')}
            </span>
          )}
        </div>

        <div className="space-y-2 text-xs">
          <div>
            <div className="text-txt-tertiary mb-1">{t('admin:ipBans.feed.opnsenseLabel')}</div>
            <div className="flex items-center gap-2">
              <code className="flex-1 px-2.5 py-1.5 rounded bg-surface-base border border-border-soft text-txt-primary font-mono break-all">
                {buildFeedUrl('opnsense')}
              </code>
              <button
                type="button"
                onClick={() => handleCopyFeed('opnsense')}
                className="px-3 py-1.5 rounded bg-surface-overlay hover:bg-surface-base text-txt-primary border border-border-soft transition-colors shrink-0"
              >
                {copiedFeed === 'opnsense' ? t('common:actions.copied') : t('common:actions.copy')}
              </button>
            </div>
          </div>

          <div>
            <div className="text-txt-tertiary mb-1">{t('admin:ipBans.feed.nginxLabel')}</div>
            <div className="flex items-center gap-2">
              <code className="flex-1 px-2.5 py-1.5 rounded bg-surface-base border border-border-soft text-txt-primary font-mono break-all">
                {buildFeedUrl('nginx')}
              </code>
              <button
                type="button"
                onClick={() => handleCopyFeed('nginx')}
                className="px-3 py-1.5 rounded bg-surface-overlay hover:bg-surface-base text-txt-primary border border-border-soft transition-colors shrink-0"
              >
                {copiedFeed === 'nginx' ? t('common:actions.copied') : t('common:actions.copy')}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
