import React, { useState, useEffect } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Trans, useTranslation } from 'react-i18next';
import { useAuthStore } from '../../stores/authStore';
import { api, RateLimitError } from '../../api/client';
import type { InstanceInfoResponse } from '@backspace/shared';
import { SourceCodeLink } from '../ui/SourceCodeLink';
import { describeError } from '../../i18n/errors';

export function LoginPage() {
  const { t } = useTranslation(['auth', 'common']);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [retryAfter, setRetryAfter] = useState(0);
  const login = useAuthStore((s) => s.login);
  const isLoading = useAuthStore((s) => s.isLoading);
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const redirect = searchParams.get('redirect');
  const oidcErrorCode = searchParams.get('oidc_error');

  // AGPL § 13: anonymous users must be able to reach the source of the running
  // version. Fetched from the unauthenticated public info endpoint.
  const [instanceInfo, setInstanceInfo] = useState<InstanceInfoResponse | null>(null);
  useEffect(() => {
    let cancelled = false;
    api.instance.info()
      .then((info) => { if (!cancelled) setInstanceInfo(info); })
      .catch(() => { /* Non-critical — link is simply omitted if unreachable. */ });
    return () => { cancelled = true; };
  }, []);

  const oidcErrorMessage = oidcErrorCode
    ? t(`auth:oidc.errors.${oidcErrorCode}`, { defaultValue: t('auth:oidc.errors.generic') })
    : '';

  const handleOidcLogin = () => {
    const params = new URLSearchParams();
    if (redirect && redirect.startsWith('/') && !redirect.startsWith('//')) {
      params.set('redirect', redirect);
    }
    const qs = params.toString();
    window.location.assign(`/api/auth/oidc/start${qs ? `?${qs}` : ''}`);
  };

  useEffect(() => {
    if (retryAfter <= 0) return;
    const timer = setInterval(() => {
      setRetryAfter((prev) => {
        if (prev <= 1) {
          clearInterval(timer);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [retryAfter]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!username.trim()) {
      setError(t('auth:validation.usernameRequired'));
      return;
    }
    if (!password) {
      setError(t('auth:validation.passwordRequired'));
      return;
    }

    try {
      await login(username.trim(), password);
      if (redirect && redirect.startsWith('/') && !redirect.startsWith('//')) {
        navigate(redirect);
      } else {
        navigate('/channels/@me');
      }
    } catch (err) {
      if (err instanceof RateLimitError) {
        setRetryAfter(err.retryAfter);
        setError('');
      } else {
        setError(err instanceof Error ? describeError(err) : t('auth:login.failed'));
      }
    }
  };

  const isDisabled = isLoading || retryAfter > 0;

  return (
    <div className="h-full overflow-y-auto flex flex-col items-center bg-surface-base relative">
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,rgb(var(--accent-primary)/0.06)_0%,transparent_50%)]" />
      <div className="my-auto flex-shrink-0 w-full max-w-[480px] bg-surface-elevated rounded-md p-8 shadow-elevation-high relative z-10">
        <div className="text-center mb-6">
          <h1 className="text-2xl font-bold text-txt-primary">{t('auth:login.title')}</h1>
          <p className="text-txt-tertiary mt-1">{t('auth:login.subtitle')}</p>
        </div>

        {oidcErrorMessage && (
          <div className="mb-4 p-3 bg-accent-rose/10 border border-accent-rose/30 rounded text-txt-danger text-sm">
            {oidcErrorMessage}
          </div>
        )}

        {instanceInfo?.oidc?.enabled && (
          <div className="mb-5">
            <button
              type="button"
              onClick={handleOidcLogin}
              className="w-full py-2.5 bg-surface-overlay hover:bg-surface-hover border border-border-subtle text-txt-primary font-medium rounded transition-colors flex items-center justify-center gap-2"
            >
              <svg className="w-4 h-4 text-accent-primary" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
              </svg>
              {t('auth:oidc.signInWith', { provider: instanceInfo.oidc.displayName })}
            </button>
            {!instanceInfo.oidc.passwordLoginDisabled && (
              <div className="flex items-center gap-3 my-4">
                <div className="flex-1 h-px bg-border-subtle" />
                <span className="text-xs text-txt-tertiary uppercase">{t('auth:oidc.orPassword')}</span>
                <div className="flex-1 h-px bg-border-subtle" />
              </div>
            )}
          </div>
        )}

        {!instanceInfo?.oidc?.passwordLoginDisabled && (
          <form onSubmit={handleSubmit}>
            {retryAfter > 0 && (
              <div className="mb-4 p-3 bg-accent-amber/10 border border-accent-amber/30 rounded text-sm">
                <p className="font-medium text-accent-amber">{t('auth:login.rateLimited.title')}</p>
                <p className="text-txt-secondary mt-0.5">{t('auth:login.rateLimited.retryIn', { seconds: retryAfter })}</p>
              </div>
            )}

            {error && (
              <div className="mb-4 p-3 bg-accent-rose/10 border border-accent-rose/30 rounded text-txt-danger text-sm">
                {error}
              </div>
            )}

            <div className="mb-5">
              <label className="block text-xs font-bold text-txt-secondary uppercase mb-2">
                {t('common:labels.username')} <span className="text-txt-danger">*</span>
              </label>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="input-standard w-full py-2.5"
                autoFocus
                autoComplete="username"
              />
            </div>

            <div className="mb-5">
              <label className="block text-xs font-bold text-txt-secondary uppercase mb-2">
                {t('common:labels.password')} <span className="text-txt-danger">*</span>
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="input-standard w-full py-2.5"
                autoComplete="current-password"
              />
            </div>

            <button
              type="submit"
              disabled={isDisabled}
              className="w-full py-2.5 bg-accent-primary hover:bg-accent-primary/80 text-white font-medium rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {retryAfter > 0
                ? t('auth:login.rateLimited.retryIn', { seconds: retryAfter })
                : isLoading
                  ? t('auth:login.submitting')
                  : t('common:actions.logIn')}
            </button>

            <p className="mt-3 text-sm text-txt-tertiary">
              <Trans
                t={t}
                i18nKey="auth:login.registerPrompt"
                components={{
                  actionLink: <Link to={`/register${redirect ? `?redirect=${encodeURIComponent(redirect)}` : ''}`} className="text-accent-primary hover:underline" />,
                }}
              />
            </p>
          </form>
        )}

        {instanceInfo && (
          <div className="mt-6 pt-4 border-t border-white/[0.04] flex justify-center">
            <SourceCodeLink sourceCodeUrl={instanceInfo.sourceCodeUrl} version={instanceInfo.version} commit={instanceInfo.commit} />
          </div>
        )}
      </div>
    </div>
  );
}
