/**
 * DesktopMediaBridge — Ponte opcional entre `packages/web` e o motor nativo Rust
 * do Balacopapo Desktop (Tauri v2 Híbrido).
 *
 * Quando aberto em um navegador comum, todas as funções retornam fallback seguro
 * sem lançar exceções nem alterar o comportamento web padrão.
 */

export interface DesktopCapabilities {
  isolatedAudio: boolean;
  inGameOverlay: boolean;
  nativeScreenShare: boolean;
  globalKeybinds: boolean;
  safeRemoteControl: boolean;
  gamePresence: boolean;
  nativeNotifications: boolean;
  silentUpdater: boolean;
}

export interface DesktopRuntimeMeta {
  version: string;
  buildSha: string;
  platform: string;
  architecture: string;
  capabilities: DesktopCapabilities;
}

export interface AudioTarget {
  pid: number;
  processName: string;
  windowTitle: string;
  pipewireNodeId?: number;
  isSystemDefault: boolean;
}

export type IsolatedAudioMode =
  | { kind: 'includeProcessTree'; pid: number; pipewireNodeId?: number; label?: string }
  | { kind: 'excludeSelf' };

export interface IsolatedAudioStatus {
  active: boolean;
  mode: IsolatedAudioMode | null;
  targetLabel: string | null;
  loopbackUrl: string | null;
  backend: string;
  sampleRate: number;
  channels: number;
  peakLevel: number;
  capturedFrames: number;
  error: string | null;
}

export type OverlayCorner = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';

export interface OverlayConfig {
  enabled: boolean;
  showPointers: boolean;
  showSpeakers: boolean;
  showToasts: boolean;
  corner: OverlayCorner;
  opacity: number;
  monitorIndex?: number | null;
}

export interface OverlaySpeaker {
  identity: string;
  name: string;
  speaking: boolean;
  muted?: boolean;
  avatarColor?: string;
}

export interface OverlayPointerPayload {
  senderName: string;
  x: number;
  y: number;
  color?: string;
  mode?: 'ping' | 'drag' | 'clear';
}

export interface OverlayToastPayload {
  title: string;
  body: string;
  kind?: string;
  durationMs?: number;
}

export type VideoCodec = 'h264' | 'h265' | 'av1' | 'vp9';
export type ChromaSubsampling = 'yuv420' | 'yuv444';
export type CaptureProfile =
  | 'pixelPerfect444'
  | 'highClarity120'
  | 'ultraCrisp60'
  | 'balanced60'
  | 'custom';

export interface CaptureSource {
  id: string;
  kind: 'monitor' | 'window' | string;
  name: string;
  width: number;
  height: number;
  x: number;
  y: number;
  scaleFactor: number;
  isPrimary: boolean;
  pid?: number;
}

export interface HardwareEncoderInfo {
  name: string;
  codec: VideoCodec;
  vendor: string;
  hardwareAccelerated: boolean;
  supports444: boolean;
}

export interface NativeScreenShareConfig {
  sourceId: string;
  profile: CaptureProfile;
  width?: number;
  height?: number;
  fps?: number;
  bitrateKbps?: number;
  codec?: VideoCodec;
  chroma?: ChromaSubsampling;
  preferredEncoder?: string;
}

export interface ResolvedCaptureParams {
  width: number;
  height: number;
  fps: number;
  bitrateKbps: number;
  codec: VideoCodec;
  chroma: ChromaSubsampling;
  encoder: string;
}

export interface NativeScreenShareStatus {
  active: boolean;
  sourceId: string | null;
  params: ResolvedCaptureParams | null;
  loopbackUrl: string | null;
  captureBackend: string;
  bytesSent: number;
  currentBitrateMbps: number;
  error: string | null;
}

export interface KeybindEntry {
  action:
    | 'ToggleMute'
    | 'ToggleDeafen'
    | 'PushToTalk'
    | 'ToggleOverlay'
    | 'MuteSoundboard'
    | { PlaySoundboardClip: string };
  shortcut: string;
  enabled: boolean;
}

export interface GamePresenceConfig {
  enabled: boolean;
  ignoredGames: string[];
  manualOverride: string | null;
}

export type RemoteControlState =
  | { status: 'idle' }
  | { status: 'pendingConsent'; requester: string }
  | { status: 'active'; controller: string; allowMouse: boolean; allowKeyboard: boolean };

export type RemoteInputEvent =
  | { kind: 'mouse_move'; nx: number; ny: number }
  | { kind: 'mouse_button'; button: 'left' | 'right' | 'middle'; pressed: boolean }
  | { kind: 'key_press'; code: string; pressed: boolean };

interface TauriWindowGlobals {
  __BALACOPAPO_DESKTOP__?: DesktopRuntimeMeta;
  __TAURI__?: {
    core?: {
      invoke?: <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;
    };
    event?: {
      listen?: <T>(
        event: string,
        handler: (ev: { payload: T }) => void,
      ) => Promise<() => void>;
    };
  };
}

function getGlobals(): TauriWindowGlobals {
  return (typeof window !== 'undefined' ? window : {}) as unknown as TauriWindowGlobals;
}

