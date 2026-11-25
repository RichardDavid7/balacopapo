import { useState, useEffect, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { AdminOidcConfigResponse, AdminOidcUser } from '@backspace/shared';
import { api } from '../../../api/client';
import { Avatar } from '../../ui/Avatar';
import { describeError } from '../../../i18n/errors';
import { useFormatters } from '../../../i18n/formatters';

type LinkFilter = 'all' | 'linked' | 'unlinked';
type RoleFilter = 'all' | 'admin' | 'member';
type SortMode = 'unlinkedFirst' | 'newest' | 'az';

export function OidcPanel() {
  const { t } = useTranslation(['admin', 'common']);
  const f = useFormatters();

  const [oidcConfig, setOidcConfig] = useState<AdminOidcConfigResponse | null>(null);
  const [users, setUsers] = useState<AdminOidcUser[]>([]);
  const [search, setSearch] = useState('');
  const [linkFilter, setLinkFilter] = useState<LinkFilter>('all');
  const [roleFilter, setRoleFilter] = useState<RoleFilter>('all');
  const [sortBy, setSortBy] = useState<SortMode>('unlinkedFirst');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [copiedCallback, setCopiedCallback] = useState(false);

  // Manual link editor state
  const [editingUserId, setEditingUserId] = useState<string | null>(null);
  const [subjectInput, setSubjectInput] = useState('');
  const [emailInput, setEmailInput] = useState('');
  const [savingUserId, setSavingUserId] = useState<string | null>(null);

  // One-click link URL generated for a user
  const [generatedLink, setGeneratedLink] = useState<{
    userId: string;
    username: string;
    url: string;
    expiresAt: number;
  } | null>(null);
  const [copiedLink, setCopiedLink] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [cfg, list] = await Promise.all([
        api.admin.oidc.getConfig(),
        api.admin.oidc.listUsers(),
      ]);
      setOidcConfig(cfg);
      setUsers(list.users);
    } catch (err) {
      setError(err instanceof Error ? describeError(err) : t('admin:oidc.loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const stats = useMemo(() => {
    const linked = users.filter((u) => u.oidcLink !== null).length;
    return { total: users.length, linked, unlinked: users.length - linked };
  }, [users]);

  const filteredUsers = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = users.filter((u) => {
      if (linkFilter === 'linked' && !u.oidcLink) return false;
      if (linkFilter === 'unlinked' && u.oidcLink) return false;
      if (roleFilter === 'admin' && !u.isAdmin) return false;
      if (roleFilter === 'member' && u.isAdmin) return false;
      if (!q) return true;
      return (
        u.username.toLowerCase().includes(q)
        || (u.displayName?.toLowerCase().includes(q) ?? false)
        || (u.oidcLink?.subject.toLowerCase().includes(q) ?? false)
        || (u.oidcLink?.email?.toLowerCase().includes(q) ?? false)
      );
    });

    return [...list].sort((a, b) => {
      if (sortBy === 'unlinkedFirst') {
        const aLinked = a.oidcLink ? 1 : 0;
        const bLinked = b.oidcLink ? 1 : 0;
        if (aLinked !== bLinked) return aLinked - bLinked;
        return a.username.localeCompare(b.username);
      }
      if (sortBy === 'az') {
        return a.username.localeCompare(b.username);
      }
      return b.createdAt - a.createdAt;
    });
  }, [users, search, linkFilter, roleFilter, sortBy]);

  const handleCopyCallback = async () => {
    if (!oidcConfig?.callbackUrl) return;
    try {
      await navigator.clipboard.writeText(oidcConfig.callbackUrl);
      setCopiedCallback(true);
      setTimeout(() => setCopiedCallback(false), 2000);
    } catch {
      // Clipboard blocked
    }
  };

  const handleStartManualLink = (user: AdminOidcUser) => {
    setEditingUserId(user.id);
    setSubjectInput(user.oidcLink?.subject ?? '');
    setEmailInput(user.oidcLink?.email ?? '');
    setError('');
  };

  const handleSaveManualLink = async (userId: string) => {
    if (!subjectInput.trim()) {
      setError(t('admin:oidc.subjectRequired'));
      return;
    }
    setSavingUserId(userId);
    setError('');
    try {
      await api.admin.oidc.linkUser({
        userId,
        subject: subjectInput.trim(),
        email: emailInput.trim() || undefined,
      });
      setEditingUserId(null);
      setSubjectInput('');
      setEmailInput('');
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? describeError(err) : t('admin:oidc.linkFailed'));
    } finally {
      setSavingUserId(null);
    }
  };

  const handleGenerateLinkToken = async (user: AdminOidcUser) => {
    setSavingUserId(user.id);
    setError('');
    try {
      const res = await api.admin.oidc.createLinkToken(user.id);
      setGeneratedLink({
        userId: user.id,
        username: user.username,
        url: res.linkUrl,
        expiresAt: res.expiresAt,
      });
      setCopiedLink(false);
    } catch (err) {
      setError(err instanceof Error ? describeError(err) : t('admin:oidc.linkTokenFailed'));
    } finally {
      setSavingUserId(null);
    }
  };

  const handleCopyGeneratedLink = async () => {
    if (!generatedLink) return;
    try {
      await navigator.clipboard.writeText(generatedLink.url);
      setCopiedLink(true);
      setTimeout(() => setCopiedLink(false), 2000);
    } catch {
      // Clipboard blocked
    }
  };

  const handleUnlink = async (userId: string) => {
    setSavingUserId(userId);
    setError('');
    try {
      await api.admin.oidc.unlinkUser(userId);
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? describeError(err) : t('admin:oidc.unlinkFailed'));
    } finally {
      setSavingUserId(null);
    }
  };

  const pillClass = (active: boolean) =>
    `px-2.5 py-1 rounded-md text-xs font-medium transition-colors whitespace-nowrap ${
      active
        ? 'bg-accent-primary text-white'
        : 'bg-surface-overlay text-txt-secondary hover:text-txt-primary'
    }`;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-txt-primary">{t('admin:oidc.title')}</h2>
        <p className="text-sm text-txt-tertiary mt-1">{t('admin:oidc.subtitle')}</p>
      </div>

      {error && (
        <div className="p-3 bg-accent-rose/10 border border-accent-rose/30 rounded text-txt-danger text-sm">
          {error}
        </div>
      )}

      {/* Docker Env Config Card */}
      <div className="bg-surface-elevated border border-border-soft rounded-lg p-4 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-semibold text-txt-primary">{t('admin:oidc.configCard.title')}</h3>
            <p className="text-xs text-txt-tertiary mt-0.5">{t('admin:oidc.configCard.dockerHint')}</p>
          </div>
          {oidcConfig && (
            <span
              className={`px-2 py-0.5 rounded text-xs font-medium shrink-0 ${
                oidcConfig.configured
                  ? 'bg-accent-mint/15 text-accent-mint'
                  : 'bg-surface-overlay text-txt-tertiary'
              }`}
            >
              {oidcConfig.configured ? t('admin:oidc.status.active') : t('admin:oidc.status.inactive')}
            </span>
          )}
        </div>

        {oidcConfig && (
          <div className="grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-3 text-xs pt-2 border-t border-border-soft">
            <div className="col-span-full">
              <div className="text-txt-tertiary mb-1">{t('admin:oidc.configCard.callbackUrl')}</div>
              <div className="flex items-center gap-2">
                <code className="flex-1 px-2.5 py-1.5 rounded bg-surface-base border border-border-soft text-txt-primary font-mono break-all">
                  {oidcConfig.callbackUrl}
                </code>
                <button
                  type="button"
                  onClick={handleCopyCallback}
                  className="px-3 py-1.5 rounded bg-surface-overlay hover:bg-surface-base text-txt-primary border border-border-soft transition-colors shrink-0"
                >
                  {copiedCallback ? t('common:actions.copied') : t('common:actions.copy')}
                </button>
              </div>
            </div>

            <div>
              <div className="text-txt-tertiary">{t('admin:oidc.configCard.issuer')}</div>
              <div className="text-txt-primary font-mono break-all mt-0.5">
                {oidcConfig.issuerUrl ?? t('admin:oidc.notSet')}
              </div>
            </div>

            <div>
              <div className="text-txt-tertiary">{t('admin:oidc.configCard.clientId')}</div>
              <div className="text-txt-primary font-mono break-all mt-0.5">
                {oidcConfig.clientId ?? t('admin:oidc.notSet')}
              </div>
            </div>

            <div>
              <div className="text-txt-tertiary">{t('admin:oidc.configCard.syncAvatar')}</div>
              <div className="text-txt-primary mt-0.5">
                {oidcConfig.syncAvatar ? t('common:states.enabled') : t('common:states.disabled')}
              </div>
            </div>

            <div>
              <div className="text-txt-tertiary">{t('admin:oidc.configCard.autoRegister')}</div>
              <div className="text-txt-primary mt-0.5">
                {oidcConfig.autoRegister ? t('common:states.enabled') : t('common:states.disabled')}
              </div>
            </div>

            <div className="col-span-full">
              <div className="text-txt-tertiary">{t('admin:oidc.configCard.adminGroups', { claim: oidcConfig.groupsClaim })}</div>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {oidcConfig.adminGroups.length > 0 ? (
                  oidcConfig.adminGroups.map((group) => (
                    <span key={group} className="px-2 py-0.5 rounded bg-accent-primary/15 text-accent-primary font-mono">
                      {group}
                    </span>
                  ))
                ) : (
                  <span className="text-txt-tertiary">{t('admin:oidc.configCard.noAdminGroups')}</span>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Generated one-click link banner */}
      {generatedLink && (
        <div className="p-3.5 bg-accent-primary/10 border border-accent-primary/30 rounded-lg space-y-2 text-xs">
          <div className="flex items-center justify-between gap-2">
            <span className="font-semibold text-txt-primary">
              {t('admin:oidc.generatedLink.title', { username: generatedLink.username })}
            </span>
            <button
              type="button"
              onClick={() => setGeneratedLink(null)}
              className="text-txt-tertiary hover:text-txt-primary"
            >
              {t('common:actions.close')}
            </button>
          </div>
          <p className="text-txt-secondary">
            {t('admin:oidc.generatedLink.hint', { time: f.formatTime(generatedLink.expiresAt) })}
          </p>
          <div className="flex items-center gap-2">
            <code className="flex-1 px-2.5 py-1.5 rounded bg-surface-base border border-border-soft text-txt-primary font-mono break-all">
              {generatedLink.url}
            </code>
            <button
              type="button"
              onClick={handleCopyGeneratedLink}
              className="px-3 py-1.5 rounded bg-accent-primary text-white font-medium hover:bg-accent-primary/80 transition-colors shrink-0"
            >
              {copiedLink ? t('common:actions.copied') : t('common:actions.copy')}
            </button>
          </div>
        </div>
      )}

      {/* Existing Users Linking Section */}
      <div className="space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div>
            <h3 className="text-sm font-semibold text-txt-primary">{t('admin:oidc.users.title')}</h3>
            <p className="text-xs text-txt-tertiary">{t('admin:oidc.users.subtitle')}</p>
          </div>
          <div className="text-xs text-txt-tertiary tabular-nums">
            {t('admin:oidc.users.summary', {
              total: stats.total,
              linked: stats.linked,
              unlinked: stats.unlinked,
            })}
          </div>
        </div>

        {/* Search + Filters toolbar */}
        <div className="bg-surface-elevated border border-border-soft rounded-lg p-3 space-y-2.5">
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t('admin:oidc.users.searchPlaceholder')}
              className="input-standard text-xs py-1.5 px-3 flex-1 min-w-[200px]"
            />
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as SortMode)}
              aria-label={t('common:actions.sortBy')}
              className="input-standard text-xs py-1.5 px-2.5"
            >
              <option value="unlinkedFirst">{t('admin:oidc.filters.sortUnlinkedFirst')}</option>
              <option value="newest">{t('admin:oidc.filters.sortNewest')}</option>
              <option value="az">{t('admin:oidc.filters.sortAZ')}</option>
            </select>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-1.5">
              <button type="button" onClick={() => setLinkFilter('all')} className={pillClass(linkFilter === 'all')}>
                {t('admin:oidc.filters.all')} ({stats.total})
              </button>
              <button type="button" onClick={() => setLinkFilter('unlinked')} className={pillClass(linkFilter === 'unlinked')}>
                {t('admin:oidc.filters.unlinked')} ({stats.unlinked})
              </button>
              <button type="button" onClick={() => setLinkFilter('linked')} className={pillClass(linkFilter === 'linked')}>
                {t('admin:oidc.filters.linked')} ({stats.linked})
              </button>
            </div>

            <div className="flex flex-wrap items-center gap-1.5">
              <button type="button" onClick={() => setRoleFilter('all')} className={pillClass(roleFilter === 'all')}>
                {t('admin:oidc.filters.allRoles')}
              </button>
              <button type="button" onClick={() => setRoleFilter('admin')} className={pillClass(roleFilter === 'admin')}>
                {t('admin:oidc.filters.adminsOnly')}
              </button>
              <button type="button" onClick={() => setRoleFilter('member')} className={pillClass(roleFilter === 'member')}>
                {t('admin:oidc.filters.membersOnly')}
              </button>
            </div>
          </div>
        </div>

        {/* Clean user cards list */}
        {loading ? (
          <div className="text-sm text-txt-tertiary py-8 text-center">{t('common:states.loading')}</div>
        ) : filteredUsers.length === 0 ? (
          <div className="text-sm text-txt-tertiary py-8 text-center bg-surface-elevated border border-border-soft rounded-lg">
            {t('admin:oidc.users.empty')}
          </div>
        ) : (
          <div className="space-y-2">
            {filteredUsers.map((user) => {
              const isEditing = editingUserId === user.id;
              const isBusy = savingUserId === user.id;

              return (
                <div
                  key={user.id}
                  className="bg-surface-elevated border border-border-soft rounded-lg p-3.5 space-y-3"
                >
                  {/* Top row: identity + status badge */}
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <Avatar
                        src={user.avatar}
                        name={user.displayName || user.username}
                        avatarColor={user.avatarColor}
                        size={40}
                      />
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="text-sm font-semibold text-txt-primary truncate">
                            {user.displayName || user.username}
                          </span>
                          <span className="text-xs text-txt-tertiary font-mono truncate">@{user.username}</span>
                          {user.isAdmin && (
                            <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-accent-primary/15 text-accent-primary">
                              {t('admin:oidc.users.adminBadge')}
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-2 mt-1 flex-wrap">
                          <span
                            className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                              user.oidcLink
                                ? 'bg-accent-mint/15 text-accent-mint'
                                : 'bg-surface-overlay text-txt-tertiary'
                            }`}
                          >
                            {user.oidcLink ? t('admin:oidc.users.statusLinked') : t('admin:oidc.users.notLinked')}
                          </span>
                          {user.oidcLink?.lastLoginAt && (
                            <span className="text-[11px] text-txt-tertiary">
                              {t('admin:oidc.users.lastLogin', { date: f.formatMediumDate(user.oidcLink.lastLoginAt) })}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-1.5 flex-wrap justify-end shrink-0">
                      {oidcConfig?.configured && (
                        <button
                          type="button"
                          disabled={isBusy}
                          onClick={() => handleGenerateLinkToken(user)}
                          className="px-2.5 py-1.5 rounded-md text-xs font-medium bg-accent-primary/15 text-accent-primary hover:bg-accent-primary/25 transition-colors disabled:opacity-50"
                        >
                          {t('admin:oidc.actions.generateLink')}
                        </button>
                      )}
                      {oidcConfig?.issuerUrl && (
                        <button
                          type="button"
                          disabled={isBusy}
                          onClick={() => (isEditing ? setEditingUserId(null) : handleStartManualLink(user))}
                          className="px-2.5 py-1.5 rounded-md text-xs font-medium bg-surface-overlay text-txt-primary hover:bg-surface-base border border-border-soft transition-colors disabled:opacity-50"
                        >
                          {user.oidcLink ? t('admin:oidc.actions.editLink') : t('admin:oidc.actions.manualLink')}
                        </button>
                      )}
                      {user.oidcLink && (
                        <button
                          type="button"
                          disabled={isBusy}
                          onClick={() => handleUnlink(user.id)}
                          className="px-2.5 py-1.5 rounded-md text-xs font-medium bg-accent-rose/10 text-txt-danger hover:bg-accent-rose/20 transition-colors disabled:opacity-50"
                        >
                          {t('admin:oidc.actions.unlink')}
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Linked metadata details */}
                  {user.oidcLink && (
                    <div className="px-2.5 py-2 rounded bg-surface-base border border-border-soft flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px]">
                      <div className="min-w-0 flex items-center gap-1.5">
                        <span className="text-txt-tertiary">{t('admin:oidc.users.subLabel')}</span>
                        <code className="text-txt-secondary font-mono truncate max-w-[260px]" title={user.oidcLink.subject}>
                          {user.oidcLink.subject}
                        </code>
                      </div>
                      {user.oidcLink.email && (
                        <div className="min-w-0 flex items-center gap-1.5">
                          <span className="text-txt-tertiary">{t('admin:oidc.users.emailLabel')}</span>
                          <span className="text-txt-secondary truncate">{user.oidcLink.email}</span>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Inline manual Subject editor */}
                  {isEditing && (
                    <div className="pt-2.5 border-t border-border-soft grid grid-cols-[repeat(auto-fit,minmax(160px,1fr))] gap-2">
                      <input
                        type="text"
                        value={subjectInput}
                        onChange={(e) => setSubjectInput(e.target.value)}
                        placeholder={t('admin:oidc.fields.subjectPlaceholder')}
                        className="input-standard text-xs py-1.5 px-2.5 font-mono"
                      />
                      <input
                        type="email"
                        value={emailInput}
                        onChange={(e) => setEmailInput(e.target.value)}
                        placeholder={t('admin:oidc.fields.emailPlaceholder')}
                        className="input-standard text-xs py-1.5 px-2.5"
                      />
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          disabled={isBusy}
                          onClick={() => handleSaveManualLink(user.id)}
                          className="px-3 py-1.5 rounded text-xs font-medium bg-accent-primary text-white hover:bg-accent-primary/80 transition-colors disabled:opacity-50"
                        >
                          {t('common:actions.save')}
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditingUserId(null)}
                          className="px-3 py-1.5 rounded text-xs text-txt-secondary hover:text-txt-primary"
                        >
                          {t('common:actions.cancel')}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
