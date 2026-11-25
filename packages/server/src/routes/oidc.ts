import type { FastifyInstance, FastifyRequest } from 'fastify';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { getDb, schema } from '../db/index.js';
import { config } from '../config.js';
import { authenticate, requireAdmin, signJwt } from '../utils/auth.js';
import { generateSnowflake } from '../utils/snowflake.js';
import { sanitizeUser } from '../utils/sanitize.js';
import { sendError } from '../utils/httpErrors.js';
import { autoBanEvadingAccount, isUserSourceOfActiveIpBan } from '../utils/ipBans.js';
import { connectionManager } from '../ws/handler.js';
import {
  consumeAdminOidcLinkToken,
  consumeOidcAuthState,
  consumeOidcLoginTicket,
  createAdminOidcLinkToken,
  createOidcAuthState,
  createOidcLoginTicket,
  extractOidcGroups,
  fetchOidcDiscovery,
  isOidcConfigured,
  matchesAdminGroups,
  normalizeIssuer,
  resolveOidcRedirectUri,
  resolvePublicBaseOrigin,
  sanitizeOidcUsername,
  syncOidcAvatar,
  verifyIdToken,
  type OidcClaims,
} from '../utils/oidc.js';
import {
  AVATAR_COLORS,
  type AdminOidcConfigResponse,
  type AdminOidcLinkRequest,
  type AdminOidcLinkTokenResponse,
  type AdminOidcUsersResponse,
  type AuthResponse,
} from '@backspace/shared';

function inferRequestOrigin(request: FastifyRequest): string | undefined {
  const proto = request.protocol || 'http';
  const host = request.headers.host;
  if (!host) return undefined;
  return `${proto}://${host}`;
}

function pickUniqueUsername(rawCandidate: string): string {
  const db = getDb();
  const base = sanitizeOidcUsername(rawCandidate);
  const existing = db.select({ id: schema.users.id })
    .from(schema.users)
    .where(eq(schema.users.username, base))
    .get();
  if (!existing) return base;

  for (let suffix = 2; suffix < 9999; suffix++) {
    const candidate = `${base.slice(0, 26)}_${suffix}`;
    const taken = db.select({ id: schema.users.id })
      .from(schema.users)
      .where(eq(schema.users.username, candidate))
      .get();
    if (!taken) return candidate;
  }
  return `${base.slice(0, 20)}_${Date.now().toString(36).slice(-5)}`;
}

function syncAdminRoleFromOidc(userId: string, claims: Record<string, unknown>): boolean {
  if (config.oidc.adminGroups.length === 0) return false;
  const db = getDb();
  const user = db.select().from(schema.users).where(eq(schema.users.id, userId)).get();
  if (!user || user.isDeleted === 1 || user.homeInstance) return false;

  const userGroups = extractOidcGroups(claims, config.oidc.groupsClaim);
  const shouldBeAdmin = matchesAdminGroups(userGroups, config.oidc.adminGroups);
  const currentlyAdmin = user.isAdmin === 1;

  if (shouldBeAdmin === currentlyAdmin) return false;

  // Never demote the last active admin of the instance.
  if (!shouldBeAdmin && currentlyAdmin) {
    const adminCount = db.select({ count: sql<number>`count(*)` })
      .from(schema.users)
      .where(and(eq(schema.users.isAdmin, 1), eq(schema.users.isDeleted, 0)))
      .get();
    if ((adminCount?.count ?? 0) <= 1) {
      return false;
    }
  }

  db.update(schema.users)
    .set({ isAdmin: shouldBeAdmin ? 1 : 0 })
    .where(eq(schema.users.id, userId))
    .run();

  const updated = db.select().from(schema.users).where(eq(schema.users.id, userId)).get();
  if (updated) {
    connectionManager.sendToUser(userId, {
      type: 'user_updated',
      user: sanitizeUser(updated),
    });
  }
  return true;
}

