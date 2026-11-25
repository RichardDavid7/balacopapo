export type StreamPointerMode = 'ping' | 'drag' | 'clear';

export interface StreamPointerMessage {
  type: 'stream_pointer';
  /** LiveKit identity of the participant sharing the target stream */
  streamIdentity: string;
  /** Normalized horizontal coordinate within the actual video content [0..1] */
  x: number;
  /** Normalized vertical coordinate within the actual video content [0..1] */
  y: number;
  mode: StreamPointerMode;
  color?: string;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

const VALID_MODES = new Set<StreamPointerMode>(['ping', 'drag', 'clear']);
const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;

export function encodeStreamPointer(msg: StreamPointerMessage): Uint8Array<ArrayBuffer> {
  return encoder.encode(JSON.stringify(msg)) as Uint8Array<ArrayBuffer>;
}

export function parseStreamPointer(payload: Uint8Array): StreamPointerMessage | null {
  try {
    const raw = JSON.parse(decoder.decode(payload)) as Record<string, unknown>;
    if (!raw || raw.type !== 'stream_pointer') return null;
    if (typeof raw.streamIdentity !== 'string' || !raw.streamIdentity) return null;
    if (typeof raw.x !== 'number' || typeof raw.y !== 'number') return null;
    if (!Number.isFinite(raw.x) || !Number.isFinite(raw.y)) return null;
    if (raw.x < 0 || raw.x > 1 || raw.y < 0 || raw.y > 1) return null;
    if (typeof raw.mode !== 'string' || !VALID_MODES.has(raw.mode as StreamPointerMode)) return null;

    const color = typeof raw.color === 'string' && HEX_COLOR_RE.test(raw.color) ? raw.color : undefined;
    return {
      type: 'stream_pointer',
      streamIdentity: raw.streamIdentity,
      x: raw.x,
      y: raw.y,
      mode: raw.mode as StreamPointerMode,
      color,
    };
  } catch {
    return null;
  }
}

export interface VideoContentBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * Computes the rendered content box of an `object-contain` video inside its
 * element bounds, accounting for letterboxing / pillarboxing.
 */
export function computeVideoContentBox(
  elementWidth: number,
  elementHeight: number,
  videoWidth: number,
  videoHeight: number,
): VideoContentBox {
  if (elementWidth <= 0 || elementHeight <= 0) {
    return { left: 0, top: 0, width: 0, height: 0 };
  }
  if (videoWidth <= 0 || videoHeight <= 0) {
    return { left: 0, top: 0, width: elementWidth, height: elementHeight };
  }

  const elemRatio = elementWidth / elementHeight;
  const vidRatio = videoWidth / videoHeight;

  if (vidRatio > elemRatio) {
    // Letterboxed (black bars top and bottom)
    const width = elementWidth;
    const height = elementWidth / vidRatio;
    return { left: 0, top: (elementHeight - height) / 2, width, height };
  }
  // Pillarboxed (black bars left and right)
  const height = elementHeight;
  const width = elementHeight * vidRatio;
  return { left: (elementWidth - width) / 2, top: 0, width, height };
}

/**
 * Converts client pointer coordinates (relative to the `<video>` bounding rect,
 * which already reflects any CSS zoom/pan transform) into normalized `[0..1]`
 * coordinates inside the actual video frame. Returns `null` if outside the frame.
 */
export function clientPointToNormalizedVideo(
  clientX: number,
  clientY: number,
  videoRect: Pick<DOMRect, 'left' | 'top' | 'width' | 'height'>,
  videoWidth: number,
  videoHeight: number,
): { x: number; y: number } | null {
  const box = computeVideoContentBox(videoRect.width, videoRect.height, videoWidth, videoHeight);
  if (box.width <= 0 || box.height <= 0) return null;

  const relX = (clientX - videoRect.left - box.left) / box.width;
  const relY = (clientY - videoRect.top - box.top) / box.height;
  if (relX < 0 || relX > 1 || relY < 0 || relY > 1) return null;

  return {
    x: Math.round(relX * 10000) / 10000,
    y: Math.round(relY * 10000) / 10000,
  };
}

/**
 * Picks a stable vivid accent hex for a given participant identity.
 */
const POINTER_PALETTE = [
  '#a78bfa', // lavender
  '#34d399', // mint
  '#38bdf8', // sky
  '#fbbf24', // amber
  '#fb7185', // rose
  '#f472b6', // pink
  '#2dd4bf', // teal
  '#fb923c', // peach
] as const;

export function pointerColorForIdentity(identity: string): string {
  let hash = 0;
  for (let i = 0; i < identity.length; i++) {
    hash = ((hash << 5) - hash + identity.charCodeAt(i)) | 0;
  }
  return POINTER_PALETTE[Math.abs(hash) % POINTER_PALETTE.length] ?? '#a78bfa';
}
