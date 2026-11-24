import type { FastifyInstance } from 'fastify';
import { timingSafeEqual } from 'node:crypto';
import { authenticate, requireAdmin } from '../utils/auth.js';
import { sendError } from '../utils/httpErrors.js';
import {
  banIp,
  formatIpBansForNginx,
  formatIpBansForOpnsense,
  isValidIpOrCidr,
  listActiveIpBans,
  unbanIpById,
} from '../utils/ipBans.js';

function tokensMatch(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

export async function ipBanRoutes(app: FastifyInstance): Promise<void> {
  // GET /api/admin/ip-bans — list active IP bans (auto-prunes expired entries)
  app.get('/api/admin/ip-bans', { preHandler: [authenticate, requireAdmin] }, async (_request, reply) => {
    return reply.code(200).send({ bans: listActiveIpBans() });
  });

  // POST /api/admin/ip-bans — create/update an IP ban with optional auto-expiry in days
  app.post<{
    Body: { ip?: string; reason?: string | null; durationDays?: number | null; sourceUserId?: string | null };
  }>('/api/admin/ip-bans', { preHandler: [authenticate, requireAdmin] }, async (request, reply) => {
    const { ip, reason, durationDays, sourceUserId } = request.body ?? {};
    if (!ip || typeof ip !== 'string' || !isValidIpOrCidr(ip)) {
      return sendError(reply, 400, 'validation_failed', { field: 'ip', reason: 'invalid IP or CIDR' });
    }
    if (
      durationDays !== undefined
      && durationDays !== null
      && (typeof durationDays !== 'number' || !Number.isFinite(durationDays) || durationDays < 0 || durationDays > 3650)
    ) {
      return sendError(reply, 400, 'validation_failed', { field: 'durationDays', reason: 'must be between 0 and 3650' });
    }

    const ban = banIp({
      ip,
      reason: typeof reason === 'string' ? reason.slice(0, 300) : null,
      bannedBy: request.userId,
      sourceUserId: typeof sourceUserId === 'string' ? sourceUserId : null,
      durationDays: durationDays && durationDays > 0 ? durationDays : null,
    });
    return reply.code(201).send({ ban });
  });

  // DELETE /api/admin/ip-bans/:id — unban an IP
  app.delete<{ Params: { id: string } }>(
    '/api/admin/ip-bans/:id',
    { preHandler: [authenticate, requireAdmin] },
    async (request, reply) => {
      const removed = unbanIpById(request.params.id);
      if (!removed) return sendError(reply, 404, 'not_found');
      return reply.code(200).send({ ok: true });
    },
  );

  // GET /api/admin/ip-bans/feed?format=opnsense|nginx(&token=...)
  // Designed for OPNsense Firewall Alias "URL Table (IPs)" and OPNsense/Nginx `deny` includes.
  // Authenticates via `IP_BAN_FEED_TOKEN` env var (Bearer header or `?token=` query param).
  app.get<{ Querystring: { format?: string; token?: string } }>(
    '/api/admin/ip-bans/feed',
    async (request, reply) => {
      const configuredToken = process.env.IP_BAN_FEED_TOKEN?.trim();
      if (!configuredToken) {
        return sendError(reply, 404, 'not_found');
      }
      const authHeader = request.headers.authorization;
      const bearer = authHeader?.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
      const candidate = bearer || (request.query.token ?? '').trim();
      if (!candidate || !tokensMatch(candidate, configuredToken)) {
        return sendError(reply, 401, 'unauthorized');
      }

      const format = (request.query.format ?? 'opnsense').toLowerCase();
      const body = format === 'nginx' ? formatIpBansForNginx() : formatIpBansForOpnsense();
      return reply
        .code(200)
        .header('Content-Type', 'text/plain; charset=utf-8')
        .header('Cache-Control', 'no-store')
        .send(body);
    },
  );
}
