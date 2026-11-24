import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { isElectron } from './platform';

export const BALACOPAPO_SCHEME = 'balacopapo';

const SUPPORTED_PROTOCOLS = new Set(['balacopapo:', 'web+balacopapo:', 'backspace:']);

/**
 * Builds a `balacopapo://join/...` deep link for an invite code.
 * If `originHost` is provided and `inviteCode` is not already qualified with `@host`,
 * appends `@{originHost}` so the native app knows which instance owns the invite.
 */
export function buildJoinDeepLink(inviteCode: string, originHost?: string): string {
  const trimmed = inviteCode.trim();
  const qualified =
    originHost && !trimmed.includes('@') ? `${trimmed}@${originHost}` : trimmed;
  return `${BALACOPAPO_SCHEME}://join/${encodeURIComponent(qualified)}`;
}

/**
 * Parses a `balacopapo://`, `web+balacopapo://`, or legacy `backspace://` URL
 * into a safe internal React Router path, or returns `null` if unsupported/invalid.
 *
 * Supported routes:
 *   balacopapo://join/{code}                   → /join/{code}
 *   balacopapo://join/{code}@{host}            → /join/{code}@{host}
 *   balacopapo://channel/{spaceId}/{channelId} → /channels/{spaceId}/{channelId}
 *   balacopapo://auth/callback?code=...&state= → /auth/callback?code=...&state=...
 */
export function parseDeepLinkUrl(rawUrl: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return null;
  }

  if (!SUPPORTED_PROTOCOLS.has(parsed.protocol)) return null;

  const host = parsed.hostname.toLowerCase();
  const pathParts = parsed.pathname.split('/').filter(Boolean);

  if (host === 'join' && pathParts.length >= 1) {
    const code = decodeURIComponent(pathParts[0]!);
    if (!code || code.includes('/') || code.includes('\\')) return null;
    return `/join/${encodeURIComponent(code)}`;
  }

  if (host === 'channel' && pathParts.length >= 2) {
    const spaceId = encodeURIComponent(decodeURIComponent(pathParts[0]!));
    const channelId = encodeURIComponent(decodeURIComponent(pathParts[1]!));
    return `/channels/${spaceId}/${channelId}`;
  }

  if (host === 'auth' && pathParts[0] === 'callback') {
    const safeParams = new URLSearchParams();
    for (const key of ['code', 'state', 'error', 'error_description']) {
      const value = parsed.searchParams.get(key);
      if (value !== null) safeParams.set(key, value);
    }
    const qs = safeParams.toString();
    return qs ? `/auth/callback?${qs}` : '/auth/callback';
  }

  return null;
}

/**
 * Listens for deep link events from the Desktop native host (Tauri/Electron)
 * and navigates accordingly.
 */
export function useDeepLinkHandler(): void {
  const navigate = useNavigate();

  useEffect(() => {
    if (!isElectron()) return;

    const api = window.backspace!;
    const maybeOffDeepLink = api.onDeepLink((url: string) => {
      const targetPath = parseDeepLinkUrl(url);
      if (targetPath) {
        navigate(targetPath);
      } else {
        console.warn('[DeepLink] Unknown or invalid route:', url);
      }
    }) as unknown;

    // Origin-aware /join/ interception from the main process
    const offInternal = api.onOpenInternalRoute((path: string) => {
      // path is e.g. '/join/cb265c4e' — already a normalized React Router path
      navigate(path);
    });
    return () => {
      if (typeof maybeOffDeepLink === 'function') {
        (maybeOffDeepLink as () => void)();
      }
      offInternal();
    };
  }, [navigate]);
}
