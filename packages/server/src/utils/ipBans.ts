import { eq, lte, isNotNull } from 'drizzle-orm';
import { isIP } from 'node:net';
import { getDb, schema } from '../db/index.js';
import { generateSnowflake } from './snowflake.js';

const MS_PER_DAY = 86_400_000;
const DEFAULT_EVASION_BAN_DAYS = Math.max(
  1,
  Number.parseInt(process.env.IP_BAN_DEFAULT_DAYS || '7', 10) || 7,
);

export interface ActiveIpBan {
  id: string;
  ip: string;
  reason: string | null;
  bannedBy: string | null;
  sourceUserId: string | null;
  durationDays: number | null;
  expiresAt: number | null;
  createdAt: number;
}

/**
 * Normalizes IPv4-mapped IPv6 addresses (`::ffff:1.2.3.4` → `1.2.3.4`) and trims whitespace.
 */
export function normalizeClientIp(rawIp: string | undefined | null): string {
  if (!rawIp) return '';
  let ip = rawIp.trim();
  if (ip.startsWith('::ffff:')) {
    ip = ip.slice('::ffff:'.length);
  }
  return ip;
}

/**
 * Validates a bare IPv4/IPv6 address or CIDR notation (`ip/prefix`).
 */
export function isValidIpOrCidr(value: string): boolean {
  const normalized = normalizeClientIp(value);
  if (!normalized) return false;
  const slashIdx = normalized.indexOf('/');
  if (slashIdx === -1) {
    return isIP(normalized) !== 0;
  }
  const addr = normalized.slice(0, slashIdx);
  const prefixStr = normalized.slice(slashIdx + 1);
  if (!/^\d{1,3}$/.test(prefixStr)) return false;
  const prefix = Number(prefixStr);
  const family = isIP(addr);
  if (family === 4) return prefix >= 0 && prefix <= 32;
  if (family === 6) return prefix >= 0 && prefix <= 128;
  return false;
}

/**
 * Deletes expired IP bans so automatic day-based rotation cleans up cleanly.
 */
export function pruneExpiredIpBans(now = Date.now()): number {
  const db = getDb();
  const res = db
    .delete(schema.ipBans)
    .where(lte(schema.ipBans.expiresAt, now))
    .run();
  return res.changes;
}

export function isIpBanned(rawIp: string): { banned: boolean; reason: string | null; expiresAt: number | null } {
  const ip = normalizeClientIp(rawIp);
  if (!ip) return { banned: false, reason: null, expiresAt: null };
  const db = getDb();
  const row = db.select().from(schema.ipBans).where(eq(schema.ipBans.ip, ip)).get();
  if (!row) return { banned: false, reason: null, expiresAt: null };
  const now = Date.now();
  if (row.expiresAt !== null && row.expiresAt <= now) {
    db.delete(schema.ipBans).where(eq(schema.ipBans.id, row.id)).run();
    return { banned: false, reason: null, expiresAt: null };
  }
  return { banned: true, reason: row.reason ?? null, expiresAt: row.expiresAt ?? null };
}

export function banIp(params: {
  ip: string;
  reason?: string | null;
  bannedBy?: string | null;
  sourceUserId?: string | null;
  durationDays?: number | null;
}): ActiveIpBan {
  const ip = normalizeClientIp(params.ip);
  const now = Date.now();
  const durationDays =
    params.durationDays !== undefined && params.durationDays !== null && params.durationDays > 0
      ? Math.round(params.durationDays)
      : null;
  const expiresAt = durationDays !== null ? now + durationDays * MS_PER_DAY : null;
  const reason = params.reason?.trim() || null;

  const db = getDb();
  const existing = db.select().from(schema.ipBans).where(eq(schema.ipBans.ip, ip)).get();
  if (existing) {
    db.update(schema.ipBans)
      .set({
        reason,
        bannedBy: params.bannedBy ?? existing.bannedBy,
        sourceUserId: params.sourceUserId ?? existing.sourceUserId,
        durationDays,
        expiresAt,
        createdAt: now,
      })
      .where(eq(schema.ipBans.id, existing.id))
      .run();
    return {
      id: existing.id,
      ip,
      reason,
      bannedBy: params.bannedBy ?? existing.bannedBy ?? null,
      sourceUserId: params.sourceUserId ?? existing.sourceUserId ?? null,
      durationDays,
      expiresAt,
      createdAt: now,
    };
  }

  const id = generateSnowflake();
  db.insert(schema.ipBans)
    .values({
      id,
      ip,
      reason,
      bannedBy: params.bannedBy ?? null,
      sourceUserId: params.sourceUserId ?? null,
      durationDays,
      expiresAt,
      createdAt: now,
    })
    .run();

  return {
    id,
    ip,
    reason,
    bannedBy: params.bannedBy ?? null,
    sourceUserId: params.sourceUserId ?? null,
    durationDays,
    expiresAt,
    createdAt: now,
  };
}

/**
 * Automatically bans a new IP when a previously banned account attempts to log in or connect.
 */
export function autoBanEvadingAccount(rawIp: string, userId: string, durationDays = DEFAULT_EVASION_BAN_DAYS): ActiveIpBan | null {
  const ip = normalizeClientIp(rawIp);
  if (!ip || ip === '127.0.0.1' || ip === '::1') return null;
  return banIp({
    ip,
    reason: 'Auto-ban: banned account login attempt',
    sourceUserId: userId,
    durationDays,
  });
}

export function listActiveIpBans(): ActiveIpBan[] {
  pruneExpiredIpBans();
  const db = getDb();
  return db
    .select()
    .from(schema.ipBans)
    .all()
    .map((r) => ({
      id: r.id,
      ip: r.ip,
      reason: r.reason ?? null,
      bannedBy: r.bannedBy ?? null,
      sourceUserId: r.sourceUserId ?? null,
      durationDays: r.durationDays ?? null,
      expiresAt: r.expiresAt ?? null,
      createdAt: r.createdAt,
    }));
}

export function unbanIpById(id: string): boolean {
  const db = getDb();
  const res = db.delete(schema.ipBans).where(eq(schema.ipBans.id, id)).run();
  return res.changes > 0;
}

/**
 * Formats active IP bans for OPNsense Firewall Alias ("URL Table (IPs)") — one IP/CIDR per line.
 */
export function formatIpBansForOpnsense(): string {
  const bans = listActiveIpBans();
  const lines = [
    '# Balacopapo active IP bans (OPNsense URL Table Alias format)',
    ...bans.map((b) => b.ip),
  ];
  return lines.join('\n') + '\n';
}

/**
 * Formats active IP bans for Nginx (`include` block) — `deny <ip>;` per line.
 */
export function formatIpBansForNginx(): string {
  const bans = listActiveIpBans();
  const lines = [
    '# Balacopapo active IP bans (Nginx deny rules)',
    ...bans.map((b) => `deny ${b.ip};`),
  ];
  return lines.join('\n') + '\n';
}

/**
 * Returns whether a user has an active IP ban linked to them (used to detect evasion).
 */
export function isUserSourceOfActiveIpBan(userId: string): boolean {
  pruneExpiredIpBans();
  const db = getDb();
  const row = db
    .select({ id: schema.ipBans.id })
    .from(schema.ipBans)
    .where(eq(schema.ipBans.sourceUserId, userId))
    .get();
  return !!row;
}

export { isNotNull };
