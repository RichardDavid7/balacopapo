import { getElectronAPI } from '../platform/platform';

/**
 * System audio without Backspace's own playback, on the desktop app where
 * Chromium's loopback cannot leave it out (#358, Linux). The main process
 * routes every other app's playback into a virtual PipeWire source
 * (packages/desktop/src/systemAudio.ts); here that source is opened like a
 * microphone and its track replaces the loopback track of the share.
 */

/** How long the virtual source gets to show up in the device list after the link is made. */
const DEVICE_WAIT_MS = 3000;
const DEVICE_POLL_MS = 150;

/** Name the main process gives the virtual source (`SYSTEM_AUDIO_SOURCE_LABEL` in packages/desktop/src/systemAudio.ts). */
const SOURCE_LABEL = 'vencord-screen-share';

/** The virtual source is a capture device the app creates itself; it is not a microphone the user plugged in. */
export function isAppSystemAudioSource(device: Pick<MediaDeviceInfo, 'kind' | 'label'>): boolean {
  return device.kind === 'audioinput' && device.label.includes(SOURCE_LABEL);
}

/**
 * Whether this desktop app has the bridge the source needs. The web client
 * tells the main process so when it asks what a system-audio share carries
 * (`getSystemAudioCapability`): only a client that opens the source leaves
 * Backspace's own playback out on Linux.
 */
export function canOpenAppSystemAudioSource(): boolean {
  const api = getElectronAPI();
  return typeof api?.startSystemAudio === 'function' && typeof api.stopSystemAudio === 'function';
}

/**
 * The device list as the hot-plug handler compares it, without the virtual
 * source: that device comes and goes with a share and is no change the user
 * made. groupId and label are part of it because a change of the OS default
 * keeps every deviceId (the `default` entry included) and only relabels the
 * `default` entry, and the handler must still follow it.
 */
export function userDevicesSignature(devices: readonly MediaDeviceInfo[]): string {
  return devices
    .filter((d) => !isAppSystemAudioSource(d))
    .map((d) => JSON.stringify([d.kind, d.deviceId, d.groupId, d.label]))
    .sort()
    .join('\n');
}

type StartResult = Awaited<ReturnType<NonNullable<NonNullable<ReturnType<typeof getElectronAPI>>['startSystemAudio']>>>;

/**
 * Captures that are starting or hold the source. The main process has one
 * link, shared by all of them: it is made by the first and taken down by the
 * last, so one capture stopping (the setup screen discarding a preview, a late
 * toggle capture) never removes the source another one is reading.
 */
let holders = 0;
let starting: Promise<StartResult> | null = null;

const WIN_PCM_SAMPLE_RATE = 48000;
const WIN_PCM_CHANNELS = 2;
const WIN_PCM_BYTES_PER_SAMPLE = 4; // float32 little-endian
const WIN_PCM_BYTES_PER_FRAME = WIN_PCM_CHANNELS * WIN_PCM_BYTES_PER_SAMPLE; // 8 bytes

/**
 * Windows 10 20348+ / 11: acquires per-window or app-excluded audio via the
 * optional native WASAPI Process Loopback addon (`wasapi_loopback.node`),
 * reading its raw 48 kHz stereo f32le PCM HTTP stream into a Web Audio
 * `MediaStreamAudioDestinationNode`. Returns `null` on any failure so the
 * caller falls back gracefully to Chromium's loopback capture.
 */
