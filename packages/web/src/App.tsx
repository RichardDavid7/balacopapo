import React, { useEffect, useState } from 'react';
import { Routes, Route, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { LoginPage } from './components/auth/LoginPage';
import { RegisterPage } from './components/auth/RegisterPage';
import { AppLayout } from './components/layout/AppLayout';
import { JoinPage } from './components/JoinPage';
import { SwAutoUpdate } from './components/ui/SwUpdatePrompt';
import { TelemetryAsk } from './components/telemetry/TelemetryAsk';
import { ScreenShareSetup } from './components/voice/ScreenShareSetup';
import { useAuthStore } from './stores/authStore';
import { api } from './api/client';
import { isElectron } from './platform/platform';
import { parseDeepLinkUrl } from './platform/deepLink';

function DeepLinkOpenRedirect() {
  const [searchParams] = useSearchParams();
  const rawUrl = searchParams.get('url');
  const target = rawUrl ? parseDeepLinkUrl(rawUrl) : null;
  return <Navigate to={target ?? '/channels/@me'} replace />;
}

function OidcCallbackRedirect() {
  const { t } = useTranslation(['auth']);
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const initSession = useAuthStore((s) => s.initSession);
  const [failed, setFailed] = useState(false);

  const ticket = searchParams.get('oidc_ticket');
  const redirect = searchParams.get('redirect');
  const oidcError = searchParams.get('oidc_error');

  useEffect(() => {
    if (oidcError) {
      navigate(`/login?oidc_error=${encodeURIComponent(oidcError)}`, { replace: true });
      return;
    }
    if (!ticket) {
      navigate('/login', { replace: true });
      return;
    }

    let cancelled = false;
    api.auth.exchangeOidcTicket(ticket)
      .then((res) => {
        if (cancelled) return;
        initSession(res.token, res.user);
        const safeTarget = redirect && redirect.startsWith('/') && !redirect.startsWith('//')
          ? redirect
          : '/channels/@me';
        navigate(safeTarget, { replace: true });
      })
      .catch(() => {
        if (cancelled) return;
        setFailed(true);
        navigate('/login?oidc_error=ticket_invalid', { replace: true });
      });

    return () => { cancelled = true; };
  }, [ticket, redirect, oidcError, initSession, navigate]);

  if (failed) return <Navigate to="/login?oidc_error=ticket_invalid" replace />;

  return (
    <div className="h-full flex items-center justify-center bg-surface-base text-txt-secondary text-sm">
      {t('auth:oidc.completing')}
    </div>
  );
}

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const token = useAuthStore((s) => s.token);
  // i18n-check: allow-literal — the `; return` between the two elements is code, not text.
  if (!token) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

function AuthRedirect({ children }: { children: React.ReactNode }) {
  const token = useAuthStore((s) => s.token);
  const [searchParams] = useSearchParams();
  const redirect = searchParams.get('redirect');
  if (token) {
    if (redirect && redirect.startsWith('/') && !redirect.startsWith('//')) {
      return <Navigate to={redirect} replace />;
    }
    return <Navigate to="/channels/@me" replace />;
  }
  return <>{children}</>;
}

export function App() {
  // Boot-completion ping — disarms the main-process boot timer.
  // MUST be first hook on the unconditional render path. Single fire on
  // first commit; main owns "armed once" gating so duplicate calls (e.g.
  // ErrorBoundary path) are idempotent. Semantic: "renderer survived
  // render," NOT "data loaded." A spinner on screen counts as boot success.
  //
  // Gated on VITE_FORCE_BOOT_STALL so the smoke-test harness can build a
  // variant that intentionally never pings, exercising the renderer-stalled
  // recovery path without hand-editing source. Set 'true' / '1' to force stall.
  useEffect(() => {
    if (import.meta.env.VITE_FORCE_BOOT_STALL) return;
    if (typeof window.backspace?.rendererReady === 'function') {
      window.backspace.rendererReady();
    }
  }, []);

  const showTitleBar = isElectron();

  return (
    <div className={`flex flex-col ${showTitleBar ? 'h-screen' : 'contents'}`}>
      {showTitleBar && (
        <div className="flex-shrink-0 bg-surface-base border-b border-border-hard titlebar-drag"
          style={{ height: 'var(--titlebar-inset)', borderBottomWidth: 'calc(1px / var(--interface-scale))' }} />
      )}
      <div className={showTitleBar ? 'flex-1 min-h-0' : 'contents'}>
        <SwAutoUpdate />
        <TelemetryAsk />
        <ScreenShareSetup />
        <Routes>
          <Route
            path="/login"
            element={
              <AuthRedirect>
                <LoginPage />
              </AuthRedirect>
            }
          />
          <Route
            path="/register"
            element={
              <AuthRedirect>
                <RegisterPage />
              </AuthRedirect>
            }
          />
          <Route
            path="/channels/:spaceId/:channelId?"
            element={
              <ProtectedRoute>
                <AppLayout />
              </ProtectedRoute>
            }
          />
          <Route
            path="/join/:inviteCode"
            element={<JoinPage />}
          />
          <Route
            path="/open"
            element={<DeepLinkOpenRedirect />}
          />
          <Route
            path="/auth/callback"
            element={<OidcCallbackRedirect />}
          />
          <Route
            path="/explore"
            element={
              <ProtectedRoute>
                <AppLayout />
              </ProtectedRoute>
            }
          />
          <Route
            path="/backspace"
            element={
              <ProtectedRoute>
                <AppLayout />
              </ProtectedRoute>
            }
          />
          <Route path="/" element={<Navigate to="/channels/@me" replace />} />
          <Route path="*" element={<Navigate to="/channels/@me" replace />} />
        </Routes>
      </div>
    </div>
  );
}
