export const SOCIAL_CONNECTION_PLATFORMS = [
  'steam',
  'epic',
  'discord',
  'youtube',
  'spotify',
  'tidal',
  'qobuz',
  'instagram',
  'facebook',
  'website',
] as const;

export type SocialConnectionPlatform = (typeof SOCIAL_CONNECTION_PLATFORMS)[number];

export interface UserSocialConnection {
  id: string;
  platform: SocialConnectionPlatform;
  /** Canonical safe HTTPS/HTTP URL (or empty string for handle-only platforms like Discord/Epic). */
  url: string;
  /** Display label shown on the profile (profile name/handle, or full clean URL for `website`). */
  displayLabel: string;
}

export interface ConnectionValidationResult {
  ok: true;
  connection: Omit<UserSocialConnection, 'id'>;
}

export interface ConnectionValidationError {
  ok: false;
  reason: 'invalid_url' | 'redirect_blocked' | 'domain_mismatch' | 'invalid_profile';
}

export const MAX_SOCIAL_CONNECTIONS = 15;

export function isSocialConnectionPlatform(value: unknown): value is SocialConnectionPlatform {
  return typeof value === 'string' && (SOCIAL_CONNECTION_PLATFORMS as readonly string[]).includes(value);
}

function parseHttpUrl(raw: string): URL | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const parsed = new URL(withScheme);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
    if (!parsed.hostname || !parsed.hostname.includes('.')) return null;
    return parsed;
  } catch {
    return null;
  }
}

function normalizeHost(hostname: string): string {
  return hostname.toLowerCase().replace(/^www\./, '');
}

function pathSegments(pathname: string): string[] {
  return pathname.split('/').map((s) => s.trim()).filter(Boolean);
}

/**
 * Validates and canonicalizes a user-supplied profile link or handle for a given platform.
 * Blocks known redirector endpoints (e.g. `steamcommunity.com/linkfilter/`, `facebook.com/l.php`,
 * `youtube.com/redirect`, `l.instagram.com`) so users cannot disguise third-party links
 * behind a trusted platform badge.
 */