async function acquireWindowsProcessAudio(opts?: {
  sourceId?: string | null;
  excludeSelf?: boolean;
}): Promise<MediaStreamTrack | null> {
  const api = getElectronAPI();
  if (api?.platform !== 'win32') return null;
  if (typeof api.startWindowsProcessAudio !== 'function' || typeof api.stopWindowsProcessAudio !== 'function') {
    return null;
  }

  let started = false;
  let ctx: AudioContext | null = null;
  let abort: AbortController | null = null;
  let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  let cleaned = false;

  const cleanup = (): void => {
    if (cleaned) return;
    cleaned = true;
    try { abort?.abort(); } catch { /* ignore */ }
    if (reader) {
      void reader.cancel().catch(() => undefined);
      reader = null;
    }
    if (ctx) {
      void ctx.close().catch(() => undefined);
      ctx = null;
    }
    if (started) {
      started = false;
      void api.stopWindowsProcessAudio?.().catch(() => undefined);
    }
  };

  try {
    const res = await api.startWindowsProcessAudio({
      sourceId: opts?.sourceId ?? null,
      excludeSelf: opts?.excludeSelf ?? true,
    });
    if (!res.ok) return null;
    started = true;

    abort = new AbortController();
    const response = await fetch(res.url, { signal: abort.signal });
    if (!response.ok || !response.body) {
      cleanup();
      return null;
    }

    ctx = new AudioContext({ sampleRate: WIN_PCM_SAMPLE_RATE });
    if (ctx.state === 'suspended') {
      await ctx.resume();
    }
    const dest = ctx.createMediaStreamDestination();
    const track = dest.stream.getAudioTracks()[0];
    if (!track) {
      cleanup();
      return null;
    }

    reader = response.body.getReader();
    const activeCtx = ctx;
    const activeReader = reader;

    // Pump raw interleaved f32le stereo PCM frames into scheduled AudioBuffers.
    void (async () => {
      let leftover = new Uint8Array(0);
      let nextPlayTime = 0;
      try {
        for (;;) {
          const { done, value } = await activeReader.read();
          if (done || cleaned) break;
          if (!value || value.byteLength === 0) continue;

          let chunk: Uint8Array;
          if (leftover.byteLength > 0) {
            chunk = new Uint8Array(leftover.byteLength + value.byteLength);
            chunk.set(leftover, 0);
            chunk.set(value, leftover.byteLength);
          } else {
            chunk = value;
          }

          const frameCount = Math.floor(chunk.byteLength / WIN_PCM_BYTES_PER_FRAME);
          const usableBytes = frameCount * WIN_PCM_BYTES_PER_FRAME;
          leftover = usableBytes < chunk.byteLength ? chunk.slice(usableBytes) : new Uint8Array(0);

          if (frameCount === 0 || activeCtx.state === 'closed') continue;

          const audioBuffer = activeCtx.createBuffer(WIN_PCM_CHANNELS, frameCount, WIN_PCM_SAMPLE_RATE);
          const left = audioBuffer.getChannelData(0);
          const right = audioBuffer.getChannelData(1);
          const view = new DataView(chunk.buffer, chunk.byteOffset, usableBytes);
          for (let i = 0; i < frameCount; i++) {
            const offset = i * WIN_PCM_BYTES_PER_FRAME;
            left[i] = view.getFloat32(offset, true);
            right[i] = view.getFloat32(offset + 4, true);
          }

          const now = activeCtx.currentTime;
          if (nextPlayTime < now + 0.01 || nextPlayTime > now + 0.35) {
            nextPlayTime = now + 0.04;
          }

          const sourceNode = activeCtx.createBufferSource();
          sourceNode.buffer = audioBuffer;
          sourceNode.connect(dest);
          sourceNode.start(nextPlayTime);
          nextPlayTime += audioBuffer.duration;
        }
      } catch (err) {
        if (!cleaned) {
          console.warn('[ScreenShare] Windows process audio PCM stream ended:', err);
        }
      }
    })();

    const stopTrack = track.stop.bind(track);
    track.stop = (): void => {
      stopTrack();
      cleanup();
    };
    track.addEventListener('ended', cleanup, { once: true });
    return track;
  } catch (err) {
    console.warn('[ScreenShare] Windows process audio could not be started:', err);
    cleanup();
    return null;
  }
}

/** `null` when the desktop app has no such source (or this is a browser): the caller keeps the loopback capture. */
export async function acquireAppExcludedSystemAudio(opts?: {
  targetAppName?: string;
  sourceId?: string | null;
  excludeSelf?: boolean;
}): Promise<MediaStreamTrack | null> {
  const api = getElectronAPI();
  if (api?.platform === 'win32' && typeof api.startWindowsProcessAudio === 'function') {
    const winTrack = await acquireWindowsProcessAudio({
      sourceId: opts?.sourceId ?? null,
      excludeSelf: opts?.excludeSelf ?? true,
    });
    if (winTrack) return winTrack;
  }
  if (!api?.startSystemAudio || !api.stopSystemAudio) return null;

  holders++;
  let dropped = false;
  /** Give up this capture's share of the source; the link goes with the last one. */
  const drop = (unlink: boolean): void => {
    if (dropped) return;
    dropped = true;
    if (--holders > 0) return;
    starting = null;
    if (unlink) void api.stopSystemAudio?.().catch(() => undefined);
  };

  try {
    starting ??= opts?.targetAppName ? api.startSystemAudio({ targetAppName: opts.targetAppName }) : api.startSystemAudio();
    const result = await starting;
    if (!result.ok) {
      drop(false);
      return null;
    }

    const deviceId = await waitForDevice(result.label);
    if (!deviceId) {
      console.warn('[ScreenShare] The system-audio source did not appear in the device list');
      drop(true);
      return null;
    }
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        deviceId: { exact: deviceId },
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
        channelCount: 2,
      },
    });
    const track = stream.getAudioTracks()[0];
    if (!track) {
      drop(true);
      return null;
    }
    // The link lives as long as the tracks: stopping one, by any path that
    // stops a capture track, gives up its share of it.
    const stopTrack = track.stop.bind(track);
    track.stop = (): void => {
      stopTrack();
      drop(true);
    };
    track.addEventListener('ended', () => drop(true), { once: true });
    return track;
  } catch (err) {
    console.warn('[ScreenShare] The system-audio source could not be started or opened:', err);
    // A start that threw may or may not have linked: take it down if nothing else holds it.
    drop(true);
    return null;
  }
}

async function waitForDevice(label: string): Promise<string | null> {
  const deadline = Date.now() + DEVICE_WAIT_MS;
  for (;;) {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const found = devices.find((d) => d.kind === 'audioinput' && d.label.includes(label));
    if (found) return found.deviceId;
    if (Date.now() >= deadline) return null;
    await new Promise((resolve) => setTimeout(resolve, DEVICE_POLL_MS));
  }
}
