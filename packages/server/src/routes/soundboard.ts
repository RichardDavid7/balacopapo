import type { FastifyInstance } from 'fastify';
import multipart from '@fastify/multipart';
import { and, asc, eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type {
  SoundboardScopeType,
  SoundboardSound,
  SpaceSoundboardSettings,
  SpaceSoundboardSoundOverride,
} from '@backspace/shared';
import { getDb, schema } from '../db/index.js';
import { config } from '../config.js';
import { authenticate } from '../utils/auth.js';
import { sendError } from '../utils/httpErrors.js';
import { hasPermission, PermissionBits } from '../utils/permissions.js';
import { generateSnowflake } from '../utils/snowflake.js';

const MAX_SOUNDBOARD_BYTES = 5 * 1024 * 1024; // 5 MB
const MAX_SOUNDBOARD_NAME = 40;
const MAX_SOUNDBOARD_EMOJI = 16;
const MAX_SOUNDBOARD_FOLDER = 32;
const SAFE_FILE_NAME = /^[a-zA-Z0-9_-]+\.(wav|mp3|ogg|webm|m4a|aac|flac|opus)$/;

const MIME_TO_EXT: Record<string, string> = {
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/wave': 'wav',
  'audio/mpeg': 'mp3',
  'audio/mp3': 'mp3',
  'audio/ogg': 'ogg',
  'audio/opus': 'opus',
  'audio/webm': 'webm',
  'video/webm': 'webm',
  'audio/mp4': 'm4a',
  'audio/x-m4a': 'm4a',
  'video/mp4': 'm4a',
  'audio/aac': 'aac',
  'audio/x-aac': 'aac',
  'audio/flac': 'flac',
  'audio/x-flac': 'flac',
};

const EXT_TO_MIME: Record<string, string> = {
  wav: 'audio/wav',
  mp3: 'audio/mpeg',
  ogg: 'audio/ogg',
  opus: 'audio/opus',
  webm: 'audio/webm',
  m4a: 'audio/mp4',
  aac: 'audio/aac',
  flac: 'audio/flac',
};

function soundboardDir(): string {
  return path.join(config.uploadDir, 'soundboard');
}

function rowToSound(
  row: typeof schema.soundboardSounds.$inferSelect,
  override?: { hidden: boolean; volume: number | null },
): SoundboardSound {
  const sound: SoundboardSound = {
    id: row.id,
    scopeType: row.scopeType as SoundboardScopeType,
    scopeId: row.scopeId,
    name: row.name,
    emoji: row.emoji,
    folder: row.folder ?? null,
    fileUrl: `/api/soundboard/files/${row.fileName}`,
    durationMs: row.durationMs,
    position: row.position,
    uploadedBy: row.uploadedBy,
    createdAt: row.createdAt,
  };
  if (override) {
    sound.hiddenInSpace = override.hidden;
    sound.volumeOverride = override.volume;
  }
  return sound;
}

function getSpaceSoundboardSettings(spaceId: string): SpaceSoundboardSettings {
  const db = getDb();
  const row = db
    .select()
    .from(schema.spaceSoundboardSettings)
    .where(eq(schema.spaceSoundboardSettings.spaceId, spaceId))
    .get();
  return {
    soundboardEnabled: (row?.soundboardEnabled ?? 1) === 1,
    allowInstanceSounds: (row?.allowInstanceSounds ?? 1) === 1,
    maxConcurrentSounds: row?.maxConcurrentSounds ?? null,
  };
}

function getSpaceSoundboardOverridesMap(spaceId: string): Map<string, { hidden: boolean; volume: number | null }> {
  const db = getDb();
  const rows = db
    .select()
    .from(schema.spaceSoundboardOverrides)
    .where(eq(schema.spaceSoundboardOverrides.spaceId, spaceId))
    .all();
  const map = new Map<string, { hidden: boolean; volume: number | null }>();
  for (const r of rows) {
    map.set(r.soundId, {
      hidden: r.hidden === 1,
      volume: r.volume ?? null,
    });
  }
  return map;
}

function isInstanceAdmin(userId: string): boolean {
  const db = getDb();
  const u = db.select({ isAdmin: schema.users.isAdmin }).from(schema.users).where(eq(schema.users.id, userId)).get();
  return u?.isAdmin === 1;
}

function getSoundboardLimits(): { soundboardEnabled: boolean; maxSoundsPerScope: number; maxConcurrentSounds: number } {
  const db = getDb();
  const row = db
    .select({
      soundboardEnabled: schema.instanceSettings.soundboardEnabled,
      maxSoundboardSoundsPerScope: schema.instanceSettings.maxSoundboardSoundsPerScope,
      maxConcurrentSoundboardSounds: schema.instanceSettings.maxConcurrentSoundboardSounds,
    })
    .from(schema.instanceSettings)
    .where(eq(schema.instanceSettings.id, 1))
    .get();
  return {
    soundboardEnabled: (row?.soundboardEnabled ?? 1) === 1,
    maxSoundsPerScope: row?.maxSoundboardSoundsPerScope ?? 32,
    maxConcurrentSounds: row?.maxConcurrentSoundboardSounds ?? 3,
  };
}

function canManageScope(userId: string, scopeType: SoundboardScopeType, scopeId: string): boolean {
  if (scopeType === 'instance') {
    return isInstanceAdmin(userId);
  }
  if (scopeType === 'space') {
    return hasPermission(userId, scopeId, PermissionBits.MANAGE_SOUNDBOARD);
  }
  return false;
}

function resolveExtension(mimeType: string, originalFileName: string): string | null {
  const normalizedMime = mimeType.toLowerCase().split(';')[0]!.trim();
  if (MIME_TO_EXT[normalizedMime]) return MIME_TO_EXT[normalizedMime]!;
  const ext = path.extname(originalFileName).toLowerCase().replace(/^\./, '');
  if (EXT_TO_MIME[ext]) return ext;
  return null;
}

export async function soundboardRoutes(app: FastifyInstance): Promise<void> {
  await app.register(multipart, {
    limits: {
      fileSize: MAX_SOUNDBOARD_BYTES,
      files: 1,
    },
  });

  // GET /api/soundboard?spaceId=...&includeHidden=1
  app.get<{ Querystring: { spaceId?: string; includeHidden?: string } }>('/api/soundboard', {
    preHandler: authenticate,
  }, async (request, reply) => {
    const db = getDb();
    const { spaceId, includeHidden: includeHiddenParam } = request.query;

    const instanceRows = db.select()
      .from(schema.soundboardSounds)
      .where(and(
        eq(schema.soundboardSounds.scopeType, 'instance'),
        eq(schema.soundboardSounds.scopeId, 'instance'),
      ))
      .orderBy(asc(schema.soundboardSounds.position), asc(schema.soundboardSounds.createdAt))
      .all();

    let scopedRows: (typeof schema.soundboardSounds.$inferSelect)[] = [];
    let scopeManageable = false;
    let spaceSettings: SpaceSoundboardSettings | undefined;
    let overridesMap: Map<string, { hidden: boolean; volume: number | null }> | null = null;

    if (spaceId) {
      const member = db.select({ userId: schema.spaceMembers.userId })
        .from(schema.spaceMembers)
        .where(and(eq(schema.spaceMembers.spaceId, spaceId), eq(schema.spaceMembers.userId, request.userId)))
        .get();
      if (member) {
        scopedRows = db.select()
          .from(schema.soundboardSounds)
          .where(and(
            eq(schema.soundboardSounds.scopeType, 'space'),
            eq(schema.soundboardSounds.scopeId, spaceId),
          ))
          .orderBy(asc(schema.soundboardSounds.position), asc(schema.soundboardSounds.createdAt))
          .all();
        scopeManageable = canManageScope(request.userId, 'space', spaceId);
        spaceSettings = getSpaceSoundboardSettings(spaceId);
        overridesMap = getSpaceSoundboardOverridesMap(spaceId);
      }
    }

    const limits = getSoundboardLimits();
    const includeHidden = includeHiddenParam === '1' && scopeManageable;
    const effectiveEnabled = limits.soundboardEnabled && (spaceSettings ? spaceSettings.soundboardEnabled : true);
    const effectiveMaxConcurrent = spaceSettings?.maxConcurrentSounds != null
      ? Math.max(1, Math.min(spaceSettings.maxConcurrentSounds, limits.maxConcurrentSounds))
      : limits.maxConcurrentSounds;

    const mapWithOverride = (row: typeof schema.soundboardSounds.$inferSelect) =>
      rowToSound(row, overridesMap ? (overridesMap.get(row.id) ?? { hidden: false, volume: null }) : undefined);

    let instanceSounds: SoundboardSound[] = [];
    let scopedSounds: SoundboardSound[] = [];

    if (limits.soundboardEnabled && (effectiveEnabled || includeHidden)) {
      const allInstance = instanceRows.map(mapWithOverride);
      const allScoped = scopedRows.map(mapWithOverride);
      if (includeHidden) {
        instanceSounds = allInstance;
        scopedSounds = allScoped;
      } else {
        instanceSounds = (spaceSettings && !spaceSettings.allowInstanceSounds)
          ? []
          : allInstance.filter((s) => !s.hiddenInSpace);
        scopedSounds = allScoped.filter((s) => !s.hiddenInSpace);
      }
    }

    return reply.code(200).send({
      instanceSounds,
      scopedSounds,
      canManageInstance: isInstanceAdmin(request.userId),
      canManageScope: scopeManageable && limits.soundboardEnabled,
      soundboardEnabled: effectiveEnabled,
      maxSoundsPerScope: limits.maxSoundsPerScope,
      maxConcurrentSounds: effectiveMaxConcurrent,
      instanceMaxConcurrentSounds: limits.maxConcurrentSounds,
      ...(spaceSettings ? { spaceSettings } : {}),
    });
  });

  // POST /api/soundboard — multipart upload (file + name + emoji + scopeType + scopeId + durationMs)
  app.post('/api/soundboard', {
    preHandler: authenticate,
  }, async (request, reply) => {
    const parts = request.parts({ limits: { fileSize: MAX_SOUNDBOARD_BYTES, files: 1 } });
    let fileBuffer: Buffer | null = null;
    let fileMime = '';
    let originalName = '';
    let name = '';
    let emoji = '🔊';
    let folder: string | null = null;
    let scopeType: SoundboardScopeType = 'instance';
    let scopeId = 'instance';
    let durationMs = 0;

    for await (const part of parts) {
      if (part.type === 'file') {
        const chunks: Buffer[] = [];
        let total = 0;
        for await (const chunk of part.file) {
          total += chunk.length;
          if (total > MAX_SOUNDBOARD_BYTES) {
            return sendError(reply, 413, 'validation_failed');
          }
          chunks.push(chunk);
        }
        fileBuffer = Buffer.concat(chunks);
        fileMime = part.mimetype;
        originalName = part.filename;
      } else {
        const val = typeof part.value === 'string' ? part.value : '';
        if (part.fieldname === 'name') name = val.trim();
        else if (part.fieldname === 'emoji' && val.trim()) emoji = val.trim().slice(0, MAX_SOUNDBOARD_EMOJI);
        else if (part.fieldname === 'folder') {
          const trimmed = val.trim().slice(0, MAX_SOUNDBOARD_FOLDER);
          folder = trimmed.length > 0 ? trimmed : null;
        }
        else if (part.fieldname === 'scopeType' && (val === 'instance' || val === 'space')) scopeType = val;
        else if (part.fieldname === 'scopeId' && val.trim()) scopeId = val.trim();
        else if (part.fieldname === 'durationMs') {
          const parsed = Number(val);
          if (Number.isFinite(parsed) && parsed >= 0) durationMs = Math.round(parsed);
        }
      }
    }

    if (scopeType === 'instance') scopeId = 'instance';
    if (!canManageScope(request.userId, scopeType, scopeId)) {
      return sendError(reply, 403, 'forbidden');
    }
    if (!fileBuffer || fileBuffer.length === 0) {
      return sendError(reply, 400, 'validation_failed');
    }
    if (!name || name.length > MAX_SOUNDBOARD_NAME) {
      return sendError(reply, 400, 'validation_failed');
    }

    const ext = resolveExtension(fileMime, originalName);
    if (!ext) {
      return sendError(reply, 400, 'validation_failed');
    }

    const db = getDb();
    const existing = db.select({ position: schema.soundboardSounds.position })
      .from(schema.soundboardSounds)
      .where(and(
        eq(schema.soundboardSounds.scopeType, scopeType),
        eq(schema.soundboardSounds.scopeId, scopeId),
      ))
      .all();

    if (scopeType !== 'instance') {
      const { soundboardEnabled, maxSoundsPerScope } = getSoundboardLimits();
      if (!soundboardEnabled) {
        return sendError(reply, 403, 'forbidden');
      }
      if (existing.length >= maxSoundsPerScope) {
        return sendError(reply, 400, 'validation_failed');
      }
    }

    const id = generateSnowflake();
    const fileName = `${randomUUID()}.${ext}`;
    const dir = soundboardDir();
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, fileName), fileBuffer);
    const nextPos = existing.length > 0 ? Math.max(...existing.map((r) => r.position)) + 1 : 0;

    const row: typeof schema.soundboardSounds.$inferInsert = {
      id,
      scopeType,
      scopeId,
      name,
      emoji,
      folder,
      fileName,
      mimeType: EXT_TO_MIME[ext] ?? 'audio/wav',
      durationMs,
      position: nextPos,
      uploadedBy: request.userId,
      createdAt: Date.now(),
    };
    db.insert(schema.soundboardSounds).values(row).run();

    const created = db.select().from(schema.soundboardSounds).where(eq(schema.soundboardSounds.id, id)).get();
    if (!created) return sendError(reply, 500, 'internal_error');
    return reply.code(201).send(rowToSound(created));
  });

  // PATCH /api/soundboard/:id — edit name, emoji, and/or replace audio file (JSON or multipart)
  app.patch<{ Params: { id: string } }>('/api/soundboard/:id', {
    preHandler: authenticate,
  }, async (request, reply) => {
    const db = getDb();
    const existing = db.select().from(schema.soundboardSounds).where(eq(schema.soundboardSounds.id, request.params.id)).get();
    if (!existing) return sendError(reply, 404, 'not_found');

    const scopeType = existing.scopeType as SoundboardScopeType;
    const isOwner = existing.uploadedBy === request.userId;
    if (!isOwner && !canManageScope(request.userId, scopeType, existing.scopeId)) {
      return sendError(reply, 403, 'forbidden');
    }

    const updates: Partial<typeof schema.soundboardSounds.$inferInsert> = {};
    let oldFileToRemove: string | null = null;

    if (request.isMultipart()) {
      const parts = request.parts({ limits: { fileSize: MAX_SOUNDBOARD_BYTES, files: 1 } });
      let fileBuffer: Buffer | null = null;
      let fileMime = '';
      let originalName = '';
      for await (const part of parts) {
        if (part.type === 'file') {
          const chunks: Buffer[] = [];
          let total = 0;
          for await (const chunk of part.file) {
            total += chunk.length;
            if (total > MAX_SOUNDBOARD_BYTES) return sendError(reply, 413, 'validation_failed');
            chunks.push(chunk);
          }
          fileBuffer = Buffer.concat(chunks);
          fileMime = part.mimetype;
          originalName = part.filename;
        } else {
          const val = typeof part.value === 'string' ? part.value : '';
          if (part.fieldname === 'name' && val.trim()) {
            updates.name = val.trim().slice(0, MAX_SOUNDBOARD_NAME);
          } else if (part.fieldname === 'emoji' && val.trim()) {
            updates.emoji = val.trim().slice(0, MAX_SOUNDBOARD_EMOJI);
          } else if (part.fieldname === 'folder') {
            const trimmed = val.trim().slice(0, MAX_SOUNDBOARD_FOLDER);
            updates.folder = trimmed.length > 0 ? trimmed : null;
          } else if (part.fieldname === 'durationMs') {
            const parsed = Number(val);
            if (Number.isFinite(parsed) && parsed >= 0) updates.durationMs = Math.round(parsed);
          }
        }
      }
      if (fileBuffer && fileBuffer.length > 0) {
        const ext = resolveExtension(fileMime, originalName);
        if (!ext) return sendError(reply, 400, 'validation_failed');
        const newFileName = `${randomUUID()}.${ext}`;
        const dir = soundboardDir();
        await mkdir(dir, { recursive: true });
        await writeFile(path.join(dir, newFileName), fileBuffer);
        oldFileToRemove = existing.fileName;
        updates.fileName = newFileName;
        updates.mimeType = EXT_TO_MIME[ext] ?? 'audio/wav';
      }
    } else {
      const body = request.body as { name?: string; emoji?: string; folder?: string | null } | null;
      if (body?.name !== undefined) {
        const trimmed = body.name.trim();
        if (!trimmed || trimmed.length > MAX_SOUNDBOARD_NAME) return sendError(reply, 400, 'validation_failed');
        updates.name = trimmed;
      }
      if (body?.emoji !== undefined && body.emoji.trim()) {
        updates.emoji = body.emoji.trim().slice(0, MAX_SOUNDBOARD_EMOJI);
      }
      if (body?.folder !== undefined) {
        const trimmed = typeof body.folder === 'string' ? body.folder.trim().slice(0, MAX_SOUNDBOARD_FOLDER) : '';
        updates.folder = trimmed.length > 0 ? trimmed : null;
      }
    }

    if (Object.keys(updates).length === 0) {
      return reply.code(200).send(rowToSound(existing));
    }

    db.update(schema.soundboardSounds).set(updates).where(eq(schema.soundboardSounds.id, existing.id)).run();
    if (oldFileToRemove) {
      await unlink(path.join(soundboardDir(), oldFileToRemove)).catch(() => {});
    }
    const updated = db.select().from(schema.soundboardSounds).where(eq(schema.soundboardSounds.id, existing.id)).get();
    if (!updated) return sendError(reply, 500, 'internal_error');
    return reply.code(200).send(rowToSound(updated));
  });

  // PUT /api/soundboard/reorder — reorder sounds within a scope
  app.put<{ Body: { scopeType: SoundboardScopeType; scopeId: string; orderedIds: string[] } }>('/api/soundboard/reorder', {
    preHandler: authenticate,
  }, async (request, reply) => {
    const { scopeType, orderedIds } = request.body;
    const scopeId = scopeType === 'instance' ? 'instance' : request.body.scopeId;
    if (!Array.isArray(orderedIds) || !canManageScope(request.userId, scopeType, scopeId)) {
      return sendError(reply, 403, 'forbidden');
    }

    const db = getDb();
    orderedIds.forEach((soundId, idx) => {
      db.update(schema.soundboardSounds)
        .set({ position: idx })
        .where(and(
          eq(schema.soundboardSounds.id, soundId),
          eq(schema.soundboardSounds.scopeType, scopeType),
          eq(schema.soundboardSounds.scopeId, scopeId),
        ))
        .run();
    });

    const rows = db.select()
      .from(schema.soundboardSounds)
      .where(and(
        eq(schema.soundboardSounds.scopeType, scopeType),
        eq(schema.soundboardSounds.scopeId, scopeId),
      ))
      .orderBy(asc(schema.soundboardSounds.position), asc(schema.soundboardSounds.createdAt))
      .all();
    return reply.code(200).send({ sounds: rows.map((row) => rowToSound(row)) });
  });

  // PUT /api/soundboard/folder — rename a folder within a scope
  app.put<{ Body: { scopeType: SoundboardScopeType; scopeId: string; oldName: string; newName: string } }>('/api/soundboard/folder', {
    preHandler: authenticate,
  }, async (request, reply) => {
    const { scopeType, oldName, newName } = request.body;
    const scopeId = scopeType === 'instance' ? 'instance' : request.body.scopeId;
    if (!canManageScope(request.userId, scopeType, scopeId)) {
      return sendError(reply, 403, 'forbidden');
    }
    const trimmedOld = typeof oldName === 'string' ? oldName.trim() : '';
    const trimmedNew = typeof newName === 'string' ? newName.trim().slice(0, MAX_SOUNDBOARD_FOLDER) : '';
    if (!trimmedOld || !trimmedNew) {
      return sendError(reply, 400, 'validation_failed');
    }

    const db = getDb();
    db.update(schema.soundboardSounds)
      .set({ folder: trimmedNew })
      .where(and(
        eq(schema.soundboardSounds.scopeType, scopeType),
        eq(schema.soundboardSounds.scopeId, scopeId),
        eq(schema.soundboardSounds.folder, trimmedOld),
      ))
      .run();

    const rows = db.select()
      .from(schema.soundboardSounds)
      .where(and(
        eq(schema.soundboardSounds.scopeType, scopeType),
        eq(schema.soundboardSounds.scopeId, scopeId),
      ))
      .orderBy(asc(schema.soundboardSounds.position), asc(schema.soundboardSounds.createdAt))
      .all();
    const overridesMap = scopeType === 'space' ? getSpaceSoundboardOverridesMap(scopeId) : null;
    return reply.code(200).send({
      sounds: rows.map((row) =>
        rowToSound(row, overridesMap ? (overridesMap.get(row.id) ?? { hidden: false, volume: null }) : undefined),
      ),
    });
  });

  // PUT /api/soundboard/space-settings — space-level soundboard override settings
  app.put<{
    Body: {
      spaceId: string;
      soundboardEnabled?: boolean;
      allowInstanceSounds?: boolean;
      maxConcurrentSounds?: number | null;
    };
  }>('/api/soundboard/space-settings', {
    preHandler: authenticate,
  }, async (request, reply) => {
    const { spaceId, soundboardEnabled, allowInstanceSounds, maxConcurrentSounds } = request.body ?? {};
    if (!spaceId || typeof spaceId !== 'string') {
      return sendError(reply, 400, 'validation_failed');
    }
    if (!canManageScope(request.userId, 'space', spaceId)) {
      return sendError(reply, 403, 'forbidden');
    }
    const { soundboardEnabled: instanceEnabled } = getSoundboardLimits();
    if (!instanceEnabled) {
      return sendError(reply, 403, 'forbidden');
    }

    const current = getSpaceSoundboardSettings(spaceId);
    let nextMaxConcurrent = current.maxConcurrentSounds;
    if (maxConcurrentSounds !== undefined) {
      if (maxConcurrentSounds === null) {
        nextMaxConcurrent = null;
      } else if (typeof maxConcurrentSounds === 'number' && Number.isInteger(maxConcurrentSounds) && maxConcurrentSounds >= 1 && maxConcurrentSounds <= 10) {
        nextMaxConcurrent = maxConcurrentSounds;
      } else {
        return sendError(reply, 400, 'validation_failed');
      }
    }

    const nextSettings: SpaceSoundboardSettings = {
      soundboardEnabled: typeof soundboardEnabled === 'boolean' ? soundboardEnabled : current.soundboardEnabled,
      allowInstanceSounds: typeof allowInstanceSounds === 'boolean' ? allowInstanceSounds : current.allowInstanceSounds,
      maxConcurrentSounds: nextMaxConcurrent,
    };

    const db = getDb();
    db.insert(schema.spaceSoundboardSettings)
      .values({
        spaceId,
        soundboardEnabled: nextSettings.soundboardEnabled ? 1 : 0,
        allowInstanceSounds: nextSettings.allowInstanceSounds ? 1 : 0,
        maxConcurrentSounds: nextSettings.maxConcurrentSounds,
      })
      .onConflictDoUpdate({
        target: schema.spaceSoundboardSettings.spaceId,
        set: {
          soundboardEnabled: nextSettings.soundboardEnabled ? 1 : 0,
          allowInstanceSounds: nextSettings.allowInstanceSounds ? 1 : 0,
          maxConcurrentSounds: nextSettings.maxConcurrentSounds,
        },
      })
      .run();

    return reply.code(200).send({ spaceSettings: nextSettings });
  });

  // PUT /api/soundboard/space-overrides — per-sound override (hide/volume) within a space
  app.put<{
    Body: {
      spaceId: string;
      soundId: string;
      hidden?: boolean;
      volume?: number | null;
    };
  }>('/api/soundboard/space-overrides', {
    preHandler: authenticate,
  }, async (request, reply) => {
    const { spaceId, soundId, hidden, volume } = request.body ?? {};
    if (!spaceId || typeof spaceId !== 'string' || !soundId || typeof soundId !== 'string') {
      return sendError(reply, 400, 'validation_failed');
    }
    if (!canManageScope(request.userId, 'space', spaceId)) {
      return sendError(reply, 403, 'forbidden');
    }
    const { soundboardEnabled: instanceEnabled } = getSoundboardLimits();
    if (!instanceEnabled) {
      return sendError(reply, 403, 'forbidden');
    }

    const db = getDb();
    const sound = db
      .select({ id: schema.soundboardSounds.id, scopeType: schema.soundboardSounds.scopeType, scopeId: schema.soundboardSounds.scopeId })
      .from(schema.soundboardSounds)
      .where(eq(schema.soundboardSounds.id, soundId))
      .get();
    if (!sound) {
      return sendError(reply, 404, 'not_found');
    }
    const isEligible = sound.scopeType === 'instance' || (sound.scopeType === 'space' && sound.scopeId === spaceId);
    if (!isEligible) {
      return sendError(reply, 403, 'forbidden');
    }

    const existing = db
      .select()
      .from(schema.spaceSoundboardOverrides)
      .where(and(
        eq(schema.spaceSoundboardOverrides.spaceId, spaceId),
        eq(schema.spaceSoundboardOverrides.soundId, soundId),
      ))
      .get();

    const nextHidden = typeof hidden === 'boolean' ? hidden : (existing?.hidden === 1);
    let nextVolume: number | null = existing?.volume ?? null;
    if (volume !== undefined) {
      if (volume === null) {
        nextVolume = null;
      } else if (typeof volume === 'number' && Number.isFinite(volume) && volume >= 0 && volume <= 100) {
        const rounded = Math.round(volume);
        nextVolume = rounded === 100 ? null : rounded;
      } else {
        return sendError(reply, 400, 'validation_failed');
      }
    }

    if (!nextHidden && nextVolume === null) {
      db.delete(schema.spaceSoundboardOverrides)
        .where(and(
          eq(schema.spaceSoundboardOverrides.spaceId, spaceId),
          eq(schema.spaceSoundboardOverrides.soundId, soundId),
        ))
        .run();
    } else {
      db.insert(schema.spaceSoundboardOverrides)
        .values({
          spaceId,
          soundId,
          hidden: nextHidden ? 1 : 0,
          volume: nextVolume,
        })
        .onConflictDoUpdate({
          target: [schema.spaceSoundboardOverrides.spaceId, schema.spaceSoundboardOverrides.soundId],
          set: {
            hidden: nextHidden ? 1 : 0,
            volume: nextVolume,
          },
        })
        .run();
    }

    const override: SpaceSoundboardSoundOverride = {
      soundId,
      hidden: nextHidden,
      volume: nextVolume,
    };
    return reply.code(200).send({ override });
  });

  // DELETE /api/soundboard/:id
  app.delete<{ Params: { id: string } }>('/api/soundboard/:id', {
    preHandler: authenticate,
  }, async (request, reply) => {
    const db = getDb();
    const existing = db.select().from(schema.soundboardSounds).where(eq(schema.soundboardSounds.id, request.params.id)).get();
    if (!existing) return sendError(reply, 404, 'not_found');

    const scopeType = existing.scopeType as SoundboardScopeType;
    const isOwner = existing.uploadedBy === request.userId;
    if (!isOwner && !canManageScope(request.userId, scopeType, existing.scopeId)) {
      return sendError(reply, 403, 'forbidden');
    }

    db.delete(schema.soundboardSounds).where(eq(schema.soundboardSounds.id, existing.id)).run();
    const deleteBase = path.resolve(soundboardDir());
    const deleteTarget = path.resolve(deleteBase, path.basename(existing.fileName));
    if (deleteTarget.startsWith(deleteBase + path.sep)) {
      await unlink(deleteTarget).catch(() => {});
    }
    return reply.code(200).send({ ok: true });
  });

  // GET /api/soundboard/files/:fileName — serve audio clip
  app.get<{ Params: { fileName: string } }>('/api/soundboard/files/:fileName', async (request, reply) => {
    const { fileName } = request.params;
    if (!SAFE_FILE_NAME.test(fileName)) {
      return sendError(reply, 400, 'validation_failed');
    }
    const baseDir = path.resolve(soundboardDir());
    const filePath = path.resolve(baseDir, path.basename(fileName));
    if (!filePath.startsWith(baseDir + path.sep)) {
      return sendError(reply, 400, 'validation_failed');
    }
    const ext = path.extname(filePath).toLowerCase().replace(/^\./, '');
    try {
      const data = await readFile(filePath);
      return reply
        .header('Content-Type', EXT_TO_MIME[ext] ?? 'application/octet-stream')
        .header('Cache-Control', 'public, max-age=31536000, immutable')
        .send(data);
    } catch {
      return sendError(reply, 404, 'not_found');
    }
  });
}
