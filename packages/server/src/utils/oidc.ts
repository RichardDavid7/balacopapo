import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { config } from '../config.js';
import { deleteUploadFile } from './fileCleanup.js';

export interface OidcDiscoveryDoc {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  userinfo_endpoint?: string;
  jwks_uri: string;
}

export interface OidcClaims {
  sub: string;
  iss?: string;
  aud?: string | string[];
  exp?: number;
  nonce?: string;
  email?: string;
  preferred_username?: string;
  nickname?: string;
  name?: string;
  picture?: string;
  groups?: unknown;
  roles?: unknown;
  [key: string]: unknown;
}

interface PendingAuthState {
  codeVerifier: string;
  nonce: string;
  redirect: string;
  client: 'web' | 'desktop' | 'mobile';
  linkUserId: string | null;
  expiresAt: number;
}

interface PendingLinkToken {
  userId: string;
  expiresAt: number;
}

interface PendingLoginTicket {
  userId: string;
  expiresAt: number;
}

interface CachedDiscovery {
  doc: OidcDiscoveryDoc;
  expiresAt: number;
}

interface CachedJwks {
  keys: crypto.JsonWebKey[];
  expiresAt: number;
}

const DISCOVERY_TTL_MS = 15 * 60 * 1000;
const JWKS_TTL_MS = 15 * 60 * 1000;
const AUTH_STATE_TTL_MS = 5 * 60 * 1000;
const LINK_TOKEN_TTL_MS = 15 * 60 * 1000;
const LOGIN_TICKET_TTL_MS = 60 * 1000;
const MAX_AVATAR_BYTES = 5 * 1024 * 1024;

const discoveryCache = new Map<string, CachedDiscovery>();
const jwksCache = new Map<string, CachedJwks>();
const pendingStates = new Map<string, PendingAuthState>();
const pendingLinkTokens = new Map<string, PendingLinkToken>();
const pendingLoginTickets = new Map<string, PendingLoginTicket>();

export function normalizeIssuer(url: string): string {
  return url.trim().replace(/\/+$/, '');
}

export function isOidcConfigured(): boolean {
  return Boolean(config.oidc.enabled && config.oidc.issuerUrl && config.oidc.clientId);
}

export function resolvePublicBaseOrigin(requestOrigin?: string): string {
  if (config.publicOrigin) return config.publicOrigin.replace(/\/+$/, '');
  if (config.domain) return `https://${config.domain.replace(/\/+$/, '')}`;
  if (requestOrigin && /^https?:\/\//i.test(requestOrigin)) {
    return requestOrigin.replace(/\/+$/, '');
  }
  return `http://localhost:${config.port}`;
}

export function resolveOidcRedirectUri(requestOrigin?: string): string {
  if (config.oidc.redirectUri) return config.oidc.redirectUri;
  return `${resolvePublicBaseOrigin(requestOrigin)}/api/auth/oidc/callback`;
}

function sweepExpired(): void {
  const now = Date.now();
  for (const [k, v] of pendingStates) {
    if (v.expiresAt <= now) pendingStates.delete(k);
  }
  for (const [k, v] of pendingLinkTokens) {
    if (v.expiresAt <= now) pendingLinkTokens.delete(k);
  }
  for (const [k, v] of pendingLoginTickets) {
    if (v.expiresAt <= now) pendingLoginTickets.delete(k);
  }
}

export function createOidcAuthState(opts: {
  redirect?: string;
  client?: 'web' | 'desktop' | 'mobile';
  linkUserId?: string | null;
}): { state: string; nonce: string; codeChallenge: string } {
  sweepExpired();
  const state = crypto.randomBytes(24).toString('base64url');
  const nonce = crypto.randomBytes(24).toString('base64url');
  const codeVerifier = crypto.randomBytes(32).toString('base64url');
  const codeChallenge = crypto.createHash('sha256').update(codeVerifier).digest('base64url');
  const safeRedirect = opts.redirect && opts.redirect.startsWith('/') && !opts.redirect.startsWith('//')
    ? opts.redirect
    : '/channels/@me';

  pendingStates.set(state, {
    codeVerifier,
    nonce,
    redirect: safeRedirect,
    client: opts.client ?? 'web',
    linkUserId: opts.linkUserId ?? null,
    expiresAt: Date.now() + AUTH_STATE_TTL_MS,
  });

  return { state, nonce, codeChallenge };
}

