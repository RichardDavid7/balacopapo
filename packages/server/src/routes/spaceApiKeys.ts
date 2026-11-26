import crypto from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { and, desc, eq } from 'drizzle-orm';
import { AccessToken, TrackSource } from 'livekit-server-sdk';
import type {
  CreateSpaceApiKeyRequest,
  CreateSpaceApiKeyResponse,
  SpaceApiKeySummary,
  SpaceBotInfoResponse,
} from '@backspace/shared';
import { getDb, schema } from '../db/index.js';
import { config } from '../config.js';
import { authenticate } from '../utils/auth.js';
import { hasPermission, PermissionBits } from '../utils/permissions.js';
import { sendError } from '../utils/httpErrors.js';
import {
  extractApiKeyFromRequest,
  generateSpaceApiKey,
  parseSpaceApiKeyScopes,
  resolveSpaceApiKey,
  sanitizeRequestedScopes,
} from '../utils/spaceApiKeyAuth.js';

const MAX_KEYS_PER_SPACE = 25;

function toSummary(row: typeof schema.spaceApiKeys.$inferSelect): SpaceApiKeySummary {
  return {
    id: row.id,
    spaceId: row.spaceId,
    name: row.name,
    keyPrefix: row.keyPrefix,
    scopes: parseSpaceApiKeyScopes(row.scopes),
    createdBy: row.createdBy ?? null,
    lastUsedAt: row.lastUsedAt ?? null,
    createdAt: row.createdAt,
  };
}

