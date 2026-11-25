import type { SoundboardSound } from '@backspace/shared';
import { useVoiceStore } from '../stores/voiceStore';
import { getApiForOrigin, getMyUserIdForOrigin, useSpaceStore } from '../stores/spaceStore';
import { getActiveRoom } from '../hooks/useLiveKit';
import { voiceSessionOrigin } from './dmCall';
import { encodeSoundboardPlay } from './soundboardProtocol';

interface CachedSoundCatalog {
  sounds: Map<string, SoundboardSound>;
  maxConcurrentSounds: number;
  soundboardEnabled: boolean;
  fetchedAt: number;
}

const CATALOG_TTL_MS = 60_000;
const catalogCache = new Map<string, CachedSoundCatalog>();

function cacheKey(origin: string | null, spaceId: string | null): string {
  return `${origin ?? 'home'}::${spaceId ?? 'dm'}`;
}

export function cacheSoundboardCatalog(
  origin: string | null,
  spaceId: string | null,
  sounds: SoundboardSound[],
  maxConcurrentSounds: number,
  soundboardEnabled: boolean,
): void {
  const map = new Map<string, SoundboardSound>();
  for (const s of sounds) {
    map.set(s.id, s);
  }
  catalogCache.set(cacheKey(origin, spaceId), {
    sounds: map,
    maxConcurrentSounds,
    soundboardEnabled,
    fetchedAt: Date.now(),
  });
}

/**
 * Triggers a soundboard clip locally (if not muted/deafened) and broadcasts
 * the DataChannel play packet to everyone in the active LiveKit room.
 */
export function triggerSoundboardSound(
  sound: SoundboardSound,
  opts: { origin: string | null; maxConcurrentSounds?: number },
): boolean {
  const voice = useVoiceStore.getState();
  const maxConcurrent = opts.maxConcurrentSounds ?? 3;
  if (!voice.tryStartSoundboardClip(sound.id, sound.durationMs, maxConcurrent)) {
    return false;
  }

  const resolvedUrl = sound.fileUrl.startsWith('/') && opts.origin
    ? `${opts.origin}${sound.fileUrl}`
    : sound.fileUrl;

  const myUserId = getMyUserIdForOrigin(opts.origin ?? '');
  if (myUserId && !voice.soundboardMuted) {
    voice.markUserPlayingSoundboard(myUserId, sound.emoji ?? '', sound.name, sound.durationMs);
  }

  const clipScale = Math.max(0, Math.min(1, (sound.volumeOverride ?? 100) / 100));

  if (!voice.isDeafened && !voice.soundboardMuted && voice.soundboardVolume > 0) {
    void import('../audio/AudioManager')
      .then(({ AudioManager }) => {
        AudioManager.getInstance().setSoundboardVolume(voice.soundboardVolume, voice.soundboardMuted);
        return AudioManager.getInstance().playSoundUrl(resolvedUrl, { volume: clipScale });
      })
      .then((res) => {
        if (!res) {
          useVoiceStore.getState().finishSoundboardClip(sound.id);
          return;
        }
        res.source.addEventListener('ended', () => {
          useVoiceStore.getState().finishSoundboardClip(sound.id);
        });
      })
      .catch(() => {
        useVoiceStore.getState().finishSoundboardClip(sound.id);
      });
  } else {
    const releaseMs = Math.max(400, Math.min(sound.durationMs > 0 ? sound.durationMs : 1500, 3000));
    setTimeout(() => {
      useVoiceStore.getState().finishSoundboardClip(sound.id);
    }, releaseMs);
  }

  const room = getActiveRoom();
  if (room) {
    const payload = encodeSoundboardPlay({
      soundId: sound.id,
      fileUrl: sound.fileUrl,
      emoji: sound.emoji,
      name: sound.name,
      senderUserId: myUserId ?? room.localParticipant.identity.split(':')[0] ?? '',
      durationMs: sound.durationMs,
      ...(clipScale < 1 ? { volumeScale: clipScale } : {}),
    });
    room.localParticipant.publishData(new Uint8Array(payload), { reliable: true }).catch(() => {});
  }

  return true;
}

/**
 * Resolves a soundboard clip by ID for the active voice session (using the
 * local catalog cache or fetching on demand) and plays it.
 */
export async function playSoundboardClipById(soundId: string): Promise<boolean> {
  const voice = useVoiceStore.getState();
  if (!voice.currentVoiceChannelId && !voice.activeDmCall) return false;

  const origin = voiceSessionOrigin(voice);
  const spaceId = !voice.activeDmCall && voice.currentVoiceChannelId
    ? (useSpaceStore.getState().channelToSpaceMap.get(voice.currentVoiceChannelId) ?? null)
    : null;

  const key = cacheKey(origin, spaceId);
  let cached = catalogCache.get(key);
  if (!cached || Date.now() - cached.fetchedAt > CATALOG_TTL_MS || !cached.sounds.has(soundId)) {
    try {
      const client = getApiForOrigin(origin);
      const data = await client.soundboard.list({ spaceId: spaceId ?? undefined });
      const allSounds = [...data.instanceSounds, ...data.scopedSounds];
      cacheSoundboardCatalog(
        origin,
        spaceId,
        allSounds,
        data.maxConcurrentSounds ?? 3,
        data.soundboardEnabled ?? true,
      );
      cached = catalogCache.get(key);
    } catch {
      return false;
    }
  }

  if (!cached || !cached.soundboardEnabled) return false;
  const sound = cached.sounds.get(soundId);
  if (!sound) return false;

  return triggerSoundboardSound(sound, {
    origin,
    maxConcurrentSounds: cached.maxConcurrentSounds,
  });
}