export function consumeOidcAuthState(state: string): PendingAuthState | null {
  sweepExpired();
  const entry = pendingStates.get(state);
  if (!entry) return null;
  pendingStates.delete(state);
  if (entry.expiresAt <= Date.now()) return null;
  return entry;
}

export function createAdminOidcLinkToken(userId: string): { token: string; expiresAt: number } {
  sweepExpired();
  const token = crypto.randomBytes(24).toString('base64url');
  const expiresAt = Date.now() + LINK_TOKEN_TTL_MS;
  pendingLinkTokens.set(token, { userId, expiresAt });
  return { token, expiresAt };
}

export function consumeAdminOidcLinkToken(token: string): string | null {
  sweepExpired();
  const entry = pendingLinkTokens.get(token);
  if (!entry) return null;
  pendingLinkTokens.delete(token);
  if (entry.expiresAt <= Date.now()) return null;
  return entry.userId;
}

export function createOidcLoginTicket(userId: string): string {
  sweepExpired();
  const ticket = crypto.randomBytes(32).toString('base64url');
  pendingLoginTickets.set(ticket, {
    userId,
    expiresAt: Date.now() + LOGIN_TICKET_TTL_MS,
  });
  return ticket;
}

export function consumeOidcLoginTicket(ticket: string): string | null {
  sweepExpired();
  const entry = pendingLoginTickets.get(ticket);
  if (!entry) return null;
  pendingLoginTickets.delete(ticket);
  if (entry.expiresAt <= Date.now()) return null;
  return entry.userId;
}

export async function fetchOidcDiscovery(issuerUrl: string): Promise<OidcDiscoveryDoc> {
  const normalized = normalizeIssuer(issuerUrl);
  const cached = discoveryCache.get(normalized);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.doc;
  }

  const discoveryUrl = `${normalized}/.well-known/openid-configuration`;
  const res = await fetch(discoveryUrl, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) {
    throw new Error(`OIDC discovery failed (${res.status}) at ${discoveryUrl}`);
  }
  const doc = (await res.json()) as Partial<OidcDiscoveryDoc>;
  if (!doc.authorization_endpoint || !doc.token_endpoint || !doc.jwks_uri) {
    throw new Error('OIDC discovery document is missing required endpoints');
  }

  const fullDoc: OidcDiscoveryDoc = {
    issuer: doc.issuer ? normalizeIssuer(doc.issuer) : normalized,
    authorization_endpoint: doc.authorization_endpoint,
    token_endpoint: doc.token_endpoint,
    userinfo_endpoint: doc.userinfo_endpoint,
    jwks_uri: doc.jwks_uri,
  };
  discoveryCache.set(normalized, { doc: fullDoc, expiresAt: Date.now() + DISCOVERY_TTL_MS });
  return fullDoc;
}

async function fetchJwks(jwksUri: string, forceRefresh = false): Promise<crypto.JsonWebKey[]> {
  const cached = jwksCache.get(jwksUri);
  if (!forceRefresh && cached && cached.expiresAt > Date.now()) {
    return cached.keys;
  }
  const res = await fetch(jwksUri, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) {
    throw new Error(`Failed to fetch OIDC JWKS (${res.status})`);
  }
  const body = (await res.json()) as { keys?: crypto.JsonWebKey[] };
  const keys = Array.isArray(body.keys) ? body.keys : [];
  jwksCache.set(jwksUri, { keys, expiresAt: Date.now() + JWKS_TTL_MS });
  return keys;
}

function decodeBase64UrlJson<T>(segment: string): T {
  const buf = Buffer.from(segment, 'base64url');
  return JSON.parse(buf.toString('utf8')) as T;
}