export async function oidcRoutes(app: FastifyInstance): Promise<void> {
  // ─── Public OIDC Flow ────────────────────────────────────────────────────

  app.get<{
    Querystring: { redirect?: string; client?: string; linkToken?: string };
  }>('/api/auth/oidc/start', {
    config: {
      rateLimit: {
        max: 30,
        timeWindow: '5 minutes',
        keyGenerator: (request: FastifyRequest) => request.ip,
      },
    },
  }, async (request, reply) => {
    if (!isOidcConfigured() || !config.oidc.issuerUrl || !config.oidc.clientId) {
      return reply.redirect('/login?oidc_error=not_configured');
    }

    let linkUserId: string | null = null;
    if (request.query.linkToken) {
      linkUserId = consumeAdminOidcLinkToken(request.query.linkToken);
      if (!linkUserId) {
        return reply.redirect('/login?oidc_error=link_expired');
      }
    }

    const clientParam = request.query.client;
    const client: 'web' | 'desktop' | 'mobile' =
      clientParam === 'desktop' || clientParam === 'mobile' ? clientParam : 'web';

    try {
      const discovery = await fetchOidcDiscovery(config.oidc.issuerUrl);
      const redirectUri = resolveOidcRedirectUri(inferRequestOrigin(request));
      const { state, nonce, codeChallenge } = createOidcAuthState({
        redirect: request.query.redirect,
        client,
        linkUserId,
      });

      const authUrl = new URL(discovery.authorization_endpoint);
      authUrl.searchParams.set('response_type', 'code');
      authUrl.searchParams.set('client_id', config.oidc.clientId);
      authUrl.searchParams.set('redirect_uri', redirectUri);
      authUrl.searchParams.set('scope', config.oidc.scopes);
      authUrl.searchParams.set('state', state);
      authUrl.searchParams.set('nonce', nonce);
      authUrl.searchParams.set('code_challenge', codeChallenge);
      authUrl.searchParams.set('code_challenge_method', 'S256');

      return reply.redirect(authUrl.toString());
    } catch (err) {
      request.log.error({ err }, 'OIDC start failed');
      return reply.redirect('/login?oidc_error=provider_unreachable');
    }
  });

  app.get<{
    Querystring: { code?: string; state?: string; error?: string; error_description?: string };
  }>('/api/auth/oidc/callback', {
    config: {
      rateLimit: {
        max: 30,
        timeWindow: '5 minutes',
        keyGenerator: (request: FastifyRequest) => request.ip,
      },
    },
  }, async (request, reply) => {
    if (!isOidcConfigured() || !config.oidc.issuerUrl || !config.oidc.clientId) {
      return reply.redirect('/login?oidc_error=not_configured');
    }

    if (request.query.error) {
      request.log.warn({ oidcError: request.query.error, desc: request.query.error_description }, 'OIDC provider returned error');
      return reply.redirect('/login?oidc_error=provider_denied');
    }

    const { code, state } = request.query;
    if (!code || !state) {
      return reply.redirect('/login?oidc_error=invalid_callback');
    }

    const pending = consumeOidcAuthState(state);
    if (!pending) {
      return reply.redirect('/login?oidc_error=state_expired');
    }

    try {
      const discovery = await fetchOidcDiscovery(config.oidc.issuerUrl);
      const redirectUri = resolveOidcRedirectUri(inferRequestOrigin(request));

      const tokenBody = new URLSearchParams();
      tokenBody.set('grant_type', 'authorization_code');
      tokenBody.set('code', code);
      tokenBody.set('redirect_uri', redirectUri);
      tokenBody.set('client_id', config.oidc.clientId);
      tokenBody.set('code_verifier', pending.codeVerifier);
      if (config.oidc.clientSecret) {
        tokenBody.set('client_secret', config.oidc.clientSecret);
      }

      const tokenRes = await fetch(discovery.token_endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
        },
        body: tokenBody.toString(),
        signal: AbortSignal.timeout(10_000),
      });

      if (!tokenRes.ok) {
        const text = await tokenRes.text().catch(() => '');
        request.log.error({ status: tokenRes.status, body: text.slice(0, 300) }, 'OIDC token exchange failed');
        return reply.redirect('/login?oidc_error=token_exchange_failed');
      }

      const tokenData = (await tokenRes.json()) as {
        id_token?: string;
        access_token?: string;
      };

      if (!tokenData.id_token) {
        return reply.redirect('/login?oidc_error=missing_id_token');
      }

      const idClaims = await verifyIdToken(tokenData.id_token, {
        issuer: discovery.issuer,
        clientId: config.oidc.clientId,
        nonce: pending.nonce,
        jwksUri: discovery.jwks_uri,
      });

      let mergedClaims: OidcClaims = { ...idClaims };
      if (discovery.userinfo_endpoint && tokenData.access_token) {
        try {
          const uiRes = await fetch(discovery.userinfo_endpoint, {
            headers: {
              Authorization: `Bearer ${tokenData.access_token}`,
              Accept: 'application/json',
            },
            signal: AbortSignal.timeout(6000),
          });
          if (uiRes.ok) {
            const uiData = (await uiRes.json()) as Record<string, unknown>;
            mergedClaims = { ...uiData, ...idClaims, picture: (uiData.picture as string | undefined) ?? idClaims.picture };
            // Merge groups/roles from both id_token and userinfo so neither is lost.
            const combinedGroups = new Set([
              ...extractOidcGroups(idClaims, config.oidc.groupsClaim),
              ...extractOidcGroups(uiData, config.oidc.groupsClaim),
            ]);
            if (combinedGroups.size > 0) {
              mergedClaims[config.oidc.groupsClaim] = Array.from(combinedGroups);
            }
          }
        } catch (uiErr) {
          request.log.warn({ err: uiErr }, 'OIDC userinfo fetch failed, continuing with id_token claims');
        }
      }

      const db = getDb();
      const issuer = normalizeIssuer(discovery.issuer);
      const subject = idClaims.sub;
      const email = typeof mergedClaims.email === 'string' ? mergedClaims.email : null;
      const preferredUsername = typeof mergedClaims.preferred_username === 'string'
        ? mergedClaims.preferred_username
        : (typeof mergedClaims.nickname === 'string' ? mergedClaims.nickname : null);
      const pictureUrl = typeof mergedClaims.picture === 'string' ? mergedClaims.picture : undefined;
      const now = Date.now();

      // Mode 1: Admin-generated link flow for an existing account
      if (pending.linkUserId) {
        const targetUser = db.select().from(schema.users).where(eq(schema.users.id, pending.linkUserId)).get();
        if (!targetUser || targetUser.isDeleted === 1) {
          return reply.redirect('/login?oidc_error=user_not_found');
        }

        const existingBySub = db.select()
          .from(schema.userOidcLinks)
          .where(and(eq(schema.userOidcLinks.issuer, issuer), eq(schema.userOidcLinks.subject, subject)))
          .get();

        if (existingBySub && existingBySub.userId !== targetUser.id) {
          return reply.redirect('/login?oidc_error=subject_already_linked');
        }

        // Remove any previous link for this user on the same issuer before upserting
        db.delete(schema.userOidcLinks)
          .where(and(eq(schema.userOidcLinks.userId, targetUser.id), eq(schema.userOidcLinks.issuer, issuer)))
          .run();

        const avatarSync = await syncOidcAvatar({
          userId: targetUser.id,
          pictureUrl,
          currentAvatar: targetUser.avatar,
          lastSourceUrl: null,
          issuerUrl: discovery.issuer,
          accessToken: tokenData.access_token,
        });

        if (avatarSync.updated) {
          db.update(schema.users)
            .set({ avatar: avatarSync.avatar, profileUpdatedAt: now })
            .where(eq(schema.users.id, targetUser.id))
            .run();
          const refreshed = db.select().from(schema.users).where(eq(schema.users.id, targetUser.id)).get();
          if (refreshed) {
            connectionManager.sendToUser(targetUser.id, { type: 'user_updated', user: sanitizeUser(refreshed) });
          }
        }

        db.insert(schema.userOidcLinks).values({
          id: generateSnowflake(),
          userId: targetUser.id,
          issuer,
          subject,
          email,
          preferredUsername,
          lastAvatarSourceUrl: avatarSync.lastAvatarSourceUrl,
          linkedAt: now,
          lastLoginAt: now,
        }).run();

        syncAdminRoleFromOidc(targetUser.id, mergedClaims);

        const ticket = createOidcLoginTicket(targetUser.id);
        return reply.redirect(`/auth/callback?oidc_ticket=${encodeURIComponent(ticket)}&oidc_linked=1`);
      }

      // Mode 2: Normal OIDC login
      const link = db.select()
        .from(schema.userOidcLinks)
        .where(and(eq(schema.userOidcLinks.issuer, issuer), eq(schema.userOidcLinks.subject, subject)))
        .get();

      let user = link
        ? db.select().from(schema.users).where(eq(schema.users.id, link.userId)).get()
        : undefined;

      if (user) {
        if (user.isDeleted === 1) {
          return reply.redirect('/login?oidc_error=account_deleted');
        }

        if (isUserSourceOfActiveIpBan(user.id)) {
          autoBanEvadingAccount(user.id, request.ip);
          return reply.redirect('/login?oidc_error=account_banned');
        }

        const avatarSync = await syncOidcAvatar({
          userId: user.id,
          pictureUrl,
          currentAvatar: user.avatar,
          lastSourceUrl: link?.lastAvatarSourceUrl ?? null,
          issuerUrl: discovery.issuer,
          accessToken: tokenData.access_token,
        });

        if (avatarSync.updated) {
          db.update(schema.users)
            .set({ avatar: avatarSync.avatar, profileUpdatedAt: now })
            .where(eq(schema.users.id, user.id))
            .run();
          const refreshed = db.select().from(schema.users).where(eq(schema.users.id, user.id)).get();
          if (refreshed) {
            connectionManager.sendToUser(user.id, { type: 'user_updated', user: sanitizeUser(refreshed) });
          }
        }

        db.update(schema.userOidcLinks)
          .set({
            email,
            preferredUsername,
            lastAvatarSourceUrl: avatarSync.lastAvatarSourceUrl,
            lastLoginAt: now,
          })
          .where(eq(schema.userOidcLinks.id, link!.id))
          .run();

        syncAdminRoleFromOidc(user.id, mergedClaims);
      } else {
        if (!config.oidc.autoRegister) {
          return reply.redirect('/login?oidc_error=not_linked');
        }

        const candidateName =
          preferredUsername
          ?? (email ? email.split('@')[0] : undefined)
          ?? (typeof mergedClaims.name === 'string' ? mergedClaims.name : undefined)
          ?? `user_${subject.slice(0, 8)}`;

        const username = pickUniqueUsername(candidateName);
        const displayName = (typeof mergedClaims.name === 'string' && mergedClaims.name.trim())
          ? mergedClaims.name.trim().slice(0, 64)
          : (preferredUsername ?? username);

        const userCount = db.select({ count: sql<number>`count(*)` }).from(schema.users).get()?.count ?? 0;
        const userGroups = extractOidcGroups(mergedClaims, config.oidc.groupsClaim);
        const isAdminByGroup = matchesAdminGroups(userGroups, config.oidc.adminGroups);
        const isAdmin = (userCount === 0 || isAdminByGroup) ? 1 : 0;

        const userId = generateSnowflake();
        const avatarColor = AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)] ?? '#7c3aed';

        const avatarSync = await syncOidcAvatar({
          userId,
          pictureUrl,
          currentAvatar: null,
          lastSourceUrl: null,
          issuerUrl: discovery.issuer,
          accessToken: tokenData.access_token,
        });

        db.insert(schema.users).values({
          id: userId,
          username,
          displayName,
          passwordHash: '!oidc-managed',
          avatar: avatarSync.avatar,
          avatarColor,
          isAdmin,
          status: 'offline',
          chosenStatus: 'online',
          createdAt: now,
        }).run();

        db.insert(schema.userOidcLinks).values({
          id: generateSnowflake(),
          userId,
          issuer,
          subject,
          email,
          preferredUsername,
          lastAvatarSourceUrl: avatarSync.lastAvatarSourceUrl,
          linkedAt: now,
          lastLoginAt: now,
        }).run();

        user = db.select().from(schema.users).where(eq(schema.users.id, userId)).get();
        if (!user) {
          return reply.redirect('/login?oidc_error=user_create_failed');
        }
      }

      const ticket = createOidcLoginTicket(user.id);
      if (pending.client === 'desktop' || pending.client === 'mobile') {
        return reply.redirect(`balacopapo://auth/callback?oidc_ticket=${encodeURIComponent(ticket)}`);
      }

      const params = new URLSearchParams();
      params.set('oidc_ticket', ticket);
      if (pending.redirect && pending.redirect !== '/channels/@me') {
        params.set('redirect', pending.redirect);
      }
      return reply.redirect(`/auth/callback?${params.toString()}`);
    } catch (err) {
      request.log.error({ err }, 'OIDC callback failed');
      return reply.redirect('/login?oidc_error=callback_failed');
    }
  });

  app.post<{ Body: { ticket?: string } }>('/api/auth/oidc/exchange', {
    config: {
      rateLimit: {
        max: 30,
        timeWindow: '5 minutes',
        keyGenerator: (request: FastifyRequest) => request.ip,
      },
    },
  }, async (request, reply) => {
    const ticket = request.body?.ticket;
    if (!ticket || typeof ticket !== 'string') {
      return reply.code(400).send({ error: 'oidc_ticket_required' });
    }

    const userId = consumeOidcLoginTicket(ticket);
    if (!userId) {
      return reply.code(401).send({ error: 'oidc_ticket_invalid' });
    }

    const db = getDb();
    const user = db.select().from(schema.users).where(eq(schema.users.id, userId)).get();
    if (!user || user.isDeleted === 1) {
      return sendError(reply, 404, 'user_not_found');
    }

    const token = signJwt({ userId: user.id, username: user.username });
    const response: AuthResponse = {
      token,
      user: sanitizeUser(user, true),
    };
    return reply.code(200).send(response);
  });

  // ─── Admin OIDC Management (Instance Settings) ───────────────────────────

  app.get('/api/admin/oidc/config', {
    preHandler: [authenticate, requireAdmin],
  }, async (request, reply) => {
    const response: AdminOidcConfigResponse = {
      enabled: config.oidc.enabled,
      configured: isOidcConfigured(),
      issuerUrl: config.oidc.issuerUrl ?? null,
      clientId: config.oidc.clientId ?? null,
      hasClientSecret: Boolean(config.oidc.clientSecret),
      displayName: config.oidc.displayName,
      scopes: config.oidc.scopes,
      autoRegister: config.oidc.autoRegister,
      syncAvatar: config.oidc.syncAvatar,
      groupsClaim: config.oidc.groupsClaim,
      adminGroups: [...config.oidc.adminGroups],
      passwordLoginDisabled: config.oidc.disablePasswordLogin && isOidcConfigured(),
      callbackUrl: resolveOidcRedirectUri(inferRequestOrigin(request)),
    };
    return reply.code(200).send(response);
  });

  app.get<{ Querystring: { q?: string } }>('/api/admin/oidc/users', {
    preHandler: [authenticate, requireAdmin],
  }, async (request, reply) => {
    const db = getDb();
    const q = request.query.q?.trim().toLowerCase() ?? '';

    const users = db.select()
      .from(schema.users)
      .where(and(eq(schema.users.isDeleted, 0), isNull(schema.users.homeInstance)))
      .orderBy(desc(schema.users.createdAt))
      .all();

    const links = db.select().from(schema.userOidcLinks).all();
    const currentIssuer = config.oidc.issuerUrl ? normalizeIssuer(config.oidc.issuerUrl) : null;

    const linkByUserId = new Map<string, typeof schema.userOidcLinks.$inferSelect>();
    for (const link of links) {
      const existing = linkByUserId.get(link.userId);
      // Prefer link matching the currently configured issuer if a user has multiple
      if (!existing || (currentIssuer && normalizeIssuer(link.issuer) === currentIssuer)) {
        linkByUserId.set(link.userId, link);
      }
    }

    const mapped = users
      .map((u) => {
        const l = linkByUserId.get(u.id);
        return {
          id: u.id,
          username: u.username,
          displayName: u.displayName,
          avatar: u.avatar,
          avatarColor: u.avatarColor,
          isAdmin: u.isAdmin === 1,
          createdAt: u.createdAt,
          oidcLink: l
            ? {
                issuer: l.issuer,
                subject: l.subject,
                email: l.email,
                preferredUsername: l.preferredUsername,
                linkedAt: l.linkedAt,
                lastLoginAt: l.lastLoginAt,
              }
            : null,
        };
      })
      .filter((u) => {
        if (!q) return true;
        return (
          u.username.toLowerCase().includes(q)
          || (u.displayName?.toLowerCase().includes(q) ?? false)
          || (u.oidcLink?.subject.toLowerCase().includes(q) ?? false)
          || (u.oidcLink?.email?.toLowerCase().includes(q) ?? false)
        );
      });

    const response: AdminOidcUsersResponse = { users: mapped };
    return reply.code(200).send(response);
  });

  app.post<{ Body: AdminOidcLinkRequest }>('/api/admin/oidc/links', {
    preHandler: [authenticate, requireAdmin],
  }, async (request, reply) => {
    if (!config.oidc.issuerUrl) {
      return reply.code(400).send({ error: 'oidc_issuer_not_configured' });
    }

    const { userId, subject, email, preferredUsername } = request.body ?? {};
    if (!userId || typeof userId !== 'string' || !subject || typeof subject !== 'string' || !subject.trim()) {
      return reply.code(400).send({ error: 'oidc_link_fields_required' });
    }

    const db = getDb();
    const user = db.select().from(schema.users).where(eq(schema.users.id, userId)).get();
    if (!user || user.isDeleted === 1) {
      return sendError(reply, 404, 'user_not_found');
    }
    if (user.homeInstance) {
      return reply.code(400).send({ error: 'federated_user_cannot_link_oidc' });
    }

    const issuer = normalizeIssuer(config.oidc.issuerUrl);
    const trimmedSub = subject.trim();

    const conflict = db.select()
      .from(schema.userOidcLinks)
      .where(and(eq(schema.userOidcLinks.issuer, issuer), eq(schema.userOidcLinks.subject, trimmedSub)))
      .get();

    if (conflict && conflict.userId !== userId) {
      return reply.code(409).send({ error: 'oidc_subject_already_linked' });
    }

    db.delete(schema.userOidcLinks)
      .where(and(eq(schema.userOidcLinks.userId, userId), eq(schema.userOidcLinks.issuer, issuer)))
      .run();

    const now = Date.now();
    db.insert(schema.userOidcLinks).values({
      id: generateSnowflake(),
      userId,
      issuer,
      subject: trimmedSub,
      email: email?.trim() || null,
      preferredUsername: preferredUsername?.trim() || null,
      lastAvatarSourceUrl: null,
      linkedAt: now,
      lastLoginAt: null,
    }).run();

    return reply.code(200).send({
      success: true,
      link: {
        issuer,
        subject: trimmedSub,
        email: email?.trim() || null,
        preferredUsername: preferredUsername?.trim() || null,
        linkedAt: now,
        lastLoginAt: null,
      },
    });
  });

  app.post<{ Body: { userId?: string } }>('/api/admin/oidc/link-token', {
    preHandler: [authenticate, requireAdmin],
  }, async (request, reply) => {
    if (!isOidcConfigured()) {
      return reply.code(400).send({ error: 'oidc_not_configured' });
    }

    const userId = request.body?.userId;
    if (!userId || typeof userId !== 'string') {
      return reply.code(400).send({ error: 'user_id_required' });
    }

    const db = getDb();
    const user = db.select().from(schema.users).where(eq(schema.users.id, userId)).get();
    if (!user || user.isDeleted === 1 || user.homeInstance) {
      return sendError(reply, 404, 'user_not_found');
    }

    const { token, expiresAt } = createAdminOidcLinkToken(userId);
    const origin = resolvePublicBaseOrigin(inferRequestOrigin(request));
    const response: AdminOidcLinkTokenResponse = {
      linkUrl: `${origin}/api/auth/oidc/start?linkToken=${encodeURIComponent(token)}`,
      expiresAt,
    };
    return reply.code(200).send(response);
  });

  app.delete<{ Params: { userId: string } }>('/api/admin/oidc/links/:userId', {
    preHandler: [authenticate, requireAdmin],
  }, async (request, reply) => {
    const { userId } = request.params;
    const db = getDb();
    db.delete(schema.userOidcLinks).where(eq(schema.userOidcLinks.userId, userId)).run();
    return reply.code(200).send({ success: true });
  });
}