async function tauriInvoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T | null> {
  const invoke = getGlobals().__TAURI__?.core?.invoke;
  if (!invoke) return null;
  return invoke<T>(cmd, args);
}

export function isBalacopapoDesktop(): boolean {
  const g = getGlobals();
  return Boolean(g.__BALACOPAPO_DESKTOP__ && g.__TAURI__?.core?.invoke);
}

export function getDesktopMeta(): DesktopRuntimeMeta | null {
  return getGlobals().__BALACOPAPO_DESKTOP__ ?? null;
}

export const desktopBridge = {
  // Áudio Isolado (Etapa 2)
  listAudioTargets: () => tauriInvoke<AudioTarget[]>('list_audio_targets'),
  startIsolatedAudio: (mode: IsolatedAudioMode) =>
    tauriInvoke<IsolatedAudioStatus>('start_isolated_audio', { mode }),
  stopIsolatedAudio: () => tauriInvoke<IsolatedAudioStatus>('stop_isolated_audio'),
  getIsolatedAudioStatus: () => tauriInvoke<IsolatedAudioStatus>('get_isolated_audio_status'),

  // Overlay In-Game Click-Through (Etapa 2)
  getOverlayConfig: () => tauriInvoke<OverlayConfig>('get_overlay_config'),
  showOverlay: (config?: OverlayConfig) =>
    tauriInvoke<OverlayConfig>('show_overlay', config ? { config } : undefined),
  hideOverlay: () => tauriInvoke<OverlayConfig>('hide_overlay'),
  updateOverlayConfig: (config: OverlayConfig) =>
    tauriInvoke<OverlayConfig>('update_overlay_config', { config }),
  pushOverlayPointer: (pointer: OverlayPointerPayload) =>
    tauriInvoke<void>('push_overlay_pointer', { pointer }),
  setOverlaySpeakers: (speakers: OverlaySpeaker[]) =>
    tauriInvoke<void>('set_overlay_speakers', { speakers }),
  pushOverlayToast: (toast: OverlayToastPayload) =>
    tauriInvoke<void>('push_overlay_toast', { toast }),

  // Captura Pixel-Perfect 1080p 120fps até 150 Mbps (Etapa 3)
  listCaptureSources: () => tauriInvoke<CaptureSource[]>('list_capture_sources'),
  detectHardwareEncoders: () => tauriInvoke<HardwareEncoderInfo[]>('detect_hardware_encoders'),
  startNativeScreenShare: (config: NativeScreenShareConfig) =>
    tauriInvoke<NativeScreenShareStatus>('start_native_screen_share', { config }),
  stopNativeScreenShare: () => tauriInvoke<NativeScreenShareStatus>('stop_native_screen_share'),
  getNativeScreenShareStatus: () =>
    tauriInvoke<NativeScreenShareStatus>('get_native_screen_share_status'),

  // Presença de Jogos & Notificações Nativas (Etapa 4)
  scanActiveGame: (ignored?: string[]) =>
    tauriInvoke<{ processName: string; displayName: string } | null>('scan_active_game', {
      ignored,
    }),
  getGamePresenceConfig: () => tauriInvoke<GamePresenceConfig>('get_game_presence_config'),
  setGamePresenceConfig: (config: GamePresenceConfig) =>
    tauriInvoke<GamePresenceConfig>('set_game_presence_config', { config }),
  getCurrentGamePresence: () =>
    tauriInvoke<{ processName: string; displayName: string } | null>('get_current_game_presence'),
  sendNativeNotification: (title: string, body: string) =>
    tauriInvoke<void>('send_native_notification', { title, body }),
  openDesktopSettings: () => tauriInvoke<void>('open_desktop_settings'),
  getDesktopInfo: () =>
    tauriInvoke<{
      version: string;
      buildSha: string | null;
      platform: string;
      instanceUrl: string | null;
      autostartEnabled: boolean;
      overlayActive: boolean;
    }>('get_desktop_info'),
  setAutostart: (enabled: boolean) => tauriInvoke<boolean>('set_autostart', { enabled }),
  clearInstanceUrl: () => tauriInvoke<void>('clear_instance_url'),
  checkUpdatesNow: () =>
    tauriInvoke<{ kind: string; version?: string; message?: string }>('check_updates_now'),
  applyUpdateAndRestart: () => tauriInvoke<void>('apply_update_and_restart'),

  // Atalhos Globais em Jogos (Etapa 4)
  getKeybinds: () => tauriInvoke<KeybindEntry[]>('get_keybinds'),
  setKeybinds: (entries: KeybindEntry[]) =>
    tauriInvoke<KeybindEntry[]>('set_keybinds', { entries }),

  // Controle Remoto Seguro (Etapa 4 — com atalho de pânico Ctrl+Alt+Escape)
  getRemoteControlState: () => tauriInvoke<RemoteControlState>('get_remote_control_state'),
  requestRemoteControl: (requester: string) =>
    tauriInvoke<RemoteControlState>('request_remote_control', { requester }),
  approveRemoteControl: (allowMouse: boolean, allowKeyboard: boolean) =>
    tauriInvoke<RemoteControlState>('approve_remote_control', { allowMouse, allowKeyboard }),
  revokeRemoteControl: () => tauriInvoke<RemoteControlState>('revoke_remote_control'),
  injectRemoteInput: (event: RemoteInputEvent) =>
    tauriInvoke<void>('inject_remote_input', { event }),

  // Listener tipado para eventos nativos (keybinds, game-presence, remote-control-state)
  listenEvent: async <T>(
    eventName:
      | 'balacopapo://keybind-triggered'
      | 'balacopapo://game-presence'
      | 'balacopapo://remote-control-state'
      | 'balacopapo://update-status'
      | 'balacopapo://window-visibility',
    handler: (payload: T) => void,
  ): Promise<(() => void) | null> => {
    const listen = getGlobals().__TAURI__?.event?.listen;
    if (!listen) return null;
    return listen<T>(eventName, (ev) => handler(ev.payload));
  },
};