function verifyJwtSignatureWithJwk(
  signingInput: string,
  signature: Buffer,
  alg: string,
  jwk: crypto.JsonWebKey,
): boolean {
  const publicKey = crypto.createPublicKey({ key: jwk, format: 'jwk' });
  switch (alg) {
    case 'RS256':
      return crypto.verify('RSA-SHA256', Buffer.from(signingInput), publicKey, signature);
    case 'RS384':
      return crypto.verify('RSA-SHA384', Buffer.from(signingInput), publicKey, signature);
    case 'RS512':
      return crypto.verify('RSA-SHA512', Buffer.from(signingInput), publicKey, signature);
    case 'PS256':
      return crypto.verify('RSA-SHA256', Buffer.from(signingInput), {
        key: publicKey,
        padding: crypto.constants.RSA_PKCS1_PSS_PADDING,
        saltLength: 32,
      }, signature);
    case 'PS384':
      return crypto.verify('RSA-SHA384', Buffer.from(signingInput), {
        key: publicKey,
        padding: crypto.constants.RSA_PKCS1_PSS_PADDING,
        saltLength: 48,
      }, signature);
    case 'PS512':
      return crypto.verify('RSA-SHA512', Buffer.from(signingInput), {
        key: publicKey,
        padding: crypto.constants.RSA_PKCS1_PSS_PADDING,
        saltLength: 64,
      }, signature);
    case 'ES256':
      return crypto.verify('SHA256', Buffer.from(signingInput), { key: publicKey, dsaEncoding: 'ieee-p1363' }, signature);
    case 'ES384':
      return crypto.verify('SHA384', Buffer.from(signingInput), { key: publicKey, dsaEncoding: 'ieee-p1363' }, signature);
    case 'ES512':
      return crypto.verify('SHA512', Buffer.from(signingInput), { key: publicKey, dsaEncoding: 'ieee-p1363' }, signature);
    default:
      return false;
  }
}

export async function verifyIdToken(
  idToken: string,
  opts: { issuer: string; clientId: string; nonce: string; jwksUri: string },
): Promise<OidcClaims> {
  const parts = idToken.split('.');
  if (parts.length !== 3) {
    throw new Error('Malformed OIDC id_token');
  }
  const [headerSeg, payloadSeg, sigSeg] = parts as [string, string, string];
  const header = decodeBase64UrlJson<{ alg?: string; kid?: string }>(headerSeg);
  const payload = decodeBase64UrlJson<OidcClaims>(payloadSeg);
  const alg = header.alg ?? '';
  if (!alg || alg === 'none') {
    throw new Error('Unsupported OIDC id_token algorithm');
  }

  const signingInput = `${headerSeg}.${payloadSeg}`;
  const signature = Buffer.from(sigSeg, 'base64url');

  const tryVerify = (keys: crypto.JsonWebKey[]): boolean => {
    const candidates = header.kid
      ? keys.filter((k) => (k as { kid?: string }).kid === header.kid)
      : keys;
    for (const jwk of candidates) {
      try {
        if (verifyJwtSignatureWithJwk(signingInput, signature, alg, jwk)) {
          return true;
        }
      } catch {
        // Try next candidate key
      }
    }
    return false;
  };

  let keys = await fetchJwks(opts.jwksUri, false);
  let verified = tryVerify(keys);
  if (!verified) {
    keys = await fetchJwks(opts.jwksUri, true);
    verified = tryVerify(keys);
  }
  if (!verified) {
    throw new Error('OIDC id_token signature verification failed');
  }

  const expectedIssuer = normalizeIssuer(opts.issuer);
  const tokenIssuer = payload.iss ? normalizeIssuer(payload.iss) : '';
  if (!tokenIssuer || tokenIssuer !== expectedIssuer) {
    throw new Error(`OIDC issuer mismatch: expected ${expectedIssuer}, got ${tokenIssuer}`);
  }

  const audList = Array.isArray(payload.aud) ? payload.aud : (payload.aud ? [payload.aud] : []);
  if (!audList.includes(opts.clientId)) {
    throw new Error('OIDC audience mismatch');
  }

  const nowSec = Math.floor(Date.now() / 1000);
  if (typeof payload.exp !== 'number' || payload.exp + 60 < nowSec) {
    throw new Error('OIDC id_token expired');
  }

  if (payload.nonce !== opts.nonce) {
    throw new Error('OIDC nonce mismatch');
  }

  if (!payload.sub || typeof payload.sub !== 'string') {
    throw new Error('OIDC id_token missing sub claim');
  }

  return payload;
}

export function extractOidcGroups(claims: Record<string, unknown>, primaryClaim: string): string[] {
  const candidates = [primaryClaim, 'groups', 'roles'];
  const collected = new Set<string>();

  for (const key of candidates) {
    const raw = claims[key];
    if (Array.isArray(raw)) {
      for (const item of raw) {
        if (typeof item === 'string' && item.trim()) {
          collected.add(item.trim());
        }
      }
    } else if (typeof raw === 'string' && raw.trim()) {
      for (const part of raw.split(/[,\s]+/)) {
        if (part.trim()) collected.add(part.trim());
      }
    }
  }

  return Array.from(collected);
}

