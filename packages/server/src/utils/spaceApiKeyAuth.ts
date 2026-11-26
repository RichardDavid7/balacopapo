import crypto from 'node:crypto';
import type { FastifyRequest } from 'fastify';
import { eq } from 'drizzle-orm';
import type { SpaceApiKeyScope } from '@backspace/shared';
import { getDb, schema } from '../db/index.js';
import { config } from '../config.js';

export const VALID_SPACE_API_SCOPES: readonly SpaceApiKeyScope[] = ['music', 'voice_bridge'];
const LAST_USED_THROTTLE_MS = 60_000;
const lastUsedTouchCache = new Map<string, number>();

export function hashSpaceApiKey(secret: string): string {
  return crypto.createHash('sha256').update(secret, 'utf8').digest('hex');
}

export function generateSpaceApiKey(): { secret: string; keyPrefix: string; keyHash: string } {
  const token = crypto.randomBytes(24).toString('hex');
  const secret = `bp_${token}`;
  const keyPrefix = secret.slice(0, 12);
  const keyHash = hashSpaceApiKey(secret);
  return { secret, keyPrefix, keyHash };
}

export function parseSpaceApiKeyScopes(raw: string): SpaceApiKeyScope[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return ['music'];
    const filtered = parsed.filter(
      (item): item is SpaceApiKeyScope =>
        typeof item === 'string' && (VALID_SPACE_API_SCOPES as readonly string[]).includes(item),
    );
    return filtered.length > 0 ? filtered : ['music'];
  } catch {
    return ['music'];
  }
}

export function sanitizeRequestedScopes(scopes?: unknown): SpaceApiKeyScope[] {
  if (!Array.isArray(scopes)) return ['music'];
  const unique = new Set<SpaceApiKeyScope>();
  for (const s of scopes) {
    if (typeof s === 'string' && (VALID_SPACE_API_SCOPES as readonly string[]).includes(s)) {
      unique.add(s as SpaceApiKeyScope);
    }
  }
  return unique.size > 0 ? Array.from(unique) : ['music'];
}

export function extractApiKeyFromRequest(request: FastifyRequest): string | null {
  const headerKey =
    (typeof request.headers['x-api-key'] === 'string' ? request.headers['x-api-key'].trim() : null)
    ?? (typeof request.headers['x-music-bot-key'] === 'string' ? request.headers['x-music-bot-key'].trim() : null)
    ?? (typeof request.headers['x-bot-key'] === 'string' ? request.headers['x-bot-key'].trim() : null);
  if (headerKey) return headerKey;

  const auth = typeof request.headers.authorization === 'string' ? request.headers.authorization : '';
  if (auth.startsWith('Bearer ')) {
    const token = auth.slice(7).trim();
    if (token.startsWith('bp_')) return token;
    if (config.musicBotApiKey && isGlobalMusicBotKey(token)) return token;
  }
  return null;
}

export function isGlobalMusicBotKey(secret: string): boolean {
  const configured = config.musicBotApiKey;
  if (!configured || !secret) return false;
  const expected = Buffer.from(configured, 'utf8');
  const actual = Buffer.from(secret, 'utf8');
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

export interface ResolvedSpaceApiKey {
  id: string;
  spaceId: string;
  name: string;
  scopes: SpaceApiKeyScope[];
}

export function resolveSpaceApiKey(
  secret: string,
  requiredScope?: SpaceApiKeyScope,
): ResolvedSpaceApiKey | null {
  if (!secret || !secret.startsWith('bp_')) return null;
  const keyHash = hashSpaceApiKey(secret);
  const db = getDb();
  const row = db
    .select()
    .from(schema.spaceApiKeys)
    .where(eq(schema.spaceApiKeys.keyHash, keyHash))
    .get();
  if (!row) return null;

  const scopes = parseSpaceApiKeyScopes(row.scopes);
  if (requiredScope && !scopes.includes(requiredScope)) return null;

  const now = Date.now();
  const lastTouch = lastUsedTouchCache.get(row.id) ?? 0;
  if (now - lastTouch >= LAST_USED_THROTTLE_MS) {
    lastUsedTouchCache.set(row.id, now);
    db.update(schema.spaceApiKeys)
      .set({ lastUsedAt: now })
      .where(eq(schema.spaceApiKeys.id, row.id))
      .run();
  }

  return {
    id: row.id,
    spaceId: row.spaceId,
    name: row.name,
    scopes,
  };
}
