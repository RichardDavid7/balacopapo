import crypto from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { eq } from 'drizzle-orm';
import { AccessToken, TrackSource } from 'livekit-server-sdk';
import type { MusicControlRequest, MusicQueueAddRequest, MusicSettingsRequest } from '@backspace/shared';
import { getDb, schema } from '../db/index.js';
import { config } from '../config.js';
import { authenticate } from '../utils/auth.js';
import { hasPermission, PermissionBits } from '../utils/permissions.js';
import { sendError } from '../utils/httpErrors.js';
import { connectionManager } from '../ws/handler.js';
import {
  applyBotStateReport,
  applyMusicControl,
  drainBotCommands,
  enqueueMusicTrack,
  getMusicState,
  toggleVoteSkip,
  updateMusicSettings,
} from '../utils/musicState.js';

function countVoiceListeners(channelId: string): number {
  const room = connectionManager.getRoom(channelId);
  return Math.max(1, room?.participants.size ?? 0);
}

function isValidBotApiKey(request: FastifyRequest): boolean {
  const configured = config.musicBotApiKey;
  if (!configured) return false;
  const headerKey =
    (typeof request.headers['x-music-bot-key'] === 'string' ? request.headers['x-music-bot-key'] : null)
    ?? (typeof request.headers['x-bot-key'] === 'string' ? request.headers['x-bot-key'] : null)
    ?? (typeof request.headers.authorization === 'string' && request.headers.authorization.startsWith('Bearer ')
      ? request.headers.authorization.slice(7).trim()
      : null);
  if (!headerKey) return false;
  const expected = Buffer.from(configured, 'utf8');
  const actual = Buffer.from(headerKey, 'utf8');
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

async function authenticateBotOrAdmin(request: FastifyRequest, reply: import('fastify').FastifyReply): Promise<void> {
  if (isValidBotApiKey(request)) return;
  await authenticate(request, reply);
  if (reply.sent) return;
  const db = getDb();
  const user = db.select({ isAdmin: schema.users.isAdmin }).from(schema.users).where(eq(schema.users.id, request.userId)).get();
  if (!user || user.isAdmin !== 1) {
    return sendError(reply, 403, 'forbidden');
  }
}

export async function musicRoutes(app: FastifyInstance): Promise<void> {
  // ─── User-Facing Music Endpoints ─────────────────────────────────────────

  app.get<{ Params: { channelId: string } }>(
    '/api/channels/:channelId/music',
    { preHandler: authenticate },
    async (request, reply) => {
      const { channelId } = request.params;
      const db = getDb();
      const channel = db.select().from(schema.channels).where(eq(schema.channels.id, channelId)).get();
      if (!channel || channel.type !== 'voice') {
        return sendError(reply, 404, 'channel_not_found');
      }
      if (!hasPermission(request.userId, channel.spaceId, PermissionBits.VIEW_CHANNEL, channel.id)) {
        return sendError(reply, 403, 'missing_permission', { permission: 'VIEW_CHANNEL' });
      }
      return reply.code(200).send(getMusicState(channelId, countVoiceListeners(channelId)));
    },
  );

  app.post<{ Params: { channelId: string }; Body: MusicQueueAddRequest }>(
    '/api/channels/:channelId/music/queue',
    { preHandler: authenticate },
    async (request, reply) => {
      const { channelId } = request.params;
      const { url, title, artist, source, durationSec, thumbnailUrl } = request.body ?? {};
      if (!url || typeof url !== 'string' || !url.trim()) {
        return sendError(reply, 400, 'validation_failed');
      }

      const db = getDb();
      const channel = db.select().from(schema.channels).where(eq(schema.channels.id, channelId)).get();
      if (!channel || channel.type !== 'voice') {
        return sendError(reply, 404, 'channel_not_found');
      }
      if (!hasPermission(request.userId, channel.spaceId, PermissionBits.CONNECT, channel.id)) {
        return sendError(reply, 403, 'missing_permission', { permission: 'CONNECT' });
      }

      const user = db.select({ displayName: schema.users.displayName, username: schema.users.username })
        .from(schema.users)
        .where(eq(schema.users.id, request.userId))
        .get();

      const state = enqueueMusicTrack(
        channelId,
        {
          url,
          title,
          artist,
          source,
          durationSec,
          thumbnailUrl,
          requestedByUserId: request.userId,
          requestedByName: user?.displayName || user?.username || 'User',
        },
        countVoiceListeners(channelId),
      );

      connectionManager.sendToSpace(channel.spaceId, { type: 'music_state_updated', state });
      return reply.code(200).send(state);
    },
  );

  app.post<{ Params: { channelId: string } }>(
    '/api/channels/:channelId/music/vote-skip',
    { preHandler: authenticate },
    async (request, reply) => {
      const { channelId } = request.params;
      const db = getDb();
      const channel = db.select().from(schema.channels).where(eq(schema.channels.id, channelId)).get();
      if (!channel || channel.type !== 'voice') {
        return sendError(reply, 404, 'channel_not_found');
      }
      if (!hasPermission(request.userId, channel.spaceId, PermissionBits.CONNECT, channel.id)) {
        return sendError(reply, 403, 'missing_permission', { permission: 'CONNECT' });
      }

      const result = toggleVoteSkip(channelId, request.userId, countVoiceListeners(channelId));
      connectionManager.sendToSpace(channel.spaceId, { type: 'music_state_updated', state: result.state });
      return reply.code(200).send(result);
    },
  );

  app.post<{ Params: { channelId: string }; Body: MusicControlRequest }>(
    '/api/channels/:channelId/music/control',
    { preHandler: authenticate },
    async (request, reply) => {
      const { channelId } = request.params;
      const { action, value } = request.body ?? {};
      if (!action) {
        return sendError(reply, 400, 'validation_failed');
      }

      const db = getDb();
      const channel = db.select().from(schema.channels).where(eq(schema.channels.id, channelId)).get();
      if (!channel || channel.type !== 'voice') {
        return sendError(reply, 404, 'channel_not_found');
      }
      if (!hasPermission(request.userId, channel.spaceId, PermissionBits.CONNECT, channel.id)) {
        return sendError(reply, 403, 'missing_permission', { permission: 'CONNECT' });
      }

      // Force-skip / stop / clear require MANAGE_CHANNELS when > 1 listener is present
      const listeners = countVoiceListeners(channelId);
      if ((action === 'skip' || action === 'stop' || action === 'queue_clear') && listeners > 1) {
        if (!hasPermission(request.userId, channel.spaceId, PermissionBits.MANAGE_CHANNELS, channel.id)) {
          return sendError(reply, 403, 'missing_permission', { permission: 'MANAGE_CHANNELS' });
        }
      }

      const state = applyMusicControl(channelId, request.userId, action, value, listeners);
      connectionManager.sendToSpace(channel.spaceId, { type: 'music_state_updated', state });
      return reply.code(200).send(state);
    },
  );

  app.patch<{ Params: { channelId: string }; Body: MusicSettingsRequest }>(
    '/api/channels/:channelId/music/settings',
    { preHandler: authenticate },
    async (request, reply) => {
      const { channelId } = request.params;
      const { voteSkipThresholdPct } = request.body ?? {};
      if (typeof voteSkipThresholdPct !== 'number' || !Number.isFinite(voteSkipThresholdPct)) {
        return sendError(reply, 400, 'validation_failed');
      }

      const db = getDb();
      const channel = db.select().from(schema.channels).where(eq(schema.channels.id, channelId)).get();
      if (!channel || channel.type !== 'voice') {
        return sendError(reply, 404, 'channel_not_found');
      }
      if (!hasPermission(request.userId, channel.spaceId, PermissionBits.MANAGE_CHANNELS, channel.id)) {
        return sendError(reply, 403, 'missing_permission', { permission: 'MANAGE_CHANNELS' });
      }

      const result = updateMusicSettings(channelId, voteSkipThresholdPct, request.userId, countVoiceListeners(channelId));
      connectionManager.sendToSpace(channel.spaceId, { type: 'music_state_updated', state: result.state });
      return reply.code(200).send(result.state);
    },
  );

  // ─── Companion Bot API ("Balacopapo Utilidades") ─────────────────────────

  app.post<{ Params: { channelId: string }; Body: Record<string, unknown> }>(
    '/api/music/bot/:channelId/state',
    { preHandler: authenticateBotOrAdmin },
    async (request, reply) => {
      const { channelId } = request.params;
      const db = getDb();
      const channel = db.select().from(schema.channels).where(eq(schema.channels.id, channelId)).get();
      if (!channel || channel.type !== 'voice') {
        return sendError(reply, 404, 'channel_not_found');
      }

      const state = applyBotStateReport(channelId, request.body ?? {}, countVoiceListeners(channelId));
      connectionManager.sendToSpace(channel.spaceId, { type: 'music_state_updated', state });
      return reply.code(200).send(state);
    },
  );

  app.get<{ Params: { channelId: string } }>(
    '/api/music/bot/:channelId/commands',
    { preHandler: authenticateBotOrAdmin },
    async (request, reply) => {
      const { channelId } = request.params;
      return reply.code(200).send({ commands: drainBotCommands(channelId) });
    },
  );

  app.post<{ Params: { channelId: string }; Body: { botName?: string } }>(
    '/api/music/bot/:channelId/livekit-token',
    { preHandler: authenticateBotOrAdmin },
    async (request, reply) => {
      const { channelId } = request.params;
      if (!config.livekit.apiKey || !config.livekit.apiSecret || !config.livekit.url) {
        return sendError(reply, 503, 'voice_disabled');
      }
      const db = getDb();
      const channel = db.select().from(schema.channels).where(eq(schema.channels.id, channelId)).get();
      if (!channel || channel.type !== 'voice') {
        return sendError(reply, 404, 'channel_not_found');
      }

      const botName = (request.body?.botName?.trim() || 'Balacopapo Música').slice(0, 48);
      const token = new AccessToken(config.livekit.apiKey, config.livekit.apiSecret, {
        identity: `bot-music:${channelId}`,
        name: botName,
        ttl: '6h',
      });
      token.addGrant({
        room: `voice:${channelId}`,
        roomJoin: true,
        canPublish: true,
        canSubscribe: false,
        canPublishData: true,
        canPublishSources: [TrackSource.MICROPHONE],
      });

      return reply.code(200).send({
        token: await token.toJwt(),
        url: config.livekit.url,
        room: `voice:${channelId}`,
      });
    },
  );
}
