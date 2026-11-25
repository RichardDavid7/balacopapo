import { describe, it, expect } from 'vitest';
import {
  clientPointToNormalizedVideo,
  computeVideoContentBox,
  encodeStreamPointer,
  parseStreamPointer,
} from './streamPointerProtocol';

describe('streamPointerProtocol', () => {
  it('round-trips a valid stream pointer message', () => {
    const encoded = encodeStreamPointer({
      type: 'stream_pointer',
      streamIdentity: 'sharer-1',
      x: 0.42,
      y: 0.75,
      mode: 'ping',
      color: '#34d399',
    });
    expect(parseStreamPointer(encoded)).toEqual({
      type: 'stream_pointer',
      streamIdentity: 'sharer-1',
      x: 0.42,
      y: 0.75,
      mode: 'ping',
      color: '#34d399',
    });
  });

  it('rejects out-of-range coordinates or invalid payloads', () => {
    const bad = encodeStreamPointer({
      type: 'stream_pointer',
      streamIdentity: 'sharer-1',
      x: 1.5,
      y: 0.5,
      mode: 'ping',
    });
    expect(parseStreamPointer(bad)).toBeNull();
    expect(parseStreamPointer(new TextEncoder().encode('{"type":"other"}'))).toBeNull();
  });

  it('computes letterboxed video content box and maps clicks accurately', () => {
    // 16:9 video inside a 1000x1000 square container -> 1000x562.5 centered vertically
    const box = computeVideoContentBox(1000, 1000, 1920, 1080);
    expect(box.left).toBe(0);
    expect(box.width).toBe(1000);
    expect(Math.round(box.height)).toBe(563);
    expect(Math.round(box.top)).toBe(219);

    // Center of the container maps to (0.5, 0.5)
    const center = clientPointToNormalizedVideo(
      500,
      500,
      { left: 0, top: 0, width: 1000, height: 1000 },
      1920,
      1080,
    );
    expect(center).toEqual({ x: 0.5, y: 0.5 });

    // Clicking inside the top black letterbox bar returns null
    const inBar = clientPointToNormalizedVideo(
      500,
      50,
      { left: 0, top: 0, width: 1000, height: 1000 },
      1920,
      1080,
    );
    expect(inBar).toBeNull();
  });
});