export function validateSocialConnection(
  platform: SocialConnectionPlatform,
  rawInput: string,
  customLabel?: string,
): ConnectionValidationResult | ConnectionValidationError {
  const trimmed = rawInput.trim();
  if (!trimmed || trimmed.length > 300) {
    return { ok: false, reason: 'invalid_url' };
  }

  // Reject dangerous schemes upfront
  if (/^(javascript|data|vbscript|file):/i.test(trimmed)) {
    return { ok: false, reason: 'invalid_url' };
  }

  if (platform === 'website') {
    const u = parseHttpUrl(trimmed);
    if (!u) return { ok: false, reason: 'invalid_url' };
    const cleanUrl = u.toString();
    const displayLabel = `${u.hostname}${u.pathname === '/' ? '' : u.pathname}${u.search}`.slice(0, 120);
    return {
      ok: true,
      connection: {
        platform,
        url: cleanUrl,
        displayLabel: customLabel?.trim() ? `${customLabel.trim().slice(0, 32)} (${u.hostname})` : displayLabel,
      },
    };
  }

  if (platform === 'discord') {
    // Allow either a Discord username (@handle / handle) or discord.com/users/<snowflake>
    if (!trimmed.includes('/') && !trimmed.includes('://')) {
      const handle = trimmed.replace(/^@/, '');
      if (!/^[a-z0-9._]{2,32}$/i.test(handle)) {
        return { ok: false, reason: 'invalid_profile' };
      }
      return {
        ok: true,
        connection: { platform, url: '', displayLabel: `@${handle}` },
      };
    }
    const u = parseHttpUrl(trimmed);
    if (!u) return { ok: false, reason: 'invalid_url' };
    const host = normalizeHost(u.hostname);
    if (host !== 'discord.com' && host !== 'discordapp.com') {
      return { ok: false, reason: 'domain_mismatch' };
    }
    const segs = pathSegments(u.pathname);
    if (segs[0]?.toLowerCase() !== 'users' || !segs[1] || !/^\d{15,22}$/.test(segs[1])) {
      return { ok: false, reason: 'invalid_profile' };
    }
    const label = customLabel?.trim().slice(0, 32) || segs[1];
    return {
      ok: true,
      connection: { platform, url: `https://discord.com/users/${segs[1]}`, displayLabel: label },
    };
  }

  if (platform === 'epic') {
    if (!trimmed.includes('/') && !trimmed.includes('://')) {
      if (!/^[\p{L}\p{N}._\- ]{2,32}$/u.test(trimmed)) {
        return { ok: false, reason: 'invalid_profile' };
      }
      return {
        ok: true,
        connection: { platform, url: '', displayLabel: trimmed },
      };
    }
    const u = parseHttpUrl(trimmed);
    if (!u) return { ok: false, reason: 'invalid_url' };
    const host = normalizeHost(u.hostname);
    if (host !== 'store.epicgames.com' && host !== 'epicgames.com') {
      return { ok: false, reason: 'domain_mismatch' };
    }
    const segs = pathSegments(u.pathname);
    if (segs[0]?.toLowerCase() !== 'u' || !segs[1] || !/^[a-zA-Z0-9._-]{2,64}$/.test(segs[1])) {
      return { ok: false, reason: 'invalid_profile' };
    }
    return {
      ok: true,
      connection: {
        platform,
        url: `https://store.epicgames.com/u/${encodeURIComponent(segs[1])}`,
        displayLabel: customLabel?.trim().slice(0, 32) || segs[1],
      },
    };
  }

  const u = parseHttpUrl(trimmed);
  if (!u) return { ok: false, reason: 'invalid_url' };
  const host = normalizeHost(u.hostname);
  const segs = pathSegments(u.pathname);
  const first = (segs[0] ?? '').toLowerCase();

  if (platform === 'steam') {
    if (host !== 'steamcommunity.com') return { ok: false, reason: 'domain_mismatch' };
    if (first === 'linkfilter' || u.search.length > 0) return { ok: false, reason: 'redirect_blocked' };
    if (first === 'id' && segs[1] && /^[a-zA-Z0-9_-]{2,32}$/.test(segs[1]) && segs.length === 2) {
      return {
        ok: true,
        connection: {
          platform,
          url: `https://steamcommunity.com/id/${segs[1]}/`,
          displayLabel: segs[1],
        },
      };
    }
    if (first === 'profiles' && segs[1] && /^\d{17}$/.test(segs[1]) && segs.length === 2) {
      return {
        ok: true,
        connection: {
          platform,
          url: `https://steamcommunity.com/profiles/${segs[1]}/`,
          displayLabel: customLabel?.trim().slice(0, 32) || segs[1],
        },
      };
    }
    return { ok: false, reason: 'invalid_profile' };
  }

  if (platform === 'facebook') {
    if (host === 'l.facebook.com' || host === 'lm.facebook.com') {
      return { ok: false, reason: 'redirect_blocked' };
    }
    if (host !== 'facebook.com' && host !== 'fb.com' && host !== 'm.facebook.com') {
      return { ok: false, reason: 'domain_mismatch' };
    }
    if (['l.php', 'sharer', 'sharer.php', 'login', 'login.php', 'dialog', 'share'].includes(first)) {
      return { ok: false, reason: 'redirect_blocked' };
    }
    if (first === 'profile.php') {
      const id = u.searchParams.get('id');
      if (!id || !/^\d{5,25}$/.test(id)) return { ok: false, reason: 'invalid_profile' };
      return {
        ok: true,
        connection: {
          platform,
          url: `https://www.facebook.com/profile.php?id=${id}`,
          displayLabel: customLabel?.trim().slice(0, 32) || id,
        },
      };
    }
    if (!segs[0] || !/^[a-zA-Z0-9.]{3,50}$/.test(segs[0]) || segs.length > 1) {
      return { ok: false, reason: 'invalid_profile' };
    }
    return {
      ok: true,
      connection: {
        platform,
        url: `https://www.facebook.com/${segs[0]}`,
        displayLabel: segs[0],
      },
    };
  }

  if (platform === 'instagram') {
    if (host === 'l.instagram.com') return { ok: false, reason: 'redirect_blocked' };
    if (host !== 'instagram.com') return { ok: false, reason: 'domain_mismatch' };
    if (['p', 'reel', 'reels', 'stories', 'explore', 'accounts', 'direct'].includes(first)) {
      return { ok: false, reason: 'invalid_profile' };
    }
    if (!segs[0] || !/^[a-zA-Z0-9._]{1,30}$/.test(segs[0]) || segs.length > 1) {
      return { ok: false, reason: 'invalid_profile' };
    }
    return {
      ok: true,
      connection: {
        platform,
        url: `https://www.instagram.com/${segs[0]}/`,
        displayLabel: `@${segs[0]}`,
      },
    };
  }

  if (platform === 'youtube') {
    if (host !== 'youtube.com' && host !== 'm.youtube.com') return { ok: false, reason: 'domain_mismatch' };
    if (first === 'redirect' || first === 'attribution_link') return { ok: false, reason: 'redirect_blocked' };
    if (segs[0]?.startsWith('@') && /^@[a-zA-Z0-9._-]{2,32}$/.test(segs[0]) && segs.length === 1) {
      return {
        ok: true,
        connection: {
          platform,
          url: `https://www.youtube.com/${segs[0]}`,
          displayLabel: segs[0],
        },
      };
    }
    if ((first === 'channel' || first === 'c' || first === 'user') && segs[1] && /^[a-zA-Z0-9._-]{2,64}$/.test(segs[1]) && segs.length === 2) {
      return {
        ok: true,
        connection: {
          platform,
          url: `https://www.youtube.com/${first}/${segs[1]}`,
          displayLabel: customLabel?.trim().slice(0, 32) || segs[1],
        },
      };
    }
    return { ok: false, reason: 'invalid_profile' };
  }

  if (platform === 'spotify') {
    if (host !== 'open.spotify.com') return { ok: false, reason: 'domain_mismatch' };
    if ((first === 'user' || first === 'artist') && segs[1] && /^[a-zA-Z0-9._-]{2,64}$/.test(segs[1])) {
      return {
        ok: true,
        connection: {
          platform,
          url: `https://open.spotify.com/${first}/${segs[1]}`,
          displayLabel: customLabel?.trim().slice(0, 32) || segs[1],
        },
      };
    }
    return { ok: false, reason: 'invalid_profile' };
  }

  if (platform === 'tidal') {
    if (host !== 'tidal.com' && host !== 'listen.tidal.com') return { ok: false, reason: 'domain_mismatch' };
    if (segs.length === 0) return { ok: false, reason: 'invalid_profile' };
    const tail = segs[segs.length - 1]!;
    return {
      ok: true,
      connection: {
        platform,
        url: `https://${host}/${segs.join('/')}`,
        displayLabel: customLabel?.trim().slice(0, 32) || tail,
      },
    };
  }

  if (platform === 'qobuz') {
    if (host !== 'open.qobuz.com' && host !== 'play.qobuz.com' && host !== 'qobuz.com') {
      return { ok: false, reason: 'domain_mismatch' };
    }
    if (segs.length === 0) return { ok: false, reason: 'invalid_profile' };
    const tail = segs[segs.length - 1]!;
    return {
      ok: true,
      connection: {
        platform,
        url: `https://${host}/${segs.join('/')}`,
        displayLabel: customLabel?.trim().slice(0, 32) || tail,
      },
    };
  }

  return { ok: false, reason: 'invalid_profile' };
}