/**
 * Monta um MediaStream real a partir do loopback local MJPEG (vídeo nativo Rust)
 * e do loopback local PCM f32 48 kHz estéreo (WASAPI Process Loopback / PipeWire),
 * pronto para `publishScreenShare(room, stream)` sem nunca chamar `getDisplayMedia()`.
 */
export async function createNativeDesktopMediaStream(
  videoLoopbackUrl: string,
  audioLoopbackUrl: string | null | undefined,
  targetFps = 60,
): Promise<MediaStream> {
  const fps = Math.max(15, Math.min(60, Math.round(targetFps)));
  const canvas = document.createElement('canvas');
  canvas.width = 1280;
  canvas.height = 720;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D indisponível');

  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.src = videoLoopbackUrl;

  await new Promise<void>((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error('Timeout aguardando primeiro frame nativo')), 5000);
    img.onload = () => {
      window.clearTimeout(timer);
      if (img.naturalWidth > 0 && img.naturalHeight > 0) {
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      }
      resolve();
    };
    img.onerror = () => {
      window.clearTimeout(timer);
      reject(new Error('Falha ao conectar ao loopback local de vídeo'));
    };
  });

  const drawInterval = window.setInterval(() => {
    if (img.naturalWidth > 0 && img.naturalHeight > 0) {
      if (canvas.width !== img.naturalWidth || canvas.height !== img.naturalHeight) {
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
      }
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    }
  }, Math.max(16, Math.floor(1000 / fps)));

  const stream = canvas.captureStream(fps);
  const abortController = new AbortController();
  let audioCtx: AudioContext | null = null;

  if (audioLoopbackUrl) {
    try {
      audioCtx = new AudioContext({ sampleRate: 48_000 });
      const dest = audioCtx.createMediaStreamDestination();
      const audioTrack = dest.stream.getAudioTracks()[0];
      if (audioTrack) stream.addTrack(audioTrack);

      const ctxRef = audioCtx;
      void (async () => {
        try {
          const resp = await fetch(audioLoopbackUrl, { signal: abortController.signal });
          const reader = resp.body?.getReader();
          if (!reader) return;

          let leftover = new Uint8Array(0);
          let nextPlayTime = ctxRef.currentTime + 0.04;

          while (!abortController.signal.aborted) {
            const { done, value } = await reader.read();
            if (done || !value) break;

            const merged = new Uint8Array(leftover.length + value.length);
            merged.set(leftover, 0);
            merged.set(value, leftover.length);

            const frameBytes = 8; // 2 canais * f32 (4 bytes)
            const usableBytes = Math.floor(merged.length / frameBytes) * frameBytes;
            leftover = merged.slice(usableBytes);
            if (usableBytes === 0) continue;

            const frames = usableBytes / frameBytes;
            const floats = new Float32Array(merged.buffer, merged.byteOffset, frames * 2);
            const audioBuf = ctxRef.createBuffer(2, frames, 48_000);
            const ch0 = audioBuf.getChannelData(0);
            const ch1 = audioBuf.getChannelData(1);
            for (let i = 0; i < frames; i++) {
              ch0[i] = floats[i * 2] ?? 0;
              ch1[i] = floats[i * 2 + 1] ?? 0;
            }

            const src = ctxRef.createBufferSource();
            src.buffer = audioBuf;
            src.connect(dest);
            const now = ctxRef.currentTime;
            if (nextPlayTime < now) nextPlayTime = now + 0.02;
            src.start(nextPlayTime);
            nextPlayTime += audioBuf.duration;
          }
        } catch {
          // Encerrado ao parar compartilhamento
        }
      })();
    } catch {
      // Continua apenas com vídeo caso AudioContext não inicialize
    }
  }

  const cleanup = () => {
    window.clearInterval(drawInterval);
    abortController.abort();
    img.src = '';
    if (audioCtx) {
      void audioCtx.close().catch(() => {});
      audioCtx = null;
    }
  };

  const videoTrack = stream.getVideoTracks()[0];
  if (videoTrack) {
    const origStop = videoTrack.stop.bind(videoTrack);
    videoTrack.stop = () => {
      cleanup();
      origStop();
    };
    videoTrack.addEventListener('ended', cleanup, { once: true });
  }

  return stream;
}