export async function spaceApiKeyRoutes(app: FastifyInstance): Promise<void> {
  // ─── Space Management Endpoints (Space Settings → API & Apps) ────────────

  app.get<{ Params: { spaceId: string } }>(
    '/api/spaces/:spaceId/api-keys',
    { preHandler: authenticate },
    async (request, reply) => {
      const { spaceId } = request.params;
      if (!hasPermission(request.userId, spaceId, PermissionBits.MANAGE_SPACE)) {
        return sendError(reply, 403, 'missing_permission', { permission: 'MANAGE_SPACE' });
      }
      const db = getDb();
      const rows = db
        .select()
        .from(schema.spaceApiKeys)
        .where(eq(schema.spaceApiKeys.spaceId, spaceId))
        .orderBy(desc(schema.spaceApiKeys.createdAt))
        .all();

      return reply.code(200).send({ apiKeys: rows.map(toSummary) });
    },
  );

  app.post<{ Params: { spaceId: string }; Body: CreateSpaceApiKeyRequest }>(
    '/api/spaces/:spaceId/api-keys',
    { preHandler: authenticate },
    async (request, reply) => {
      const { spaceId } = request.params;
      if (!hasPermission(request.userId, spaceId, PermissionBits.MANAGE_SPACE)) {
        return sendError(reply, 403, 'missing_permission', { permission: 'MANAGE_SPACE' });
      }

      const name = typeof request.body?.name === 'string' ? request.body.name.trim() : '';
      if (!name || name.length > 64) {
        return sendError(reply, 400, 'validation_failed');
      }

      const db = getDb();
      const space = db.select({ id: schema.spaces.id }).from(schema.spaces).where(eq(schema.spaces.id, spaceId)).get();
      if (!space) {
        return sendError(reply, 404, 'space_not_found');
      }

      const existing = db
        .select({ id: schema.spaceApiKeys.id })
        .from(schema.spaceApiKeys)
        .where(eq(schema.spaceApiKeys.spaceId, spaceId))
        .all();
      if (existing.length >= MAX_KEYS_PER_SPACE) {
        return sendError(reply, 400, 'validation_failed');
      }

      const scopes = sanitizeRequestedScopes(request.body?.scopes);
      const { secret, keyPrefix, keyHash } = generateSpaceApiKey();
      const now = Date.now();
      const id = crypto.randomUUID();

      db.insert(schema.spaceApiKeys).values({
        id,
        spaceId,
        name,
        keyPrefix,
        keyHash,
        scopes: JSON.stringify(scopes),
        createdBy: request.userId,
        lastUsedAt: null,
        createdAt: now,
      }).run();

      const response: CreateSpaceApiKeyResponse = {
        apiKey: {
          id,
          spaceId,
          name,
          keyPrefix,
          scopes,
          createdBy: request.userId,
          lastUsedAt: null,
          createdAt: now,
        },
        secret,
      };
      return reply.code(201).send(response);
    },
  );

  app.delete<{ Params: { spaceId: string; keyId: string } }>(
    '/api/spaces/:spaceId/api-keys/:keyId',
    { preHandler: authenticate },
    async (request, reply) => {
      const { spaceId, keyId } = request.params;
      if (!hasPermission(request.userId, spaceId, PermissionBits.MANAGE_SPACE)) {
        return sendError(reply, 403, 'missing_permission', { permission: 'MANAGE_SPACE' });
      }

      const db = getDb();
      const deleted = db
        .delete(schema.spaceApiKeys)
        .where(and(eq(schema.spaceApiKeys.id, keyId), eq(schema.spaceApiKeys.spaceId, spaceId)))
        .returning({ id: schema.spaceApiKeys.id })
        .get();

      if (!deleted) {
        return sendError(reply, 404, 'not_found');
      }
      return reply.code(200).send({ success: true });
    },
  );

  // ─── Companion App Discovery Endpoint (Balacopapo Utilidades) ────────────

  app.get('/api/spaces/bot/info', async (request, reply) => {
    const secret = extractApiKeyFromRequest(request);
    const resolved = secret ? resolveSpaceApiKey(secret) : null;
    if (!resolved) {
      return sendError(reply, 401, 'unauthorized');
    }

    const db = getDb();
    const space = db
      .select({ id: schema.spaces.id, name: schema.spaces.name })
      .from(schema.spaces)
      .where(eq(schema.spaces.id, resolved.spaceId))
      .get();
    if (!space) {
      return sendError(reply, 404, 'space_not_found');
    }

    const voiceChannels = db
      .select({ id: schema.channels.id, name: schema.channels.name })
      .from(schema.channels)
      .where(and(eq(schema.channels.spaceId, resolved.spaceId), eq(schema.channels.type, 'voice')))
      .all();

    const payload: SpaceBotInfoResponse = {
      space,
      key: {
        id: resolved.id,
        name: resolved.name,
        scopes: resolved.scopes,
      },
      voiceChannels,
    };
    return reply.code(200).send(payload);
  });

  app.post<{ Params: { channelId: string }; Body: { botName?: string } }>(
    '/api/spaces/bot/:channelId/livekit-token',
    async (request, reply) => {
      const secret = extractApiKeyFromRequest(request);
      const resolved = secret ? resolveSpaceApiKey(secret) : null;
      if (!resolved) {
        return sendError(reply, 401, 'unauthorized');
      }
      if (!config.livekit.apiKey || !config.livekit.apiSecret || !config.livekit.url) {
        return sendError(reply, 503, 'voice_disabled');
      }

      const { channelId } = request.params;
      const db = getDb();
      const channel = db.select().from(schema.channels).where(eq(schema.channels.id, channelId)).get();
      if (!channel || channel.type !== 'voice') {
        return sendError(reply, 404, 'channel_not_found');
      }
      if (channel.spaceId !== resolved.spaceId) {
        return sendError(reply, 403, 'forbidden');
      }

      const canBridge = resolved.scopes.includes('voice_bridge');
      const botName = (request.body?.botName?.trim() || resolved.name || 'Balacopapo App').slice(0, 48);
      const token = new AccessToken(config.livekit.apiKey, config.livekit.apiSecret, {
        identity: `bot-app:${resolved.id}:${channelId}`,
        name: botName,
        ttl: '6h',
      });
      token.addGrant({
        room: channelId,
        roomJoin: true,
        canPublish: true,
        canSubscribe: canBridge,
        canPublishData: true,
        canPublishSources: [TrackSource.MICROPHONE],
      });

      return reply.code(200).send({
        token: await token.toJwt(),
        url: config.livekit.url,
        room: channelId,
        scopes: resolved.scopes,
      });
    },
  );
}