export function matchesAdminGroups(userGroups: string[], adminGroups: readonly string[]): boolean {
  if (adminGroups.length === 0 || userGroups.length === 0) return false;
  const adminSet = new Set(adminGroups.map((g) => g.trim().toLowerCase()).filter(Boolean));
  return userGroups.some((g) => adminSet.has(g.trim().toLowerCase()));
}

export function sanitizeOidcUsername(raw: string): string {
  const cleaned = raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 26);
  if (cleaned.length >= 3) return cleaned;
  return `user_${cleaned || 'oidc'}`.slice(0, 26);
}

export async function syncOidcAvatar(opts: {
  userId: string;
  pictureUrl: string | undefined;
  currentAvatar: string | null;
  lastSourceUrl: string | null;
}): Promise<{ avatar: string | null; lastAvatarSourceUrl: string | null; updated: boolean }> {
  const { userId, pictureUrl, currentAvatar, lastSourceUrl } = opts;
  if (!config.oidc.syncAvatar || !pictureUrl || typeof pictureUrl !== 'string') {
    return { avatar: currentAvatar, lastAvatarSourceUrl: lastSourceUrl, updated: false };
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(pictureUrl);
  } catch {
    return { avatar: currentAvatar, lastAvatarSourceUrl: lastSourceUrl, updated: false };
  }
  if (parsedUrl.protocol !== 'https:' && parsedUrl.protocol !== 'http:') {
    return { avatar: currentAvatar, lastAvatarSourceUrl: lastSourceUrl, updated: false };
  }

  // Skip re-downloading if the source URL hasn't changed and the local file still exists.
  if (lastSourceUrl === pictureUrl && currentAvatar && currentAvatar.startsWith('/api/uploads/')) {
    const existingName = path.basename(currentAvatar);
    if (fs.existsSync(path.join(config.uploadDir, existingName))) {
      return { avatar: currentAvatar, lastAvatarSourceUrl: lastSourceUrl, updated: false };
    }
  }

  try {
    const res = await fetch(parsedUrl.toString(), {
      signal: AbortSignal.timeout(6000),
      redirect: 'follow',
    });
    if (!res.ok) {
      return { avatar: currentAvatar, lastAvatarSourceUrl: lastSourceUrl, updated: false };
    }
    const contentType = res.headers.get('content-type') ?? '';
    if (!contentType.toLowerCase().startsWith('image/')) {
      return { avatar: currentAvatar, lastAvatarSourceUrl: lastSourceUrl, updated: false };
    }
    const contentLength = Number(res.headers.get('content-length') ?? '0');
    if (contentLength > MAX_AVATAR_BYTES) {
      return { avatar: currentAvatar, lastAvatarSourceUrl: lastSourceUrl, updated: false };
    }

    const arrayBuf = await res.arrayBuffer();
    if (arrayBuf.byteLength === 0 || arrayBuf.byteLength > MAX_AVATAR_BYTES) {
      return { avatar: currentAvatar, lastAvatarSourceUrl: lastSourceUrl, updated: false };
    }

    const webpBuffer = await sharp(Buffer.from(arrayBuf))
      .resize(256, 256, { fit: 'cover', withoutEnlargement: true })
      .webp({ quality: 86 })
      .toBuffer();

    if (!fs.existsSync(config.uploadDir)) {
      fs.mkdirSync(config.uploadDir, { recursive: true });
    }

    const hash = crypto.createHash('sha256').update(webpBuffer).digest('hex').slice(0, 12);
    const filename = `oidc-avatar-${userId}-${hash}.webp`;
    const filepath = path.join(config.uploadDir, filename);
    fs.writeFileSync(filepath, webpBuffer);

    const nextAvatarUrl = `/api/uploads/${filename}`;
    if (currentAvatar && currentAvatar !== nextAvatarUrl && currentAvatar.startsWith('/api/uploads/oidc-avatar-')) {
      deleteUploadFile(path.basename(currentAvatar));
    }

    return {
      avatar: nextAvatarUrl,
      lastAvatarSourceUrl: pictureUrl,
      updated: nextAvatarUrl !== currentAvatar,
    };
  } catch (err) {
    console.warn('[OIDC] Avatar sync failed (continuing login):', err);
    return { avatar: currentAvatar, lastAvatarSourceUrl: lastSourceUrl, updated: false };
  }
}
