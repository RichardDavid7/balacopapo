import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import type { AdminLastFmConfigResponse, AdminLastFmUpdateRequest } from '@backspace/shared';
import { getDb, schema } from '../db/index.js';
import { authenticate, requireAdmin } from '../utils/auth.js';
import { sendError } from '../utils/httpErrors.js';
import {
  clearLastFmCache,
  getLastFmNowPlaying,
  maskLastFmApiKey,
  resolveLastFmApiKey,
} from '../services/lastfm.js';

export async function lastfmRoutes(app: FastifyInstance): Promise<void> {
  // ─── User Now Playing (cached 25s on server) ─────────────────────────────
  app.get<{ Params: { userId: string } }>(
    '/api/users/:userId/lastfm',
    { preHandler: authenticate },
    async (request, reply) => {
      const { userId } = request.params;
      const db = getDb();
      const target = db
        .select({
          id: schema.users.id,
          isDeleted: schema.users.isDeleted,
          lastfmUsername: schema.users.lastfmUsername,
          lastfmShowNowPlaying: schema.users.lastfmShowNowPlaying,
        })
        .from(schema.users)
        .where(eq(schema.users.id, userId))
        .get();

      if (!target || target.isDeleted === 1) {
        return sendError(reply, 404, 'user_not_found');
      }

      const data = await getLastFmNowPlaying(
        target.lastfmUsername ?? null,
        target.lastfmShowNowPlaying !== 0,
      );
      return reply.code(200).send(data);
    },
  );

  // ─── Admin Instance Last.fm API Key Management ───────────────────────────
  app.get(
    '/api/admin/lastfm',
    { preHandler: [authenticate, requireAdmin] },
    async (_request, reply) => {
      const { key, source } = resolveLastFmApiKey();
      const response: AdminLastFmConfigResponse = {
        configured: Boolean(key),
        source,
        keyPreview: maskLastFmApiKey(key),
      };
      return reply.code(200).send(response);
    },
  );

  app.patch<{ Body: AdminLastFmUpdateRequest }>(
    '/api/admin/lastfm',
    { preHandler: [authenticate, requireAdmin] },
    async (request, reply) => {
      const raw = request.body?.apiKey;
      let nextKey: string | null = null;
      if (raw !== null && raw !== undefined) {
        if (typeof raw !== 'string') {
          return sendError(reply, 400, 'validation_failed');
        }
        const trimmed = raw.trim();
        if (trimmed.length > 128) {
          return sendError(reply, 400, 'validation_failed');
        }
        nextKey = trimmed.length > 0 ? trimmed : null;
      }

      const db = getDb();
      db.update(schema.instanceSettings)
        .set({ lastfmApiKey: nextKey })
        .where(eq(schema.instanceSettings.id, 1))
        .run();

      clearLastFmCache();

      const { key, source } = resolveLastFmApiKey();
      const response: AdminLastFmConfigResponse = {
        configured: Boolean(key),
        source,
        keyPreview: maskLastFmApiKey(key),
      };
      return reply.code(200).send(response);
    },
  );
}
