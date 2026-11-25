import React, { useState, useEffect, useRef } from 'react';
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

  const [oidcBrowserPending, setOidcBrowserPending] = useState(false);
  const [oidcHandoffError, setOidcHandoffError] = useState('');
  const handoffTimerRef = useRef<number | null>(null);
  const handoffActiveRef = useRef(false);

  const stopOidcHandoff = () => {
    handoffActiveRef.current = false;
    if (handoffTimerRef.current !== null) {
      window.clearInterval(handoffTimerRef.current);
      handoffTimerRef.current = null;
    }
    setOidcBrowserPending(false);
  };

  useEffect(() => () => {
    handoffActiveRef.current = false;
    if (handoffTimerRef.current !== null) {
      window.clearInterval(handoffTimerRef.current);
      handoffTimerRef.current = null;
    }
  }, []);

  const oidcErrorMessage = oidcHandoffError || (oidcErrorCode
    ? t(`auth:oidc.errors.${oidcErrorCode}`, { defaultValue: t('auth:oidc.errors.generic') })
    : '');

  const handleOidcLogin = () => {
    const params = new URLSearchParams();
    if (redirect && redirect.startsWith('/') && !redirect.startsWith('//')) {
      params.set('redirect', redirect);
    }
    const qs = params.toString();
    window.location.assign(`/api/auth/oidc/start${qs ? `?${qs}` : ''}`);
  };

  const handleOidcBrowserLogin = async () => {
    stopOidcHandoff();
    setOidcHandoffError('');

    // Open a blank window synchronously in browser/PWA contexts to avoid mobile popup blockers.
    // In Electron, window.open is intercepted by setWindowOpenHandler -> shell.openExternal.
    const isDesktopApp = Boolean((window as unknown as { backspace?: unknown }).backspace);
    const popup = isDesktopApp ? null : window.open('about:blank', '_blank');

    setOidcBrowserPending(true);
    handoffActiveRef.current = true;

    try {
      const { handoffId, pollToken, expiresInMs } = await api.auth.createOidcHandoff();
      if (!handoffActiveRef.current) {
        popup?.close();
        return;
      }

      const params = new URLSearchParams();
      params.set('client', 'desktop');
      params.set('handoff', handoffId);
      if (redirect && redirect.startsWith('/') && !redirect.startsWith('//')) {
        params.set('redirect', redirect);
      }
      const startUrl = `${window.location.origin}/api/auth/oidc/start?${params.toString()}`;

      if (popup && !popup.closed) {
        popup.location.href = startUrl;
      } else {
        window.open(startUrl, '_blank', 'noopener,noreferrer');
      }

      const deadline = Date.now() + expiresInMs;
      let inFlight = false;

      handoffTimerRef.current = window.setInterval(() => {
        if (!handoffActiveRef.current || inFlight) return;
        if (Date.now() >= deadline) {
          stopOidcHandoff();
          setOidcHandoffError(t('auth:oidc.errors.state_expired'));
          return;
        }
        inFlight = true;
        api.auth.pollOidcHandoff(handoffId, pollToken)
          .then(async (pollRes) => {
            if (!handoffActiveRef.current) return;
            if (pollRes.status === 'ready') {
              stopOidcHandoff();
              const auth = await api.auth.exchangeOidcTicket(pollRes.ticket);
              useAuthStore.getState().initSession(auth.token, auth.user);
              const safeTarget = pollRes.redirect && pollRes.redirect.startsWith('/') && !pollRes.redirect.startsWith('//')
                ? pollRes.redirect
                : '/channels/@me';
              navigate(safeTarget, { replace: true });
            } else if (pollRes.status === 'error') {
              stopOidcHandoff();
              setOidcHandoffError(
                t(`auth:oidc.errors.${pollRes.error}`, { defaultValue: t('auth:oidc.errors.generic') }),
              );
            }
          })
          .catch(() => {
            // Transient network error while user is in external browser; keep polling until deadline.
          })
          .finally(() => {
            inFlight = false;
          });
      }, 1500);
    } catch {
      popup?.close();
      stopOidcHandoff();
      setOidcHandoffError(t('auth:oidc.errors.provider_unreachable'));
    }
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
          <div className="mb-5 space-y-2">
            <button
              type="button"
              onClick={handleOidcLogin}
              className="w-full py-2.5 bg-surface-overlay hover:bg-surface-elevated border border-border-soft text-txt-primary font-medium rounded transition-colors flex items-center justify-center gap-2"
            >
              <svg className="w-4 h-4 text-accent-primary" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
              </svg>
              {t('auth:oidc.signInWith', { provider: instanceInfo.oidc.displayName })}
            </button>
            <button
              type="button"
              onClick={handleOidcBrowserLogin}
              className="w-full py-2 bg-surface-base hover:bg-surface-overlay border border-border-soft text-txt-secondary hover:text-txt-primary text-xs font-medium rounded transition-colors flex items-center justify-center gap-1.5"
            >
              <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
              </svg>
              {t('auth:oidc.openInBrowser')}
            </button>
            {oidcBrowserPending && (
              <div className="flex items-center justify-between gap-2 px-3 py-2 rounded bg-surface-base border border-border-soft text-xs text-txt-tertiary">
                <span>{t('auth:oidc.waitingBrowser')}</span>
                <button
                  type="button"
                  onClick={stopOidcHandoff}
                  className="text-txt-secondary hover:text-txt-primary underline flex-shrink-0"
                >
                  {t('common:actions.cancel')}
                </button>
              </div>
            )}
            {!instanceInfo.oidc.passwordLoginDisabled && (
              <div className="flex items-center gap-3 pt-2">
                <div className="flex-1 h-px bg-border-soft" />
                <span className="text-xs text-txt-tertiary uppercase">{t('auth:oidc.orPassword')}</span>
                <div className="flex-1 h-px bg-border-soft" />
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
